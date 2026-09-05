import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "@/context/AuthContext";
import { AdminBrandingProvider } from "@/context/AdminBrandingContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { ToastProvider } from "@/context/ToastContext";
import App from "@/App";
import "sweetalert2/dist/sweetalert2.min.css";
import "@/styles/brandWordmark.css";
import "@/passenger/styles/global.css";
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
