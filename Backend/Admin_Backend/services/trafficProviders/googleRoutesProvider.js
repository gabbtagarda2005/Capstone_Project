/**
 * Real-time traffic-aware routing (Google Routes API, routingPreference: TRAFFIC_AWARE_OPTIMAL,
 * DRIVE mode) — the top-priority traffic source, WHEN configured. Per the user's explicit
 * instruction: do not invent an API key, do not hardcode one, and never make an external request
 * without a real, user-supplied credential. Today `GOOGLE_ROUTES_API_KEY` is not set anywhere in
 * this project (.env / .env.example confirmed empty of it) — this stub always returns
 * `{ available: false }` in that case, so the provider chain (services/trafficProviders/index.js)
 * falls straight through to the GPS-derived/historical sources. The moment a real key is added to
 * .env, this becomes the place to wire the actual request — no other file needs to change.
 */

function getGoogleRoutesApiKey() {
  const key = process.env.GOOGLE_ROUTES_API_KEY;
  return key && String(key).trim() ? String(key).trim() : null;
}

async function getGoogleRoutesTraffic(_segmentId, _corridorDoc) {
  const apiKey = getGoogleRoutesApiKey();
  if (!apiKey) return { available: false };

  // Not implemented: no credentials exist in this deployment to test/build against, and the user
  // explicitly asked not to invent one. When a real key is configured, implement a Routes API
  // "computeRoutes" call here (routingPreference: TRAFFIC_AWARE_OPTIMAL, travelMode: DRIVE) for
  // the segment's two endpoints, mapping the response's trafficAware duration into the same
  // { available, trafficSource: "live_provider", speedKph, confidence } shape the other providers
  // return, so services/trafficProviders/index.js needs no changes.
  return { available: false };
}

module.exports = { getGoogleRoutesTraffic, getGoogleRoutesApiKey };
