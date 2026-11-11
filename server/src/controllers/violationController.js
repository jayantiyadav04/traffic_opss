const User = require('../models/User');
const Violation = require('../models/Violation');
const ViolationType = require('../models/ViolationType');
const Area = require('../models/Area');
const mongoose = require('mongoose');
const IdentityReview = require('../models/IdentityReview');
const AppError = require('../utils/AppError');
const v = require('../utils/validation');
const { recordMoney } = require('../utils/money');
const { listQuery, scopeFor } = require('../utils/violationQuery');
const expose = (record) => {
    const item = record.toObject ? record.toObject() : { ...record };
    item.payment_id = item.collection_payment ? String(item.collection_payment) : null;
    delete item.collection_payment;
    return { ...item, ...recordMoney(item) };
};
const createViolation = async (req, res) => {
    v.fields(req.body, ['citizen_id', 'vehicle_number', 'violation_type', 'area', 'notes']);
    const citizenId = v.id(req.body.citizen_id, 'citizen_id');
    const typeId = v.id(req.body.violation_type, 'violation_type'); const areaId = v.id(req.body.area, 'area');
    const vehicle = v.text(req.body.vehicle_number, 'vehicle_number', { min: 3, max: 20 }).toUpperCase().replace(/\s/g, '');
    if (!/^[A-Z0-9-]{3,20}$/.test(vehicle)) v.invalid('vehicle_number');
    const notes = v.text(req.body.notes, 'notes', { max: 2000, min: 0, optional: true });
    const [citizen, type, area] = await Promise.all([
        User.findOne({ _id: citizenId, role: 'citizen', onboarding_status: 'verified' }), ViolationType.findById(typeId), Area.findById(areaId),
    ]);
    if (!citizen) throw new AppError(400, 'INVALID_REFERENCE', 'Choose a verified citizen account.');
    if (!type || !area) throw new AppError(400, 'INVALID_REFERENCE', 'Choose an existing violation type and area.');
    const money = recordMoney(type);
    const violation = await Violation.create({
        vehicle_number: vehicle, owner_name: citizen.full_name, user: citizen._id, ownership_verified: true,
        violation_type: type._id, area: area._id, officer: req.user._id, notes,
        ...money, schema_version: 2, policy_version: type.policy_version || 1,
        ...(money.currency === 'INR' ? { fine_amount: money.amount_minor / 100 } : {}),
    });
    res.status(201).json(expose(violation));
};
const getViolations = async (req, res) => {
    const { query, limit, encode } = listQuery(req.user, req.query);
    const records = await Violation.find(query).sort({ createdAt: -1, _id: -1 }).limit(limit + 1)
        .populate('officer', 'username full_name').populate('violation_type', 'type_name base_fine amount_minor currency policy_version').populate('area', 'area_name city');
    const hasMore = records.length > limit;
    const items = records.slice(0, limit);
    res.json({ items: items.map(expose), page: { limit, hasMore, nextCursor: hasMore ? encode(items[items.length - 1]) : null } });
};
const getViolation = async (req, res) => {
    v.id(req.params.id);
    const record = await Violation.findOne({ ...scopeFor(req.user), _id: req.params.id })
        .populate('officer', 'username full_name').populate('violation_type', 'type_name').populate('area', 'area_name city');
    if (!record) throw new AppError(404, 'NOT_FOUND', 'Violation not found.');
    res.json(expose(record));
};
const getViolationTypes = async (req, res) => res.json((await ViolationType.find({}).sort({ type_name: 1 })).map(expose));
const getAreas = async (req, res) => res.json(await Area.find({}).sort({ area_name: 1 }));
const markViolationAsPaid = async (req, res) => {
    const result = await require('../services/paymentService').settleManual({ violationId: req.params.id, actor: req.user, key: req.get('Idempotency-Key'), body: req.body, requestId: req.requestId });
    res.json(result);
};
const reviewOwnership = async (req, res) => {
    v.id(req.params.id);
    v.fields(req.body, ['citizen_id', 'reference']);
    const citizenId = v.id(req.body.citizen_id, 'citizen_id');
    const reference = v.text(req.body.reference, 'reference', { min: 3, max: 120 });
    let result;
    await mongoose.connection.transaction(async (session) => {
        const citizen = await User.findOne({ _id: citizenId, role: 'citizen', onboarding_status: 'verified' }).session(session);
        if (!citizen) throw new AppError(400, 'INVALID_REFERENCE', 'Choose a verified citizen account.');
        const violation = await Violation.findById(req.params.id).session(session);
        if (!violation) throw new AppError(404, 'NOT_FOUND', 'Violation not found.');
        if (violation.ownership_verified) throw new AppError(409, 'OWNERSHIP_ALREADY_VERIFIED', 'Verified ownership cannot be reassigned through this review.');
        if (violation.schema_version !== 2) throw new AppError(409, 'MIGRATION_REQUIRED', 'Migrate legacy money before reviewing ownership.');
        await IdentityReview.create([{ violation_id: violation._id, prior_user_id: violation.user, citizen_id: citizen._id, actor_id: req.user._id, reference, reviewed_at: new Date() }], { session });
        violation.user = citizen._id;
        violation.ownership_verified = true;
        await violation.save({ session });
        result = expose(violation);
    });
    res.json(result);
};
module.exports = { createViolation, getViolations, getViolation, getViolationTypes, getAreas, markViolationAsPaid, reviewOwnership };
