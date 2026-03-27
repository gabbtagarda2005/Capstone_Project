import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { signOut } from "firebase/auth";
import { api, getToken } from "@/lib/api";
import { getFirebaseAuth } from "@/lib/firebase";

import type { AdminRbacRole } from "@/lib/types";

export type AuthUser = {
  operatorId: number | string;
  firstName: string;
  lastName: string;
  middleName: string | null;
  email: string;
  phone: string | null;
  role: string;
  photoURL?: string | null;
  /** Present for Admin role: Super Admin vs Manager (enforced on API). */
  adminTier?: "super" | "manager" | null;
  /** Portal RBAC (Mongo); enforced on API. */
  rbacRole?: AdminRbacRole | null;
};

type AuthContextValue = {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: (idToken: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => getToken());
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(async () => {
    const auth = getFirebaseAuth();
    if (auth) {
      try {
        await signOut(auth);
      } catch {
        /* ignore */
      }
    }
    localStorage.clear();
    sessionStorage.clear();
    setToken(null);
    setUser(null);
    window.location.href = "/login";
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!getToken()) {
        setLoading(false);
        return;
      }
      try {
        const r = await api<{ user: AuthUser }>("/api/auth/me");
        if (!cancelled) setUser(r.user);
      } catch {
        if (!cancelled) {
          localStorage.removeItem("admin_token");
          setToken(null);
          setUser(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api<{ token: string; user: AuthUser }>("/api/auth/login", {
      method: "POST",
      json: { email, password },
    });
    localStorage.setItem("admin_token", r.token);
    setToken(r.token);
    setUser(r.user);
  }, []);

  const loginWithGoogle = useCallback(async (idToken: string) => {
    const r = await api<{ token: string; user: AuthUser }>("/api/auth/google-login", {
      method: "POST",
      json: { idToken },
    });
    localStorage.setItem("admin_token", r.token);
    setToken(r.token);
    setUser(r.user);
  }, []);

  const value = useMemo(
    () => ({ user, token, loading, login, loginWithGoogle, logout }),
    [user, token, loading, login, loginWithGoogle, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
