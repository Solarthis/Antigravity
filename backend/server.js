// =============================================================================
// PROJECT ANTIGRAVITY — Server Entry Point
// =============================================================================
// Initializes DB, starts Express API, starts Cron scheduler.
// Handles graceful shutdown of all subsystems.

const env = require('./src/config/env');
const { testConnection, shutdown: shutdownDb } = require('./src/config/database');
const app = require('./src/app');
const { startScheduler, stopScheduler } = require('./src/cron/scheduler');

// Pipeline will be set after scraper is loaded
let scrapePipeline = null;

async function start() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║         🚀 PROJECT ANTIGRAVITY — MAT Solutions              ║');
  console.log('║         Enterprise Auction Sourcing Pipeline                 ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  // Step 1: Test DB connection
  try {
    await testConnection();
  } catch (err) {
    console.error(err.message);
    console.error('Cannot start without database. Exiting.');
    process.exit(1);
  }

  // Step 2: Load scrape pipeline (lazy — scraper is Phase 7)
  try {
    const { runScrapePipeline } = require('./src/scraper/pipeline');
    scrapePipeline = runScrapePipeline;
    app.setScrapePipeline(scrapePipeline);
    console.log('[INIT] Scrape pipeline loaded.');
  } catch (err) {
    console.warn(`[INIT] Scrape pipeline not available: ${err.message}`);
    console.warn('[INIT] System will run in dashboard-only mode (no scraping).');
  }

  // Step 3: Start Express server
  const server = app.listen(env.port, () => {
    console.log(`[SERVER] Listening on http://localhost:${env.port}`);
    console.log(`[SERVER] Dashboard: http://localhost:${env.port}`);
    console.log(`[SERVER] API Base: http://localhost:${env.port}/api/v1`);
    console.log(`[SERVER] Environment: ${env.nodeEnv}`);
  });

  // Step 4: Start cron scheduler (only if pipeline is available)
  if (scrapePipeline) {
    startScheduler(scrapePipeline);
  } else {
    console.log('[SCHEDULER] Skipped — no pipeline available.');
  }

  // ---------------------------------------------------------------------------
  // Graceful Shutdown
  // ---------------------------------------------------------------------------
  const gracefulShutdown = async (signal) => {
    console.log(`\n[SHUTDOWN] Received ${signal}. Shutting down gracefully...`);

    // Stop cron
    stopScheduler();

    // Close HTTP server
    server.close(() => {
      console.log('[SHUTDOWN] HTTP server closed.');
    });

    // Close DB pool
    await shutdownDb();

    console.log('[SHUTDOWN] All systems shut down. Goodbye.');
    process.exit(0);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  // Unhandled rejections — log but don't crash
  process.on('unhandledRejection', (reason) => {
    console.error('[FATAL] Unhandled Rejection:', reason);
  });

  process.on('uncaughtException', (err) => {
    console.error('[FATAL] Uncaught Exception:', err);
    gracefulShutdown('uncaughtException');
  });
}

start().catch((err) => {
  console.error('[FATAL] Startup failed:', err);
  process.exit(1);
});
