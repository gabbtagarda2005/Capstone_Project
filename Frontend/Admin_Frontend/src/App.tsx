import { Navigate, Route, Routes } from "react-router-dom";
import { RequireAuth } from "@/components/RequireAuth";
import { AdminLayout } from "@/layouts/AdminLayout";
import { DashboardPage } from "@/pages/DashboardPage";
import { ForgotPasswordPage } from "@/pages/ForgotPasswordPage";
import { LandingPage } from "@/pages/LandingPage";
import { LoginPage } from "@/pages/LoginPage";
import { ManagementPage } from "@/pages/ManagementPage";
import { ManagementModulePage } from "@/pages/ManagementModulePage";
import { CommandCenterPage } from "@/pages/CommandCenterPage";
import { LocationsPage } from "@/pages/LocationsPage";
import { ReportsPage } from "@/pages/ReportsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { ResetPasswordPage } from "@/pages/ResetPasswordPage";
import { OperatorViewPage } from "@/pages/OperatorViewPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      <Route element={<RequireAuth />}>
        <Route path="/dashboard" element={<AdminLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="locations" element={<LocationsPage />} />
          <Route path="command" element={<CommandCenterPage />} />
          <Route path="management" element={<ManagementPage />} />
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
