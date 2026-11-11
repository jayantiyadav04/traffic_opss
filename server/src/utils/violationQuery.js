const { createHmac, timingSafeEqual, createHash } = require('node:crypto');
const v = require('./validation');
const scopeFor = (user) => user.role === 'citizen' ? { user: user._id, ownership_verified: true, schema_version: 2 } : {};
function utcDate(value, field) {
    const input = v.text(value, field, { max: 24 });
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(input)) v.invalid(field);
    const date = new Date(input);
    const canonical = input.includes('.') ? input : input.replace('Z', '.000Z');
    if (!Number.isFinite(date.getTime()) || date.toISOString() !== canonical) v.invalid(field);
    return date;
}
function signature(payload) { return createHmac('sha256', process.env.JWT_SECRET).update(payload).digest('base64url'); }
function listQuery(user, input) {
    v.fields(input, ['limit', 'cursor', 'vehicle_number', 'status', 'date_from', 'date_to']);
    const limitText = input.limit === undefined ? '20' : v.text(input.limit, 'limit', { max: 3 });
    if (!/^[1-9]\d{0,2}$/.test(limitText) || Number(limitText) > 100) v.invalid('limit');
    const limit = Number(limitText);
    const query = scopeFor(user);
    const normalized = { actor: user.id, role: user.role };
    if (input.vehicle_number !== undefined) {
        const vehicle = v.text(input.vehicle_number, 'vehicle_number', { max: 20 }).toUpperCase().replace(/\s/g, '');
        if (!/^[A-Z0-9-]{1,20}$/.test(vehicle)) v.invalid('vehicle_number');
        // Strict alphanumeric/hyphen allowlist makes the anchored prefix a literal.
        query.vehicle_number = { $regex: '^' + vehicle };
        normalized.vehicle = vehicle;
    }
    if (input.status !== undefined) {
        if (!['unpaid', 'paid', 'disputed'].includes(input.status)) v.invalid('status');
        query.status = input.status; normalized.status = input.status;
    }
    if (input.date_from !== undefined || input.date_to !== undefined) {
        query.violation_date = {};
        if (input.date_from !== undefined) { query.violation_date.$gte = utcDate(input.date_from, 'date_from'); normalized.from = query.violation_date.$gte.toISOString(); }
        if (input.date_to !== undefined) { query.violation_date.$lt = utcDate(input.date_to, 'date_to'); normalized.to = query.violation_date.$lt.toISOString(); }
        if (normalized.from && normalized.to && normalized.from >= normalized.to) v.invalid('date_to');
    }
    const fingerprint = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
    if (input.cursor !== undefined) {
        const cursor = v.text(input.cursor, 'cursor', { max: 1500 });
        if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(cursor)) v.invalid('cursor');
        const [payload, received] = cursor.split('.');
        const expected = signature(payload);
        if (received.length !== expected.length || !timingSafeEqual(Buffer.from(received), Buffer.from(expected))) v.invalid('cursor');
        let decoded;
        try { decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { v.invalid('cursor'); }
        if (!decoded || decoded.f !== fingerprint) v.invalid('cursor');
        const date = utcDate(decoded.d, 'cursor'); v.id(decoded.id, 'cursor');
        query.$or = [{ createdAt: { $lt: date } }, { createdAt: date, _id: { $lt: decoded.id } }];
    }
    const encode = (record) => {
        const payload = Buffer.from(JSON.stringify({ d: record.createdAt.toISOString(), id: String(record._id), f: fingerprint })).toString('base64url');
        return payload + '.' + signature(payload);
    };
    return { query, limit, encode };
}
module.exports = { scopeFor, listQuery, utcDate };
