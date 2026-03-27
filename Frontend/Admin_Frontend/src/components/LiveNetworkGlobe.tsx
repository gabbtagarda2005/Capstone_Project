import { useEffect, useRef } from "react";
import * as THREE from "three";

function latLonToVector3(lat: number, lon: number, radius: number) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

const ACTIVE_BUSES = [
  { id: "3423424", lat: 8.1477, lon: 125.1324 },
  { id: "BUK-101", lat: 7.9042, lon: 125.0938 },
  { id: "BUK-232", lat: 7.7617, lon: 125.0053 },
  { id: "BUK-501", lat: 7.6889, lon: 125.0068 },
];

export function LiveNetworkGlobe() {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, mount.clientWidth / mount.clientHeight, 0.1, 1000);
    camera.position.set(0, 0, 4.2);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    const root = new THREE.Group();
    scene.add(root);

    const globeGeo = new THREE.SphereGeometry(1.3, 64, 64);
    const globeMat = new THREE.MeshPhysicalMaterial({
      color: "#1e40af",
      emissive: "#1d4ed8",
      emissiveIntensity: 0.35,
      roughness: 0.35,
      metalness: 0.15,
      transmission: 0.12,
      transparent: true,
      opacity: 0.95,
    });
    const globe = new THREE.Mesh(globeGeo, globeMat);
    root.add(globe);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.85, 0.015, 24, 240),
      new THREE.MeshBasicMaterial({ color: "#22d3ee", transparent: true, opacity: 0.45 })
    );
    ring.rotation.x = Math.PI / 3.2;
    root.add(ring);

    const pointsMat = new THREE.MeshBasicMaterial({ color: "#22d3ee" });
    ACTIVE_BUSES.forEach((bus) => {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 12), pointsMat);
      dot.position.copy(latLonToVector3(bus.lat, bus.lon, 1.32));
      root.add(dot);
    });

    const bukidnonGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 16, 16),
      new THREE.MeshBasicMaterial({ color: "#ef4444", transparent: true, opacity: 0.9 })
    );
    bukidnonGlow.position.copy(latLonToVector3(8.0515, 125.0, 1.34));
    root.add(bukidnonGlow);

    const ambient = new THREE.AmbientLight("#ffffff", 0.55);
    const keyLight = new THREE.DirectionalLight("#a855f7", 1.2);
    keyLight.position.set(3, 2, 3);
    const fillLight = new THREE.DirectionalLight("#22d3ee", 0.8);
    fillLight.position.set(-2, -1, 2);
    scene.add(ambient, keyLight, fillLight);

    const clock = new THREE.Clock();
    let targetCameraZ = 4.2;
    let targetRotY = 0;
    let clickZoomed = false;

    const onClick = () => {
      clickZoomed = !clickZoomed;
      targetCameraZ = clickZoomed ? 2.45 : 4.2;
      targetRotY = clickZoomed ? -0.42 : 0;
    };
    renderer.domElement.addEventListener("click", onClick);

    const onResize = () => {
      if (!mount) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener("resize", onResize);

    let raf = 0;
    const tick = () => {
      const dt = clock.getDelta();
      root.rotation.y += dt * 0.18;
      root.rotation.y += (targetRotY - root.rotation.y) * 0.045;
      camera.position.z += (targetCameraZ - camera.position.z) * 0.06;
      bukidnonGlow.scale.setScalar(1 + Math.sin(clock.elapsedTime * 3.4) * 0.14);
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      renderer.domElement.removeEventListener("click", onClick);
      mount.removeChild(renderer.domElement);
      globeGeo.dispose();
      globeMat.dispose();
      renderer.dispose();
      scene.clear();
    };
  }, []);

  return <div ref={mountRef} className="neo-globe-3d" />;
}
