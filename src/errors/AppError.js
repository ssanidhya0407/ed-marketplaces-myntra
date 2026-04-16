class AppError extends Error {
  constructor(myntraCode, message, details) {
    super(message || 'Application error');
    this.name = 'AppError';
    this.myntraCode = myntraCode;
    this.details = details;
  }
}

module.exports = AppError;
