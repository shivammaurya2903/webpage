const router = require('express').Router();
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { register, login, profile, requestPasswordReset, resetPassword, logout } = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const { validateRequest } = require('../middleware/validate');

const authActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many authentication attempts. Please try again later.' }
});

const authSignupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many registration attempts. Please try again later.' }
});

function normalizeIndianPhone(value) {
  const cleaned = String(value || '').trim().replace(/[\s-]/g, '');
  if (!cleaned || /[^+0-9]/.test(cleaned)) return '';

  let digits = cleaned.startsWith('+') ? cleaned.slice(1) : cleaned;
  if (digits.startsWith('91') && digits.length === 12) {
    digits = digits.slice(2);
  }

  return /^[6-9][0-9]{9}$/.test(digits) ? `+91${digits}` : '';
}

router.post(
  '/register',
  [
    body('name').trim().isLength({ min: 2, max: 120 }).withMessage('Name is required'),
    body('email').trim().isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('phone')
      .trim()
      .custom((value) => {
        if (!normalizeIndianPhone(value)) {
          throw new Error('Valid phone number is required');
        }
        return true;
      }),
    body('password').isLength({ min: 8, max: 128 }).withMessage('Password must be at least 8 characters')
  ],
  authSignupLimiter,
  validateRequest,
  register
);

router.post(
  '/login',
  [
    body('email').trim().isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 1, max: 128 }).withMessage('Password is required')
  ],
  authActionLimiter,
  validateRequest,
  login
);

router.post(
  '/forgot-password',
  [body('email').trim().isEmail().normalizeEmail().withMessage('Valid email is required')],
  authActionLimiter,
  validateRequest,
  requestPasswordReset
);

router.post(
  '/reset-password',
  [
    body('token').trim().isLength({ min: 10, max: 200 }).withMessage('Reset token is required'),
    body('password').isLength({ min: 8, max: 128 }).withMessage('Password must be at least 8 characters')
  ],
  authActionLimiter,
  validateRequest,
  resetPassword
);

router.get('/profile', protect, profile);
router.post('/logout', logout);

module.exports = router;