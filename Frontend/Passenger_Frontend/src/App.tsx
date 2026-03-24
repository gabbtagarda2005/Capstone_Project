import { Navigate, Route, Routes } from "react-router-dom";
import { PassengerDashboardPage } from "@/pages/PassengerDashboardPage";
import { PassengerLandingPage } from "@/pages/PassengerLandingPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<PassengerLandingPage />} />
      <Route path="/dashboard" element={<PassengerDashboardPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
