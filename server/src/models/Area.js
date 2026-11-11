const mongoose = require('mongoose');

const areaSchema = new mongoose.Schema({
    area_name: {
        type: String,
        required: true,
    },
    city: {
        type: String,
        required: true,
    },
}, {
    timestamps: true,
});

module.exports = mongoose.model('Area', areaSchema);
