const mongoose = require('mongoose');
const { MAX_MINOR } = require('../utils/money');
const schema = new mongoose.Schema({
    violation_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Violation', required: true, unique: true, immutable: true },
    citizen_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    actor_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    amount_minor: { type: Number, required: true, min: 1, max: MAX_MINOR, validate: Number.isSafeInteger, immutable: true },
    currency: { type: String, required: true, enum: ['INR', 'USD', 'EUR', 'GBP', 'JPY'], immutable: true },
    method: { type: String, enum: ['cash', 'bank_transfer', 'paypal'], required: true, immutable: true },
    status: { type: String, enum: ['pending', 'completed', 'failed', 'cancelled'], default: 'pending', required: true },
    phase: { type: String, enum: ['order', 'approval', 'capture', 'settled', 'review'], default: 'order' },
    provider_order_id: { type: String },
    provider_capture_id: { type: String },
    recipient: { type: String },
    approval_url: String,
    operation_lock: { type: Date },
    order_started_at: Date,
    capture_started_at: Date,
    reference: String,
    reason: String,
    settled_at: Date,
}, { timestamps: true });
schema.index({ provider_order_id: 1 }, { unique: true, partialFilterExpression: { provider_order_id: { $type: 'string' } } });
schema.index({ provider_capture_id: 1 }, { unique: true, partialFilterExpression: { provider_capture_id: { $type: 'string' } } });
module.exports = mongoose.model('Payment', schema);
