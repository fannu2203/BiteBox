import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true }, email: { type: String, lowercase: true, trim: true, sparse: true, unique: true },
  phone: { type: String, required: true, trim: true }, password: { type: String, required: true, select: false },
  role: { type: String, enum: ['admin', 'customer', 'vendor', 'rider'], required: true },
  status: { type: String, enum: ['pending', 'active', 'suspended', 'rejected'], default: 'pending' },
  avatar: String, address: String, deliveryAddress: String, documents: [{ label: String, url: String }],
  vendor: { shopName: String, shopAddress: String, image: String, imagePublicId: String, ownerCurrentAddress: String, ownerPermanentAddress: String, cnic: String, cnicFront: String, cnicBack: String, foodLicenseNo: String, foodLicenseDocument: String, utilityBill: String, applicationPayment: { method: String, reference: String, proofUrl: String, verified: { type: Boolean, default: false } }, account: { name: String, number: String, method: String, branchName: String, branchCode: String }, location: { lat: Number, lng: Number }, currentBalance: { type: Number, default: 0 }, commissionRate: { type: Number, default: 0.17 } },
  rider: { cnic: String, cnicFront: String, cnicBack: String, currentAddress: String, permanentAddress: String, utilityBill: String, account: { name: String, number: String, method: String, branchName: String, branchCode: String }, vehicleType: String, vehiclePhoto: String, vehicleRegistrationFront: String, vehicleRegistrationBack: String, vehicleRegistrationNo: String, vehicleRegistrationDate: Date, licenseNo: String, licenseFront: String, licenseBack: String, licenseExpiry: Date, location: { lat: Number, lng: Number }, rating: { type: Number, default: 5 }, ratingCount: { type: Number, default: 0 }, accountUpdatesThisWeek: { type: Number, default: 0 }, accountLastUpdated: Date },
  lastSeenAt: Date, approvedAt: Date, approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });
userSchema.pre('save', async function () { if (this.isModified('password')) this.password = await bcrypt.hash(this.password, 12); });
userSchema.methods.comparePassword = function (candidate) { return bcrypt.compare(candidate, this.password); };
userSchema.index({ role: 1, status: 1 });
export default mongoose.model('User', userSchema);
