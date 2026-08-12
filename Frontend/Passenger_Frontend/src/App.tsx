import { Navigate, Route, Routes } from "react-router-dom";
import { PassengerDashboardRoute } from "@/components/PassengerDashboardRoute";
import { PassengerLandingPage } from "@/pages/PassengerLandingPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<PassengerLandingPage />} />
      <Route path="/enable-location" element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<PassengerDashboardRoute />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
