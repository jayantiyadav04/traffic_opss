const mongoose = require('mongoose');
const violationTypeSchema = new mongoose.Schema({
    type_name: { type: String, required: true, unique: true, maxlength: 100 },
    base_fine: { type: Number, min: 0 },
    amount_minor: { type: Number, min: 1, max: 1e12, validate: Number.isSafeInteger },
    currency: { type: String, enum: ['INR', 'USD', 'EUR', 'GBP', 'JPY'] },
    policy_version: { type: Number, default: 1, min: 1 },
}, { timestamps: true });
violationTypeSchema.pre('validate', function () {
    if (this.amount_minor !== undefined && !this.currency) this.invalidate('currency', 'Currency is required with minor units.');
    if (this.amount_minor === undefined && this.base_fine === undefined) this.invalidate('amount_minor', 'A fine policy is required.');
});
module.exports = mongoose.model('ViolationType', violationTypeSchema);
