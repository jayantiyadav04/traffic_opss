const { createHash } = require('node:crypto');
const RateLimit = require('../models/RateLimit');
const AppError = require('../utils/AppError');
// Durable fixed-window counters share limits across instances. TTL removes expired counters.
function rateLimiter(operation, { max = 20, windowMs = 60_000 } = {}) {
    return async (req, res, next) => {
        const now = Date.now();
        const bucket = Math.floor(now / windowMs);
        const key = createHash('sha256').update(process.env.JWT_SECRET + ':' + operation + ':' + req.ip + ':' + bucket).digest('hex');
        let counter;
        try {
            counter = await RateLimit.findOneAndUpdate({ key }, { $inc: { count: 1 }, $setOnInsert: { expires_at: new Date((bucket + 2) * windowMs) } }, { upsert: true, returnDocument: 'after' });
        } catch (error) {
            if (error.code !== 11000) throw error;
            counter = await RateLimit.findOneAndUpdate({ key }, { $inc: { count: 1 } }, { returnDocument: 'after' });
        }
        if (counter.count > max) {
            res.set('Retry-After', String(Math.ceil(((bucket + 1) * windowMs - now) / 1000)));
            throw new AppError(429, 'RATE_LIMITED', 'Too many attempts. Try again shortly.');
        }
        next();
    };
}
module.exports = rateLimiter;
