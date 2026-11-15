# Passenger Navigation and Walking Directions — Component Documentation
### Bukidnon Bus Company @BUKSU — Passenger Module

*The descriptions below are based on direct inspection of the system's source code. They describe what the passenger sees, what each control does, and how the system actually calculates what it shows, written in plain language rather than technical terms.*

---

**Navigation Destination.**
A passenger starts navigation either by choosing "Navigate" next to a specific terminal in the station list, or by tapping a shortcut that selects the single nearest one automatically. Once selected, that terminal becomes the destination, marked with its own distinct pin on the map. One detail worth correcting against how the destination might be assumed to appear: the screen shows the terminal's plain registered name only, such as "Malaybalay Integrated Bus Terminal," rather than that name combined with its barangay or area — the barangay information exists in the system's records but is not currently shown alongside the destination name during navigation.

**Walking Distance and Estimated Time.**
The walking distance shown is a genuine, road-and-path-following distance calculated by an external routing service, not a straight-line measurement between two points — meaning it reflects an actual walkable path rather than "as the crow flies." The estimated walking time, however, is deliberately calculated differently from how it might be assumed to work: rather than trusting the routing service's own time estimate, the system takes the real distance that service calculated and applies its own fixed, consistent walking pace to produce the time shown. This is a deliberate choice rather than an oversight — the particular routing service used is only reliable for calculating real walking paths and distances, not for estimating how long a person actually takes to walk them, so the system calculates the time itself instead of trusting a figure that would actually be based on vehicle speeds. Distances are shown in meters for shorter distances and in kilometers for longer ones, and the estimated time is always rounded to the nearest whole minute, never shown as less than one minute.

**GPS Accuracy Warning.**
This warning appears specifically when the passenger's device reports a location accuracy worse than fifty meters, and reads exactly: "GPS accuracy is low. Move to an open area for a more accurate location." It is purely informational — it does not pause, block, or otherwise interfere with navigation, the calculated route, or the distance and time shown; it simply lets the passenger know their displayed position may not be precise, typically because they are indoors, under heavy cover, or in an area with poor satellite visibility, and suggests moving somewhere more open if better accuracy is needed.

**Map Display.**
During navigation, the map displays the passenger's own current position as a marker, the chosen destination as a separate marker, and a line showing the walking path between them, using the same open mapping service and visible map-source credit used throughout the rest of the passenger application. The system visually distinguishes a genuine, routing-service-calculated path, shown as a solid line, from a straight-line approximation used only as a fallback, shown as a distinctly dashed line — so a passenger can tell at a glance whether they are looking at a real walking path or only an estimate.

**Recenter Button.**
Pressing Recenter simply moves the map's view back to center on the passenger's current position and the destination; it does not request a new route or recalculate the distance and time shown. It exists purely to help a passenger who has panned or zoomed the map manually find their way back to a clear, centered view.

**Cancel Navigation Button.**
Pressing Cancel Navigation fully clears the current navigation session — the selected destination, the drawn walking path, and any arrival status are all reset — and returns the passenger to the earlier list of nearby terminals, with their previous search and the terminal rankings still intact rather than needing to be set up again.

**Limitations.**
A few practical limitations are worth understanding. The walking path shown is normally a genuine, real path-following route, but if the routing service cannot be reached or does not return a usable path, the system falls back to a simple straight-line estimate between the two points, clearly shown as a dashed line along with an on-screen notice explaining that a live route was unavailable. The system also automatically recalculates the walking path as the passenger moves, but only once they have drifted a meaningful distance (roughly sixty meters) from where the last path was calculated, and not more often than once every twelve seconds, to avoid overloading the routing service with requests. Finally, navigation can technically be started even without location permission granted, but without it the system cannot show the passenger's live position or draw an actual walking path at all — instead, a message explains that location access is needed, along with an option to try again, until permission is granted.

---

## Documentation Summary

The Passenger Navigation feature helps a commuter walk confidently from their current position to a chosen terminal, showing a realistic walking distance and time estimate, a path to follow on the map, and clear notices whenever the system is working with limited information — whether from poor GPS accuracy or an unavailable routing service — rather than silently presenting uncertain information as though it were fully reliable.

## Testing and Verification

This documentation is based entirely on direct inspection of the system's source code. It has not been confirmed through actual use of the running application in a browser, and no live walking-navigation session was performed as part of producing this documentation.
