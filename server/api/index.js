const app = require('../src/app');
const connectDB = require('../src/config/db');
const { configuration } = require('../src/config/env');
const { randomUUID } = require('node:crypto');
function createHandler({ application = app, connect = connectDB, validate = configuration, log = entry => console.error(JSON.stringify(entry)), requestId = randomUUID } = {}) {
    return async (req, res) => {
        // A live process must remain observable even when its database/configuration is unavailable.
        if (['GET', 'HEAD'].includes(req.method) && (req.url || '').split('?')[0] === '/api/health/live') return application(req, res);
        let phase = 'configuration';
        try {
            validate();
            phase = 'database';
            await connect();
            return application(req, res);
        } catch (error) {
            const id = requestId();
            const configurationFailed = phase === 'configuration';
            const allowed = ['TRANSACTIONS_REQUIRED', 'DATABASE_INITIALIZATION_FAILED', 'NOT_READY'];
            const code = configurationFailed ? 'CONFIGURATION_INVALID' : allowed.includes(error.code) ? error.code : 'DATABASE_UNAVAILABLE';
            const entry = { event: 'startup_failed', requestId: id, phase, code };
            if (configurationFailed && ['MONGO_URI', 'JWT_SECRET', 'CLIENT_ORIGINS', 'PORT'].includes(error.field)) entry.field = error.field;
            const databaseCode = error.cause?.code ?? error.code;
            if (!configurationFailed && Number.isInteger(databaseCode)) entry.databaseCode = databaseCode;
            // Never log the exception message, stack, URI, environment or provider payload.
            log(entry);
            res.setHeader('X-Request-ID', id);
            res.setHeader('Cache-Control', 'no-store');
            return res.status(503).json({ error: { code, message: configurationFailed ? 'The service configuration is incomplete.' : 'The service is unavailable.' }, requestId: id });
        }
    };
}
module.exports = createHandler();
module.exports.createHandler = createHandler;
