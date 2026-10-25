import multer from 'multer';
import AppError from '../utils/AppError.js';

const allowedImages = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const allowedDocuments = new Set([...allowedImages, 'application/pdf']);
const storage = multer.memoryStorage();
const makeUpload = (allowed, maxFiles = 1) => multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: maxFiles },
  fileFilter: (_req, file, cb) => allowed.has(file.mimetype)
    ? cb(null, true)
    : cb(new AppError('Choose a JPG, PNG, WEBP, AVIF, or PDF file', 415)),
});

export const imageUpload = makeUpload(allowedImages).single('file');
export const documentUpload = makeUpload(allowedDocuments).single('file');
export const signupDocuments = makeUpload(allowedDocuments, 16).fields([
  'cnicFront', 'cnicBack', 'utilityBill', 'foodLicenseDocument', 'applicationPaymentProof',
  'vehiclePhoto', 'vehicleRegistrationFront', 'vehicleRegistrationBack', 'licenseFront', 'licenseBack',
].map(name => ({ name, maxCount: 1 })));

export function handleUploadError(err, _req, res, next) {
  if (err instanceof multer.MulterError) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ success: false, message: err.code === 'LIMIT_FILE_SIZE' ? 'File exceeds the 10 MB limit' : err.message });
  next(err);
}
