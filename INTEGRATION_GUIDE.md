# Quick Integration Guide

## Overview
This guide shows you how to integrate the new features and improvements into your application.

---

## 1. VERIFY ACCESSIBILITY IMPROVEMENTS

The accessibility CSS is automatically imported via `global.css`.

**Verify in browser:**
```bash
# Open DevTools Console
# Press F12 or right-click → Inspect
# In Console, check if accessibility features are active:

// Check base font size
getComputedStyle(document.body).fontSize  // Should be "16px"

// Check that colors meet WCAG standards
getComputedStyle(document.body).color     // Check color
```

---

## 2. USE THE ICON LIBRARY

Replace emoji and custom icons with Lucide React icons:

### Installation
```bash
cd Frontend/Passenger_Frontend
npm install lucide-react
```

### Usage in Components

**Before** (using emoji):
```tsx
<div>🕒 Departure Time</div>
<div>🚌 Bus Status</div>
<div>📍 Location</div>
```

**After** (using IconLibrary):
```tsx
import { Icons, ICON_SIZES } from '@/components/IconLibrary';

export function MyComponent() {
  return (
    <div>
      <Icons.Clock size={ICON_SIZES.md} /> Departure Time
      <Icons.Bus size={ICON_SIZES.md} /> Bus Status
      <Icons.MapPin size={ICON_SIZES.md} /> Location
    </div>
  );
}
```

### Available Icons
All exported in `src/components/IconLibrary.tsx`:
- Time: Clock, Navigation, TrendingUp
- Transport: Bus, Zap
- Location: MapPin, Map
- Status: AlertTriangle, CheckCircle2, Info
- UI: Menu, X, ChevronDown, ChevronUp, etc.
- More: See full list in file

---

## 3. AUTO-LOCATION DETECTION

Automatically detect user location on app startup.

### Setup

**Option A: Silent Auto-Detection (Recommended)**

In `src/pages/PassengerLocationPage.tsx` or main app init:
```tsx
import { silentAutoDetectLocation } from '@/lib/autoLocationDetection';

useEffect(() => {
  // Call on app startup
  silentAutoDetectLocation();
}, []);
```

**Option B: Manual Control**

```tsx
import { 
  autoDetectPassengerLocation, 
  shouldAutoDetectLocation 
} from '@/lib/autoLocationDetection';

useEffect(() => {
  if (shouldAutoDetectLocation()) {
    const result = await autoDetectPassengerLocation({
      timeout: 8000,
      maxDistance: 2,
      enableHighAccuracy: false
    });
    
    if (result.success) {
      console.log(`Found: ${result.nearestLabel} (${result.distanceKm}km)`);
      // User location already saved to session
      navigate('/dashboard');
    } else {
      console.log(`Reason: ${result.reason}`);
      // Show manual location picker
    }
  }
}, []);
```

### Behavior
- ✓ Requests user's permission for location access
- ✓ Finds nearest terminal within 2km
- ✓ Auto-fills location if within service area
- ✓ Falls back to manual picker if outside service area
- ✓ Caches location for 30 minutes

### Debug in Console
```javascript
// Check auto-detection status
navigator.geolocation  // Should exist
localStorage.getItem('passenger_location_ready_v1')  // 1 if set
sessionStorage.getItem('passenger_location_session_v1')  // Location data
```

---

## 4. ERROR LOGGING SYSTEM

Automatically tracks frontend errors and performance.

### Automatic Setup
Error logging initializes automatically when the app loads:
```tsx
// In any component or main app file
import '@/lib/errorLogging';  // Auto-initializes
```

### Manual Logging

**Log an error:**
```tsx
import { logError } from '@/lib/errorLogging';

logError({
  message: 'Failed to fetch bus data',
  severity: 'error',
  context: { busId: '123', apiEndpoint: '/api/buses' }
});
```

**Log performance metric:**
```tsx
import { logPerformanceMetric } from '@/lib/errorLogging';

const startTime = performance.now();
const data = await fetchBusData();
await logPerformanceMetric({
  name: 'fetchBusData',
  value: performance.now() - startTime
});
```

**Log user action:**
```tsx
import { logUserAction } from '@/lib/errorLogging';

await logUserAction({
  action: 'selected_bus',
  target: busId,
  metadata: { routeId, timestamp }
});
```

### View Logs in Admin Panel

**Coming soon** - Navigate to:
- `/admin/logs/frontend-errors` - View error list
- `/admin/logs/statistics` - Error statistics
- `/admin/logs/by-page` - Errors by page

**API Endpoints** (Already available):
```bash
# Get recent errors
GET /api/logs/frontend-errors?severity=error&limit=100

# Get statistics (last hour)
GET /api/logs/error-statistics?timeWindow=3600000

# Get errors by page
GET /api/logs/error-by-page
```

---

## 5. BACKEND SETUP

### Mount Frontend Logging Routes

In `Backend/Admin_Backend/server.js`, add:

```javascript
const frontendLogsRouter = require('./routes/frontendLogs');

// Add after other route mounts
app.use('/api/logs', frontendLogsRouter);
```

### Verify Database Model

Ensure MongoDB connection is working:
```javascript
// The FrontendErrorLog model is auto-registered
// Logs will be stored in database with 30-day TTL
```

### Test the Integration

```bash
# In browser console:
fetch('http://localhost:4000/api/logs/frontend-errors', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify([{
    timestamp: new Date().toISOString(),
    severity: 'info',
    message: 'Test log',
    page: '/test',
    userAgent: navigator.userAgent
  }])
})
```

---

## 6. ANIMATION CHANGES VERIFICATION

The following animations have been removed/reduced for better accessibility:

**Removed:**
- ❌ Timeline segment pulsing (1.8s animation)
- ❌ Live pill breathing effect (2s animation)
- ❌ Console border spinning (10s animation)
- ❌ Traffic segment pulsing (1.2s animation)
- ❌ Departure board arriving pulse (1.3s animation)

**Reduced:**
- 📉 Section transitions: 240ms → 150ms fade-in

**Verify:** Load the Passenger Dashboard and confirm:
- No rapid pulsing effects
- No spinning borders
- No breathing animations
- Cleaner, less distracting interface

---

## 7. TEST ACCESSIBILITY

### Keyboard Navigation
```
Tab: Navigate through elements
Enter: Activate buttons/links
Escape: Close modals
```

### Screen Reader Support
Test with Windows Narrator, NVDA, or JAWS:
- All icons have aria-labels
- Buttons are labeled
- Form inputs have labels
- Headings are structured

### Color Contrast
All text now meets WCAG AA (4.5:1 ratio):
- Regular text on backgrounds
- Muted text (previously too light)
- Links and buttons

### Font Sizing
Minimum 16px (1rem) for readable text

---

## 8. NEXT STEPS

### Immediate Actions (This Sprint)
1. [ ] Install Lucide React: `npm install lucide-react`
2. [ ] Test accessibility CSS on your devices
3. [ ] Integrate auto-location detection
4. [ ] Mount backend logging routes
5. [ ] Test error logging in console

### Follow-up (Next Sprint)
- Reduce Admin frontend animations
- Implement loading skeleton screens
- Add status color indicators
- Simplify admin navigation

### Documentation
- See `IMPROVEMENTS_ROADMAP.md` for full specifications
- See `IMPLEMENTATION_SUMMARY.md` for what was done
- See component JSDoc comments for usage

---

## 🆘 TROUBLESHOOTING

### Icons not showing?
```bash
# Check if lucide-react is installed
npm list lucide-react

# If not: npm install lucide-react

# Check import in IconLibrary.tsx
import { Clock, Bus, MapPin, ... } from 'lucide-react';
```

### Auto-location not working?
```javascript
// Check in console:
navigator.geolocation  // Should exist
// If undefined: Using insecure context (not HTTPS on production)

// Check permissions:
// Settings > Privacy & Security > Permissions > Location
```

### Error logs not being saved?
```bash
# Check backend routes mounted:
curl http://localhost:4000/api/logs/frontend-errors

# Should return: Method Not Allowed (405) - route exists
# If Connection Refused: Backend not running

# Check MongoDB connection:
# Ensure MongoDB is running and frontendLogs route is mounted
```

### Text too large/small?
```css
/* Adjust in accessibility.css */
body { font-size: 1rem; }  /* 16px base */

/* Change sizes here if needed */
h1 { font-size: clamp(2rem, 5vw, 2.5rem); }
```

---

## 📊 METRICS TO MONITOR

Track these metrics to validate improvements:

```javascript
// In ErrorLogger panel or custom dashboard:
- Average page load time (should decrease)
- Error rate by severity (track trends)
- Performance metrics by page
- Most common errors (for debugging)
- User action patterns (for UX improvements)
```

---

## 💡 BEST PRACTICES

1. **Always initialize error logging** - Call once on app startup
2. **Use semantic icons** - Icons.Bus not Icons.Vehicle
3. **Provide fallback for auto-location** - Always have manual picker
4. **Monitor error logs** - Review weekly for patterns
5. **Test on multiple devices** - Font sizing may differ
6. **Respect user preferences** - Check prefers-reduced-motion
7. **Keep logs lean** - Remove sensitive data before logging

---

For detailed specifications, see:
- `IMPROVEMENTS_ROADMAP.md` - Full improvement plan
- `IMPLEMENTATION_SUMMARY.md` - What was implemented
- Component JSDoc comments - Usage examples
