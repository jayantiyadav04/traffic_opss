const mongoose = require('mongoose');
const crypto = require('node:crypto');
const Violation = require('../models/Violation');
const Payment = require('../models/Payment');
const AuditEvent = require('../models/AuditEvent');
const IdempotencyRecord = require('../models/IdempotencyRecord');
const WebhookEvent = require('../models/WebhookEvent');
const AppError = require('../utils/AppError');
const { recordMoney } = require('../utils/money');
const { getDefaultAdapter } = require('../providers/paypal');

function validId(value) { return typeof value === 'string' && /^[a-f\d]{24}$/i.test(value); }
function requireId(value) { if (!validId(value)) throw new AppError(400, 'INVALID_ID', 'A valid identifier is required.'); }
function keyInfo(actor, operation, key, payload) {
    if (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) throw new AppError(400, 'INVALID_IDEMPOTENCY_KEY', 'Supply an Idempotency-Key of 8–128 letters, digits or ._:-.');
    return { actor_id: actor._id, operation, key, fingerprint: crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex') };
}
function bodyFields(body, fields) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(name => !fields.includes(name))) throw new AppError(400, 'VALIDATION_ERROR', 'Unsupported request fields.');
}
function text(value, name) {
    if (typeof value !== 'string' || value.trim().length < 3 || value.trim().length > 200) throw new AppError(400, 'VALIDATION_ERROR', `A ${name} of 3–200 characters is required.`);
    return value.trim();
}
function scope(actor) { return actor.role === 'citizen' ? { citizen_id: actor._id } : {}; }
async function transaction(work) {
    // withTransaction retries database conflicts; external calls NEVER enter this callback.
    for (let attempt = 0; attempt < 4; attempt++) {
        const session = await mongoose.startSession();
        try { let result; await session.withTransaction(async () => { result = await work(session); }); return result; }
        catch (error) { if (error.code === 11000 && attempt < 3) continue; throw error; }
        finally { await session.endSession(); }
    }
}
async function replay(info, session) {
    const record = await IdempotencyRecord.findOne({ actor_id: info.actor_id, operation: info.operation, key: info.key }).session(session);
    if (!record) return null;
    if (record.fingerprint !== info.fingerprint) throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'This key was used for a different request.');
    const payment = await Payment.findById(record.payment_id).session(session);
    if (!payment) throw new AppError(503, 'PAYMENT_INCONSISTENT', 'Payment requires reconciliation.');
    return payment;
}
async function loadViolation(id, actor, session) {
    const query = { _id: id };
    if (actor.role === 'citizen') Object.assign(query, { user: actor._id, ownership_verified: true });
    const violation = await Violation.findOne(query).session(session);
    if (!violation) throw new AppError(404, 'NOT_FOUND', 'Violation not found.');
    if (!violation.ownership_verified || !violation.user || violation.schema_version !== 2) throw new AppError(409, 'REVIEW_REQUIRED', 'Identity and money migration must be reviewed before payment.');
    return violation;
}
function result(payment) {
    const safe = { _id: payment._id, violation_id: payment.violation_id, amount_minor: payment.amount_minor, currency: payment.currency,
        method: payment.method, status: payment.status, phase: payment.phase, provider_order_id: payment.provider_order_id,
        approval_url: payment.approval_url, createdAt: payment.createdAt, updatedAt: payment.updatedAt };
    const receipt = payment.status === 'completed' ? { receipt_id: String(payment._id), violation_id: payment.violation_id,
        amount_minor: payment.amount_minor, currency: payment.currency, method: payment.method, reference: payment.reference,
        actor_id: payment.actor_id, settled_at: payment.settled_at } : null;
    return { payment: safe, receipt };
}
async function finish(paymentId, { capture, requestId } = {}, session) {
    const payment = await Payment.findById(paymentId).session(session);
    if (payment.status === 'completed') return payment;
    const violation = await Violation.findOne({ _id: payment.violation_id, status: 'unpaid', collection_payment: payment._id }).session(session);
    if (!violation) throw new AppError(409, 'SETTLEMENT_CONFLICT', 'Collection reservation requires review.');
    payment.status = 'completed'; payment.phase = 'settled'; payment.settled_at = new Date(); payment.operation_lock = null;
    if (capture) { payment.provider_capture_id = capture.capture_id; payment.reference = capture.capture_id; payment.reason = 'Verified sandbox capture'; }
    await payment.save({ session });
    violation.status = 'paid'; await violation.save({ session });
    await AuditEvent.create([{ event: 'payment.settled', payment_id: payment._id, violation_id: payment.violation_id, actor_id: payment.actor_id,
        amount_minor: payment.amount_minor, currency: payment.currency, method: payment.method, reference: payment.reference,
        reason: payment.reason, request_id: requestId }], { session });
    return payment;
}
async function settleManual({ violationId, actor, key, body, requestId }) {
    requireId(violationId); bodyFields(body, ['method', 'reference', 'reason']);
    if (!['admin', 'officer'].includes(actor.role)) throw new AppError(403, 'FORBIDDEN', 'Manual settlement requires an officer or administrator.');
    if (!['cash', 'bank_transfer'].includes(body.method)) throw new AppError(400, 'VALIDATION_ERROR', 'Select cash or bank_transfer.');
    const payload = { violationId, method: body.method, reference: text(body.reference, 'reference'), reason: text(body.reason, 'reason') };
    const info = keyInfo(actor, 'manual', key, payload);
    const payment = await transaction(async session => {
        const existing = await replay(info, session); if (existing) return existing;
        const violation = await loadViolation(violationId, actor, session);
        if (violation.status !== 'unpaid' || violation.collection_payment || await Payment.exists({ violation_id: violationId }).session(session)) throw new AppError(409, 'COLLECTION_RESERVED', 'An existing collection or settlement must be reconciled first.');
        const [created] = await Payment.create([{ violation_id: violation._id, citizen_id: violation.user, actor_id: actor._id,
            ...recordMoney(violation), method: payload.method, reference: payload.reference, reason: payload.reason, status: 'pending' }], { session });
        violation.collection_payment = created._id; await violation.save({ session });
        await IdempotencyRecord.create([{ ...info, payment_id: created._id }], { session });
        return finish(created._id, { requestId }, session);
    });
    return { ...result(payment), violation: await Violation.findById(payment.violation_id).lean() };
}
function configured(adapter) {
    adapter ||= getDefaultAdapter();
    if (!adapter.configuration().available) throw new AppError(503, 'PAYMENTS_UNAVAILABLE', 'Sandbox payments are not configured.');
    return adapter;
}
function verifyOrder(order, payment) {
    if (!order || order.id !== payment.provider_order_id || order.invoice_id !== String(payment._id) || order.violation_id !== String(payment.violation_id) || order.recipient !== payment.recipient || order.amount_minor !== payment.amount_minor || order.currency !== payment.currency) throw new AppError(502, 'PROVIDER_MISMATCH', 'Sandbox payment verification failed; collection remains reserved.');
    if (order.status === 'COMPLETED' && (!order.capture_id || order.capture_status !== 'COMPLETED' || order.final_capture === false)) throw new AppError(502, 'PROVIDER_MISMATCH', 'Sandbox capture is not a final completed payment.');
}
async function reconcilePayment(payment, adapter, requestId) {
    if (payment.status === 'completed' || !payment.provider_order_id) return payment;
    const order = await adapter.getOrder(payment.provider_order_id);
    verifyOrder(order, payment);
    if (order.status === 'COMPLETED') return transaction(session => finish(payment._id, { capture: order, requestId }, session));
    // Only authoritative terminal states may label an attempt failed/cancelled.
    if (['VOIDED', 'DENIED'].includes(order.status)) {
        const updated = await Payment.findOneAndUpdate({ _id: payment._id, status: { $ne: 'completed' } }, { $set: { status: order.status === 'VOIDED' ? 'cancelled' : 'failed', phase: 'review' } }, { returnDocument: 'after' });
        payment = updated || await Payment.findById(payment._id);
    }
    return payment;
}
async function createOrder({ actor, key, body, adapter, requestId }) {
    bodyFields(body, ['violation_id']); requireId(body.violation_id);
    const info = keyInfo(actor, 'order', key, { violation_id: body.violation_id });
    adapter = configured(adapter);
    let created = false;
    let payment = await transaction(async session => {
        created = false;
        // Re-authorize even a replay if the caller's current role has changed.
        const violation = await loadViolation(body.violation_id, actor, session);
        const previous = await replay(info, session); if (previous) return previous;
        if (violation.status !== 'unpaid') throw new AppError(409, 'ALREADY_SETTLED', 'Violation is not eligible for collection.');
        const money = recordMoney(violation);
        if (!adapter.currencies.includes(money.currency)) throw new AppError(409, 'UNSUPPORTED_CURRENCY', 'Sandbox checkout is unavailable for this currency. Existing money is preserved.');
        let selected = await Payment.findOne({ violation_id: violation._id }).session(session);
        if (selected && selected.method !== 'paypal') throw new AppError(409, 'COLLECTION_RESERVED', 'Collection is already reserved.');
        if (!selected) {
            [selected] = await Payment.create([{ violation_id: violation._id, citizen_id: violation.user, actor_id: actor._id, ...money,
                method: 'paypal', recipient: adapter.recipient, status: 'pending', phase: 'order' }], { session });
            created = true;
            const reserved = await Violation.updateOne({ _id: violation._id, status: 'unpaid', collection_payment: null }, { $set: { collection_payment: selected._id } }, { session });
            if (reserved.modifiedCount !== 1) throw new AppError(409, 'COLLECTION_RESERVED', 'Collection is already reserved.');
        }
        await IdempotencyRecord.create([{ ...info, payment_id: selected._id }], { session });
        return selected;
    });
    if (payment.provider_order_id || payment.status !== 'pending') return { ...result(payment), created };
    // Creating a new order after PayPal's minimum 6h retention would be ambiguous.
    if (payment.order_started_at && Date.now() - payment.order_started_at.getTime() >= 6 * 3600000) throw new AppError(409, 'RECONCILIATION_REQUIRED', 'The uncertain order requires operator reconciliation.');
    const now = new Date();
    const leased = await Payment.findOneAndUpdate({ _id: payment._id, provider_order_id: { $exists: false }, $or: [{ operation_lock: null }, { operation_lock: { $lt: now } }] }, { $set: { operation_lock: new Date(Date.now() + 30000), order_started_at: payment.order_started_at || now } }, { returnDocument: 'after' });
    if (!leased) return { ...result(await Payment.findById(payment._id)), created };
    try {
        const order = await adapter.createOrder(leased);
        verifyOrder(order, { ...leased.toObject(), provider_order_id: order.id });
        payment = await Payment.findOneAndUpdate({ _id: payment._id, provider_order_id: { $exists: false } }, { $set: { provider_order_id: order.id, approval_url: order.approval_url, phase: 'approval', operation_lock: null } }, { returnDocument: 'after' });
        if (!payment) payment = await Payment.findById(leased._id);
        if (order.status === 'COMPLETED') payment = await reconcilePayment(payment, adapter, requestId);
        return { ...result(payment), created };
    } catch (error) {
        await Payment.updateOne({ _id: leased._id, status: 'pending' }, { $set: { operation_lock: null } });
        throw error instanceof AppError ? error : new AppError(502, 'PROVIDER_UNCERTAIN', 'Order outcome is pending. Retry with the same key.');
    }
}
async function captureOrder({ actor, key, orderId, body = {}, adapter, requestId }) {
    bodyFields(body, []);
    if (typeof orderId !== 'string' || !/^[A-Za-z0-9-]{3,80}$/.test(orderId)) throw new AppError(400, 'INVALID_ORDER', 'Invalid order identifier.');
    const info = keyInfo(actor, 'capture', key, { orderId });
    adapter = configured(adapter);
    let payment = await Payment.findOne({ provider_order_id: orderId, ...scope(actor) });
    if (!payment) throw new AppError(404, 'NOT_FOUND', 'Payment not found.');
    await transaction(async session => {
        const existing = await replay(info, session);
        if (!existing) await IdempotencyRecord.create([{ ...info, payment_id: payment._id }], { session });
    });
    payment = await reconcilePayment(payment, adapter, requestId);
    if (payment.status !== 'pending') return result(payment);
    // An uncertain capture older than the provider retention window is READ-only.
    if (payment.capture_started_at && Date.now() - payment.capture_started_at.getTime() >= 6 * 3600000) return result(payment);
    const leased = await Payment.findOneAndUpdate({ _id: payment._id, status: 'pending', $or: [{ operation_lock: null }, { operation_lock: { $lt: new Date() } }] }, { $set: { phase: 'capture', capture_started_at: payment.capture_started_at || new Date(), operation_lock: new Date(Date.now() + 30000) } }, { returnDocument: 'after' });
    if (!leased) return result(await Payment.findById(payment._id));
    try {
        const order = await adapter.captureOrder(orderId, String(payment._id));
        verifyOrder(order, payment);
        if (order.status === 'COMPLETED') payment = await transaction(session => finish(payment._id, { capture: order, requestId }, session));
        else payment = await Payment.findById(payment._id);
    } catch (error) {
        // The provider may already have collected; keep the durable reservation.
        try { payment = await reconcilePayment(await Payment.findById(payment._id), adapter, requestId); }
        catch { throw error instanceof AppError ? error : new AppError(502, 'PROVIDER_UNCERTAIN', 'Capture outcome is pending. Check server status.'); }
        if (payment.status !== 'completed') throw error instanceof AppError ? error : new AppError(502, 'PROVIDER_UNCERTAIN', 'Capture outcome is pending. Check server status.');
    } finally { await Payment.updateOne({ _id: payment._id }, { $set: { operation_lock: null } }); }
    return result(payment);
}
async function getPayment({ id, actor, adapter, reconcile = false, requestId }) {
    requireId(id);
    let payment = await Payment.findOne({ _id: id, ...scope(actor) });
    if (!payment) throw new AppError(404, 'NOT_FOUND', 'Payment not found.');
    if (reconcile && payment.method === 'paypal') payment = await reconcilePayment(payment, configured(adapter), requestId);
    return result(payment);
}
async function processWebhook(event, adapter) {
    if (event.state !== 'received') return;
    if (!event.order_id) { event.state = 'ignored'; event.processed_at = new Date(); await event.save(); return; }
    const payment = await Payment.findOne({ provider_order_id: event.order_id });
    if (!payment) return; // Durable inbox remains retryable if local order persistence is delayed.
    await reconcilePayment(payment, adapter);
    event.state = 'processed'; event.processed_at = new Date(); await event.save();
}
async function receiveWebhook({ headers, rawBody, adapter }) {
    adapter = configured(adapter);
    const received = await adapter.verifyWebhook({ headers, rawBody });
    if (typeof received.id !== 'string' || received.id.length > 128 || typeof received.event_type !== 'string' || received.event_type.length > 128) throw new AppError(400, 'INVALID_WEBHOOK', 'Invalid webhook identity.');
    const orderId = received.resource?.supplementary_data?.related_ids?.order_id || (received.event_type.startsWith('CHECKOUT.ORDER.') ? received.resource?.id : undefined);
    if (orderId && (typeof orderId !== 'string' || !/^[A-Za-z0-9-]{3,80}$/.test(orderId))) throw new AppError(400, 'INVALID_WEBHOOK', 'Invalid order mapping.');
    let event;
    try { event = await WebhookEvent.findOneAndUpdate({ event_id: received.id }, { $setOnInsert: { event_type: received.event_type, order_id: orderId, state: 'received' } }, { upsert: true, returnDocument: 'after', runValidators: true }); }
    catch (error) { if (error.code !== 11000) throw error; event = await WebhookEvent.findOne({ event_id: received.id }); }
    // Processing failures return a retryable HTTP error AFTER durable receipt.
    await processWebhook(event, adapter);
    return { accepted: true };
}
async function retryWebhooks(adapter = getDefaultAdapter()) {
    for (const event of await WebhookEvent.find({ state: 'received' }).limit(100)) await processWebhook(event, configured(adapter));
}
module.exports = { settleManual, createOrder, captureOrder, getPayment, receiveWebhook, retryWebhooks, result, verifyOrder, config: adapter => (adapter || getDefaultAdapter()).configuration() };
