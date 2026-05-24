const router = require('express').Router();
const { protect, authorize } = require('../middleware/auth');
const { getDashboard } = require('../controllers/dashboardController');

router.use(protect, authorize('admin'));

router.get('/dashboard', getDashboard);

module.exports = router;