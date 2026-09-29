# CHAPTER 4

# PRESENTATION, ANALYSIS, AND INTERPRETATION OF DATA

## 4.3 System Presentation

This section introduces the completed Bukidnon Bus Company @BUKSU system before discussing its evaluation. It presents the implemented features and interfaces of the Administrator Module, Commuter Interface, and Bus Attendant Mobile Application. Each functional requirement is demonstrated using an actual screenshot of the implemented system together with a short explanation of its purpose and functionality, followed by the corresponding source code implementation.

---

### 4.3.1 Administrator Module

The Administrator Module provides authorized personnel with tools for managing users, buses, routes, schedules, GPS monitoring, system configuration, reports, and system performance.

**Functional Requirement 1: Administrator Login**
The system shall allow authorized administrators to log in using their registered credentials or Google authentication.

(IMAGE HERE)
**Figure 4.1. Admin Login Interface**

Short Explanation:
Figure 4.1 presents the administrator login interface. The interface allows authorized administrators to access the system using their registered credentials or Google authentication. Upon successful authentication, the administrator is directed to the appropriate dashboard based on the assigned role. Invalid or unauthorized login attempts are rejected and displayed through an error message. The system also provides account recovery through the Forgot Password and Reset Password functions.

(IMAGE HERE)
**Figure 4.2. Admin Login Code Implementation**

Code Explanation:
The authentication process is implemented through the POST /login and POST /google-login routes in authTicketing.js. The system validates user credentials and generates a signed JSON Web Token (JWT). The requireAdminJwt.js middleware verifies the token and role before allowing access to protected administrator resources. Login attempts are also monitored by the account lockout service to prevent repeated unauthorized access.

**Functional Requirement 2: User Account Management**
The system shall allow administrators to add, edit, deactivate, and delete accounts of commuters and bus attendants.

(IMAGE HERE)
**Figure 4.3. User Account Management Interface**

Short Explanation:
Figure 4.3 presents the user management interface used by administrators to manage registered bus attendant/operator and driver records. Administrators can add, edit, deactivate, and remove personnel records and view individual personnel details and assignment history.

Important: Since commuters do not have accounts in the actual implementation, this section should not claim that administrators create commuter login accounts. Passenger-related records such as feedback and lost-item reports are managed separately.

(IMAGE HERE)
**Figure 4.4. User Account Management Code Implementation**

Code Explanation:
The account management functionality is implemented through the attendant and driver management routes and their corresponding database models. The system provides endpoints for approving, editing, and deactivating attendant records, while employee identification and assignment history are handled by the corresponding services. Passenger feedback and lost-item records are maintained separately from personnel accounts.

**Functional Requirement 3: Bus Management**
The system shall allow administrators to add new buses, update bus details, including assigned routes, and remove outdated bus records.

(IMAGE HERE)
**Figure 4.5. Bus Management Interface**

Short Explanation:
Figure 4.5 shows the bus management interface. Administrators can view the fleet, including bus identification, assigned route, seating capacity, and current operational status. The administrator can add new buses, update existing information, and remove outdated records. The bus detail interface also provides information regarding the vehicle's live location and operational data.

(IMAGE HERE)
**Figure 4.6. Bus Management Code Implementation**

Code Explanation:
The buses.js route provides the Create, Read, Update, and Delete (CRUD) operations for bus records. These operations are protected by administrator authentication. The Bus.js model stores important fleet information such as the plate number, seat capacity, and assigned route. Hardware devices used for GPS tracking are separately registered through the fleet hardware management functionality.

**Functional Requirement 4: Route and Schedule Management**
The system shall allow administrators to create and edit routes, destinations, and departure schedules.

(IMAGE HERE)
**Figure 4.7. Route and Schedule Management Interface**

Short Explanation:
Figure 4.7 presents the route and schedule management interface. Administrators can create and modify routes, destinations, bus stops, departure schedules, peak-hour dispatch schedules, and applicable holiday overrides. The interface also provides tools for managing the fare information associated with routes.

(IMAGE HERE)
**Figure 4.8. Route and Schedule Management Code Implementation**

Code Explanation:
The route management functionality is implemented through corridorRoutes.js, while dispatch and schedule management are handled by liveDispatch.js. Route information is stored through the CorridorRoute model, while schedules and dispatch blocks are managed through the live dispatch services. Fare information is maintained through the fare management routes and corresponding database models.

**Functional Requirement 5: Real-Time Bus Monitoring**
The system shall allow administrators to view the current locations of buses through GPS integration and monitor active routes.

(IMAGE HERE)
**Figure 4.9. Real-Time Bus Monitoring Interface**

Short Explanation:
Figure 4.9 shows the real-time bus monitoring interface. The administrator can view the current positions of active buses through a live map. Bus locations are continuously updated through the system's real-time communication mechanism without requiring the administrator to manually refresh the page.

(IMAGE HERE)
**Figure 4.10. Real-Time Bus Monitoring Code Implementation**

Code Explanation:
Incoming GPS coordinates are processed through the GPS ingestion and arbitration services. The system validates GPS coordinates, determines the authoritative GPS source, stores accepted GPS records, and broadcasts location updates through Socket.IO. This allows the administrator's map to update the bus position in real time.

**Functional Requirement 6: System Configuration**
The system shall allow administrators to manage system settings, including route updates and user and bus attendant privileges.

(IMAGE HERE)
**Figure 4.11. System Configuration Interface**

Short Explanation:
Figure 4.11 presents the system configuration interface. Administrators can manage system-wide settings, application access options, and role-based privileges. The system also provides audit records that allow authorized personnel to monitor changes made to important system configurations.

(IMAGE HERE)
**Figure 4.12. System Configuration Code Implementation**

Code Explanation:
The system configuration functionality is implemented through the administrator portal routes. Configuration settings are stored through the administrator settings service, while role-based access assignments are managed through the RBAC service. Changes to sensitive privileges require super-administrator authorization and are recorded in the audit log.

**Functional Requirement 7: Analytics and Reporting Module**
The system shall allow administrators to view data-driven summaries, usage statistics, and trend reports related to commuter activity, peak hours, system performance, and daily bus attendant reports.

(IMAGE HERE)
**Figure 4.13. Analytics and Reporting Interface**

Short Explanation:
Figure 4.13 shows the analytics and reporting interface. The administrator can view ticketing and commuter activity, identify peak operating periods, monitor system performance, and review daily operational reports submitted by bus attendants. Reports may also be exported for documentation and analysis.

(IMAGE HERE)
**Figure 4.14. Analytics and Reporting Code Implementation**

Code Explanation:
The reporting functionality uses MongoDB aggregation processes to analyze ticketing and GPS data. The reporting services generate usage statistics, peak-hour information, daily operational summaries, and downloadable reports. The collected ticketing data can therefore be used to identify operational trends across different hours, days, months, and years.

**Functional Requirement 8: Dashboard Trends and Visualization**
The system shall provide administrators with visual trend indicators and charts for commuter volume, peak hours, transportation update frequency, and system usage.

(IMAGE HERE)
**Figure 4.15. Dashboard Trends and Visualization Interface**

Short Explanation:
Figure 4.15 presents the dashboard's visual summaries of system and fleet activity. Charts and indicators allow administrators to interpret ticket volume, peak-hour patterns, transport updates, and fleet hardware status more easily.

(IMAGE HERE)
**Figure 4.16. Dashboard Trends and Visualization Code Implementation**

Code Explanation:
The dashboard statistics are generated by the management statistics endpoint, which aggregates fleet, ticketing, and device-health information. The FleetHardwareSummary.tsx component presents hardware-related information such as device status and GPS-source status in the administrator interface.

---

### 4.3.2 Commuter Interface

The Commuter Interface is the passenger-facing web application. It allows commuters to access route, schedule, bus monitoring, notification, and weather information without requiring a system account. The Passenger Backend serves as a gateway between the passenger application and the centralized Admin Backend.

**Functional Requirement 1: View Bus Routes and Schedules**
The system shall allow commuters to view available bus routes, destinations, and estimated departure and arrival times.

(IMAGE HERE)
**Figure 4.17. Bus Routes and Schedules Interface**

Short Explanation:
Figure 4.17 allows commuters to view available routes, destinations, terminals, and upcoming departures. The interface also assists commuters in locating nearby terminals and planning their trips.

(IMAGE HERE)
**Figure 4.18. Bus Routes and Schedules Code Implementation**

Code Explanation:
The passenger application obtains public fleet and schedule information through the Passenger Backend, which proxies the required requests to the Admin Backend. The frontend helper processes the returned information and makes it available to the passenger dashboard and station finder.

**Functional Requirement 2: Seat Availability Check**
The system shall allow commuters to view the current seat availability of the bus.

(IMAGE HERE)
**Figure 4.19. Seat Availability Interface**

Short Explanation:
Figure 4.19 displays the estimated seat availability information for active buses. The current implementation presents seat availability through a text-based indicator based on the available fleet information. A future version may introduce a visual seat plan with real-time per-seat occupancy.

(IMAGE HERE)
**Figure 4.20. Seat Availability Code Implementation**

Code Explanation:
The seat availability information is obtained from the public fleet data, including each bus's seating capacity. The frontend processes these values to produce the seat availability notice displayed to commuters. The current implementation does not use individual seat sensors or a live per-seat occupancy map.

**Functional Requirement 3: Real-Time Bus Monitoring**
The system shall allow commuters to view the current locations of active buses through GPS integration.

(IMAGE HERE)
**Figure 4.21. Real-Time Bus Monitoring Interface**

Short Explanation:
Figure 4.21 presents the passenger live map, where commuters can view the current positions of active buses. The interface also provides location-based assistance such as nearest-terminal information to help commuters determine where to go while waiting for a bus.

(IMAGE HERE)
**Figure 4.22. Real-Time Bus Monitoring Code Implementation**

Code Explanation:
The passenger application obtains live bus positions through the Passenger Backend, which retrieves GPS information from the Admin Backend. The frontend processes the data into map markers, while Socket.IO allows the bus positions to be updated without continuously refreshing the webpage.

**Functional Requirement 4: Notification and Alerts**
The system shall provide commuters with notifications and alerts regarding bus arrivals, schedule changes, and relevant trip updates.

(IMAGE HERE)
**Figure 4.23. Notification and Alerts Interface**

Short Explanation:
Figure 4.23 shows the notification and alerts interface. Commuters can receive announcements and travel-related alerts, including bus arrival information, schedule changes, and other messages issued by the administrator.

(IMAGE HERE)
**Figure 4.24. Notification and Alerts Code Implementation**

Code Explanation:
Administrator announcements are stored as application broadcasts and categorized according to their intended audience. The passenger command-feed service combines relevant announcements and travel advisories, which are then retrieved by the passenger interface and displayed through the notification and news components.

**Functional Requirement 5: Contextual Information Display (Weather)**
The system shall display local weather conditions to provide commuters with additional information for travel planning.

(IMAGE HERE)
**Figure 4.25. Weather Advisory Interface**

Short Explanation:
Figure 4.25 presents the weather information available to commuters. The interface displays local weather conditions and advisories associated with terminals or routes, helping commuters consider current weather conditions when planning their trips.

(IMAGE HERE)
**Figure 4.26. Weather Advisory Code Implementation**

Code Explanation:
The weather advisory service retrieves and classifies current weather conditions for designated locations. Weather information can also contribute to ETA calculations through the weather ETA multiplier. The resulting information is made available through the public command feed and displayed in the passenger interface.

---

### 4.3.3 Bus Attendant Mobile Application

The Bus Attendant Mobile Application is a Flutter-based mobile application used by bus attendants to access their assigned trip information, issue tickets, transmit GPS information, and receive system announcements. The application communicates with the centralized backend through the Bus Attendant Backend gateway.

**Functional Requirement 1: Attendant Login/Authentication**
The system shall allow bus attendants to securely log in and access their assigned bus and trip information.

(IMAGE HERE)
**Figure 4.27. Attendant Login Interface**

Short Explanation:
Figure 4.27 presents the login interface of the Bus Attendant Mobile Application. The attendant enters their assigned credentials to access the application. After successful authentication, the system loads the attendant's assigned bus and trip information.

(IMAGE HERE)
**Figure 4.28. Attendant Login Code Implementation**

Code Explanation:
The mobile application sends authentication information to the Bus Attendant Backend, which forwards the request to the Admin Backend. The system validates the attendant account and generates the necessary authentication tokens. These tokens are stored locally and attached to subsequent authorized requests.

**Functional Requirement 2: Trip Dashboard**
The system shall allow bus attendants to view their assigned route, bus number, and schedule for the current trip.

(IMAGE HERE)
**Figure 4.29. Trip Dashboard Interface**

Short Explanation:
Figure 4.29 shows the attendant's trip dashboard. It displays important trip information such as the assigned bus, route, and schedule, allowing the attendant to verify their assigned trip before beginning their operations.

(IMAGE HERE)
**Figure 4.30. Trip Dashboard Code Implementation**

Code Explanation:
The system retrieves the authenticated attendant's assigned bus and route through the assignment endpoint. The resulting trip information is mapped by the Flutter application and displayed on the dashboard and trip list screens.

**Functional Requirement 3: Ticketing**
The system shall allow bus attendants to record ticket or passenger transaction information for the analysis of passenger activity and peak travel periods by hour, day, month, and year.

(IMAGE HERE)
**Figure 4.31. Ticketing Interface**

Short Explanation:
Figure 4.31 presents the ticketing interface used by the bus attendant to record passenger boarding information. The attendant records the passenger's origin, destination, and applicable fare. Ticket records created during temporary connectivity loss can be stored locally and synchronized when the connection becomes available again.

(IMAGE HERE)
**Figure 4.32. Ticketing Code Implementation**

Code Explanation:
The ticketing process is implemented through the ticket issuance endpoint and IssuedTicketRecord model. Fare computation is performed using the system's fare services. The mobile application can temporarily store ticket transactions in its local ticket outbox and submit them when connectivity is restored. The resulting ticket records are also used as data for the analytics and reporting module.

**Functional Requirement 4: GPS Transmission**
The system shall automatically transmit the bus's real-time location to the cloud system through the available mobile network connection.

(IMAGE HERE)
**Figure 4.33. GPS Transmission Interface**

Short Explanation:
Figure 4.33 presents the GPS and network status indicators of the Bus Attendant Mobile Application. During an active trip, the application continuously obtains and transmits the bus's location. The interface informs the attendant when GPS visibility or network connectivity is interrupted.

(IMAGE HERE)
**Figure 4.34. GPS Transmission Code Implementation**

Code Explanation:
The Bus Attendant application transmits GPS coordinates to the backend through the GPS transmission endpoints. The Admin Backend processes and validates the coordinates before determining which GPS source should be considered authoritative.

GPS Source Priority: Bus Attendant Phone GPS → LILYGO Hardware GPS through Mobile Data → LILYGO Hardware GPS through SMS.

This allows the system to continue receiving location information when the primary source becomes unavailable. The GPS arbitration service also prevents an outdated hardware position from overriding a newer and valid attendant GPS position.

**Functional Requirement 5: Notification Handling**
The system shall allow bus attendants to receive notifications and updates from the administrator.

(IMAGE HERE)
**Figure 4.35. Notification Handling Interface**

Short Explanation:
Figure 4.35 shows the notification interface of the Bus Attendant Mobile Application. Attendants can receive administrator announcements, alerts, weather advisories, and other operational messages while using the application.

(IMAGE HERE)
**Figure 4.36. Notification Handling Code Implementation**

Code Explanation:
Administrator announcements targeted toward bus attendants are stored through the application's broadcast mechanism. The mobile application retrieves these messages through the Bus Attendant Backend and displays them through the notification banner and notification panel. Related system alerts, such as SOS and maintenance notifications, follow the same backend-to-mobile communication architecture.

**Functional Requirement 6: Smart Alert**
The system shall allow the bus attendant to send alerts or updates to the administrator and the passenger if the bus is having trouble or is caught in traffic.

(IMAGE HERE)
**Figure 4.37. Smart Alert Interface**

Short Explanation:
Figure 4.37 presents the Smart Alert interface of the Bus Attendant Mobile Application. When the bus encounters trouble — such as a mechanical issue, an accident, or a traffic delay — the attendant can report an SOS or an incident directly from the app, selecting the appropriate category and, for an SOS, its urgency level. The alert reaches the administrator immediately, and any resulting delay is also reflected to commuters through the passenger application's traffic and delay notices.

(IMAGE HERE)
**Figure 4.38. Smart Alert Code Implementation**

Code Explanation:
The Smart Alert functionality is implemented through the attendant SOS and incident-report endpoints, which record the report in the security log and immediately broadcast it to the Administrator Command Center in real time; an SOS report additionally triggers an email and SMS notification to the administrator. On the passenger side, ongoing delays — including those attributed to traffic — are automatically identified by the delay classification service and surfaced to commuters through the public command feed as a "Traffic & delays" advisory, without requiring the attendant to manually notify passengers.

---

## Notes for completing this section

- Replace every `(IMAGE HERE)` placeholder with an actual screenshot captured from the running system (web browser for Admin/Commuter, device or emulator for the Bus Attendant app) and an actual code editor screenshot of the implementing file — do not fabricate or substitute stock images.
- Figure numbers (4.1–4.38) are sequential; if a functional requirement is added, removed, or reordered, renumber the affected figures and their in-text references.
- For Figure 4.37 (Smart Alert interface), capture the attendant app's SOS/incident-report screen — `Frontend/BusAttendant_Frontend/lib/widgets/sos_alert_dialog.dart` — ideally with the category picker (accident/mechanical/traffic) or urgency level visible.
- For Figure 4.38 (Smart Alert code), the clearest crop is `Backend/Admin_Backend/routes/buses.js` (`POST /attendant-sos` and `POST /attendant-incident`, lines 216–363) for the admin-facing half, and `Backend/Admin_Backend/services/delayClassifier.js` + `services/passengerCommandFeed.js` (the `"feed-delays"` / `"Traffic & delays"` block) for the passenger-facing half — the two together are what the Code Explanation describes.
