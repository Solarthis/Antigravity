// =============================================================================
// PROJECT ANTIGRAVITY — Hunts API Routes
// =============================================================================

const express = require('express');
const router = express.Router();
const db = require('../../db/queries');

// GET /api/v1/hunts — List all hunts
router.get('/', async (req, res, next) => {
  try {
    const hunts = await db.getAllHunts();
    res.json({ data: hunts, count: hunts.length });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/hunts/:id — Get a single hunt
router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid ID parameter' } });
    }
    const hunt = await db.getHuntById(id);
    if (!hunt) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Hunt not found' } });
    }
    res.json({ data: hunt });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/hunts — Create a new hunt
router.post('/', async (req, res, next) => {
  try {
    const { name, make, model, year_min, year_max, body_style, keywords, max_bid } = req.body;
    if (!name || !make || !model) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'name, make, and model are required' },
      });
    }
    const parsedYearMin = year_min !== undefined ? parseInt(year_min, 10) : null;
    const parsedYearMax = year_max !== undefined ? parseInt(year_max, 10) : null;
    const parsedMaxBid = max_bid !== undefined ? parseFloat(max_bid) : null;
    if ((year_min !== undefined && isNaN(parsedYearMin)) ||
        (year_max !== undefined && isNaN(parsedYearMax)) ||
        (max_bid !== undefined && isNaN(parsedMaxBid))) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'year_min, year_max, and max_bid must be valid numbers' },
      });
    }

    const hunt = await db.createHunt({
      name, make, model, year_min: parsedYearMin, year_max: parsedYearMax, body_style, keywords, max_bid: parsedMaxBid,
    });
    res.status(201).json({ data: hunt });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/hunts/:id — Update a hunt
router.patch('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid ID parameter' } });
    }
    const hunt = await db.updateHunt(id, req.body);
    if (!hunt) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Hunt not found' } });
    }
    res.json({ data: hunt });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
