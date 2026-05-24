const router = require('express').Router();
const { body } = require('express-validator');
const { createContact } = require('../controllers/contactController');
const { validateRequest } = require('../middleware/validate');

router.post(
  '/',
  [
    body('name').trim().isLength({ min: 2 }).withMessage('Name is required'),
    body('email').isEmail().withMessage('Valid email is required'),
    body('phone').matches(/^\+?[0-9]{10,15}$/).withMessage('Valid phone number is required'),
    body('message').trim().isLength({ min: 8 }).withMessage('Message is required')
  ],
  validateRequest,
  createContact
);

module.exports = router;