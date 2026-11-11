const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
const mongoose = require('mongoose');
const { configuration } = require('./src/config/env');
const connectDB = require('./src/config/db');
const app = require('./src/app');
async function start() {
    const config = configuration();
    await connectDB();
    const server = app.listen(config.port, () => console.log(JSON.stringify({ event: 'server_started', port: config.port })));
    const shutdown = () => server.close(async () => { await mongoose.disconnect(); process.exit(0); });
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
    return server;
}
if (require.main === module) start().catch(() => { console.error(JSON.stringify({ event: 'startup_failed' })); process.exitCode = 1; });
module.exports = { start };
