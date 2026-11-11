const jwt = require('jsonwebtoken');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const protect = async (req, res, next) => {
    const match = /^Bearer ([^\s]+)$/.exec(req.get('Authorization') || '');
    if (!match) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
    let decoded;
    try {
        decoded = jwt.verify(match[1], process.env.JWT_SECRET, { algorithms: ['HS256'], issuer: 'traffic-ops', audience: 'traffic-ops-client' });
    } catch {
        throw new AppError(401, 'UNAUTHENTICATED', 'Your session has expired. Sign in again.');
    }
    if (typeof decoded.id !== 'string' || !/^[a-f0-9]{24}$/i.test(decoded.id)) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in again.');
    const user = await User.findById(decoded.id).select('+token_version');
    if (!user || decoded.version !== (user.token_version || 0)) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in again.');
    req.user = user;
    next();
};
module.exports = { protect };
