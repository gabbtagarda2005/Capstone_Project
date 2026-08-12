## Quick Reference: Perfect Accuracy ETA System

### TL;DR - The 5 Strategies

| # | Strategy | What It Does | File | Key Method |
|---|----------|-------------|------|-----------|
| 1 | **OSRM Traffic** | Real-time road routing + traffic speeds | `osrmTrafficService.js` | `getOsrmEta()` |
| 2 | **Dwell Time** | Add time for passenger boarding | `freeEtaEngine.js` | `getTerminalDwellBuffer()` |
| 3 | **Road Snapping** | Correct GPS drift to actual roads | `osrmTrafficService.js` | `snapGpsToRoad()` |
| 4 | **Weather Multiply** | Slow down in rain/fog/storms | `weatherEtaMultiplier.js` | `applyWeatherAdjustment()` |
| 5 | **Kalman Filter** | Smooth noisy ETA predictions | `kalmanFilterEta.js` | `smoothEtaWithKalman()` |

---

### Get ETA (Most Common Usage)

```javascript
const { getAdvancedEtaMinutes } = require('./services/freeEtaEngine');

// Single call does everything (all 5 strategies)
const eta = await getAdvancedEtaMinutes({
  lat1: 7.6380,           // Bus current location
  lon1: 124.6720,
  lat2: 7.1600,           // Bus destination (terminal)
  lon2: 125.1300,
  speedKph: 45,           // Bus current speed
  busId: 'BUK-101',       // For Kalman filter per-bus caching
  passengerCount: 35,     // Current passengers (strategy 2)
  seatCapacity: 50,       // Bus capacity
  currentLocation: 'Aglayan',    // For weather lookup (strategy 4)
  nextLocation: 'Malaybalay',
  stops: ['Maramag'],     // Intermediate stops
});

console.log(`ETA: ${eta} minutes`);  // Output: 92
```

---

### Fallback (If Advanced Fails)

```javascript
// Simple Haversine-based calculation (no traffic/weather/dwell)
const { getFreeEtaMinutes } = require('./services/freeEtaEngine');

const simpleEta = getFreeEtaMinutes(
  lat1, lon1,
  lat2, lon2,
  speedKph
);
```

---

### Debug Individual Strategies

```javascript
// 1. Test OSRM only
const { getOsrmEta } = require('./services/osrmTrafficService');
const osrmEta = await getOsrmEta(7.6380, 124.6720, 7.1600, 125.1300);

// 2. Test dwell buffer
const { getTerminalDwellBuffer } = require('./services/freeEtaEngine');
const dwell = getTerminalDwellBuffer(35, 50); // passengers, capacity

// 3. Test weather impact
const { applyWeatherAdjustment } = require('./services/weatherEtaMultiplier');
const adjusted = applyWeatherAdjustment(80, 'Aglayan', 'Malaybalay', []);

// 4. Test Kalman smoothing
const { smoothEtaWithKalman } = require('./services/kalmanFilterEta');
const smoothed = smoothEtaWithKalman('BUK-101', 78);

// 5. Full stack debug
const eta = await getAdvancedEtaMinutes({ ... });
// Check logs like: "[ETA] OSRM route available: 87 mins"
```

---

### Common Errors & Solutions

| Error | Cause | Fix |
|-------|-------|-----|
| `OSRM request timeout` | OSRM server slow | Increases OSRM_TIMEOUT_MS or disable with ENABLE_OSRM=false |
| `Cannot read property 'currentOccupancy'` | Bus doc missing field | Ensure Bus model updated, check with `Bus.findOne()` |
| `Weather multiplier undefined` | No weather data | Check `weatherLocationAdvisories` service running |
| `Kalman filter not smoothing` | Kalman disabled or stuck | Call `resetEtaFilter(busId)` |

---

### Environment Setup

```bash
# .env file
ENABLE_OSRM=true
OSRM_HOST=router.project-osrm.org
OSRM_TIMEOUT_MS=5000
```

---

### Testing in Postman

```bash
# Get live buses with perfect ETA
GET /api/buses/live
Response includes: etaMinutes, trafficDelay, nextTerminal

# Get staff profile ETA
GET /api/staff/me/eta
Response includes: etaMinutes, targetArrivalTime, status
```

---

### Performance Tips

1. **Batch bus fetches**: Don't query bus data per GPS record
   ```javascript
   // ❌ Slow (N queries)
   for (const log of logs) {
     const bus = await Bus.findOne({ busId: log.busId });
   }
   
   // ✅ Fast (1 query)
   const buses = await Bus.find({ busId: { $in: busIds } });
   ```

2. **Cache OSRM responses**: Already done (2-minute TTL)

3. **Reuse Kalman filters**: Already cached per bus (1-hour TTL)

---

### Monitoring

```javascript
// Check OSRM cache size
const routeCache = require('./services/osrmTrafficService');
// (Currently in-memory, ~50-100 entries typically)

// Check Kalman filters
const etaFilters = require('./services/kalmanFilterEta');
// Auto-cleanup every 5 minutes, max 1 hour per filter

// Logs to watch
[ETA] OSRM route available
[ETA] Added dwell buffer
[ETA] Weather adjustment
[ETA] Kalman smoothing
```

---

### Next Steps

1. Deploy to production
2. Monitor ETA accuracy vs actual arrivals
3. Tune Kalman filter if needed (Q, R parameters)
4. Consider Google Maps API as alternative if needed
5. Add historical pattern learning (ML)

---

**Last Updated**: April 25, 2026
