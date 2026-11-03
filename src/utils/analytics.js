// Queues a Google Analytics event, sent by public/js/analytics.js on the next page view.
function queueEvent(req, name, params = {}) {
  if (!req.session) return;
  req.session.gaEvents = [...(req.session.gaEvents || []), { name, params }].slice(-5);
}

module.exports = { queueEvent };
