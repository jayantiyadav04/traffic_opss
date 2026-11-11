const AppError = require('../utils/AppError');
const checkRole = (roles) => (req, res, next) => {
    if (!req.user) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
    if (!roles.includes(req.user.role)) throw new AppError(403, 'FORBIDDEN', 'You do not have permission for this operation.');
    next();
};
module.exports = { checkRole };
