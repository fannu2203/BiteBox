import mongoose from 'mongoose';
const schema = new mongoose.Schema({ kind: { type: String, enum: ['settlement', 'payment-submission', 'feedback', 'notification', 'complaint', 'platform-setting'], required: true, index: true }, user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' }, amount: Number, status: { type: String, default: 'pending' }, method: String, reference: String, proofUrl: String, details: mongoose.Schema.Types.Mixed, message: String, rating: Number, subject: String, readAt: Date }, { timestamps: true });
schema.index({ createdAt: -1 });
export default mongoose.model('Record', schema);
