/**
 * middleware/errorHandler.js
 * Global error handler — catches anything not handled in routes.
 */

function errorHandler(err, req, res, next) {
  console.error("[Server Error]", err.stack || err.message);
  res.status(500).json({
    success: false,
    message: "An unexpected server error occurred.",
    ...(process.env.NODE_ENV === "development" && { detail: err.message }),
  });
}

module.exports = errorHandler;
