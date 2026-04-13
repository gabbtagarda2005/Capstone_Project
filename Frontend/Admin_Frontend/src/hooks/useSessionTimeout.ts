import { useEffect, useCallback, useRef } from "react";
import { signOut } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase";

/**
 * Logs out after `timeoutMinutes` of no pointer/keyboard/scroll/touch activity.
 * Uses Firebase sign-out when configured, then clears storage and redirects to /login.
 * When `enabled` is false (Admin Settings → Security → policy off), timers are not started.
 */
export function useSessionTimeout(timeoutMinutes: number, enabled = true) {
  const minutesRef = useRef(Math.max(5, Math.min(480, timeoutMinutes || 30)));

  useEffect(() => {
    minutesRef.current = Math.max(5, Math.min(480, timeoutMinutes || 30));
  }, [timeoutMinutes]);

  const logout = useCallback(async () => {
    const auth = getFirebaseAuth();
    if (auth) {
      try {
        await signOut(auth);
      } catch {
        /* ignore */
      }
    }
    const noticeKey = "admin_notice_session_expired";
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem(noticeKey, "1");
    window.location.href = "/login";
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    if (!enabled) {
      return () => {
        if (timer) clearTimeout(timer);
      };
    }

    const schedule = () => {
      if (timer) clearTimeout(timer);
      const ms = minutesRef.current * 60 * 1000;
      timer = setTimeout(logout, ms);
    };

    const events = ["mousedown", "keydown", "scroll", "touchstart"] as const;
    const reset = () => schedule();

    events.forEach((ev) => window.addEventListener(ev, reset, { passive: true }));
    schedule();

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, reset));
      if (timer) clearTimeout(timer);
    };
  }, [logout, timeoutMinutes, enabled]);
}
