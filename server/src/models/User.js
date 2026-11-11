const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true, minlength: 3, maxlength: 40 },
    password: { type: String, required: true, select: false },
    full_name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    role: { type: String, enum: ['admin', 'officer', 'citizen'], default: 'citizen' },
    onboarding_status: { type: String, enum: ['pending', 'verified'], default: 'pending' },
    verified_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    verified_at: Date,
    token_version: { type: Number, default: 0, min: 0, select: false },
}, { timestamps: true });
userSchema.methods.matchPassword = async function (enteredPassword) {
    return bcrypt.compare(enteredPassword, this.password);
};
userSchema.pre('save', async function () {
    if (!this.isModified('password')) return;
    this.password = await bcrypt.hash(this.password, 10);
});
module.exports = mongoose.model('User', userSchema);
