const router = require('express').Router();
const { getDashboard, getStats, getViolationsByType } = require('../controllers/analyticsController');
const { protect } = require('../middleware/authMiddleware');
const { checkRole } = require('../middleware/roleMiddleware');
router.use(protect);
router.get('/dashboard', getDashboard);
router.get('/stats', checkRole(['admin']), getStats);
router.get('/by-type', checkRole(['admin']), getViolationsByType);
module.exports = router;
