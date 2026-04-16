const AppError = require('../errors/AppError');

function formatZodIssues(issues) {
  return issues.map((i) => `${i.path.join('.') || 'payload'}: ${i.message}`).join('; ');
}

function validate(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse({
      params: req.params,
      body: req.body ?? {},
      query: req.query,
      headers: req.headers,
    });

    if (!result.success) {
      return next(new AppError(2006, formatZodIssues(result.error.issues), result.error.issues));
    }

    req.validated = result.data;
    return next();
  };
}

module.exports = validate;
