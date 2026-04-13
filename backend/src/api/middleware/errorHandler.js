// =============================================================================
// PROJECT ANTIGRAVITY — Error Handler Middleware
// =============================================================================

function errorHandler(err, req, res, _next) {
  const statusCode = err.statusCode || 500;
  const errorCode = err.errorCode || 'INTERNAL_ERROR';

  console.error(`[API] ${req.method} ${req.path} → ${statusCode} ${errorCode}: ${err.message}`);

  res.status(statusCode).json({
    error: {
      code: errorCode,
      message: err.message || 'Internal server error',
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    },
  });
}

module.exports = errorHandler;
