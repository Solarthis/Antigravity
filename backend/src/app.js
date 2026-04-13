// =============================================================================
// PROJECT ANTIGRAVITY — Express Application
// =============================================================================

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const requestLogger = require('./api/middleware/logger');
const errorHandler = require('./api/middleware/errorHandler');

// Route modules
const huntsRouter = require('./api/routes/hunts');
const lotsRouter = require('./api/routes/lots');
const alertsRouter = require('./api/routes/alerts');
const statusRouter = require('./api/routes/status');

const app = express();

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(helmet({
  contentSecurityPolicy: false, // Allow inline scripts for dashboard
  crossOriginEmbedderPolicy: false,
}));
app.use(cors());
app.use(express.json());
app.use(requestLogger);

// ---------------------------------------------------------------------------
// Static files — Frontend dashboard
// ---------------------------------------------------------------------------
app.use(express.static(path.resolve(__dirname, '../../frontend')));

// ---------------------------------------------------------------------------
// API Routes — v1
// ---------------------------------------------------------------------------
app.use('/api/v1/hunts', huntsRouter);
app.use('/api/v1/lots', lotsRouter);
app.use('/api/v1/alerts', alertsRouter);
app.use('/api/v1/status', statusRouter);

// Scrape trigger route (requires pipeline injection)
let scrapePipeline = null;

app.post('/api/v1/scrape/trigger', async (req, res, next) => {
  try {
    if (!scrapePipeline) {
      return res.status(503).json({
        error: { code: 'NOT_READY', message: 'Scrape pipeline not initialized' },
      });
    }
    const { triggerManualRun } = require('./cron/scheduler');
    const result = await triggerManualRun(scrapePipeline);
    if (!result) {
      return res.status(409).json({
        error: { code: 'JOB_LOCKED', message: 'Another scrape job is currently running' },
      });
    }
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * Register the scrape pipeline for manual trigger endpoint.
 * @param {Function} pipeline
 */
app.setScrapePipeline = function (pipeline) {
  scrapePipeline = pipeline;
};

// ---------------------------------------------------------------------------
// Fallback — serve dashboard for all non-API routes
// ---------------------------------------------------------------------------
app.get('/{*path}', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  }
  res.sendFile(path.resolve(__dirname, '../../frontend/index.html'));
});

// ---------------------------------------------------------------------------
// Error handler (must be last)
// ---------------------------------------------------------------------------
app.use(errorHandler);

module.exports = app;
