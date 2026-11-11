const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const Violation = require('../src/models/Violation');
const Payment = require('../src/models/Payment');
const AuditEvent = require('../src/models/AuditEvent');
const IdempotencyRecord = require('../src/models/IdempotencyRecord');
const WebhookEvent = require('../src/models/WebhookEvent');
const service = require('../src/services/paymentService');
const { PayPalSandbox } = require('../src/providers/paypal');
const { decimalToMinor, validateMoney, formatMinor } = require('../src/utils/money');
const { migrateMoney } = require('../migrations/money-v2');
const Provider = require('./helpers/deterministicProvider');
const { startDatabase, clearDatabase, stopDatabase } = require('./helpers');

let officer, citizen, other, adapter;
before(async () => { await startDatabase(); }, { timeout: 180000 });
after(async () => { await stopDatabase(); });
beforeEach(async () => {
    await clearDatabase();
    officer = { _id: new mongoose.Types.ObjectId(), role: 'officer' };
    citizen = { _id: new mongoose.Types.ObjectId(), role: 'citizen' };
    other = { _id: new mongoose.Types.ObjectId(), role: 'citizen' };
    adapter = new Provider();
});
async function fixture(currency = 'USD') {
    return Violation.create({ vehicle_number: 'SYNTHETIC01', owner_name: 'Synthetic Citizen', user: citizen._id,
        officer: officer._id, violation_type: new mongoose.Types.ObjectId(), area: new mongoose.Types.ObjectId(),
        amount_minor: 1250, currency, schema_version: 2, policy_version: 1, ownership_verified: true });
}
const manualBody = () => ({ method: 'cash', reference: 'SYNTHETIC-REF', reason: 'Synthetic test settlement' });
async function order(violation, key = 'synthetic-order-key') {
    return service.createOrder({ actor: citizen, key, body: { violation_id: String(violation._id) }, adapter });
}
function webhook(orderId, id = 'SYNTHETIC-EVENT', type = 'PAYMENT.CAPTURE.COMPLETED') {
    const rawBody = Buffer.from(JSON.stringify({ id, event_type: type, resource: { supplementary_data: { related_ids: { order_id: orderId } } } }));
    return { rawBody, headers: { 'x-synthetic-signature': crypto.createHash('sha256').update(rawBody).digest('hex') }, adapter };
}

test('money conversion is exact and explicitly handles currency exponents', () => {
    assert.equal(decimalToMinor('12.50', 'INR'), 1250);
    assert.equal(decimalToMinor('1250', 'JPY'), 1250);
    assert.equal(formatMinor(1250, 'USD'), '12.50');
    for (const value of ['1.001', '-1', 'NaN', 'Infinity', '0', {}, '100000000000000000000']) assert.throws(() => decimalToMinor(value, 'INR'));
    for (const amount of [0, -1, 1.1, Number.MAX_SAFE_INTEGER]) assert.throws(() => validateMoney(amount, 'USD'));
    assert.throws(() => validateMoney(100, 'FAKE'));
});
test('legacy INR migration dry run is read-only, rejects extra precision, and apply is repeatable', async () => {
    const collection = mongoose.connection.collection('violations');
    await collection.insertMany([{ fine_amount: 12.50 }, { fine_amount: 1.001 }, { fine_amount: -1 },
        { fine_amount: 12.50, amount_minor: null, currency: null }, { fine_amount: 12.50, amount_minor: null }]);
    const beforeRows = await collection.find({}).toArray();
    const dry = await migrateMoney();
    assert.equal(dry.eligible, 1); assert.equal(dry.invalid.length, 4); assert.equal(dry.migrated, 0);
    assert.deepEqual(await collection.find({}).toArray(), beforeRows);
    const applied = await migrateMoney({ dryRun: false }); assert.equal(applied.migrated, 1);
    const migrated = await collection.findOne({ amount_minor: 1250 });
    assert.equal(migrated.currency, 'INR'); assert.equal(migrated.ownership_verified, false);
    assert.equal(migrated.fine_amount, 12.5);
    assert.equal((await migrateMoney({ dryRun: false })).migrated, 0);
});
test('manual settlement is atomic, auditable and returns the same receipt on replay', async () => {
    const violation = await fixture('INR');
    const args = { violationId: String(violation._id), actor: officer, key: 'synthetic-manual-key', body: manualBody(), requestId: 'synthetic-request' };
    const first = await service.settleManual(args); const retry = await service.settleManual(args);
    assert.equal(String(first.payment._id), String(retry.payment._id)); assert.deepEqual(first.receipt, retry.receipt);
    assert.equal((await Violation.findById(violation._id)).status, 'paid');
    assert.equal(await Payment.countDocuments(), 1); assert.equal(await AuditEvent.countDocuments(), 1);
    assert.equal((await AuditEvent.findOne()).request_id, 'synthetic-request');
    await assert.rejects(service.settleManual({ ...args, body: { ...manualBody(), reference: 'DIFFERENT-REF' } }), { code: 'IDEMPOTENCY_CONFLICT' });
});
test('competing manual requests settle once, with one audit and one receipt', async () => {
    const violation = await fixture();
    const replies = await Promise.allSettled(Array.from({ length: 8 }, (_, index) => service.settleManual({ violationId: String(violation._id), actor: officer, key: `synthetic-manual-${index}`, body: manualBody() })));
    assert.equal(replies.filter(reply => reply.status === 'fulfilled').length, 1);
    for (const reply of replies.filter(reply => reply.status === 'rejected')) assert.equal(reply.reason.status, 409);
    assert.equal(await Payment.countDocuments({ status: 'completed' }), 1); assert.equal(await AuditEvent.countDocuments(), 1);
});
test('a failed audit write rolls back the payment, violation and idempotency record', async t => {
    const violation = await fixture();
    t.mock.method(AuditEvent, 'create', async () => { throw new Error('Synthetic audit failure'); });
    await assert.rejects(service.settleManual({ violationId: String(violation._id), actor: officer, key: 'synthetic-rollback-key', body: manualBody() }));
    assert.equal(await Payment.countDocuments(), 0); assert.equal(await IdempotencyRecord.countDocuments(), 0);
    assert.equal((await Violation.findById(violation._id)).status, 'unpaid');
    assert.equal((await Violation.findById(violation._id)).collection_payment, null);
});
test('ownership, role, authoritative amount and idempotency validation cannot be bypassed', async () => {
    const violation = await fixture();
    await assert.rejects(service.createOrder({ actor: other, key: 'synthetic-cross-owner', body: { violation_id: String(violation._id) }, adapter }), { status: 404 });
    await assert.rejects(service.settleManual({ violationId: String(violation._id), actor: citizen, key: 'synthetic-role-denial', body: manualBody() }), { status: 403 });
    await assert.rejects(service.createOrder({ actor: citizen, key: 'synthetic-tampering', body: { violation_id: String(violation._id), amount_minor: 1 }, adapter }), { status: 400 });
    await assert.rejects(service.createOrder({ actor: citizen, key: '', body: { violation_id: String(violation._id) }, adapter }), { status: 400 });
    assert.equal(await Payment.countDocuments(), 0);
});
test('missing configuration and unsupported INR never create a collection reservation', async () => {
    const violation = await fixture('INR');
    await assert.rejects(service.createOrder({ actor: citizen, key: 'synthetic-unavailable', body: { violation_id: String(violation._id) }, adapter: new PayPalSandbox({}) }), { status: 503 });
    await assert.rejects(order(violation), { code: 'UNSUPPORTED_CURRENCY' });
    assert.equal(await Payment.countDocuments(), 0); assert.equal((await Violation.findById(violation._id)).currency, 'INR');
});
test('different keys share one durable order and concurrent captures collect externally once', async () => {
    const violation = await fixture();
    const replies = await Promise.all(Array.from({ length: 6 }, (_, index) => order(violation, `synthetic-order-${index}`)));
    const paymentId = String(replies[0].payment._id);
    for (const reply of replies) assert.equal(String(reply.payment._id), paymentId);
    const ready = await order(violation, 'synthetic-ready-key');
    await Promise.all(Array.from({ length: 6 }, (_, index) => service.captureOrder({ actor: citizen, orderId: ready.payment.provider_order_id, key: `synthetic-capture-${index}`, adapter })));
    assert.equal(adapter.createCalls, 1); assert.equal(adapter.collections, 1); assert.equal(await Payment.countDocuments(), 1);
    assert.equal(await AuditEvent.countDocuments(), 1); assert.equal((await Violation.findById(violation._id)).status, 'paid');
    await assert.rejects(service.getPayment({ id: paymentId, actor: other }), { status: 404 });
});
test('an uncertain order is retried with the same provider identity and blocks manual collection', async () => {
    const violation = await fixture(); adapter.mode = 'create-timeout';
    await assert.rejects(order(violation));
    await assert.rejects(service.settleManual({ violationId: String(violation._id), actor: officer, key: 'synthetic-competing-manual', body: manualBody() }), { status: 409 });
    adapter.mode = 'success'; const ready = await order(violation);
    assert.ok(ready.payment.provider_order_id); assert.equal(adapter.createCalls, 1);
});
test('manual and provider collection racing from an unpaid record share one reservation', async () => {
    const violation = await fixture();
    const replies = await Promise.allSettled([
        order(violation, 'synthetic-provider-race'),
        service.settleManual({ violationId: String(violation._id), actor: officer, key: 'synthetic-manual-race', body: manualBody() }),
    ]);
    assert.equal(replies.filter(reply => reply.status === 'fulfilled').length, 1);
    const payment = await Payment.findOne();
    if (payment.method === 'paypal') {
        const ready = await order(violation, 'synthetic-provider-race');
        await service.captureOrder({ actor: citizen, key: 'synthetic-race-capture', orderId: ready.payment.provider_order_id, adapter });
        assert.equal(adapter.collections, 1);
    } else assert.equal(adapter.collections, 0);
    assert.equal(await Payment.countDocuments(), 1); assert.equal(await AuditEvent.countDocuments(), 1);
    assert.equal((await Violation.findById(violation._id)).status, 'paid');
});
test('order replay rechecks current ownership after a privileged actor changes role', async () => {
    const violation = await fixture();
    await service.createOrder({ actor: officer, key: 'synthetic-role-replay', body: { violation_id: String(violation._id) }, adapter });
    await assert.rejects(service.createOrder({ actor: { ...officer, role: 'citizen' }, key: 'synthetic-role-replay', body: { violation_id: String(violation._id) }, adapter }), { status: 404 });
});
test('uncertain order past provider retention is held for review instead of creating another order', async () => {
    const violation = await fixture(); adapter.mode = 'create-timeout'; await assert.rejects(order(violation));
    await Payment.updateOne({}, { $set: { order_started_at: new Date(Date.now() - 7 * 3600000) } });
    adapter.mode = 'success'; await assert.rejects(order(violation), { code: 'RECONCILIATION_REQUIRED' }); assert.equal(adapter.createCalls, 1);
});
test('capture success followed by a timeout reconciles to a single persisted settlement', async () => {
    const violation = await fixture(); const ready = await order(violation); adapter.mode = 'capture-timeout';
    const paid = await service.captureOrder({ actor: citizen, key: 'synthetic-timeout-key', orderId: ready.payment.provider_order_id, adapter });
    assert.equal(paid.payment.status, 'completed'); assert.equal(adapter.collections, 1); assert.equal(await AuditEvent.countDocuments(), 1);
});
test('provider success and local transaction failure recover on retry without a second collection', async t => {
    const violation = await fixture(); const ready = await order(violation);
    t.mock.method(AuditEvent, 'create', async () => { throw new Error('Synthetic persistence crash'); });
    await assert.rejects(service.captureOrder({ actor: citizen, key: 'synthetic-crash-key', orderId: ready.payment.provider_order_id, adapter }));
    assert.equal(adapter.collections, 1); assert.equal((await Payment.findOne()).status, 'pending'); assert.equal((await Violation.findById(violation._id)).status, 'unpaid');
    t.mock.restoreAll();
    const retry = await service.captureOrder({ actor: citizen, key: 'synthetic-crash-key', orderId: ready.payment.provider_order_id, adapter });
    assert.equal(retry.payment.status, 'completed'); assert.equal(adapter.collections, 1); assert.equal(await AuditEvent.countDocuments(), 1);
});
test('mismatched amount, currency, recipient and association fail before collection', async () => {
    const violation = await fixture(); const ready = await order(violation);
    for (const mode of ['wrong-amount', 'wrong-currency', 'wrong-recipient', 'wrong-owner']) {
        adapter.mode = mode;
        await assert.rejects(service.captureOrder({ actor: citizen, key: `synthetic-${mode}`, orderId: ready.payment.provider_order_id, adapter }), { code: 'PROVIDER_MISMATCH' });
    }
    assert.equal(adapter.collections, 0); assert.equal(await AuditEvent.countDocuments(), 0);
});
test('declines and pending provider states never create paid receipts', async () => {
    const violation = await fixture(); const ready = await order(violation); adapter.mode = 'decline';
    await assert.rejects(service.captureOrder({ actor: citizen, key: 'synthetic-decline-key', orderId: ready.payment.provider_order_id, adapter }));
    adapter.mode = 'pending'; const pending = await service.captureOrder({ actor: citizen, key: 'synthetic-pending-key', orderId: ready.payment.provider_order_id, adapter });
    assert.equal(pending.payment.status, 'pending'); assert.equal(pending.receipt, null); assert.equal(adapter.collections, 0);
});
test('authoritative cancellation stays unpaid and keeps collection reserved for review', async () => {
    const violation = await fixture(); const ready = await order(violation);
    adapter.orders.get(ready.payment.provider_order_id).status = 'VOIDED';
    const cancelled = await service.getPayment({ id: String(ready.payment._id), actor: citizen, adapter, reconcile: true });
    assert.equal(cancelled.payment.status, 'cancelled'); assert.equal(cancelled.receipt, null); assert.equal((await Violation.findById(violation._id)).status, 'unpaid');
});
test('verified webhook receipt is durable, duplicate/out-of-order delivery cannot settle twice', async () => {
    const violation = await fixture(); const ready = await order(violation); await adapter.captureOrder(ready.payment.provider_order_id);
    const event = webhook(ready.payment.provider_order_id);
    assert.deepEqual(await service.receiveWebhook(event), { accepted: true }); await service.receiveWebhook(event);
    await service.receiveWebhook(webhook(ready.payment.provider_order_id, 'SYNTHETIC-OLDER', 'PAYMENT.CAPTURE.PENDING'));
    assert.equal(await WebhookEvent.countDocuments(), 2); assert.equal(await AuditEvent.countDocuments(), 1); assert.equal(adapter.collections, 1);
    assert.equal((await Payment.findOne()).status, 'completed');
});
test('forged webhooks and inbox persistence failure cannot be acknowledged as accepted', async t => {
    const event = webhook('UNKNOWN-SYNTHETIC');
    await assert.rejects(service.receiveWebhook({ ...event, headers: {} }), { code: 'INVALID_SIGNATURE' });
    t.mock.method(WebhookEvent, 'findOneAndUpdate', async () => { throw new Error('Synthetic inbox failure'); });
    await assert.rejects(service.receiveWebhook(event)); assert.equal(await WebhookEvent.countDocuments(), 0);
});
test('received-but-unprocessed webhook survives a crash and can be retried', async t => {
    const violation = await fixture(); const ready = await order(violation); await adapter.captureOrder(ready.payment.provider_order_id);
    t.mock.method(AuditEvent, 'create', async () => { throw new Error('Synthetic local crash'); });
    await assert.rejects(service.receiveWebhook(webhook(ready.payment.provider_order_id)));
    assert.equal((await WebhookEvent.findOne()).state, 'received'); assert.equal((await Payment.findOne()).status, 'pending');
    t.mock.restoreAll(); await service.retryWebhooks(adapter);
    assert.equal((await WebhookEvent.findOne()).state, 'processed'); assert.equal((await Payment.findOne()).status, 'completed'); assert.equal(await AuditEvent.countDocuments(), 1);
});
