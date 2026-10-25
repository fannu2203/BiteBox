import { Router } from 'express'; import { signup, login, me, updateProfile } from '../controllers/authController.js'; import { protect } from '../middleware/auth.js';
import { signupDocuments } from '../middleware/fileUploads.js';
const router=Router(); router.post('/signup',signupDocuments,signup); router.post('/login',login); router.get('/me',protect,me); router.patch('/profile',protect,updateProfile); export default router;
