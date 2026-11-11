const mongoose = require('mongoose');
const AppError = require('./AppError');
const invalid = (field, code = 'INVALID_VALUE') => {
    throw new AppError(400, 'VALIDATION_ERROR', 'Review the submitted fields.', [{ field, code }]);
};
function fields(body, allowed) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('body');
    for (const key of Object.keys(body)) if (!allowed.includes(key)) invalid(key, 'UNSUPPORTED_FIELD');
}
function text(value, field, { min = 1, max = 200, optional = false, trim = true } = {}) {
    if (optional && value === undefined) return undefined;
    if (typeof value !== 'string') invalid(field);
    const result = trim ? value.trim() : value;
    if (result.length < min || result.length > max) invalid(field);
    return result;
}
function id(value, field = 'id') {
    if (typeof value !== 'string' || !/^[a-f0-9]{24}$/i.test(value) || !mongoose.isValidObjectId(value)) invalid(field);
    return value;
}
function email(value) {
    const result = text(value, 'email', { max: 254 }).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) invalid('email');
    return result;
}
function password(value, field = 'password') {
    const result = text(value, field, { min: 10, max: 72, trim: false });
    if (Buffer.byteLength(result, 'utf8') > 72) invalid(field);
    return result;
}
module.exports = { fields, text, id, email, password, invalid };
