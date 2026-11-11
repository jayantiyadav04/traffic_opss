const mongoose = require('mongoose');
const schema = new mongoose.Schema({
    key: { type: String, unique: true, required: true },
    count: { type: Number, default: 0 },
    expires_at: { type: Date, required: true, expires: 0 },
});
module.exports = mongoose.model('RateLimit', schema);
