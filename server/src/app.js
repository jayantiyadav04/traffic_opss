const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const AppError = require('./utils/AppError');
const { ensureReady } = require('./config/db');
mongoose.set('bufferCommands', false);
function createApp() {
    const app = express();
    app.disable('x-powered-by');
    app.use((req, res, next) => {
        req.requestId = randomUUID();
        res.set('X-Request-ID', req.requestId);
        const started = Date.now();
        res.on('finish', () => {
            if (process.env.NODE_ENV !== 'test') console.log(JSON.stringify({ requestId: req.requestId, method: req.method, path: req.path, status: res.statusCode, duration_ms: Date.now() - started }));
        });
        next();
    });
    app.use(helmet());
    app.use(cors({
        origin(origin, callback) {
            const allowed = (process.env.CLIENT_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((value) => value.trim());
            if (!origin || allowed.includes(origin)) return callback(null, true);
            callback(new AppError(403, 'ORIGIN_NOT_ALLOWED', 'This origin is not allowed.'));
        },
        credentials: false,
        exposedHeaders: ['X-Request-ID'],
    }));
    app.use(express.json({ limit: '32kb', verify(req, res, bytes) { req.rawBody = Buffer.from(bytes); } }));
    app.get('/', (req, res) => res.json({ service: 'Traffic-Ops API' }));
    app.get('/api/health/live', (req, res) => res.json({ status: 'live' }));
    app.get('/api/health/ready', async (req, res) => {
        await ensureReady();
        try { await mongoose.connection.db.admin().command({ ping: 1 }); }
        catch { throw new AppError(503, 'NOT_READY', 'Database is unavailable.'); }
        res.json({ status: 'ready' });
    });
    app.use('/api', async (req, res, next) => {
        res.set('Cache-Control', 'no-store');
        await ensureReady();
        next();
    });
    app.use('/api/auth', require('./routes/authRoutes'));
    app.use('/api/violations', require('./routes/violationRoutes'));
    app.use('/api/analytics', require('./routes/analyticsRoutes'));
    app.use('/api/payments', require('./routes/paymentRoutes'));
    app.use((req, res, next) => next(new AppError(404, 'NOT_FOUND', 'Route not found.')));
    app.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        let status = error.status || 500;
        let code = error.code || 'INTERNAL_ERROR';
        let message = error.message;
        let details = error.details;
        if (error.name === 'ValidationError' || error.name === 'CastError') {
            status = 400; code = 'VALIDATION_ERROR'; message = 'Review the submitted fields.';
            details = Object.keys(error.errors || {}).map((field) => ({ field, code: 'INVALID_VALUE' }));
        } else if (error.code === 11000) {
            status = 409; code = 'DUPLICATE_RECORD'; message = 'An account or record with these identifiers already exists.';
        } else if (!(error instanceof AppError)) {
            code = status === 413 ? 'PAYLOAD_TOO_LARGE' : status === 400 ? 'INVALID_JSON' : 'INTERNAL_ERROR';
            message = status === 413 ? 'Request body is too large.' : status === 400 ? 'Request body is invalid.' : 'The service could not complete the request.';
            details = undefined;
        }
        if (!Number.isInteger(status) || status < 400 || status > 599) status = 500;
        if (process.env.NODE_ENV !== 'test' && status >= 500) console.error(JSON.stringify({ requestId: req.requestId, code, status }));
        res.status(status).json({ error: { code, message, ...(details ? { details } : {}) }, requestId: req.requestId });
    });
    return app;
}
const app = createApp();
module.exports = app;
module.exports.createApp = createApp;
