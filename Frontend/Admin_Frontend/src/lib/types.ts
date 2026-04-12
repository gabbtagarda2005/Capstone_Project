export type TicketRow = {
  /** MySQL auto-increment or Mongo `IssuedTicketRecord` ObjectId string */
  id: number | string;
  passengerId: string;
  startLocation: string;
  destination: string;
  fare: number;
  /** From DB: issued_by_name and/or JOIN to bus_operators */
  busOperatorName: string;
  issuedByOperatorId: number;
  /** MySQL tickets.bus_number when column exists */
  busNumber?: string | null;
  createdAt: string;
};

/** Latest GPS row per bus from GET /api/buses/live */
export type BusLiveLogRow = {
  busId: string;
  latitude: number;
  longitude: number;
  speedKph?: number | null;
  heading?: number | null;
  recordedAt?: string;
  /** Present when pushed from attendant stream (socket / enriched feed). */
  attendantName?: string | null;
  /** Attendant connectivity: strong (Wi‑Fi / good data), weak (cellular / 3G class), offline. */
  signal?: "strong" | "weak" | "offline" | null;
  /** staff/mobile = attendant app GPS, hardware = LILYGO fail-safe feed */
  source?: "staff" | "mobile" | "hardware" | null;
  /** When source=hardware: wifi | 4g | unknown */
  net?: "wifi" | "4g" | "unknown" | null;
  signalStrength?: number | null;
  voltage?: number | null;
  etaMinutes?: number | null;
  etaTargetIso?: string | null;
  nextTerminal?: string | null;
  trafficDelay?: boolean;
};

export type FleetHardwareStatusRow = {
  busId: string;
  busNumber: string;
  route: string | null;
  source: "staff" | "hardware" | string;
  activeLink: "wifi" | "lte" | "unknown";
  signalStrengthDbm: number | null;
  signalLevel: "good" | "ok" | "warn" | "critical" | "unknown" | string;
  signalLabel: string;
  voltage: number | null;
  voltageLevel: "safe" | "warn" | "critical" | "unknown" | string;
  voltageLabel: string;
  alertRedPulse: boolean;
  lastSeenAt: string | null;
  staleSeconds: number | null;
  driverName?: string | null;
};

export type BusRow = {
  id: string;
  busId: string;
  busNumber: string;
  imei: string | null;
  plateNumber: string | null;
  /** Nominal passenger seats (admin-configured). */
  seatCapacity?: number;
  /** OTP-verified attendant id:
   *  - MySQL: numeric id as string (bus_operators.operator_id)
   *  - Mongo-only onboarding: PortalUser _id as string
   */
  operatorId: string | null;
  driverId: string | null;
  driverName: string | null;
  driverLicense: string | null;
  route: string | null;
  strictPickup?: boolean;
  status: string;
  healthStatus: string;
  ticketsIssued: number;
  lastUpdated: string | null;
  lastSeenAt: string | null;
  createdAt: string | null;
  /** When operator is a Mongo PortalUser (populated on detail/list). */
  attendantName?: string | null;
  /** Latest GpsLog snapshot — GET /api/buses/:id (Mongo id or fleet busId). */
  latestGps?: {
    latitude: number;
    longitude: number;
    speedKph?: number | null;
    heading?: number | null;
    recordedAt?: string | null;
  } | null;
};

export type DriverSummary = {
  id: string;
  driverId: string;
  firstName: string;
  lastName: string;
  middleName?: string | null;
  email?: string | null;
  phone?: string | null;
  licenseNumber: string | null;
  /** ISO date when known — admin alerts within 30 days */
  licenseExpiresAt?: string | null;
  yearsExperience?: number | null;
  profileImageUrl?: string | null;
  licenseScanUrl?: string | null;
  /** Gmail OTP wizard completed */
  otpVerified?: boolean;
  active: boolean;
  /** bcrypt-backed PIN exists for attendant ticket corrections */
  hasTicketEditPin?: boolean;
};

/** Audit entries when this driver's PIN authorized a ticket correction (MySQL ticket id). */
export type DriverTicketEditLogItem = {
  id: string;
  ticketMysqlId: number;
  attendantOperatorId: number;
  attendantName: string;
  busNumber: string;
  createdAt: string | null;
};

export type DriverTicketEditAuthResponse = {
  editCount: number;
  items: DriverTicketEditLogItem[];
};

export type OperatorSummary = {
  operatorId: number;
  /** Unique 6-digit personnel ID (assigned at creation). */
  employeeId?: string | null;
  firstName: string;
  lastName: string;
  middleName: string | null;
  email: string;
  phone: string | null;
  role: string;
  createdAt?: string;
  /** Gmail OTP onboarding completed (Mongo attendant_registry) */
  otpVerified?: boolean;
};

export type AttendantVerifiedSummary = {
  /** Attendant identifier for bus assignment dropdowns */
  operatorId: string;
  /** Unique 6-digit ID (matches MySQL employee_id / registry). */
  employeeId?: string | null;
  firstName: string;
  lastName: string;
  middleName: string | null;
  email: string;
  phone: string | null;
  role: string;
  otpVerified?: boolean;
  /** Data URL or HTTPS from attendant_registry / onboarding */
  profileImageUrl?: string | null;
};

export type LoginLogRow = {
  logId: number;
  operatorId: number;
  loginTimestamp: string;
};

/** Hub from Location Management (Mongo RouteCoverage, pointType terminal) */
export type CorridorBuilderTerminal = {
  _id: string;
  locationName: string;
  type: "terminal";
  terminal: { name: string; latitude?: number; longitude?: number; geofenceRadiusM?: number };
  locationPoint?: { name?: string; latitude?: number; longitude?: number } | null;
};

/** Bus stop row from GET /api/corridor-routes/builder-context */
export type CorridorBuilderStop = {
  _id: string;
  coverageId: string;
  locationName: string;
  pointType: string;
  sequence: number;
  name: string;
  latitude: number;
  longitude: number;
  geofenceRadiusM: number;
  /** false = flexible (free pickup zone along corridor after this stop) */
  pickupOnly?: boolean;
};

export type FareLocationOption = { token: string; label: string };

export type FareGlobalSettingsDto = {
  studentDiscountPct: number;
  pwdDiscountPct: number;
  seniorDiscountPct: number;
  farePerKmPesos: number;
  updatedAt?: string;
};

export type FareMatrixRowDto = {
  _id: string;
  startLabel: string;
  endLabel: string;
  baseFarePesos: number;
  updatedAt?: string;
};

export type AdminAuditLogRowDto = {
  id: string;
  email: string;
  module: string;
  action: string;
  details: string;
  timestamp: string;
  source?: string;
  statusCode?: number | null;
};

export type FareHistoryRowDto = {
  id: string;
  kind: string;
  actorEmail: string;
  summary: string;
  createdAt: string;
};

export type CorridorHubPin = {
  latitude: number;
  longitude: number;
  label: string;
  kind: "origin" | "via" | "destination";
};

/** Admin trip block → passenger live board row (via /api/public/live-board) */
export type LiveDispatchBlock = {
  id: string;
  busId: string;
  routeId: string;
  routeLabel: string;
  /** Terminal / place the bus departs from (passenger board) */
  departurePoint: string;
  /** HH:mm 24h */
  scheduledDeparture: string;
  /** YYYY-MM-DD (Asia/Manila) when set — passenger board hides past dates */
  serviceDate?: string | null;
  status: "on-time" | "delayed" | "cancelled" | "arriving";
  /** Set when GPS enters terminal geofence (ISO) */
  arrivalDetectedAt?: string;
  arrivalTerminalName?: string;
  /** Terminal / gate label (name or code) */
  gate?: string;
  /** Last docked terminal name (persists after arrival phase ends) */
  currentTerminalGate?: string;
  /** When status is arriving, ETA locks to this HH:mm (actual entry time) */
  arrivalLockedEta?: string;
  /** Computed rolling ETA minutes to destination terminal while in transit. */
  etaMinutes?: number | null;
  etaTargetIso?: string | null;
  nextTerminal?: string | null;
  createdAt?: string;
  updatedAt?: string;
  /** GPS / telemetry stale — board shows SIGNAL LOST / ESTIMATED */
  trackingLost?: boolean;
  trackingDegraded?: boolean;
  telemetrySignal?: "strong" | "weak" | "offline" | null;
};

export type CorridorRouteRow = {
  _id: string;
  displayName: string;
  originCoverageId: string;
  destinationCoverageId: string;
  originLabel: string;
  destLabel: string;
  viaCoverageIds?: string[];
  viaLabels?: string[];
  /** Origin → vias → destination terminal coordinates (for map when there are no authorized stop points). */
  corridorHubPins?: CorridorHubPin[];
  authorizedStops: Array<{
    coverageId: string;
    sequence: number;
    name: string;
    latitude: number;
    longitude: number;
    geofenceRadiusM: number;
    /** false = flexible corridor segment after this stop (pickup anywhere); omitted/true = strict */
    pickupOnly?: boolean;
  }>;
  /** Corridor temporarily disabled for dispatch / tracking surfaces. */
  suspended?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type ReportPickupRow = {
  location: string;
  ticketCount: number;
  revenue: number;
  sharePct: number;
  status: string;
};

export type ReportRouteRow = { route: string; tickets: number; revenue: number };

export type ReportDailyBucket = { date: string; tickets: number; revenue: number };
export type ReportMonthlyBucket = { month: number; label: string; tickets: number; revenue: number };
export type ReportYearlyBucket = { year: number; tickets: number; revenue: number };

export type ReportBusRow = { busLabel: string; tickets: number; revenue: number };

export type ReportsAnalyticsDto = {
  generatedAt: string;
  constants: { monthlyProfitGoalPesos: number; tomorrowGrowthRate: number };
  executive: {
    totalRevenue: number;
    totalTickets: number;
    todayRevenue: number;
    todayTickets: number;
    monthlyRevenue: number;
    monthlyProfitGoalPesos: number;
    goalProgressPct: number;
    tomorrowProjection: number;
    avgDailyLast7Days: number;
    /** Present when API returns extended analytics */
    ytdRevenue?: number;
    ytdTickets?: number;
    todayHourlyRevenueTotal?: number;
  };
  topPickupLocations: ReportPickupRow[];
  topRoutes: ReportRouteRow[];
  hourlyToday: Array<{ hour: number; tickets: number; revenue: number }>;
  dailyLast14?: ReportDailyBucket[];
  monthlyThisYear?: ReportMonthlyBucket[];
  yearlyAll?: ReportYearlyBucket[];
  topPickupsToday?: ReportPickupRow[];
  topPickupsLast30?: ReportPickupRow[];
  topPickupsMtd?: ReportPickupRow[];
  topPickupsYtd?: ReportPickupRow[];
  peakPickups?: {
    hour: { slot: number; tickets: number; locations: ReportPickupRow[] };
    day: { date: string; tickets: number; locations: ReportPickupRow[] };
    month: { month: number; label: string; tickets: number; locations: ReportPickupRow[] };
    year: { year: number; tickets: number; locations: ReportPickupRow[] };
  };
  topBusesAll?: ReportBusRow[];
  routesForTopBuses?: ReportRouteRow[];
  allRoutes?: ReportRouteRow[];
  operatorsAllTime: Array<{ operatorId: number | string; operator: string; tickets: number; revenue: number }>;
  operatorsToday: Array<{ operatorId: number | string; operator: string; tickets: number; revenue: number }>;
  refunds: Array<{
    id: number | string;
    passengerId: string;
    route: string;
    amount: number;
    createdAt: string;
  }>;
  insights: {
    peakBoardingWindow: { startHour: number; endHour: number };
    peakCorridorHint: string;
    routeDelaySentiment: string;
    suggestedExtraBuses: number;
  };
};

/** GET /api/reports/daily-operations — tactical debrief (Mongo + dispatch JSON + optional MySQL login_logs) */
export type DailyOperationsFleetStatus = {
  totalRegistered: number;
  activeGps: number;
  stationary: number;
  sosCount: number;
};

export type DailyOperationsArrivalRow = {
  busId: string;
  routeLabel: string;
  terminal: string;
  scheduledBoard: string;
  geofenceArrivalAt: string | null;
  varianceMinutes: number | null;
  onTime: boolean;
  statusLabel: string;
  gate: string | null;
};

export type DailyOperationsTerminalHub = {
  terminal: string;
  arrivals: number;
  onTime: number;
  late: number;
  early: number;
  onTimePct: number;
  tier: "green" | "amber" | "red" | "neutral";
  tierLabel: string;
  tierHint: string;
};

export type DailyOperationsSpeedRow = {
  busId: string;
  staff: string;
  incident: string;
  speedKph: number | null;
  location: string;
  timestamp: string | null;
  latitude: number | null;
  longitude: number | null;
};

/** Peak logged speed per bus (for safety summary tables). */
export type DailyOperationsSpeedPeakRow = {
  busId: string;
  attendantName: string;
  topSpeedKph: number;
  at: string | null;
};

export type DailyOperationsIncidentRow = {
  busId: string;
  staff: string;
  incident: string;
  speedKph: number | null;
  location: string;
  timestamp?: string | null;
  varianceMinutes?: number | null;
  scheduledBoard?: string;
};

export type DailyOperationsConnectivityRouteRow = {
  routeLabel: string;
  strongPct: number;
  weakPct: number;
  offlinePct: number;
  sampleCount: number;
  tier: string;
};

export type DailyOperationsCrewRow = {
  source: string;
  operatorId?: number;
  busId?: string;
  name?: string;
  email?: string | null;
  firstLogin?: string | null;
  lastLogin?: string | null;
  loginEvents?: number;
  firstPing?: string | null;
  lastPing?: string | null;
  pingCount?: number;
  note?: string;
  error?: string;
};

/** GET /api/security/logs?type=speed_violation — row shape for Reports speed table */
export type SpeedViolationLogRow = {
  id: string;
  type?: string;
  busId: string;
  message: string;
  severity?: string;
  latitude?: number | null;
  longitude?: number | null;
  assignedRoute?: string | null;
  source?: string;
  attendantDisplayName?: string | null;
  createdAt?: string | null;
};

export type DailyOperationsReportDto = {
  ok: true;
  generatedAt: string;
  reportDate: string;
  fleetStatus: DailyOperationsFleetStatus;
  arrivalPrecision: DailyOperationsArrivalRow[];
  terminalHubs: DailyOperationsTerminalHub[];
  speedViolations: DailyOperationsSpeedRow[];
  /** Present on newer APIs — peak speed per bus for safety summary. */
  speedingPeakByBus?: DailyOperationsSpeedPeakRow[];
  incidentTable: DailyOperationsIncidentRow[];
  crewActivity: DailyOperationsCrewRow[];
  connectivityByRoute?: DailyOperationsConnectivityRouteRow[];
  meta: {
    onTimeToleranceMinutes: number;
    activeGpsWindowMinutes: number;
    geofenceTerminalNote?: string;
  };
  arrivalSummary?: {
    onTimeTrips: number;
    totalTrips: number;
    precisionPct: number;
  };
};

export type DailyOpsSnapshotFileDto = {
  name: string;
  size: number;
  modifiedAt: string;
};

export type DailyOpsSnapshotListDto = {
  items: DailyOpsSnapshotFileDto[];
  configured?: boolean;
  message?: string;
};

export type AdminRbacRole = "super_admin" | "fleet_manager" | "auditor";

/** GET /api/passenger-feedback/dashboard — passenger feedback intelligence payload */
export type PassengerFeedbackAbout = "bus" | "driver" | "attendant" | "location";

export type PassengerFeedbackIntelRow = {
  id: string;
  passengerName: string;
  rating: number;
  comment: string;
  driverId: string;
  driverName: string;
  attendantId: string;
  attendantName: string;
  busPlate: string;
  routeName: string;
  /** Passenger-selected or inferred topic for admin filtering */
  feedbackAbout?: PassengerFeedbackAbout;
  latitude: number | null;
  longitude: number | null;
  isSos: boolean;
  createdAt: string | null;
};

export type PassengerFeedbackDashboardDto = {
  updatedAt: string;
  /** Share of ratings ≥4 stars */
  overallPositivePct: number;
  totalSamples: number;
  criticalAlerts: PassengerFeedbackIntelRow[];
  liveSignalFeed: PassengerFeedbackIntelRow[];
  keywords: { word: string; count: number }[];
  topDrivers: { driverId: string; driverName: string; avgRating: number; sampleSize: number }[];
  routeHotspots: { routeName: string; negativeCount: number; latitude: number; longitude: number }[];
};

export type FleetMode = "standard" | "maintenance" | "storm";

export type AttendantAppAccessDto = {
  dashboard: boolean;
  tickets: boolean;
  editPassenger: boolean;
  notification: boolean;
  settings: boolean;
};

export type PassengerAppAccessDto = {
  dashboard: boolean;
  scheduled: boolean;
  checkBuses: boolean;
  newsUpdates: boolean;
  feedbacks: boolean;
  otherPages: boolean;
};

export type AdminPortalSettingsDto = {
  maxLoginAttempts: number;
  lockoutMinutes: number;
  sessionTimeoutMinutes: number;
  delayThresholdMinutes?: number;
  emailDailySummary: boolean;
  soundAlerts: boolean;
  timezone: string;
  currency: string;
  geofenceBreachToasts: boolean;
  sensitiveActionConfirmation: boolean;
  companyName: string;
  sidebarLogoUrl: string | null;
  faviconUrl: string | null;
  reportFooter: string;
  companyEmail?: string | null;
  companyPhone?: string | null;
  companyLocation?: string | null;
  securityPolicyApplyAdmin?: boolean;
  securityPolicyApplyAttendant?: boolean;
  attendantAppAccess?: AttendantAppAccessDto;
  passengerAppAccess?: PassengerAppAccessDto;
  maintenanceShieldEnabled?: boolean;
  maintenancePassengerLocked?: boolean;
  maintenanceAttendantLocked?: boolean;
  maintenanceMessage?: string;
  maintenanceScheduledUntil?: string | null;
  minAttendantAppVersion?: string;
  fleetMode?: FleetMode;
  /** Automated daily operational log email (Admin Reports + cron) */
  dailyOpsReportEmailEnabled?: boolean;
  dailyOpsReportEmailTime?: string;
  dailyOpsReportEmailRecipients?: string[];
};
