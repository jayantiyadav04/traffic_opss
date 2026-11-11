class ConfigurationError extends Error {
    constructor(field, message) {
        super(message);
        this.code = 'CONFIGURATION_INVALID';
        this.field = field;
    }
}
function configuration() {
    const mongoUri = process.env.MONGO_URI;
    const jwtSecret = process.env.JWT_SECRET;
    if (!mongoUri || !/^mongodb(?:\+srv)?:\/\//.test(mongoUri)) throw new ConfigurationError('MONGO_URI', 'MONGO_URI must be configured.');
    if (!jwtSecret || jwtSecret.length < 32 || jwtSecret.startsWith('replace-with-')) throw new ConfigurationError('JWT_SECRET', 'JWT_SECRET must be a locally generated secret of at least 32 characters.');
    const origins = (process.env.CLIENT_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((value) => value.trim()).filter(Boolean);
    for (const origin of origins) {
        let parsed;
        try { parsed = new URL(origin); } catch { throw new ConfigurationError('CLIENT_ORIGINS', 'CLIENT_ORIGINS contains an invalid origin.'); }
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) throw new ConfigurationError('CLIENT_ORIGINS', 'CLIENT_ORIGINS must contain exact HTTP origins.');
    }
    const port = Number(process.env.PORT || 5000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ConfigurationError('PORT', 'PORT must be an integer between 1 and 65535.');
    return { mongoUri, origins, port };
}
module.exports = { configuration };
