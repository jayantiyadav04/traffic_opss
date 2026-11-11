const mongoose = require('mongoose');
const violationSchema = new mongoose.Schema({
    vehicle_number: { type: String, required: true, maxlength: 20 },
    owner_name: { type: String, required: true, maxlength: 100 },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    ownership_verified: { type: Boolean, default: false },
    violation_type: { type: mongoose.Schema.Types.ObjectId, ref: 'ViolationType', required: true },
    area: { type: mongoose.Schema.Types.ObjectId, ref: 'Area', required: true },
    officer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    violation_date: { type: Date, default: Date.now },
    fine_amount: { type: Number, min: 0 },
    amount_minor: { type: Number, min: 1, max: 1e12, validate: Number.isSafeInteger },
    currency: { type: String, enum: ['INR', 'USD', 'EUR', 'GBP', 'JPY'] },
    schema_version: { type: Number, enum: [1, 2], default: 1 },
    policy_version: { type: Number, min: 1 },
    status: { type: String, enum: ['unpaid', 'paid', 'disputed'], default: 'unpaid' },
    notes: { type: String, maxlength: 2000 },
    collection_payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: null },
}, { timestamps: true });
violationSchema.pre('validate', function () {
    if (this.schema_version === 2 && (!Number.isSafeInteger(this.amount_minor) || !this.currency)) this.invalidate('amount_minor', 'Version 2 requires integer money and currency.');
});
violationSchema.index({ createdAt: -1, _id: -1 });
violationSchema.index({ user: 1, ownership_verified: 1, createdAt: -1, _id: -1 });
violationSchema.index({ officer: 1, createdAt: -1, _id: -1 });
violationSchema.index({ vehicle_number: 1, status: 1, createdAt: -1, _id: -1 });
violationSchema.index({ status: 1, violation_date: 1 });
module.exports = mongoose.model('Violation', violationSchema);
