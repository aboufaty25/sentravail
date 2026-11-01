// Server-side role check. Always combine with requireAuth.
function requireRole(...roles) {
  return (req, res, next) => {
    if (req.user && roles.includes(req.user.role)) return next();
    const err = new Error("Vous n'avez pas l'autorisation d'accéder à cette page.");
    err.status = 403;
    return next(err);
  };
}

module.exports = { requireRole };
