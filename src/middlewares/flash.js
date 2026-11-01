// Minimal session flash messages: req.flash(type, msg) then res.locals.flash in views.
function flash(req, res, next) {
  req.flash = (type, message) => {
    req.session.flash = req.session.flash || [];
    req.session.flash.push({ type, message });
  };
  res.locals.flash = req.session.flash || [];
  if (req.session.flash) delete req.session.flash;
  next();
}

module.exports = { flash };
