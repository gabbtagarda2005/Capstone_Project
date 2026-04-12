import { Navigate, Route, Routes } from "react-router-dom";
import { RequireAuth } from "@/components/RequireAuth";
import { SosInterceptProvider } from "@/context/SosInterceptContext";
import { TacticalNotificationProvider } from "@/context/TacticalNotificationContext";
import { AdminLayout } from "@/layouts/AdminLayout";
import { DashboardPage } from "@/pages/DashboardPage";
import { ForgotPasswordPage } from "@/pages/ForgotPasswordPage";
import { LandingPage } from "@/pages/LandingPage";
import { LoginPage } from "@/pages/LoginPage";
import { ManagementPage } from "@/pages/ManagementPage";
import { ManagementModulePage } from "@/pages/ManagementModulePage";
import { CommandCenterPage } from "@/pages/CommandCenterPage";
import { CommandCenterBroadcastPage } from "@/pages/CommandCenterBroadcastPage";
import { CommandCenterMaintenancePage } from "@/pages/CommandCenterMaintenancePage";
import { CommandCenterSystemFeedbackPage } from "@/pages/CommandCenterSystemFeedbackPage";
import { CommandCenterFleetSensorsPage } from "@/pages/CommandCenterFleetSensorsPage";
import { LocationsPage } from "@/pages/LocationsPage";
import { ReportsPage } from "@/pages/ReportsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { ResetPasswordPage } from "@/pages/ResetPasswordPage";
import { OperatorViewPage } from "@/pages/OperatorViewPage";
import { AdminAuditEntryPage } from "@/pages/management/AdminAuditEntryPage";
import { AdminOpsGuidePage } from "@/pages/management/AdminOpsGuidePage";
import { AttendantDetailPage } from "@/pages/management/AttendantDetailPage";
import { BusDetailPage } from "@/pages/management/BusDetailPage";
import { DriverDetailPage } from "@/pages/management/DriverDetailPage";
import { LocationDetailPage } from "@/pages/management/LocationDetailPage";
import { RouteDetailPage } from "@/pages/management/RouteDetailPage";
import { ScheduleGuidePage } from "@/pages/management/ScheduleGuidePage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      <Route element={<RequireAuth />}>
        <Route
          path="/dashboard"
          element={
            <SosInterceptProvider>
              <TacticalNotificationProvider>
                <AdminLayout />
              </TacticalNotificationProvider>
            </SosInterceptProvider>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="locations" element={<LocationsPage />} />
          <Route path="command" element={<CommandCenterPage />} />
          <Route path="command/broadcast" element={<CommandCenterBroadcastPage />} />
          <Route path="command/system-feedback" element={<CommandCenterSystemFeedbackPage />} />
          <Route path="command/maintenance" element={<CommandCenterMaintenancePage />} />
          <Route path="command/fleet-sensors" element={<CommandCenterFleetSensorsPage />} />
          <Route path="management" element={<ManagementPage />} />
          <Route path="management/buses/:busId" element={<BusDetailPage />} />
          <Route path="management/drivers/:driverId" element={<DriverDetailPage />} />
          <Route path="management/attendants/:attendantId" element={<AttendantDetailPage />} />
          <Route path="management/locations/:locationId" element={<LocationDetailPage />} />
          <Route path="management/routes/:routeId" element={<RouteDetailPage />} />
          <Route path="management/schedules/:scheduleSlug" element={<ScheduleGuidePage />} />
          <Route path="management/admins/overview" element={<AdminOpsGuidePage />} />
          <Route path="management/admins/audit/:logId" element={<AdminAuditEntryPage />} />
          <Route path="management/:moduleId" element={<ManagementModulePage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="operators/:operatorId" element={<OperatorViewPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
