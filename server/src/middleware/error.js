export default function errorHandler(err, req, res, next) {
  const status = err.statusCode || (err.name === 'ValidationError' ? 400 : err.name === 'CastError' ? 404 : 500);
  const message = status === 500 && process.env.NODE_ENV === 'production' ? 'Something went wrong' : err.message;
  res.status(status).json({ success: false, message, ...(process.env.NODE_ENV !== 'production' && status === 500 ? { stack: err.stack } : {}) });
}
