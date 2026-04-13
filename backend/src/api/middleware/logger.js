// =============================================================================
// PROJECT ANTIGRAVITY — Request Logger Middleware
// =============================================================================

function requestLogger(req, res, next) {
  const start = Date.now();
  const { method, url } = req;

  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const level = status >= 500 ? 'ERROR' : status >= 400 ? 'WARN' : 'INFO';
    console.log(`[API] [${level}] ${method} ${url} → ${status} (${duration}ms)`);
  });

  next();
}

module.exports = requestLogger;
