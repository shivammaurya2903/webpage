const router = require('express').Router();
const { body, query } = require('express-validator');
const { calculateFare, geocodeLocation, reverseGeocodeLocation } = require('../controllers/fareController');
const { validateRequest } = require('../middleware/validate');

router.post(
  '/calculate',
  [
    body('pickup').notEmpty().withMessage('pickup is required'),
    body('drop').notEmpty().withMessage('drop is required')
  ],
  validateRequest,
  calculateFare
);

router.get('/geocode', [query('query').optional().isString()], validateRequest, geocodeLocation);
router.get(
  '/reverse-geocode',
  [query('lng').optional().isFloat(), query('lat').optional().isFloat()],
  validateRequest,
  reverseGeocodeLocation
);

module.exports = router;