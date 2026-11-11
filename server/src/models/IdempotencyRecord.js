const mongoose = require('mongoose');
const schema = new mongoose.Schema({
    actor_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    operation: { type: String, required: true }, key: { type: String, required: true },
    fingerprint: { type: String, required: true },
    payment_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', required: true },
}, { timestamps: true });
// No TTL: retries must not become new collections after a provider retention window.
schema.index({ actor_id: 1, operation: 1, key: 1 }, { unique: true });
module.exports = mongoose.model('IdempotencyRecord', schema);
