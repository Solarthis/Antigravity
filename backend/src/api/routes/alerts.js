// =============================================================================
// PROJECT ANTIGRAVITY — Alerts API Routes
// =============================================================================

const express = require('express');
const router = express.Router();
const db = require('../../db/queries');

// GET /api/v1/alerts — List alerts with optional filtering
router.get('/', async (req, res, next) => {
  try {
    const { status, lot_id, limit, offset } = req.query;
    const alerts = await db.getAlerts({
      status,
      lot_id: lot_id ? parseInt(lot_id, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
    });
    res.json({ data: alerts, count: alerts.length });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
