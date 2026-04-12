import { Navigate, Route, Routes } from "react-router-dom";
import { PassengerDashboardRoute } from "@/components/PassengerDashboardRoute";
import { PassengerLandingPage } from "@/pages/PassengerLandingPage";
import { PassengerLocationPage } from "@/pages/PassengerLocationPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<PassengerLandingPage />} />
      <Route path="/enable-location" element={<PassengerLocationPage />} />
      <Route path="/dashboard" element={<PassengerDashboardRoute />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
