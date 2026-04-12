import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ThemeProvider } from "@/context/ThemeContext";
import { AuthProvider } from "@/context/AuthContext";
import { AdminBrandingProvider } from "@/context/AdminBrandingContext";
import { ToastProvider } from "@/context/ToastContext";
import App from "@/App";
import "sweetalert2/dist/sweetalert2.min.css";
import "@/index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <AdminBrandingProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </AdminBrandingProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>
);
