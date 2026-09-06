import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { fetchPublicFleetBuses, type PublicFleetBus } from "@/passenger/lib/fetchPublicFleetBuses";
import "./Bus3DHero.css";

function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl") || canvas.getContext("experimental-webgl"));
  } catch {
    return false;
  }
}

/** Draws text onto an offscreen canvas and returns it as a Three.js texture — used for the
 * destination sign, side livery, and plate, since we have no real decal/photo assets. */
function makeTextTexture(opts: {
  width: number;
  height: number;
  bg: string;
  text: string;
  textColor: string;
  fontWeight?: string;
  fontSize?: number;
  letterSpacing?: number;
  border?: string;
}): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = opts.width;
  canvas.height = opts.height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = opts.bg;
  ctx.fillRect(0, 0, opts.width, opts.height);
  if (opts.border) {
    ctx.strokeStyle = opts.border;
    ctx.lineWidth = Math.max(2, opts.width * 0.012);
    ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, opts.width - ctx.lineWidth, opts.height - ctx.lineWidth);
  }
  ctx.fillStyle = opts.textColor;
  const fontSize = opts.fontSize ?? Math.floor(opts.height * 0.52);
  ctx.font = `${opts.fontWeight ?? "800"} ${fontSize}px "Inter", system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (opts.letterSpacing) {
    const letterSpacing = opts.letterSpacing;
    // Manual letter-spacing since canvas 2D's built-in support is inconsistent across browsers.
    const chars = opts.text.split("");
    const widths = chars.map((c) => ctx.measureText(c).width);
    const total = widths.reduce((a, b) => a + b, 0) + letterSpacing * (chars.length - 1);
    let x = opts.width / 2 - total / 2;
    ctx.textAlign = "left";
    chars.forEach((c, i) => {
      ctx.fillText(c, x, opts.height / 2);
      x += (widths[i] ?? 0) + letterSpacing;
    });
  } else {
    ctx.fillText(opts.text, opts.width / 2, opts.height / 2 + fontSize * 0.02);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function buildBus(): THREE.Group {
  const bus = new THREE.Group();

  const WHITE = 0xf4f6f9;
  const BLUE = 0x1d4ed8;
  const BLUE_DARK = 0x0f2a6b;
  const GLASS = 0x0b1a33;

  // --- Body: white upper shell + blue lower skirt ---
  const bodyLength = 3.7;
  const bodyWidth = 1.5;
  const upperHeight = 0.78;
  const lowerHeight = 0.42;

  const upperMat = new THREE.MeshPhysicalMaterial({
    color: WHITE,
    roughness: 0.35,
    metalness: 0.15,
    clearcoat: 0.6,
    clearcoatRoughness: 0.25,
  });
  const lowerMat = new THREE.MeshPhysicalMaterial({
    color: BLUE,
    roughness: 0.4,
    metalness: 0.2,
    clearcoat: 0.4,
  });

  const upper = new THREE.Mesh(new THREE.BoxGeometry(bodyLength, upperHeight, bodyWidth), upperMat);
  upper.position.y = lowerHeight + upperHeight / 2;
  upper.castShadow = true;
  bus.add(upper);

  const lower = new THREE.Mesh(new THREE.BoxGeometry(bodyLength * 0.98, lowerHeight, bodyWidth * 0.99), lowerMat);
  lower.position.y = lowerHeight / 2;
  lower.castShadow = true;
  bus.add(lower);

  // Thin dark trim line where the white shell meets the blue skirt, for a more finished livery.
  const trim = new THREE.Mesh(
    new THREE.BoxGeometry(bodyLength * 0.985, 0.035, bodyWidth * 0.995),
    new THREE.MeshStandardMaterial({ color: BLUE_DARK, roughness: 0.5, metalness: 0.3 })
  );
  trim.position.y = lowerHeight;
  bus.add(trim);

  // Roof, slightly domed via a shallow box, plus a small AC unit for silhouette.
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(bodyLength * 0.96, 0.08, bodyWidth * 0.94),
    upperMat
  );
  roof.position.y = lowerHeight + upperHeight + 0.04;
  bus.add(roof);

  const ac = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.16, bodyWidth * 0.7),
    new THREE.MeshStandardMaterial({ color: 0xd8dee8, roughness: 0.6 })
  );
  ac.position.set(0.1, lowerHeight + upperHeight + 0.16, 0);
  bus.add(ac);

  // --- Windshield (angled) ---
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: GLASS,
    roughness: 0.08,
    metalness: 0.1,
    transmission: 0.35,
    transparent: true,
    opacity: 0.92,
    reflectivity: 0.6,
  });
  const windshield = new THREE.Mesh(new THREE.BoxGeometry(0.06, upperHeight * 0.82, bodyWidth * 0.92), glassMat);
  windshield.position.set(bodyLength / 2 - 0.02, lowerHeight + upperHeight / 2 + 0.02, 0);
  windshield.rotation.z = THREE.MathUtils.degToRad(8);
  bus.add(windshield);

  // --- Side windows: a row of glass panels on both flanks ---
  const windowCount = 7;
  const windowWidth = (bodyLength * 0.72) / windowCount - 0.05;
  const windowStartX = -bodyLength * 0.28;
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < windowCount; i++) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(windowWidth, upperHeight * 0.52, 0.04), glassMat);
      win.position.set(
        windowStartX + i * (windowWidth + 0.05),
        lowerHeight + upperHeight * 0.62,
        (side * bodyWidth) / 2 + side * 0.01
      );
      bus.add(win);
    }
  }

  // --- Livery text on both sides ---
  const sideLiveryTex = makeTextTexture({
    width: 1024,
    height: 160,
    bg: "rgba(0,0,0,0)",
    text: "BUKIDNON BUS COMPANY",
    textColor: "#0f2a6b",
    letterSpacing: 6,
  });
  sideLiveryTex.needsUpdate = true;
  const liveryMat = new THREE.MeshBasicMaterial({ map: sideLiveryTex, transparent: true });
  for (const side of [-1, 1]) {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.3), liveryMat);
    plane.position.set(-0.35, lowerHeight * 0.55, (side * bodyWidth) / 2 + side * 0.015);
    plane.rotation.y = side > 0 ? 0 : Math.PI;
    bus.add(plane);
  }

  // --- Front destination sign ---
  const signTex = makeTextTexture({
    width: 512,
    height: 128,
    bg: "#050b1a",
    text: "BUKIDNON",
    textColor: "#facc15",
    letterSpacing: 6,
    border: "#1e293b",
  });
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(0.95, 0.26),
    new THREE.MeshBasicMaterial({ map: signTex })
  );
  sign.position.set(bodyLength / 2 - 0.04, lowerHeight + upperHeight + 0.02, 0);
  sign.rotation.y = Math.PI / 2;
  bus.add(sign);

  // --- Front license plate ---
  const plateTex = makeTextTexture({
    width: 320,
    height: 110,
    bg: "#f8fafc",
    text: "BBC 2026",
    textColor: "#0f172a",
    letterSpacing: 4,
    border: "#0f172a",
  });
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.16), new THREE.MeshBasicMaterial({ map: plateTex }));
  plate.position.set(bodyLength / 2 + 0.005, lowerHeight * 0.55, 0);
  plate.rotation.y = Math.PI / 2;
  bus.add(plate);

  // --- Headlights / taillights ---
  const headlightMat = new THREE.MeshBasicMaterial({ color: 0xfff9e0 });
  const taillightMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
  for (const z of [-bodyWidth * 0.32, bodyWidth * 0.32]) {
    const hl = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 12), headlightMat);
    hl.position.set(bodyLength / 2 - 0.03, lowerHeight * 0.85, z);
    bus.add(hl);
    const tl = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 12), taillightMat);
    tl.position.set(-bodyLength / 2 + 0.03, lowerHeight * 0.85, z);
    bus.add(tl);
  }

  // --- Wheels ---
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x111318, roughness: 0.85 });
  const hubMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.4, metalness: 0.6 });
  const wheelXs = [-bodyLength * 0.32, bodyLength * 0.06, bodyLength * 0.34];
  for (const x of wheelXs) {
    for (const side of [-1, 1]) {
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.24, 20), tireMat);
      tire.rotation.x = Math.PI / 2;
      tire.position.set(x, 0.32, (side * bodyWidth) / 2 + side * 0.08);
      tire.castShadow = true;
      bus.add(tire);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.26, 16), hubMat);
      hub.rotation.x = Math.PI / 2;
      hub.position.copy(tire.position);
      hub.position.z += side * 0.005;
      bus.add(hub);
    }
  }

  // --- Side mirrors ---
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.05, 0.22),
      new THREE.MeshStandardMaterial({ color: 0x1e293b })
    );
    arm.position.set(bodyLength / 2 - 0.15, lowerHeight + upperHeight * 0.78, (side * bodyWidth) / 2 + side * 0.12);
    bus.add(arm);
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.12), glassMat);
    mirror.position.set(bodyLength / 2 - 0.15, lowerHeight + upperHeight * 0.78, (side * bodyWidth) / 2 + side * 0.2);
    bus.add(mirror);
  }

  bus.position.y = 0;
  return bus;
}

function buildPlatform(): { group: THREE.Group; rings: THREE.Mesh[] } {
  const group = new THREE.Group();
  const rings: THREE.Mesh[] = [];

  const discGeo = new THREE.CircleGeometry(2.4, 64);
  const discMat = new THREE.MeshBasicMaterial({ color: 0x061024, transparent: true, opacity: 0.55 });
  const disc = new THREE.Mesh(discGeo, discMat);
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = -0.01;
  disc.receiveShadow = true;
  group.add(disc);

  const ringRadii = [1.75, 2.1, 2.45];
  ringRadii.forEach((r, i) => {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(r, r + 0.02, 90),
      new THREE.MeshBasicMaterial({
        color: 0x22d3ee,
        transparent: true,
        opacity: 0.5 - i * 0.12,
        side: THREE.DoubleSide,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.005;
    group.add(ring);
    rings.push(ring);
  });

  return { group, rings };
}

function buildParticles(count: number): THREE.Points {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 1.4 + Math.random() * 2.2;
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = Math.random() * 2.6;
    positions[i * 3 + 2] = Math.sin(angle) * radius;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0x67e8f9,
    size: 0.03,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  return new THREE.Points(geo, mat);
}

type LiveCardData = {
  location: string;
  locationSub: string;
  gpsStatus: string;
  gpsSub: string;
  gpsOk: boolean;
  passengers: string;
  passengersSub: string;
};

const FALLBACK_CARD: LiveCardData = {
  location: "Waiting for GPS…",
  locationSub: "No recent fix",
  gpsStatus: "Searching…",
  gpsSub: "No signal yet",
  gpsOk: false,
  passengers: "—",
  passengersSub: "No data",
};

function Scene3D({ reducedMotion }: { reducedMotion: boolean }) {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, mount.clientWidth / mount.clientHeight, 0.1, 100);
    camera.position.set(3.1, 1.7, 3.6);
    camera.lookAt(0, 0.5, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.touchAction = "none";
    mount.appendChild(renderer.domElement);

    const root = new THREE.Group();
    scene.add(root);

    const bus = buildBus();
    root.add(bus);

    const { group: platform, rings } = buildPlatform();
    root.add(platform);

    const particles = buildParticles(90);
    root.add(particles);

    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(3, 5, 2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -3;
    key.shadow.camera.right = 3;
    key.shadow.camera.top = 3;
    key.shadow.camera.bottom = -3;
    const cyanFill = new THREE.PointLight(0x22d3ee, 1.4, 8);
    cyanFill.position.set(-2.5, 1.5, -2);
    const blueRim = new THREE.DirectionalLight(0x60a5fa, 0.5);
    blueRim.position.set(-2, 1, 3);
    scene.add(ambient, key, cyanFill, blueRim);

    // --- Drag-to-rotate with inertia ---
    let isDragging = false;
    let lastX = 0;
    let velocity = 0;
    let idleTimer = 0;

    const onPointerDown = (e: PointerEvent) => {
      isDragging = true;
      lastX = e.clientX;
      velocity = 0;
      idleTimer = 0;
      renderer.domElement.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - lastX;
      lastX = e.clientX;
      const delta = dx * 0.008;
      root.rotation.y += delta;
      velocity = delta;
    };
    const endDrag = (e: PointerEvent) => {
      if (!isDragging) return;
      isDragging = false;
      try {
        renderer.domElement.releasePointerCapture(e.pointerId);
      } catch {
        /* no-op */
      }
    };

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", endDrag);
    renderer.domElement.addEventListener("pointercancel", endDrag);

    const onResize = () => {
      if (!mount) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener("resize", onResize);

    const clock = new THREE.Clock();
    let raf = 0;
    const tick = () => {
      const dt = Math.min(clock.getDelta(), 0.05);

      if (!isDragging) {
        if (Math.abs(velocity) > 0.0002) {
          root.rotation.y += velocity;
          velocity *= 0.94;
        } else {
          idleTimer += dt;
          if (!reducedMotion && idleTimer > 1.2) {
            root.rotation.y += dt * 0.12;
          }
        }
      }

      rings.forEach((ring, i) => {
        ring.rotation.z += dt * (0.05 + i * 0.02) * (reducedMotion ? 0.3 : 1);
      });

      if (!reducedMotion) {
        const pos = particles.geometry.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) {
          let y = pos.getY(i) + dt * 0.12;
          if (y > 2.6) y = 0;
          pos.setY(i, y);
        }
        pos.needsUpdate = true;
      }

      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", endDrag);
      renderer.domElement.removeEventListener("pointercancel", endDrag);
      mount.removeChild(renderer.domElement);
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((m) => {
            const mat = m as THREE.MeshStandardMaterial;
            if (mat.map) mat.map.dispose();
            mat.dispose();
          });
        }
      });
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={mountRef} className="bus3d__canvas-mount" />;
}

function FallbackVisual() {
  return (
    <div className="bus3d__fallback" role="img" aria-label="Bukidnon Bus Company bus illustration">
      <svg viewBox="0 0 200 100" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="10" y="30" width="180" height="45" rx="10" fill="#f4f6f9" />
        <rect x="10" y="60" width="180" height="18" rx="4" fill="#1d4ed8" />
        <rect x="20" y="38" width="150" height="20" rx="4" fill="#0b1a33" opacity="0.85" />
        <circle cx="45" cy="82" r="10" fill="#111318" />
        <circle cx="45" cy="82" r="4" fill="#cbd5e1" />
        <circle cx="150" cy="82" r="10" fill="#111318" />
        <circle cx="150" cy="82" r="4" fill="#cbd5e1" />
        <text x="100" y="52" textAnchor="middle" fontSize="9" fontWeight="800" fill="#facc15">
          BUKIDNON
        </text>
      </svg>
      <p>360° preview needs a WebGL-capable browser</p>
    </div>
  );
}

export function Bus3DHero() {
  const [webglOk, setWebglOk] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [card, setCard] = useState<LiveCardData>(FALLBACK_CARD);

  useEffect(() => {
    setWebglOk(isWebGLAvailable());
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchPublicFleetBuses()
      .then((items: PublicFleetBus[]) => {
        if (cancelled || items.length === 0) return;
        const first = items[0];
        if (!first) return;
        const withGps = items.find((b) => b.lastLatitude != null && b.lastLongitude != null) ?? first;
        const gpsAgeMs = withGps.gpsRecordedAt ? Date.now() - new Date(withGps.gpsRecordedAt).getTime() : Infinity;
        const gpsFresh = gpsAgeMs < 5 * 60 * 1000;
        const routeLabel = withGps.routeStart && withGps.routeEnd
          ? `${withGps.routeStart} → ${withGps.routeEnd}`
          : withGps.route || null;
        setCard({
          location: withGps.lastLatitude != null ? routeLabel || "En route, Bukidnon" : "Waiting for GPS…",
          locationSub: withGps.busNumber ? `Bus ${withGps.busNumber}` : "No recent fix",
          gpsStatus: gpsFresh ? "Connected" : withGps.lastLatitude != null ? "Signal lost" : "Searching…",
          gpsSub: gpsFresh ? "Strong signal" : "No recent ping",
          gpsOk: gpsFresh,
          passengers: withGps.seatLine || (withGps.seatCapacity ? `${withGps.occupiedSeats ?? 0}/${withGps.seatCapacity}` : "—"),
          passengersSub: withGps.seatCapacity ? "On board" : "No data",
        });
      })
      .catch(() => {
        /* keep fallback card */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="bus3d" aria-label="Interactive 3D view of a Bukidnon Bus Company coach">
      {webglOk ? <Scene3D reducedMotion={reducedMotion} /> : <FallbackVisual />}

      {webglOk ? <p className="bus3d__hint">360° • DRAG TO ROTATE</p> : null}

      <div className="bus3d__cards">
      <div className="bus3d__card bus3d__card--location">
        <span className="bus3d__card-icon" aria-hidden>
          📍
        </span>
        <div>
          <p className="bus3d__card-label">Live location</p>
          <p className="bus3d__card-value">{card.location}</p>
          <p className="bus3d__card-sub">{card.locationSub}</p>
        </div>
      </div>

      <div className="bus3d__card bus3d__card--gps">
        <span className="bus3d__card-icon" aria-hidden>
          📡
        </span>
        <div>
          <p className="bus3d__card-label">GPS status</p>
          <p className={"bus3d__card-value" + (card.gpsOk ? " bus3d__card-value--ok" : " bus3d__card-value--warn")}>
            {card.gpsStatus}
          </p>
          <p className="bus3d__card-sub">{card.gpsSub}</p>
        </div>
      </div>

      <div className="bus3d__card bus3d__card--passengers">
        <span className="bus3d__card-icon" aria-hidden>
          🚍
        </span>
        <div>
          <p className="bus3d__card-label">Passengers</p>
          <p className="bus3d__card-value">{card.passengers}</p>
          <p className="bus3d__card-sub">{card.passengersSub}</p>
        </div>
      </div>

      <div className="bus3d__card bus3d__card--speed">
        <span className="bus3d__card-icon" aria-hidden>
          ⚡
        </span>
        <div>
          <p className="bus3d__card-label">Speed</p>
          <p className="bus3d__card-value">Not reported</p>
          <p className="bus3d__card-sub">Not in public feed</p>
        </div>
      </div>

      <div className="bus3d__card bus3d__card--fuel">
        <span className="bus3d__card-icon" aria-hidden>
          ⛽
        </span>
        <div>
          <p className="bus3d__card-label">Fuel level</p>
          <p className="bus3d__card-value">Not tracked</p>
          <p className="bus3d__card-sub">No fuel sensor</p>
        </div>
      </div>
      </div>
    </div>
  );
}
