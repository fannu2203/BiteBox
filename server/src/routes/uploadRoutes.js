import { Router } from 'express';
import { protect, allowRoles } from '../middleware/auth.js';
import { documentAccess, deleteImage, listDocuments, uploadDocument, uploadImage, uploadPaymentProof } from '../controllers/uploadController.js';
import { documentUpload, imageUpload } from '../middleware/fileUploads.js';

const router = Router();
router.use(protect);
router.post('/images', allowRoles('vendor','admin'), imageUpload, uploadImage);
router.delete('/images/:publicId', allowRoles('vendor','admin'), deleteImage);
router.post('/documents', allowRoles('admin','vendor','rider'), documentUpload, uploadDocument);
router.post('/payment-proof', allowRoles('vendor','rider'), documentUpload, uploadPaymentProof);
router.get('/documents', allowRoles('vendor','rider','admin'), listDocuments);
router.get('/documents/:id/access', allowRoles('vendor','rider','admin'), documentAccess);
export default router;
