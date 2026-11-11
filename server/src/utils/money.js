const AppError = require('./AppError');

const EXPONENTS = Object.freeze({ INR: 2, USD: 2, EUR: 2, GBP: 2, JPY: 0 });
const MAX_MINOR = 1_000_000_000_000;
function validateMoney(amount_minor, currency) {
    if (!Object.hasOwn(EXPONENTS, currency) || !Number.isSafeInteger(amount_minor) || amount_minor <= 0 || amount_minor > MAX_MINOR) {
        throw new AppError(400, 'INVALID_MONEY', 'Amount and currency are invalid.');
    }
    return { amount_minor, currency };
}
function decimalToMinor(value, currency = 'INR') {
    if (!Object.hasOwn(EXPONENTS, currency) || !['number', 'string'].includes(typeof value)) {
        throw new AppError(400, 'INVALID_MONEY', 'A valid decimal amount is required.');
    }
    const text = String(value);
    const exponent = EXPONENTS[currency];
    if (!/^\d+(?:\.\d+)?$/.test(text)) throw new AppError(400, 'INVALID_MONEY', 'Invalid decimal amount.');
    const [whole, fraction = ''] = text.split('.');
    if (fraction.length > exponent) throw new AppError(400, 'AMBIGUOUS_PRECISION', 'Amount requires manual precision review.');
    const minor = BigInt(whole) * (10n ** BigInt(exponent)) + BigInt(fraction.padEnd(exponent, '0') || '0');
    if (minor > BigInt(MAX_MINOR)) throw new AppError(400, 'INVALID_MONEY', 'Amount exceeds the supported bound.');
    return validateMoney(Number(minor), currency).amount_minor;
}
function moneyFromLegacy(value) { return { amount_minor: decimalToMinor(value, 'INR'), currency: 'INR' }; }
function recordMoney(record) {
    if (record.amount_minor != null || record.currency != null) return validateMoney(record.amount_minor, record.currency);
    return moneyFromLegacy(record.fine_amount ?? record.base_fine);
}
function formatMinor(amount_minor, currency) {
    validateMoney(amount_minor, currency);
    const exponent = EXPONENTS[currency];
    const text = String(amount_minor).padStart(exponent + 1, '0');
    return exponent ? `${text.slice(0, -exponent)}.${text.slice(-exponent)}` : text;
}
module.exports = { EXPONENTS, MAX_MINOR, validateMoney, decimalToMinor, moneyFromLegacy, recordMoney, formatMinor };
