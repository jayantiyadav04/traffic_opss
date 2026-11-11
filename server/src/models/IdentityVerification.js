const mongoose = require('mongoose');
const schema = new mongoose.Schema({
    citizen_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    actor_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reference: { type: String, required: true, maxlength: 120 },
    verified_at: { type: Date, required: true },
}, { timestamps: true });
module.exports = mongoose.model('IdentityVerification', schema);
