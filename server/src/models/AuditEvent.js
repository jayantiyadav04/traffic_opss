const mongoose = require('mongoose');
const schema = new mongoose.Schema({
    event: { type: String, required: true },
    payment_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', required: true },
    violation_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Violation', required: true },
    actor_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amount_minor: { type: Number, required: true }, currency: { type: String, required: true },
    method: { type: String, required: true }, reference: { type: String, required: true }, reason: { type: String, required: true },
    request_id: String,
}, { timestamps: { createdAt: true, updatedAt: false } });
schema.index({ payment_id: 1, event: 1 }, { unique: true });
module.exports = mongoose.model('AuditEvent', schema);
