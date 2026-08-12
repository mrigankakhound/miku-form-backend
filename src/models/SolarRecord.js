const mongoose = require('mongoose');

const photoSchema = new mongoose.Schema({
  url: { type: String, required: true },
  publicId: { type: String, required: true },
});

const PLANT_CAPACITY_OPTIONS = [
  '1 KW', '2 KW', '3 KW', '4 KW', '5 KW',
  '6 KW', '7 KW', '8 KW', '9 KW', '10 KW',
];

const solarRecordSchema = new mongoose.Schema(
  {
    consumerName:          { type: String, required: true, trim: true },
    consumerNo:            { type: String, required: true, trim: true },
    contactNumber:         { type: String, required: true, trim: true },
    applicationReferenceNo:{ type: String, required: true, trim: true },
    address:               { type: String, required: true, trim: true },
    plantCapacity:         { type: String, required: true, trim: true, enum: PLANT_CAPACITY_OPTIONS },
    installationDate:      { type: Date,   required: true },
    subDivision:           { type: String, required: true, trim: true },
    systemCommissioningDate:{ type: Date,  required: false, default: null },
    vendorName:            { type: String, required: true, trim: true },
    // photo1 = Inverter Photo  (required)
    photo1: { type: photoSchema, required: true },
    // photo2 = Panel Photo     (required)
    photo2: { type: photoSchema, required: true },
    // photo3 = Earth Photo     (required)
    photo3: { type: photoSchema, required: true },
    // photo4 = LA Photo        (required)
    photo4: { type: photoSchema, required: true },
    // photo5 = 5th Photo       (optional)
    photo5: { type: photoSchema, required: false, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SolarRecord', solarRecordSchema);
module.exports.PLANT_CAPACITY_OPTIONS = PLANT_CAPACITY_OPTIONS;
