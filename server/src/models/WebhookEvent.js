const mongoose = require('mongoose');
const schema = new mongoose.Schema({
    event_id: { type: String, required: true, unique: true },
    event_type: { type: String, required: true },
    order_id: String,
    state: { type: String, enum: ['received', 'processed', 'ignored'], default: 'received' },
    processed_at: Date,
}, { timestamps: true });
// Persist only verified, allowlisted routing metadata; no payer data or raw payload.
module.exports = mongoose.model('WebhookEvent', schema);
