import Order from '../models/Order.js';
import Product from '../models/Product.js';
import User from '../models/User.js';
import Record from '../models/Record.js';
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { quoteOrder } from '../utils/pricing.js';
import { notify } from '../services/notify.js';

const populateOrder = q => q.populate('customer', 'name phone').populate('vendor', 'name phone vendor.shopName vendor.location').populate('rider', 'name phone rider.location rider.rating');
const platformSettings = async () => (await Record.findOne({ kind: 'platform-setting', subject: 'global' }))?.details || {};
export const quote = asyncHandler(async (req, res) => { const { items = [], distanceKm = 2 } = req.body; const products = await Product.find({ _id: { $in: items.map(i => i.product) }, available: true, stock: { $gt: 0 } }); const subtotal = items.reduce((sum, i) => { if (!Number.isInteger(i.quantity) || i.quantity < 1) throw new AppError('Item quantities must be positive whole numbers'); const p = products.find(x => String(x._id) === String(i.product)); if (!p || p.stock < i.quantity) throw new AppError('An item is unavailable or has insufficient stock', 409); return sum + p.price * i.quantity * (1 - p.salePercent / 100); }, 0); res.json({ success: true, pricing: quoteOrder({ subtotal, distanceKm, settings: await platformSettings() }) }); });
export const createOrder = asyncHandler(async (req, res) => {
  const { vendor: vendorId, items = [], address, deliveryLocation, distanceKm = 2, paymentMethod } = req.body;
  if (!address || !items.length || !['cod', 'jazzcash', 'easypaisa'].includes(paymentMethod)) throw new AppError('Address, items, and a valid payment method are required');
  const vendor = await User.findOne({ _id: vendorId, role: 'vendor', status: 'active' }); if (!vendor) throw new AppError('Vendor is unavailable', 404);
  const currentSettings = await platformSettings();
  if ((vendor.vendor?.currentBalance || 0) < Number(currentSettings.minimumVendorBalance ?? 200)) throw new AppError('This kitchen is temporarily not accepting orders while it updates its balance', 409);
  const products = await Product.find({ _id: { $in: items.map(i => i.product) }, vendor: vendorId, available: true });
  if (products.length !== items.length) throw new AppError('Your cart contains unavailable items', 409);
  const orderItems = items.map(i => { const p = products.find(x => String(x._id) === String(i.product)); if (!Number.isInteger(i.quantity) || i.quantity < 1) throw new AppError('Item quantities must be positive whole numbers'); if (!p || p.stock < i.quantity) throw new AppError(`${p?.name || 'An item'} is out of stock`, 409); return { product: p._id, name: p.name, image: p.image, unitPrice: p.price * (1 - p.salePercent / 100), quantity: i.quantity }; });
  const reserved = [];
  for (const item of orderItems) {
    const result = await Product.updateOne({ _id: item.product, vendor: vendorId, available: true, stock: { $gte: item.quantity } }, { $inc: { stock: -item.quantity } });
    if (!result.modifiedCount) {
      await Promise.all(reserved.map(i => Product.updateOne({ _id: i.product }, { $inc: { stock: i.quantity } })));
      throw new AppError(`${item.name} is out of stock`, 409);
    }
    reserved.push(item);
  }
  const subtotal = orderItems.reduce((s, i) => s + i.unitPrice * i.quantity, 0); const pricing = quoteOrder({ subtotal, distanceKm, settings: currentSettings });
  let order;
  try { order = await Order.create({ customer: req.user._id, vendor: vendorId, items: orderItems, address, deliveryLocation, distanceKm, pricing, paymentMethod, status: 'placed', statusHistory: [{ status: 'placed', actor: req.user._id }] }); }
  catch (error) { await Promise.all(reserved.map(i => Product.updateOne({ _id: i.product }, { $inc: { stock: i.quantity } }))); throw error; }
  await Promise.all([notify(vendor._id, 'New order', `Order ${order._id.toString().slice(-7)} is ready for review`, { order: order._id }), notify(req.user._id, 'Order placed', 'Your order has been sent to the vendor', { order: order._id })]);
  res.status(201).json({ success: true, order: await populateOrder(Order.findById(order._id)) });
});
export const listOrders = asyncHandler(async (req, res) => {
  const filter = req.user.role === 'customer' ? { customer: req.user._id } : req.user.role === 'vendor' ? { vendor: req.user._id } : req.user.role === 'rider' ? { $or: [{ rider: req.user._id }, { rider: null, status: 'ready' }] } : {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.id) filter._id = req.query.id;
  if (req.query.from || req.query.to) filter.createdAt = { ...(req.query.from ? { $gte: new Date(req.query.from) } : {}), ...(req.query.to ? { $lte: new Date(req.query.to) } : {}) };
  const orders = await populateOrder(Order.find(filter).sort('-createdAt').limit(100)); res.json({ success: true, orders });
});
export const getOrder = asyncHandler(async (req, res) => { const order = await populateOrder(Order.findById(req.params.id)); if (!order) throw new AppError('Order not found', 404); const own = [order.customer?._id, order.vendor?._id, order.rider?._id].some(id => String(id) === String(req.user._id)); if (req.user.role !== 'admin' && !own) throw new AppError('Order not found', 404); res.json({ success: true, order }); });
export const updateOrderStatus = asyncHandler(async (req, res) => {
  const { status, note } = req.body; const order = await Order.findById(req.params.id); if (!order) throw new AppError('Order not found', 404);
  const vendorSteps = ['preparing', 'ready', 'rejected']; const riderSteps = ['picked_up', 'on_the_way', 'arrived', 'delivered'];
  if (req.user.role === 'vendor') { const next={placed:['preparing','rejected'],preparing:['ready']}; if (!next[order.status]?.includes(status)) throw new AppError('Vendor order actions must follow the preparation sequence'); }
  if (req.user.role === 'vendor' && (String(order.vendor) !== String(req.user._id) || !vendorSteps.includes(status))) throw new AppError('Invalid vendor order action', 403);
  if (req.user.role === 'rider' && (!['picked_up','on_the_way','arrived','delivered'].includes(status) || !order.rider || String(order.rider) !== String(req.user._id))) throw new AppError('Accept the order before updating its delivery status', 403);
  if (req.user.role === 'rider') { const next={picked_up:['on_the_way'],on_the_way:['arrived'],arrived:['delivered']}; if (!next[order.status]?.includes(status)) throw new AppError('Update the delivery in order: picked up, on the way, arrived, delivered'); }
  if (req.user.role === 'rider' && status === 'picked_up') order.rider = req.user._id;
  if (req.user.role === 'admin' && !['cancelled','preparing','ready','rejected'].includes(status)) throw new AppError('Invalid admin order action');
  if (status === 'delivered') { if (order.status !== 'arrived') throw new AppError('Rider must mark the order arrived before completing delivery'); order.deliveredAt = new Date(); order.paymentStatus = 'collected'; const vendor = await User.findById(order.vendor); const debit = order.pricing.deliveryFee + order.pricing.commission; if (vendor?.vendor) { vendor.vendor.currentBalance = Math.max(0, (vendor.vendor.currentBalance || 0) - debit); await vendor.save(); } }
  const releaseStock = ['rejected','cancelled'].includes(status) && !['delivered','rejected','cancelled'].includes(order.status);
  if (releaseStock) await Product.bulkWrite(order.items.map(i => ({ updateOne: { filter: { _id: i.product }, update: { $inc: { stock: i.quantity } } } })));
  if (status === 'cancelled' && req.user.role !== 'admin') throw new AppError('Only admin can cancel after checkout');
  order.status = status; order.statusHistory.push({ status, actor: req.user._id, note }); await order.save(); await notify(order.customer, `Order ${status.replaceAll('_',' ')}`, `Your order is now ${status.replaceAll('_',' ')}`, { order: order._id });
  res.json({ success: true, order: await populateOrder(Order.findById(order._id)) });
});
export const claimOrder = asyncHandler(async (req, res) => { const order = await Order.findOneAndUpdate({ _id: req.params.id, status: 'ready', $or: [{ rider: null }, { rider: req.user._id }] }, { rider: req.user._id, status: 'picked_up', $push: { statusHistory: { status: 'picked_up', actor: req.user._id } } }, { new: true }); if (!order) throw new AppError('Order is no longer available', 409); res.json({ success: true, order }); });
export const trackRider = asyncHandler(async (req, res) => { const order = await Order.findOne({ _id: req.params.id, rider: req.user._id }); if (!order) throw new AppError('Order not found', 404); order.riderLocation = { ...req.body.location, updatedAt: new Date() }; if (req.user.rider) { req.user.rider.location = req.body.location; await req.user.save(); } await order.save(); res.json({ success: true, location: order.riderLocation }); });
export const feedback = asyncHandler(async (req, res) => { const order = await Order.findOne({ _id: req.params.id, customer: req.user._id, status: 'delivered' }); if (!order) throw new AppError('Feedback is available after delivery', 400); const { brand, vendor, rider, rating, message } = req.body; await Promise.all([Record.create({ kind: 'feedback', user: req.user._id, order: order._id, rating, message, details: { brand, vendor, rider } }), ...(brand ? [Record.create({ kind: 'feedback', order: order._id, message: brand, details: { category: 'brand' } })] : []), ...(vendor ? [Record.create({ kind: 'feedback', user: order.vendor, order: order._id, message: vendor, details: { category: 'vendor' } })] : []), ...(rider ? [Record.create({ kind: 'feedback', user: order.rider, order: order._id, rating, message: rider, details: { category: 'rider' } })] : [])]); if (rating && order.rider) { const user = await User.findById(order.rider); const oldCount = user.rider.ratingCount || 0; user.rider.rating = ((user.rider.rating * oldCount) + Number(rating)) / (oldCount + 1); user.rider.ratingCount = oldCount + 1; await user.save(); } await notify(order.vendor, 'Customer feedback', `Feedback received for order ${order._id.toString().slice(-7)}`, { order: order._id, vendor }); if (order.rider) await notify(order.rider, 'Customer feedback', 'A customer left feedback on your delivery', { order: order._id, rider }); res.status(201).json({ success: true }); });
