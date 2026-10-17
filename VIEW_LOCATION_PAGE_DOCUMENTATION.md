# View Location Page — Component Documentation
### Bukidnon Bus Company @BUKSU — Administrator Module

*Every claim below is traced to `Frontend/Admin_Frontend/src/pages/LocationsPage.tsx` and its component/service dependencies, with file:line citations retained in the working notes. Where a feature could not be verified in code, that is stated explicitly rather than assumed from the interface.*

---

## A. Overview of the View Location Page

The View Location page is the Administrator Module's real-time fleet-monitoring interface. It renders an interactive map — either Google Maps or a Leaflet-based basemap, selectable by the administrator — on which every bus currently reporting a GPS position is shown as a live marker, continuously updated through a Socket.IO connection to the Admin Backend and reinforced by a periodic REST poll. Surrounding the map, the page surfaces a fleet summary count, a set of data-backed overlay layers (geofences, traffic, ticket-volume heat, schedule delays, bus trails, and weather), a reference legend, a scrollable tray of per-bus status cards, and a global tactical notification sidebar shared with the rest of the admin application. Administrators use this page to confirm which buses are actively operating, inspect an individual bus's attendant, route, signal, and last-sync status, assess route-level risk indicators such as congestion or delay, and — for testing purposes — inject a single verified GPS sample into the live pipeline without needing physical hardware present.

---

## B. Explanation of Each Component

### 1. Page Header and Navigation

The page header, sidebar navigation (Dashboard, View Location, Command Center, Management, Reports, Settings, Logout), and branding are not part of `LocationsPage.tsx` itself — they are rendered by a shared `AdminLayout` component that wraps every authenticated admin route, View Location included. This means the navigation chrome the administrator sees on View Location is identical in structure and behavior to every other page in the Administrator Module; View Location only supplies the content area between the header and footer.

### 2. User Account Information

The "Super Admin" label (or "Fleet Manager" / "Auditor" / "Administrator" for other roles) shown in the header is not decoded from the browser's stored login token. On every page load, the application calls the backend's `GET /api/auth/me` endpoint with the administrator's session token; the backend looks up the account's role assignment through its role-based access control service and returns it as part of the response. The frontend then displays whichever role label matches what the backend reported, and shows the administrator's email address beneath it, with a profile photo or a single-letter avatar derived from the email as a fallback. In short, the role badge reflects a live, server-verified privilege lookup each time the page loads, not a value trusted directly from the login token.

### 3. Interactive Map

The map itself is rendered using one of two mapping libraries, selected by the administrator's current basemap choice: Leaflet (an open-source mapping library drawing OpenStreetMap-family tiles) for the Map/Terrain/Dark modes, or the real Google Maps JavaScript API for Satellite mode. Both renderers support the standard pan, zoom-in/zoom-out, and click interactions expected of a web map, and both independently implement the same set of overlays and bus markers — meaning a feature available on one basemap is available on the other, even though the two are built on different underlying libraries. As the administrator pans or zooms, the map continuously tracks its own center point, which becomes relevant later for the Place Test GPS control.

### 4. Satellite and Map Controls

The map dock's always-visible control rail offers two basemap choices directly — "Satellite" and "Map" (standard roadmap view) — with a third "More" button that opens an overflow panel containing two additional basemap choices, "Terrain" and "Dark". All four options are mutually exclusive basemap styles; selecting one simply changes which tile set or map renderer is active underneath the same overlays and bus markers. It is worth noting for accuracy that the "More" panel at one point also held the overlay toggles described below, but the current implementation has moved those toggles out to their own dedicated tray — the "More" panel today is basemap selection only.

### 5. Active Buses Indicator

The count shown beside the region label (e.g., "1 / Bukidnon") is the number of buses currently present in the page's live fleet state — that is, every bus the application has received at least one GPS update for during the current session, whether from the Socket.IO stream or the periodic REST poll, that has not since been explicitly removed by an "attendant went offline" signal from the backend. It is important to describe this precisely: a bus is not dropped from this count simply because its GPS has gone briefly stale — a stale bus is instead visually marked as stationary while remaining counted — so this figure should be read as "buses known to the live session," not "buses actively transmitting in the last few seconds." The region label itself, "Bukidnon," is a fixed label built into the interface rather than a value drawn from any configuration setting.

### 6. Map Overlays

The page provides six independently toggleable overlays. All six are backed by real, non-simulated data sources — none is a purely cosmetic switch — though their individual meanings differ from what a first glance might suggest:

- **Geofence.** Draws a circular boundary around every registered terminal, sized to that terminal's actual configured detection radius (clamped to a sensible range in meters). This directly visualizes the same geofence boundaries the system uses elsewhere to detect terminal arrivals and departures.
- **Traffic.** A dual-purpose layer: on the Google Maps basemap, it additionally enables Google's own live traffic overlay as a reference layer; independent of that, it also activates the system's own segment-by-segment congestion overlay, drawn from a dedicated backend traffic endpoint and colored only where the system has sufficient confidence in the reading — segments with inadequate data are deliberately left unstyled rather than given a fabricated color. This same signal also colors each bus's trail and flags a "traffic risk" indicator on a bus's marker.
- **Heat.** Despite its name suggesting live traffic intensity, this overlay is specifically a **ticket-volume load map** — a filled circle per terminal, sized by how many tickets have actually been issued from that terminal so far today. It should be documented as a passenger-demand indicator, not a road-traffic heatmap; the "Traffic" overlay above is the one that reflects road conditions.
- **Delays.** Flags buses currently running at a moderate or severe delay tier relative to their published schedule, a determination computed by comparing each bus's live dispatch block against the current time in Philippine local time. Delayed buses are colored distinctly on their trail and flagged in their map popup.
- **Buses.** The master toggle for whether live bus markers are rendered on the map at all; turning it off hides all fleet markers while leaving the other overlays visible.
- **Weather.** Pulls current weather conditions from the same public weather-advisory feed used by the Commuter Interface's map, refreshed on a ten-minute interval while the layer is active.

### 7. Map Provider and Reference Information

The small caption reading "Google Maps · Basemap & overlays" beneath the overlay controls is a static, non-interactive attribution line — it does not open anything when clicked. The separate "Legend" control (marked with an information icon) is its own independent panel that the administrator can open or close; by default it is shown expanded. A third, visually distinct "Map reference" panel exists alongside it and is likewise independent — the page therefore presents two separate legend-like panels rather than one, each covering different information, described individually below.

### 8. Map Legend

The "Legend" panel (opened via the information icon) is a purely informational status key — it has two sections. The first explains the color and animation conventions used for terminal markers and bus trails: terminal pins shown in high/medium/low shading to indicate passenger load, an emerald pulse ring indicating a scheduled arrival in progress, a red pulsing core indicating a logged speed violation above the system's threshold, and a distinct ring/core pattern reserved for an active SOS emergency. The second section explains what each of the six map overlays visually represents (geofence boundaries, corridor routing style, traffic/heat coloring, delay-risk paths, and bus trail coloring). No row in this panel is clickable — selecting an item in the legend does not toggle the corresponding overlay; the overlay toggles live separately in the overlay tray described above.

The second, separate "Map reference" panel lists three items: a green terminal-hub pin icon matching the real terminal markers on the map, a cyan route-bus-stop pin icon matching the real stop markers, and a blue "Deployed" color swatch. Like the Legend panel, none of these three entries are interactive — they exist purely to explain the map's marker iconography.

### 9. Bus Information Card

Each bus in the Live Fleet tray is shown as an individual status card. The card's top-level branding text is drawn from the system's configured company name (falling back to "Bukidnon Bus Company" if unset), with "LIVE FLEET" as a fixed footer label — these are presentation elements, not per-bus data. The specific per-bus fields are: the bus's identifier (taken directly from its live GPS record); a signal-strength indicator reflecting the live telemetry signal tier reported by the device itself (strong, weak, or offline), with a bus automatically shown as offline once its GPS has gone stale for a defined period; an attendant line reading "Attendant · <name>" sourced from the attendant name attached to the live GPS payload — or, when the bus's active GPS source is the LILYGO hardware unit rather than the attendant's phone, the card instead reads "Hardware backup" and does not display an attendant name at all; the assigned route, drawn from the bus's registry record rather than the live GPS stream; and a "Last sync" timestamp reflecting the most recent GPS update actually received for that bus, formatted in the browser's local time rather than explicitly forced to Philippine time.

### 10. Real-Time GPS Tracking

See Section C below for the complete step-by-step data flow.

### 11. Place Test GPS

This control is a genuine diagnostic tool, not a purely visual simulation. When pressed, it submits the current center point of the administrator's own map view — not a point the administrator clicks separately, and not a random or fixed coordinate — as a single GPS sample for whichever bus card is currently selected, or the first bus in the fleet if none is selected. This request is handled by the same backend function that processes a real hardware device's GPS ping: it is validated, checked against the fleet's GPS records, and written to the system's actual live-position data store, then broadcast over the same real-time channel used for genuine GPS updates — meaning a test point placed this way will appear on every connected administrator's map exactly as a real GPS update would, and is tagged internally as coming from a hardware-type source. The only safeguard in place is that the button is disabled while a request is already in flight or while the administrator is not authenticated; there is no confirmation prompt before it fires, so it should be used with the understanding that it writes a real record to the live tracking data.

### 12. Tactical Feed and Notifications

The "Tactical feed" panel — including its "Mark all as read" action, its close button, and the bell icon that opens it — is not specific to the View Location page; it is a global panel mounted once at the application's layout level and available from every admin screen, with its "Track bus" action simply navigating back to View Location and recentering the map. Within the feed, most entries originate from real system events — geofence breach detections and incident/lost-item reports dispatched through the application's internal event system. The one notable exception is the "System sync" entry, which reads "Realtime command channel linked to Admin API." This specific message is not driven by any live connectivity check, health service, or Socket.IO event; it is a fixed message the interface generates locally in the browser exactly once per browsing session, purely to inform the administrator that the real-time channel has been initialized. It should not be described as a live system-health indicator, since it does not reflect the channel's actual ongoing status. Separately, it should be noted that every timestamp shown in this feed is formatted using the browser's local time zone, not explicitly forced to Philippine time the way some of the page's other time-sensitive calculations are — a minor inconsistency worth being aware of rather than assuming the two are handled identically.

### 13. Notification Actions

Within each feed item, "Track bus" recenters the View Location map on that bus's last known coordinates and switches the administrator to this page if they were elsewhere — it performs a navigation and a map action only, with no backend request involved. "Broadcast" does not itself send anything; it navigates the administrator to the Command Center's broadcast composer, optionally pre-filling a hint about which bus prompted the action, leaving the actual broadcast to be composed and sent from that separate page. "Dismiss" simply removes the item from the administrator's own local notification list in the browser; it does not acknowledge or resolve anything on the server side.

### 14. HTTP Status or Debug Indicator

A thorough search of this page and every component it directly uses found no element that renders the literal text "200" as an HTTP status code, API health figure, or debug value anywhere in the implementation. If a "200" is visible on the running page, its source could not be confirmed from this page's own code and should be re-verified directly against the live application before being documented as a feature — it may originate from a part of the interface outside this page's component tree, or be a different on-screen figure (such as a geofence radius or a ticket count) that resembles "200" at a glance.

### 15. Responsive Layout and Usability

The page does include real, deliberate responsive behavior, implemented through a small number of specific breakpoints rather than a general-purpose responsive framework. Below a moderately narrow browser width, the map and the bus-card sidebar collapse from a side-by-side layout into a single stacked column; the grid of bus cards itself reduces from four columns to two, and then to one, as the window narrows further; the map's overlay control rail shrinks and allows its controls to wrap onto multiple lines; and, at the narrowest widths typical of a mobile device, the application's sidebar collapses to an icon-only rail and the header hides the administrator's role label and avatar to conserve space. By contrast, the Legend panel, the tactical notification sidebar, and the individual bus cards do not define their own breakpoint rules — their layout on small screens follows entirely from how their parent containers resize, rather than from any dedicated mobile-specific styling of their own.

---

## C. Real-Time Bus Tracking Data Flow

1. **Origin.** A GPS coordinate originates from one of two sources: the attendant's mobile phone during an active trip, or, when the phone is unavailable, the bus's onboard LILYGO hardware unit (itself falling back to an SMS-based path as a last resort) — the same three-tier source arbitration used throughout the system.
2. **Ingestion.** The coordinate reaches the Admin Backend through its GPS ingestion pipeline, which validates the fix, checks it for physically implausible jumps, and decides whether this source is currently authoritative for that bus.
3. **Persistence and broadcast.** Once accepted, the fix is written to the system's live GPS record for that bus and broadcast immediately over Socket.IO.
4. **Frontend reception.** The View Location page, having already subscribed to the fleet's update channel on load, receives this broadcast directly — it listens for several related event names to stay compatible with slightly different payload shapes used across the system, and merges whichever one arrives into its live bus list, discarding any update that is older than data it already holds, so a delayed message can never overwrite a fresher one.
5. **Reconciliation poll.** Independently of the live broadcast, the page also polls a REST endpoint for the fleet's current positions on a short, fixed interval, and merges that snapshot into the same live state — providing a safety net if a broadcast is ever missed.
6. **Map and card update.** Every accepted update immediately moves that bus's marker on the map, appends to its visible trail if it has genuinely moved, and refreshes its "last sync" time on its status card — all without the administrator needing to refresh the page.
7. **Staleness.** A bus whose GPS has not updated within a defined window is visually marked as stationary/offline on its card, rather than being silently left showing an old position as if it were current; it is only removed from the fleet list entirely once the backend explicitly signals that the attendant has gone offline.

---

## D. Data Sources and Implementation Status

| Component or Feature | Actual Data Source | Implementation Status | Evidence in Code |
|---|---|---|---|
| Role/account label in header | `GET /api/auth/me` → RBAC service lookup by email | Fully implemented (server-verified, not client-decoded) | `AuthContext.tsx`, `authTicketing.js` `/me` route |
| Active Buses count | Live fleet state (`busState.length`) | Fully implemented; "active" = known to session, not a recency filter | `LocationsPage.tsx` |
| Region label ("Bukidnon") | Hardcoded string | Static, not configurable | `LocationsPage.tsx`, `MapControlPanel.tsx` |
| Geofence overlay | Real terminal geofence radii | Fully implemented | `LocationsPage.tsx`, `fetchCorridorBuilderContext()` |
| Traffic overlay | Google's live traffic layer + backend traffic/heatmap endpoint | Fully implemented, confidence-gated | `LocationsPage.tsx`, backend traffic route |
| Heat overlay | Today's ticket count per terminal | Fully implemented — is ticket-volume load, **not** a road-traffic heatmap | `LocationsPage.tsx` |
| Delays overlay | Live dispatch schedule vs. Philippine local time | Fully implemented | `LocationsPage.tsx` |
| Buses overlay | Live fleet state | Fully implemented (master marker toggle) | `LocationsPage.tsx` |
| Weather overlay | Public weather advisory feed | Fully implemented, 10-min refresh | `LocationsPage.tsx`, `fetchPublicWeatherMap.ts` |
| Legend / Map reference panels | Static descriptive content | Decorative/informational only — not interactive | `TacticalMapLegendHud.tsx`, `LocationsPage.tsx` |
| Bus info card fields | Live GPS payload + bus registry record | Fully implemented, real telemetry | `LiveFleetBusCard.tsx`, `LocationsPage.tsx` |
| Place Test GPS | Real backend GPS ingestion function, same as hardware pings | Fully implemented — writes real data, no confirmation prompt | `LocationsPage.tsx`, `buses.js`, `attendantGpsIngest.js` |
| Tactical feed — geofence/incident items | Internal application events | Implemented | `TacticalNotificationContext.tsx` |
| Tactical feed — "System sync" entry | Hardcoded, once-per-session local message | Cosmetic/static — **not** a live connectivity indicator | `TacticalNotificationContext.tsx` |
| Tactical feed timestamps | Browser-local time | Implemented, but not forced to Philippine time (inconsistent with the page's own delay calculations) | `TacticalNotificationSidebar.tsx` |
| "200" status/debug indicator | *(none found)* | **Not found in this page's code** — cannot be verified or documented as a feature | n/a |
| Responsive layout | Fixed CSS breakpoints (960px, 1100px, 900px, 720px, 560px) | Partially implemented — map/sidebar/cards/header adapt; Legend, notification sidebar, and individual cards do not have their own breakpoints | Various `.css` files |

---

## E. Relationship to the Dashboard

The Dashboard page and the View Location page serve deliberately different purposes and draw from different data. The Dashboard is a summary and trends page, built entirely from historical ticket records — passenger counts, revenue, peak hours, and forecasts — refreshed from the analytics endpoint and a live-update signal fired whenever a new ticket is issued; it does not display bus positions at all beyond a clickable banner that links across to View Location. View Location, by contrast, is a live operational monitoring page built from the GPS tracking pipeline rather than the ticketing pipeline — it has no revenue or passenger-count figures of its own. The two pages are connected through navigation (the Dashboard's "Bukidnon live network" banner opens View Location) rather than through any shared data source, and together they give the administrator two complementary views of the same company: one financial and historical, the other positional and live.

---

## F. Testing and Verification

- **Source-code inspection:** performed exhaustively for this documentation — `LocationsPage.tsx` was read in full, along with every directly imported component (`MapControlPanel`, `TacticalMapLegendHud`, `LiveFleetBusCard`, `TacticalNotificationSidebar`, `TacticalNotificationContext`, `AuthContext`, `AdminLayout`) and the relevant backend routes/services (`authTicketing.js`, `buses.js`, `attendantGpsIngest.js`).
- **Automated tests:** none were run as part of producing this documentation.
- **API tests:** none were run as part of producing this documentation.
- **Real-device or browser testing:** none was performed for this documentation — every claim above is a code-level finding, not an observation of the running page. The "200" indicator in particular could not be verified and should be checked directly against the live application.

---

## G. Final Documentation Summary

The View Location page is the Administrator Module's real-time operational window into the fleet, distinct from — and complementary to — the Dashboard's historical ticketing view. Every one of its six map overlays is backed by genuine, verifiable data rather than decoration, though the "Heat" layer specifically represents passenger-boarding volume rather than road traffic, a distinction worth preserving precisely in any written description of the system. The page's live tracking is driven by a dual mechanism — an immediate Socket.IO broadcast reinforced by a short-interval REST poll — that together ensure a bus's position, signal state, and last-sync time remain current without manual refresh, while staleness is surfaced honestly rather than concealed. Administrative tools on the page, most notably Place Test GPS, are implemented as genuine writes into the same live pipeline used by real hardware rather than as cosmetic simulations, a fact that should inform how carefully the feature is used in a live environment. Two components merit a caveat in any defense of this system: the tactical feed's "System sync" notice is a fixed local message rather than a live health indicator, and a "200" figure referenced in prior discussion of this page could not be located in its implementation and should be re-confirmed against the running application before being described as a system feature.
