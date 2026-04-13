// =============================================================================
// PROJECT ANTIGRAVITY — Lots API Routes
// =============================================================================

const express = require('express');
const router = express.Router();
const db = require('../../db/queries');

// GET /api/v1/lots — List lots (filterable by status, hunt_id)
router.get('/', async (req, res, next) => {
  try {
    const { status, hunt_id, limit, offset } = req.query;
    const parsedHuntId = hunt_id !== undefined ? parseInt(hunt_id, 10) : undefined;
    const parsedLimit = limit !== undefined ? parseInt(limit, 10) : 50;
    const parsedOffset = offset !== undefined ? parseInt(offset, 10) : 0;
    if ((hunt_id !== undefined && isNaN(parsedHuntId)) ||
        (limit !== undefined && isNaN(parsedLimit)) ||
        (offset !== undefined && isNaN(parsedOffset))) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'hunt_id, limit, and offset must be numbers' } });
    }
    const lots = await db.getLots({
      status,
      hunt_id: parsedHuntId,
      limit: parsedLimit,
      offset: parsedOffset,
    });
    res.json({ data: lots, count: lots.length });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/lots/:lotNumber — Get a lot by lot number
router.get('/:lotNumber', async (req, res, next) => {
  try {
    const lot = await db.getLotByNumber(req.params.lotNumber);
    if (!lot) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Lot not found' } });
    }
    res.json({ data: lot });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
