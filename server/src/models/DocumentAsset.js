import mongoose from 'mongoose';

const documentAssetSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  fieldName: { type: String, required: true },
  label: { type: String, required: true },
  publicId: { type: String, required: true, unique: true },
  assetId: { type: String, required: true, unique: true },
  resourceType: { type: String, enum: ['image', 'raw', 'video'], required: true },
  deliveryType: { type: String, enum: ['authenticated'], default: 'authenticated' },
  format: { type: String, required: true },
  originalFilename: String,
  bytes: Number,
}, { timestamps: true });

export default mongoose.model('DocumentAsset', documentAssetSchema);
