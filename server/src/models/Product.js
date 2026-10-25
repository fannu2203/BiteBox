import mongoose from 'mongoose';
const productSchema = new mongoose.Schema({ vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true }, name: { type: String, required: true, trim: true }, description: String, category: { type: String, index: true }, image: String, imagePublicId: String, price: { type: Number, required: true, min: 0 }, stock: { type: Number, default: 0, min: 0 }, available: { type: Boolean, default: true }, salePercent: { type: Number, default: 0, min: 0, max: 90 }, tags: [String] }, { timestamps: true });
productSchema.index({ name: 'text', description: 'text', category: 'text' });
export default mongoose.model('Product', productSchema);
