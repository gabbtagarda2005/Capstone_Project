export type TicketRow = {
  id: number;
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

export type BusRow = {
  id: string;
  busId: string;
  busNumber: string;
  imei: string | null;
  plateNumber: string | null;
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
  yearsExperience?: number | null;
  profileImageUrl?: string | null;
  licenseScanUrl?: string | null;
  /** Gmail OTP wizard completed */
  otpVerified?: boolean;
  active: boolean;
};

export type OperatorSummary = {
  operatorId: number;
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
};

export type FareLocationOption = { token: string; label: string };

export type FareGlobalSettingsDto = {
  studentDiscountPct: number;
  pwdDiscountPct: number;
  seniorDiscountPct: number;
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

export type CorridorRouteRow = {
  _id: string;
  displayName: string;
  originCoverageId: string;
  destinationCoverageId: string;
  originLabel: string;
  destLabel: string;
  viaCoverageIds?: string[];
  viaLabels?: string[];
  authorizedStops: Array<{
    coverageId: string;
    sequence: number;
    name: string;
    latitude: number;
    longitude: number;
    geofenceRadiusM: number;
  }>;
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
  operatorsAllTime: Array<{ operatorId: number; operator: string; tickets: number; revenue: number }>;
  operatorsToday: Array<{ operatorId: number; operator: string; tickets: number; revenue: number }>;
  refunds: Array<{
    id: number;
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

export type AdminRbacRole = "super_admin" | "fleet_manager" | "auditor";

export type AdminPortalSettingsDto = {
  maxLoginAttempts: number;
  lockoutMinutes: number;
  sessionTimeoutMinutes: number;
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
};
