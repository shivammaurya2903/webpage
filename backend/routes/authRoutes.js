const router = require('express').Router();
const { body } = require('express-validator');
const { register, login, profile } = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const { validateRequest } = require('../middleware/validate');

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
    body('name').trim().isLength({ min: 2 }).withMessage('Name is required'),
    body('email').isEmail().withMessage('Valid email is required'),
    body('phone')
      .trim()
      .custom((value) => {
        if (!normalizeIndianPhone(value)) {
          throw new Error('Valid phone number is required');
        }
        return true;
      }),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
  ],
  validateRequest,
  register
);

router.post(
  '/login',
  [
    body('email').isEmail().withMessage('Valid email is required'),
    body('password').notEmpty().withMessage('Password is required')
  ],
  validateRequest,
  login
);

router.get('/profile', protect, profile);

module.exports = router;