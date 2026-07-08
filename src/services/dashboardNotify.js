const env = require('../config/env');

/**
 * Real-time inventory bridge: tell dashboardweb that a Myntra order changed so it
 * can deduct shared stock the instant Myntra pushes us the webhook — instead of
 * dashboardweb waiting for its next order-sync poll or the hourly reconcile.
 *
 * This is deliberately FIRE-AND-FORGET: it must never delay or fail the webhook
 * ack we owe Myntra. It swallows every error, times out fast, and no-ops when the
 * bridge isn't configured (DASHBOARDWEB_EVENT_URL empty). dashboardweb's
 * /api/myntra/order-event is idempotent, so a duplicate or retried event is safe.
 *
 * @param {string} sellerOrderId  the order Myntra just created/updated
 * @param {string} [eventType]    'create' | the packet/order event (for logging)
 */
function notifyOrderEvent(sellerOrderId, eventType) {
  const url = env.dashboardwebEventUrl;
  if (!url || !sellerOrderId) return; // bridge disabled or nothing to send

  const headers = { 'Content-Type': 'application/json' };
  if (env.dashboardwebEventSecret) {
    headers.Authorization = `Bearer ${env.dashboardwebEventSecret}`;
  }

  // Bound the outbound call so a slow/unreachable dashboardweb can't pile up.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.dashboardwebEventTimeoutMs);

  Promise.resolve()
    .then(() =>
      fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ sellerOrderId: String(sellerOrderId), eventType: eventType || '' }),
        signal: controller.signal,
      }),
    )
    .then((res) => {
      if (!res.ok) console.warn(`[dashboardNotify] ${sellerOrderId} → HTTP ${res.status}`);
    })
    .catch((err) => {
      if (err && err.name !== 'AbortError') {
        console.warn(`[dashboardNotify] ${sellerOrderId} failed: ${err.message}`);
      }
    })
    .finally(() => clearTimeout(timer));
}

module.exports = { notifyOrderEvent };
