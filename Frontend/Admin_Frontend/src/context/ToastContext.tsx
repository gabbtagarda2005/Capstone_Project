import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AppToast, type AppToastVariant } from "@/components/AppToast";
import "@/components/AppToast.css";

export type ToastOptions = {
  variant?: AppToastVariant;
  durationMs?: number;
};

type ToastItem = { id: string; message: string; variant: AppToastVariant };

type ToastContextValue = {
  showToast: (message: string, options?: ToastOptions) => void;
  showError: (message: string, options?: Omit<ToastOptions, "variant">) => void;
  showSuccess: (message: string, options?: Omit<ToastOptions, "variant">) => void;
  showInfo: (message: string, options?: Omit<ToastOptions, "variant">) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION = 8000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, options?: ToastOptions) => {
      const variant = options?.variant ?? "info";
      const duration = options?.durationMs ?? DEFAULT_DURATION;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      setItems((prev) => [...prev, { id, message, variant }]);
      if (duration > 0) {
        window.setTimeout(() => dismiss(id), duration);
      }
    },
    [dismiss]
  );

  const showError = useCallback(
    (message: string, options?: Omit<ToastOptions, "variant">) => {
      showToast(message, { ...options, variant: "error" });
    },
    [showToast]
  );

  const showSuccess = useCallback(
    (message: string, options?: Omit<ToastOptions, "variant">) => {
      showToast(message, { ...options, variant: "success" });
    },
    [showToast]
  );

  const showInfo = useCallback(
    (message: string, options?: Omit<ToastOptions, "variant">) => {
      showToast(message, { ...options, variant: "info" });
    },
    [showToast]
  );

  const value = useMemo(
    () => ({ showToast, showError, showSuccess, showInfo }),
    [showToast, showError, showSuccess, showInfo]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="app-toast-stack" aria-live="polite">
        {items.map((t) => (
          <AppToast key={t.id} message={t.message} variant={t.variant} onClose={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
