import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import DocumentAsset from '../models/DocumentAsset.js';
import { uploadBuffer } from '../config/cloudinary.js';
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';

const tokenFor = user => jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
const sendUser = user => ({ id: user._id, name: user.name, email: user.email, phone: user.phone, role: user.role, status: user.status, avatar: user.avatar });
export const signup = asyncHandler(async (req, res) => {
  let input = req.body;
  if (req.body.payload) {
    try { input = JSON.parse(req.body.payload); } catch { throw new AppError('Signup form data is invalid', 400); }
  }
  const { name, email: rawEmail, phone, password, role } = input;
  const files = req.files || {};
  const hasFile = field => Boolean(files[field]?.[0]);
  const email = rawEmail?.trim().toLowerCase() || undefined;
  if (!['customer', 'vendor', 'rider'].includes(role)) throw new AppError('Choose customer, vendor, or rider account', 400);
  if (!name || !phone || !password || password.length < 8) throw new AppError('Name, phone, and a password of at least 8 characters are required', 400);
  if (role !== 'customer' && !email) throw new AppError('Email is required for vendor and rider registration', 400);
  if (email && await User.exists({ email: email.toLowerCase() })) throw new AppError('An account already uses this email', 409);
  if (role === 'customer' && (!input.address || !input.deliveryAddress)) throw new AppError('House and delivery addresses are required', 400);
  if (role === 'vendor') {
    const v = input.vendor || {};
    if (files.applicationPaymentProof?.[0] && !files.applicationPaymentProof[0].mimetype.startsWith('image/')) throw new AppError('Vendor payment proof must be an image screenshot', 415);
    if (!v.shopName || !v.shopAddress || !v.cnic || !hasFile('cnicFront') || !hasFile('cnicBack') || !v.ownerCurrentAddress || !v.ownerPermanentAddress || !hasFile('utilityBill') || !v.applicationPayment?.reference || !hasFile('applicationPaymentProof') || !v.account?.name || !v.account?.number) throw new AppError('Complete the required vendor, owner, document, payment, and payout details', 400);
  }
  if (role === 'rider') {
    const r = input.rider || {};
    if (!r.cnic || !hasFile('cnicFront') || !hasFile('cnicBack') || !r.currentAddress || !r.permanentAddress || !hasFile('utilityBill') || !hasFile('vehiclePhoto') || !r.vehicleRegistrationNo || !r.vehicleRegistrationDate || !hasFile('vehicleRegistrationFront') || !hasFile('vehicleRegistrationBack') || !r.licenseNo || !r.licenseExpiry || !hasFile('licenseFront') || !hasFile('licenseBack') || !r.account?.name || !r.account?.number) throw new AppError('Complete the required rider, vehicle, document, license, and payout details', 400);
  }
  const userData = { name, email, phone, password, role, status: role === 'customer' ? 'active' : 'pending' };
  if (role === 'customer') {
    userData.address = input.address;
    userData.deliveryAddress = input.deliveryAddress;
  }
  if (role === 'vendor') {
    const v = input.vendor || {};
    userData.vendor = {
      shopName: v.shopName, shopAddress: v.shopAddress, cnic: v.cnic,
      ownerCurrentAddress: v.ownerCurrentAddress, ownerPermanentAddress: v.ownerPermanentAddress,
      foodLicenseNo: v.foodLicenseNo,
      applicationPayment: { method: v.applicationPayment?.method, reference: v.applicationPayment?.reference, verified: false },
      account: { name: v.account?.name, number: v.account?.number, method: v.account?.method, branchName: v.account?.branchName, branchCode: v.account?.branchCode },
    };
  }
  if (role === 'rider') {
    const r = input.rider || {};
    userData.rider = {
      cnic: r.cnic, currentAddress: r.currentAddress, permanentAddress: r.permanentAddress,
      vehicleType: r.vehicleType,
      vehicleRegistrationNo: r.vehicleRegistrationNo, vehicleRegistrationDate: r.vehicleRegistrationDate,
      licenseNo: r.licenseNo, licenseExpiry: r.licenseExpiry,
      account: { name: r.account?.name, number: r.account?.number, method: r.account?.method, branchName: r.account?.branchName, branchCode: r.account?.branchCode },
    };
  }
  const user = await User.create(userData);
  const mapping = role === 'vendor'
    ? { cnicFront: 'vendor.cnicFront', cnicBack: 'vendor.cnicBack', utilityBill: 'vendor.utilityBill', foodLicenseDocument: 'vendor.foodLicenseDocument', applicationPaymentProof: 'vendor.applicationPayment.proofUrl' }
    : role === 'rider'
      ? { cnicFront: 'rider.cnicFront', cnicBack: 'rider.cnicBack', utilityBill: 'rider.utilityBill', vehiclePhoto: 'rider.vehiclePhoto', vehicleRegistrationFront: 'rider.vehicleRegistrationFront', vehicleRegistrationBack: 'rider.vehicleRegistrationBack', licenseFront: 'rider.licenseFront', licenseBack: 'rider.licenseBack' }
      : {};
  const createdAssets = [];
  try {
    for (const [fileField, fieldName] of Object.entries(mapping)) {
      const file = files[fileField]?.[0];
      if (!file) continue;
      const uploaded = await uploadBuffer(file.buffer, { resource_type: fieldName === 'vendor.applicationPayment.proofUrl' ? 'image' : 'auto', type: 'authenticated', folder: `bite-box/private/${user._id}`, unique_filename: true, overwrite: false, use_filename: false });
      const asset = await DocumentAsset.create({ owner: user._id, fieldName, label: file.originalname, publicId: uploaded.public_id, assetId: uploaded.asset_id, resourceType: uploaded.resource_type, deliveryType: 'authenticated', format: uploaded.format || 'bin', originalFilename: file.originalname, bytes: uploaded.bytes });
      createdAssets.push(asset);
      const [root, ...path] = fieldName.split('.');
      let target = user[root];
      for (const part of path.slice(0, -1)) target = target[part];
      target[path.at(-1)] = String(asset._id);
    }
    if (createdAssets.length) await user.save();
  } catch (error) {
    await DocumentAsset.deleteMany({ _id: { $in: createdAssets.map(a => a._id) } });
    for (const asset of createdAssets) await import('../config/cloudinary.js').then(({ default: client }) => client.uploader.destroy(asset.publicId, { resource_type: asset.resourceType, type: 'authenticated' }).catch(() => {}));
    await User.deleteOne({ _id: user._id });
    throw error;
  }
  res.status(201).json({ success: true, message: role === 'customer' ? 'Your account is ready' : 'Application submitted for admin review', ...(role === 'customer' ? { token: tokenFor(user), user: sendUser(user) } : {}) });
});
export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const loginId = email?.trim() || '';
  const user = await User.findOne({ $or: [{ email: loginId.toLowerCase() }, { phone: loginId }] }).select('+password');
  if (!user || !(await user.comparePassword(password || ''))) throw new AppError('Email or password is incorrect', 401);
  if (user.status !== 'active') throw new AppError(`This account is ${user.status}. Contact support for help.`, 403);
  user.lastSeenAt = new Date(); await user.save({ validateBeforeSave: false });
  res.json({ success: true, token: tokenFor(user), user: sendUser(user) });
});
export const me = asyncHandler(async (req, res) => res.json({ success: true, user: sendUser(req.user), profile: req.user }));
export const updateProfile = asyncHandler(async (req, res) => {
  const allowed = ['name', 'phone', 'address', 'deliveryAddress', 'avatar', 'documents'];
  for (const key of allowed) if (req.body[key] !== undefined) req.user[key] = req.body[key];
  if (req.user.role === 'vendor' && req.body.vendor) {
    const keys = ['shopName','shopAddress','image','imagePublicId','ownerCurrentAddress','ownerPermanentAddress','cnic','cnicFront','cnicBack','foodLicenseNo','foodLicenseDocument','utilityBill','location','account'];
    for (const key of keys) if (req.body.vendor[key] !== undefined) req.user.vendor[key] = req.body.vendor[key];
  }
  if (req.user.role === 'rider' && req.body.rider) {
    const keys = ['cnic','cnicFront','cnicBack','currentAddress','permanentAddress','utilityBill','vehicleType','vehiclePhoto','vehicleRegistrationNo','vehicleRegistrationDate','vehicleRegistrationFront','vehicleRegistrationBack','licenseNo','licenseExpiry','licenseFront','licenseBack','location'];
    for (const key of keys) if (req.body.rider[key] !== undefined) req.user.rider[key] = req.body.rider[key];
  }
  await req.user.save(); res.json({ success: true, user: sendUser(req.user), profile: req.user });
});
