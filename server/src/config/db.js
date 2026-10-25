import mongoose from 'mongoose';
import User from '../models/User.js';

export default async function connectDB() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  await mongoose.connect(process.env.MONGODB_URI);
  const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase();
  if (adminEmail && process.env.ADMIN_PASSWORD && !(await User.exists({ email: adminEmail, role: 'admin' }))) {
    await User.create({ name: 'Bite Box Admin', email: adminEmail, phone: 'admin', password: process.env.ADMIN_PASSWORD, role: 'admin', status: 'active' });
    console.log(`Initial admin created for ${adminEmail}`);
  }
  console.log(`MongoDB connected: ${mongoose.connection.host}`);
}
