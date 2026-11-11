const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('../models/User');
const IdentityVerification = require('../models/IdentityVerification');
const AppError = require('../utils/AppError');
const v = require('../utils/validation');
const safeUser = (user) => ({ _id: user.id, username: user.username, full_name: user.full_name, email: user.email, role: user.role, onboarding_status: user.onboarding_status });
const generateToken = (user) => jwt.sign({ id: user.id, version: user.token_version || 0 }, process.env.JWT_SECRET, { expiresIn: '15m', issuer: 'traffic-ops', audience: 'traffic-ops-client', algorithm: 'HS256' });
const session = (user) => ({ ...safeUser(user), token: generateToken(user) });
function accountInput(body, privileged = false) {
    v.fields(body, ['username', 'full_name', 'email', 'password', 'role']);
    const username = v.text(body.username, 'username', { min: 3, max: 40 });
    if (!/^[A-Za-z0-9_]+$/.test(username)) v.invalid('username');
    if (!privileged && body.role !== undefined && body.role !== 'citizen') v.invalid('role', 'PRIVILEGED_ROLE');
    const role = privileged ? body.role : 'citizen';
    if (!['citizen', 'officer', 'admin'].includes(role)) v.invalid('role');
    return { username, full_name: v.text(body.full_name, 'full_name', { max: 100 }), email: v.email(body.email), password: v.password(body.password), role };
}
const registerUser = async (req, res) => {
    const user = await User.create(accountInput(req.body));
    res.status(201).json(session(user));
};
const provisionUser = async (req, res) => {
    const input = accountInput(req.body, true);
    const user = await User.create({ ...input, onboarding_status: input.role === 'citizen' ? 'pending' : 'verified' });
    res.status(201).json(safeUser(user));
};
const loginUser = async (req, res) => {
    v.fields(req.body, ['email', 'password']);
    const email = v.email(req.body.email);
    const password = v.text(req.body.password, 'password', { min: 1, max: 72, trim: false });
    const user = await User.findOne({ email }).select('+password +token_version');
    if (!user || !(await user.matchPassword(password))) throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
    res.json(session(user));
};
const getMe = async (req, res) => res.json(safeUser(req.user));
const logout = async (req, res) => {
    await User.updateOne({ _id: req.user._id }, { $inc: { token_version: 1 } });
    res.status(204).end();
};
const changePassword = async (req, res) => {
    v.fields(req.body, ['current_password', 'new_password']);
    const user = await User.findById(req.user._id).select('+password +token_version');
    const current = v.text(req.body.current_password, 'current_password', { min: 1, max: 72, trim: false });
    const next = v.password(req.body.new_password, 'new_password');
    if (!(await user.matchPassword(current))) throw new AppError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect.');
    // Compare the old hash and increment the revocation counter atomically. Two
    // concurrent changes cannot overwrite the hash or reuse a session version.
    const updated = await User.findOneAndUpdate({ _id: user._id, password: user.password },
        { $set: { password: await bcrypt.hash(next, 10) }, $inc: { token_version: 1 } },
        { returnDocument: 'after', runValidators: true }).select('+token_version');
    if (!updated) throw new AppError(409, 'PASSWORD_CHANGED', 'Your password changed during this request. Sign in again.');
    res.json(session(updated));
};
const findCitizens = async (req, res) => {
    v.fields(req.query, ['email']);
    const email = v.email(req.query.email);
    const user = await User.findOne({ email, role: 'citizen' });
    res.json(user ? [safeUser(user)] : []);
};
const verifyCitizen = async (req, res) => {
    v.id(req.params.id);
    v.fields(req.body, ['reference']);
    const reference = v.text(req.body.reference, 'reference', { min: 3, max: 120 });
    let result;
    await mongoose.connection.transaction(async (transaction) => {
        const citizen = await User.findOne({ _id: req.params.id, role: 'citizen' }).session(transaction);
        if (!citizen) throw new AppError(404, 'NOT_FOUND', 'Citizen not found.');
        if (citizen.onboarding_status === 'verified') throw new AppError(409, 'ALREADY_VERIFIED', 'This account has already been verified.');
        const verifiedAt = new Date();
        citizen.onboarding_status = 'verified';
        citizen.verified_by = req.user._id;
        citizen.verified_at = verifiedAt;
        await citizen.save({ session: transaction });
        await IdentityVerification.create([{ citizen_id: citizen._id, actor_id: req.user._id, reference, verified_at: verifiedAt }], { session: transaction });
        result = safeUser(citizen);
    });
    res.json(result);
};
module.exports = { registerUser, loginUser, getMe, logout, changePassword, provisionUser, findCitizens, verifyCitizen, safeUser };
