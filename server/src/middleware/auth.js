import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';

export const protect = asyncHandler(async (req, res, next) => {
  const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
  if (!token) throw new AppError('Please sign in to continue', 401);
  let payload;
  try { payload = jwt.verify(token, process.env.JWT_SECRET); } catch { throw new AppError('Session expired. Please sign in again.', 401); }
  const user = await User.findById(payload.id);
  if (!user || user.status !== 'active') throw new AppError('This account is not active', 403);
  req.user = user; next();
});
export const allowRoles = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) return next(new AppError('You do not have access to this resource', 403));
  next();
};
