import { useCallback, useEffect, useRef, useState } from "react";

export type PassengerLiveLocationStatus =
  | "idle"
  | "requesting"
  | "granted"
  | "denied"
  | "unavailable"
  | "timeout"
  | "error";

export type PassengerLivePosition = {
  lat: number;
  lng: number;
  accuracyM: number;
};

export type PassengerLiveLocationState = {
  status: PassengerLiveLocationStatus;
  position: PassengerLivePosition | null;
  error: string | null;
  retry: () => void;
};

/**
 * Continuous passenger GPS watch, shared by any walking-navigation UI.
 * This is PASSENGER-only location (for on-device walking guidance) — never used as bus location.
 */
export function usePassengerLiveLocation(active: boolean): PassengerLiveLocationState {
  const [status, setStatus] = useState<PassengerLiveLocationStatus>("idle");
  const [position, setPosition] = useState<PassengerLivePosition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setAttempt((a) => a + 1);
  }, []);

  useEffect(() => {
    if (!active) {
      setStatus("idle");
      return undefined;
    }

    if (!("geolocation" in navigator)) {
      setStatus("unavailable");
      setError("Geolocation is not supported on this device.");
      return undefined;
    }

    setStatus("requesting");
    setError(null);

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setStatus("granted");
        setError(null);
        setPosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: pos.coords.accuracy,
        });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setStatus("denied");
          setError("Location access is required to guide you to a bus station.");
        } else if (err.code === err.TIMEOUT) {
          setStatus("timeout");
          setError("Could not get a GPS fix in time. Try again in an open area.");
        } else {
          setStatus("error");
          setError("Unable to read your current location. Try again or check device settings.");
        }
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );

    watchIdRef.current = watchId;
    return () => {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [active, attempt]);

  return { status, position, error, retry };
}
