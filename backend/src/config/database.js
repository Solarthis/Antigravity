// =============================================================================
// PROJECT ANTIGRAVITY — SQLite Database
// =============================================================================
// SQLite connection with automated initialization.

const Database = require('better-sqlite3');
const fs = require('fs');
const env = require('./env');
const { initializeSchema } = require('../db/init');

// Single source of truth for persistence path is env.js.
const dbPath = env.dbPath;

if (!fs.existsSync(env.dataDir)) {
  fs.mkdirSync(env.dataDir, { recursive: true });
}

let db = null;

/**
 * Connects to SQLite and initializes schema.
 */
async function testConnection() {
  try {
    console.log(`[DB] Opening SQLite database at: ${dbPath}`);
    db = new Database(dbPath, {
      verbose: env.nodeEnv === 'development' ? console.log : null,
    });

    // Enable WAL mode for better concurrency (important for flash drives)
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');

    // Run schema initialization
    initializeSchema(db);

    console.log('[DB] SQLite connection and initialization successful.');
    return true;
  } catch (err) {
    console.error(`[DB] Initialization failed: ${err.message}`);
    throw err;
  }
}

/**
 * Run a query (read or write).
 * @param {string} text - SQL query text
 * @param {Array} params - Query parameters
 * @returns {Object} { rows, rowCount, lastInsertId? }
 */
async function query(text, params = []) {
  const start = Date.now();
  try {
    // Detect row-returning statements. SQLite's better-sqlite3 requires
    // `stmt.all()` for anything that yields rows — that includes plain
    // SELECTs, CTEs (`WITH ...`), and any INSERT/UPDATE/DELETE carrying a
    // RETURNING clause. Using `stmt.run()` on a RETURNING statement silently
    // drops the returned rows, which is what previously broke hunt/lot writes.
    const norm = text.trim().toUpperCase();
    const returnsRows =
      norm.startsWith('SELECT') ||
      norm.startsWith('WITH') ||
      /\bRETURNING\b/.test(norm);

    const stmt = db.prepare(text);
    if (returnsRows) {
      const rows = stmt.all(...params);
      return { rows, rowCount: rows.length };
    }
    const result = stmt.run(...params);
    return {
      rows: [],
      rowCount: result.changes,
      lastInsertId: result.lastInsertRowid,
    };
  } catch (err) {
    console.error(`[DB] Query error: ${err.message}`);
    console.error(`[DB] Query: ${text.substring(0, 120)}`);
    throw err;
  } finally {
    const duration = Date.now() - start;
    if (duration > 1000) {
      console.warn(`[DB] Slow query (${duration}ms): ${text.substring(0, 80)}...`);
    }
  }
}

/**
 * Run multiple queries inside a transaction.
 * @param {Function} callback - function receiving the db instance
 */
async function transaction(callback) {
  const execute = db.transaction(callback);
  return execute();
}

/**
 * Gracefully shut down the database.
 */
async function shutdown() {
  if (db && db.open) {
    console.log('[DB] Closing SQLite connection...');
    db.close();
    console.log('[DB] SQLite closed.');
  }
}

module.exports = {
  get db() { return db; },
  query,
  transaction,
  testConnection,
  shutdown,
};
