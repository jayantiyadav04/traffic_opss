const mongoose = require('mongoose');
const schema = new mongoose.Schema({
    violation_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Violation', required: true, unique: true },
    prior_user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    citizen_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    actor_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reference: { type: String, required: true, maxlength: 120 },
    reviewed_at: { type: Date, required: true },
}, { timestamps: true });
module.exports = mongoose.model('IdentityReview', schema);
