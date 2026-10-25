import { v2 as cloudinary } from 'cloudinary';
import DocumentAsset from '../models/DocumentAsset.js';
import Product from '../models/Product.js';
import Record from '../models/Record.js';
import User from '../models/User.js';
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { requireCloudinary, uploadBuffer } from '../config/cloudinary.js';

const documentFields = {
  admin: new Set(['admin.profileDocument']),
  vendor: new Set(['vendor.cnicFront','vendor.cnicBack','vendor.utilityBill','vendor.foodLicenseDocument']),
  rider: new Set(['rider.cnicFront','rider.cnicBack','rider.utilityBill','rider.vehiclePhoto','rider.vehicleRegistrationFront','rider.vehicleRegistrationBack','rider.licenseFront','rider.licenseBack']),
};
const labels = {
  cnicFront: 'CNIC front', cnicBack: 'CNIC back', utilityBill: 'Utility bill', foodLicenseDocument: 'Food authority license',
  applicationPaymentProof: 'Vendor signup payment proof', vehiclePhoto: 'Vehicle with number plate', vehicleRegistrationFront: 'Vehicle registration front',
  vehicleRegistrationBack: 'Vehicle registration back', licenseFront: 'Driving license front', licenseBack: 'Driving license back',
};

export const uploadImage = asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError('Choose an image to upload');
  const category = req.body.category === 'banner' ? 'banner' : req.body.category === 'vendor' ? 'vendor' : 'product';
  if (category === 'banner' && req.user.role !== 'admin') throw new AppError('Only an admin can upload the platform banner', 403);
  if (category !== 'banner' && !['vendor','admin'].includes(req.user.role)) throw new AppError('Vendor or admin access required', 403);
  const folder = category === 'banner' ? 'bite-box/branding' : `bite-box/${category === 'vendor' ? 'vendors' : 'products'}/${req.user._id}`;
  const uploaded = await uploadBuffer(req.file.buffer, { resource_type: 'image', type: 'upload', folder, unique_filename: true, overwrite: false });
  if (category === 'vendor' && req.user.role === 'vendor') {
    req.user.vendor.image = uploaded.secure_url;
    req.user.vendor.imagePublicId = uploaded.public_id;
    await req.user.save();
  }
  res.status(201).json({ success: true, image: { url: uploaded.secure_url, publicId: uploaded.public_id, format: uploaded.format, width: uploaded.width, height: uploaded.height } });
});

export const uploadDocument = asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError('Choose a document to upload');
  const fieldName = String(req.body.fieldName || '');
  if (!documentFields[req.user.role]?.has(fieldName)) throw new AppError('This document field is not available for your account', 403);
  const path = fieldName.split('.')[1];
  const uploaded = await uploadBuffer(req.file.buffer, {
    resource_type: 'auto', type: 'authenticated', folder: `bite-box/private/${req.user._id}`,
    unique_filename: true, overwrite: false, use_filename: false,
  });
  const asset = await DocumentAsset.create({ owner: req.user._id, fieldName, label: labels[path] || path, publicId: uploaded.public_id, assetId: uploaded.asset_id, resourceType: uploaded.resource_type, deliveryType: 'authenticated', format: uploaded.format || 'bin', originalFilename: req.file.originalname, bytes: uploaded.bytes });
  if (req.user.role === 'admin') req.user.documents.push({ label: asset.label, url: String(asset._id) });
  else req.user[req.user.role][path] = String(asset._id);
  await req.user.save();
  res.status(201).json({ success: true, document: { id: asset._id, fieldName, label: asset.label } });
});

export const uploadPaymentProof = asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError('Choose a payment screenshot to upload');
  if (!['vendor','rider'].includes(req.user.role)) throw new AppError('Vendor or rider access required', 403);
  if (!req.file.mimetype.startsWith('image/')) throw new AppError('Payment proof must be an image screenshot', 415);
  const uploaded = await uploadBuffer(req.file.buffer, {
    resource_type: 'image', type: 'authenticated', folder: `bite-box/private/${req.user._id}/payment-proofs`,
    unique_filename: true, overwrite: false, use_filename: false,
  });
  const asset = await DocumentAsset.create({ owner: req.user._id, fieldName: 'payment.proof', label: req.file.originalname, publicId: uploaded.public_id, assetId: uploaded.asset_id, resourceType: uploaded.resource_type, deliveryType: 'authenticated', format: uploaded.format || 'jpg', originalFilename: req.file.originalname, bytes: uploaded.bytes });
  res.status(201).json({ success: true, proof: { id: asset._id, filename: asset.originalFilename } });
});

export const listDocuments = asyncHandler(async (req, res) => {
  const ownerId = req.user.role === 'admin' ? (req.query.userId || req.user._id) : req.user._id;
  if (req.user.role !== 'admin' && req.query.userId && String(req.query.userId) !== String(req.user._id)) throw new AppError('You can only view your own documents', 403);
  const documents = await DocumentAsset.find({ owner: ownerId }).select('label fieldName originalFilename format bytes createdAt').sort('createdAt');
  res.json({ success: true, documents: documents.map(d => ({ id: d._id, label: d.label, fieldName: d.fieldName, filename: d.originalFilename, format: d.format, bytes: d.bytes, createdAt: d.createdAt })) });
});

export const documentAccess = asyncHandler(async (req, res) => {
  const client = requireCloudinary();
  const asset = await DocumentAsset.findById(req.params.id);
  if (!asset) throw new AppError('Document not found', 404);
  if (req.user.role !== 'admin' && String(asset.owner) !== String(req.user._id)) throw new AppError('Document not found', 404);
  const expiresAt = Math.floor(Date.now() / 1000) + 300;
  const url = client.utils.private_download_url(asset.publicId, asset.format, { resource_type: asset.resourceType, type: 'authenticated', expires_at: expiresAt });
  res.json({ success: true, url, expiresAt, format: asset.format, filename: asset.originalFilename, label: asset.label });
});

export const deleteImage = asyncHandler(async (req, res) => {
  const publicId = req.params.publicId;
  const ownsProduct = req.user.role === 'vendor' && await Product.exists({ vendor: req.user._id, imagePublicId: publicId });
  const ownsVendorProfile = req.user.role === 'vendor' && req.user.vendor?.imagePublicId === publicId;
  const settings = req.user.role === 'admin' ? await Record.findOne({ kind: 'platform-setting', subject: 'global' }) : null;
  const ownsBanner = settings?.details?.bannerPublicId === publicId;
  if (!ownsProduct && !ownsVendorProfile && !ownsBanner) throw new AppError('Image not found', 404);
  await cloudinary.uploader.destroy(publicId, { resource_type: 'image', type: 'upload' });
  res.json({ success: true });
});
