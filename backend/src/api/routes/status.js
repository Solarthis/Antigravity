// =============================================================================
// PROJECT ANTIGRAVITY — Status & Logs API Routes
// =============================================================================

const express = require('express');
const router = express.Router();
const db = require('../../db/queries');

// GET /api/v1/status — System health and aggregate metrics
router.get('/', async (req, res, next) => {
  try {
    const status = await db.getSystemStatus();
    res.json({
      data: {
        ...status,
        server: {
          uptime: process.uptime(),
          memoryUsage: process.memoryUsage(),
          nodeVersion: process.version,
          timestamp: new Date().toISOString(),
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/logs — Scrape run history
router.get('/logs', async (req, res, next) => {
  try {
    const { status, limit, offset } = req.query;
    const parsedLimit = limit !== undefined ? parseInt(limit, 10) : 50;
    const parsedOffset = offset !== undefined ? parseInt(offset, 10) : 0;
    if ((limit !== undefined && isNaN(parsedLimit)) ||
        (offset !== undefined && isNaN(parsedOffset))) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'limit and offset must be numbers' } });
    }
    const logs = await db.getScrapeLogs({
      status,
      limit: parsedLimit,
      offset: parsedOffset,
    });
    res.json({ data: logs, count: logs.length });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/status/stream — Server-Sent Events for real-time dashboard updates
router.get('/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const sendUpdate = async () => {
    try {
      const [status, logs, hunts, lots, alerts] = await Promise.all([
        db.getSystemStatus(),
        db.getScrapeLogs({ limit: 15 }),
        db.getAllHunts(),
        db.getLots({ limit: 50 }),
        db.getAlerts({ limit: 20 }),
      ]);
      
      const payload = {
        status: {
          ...status,
          server: {
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
          },
        },
        logs,
        hunts,
        lots,
        alerts,
      };

      res.write(`data: ${JSON.stringify({ data: payload })}\n\n`);
    } catch (err) {
      console.error('[SSE] Error sending update:', err);
    }
  };

  // Send immediately
  sendUpdate();

  // Then send every 30 seconds
  const timerId = setInterval(sendUpdate, 30000);

  req.on('close', () => {
    clearInterval(timerId);
  });
});

module.exports = router;
