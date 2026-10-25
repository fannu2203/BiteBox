import User from '../models/User.js';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import Record from '../models/Record.js';
import DocumentAsset from '../models/DocumentAsset.js';
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { notify } from '../services/notify.js';
import { requireCloudinary } from '../config/cloudinary.js';

const paymentDateRange = (from, to, required = false) => {
  if (required && (!from || !to)) throw new AppError('Choose both a start and end date', 400);
  const range = {};
  if (from) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new AppError('Start date must use YYYY-MM-DD', 400);
    const start = new Date(`${from}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== from) throw new AppError('Start date is invalid', 400);
    range.$gte = start;
  }
  if (to) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new AppError('End date must use YYYY-MM-DD', 400);
    const end = new Date(`${to}T00:00:00.000Z`);
    if (Number.isNaN(end.getTime()) || end.toISOString().slice(0, 10) !== to) throw new AppError('End date is invalid', 400);
    end.setUTCDate(end.getUTCDate() + 1);
    range.$lt = end;
  }
  if (range.$gte && range.$lt && range.$gte >= range.$lt) throw new AppError('Start date must be on or before end date', 400);
  return Object.keys(range).length ? { createdAt: range } : {};
};

export const dashboard = asyncHandler(async (req, res) => {
  const { from, to, user } = req.query; const range = { ...(from || to ? { createdAt: { ...(from ? { $gte: new Date(from) } : {}), ...(to ? { $lte: new Date(to) } : {}) } } : {}) };
  const scoped = user ? { $or: [{ vendor: user }, { rider: user }] } : {};
  const [orders, pendingVendors, pendingRiders, customers, products, records, vendors, riders] = await Promise.all([
    Order.find({ ...range, ...scoped }), User.countDocuments({ role: 'vendor', status: 'pending' }), User.countDocuments({ role: 'rider', status: 'pending' }), User.countDocuments({ role: 'customer' }), Product.countDocuments(), Record.countDocuments({ kind: { $in: ['payment-submission','settlement'] }, status: 'pending' }), User.find({ role: 'vendor', status: 'active' }).select('name vendor.shopName vendor.currentBalance vendor.account'), User.find({ role: 'rider', status: 'active' }).select('name rider.rating rider.account')
  ]);
  const delivered = orders.filter(o => o.status === 'delivered');
  const revenue = delivered.reduce((s,o)=>s+(o.pricing?.subtotal||0),0), commission=delivered.reduce((s,o)=>s+(o.pricing?.commission||0),0), deliveryFees=delivered.reduce((s,o)=>s+(o.pricing?.deliveryFee||0),0);
  const paymentDue = await Order.aggregate([{ $match: { paymentStatus: { $in: ['collected','pending'] }, status: 'delivered' } }, { $group: { _id: null, amount: { $sum: '$pricing.total' } } }]);
  const grouped = await Order.aggregate([{ $match: range }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, orders: { $sum: 1 }, sales: { $sum: '$pricing.subtotal' }, commission: { $sum: '$pricing.commission' } } }, { $sort: { _id: 1 } }, { $limit: 366 }]);
  res.json({ success: true, analytics: { orders: orders.length, delivered: delivered.length, revenue, commission, deliveryFees, customerCount: customers, vendorCount: vendors.length, riderCount: riders.length, pendingVendors, pendingRiders, pendingPayments: records, cashToVerify: paymentDue[0]?.amount || 0, series: grouped, vendors, riders } });
});
export const applicants = asyncHandler(async (req, res) => { const users = await User.find({ role: { $in: ['vendor','rider'] }, ...(req.query.status ? { status: req.query.status } : { status: 'pending' }) }).sort('-createdAt'); res.json({ success: true, users }); });
export const decideApplicant = asyncHandler(async (req, res) => { const { decision, note } = req.body; const user = await User.findOne({ _id: req.params.id, role: { $in: ['vendor','rider'] }, status: 'pending' }); if (!user) throw new AppError('Pending application not found', 404); if (decision === 'verify-payment') { if (user.role !== 'vendor' || !user.vendor?.applicationPayment?.reference || !user.vendor?.applicationPayment?.proofUrl) throw new AppError('Vendor payment reference and proof are required before verification'); user.vendor.applicationPayment.verified = true; await user.save(); await notify(user._id, 'Signup payment verified', 'Your vendor signup payment has been verified', {}); return res.json({ success: true, user }); } if (!['active','rejected'].includes(decision)) throw new AppError('Choose approve, reject, or verify vendor payment'); if (decision === 'active' && user.role === 'vendor' && !user.vendor?.applicationPayment?.verified) throw new AppError('Verify the vendor signup payment before approving this account'); user.status = decision; user.approvedBy = req.user._id; user.approvedAt = decision === 'active' ? new Date() : undefined; await user.save(); await notify(user._id, `Application ${decision}`, note || `Your ${user.role} application was ${decision}`, {}); res.json({ success: true, user }); });
export const accounts = asyncHandler(async (req, res) => { const users = await User.find({ role: { $in: ['vendor','rider'] }, ...(req.query.status ? { status: req.query.status } : {}) }).sort('-createdAt'); res.json({ success: true, users }); });
export const updateAccount = asyncHandler(async (req, res) => { const { status, password, note, generateChallan, challanPaid } = req.body; const user = await User.findOne({ _id: req.params.id, role: { $in: ['vendor','rider'] } }).select('+password'); if (!user) throw new AppError('Account not found', 404); if (generateChallan) { const settings = await Record.findOne({ kind: 'platform-setting', subject: 'global' }); const amount = Number(settings?.details?.reactivationChallanAmount || 0); if (amount <= 0) throw new AppError('Set the reactivation challan amount in Platform settings first'); return res.json({ success: true, challan: { amount, currency: 'PKR', reference: `BB-${user._id.toString().slice(-6).toUpperCase()}`, reason: 'Reactivation payment' } }); } if (status && !['active','suspended','rejected'].includes(status)) throw new AppError('Invalid account state'); if (status === 'active' && user.status === 'suspended' && !challanPaid) throw new AppError('Verify the reactivation challan payment before reactivating this account'); if (status) user.status = status; if (password) { if (password.length < 8) throw new AppError('Password must be at least 8 characters'); user.password = password; } await user.save(); if (status) await notify(user._id, `Account ${status}`, note || `Your account was ${status} by admin`, {}); res.json({ success: true, user, challan: null }); });
export const paymentAccounts = asyncHandler(async (req, res) => { const users = await User.find({ role: { $in: ['vendor','rider'] }, status: 'active' }).select('name role vendor.shopName vendor.account rider.account'); res.json({ success: true, users }); });
export const updatePaymentAccount = asyncHandler(async (req, res) => { const user = await User.findById(req.params.id); if (!user || !['vendor','rider'].includes(user.role)) throw new AppError('Account not found',404); const account = req.body.account; if (user.role === 'vendor') user.vendor.account = account; else user.rider.account = account; await user.save(); res.json({ success: true }); });
export const records = asyncHandler(async (req, res) => { const match = {}; for (const k of ['kind','status','user']) if (req.query[k]) match[k] = req.query[k]; if (req.query.date) { const start = new Date(req.query.date); const end = new Date(start); end.setDate(end.getDate()+1); match.createdAt = { $gte: start, $lt: end }; } if (req.query.orderId) match.order = req.query.orderId; const rows = await Record.find(match).populate('user','name role phone vendor.shopName vendor.account rider.account').populate('order').sort('-createdAt').limit(300); res.json({ success: true, records: rows }); });
export const paymentRecords = asyncHandler(async (req, res) => {
  const rows = await Record.find({ kind: 'payment-submission', ...paymentDateRange(req.query.from, req.query.to) })
    .populate('user', 'name role phone vendor.shopName vendor.account rider.account').sort('createdAt').lean();
  const assetIds = rows.map(row => row.proofUrl).filter(id => /^[a-f\d]{24}$/i.test(String(id || '')));
  const assets = assetIds.length ? await DocumentAsset.find({ _id: { $in: assetIds }, fieldName: 'payment.proof' }).lean() : [];
  const assetById = new Map(assets.map(asset => [String(asset._id), asset]));
  const client = assets.length ? requireCloudinary() : null;
  const records = rows.map(row => {
    const candidate = assetById.get(String(row.proofUrl));
    const asset = candidate && String(candidate.owner) === String(row.user?._id || row.user) ? candidate : null;
    const proofUrl = asset
      ? client.utils.private_download_url(asset.publicId, asset.format, { resource_type: asset.resourceType, type: 'authenticated', expires_at: Math.floor(Date.now() / 1000) + 300 })
      : /^https?:\/\//i.test(String(row.proofUrl || '')) ? row.proofUrl : '';
    return { ...row, proofUrl, proofFormat: asset?.format || '', proofFilename: asset?.originalFilename || '' };
  });
  res.json({ success: true, records });
});
export const purgePaymentRecords = asyncHandler(async (req, res) => {
  const range = paymentDateRange(req.query.from, req.query.to, true);
  const rows = await Record.find({ kind: 'payment-submission', ...range }).select('proofUrl user').lean();
  const ids = rows.map(row => row.proofUrl).filter(id => /^[a-f\d]{24}$/i.test(String(id || '')));
  const owners = rows.map(row => row.user).filter(Boolean);
  let assets = ids.length ? await DocumentAsset.find({ _id: { $in: ids }, owner: { $in: owners }, fieldName: 'payment.proof' }).lean() : [];
  if (assets.length) {
    const rowIds = rows.map(row => row._id);
    const stillReferenced = await Record.distinct('proofUrl', { kind: 'payment-submission', _id: { $nin: rowIds }, proofUrl: { $in: assets.map(asset => String(asset._id)) } });
    const retained = new Set(stillReferenced);
    assets = assets.filter(asset => !retained.has(String(asset._id)));
    if (assets.length) {
      const client = requireCloudinary();
      const results = await Promise.all(assets.map(asset => client.uploader.destroy(asset.publicId, { resource_type: asset.resourceType, type: 'authenticated' })));
      if (results.some(result => !['ok','not found'].includes(result.result))) throw new AppError('Cloudinary did not confirm deletion of every linked screenshot; payment records were kept', 502);
      await DocumentAsset.deleteMany({ _id: { $in: assets.map(asset => asset._id) } });
    }
  }
  const result = await Record.deleteMany({ kind: 'payment-submission', ...range });
  res.json({ success: true, deletedRecords: result.deletedCount, deletedScreenshots: assets.length });
});
export const submitPayment = asyncHandler(async (req, res) => { const row = await Record.findById(req.params.id); if (!row || !['payment-submission','settlement'].includes(row.kind)) throw new AppError('Payment request not found',404); if (!['verified','rejected','pending'].includes(req.body.status)) throw new AppError('Invalid payment status'); row.status = req.body.status; row.reference = req.body.reference || row.reference; row.details = { ...(row.details||{}), adminNote: req.body.note }; await row.save(); if (row.status === 'verified' && row.user) { const user = await User.findById(row.user); if (row.details?.direction === 'topup' && user?.role === 'vendor') { user.vendor.currentBalance = (user.vendor.currentBalance || 0) + Number(row.amount || 0); await user.save(); } if (row.details?.direction === 'collection-remittance' && row.details?.orderIds?.length) await Order.updateMany({ _id: { $in: row.details.orderIds } }, { paymentStatus: 'verified' }); } if (row.user) await notify(row.user, `Payment ${row.status}`, req.body.note || `Your payment request is ${row.status}`, { payment: row._id }); res.json({ success: true, record: row }); });
export const generateVendorPayouts = asyncHandler(async(req,res)=>{let from=req.query.from?new Date(req.query.from):new Date();let to=req.query.to?new Date(req.query.to):new Date();if(!req.query.from){const day=(from.getDay()+6)%7;to.setDate(to.getDate()-day);to.setHours(0,0,0,0);from=new Date(to);from.setDate(from.getDate()-7)}const batchKey=`vendor-payout:${from.toISOString().slice(0,10)}:${to.toISOString().slice(0,10)}`;const orders=await Order.find({status:'delivered',deliveredAt:{$gte:from,$lt:to}});const byVendor=new Map();for(const order of orders){const x=byVendor.get(String(order.vendor))||{amount:0,orderIds:[]};x.amount+=Number(order.pricing?.subtotal||0);x.orderIds.push(order._id);byVendor.set(String(order.vendor),x)}let created=0;for(const [id,group] of byVendor){if(await Record.exists({kind:'settlement',user:id,'details.batchKey':batchKey}))continue;const vendor=await User.findById(id).select('name vendor.shopName vendor.account');await Record.create({kind:'settlement',user:id,amount:group.amount,status:'pending',message:'Vendor weekly sales payout',details:{direction:'vendor-sales-payout',batchKey,from,to,orderIds:group.orderIds,account:vendor?.vendor?.account}});if(vendor){created++;await notify(vendor._id,'Weekly payout ready',`A weekly sales payout of Rs. ${Math.round(group.amount).toLocaleString()} is ready for admin transfer`,{batchKey})}}res.json({success:true,created,from,to,batchKey});});
export const updateSettings = asyncHandler(async (req,res)=>{ const row=await Record.findOneAndUpdate({kind:'platform-setting',subject:'global'},{$set:{details:req.body}},{upsert:true,new:true}); res.json({success:true,settings:row.details}); });
export const getSettings = asyncHandler(async (_req,res)=>{ const row=await Record.findOne({kind:'platform-setting',subject:'global'}); res.json({success:true,settings:{brandName:'Bite Box',bannerImage:'',commissionCap:Number(process.env.MAX_COMMISSION_RUPEES||500),minimumVendorTopUp:1500,minimumVendorBalance:200,deliveryRatePerKm:Number(process.env.DELIVERY_RATE_PER_KM||10),riderRadiusKm:Number(process.env.RIDER_RADIUS_KM||3),reactivationChallanAmount:0,...(row?.details||{})}}); });
export const getPublicSettings = asyncHandler(async (_req,res)=>{ const row=await Record.findOne({kind:'platform-setting',subject:'global'}); const s=row?.details||{}; res.json({success:true,settings:{brandName:s.brandName||'Bite Box',bannerImage:s.bannerImage||'',commissionCap:Number(s.commissionCap??process.env.MAX_COMMISSION_RUPEES??500),minimumVendorTopUp:Number(s.minimumVendorTopUp||1500),minimumVendorBalance:Number(s.minimumVendorBalance||200),deliveryRatePerKm:Number(s.deliveryRatePerKm||process.env.DELIVERY_RATE_PER_KM||10),riderRadiusKm:Number(s.riderRadiusKm||process.env.RIDER_RADIUS_KM||3)}}); });
export const exportOrders = asyncHandler(async (req,res)=>{ const orders=await Order.find(req.query.from||req.query.to?{createdAt:{...(req.query.from?{$gte:new Date(req.query.from)}:{}),...(req.query.to?{$lte:new Date(req.query.to)}:{})}}:{}).populate('customer vendor rider','name phone role').sort('createdAt'); const fields=['id','createdAt','status','customer','vendor','rider','subtotal','deliveryFee','commission','total','paymentMethod','paymentStatus']; const csv=[fields.join(','),...orders.map(o=>[o._id,o.createdAt.toISOString(),o.status,o.customer?.name,o.vendor?.vendor?.shopName||o.vendor?.name,o.rider?.name,o.pricing.subtotal,o.pricing.deliveryFee,o.pricing.commission,o.pricing.total,o.paymentMethod,o.paymentStatus].map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(','))].join('\n'); res.setHeader('Content-Type','text/csv'); res.setHeader('Content-Disposition','attachment; filename="bite-box-orders.csv"'); res.send(csv); });
export const exportRecords = asyncHandler(async (req,res)=>{ const filter=req.query.from||req.query.to?{createdAt:{...(req.query.from?{$gte:new Date(req.query.from)}:{}),...(req.query.to?{$lte:new Date(req.query.to)}:{})}}:{}; const rows=await Record.find(filter).populate('user','name role').sort('createdAt'); const fields=['id','createdAt','type','user','amount','status','method','reference','message','subject','details']; const csv=[fields.join(','),...rows.map(r=>[r._id,r.createdAt.toISOString(),r.kind,r.user?.name,r.amount,r.status,r.method,r.reference,r.message,r.subject,JSON.stringify(r.details||{})].map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(','))].join('\n'); res.setHeader('Content-Type','text/csv'); res.setHeader('Content-Disposition','attachment; filename="bite-box-financial-records.csv"'); res.send(csv); });
export const purgeOldRecords = asyncHandler(async (_req,res)=>{ const cutoff=new Date(); cutoff.setFullYear(cutoff.getFullYear()-5); const result=await Order.deleteMany({createdAt:{$lt:cutoff}}); await Record.deleteMany({createdAt:{$lt:cutoff}}); res.json({success:true,deletedOrders:result.deletedCount,cutoff}); });
