// =============================================================================
// PROJECT ANTIGRAVITY — Database Connection Pool
// =============================================================================
// PostgreSQL connection pool with retry logic and graceful shutdown.

const { Pool } = require('pg');
const env = require('./env');

const pool = new Pool({
  host: env.db.host,
  port: env.db.port,
  database: env.db.database,
  user: env.db.user,
  password: env.db.password,
  max: env.db.max,
  idleTimeoutMillis: env.db.idleTimeoutMillis,
  connectionTimeoutMillis: env.db.connectionTimeoutMillis,
});

// Log pool errors (do not crash)
pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

/**
 * @param {number} retries - Number of retry attempts (increased for VPS stability)
 * @param {number} delayMs - Base delay between retries
 */
async function testConnection(retries = 10, delayMs = 3000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const client = await pool.connect();
      const result = await client.query('SELECT NOW() AS server_time');
      client.release();
      console.log(`[DB] Connected to PostgreSQL at ${env.db.host}:${env.db.port}/${env.db.database}`);
      console.log(`[DB] Server time (UTC): ${result.rows[0].server_time}`);
      return true;
    } catch (err) {
      console.error(`[DB] Connection attempt ${attempt}/${retries} failed: ${err.message}`);
      if (attempt < retries) {
        const wait = delayMs * Math.pow(2, attempt - 1);
        console.log(`[DB] Retrying in ${wait}ms...`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw new Error('[FATAL] Could not connect to PostgreSQL after all retries.');
}

/**
 * Run a query with automatic client acquisition and release.
 * @param {string} text - SQL query text
 * @param {Array} params - Query parameters
 * @returns {import('pg').QueryResult}
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (duration > 1000) {
      console.warn(`[DB] Slow query (${duration}ms): ${text.substring(0, 80)}...`);
    }
    return result;
  } catch (err) {
    console.error(`[DB] Query error: ${err.message}`);
    console.error(`[DB] Query: ${text.substring(0, 120)}`);
    throw err;
  }
}

/**
 * Run multiple queries inside a transaction.
 * @param {Function} callback - async function receiving a client
 */
async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Gracefully shut down the connection pool.
 */
async function shutdown() {
  console.log('[DB] Shutting down connection pool...');
  await pool.end();
  console.log('[DB] Pool shut down complete.');
}

module.exports = {
  pool,
  query,
  transaction,
  testConnection,
  shutdown,
};
