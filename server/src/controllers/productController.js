import Product from '../models/Product.js';
import User from '../models/User.js';
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';

export const listProducts = asyncHandler(async (req, res) => {
  const { search, vendor, category, limit = 48 } = req.query;
  const filter = { available: true };
  if (category) filter.category = new RegExp(category, 'i');
  if (vendor) filter.vendor = vendor;
  if (search) {
    const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const vendors = await User.find({ role: 'vendor', status: 'active', $or: [{ name: regex }, { 'vendor.shopName': regex }] }).select('_id');
    filter.$or = [{ name: regex }, { description: regex }, { vendor: { $in: vendors.map(v => v._id) } }];
  }
  const [products, vendors] = await Promise.all([Product.find(filter).limit(Math.min(+limit, 100)).populate('vendor', 'name vendor.shopName vendor.image vendor.location'), User.find({ role: 'vendor', status: 'active', ...(search ? { $or: [{ name: new RegExp(search, 'i') }, { 'vendor.shopName': new RegExp(search, 'i') }] } : {}) }).select('name vendor.shopName vendor.image vendor.shopAddress vendor.location').sort({ updatedAt: -1 }).limit(100)]);
  res.json({ success: true, products, vendors });
});
export const myProducts = asyncHandler(async (req, res) => res.json({ success: true, products: await Product.find({ vendor: req.user._id }).sort('-updatedAt') }));
export const createProduct = asyncHandler(async (req, res) => { const product = await Product.create({ ...req.body, vendor: req.user._id }); res.status(201).json({ success: true, product }); });
export const updateProduct = asyncHandler(async (req, res) => { const product = await Product.findOneAndUpdate({ _id: req.params.id, vendor: req.user._id }, req.body, { new: true, runValidators: true }); if (!product) throw new AppError('Product not found', 404); res.json({ success: true, product }); });
export const deleteProduct = asyncHandler(async (req, res) => { const product = await Product.findOneAndDelete({ _id: req.params.id, vendor: req.user._id }); if (!product) throw new AppError('Product not found', 404); res.json({ success: true }); });
