import { useEffect, useRef, useState } from "react";
import { fetchDeployedPoints } from "@/lib/fetchPassengerMapData";
import { haversineKm } from "@/lib/passengerGeo";
import "./PassengerArrivalAlarm.css";

type ArrivalSpot = { label: string; lat: number; lng: number; radiusM: number };

/** Default catch radius when a stop has no configured geofence. */
const FALLBACK_RADIUS_M = 150;
/** Beeps to play once the passenger is inside the geofence. */
const ALARM_REPEATS = 5;
const ALARM_INTERVAL_MS = 900;

function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return "…";
  if (meters < 950) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function PassengerArrivalAlarm() {
  const [spots, setSpots] = useState<ArrivalSpot[]>([]);
  const [selected, setSelected] = useState("");
  const [armed, setArmed] = useState(false);
  const [arrived, setArrived] = useState(false);
  const [distanceM, setDistanceM] = useState<number | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);

  const watchIdRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const alarmTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchDeployedPoints()
      .then((rows) => {
        if (cancelled) return;
        const seen = new Set<string>();
        const list: ArrivalSpot[] = [];
        for (const r of rows) {
          const t = r.terminal;
          if (t?.name?.trim() && Number.isFinite(t.latitude) && Number.isFinite(t.longitude)) {
            const label = t.name.trim();
            if (!seen.has(label)) {
              seen.add(label);
              list.push({ label, lat: t.latitude, lng: t.longitude, radiusM: t.geofenceRadiusM || FALLBACK_RADIUS_M });
            }
          }
          for (const s of r.stops || []) {
            if (s.name?.trim() && Number.isFinite(s.latitude) && Number.isFinite(s.longitude)) {
              const label = s.name.trim();
              if (!seen.has(label)) {
                seen.add(label);
                list.push({ label, lat: s.latitude, lng: s.longitude, radiusM: s.geofenceRadiusM || FALLBACK_RADIUS_M });
              }
            }
          }
        }
        list.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
        setSpots(list);
      })
      .catch(() => {
        if (!cancelled) setSpots([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function stopWatching() {
    if (watchIdRef.current != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }

  function stopAlarmSound() {
    if (alarmTimerRef.current != null) {
      window.clearInterval(alarmTimerRef.current);
      alarmTimerRef.current = null;
    }
  }

  function beep() {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioCtxRef.current) audioCtxRef.current = new AudioCtx();
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") void ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.55);
    } catch {
      /* audio not available — vibration/visual alert still fire */
    }
  }

  function triggerArrival(spot: ArrivalSpot) {
    setArrived(true);
    setArmed(false);
    stopWatching();

    if (typeof navigator.vibrate === "function") {
      navigator.vibrate([400, 150, 400, 150, 400]);
    }

    let count = 0;
    beep();
    alarmTimerRef.current = window.setInterval(() => {
      count += 1;
      beep();
      if (count >= ALARM_REPEATS) stopAlarmSound();
    }, ALARM_INTERVAL_MS);

    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      try {
        new Notification("You've arrived!", { body: `You're near ${spot.label} — time to get off.` });
      } catch {
        /* ignore — visual banner already covers it */
      }
    }
  }

  async function armAlarm() {
    const spot = spots.find((s) => s.label === selected);
    if (!spot) return;
    setGeoError(null);
    setArrived(false);
    stopAlarmSound();

    if (!navigator.geolocation) {
      setGeoError("This device doesn't support location tracking.");
      return;
    }

    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      try {
        await Notification.requestPermission();
      } catch {
        /* not fatal — the on-screen alarm still works */
      }
    }

    setArmed(true);
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const km = haversineKm(pos.coords.latitude, pos.coords.longitude, spot.lat, spot.lng);
        const meters = km * 1000;
        setDistanceM(meters);
        if (meters <= spot.radiusM) triggerArrival(spot);
      },
      (err) => {
        setArmed(false);
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission denied — allow location access to use the arrival alarm."
            : "Could not read your location right now."
        );
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
  }

  function cancelAlarm() {
    setArmed(false);
    setArrived(false);
    setDistanceM(null);
    setGeoError(null);
    stopWatching();
    stopAlarmSound();
  }

  useEffect(
    () => () => {
      stopWatching();
      stopAlarmSound();
    },
    []
  );

  return (
    <div className="pd-arrival-alarm">
      <h2 className="pd-check-buses__block-title">Arrival alarm</h2>
      <p className="pd-arrival-alarm__hint">
        Pick your stop and we&apos;ll ring and vibrate your phone once you&apos;re there — handy if you doze off.
      </p>

      <label className="pd-fare-engine__field">
        <span className="pd-fare-engine__label">Notify me at</span>
        <select
          className="pd-fare-select"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={armed}
        >
          <option value="">Select a stop or terminal…</option>
          {spots.map((s) => (
            <option key={s.label} value={s.label}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      {!armed && !arrived ? (
        <button type="button" className="pd-arrival-alarm__btn" onClick={() => void armAlarm()} disabled={!selected}>
          🔔 Set arrival alarm
        </button>
      ) : null}

      {armed ? (
        <div className="pd-arrival-alarm__status" role="status" aria-live="polite">
          <span className="pd-arrival-alarm__pulse" aria-hidden />
          <span>
            Watching your location — {distanceM != null ? formatDistance(distanceM) : "locating…"} from {selected}
          </span>
          <button type="button" className="pd-arrival-alarm__cancel" onClick={cancelAlarm}>
            Cancel
          </button>
        </div>
      ) : null}

      {arrived ? (
        <div className="pd-arrival-alarm__arrived" role="alert">
          <span>🔔 You&apos;ve arrived at {selected}!</span>
          <button type="button" className="pd-arrival-alarm__cancel" onClick={cancelAlarm}>
            Dismiss
          </button>
        </div>
      ) : null}

      {geoError ? (
        <p className="pd-fare-engine__hint pd-fare-engine__hint--err" role="alert">
          {geoError}
        </p>
      ) : null}
    </div>
  );
}
