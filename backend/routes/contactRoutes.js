const router = require('express').Router();
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { createContact } = require('../controllers/contactController');
const { validateRequest } = require('../middleware/validate');

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many messages submitted. Please try again later.' }
});

router.post(
  '/',
  [
    body('name').trim().isLength({ min: 2, max: 120 }).withMessage('Name is required'),
    body('email').trim().isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('phone').matches(/^\+?[0-9]{10,15}$/).withMessage('Valid phone number is required'),
    body('subject').optional({ checkFalsy: true }).trim().isLength({ min: 2, max: 120 }).withMessage('Subject is too long'),
    body('message').trim().isLength({ min: 8, max: 2000 }).withMessage('Message is required')
  ],
  contactLimiter,
  validateRequest,
  createContact
);

module.exports = router;