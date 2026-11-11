const mongoose = require('mongoose');
process.env.MONGOMS_DOWNLOAD_DIR ||= require('node:path').join(__dirname, '../.cache/mongodb-binaries');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { randomBytes, randomUUID } = require('node:crypto');
let replica;
async function startDatabase() {
    if (process.env.MONGO_URI || process.env.MONGODB_URI) throw new Error('Integration tests refuse any inherited database URI.');
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = randomBytes(48).toString('hex');
    replica = await MongoMemoryReplSet.create({ binary: { version: process.env.MONGOMS_VERSION || '7.0.24' }, replSet: { count: 1, storageEngine: 'wiredTiger' } });
    const databaseName = 'traffic_ops_test_' + randomUUID().replace(/-/g, '');
    await mongoose.connect(replica.getUri(databaseName), { bufferCommands: false });
    require('../src/models/User');
    require('../src/models/Violation'); require('../src/models/ViolationType'); require('../src/models/Area');
    require('../src/models/RateLimit'); require('../src/models/IdentityVerification'); require('../src/models/IdentityReview');
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
    return { mongoose, replica, app: require('../src/app'), databaseName };
}
async function clearDatabase() {
    if (!replica || !/^traffic_ops_test_/.test(mongoose.connection.name)) throw new Error('Refusing unsafe test cleanup.');
    await Promise.all(Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})));
}
async function stopDatabase() {
    await mongoose.disconnect();
    if (replica) await replica.stop();
    replica = undefined;
}
module.exports = { startDatabase, clearDatabase, stopDatabase };
