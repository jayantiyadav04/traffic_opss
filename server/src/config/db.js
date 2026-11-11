const mongoose = require('mongoose');
const AppError = require('../utils/AppError');
// Initialize collections/indexes explicitly after a connection exists. In particular,
// bufferCommands:false must not cause model compilation to start disconnected DDL.
mongoose.set('autoCreate', false);
mongoose.set('autoIndex', false);
let connectionPromise;
let initializationPromise;
let initializedDatabase;

mongoose.connection.on('disconnected', () => { initializedDatabase = undefined; initializationPromise = undefined; connectionPromise = undefined; });

async function ensureReady() {
    if (mongoose.connection.readyState !== 1) throw new AppError(503, 'NOT_READY', 'Database is unavailable.');
    if (initializedDatabase === mongoose.connection.db) return mongoose.connection;
    if (!initializationPromise) {
        const database = mongoose.connection.db;
        initializationPromise = (async () => {
            const topology = await database.admin().command({ hello: 1 });
            if (!topology.setName && topology.msg !== 'isdbgrid') throw new AppError(503, 'TRANSACTIONS_REQUIRED', 'A transaction-capable database deployment is required.');
            // Unique constraints must exist before serving writes, including on a fresh database.
            for (const name of ['User', 'Violation', 'ViolationType', 'Area', 'RateLimit', 'IdentityVerification', 'IdentityReview', 'Payment', 'AuditEvent', 'IdempotencyRecord', 'WebhookEvent']) require(`../models/${name}`);
            await Promise.all(Object.values(mongoose.models).map(async model => {
                await model.createCollection();
                await model.createIndexes();
            }));
            if (mongoose.connection.readyState !== 1 || mongoose.connection.db !== database) throw new AppError(503, 'NOT_READY', 'Database changed during initialization.');
            initializedDatabase = database;
            return mongoose.connection;
        })().catch(error => {
            initializationPromise = undefined;
            if (error instanceof AppError) throw error;
            const failure = new AppError(503, 'DATABASE_INITIALIZATION_FAILED', 'Database constraints could not be initialized.');
            failure.cause = error;
            throw failure;
        });
    }
    return initializationPromise;
}
async function connectDB() {
    if (mongoose.connection.readyState === 1) return ensureReady();
    if (!connectionPromise) {
        connectionPromise = mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000, maxPoolSize: 20, bufferCommands: false })
            .then(ensureReady)
            .catch((error) => { connectionPromise = undefined; throw error; });
    }
    return connectionPromise;
}
module.exports = connectDB;
module.exports.ensureReady = ensureReady;
