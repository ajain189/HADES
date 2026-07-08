import { useEffect, useRef, useState } from "react";
import type * as THREE from "three";

/* Interactive exploded-view drone hero. The real CAD assembly (decimated from the build's
 * .blend) loads as a meshopt GLB. Pinning is native position:sticky inside a tall wrapper
 * (no scroll spacers, no trigger libraries): one rAF reads the wrapper's scroll progress,
 * eases it, and writes --explode on the hero; the 3D scene and the copy both consume it.
 * The visitor can grab the airframe and spin it at any point. Fallbacks: poster render on
 * no-WebGL / reduced-motion / file://. */

// Exploded offsets in the MODEL's frame (x = right arm, y = rear arm, z = up), applied in
// world space so the nested FBX empties' 0.01x/100x scales cannot distort them. Keys match
// GLTFLoader-sanitized node names through norm().
const PARTS: Record<string, { off: [number, number, number]; label?: string; sub?: string }> = {
  "Main Body (1)": { off: [0, 0, 0], label: "Airframe", sub: "3D printed monocoque" },
  "2306 motor": { off: [90, 0, -12], label: "2306 motors, all four", sub: "brushless" },
  "2306 motor.001": { off: [0, 90, -12] },
  "2306 motor.002": { off: [-90, 0, -12] },
  "2306 motor.003": { off: [0, -90, -12] },
  "Prop5in_Prop5in_0.001": { off: [55, 0, 130], label: "5 inch props", sub: "tri-blade" },
  "Prop5in_Prop5in_0.002": { off: [0, 55, 130] },
  "Prop5in_Prop5in_0.003": { off: [-55, 0, 130] },
  "Prop5in_Prop5in_0.004": { off: [0, -55, 130] },
  "DJI O4 AIR UNIT PRO": { off: [0, -170, 30], label: "DJI O4 Pro air unit", sub: "digital video link" },
  "DJI O4 PRO CAM": { off: [0, -170, 130], label: "O4 camera", sub: "the survivor's eye view" },
  "ImageToStl.com_RadioMaster+RP1": { off: [150, 0, 80], label: "ELRS receiver", sub: "control and telemetry" },
  "ImageToStl.com_Tattu_6S_6000mAh_35C": { off: [-150, 60, 80], label: "6S battery", sub: "the flight window" },
  "SpeedyBee F405 Mini Stack": { off: [0, 160, 90], label: "F405 flight controller", sub: "telemetry out" },
};
const norm = (s: string) => s.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
const PARTS_BY_NORM = new Map(Object.entries(PARTS).map(([k, v]) => [norm(k), v]));

// the scrub stays LINEAR in scroll: Lenis already smooths wheel input, and any easing here
// compresses the explode into the top of the pin and hands the rest to the end-dissolve

export function DroneHero({ wrapRef }: { wrapRef: React.RefObject<HTMLDivElement | null> }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [webglOk, setWebglOk] = useState<boolean | null>(null);
  const stateRef = useRef({ t: 0, yaw: 0, dragging: false, interacted: false });
  const renderRef = useRef<(() => void) | null>(null);

  // progress driver: sticky wrapper scroll fraction -> eased --explode custom property
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const wrap = wrapRef.current;
    if (reduced || !wrap) return;
    let raf = 0;
    let last = -1;
    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(wrap);
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!visible) return;
      const r = wrap.getBoundingClientRect();
      const span = r.height - window.innerHeight;
      const t = span > 0 ? Math.min(1, Math.max(0, -r.top / span)) : 0;
      const s = stateRef.current;
      // idle: a slow turntable drift until the visitor grabs it
      if (!s.interacted && t < 0.02) s.yaw += 0.0016;
      if (Math.abs(t - s.t) > 0.0005 || !s.dragging) {
        s.t = t;
        wrap.style.setProperty("--explode", t.toFixed(4));
      }
      renderRef.current?.();
      last = t;
      void last;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [wrapRef]);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const probe = document.createElement("canvas");
    const gl = probe.getContext("webgl2") ?? probe.getContext("webgl");
    if (!gl || reduced || location.protocol === "file:") {
      setWebglOk(false);
      return;
    }
    setWebglOk(true);

    const mount = mountRef.current;
    if (!mount) return;
    let disposed = false;
    let cleanup: (() => void) | null = null;

    (async () => {
      const [THREE, { GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
        import("three"),
        import("three/examples/jsm/loaders/GLTFLoader.js"),
        import("three/examples/jsm/libs/meshopt_decoder.module.js"),
      ]);
      if (disposed) return;

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      mount.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      // tighter FOV + closer dolly makes the airframe the dominant object in the hero
      const camera = new THREE.PerspectiveCamera(30, mount.clientWidth / mount.clientHeight, 1, 5000);
      camera.position.set(400, 285, 545);
      camera.lookAt(0, 66, 0);

      scene.add(new THREE.AmbientLight(0xffffff, 0.9));
      const key = new THREE.DirectionalLight(0xffffff, 2.2);
      key.position.set(-300, 500, 400);
      scene.add(key);
      const rim = new THREE.DirectionalLight(0xf2fffc, 1.1);
      rim.position.set(400, 200, -300);
      scene.add(rim);

      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL ?? "/"}landing/drone.glb`);
      if (disposed) return;

      const root = gltf.scene;
      root.position.set(0, -70, 0);
      scene.add(root);

      // base positions captured in the ROOT's frame; explode = root-frame offset, converted
      // back through each part's parent so nested transforms stay honest
      root.updateMatrixWorld(true);
      const movers: {
        obj: THREE.Object3D;
        offRoot: THREE.Vector3;
        baseRoot: THREE.Vector3;
        el?: HTMLDivElement;
      }[] = [];
      root.traverse((o) => {
        const spec = PARTS_BY_NORM.get(norm(o.name));
        if (!spec) return;
        const baseRoot = root.worldToLocal(o.getWorldPosition(new THREE.Vector3()));
        const offRoot = new THREE.Vector3(spec.off[0], spec.off[2], -spec.off[1]);
        let el: HTMLDivElement | undefined;
        if (spec.label) {
          el = document.createElement("div");
          el.className = "hero3d-callout";
          el.innerHTML = `<span class="hero3d-callout-tick"></span><span><strong>${spec.label}</strong><em>${spec.sub ?? ""}</em></span>`;
          mount.appendChild(el);
        }
        movers.push({ obj: o, offRoot, baseRoot, el });
      });

      const state = stateRef.current;
      const tmp = new THREE.Vector3();
      const render = () => {
        root.rotation.y = -0.4 + state.t * 0.55 + state.yaw;
        root.updateMatrixWorld(true);
        for (const m of movers) {
          tmp.copy(m.baseRoot).addScaledVector(m.offRoot, state.t);
          root.localToWorld(tmp);
          m.obj.parent?.worldToLocal(tmp);
          m.obj.position.copy(tmp);
        }
        renderer.render(scene, camera);
        for (const m of movers) {
          if (!m.el) continue;
          m.obj.getWorldPosition(tmp).project(camera);
          const x = (tmp.x * 0.5 + 0.5) * mount.clientWidth;
          const y = (-tmp.y * 0.5 + 0.5) * mount.clientHeight;
          m.el.style.transform = `translate(${x + 22}px, ${y - 10}px)`;
          m.el.style.opacity = String(Math.min(1, Math.max(0, state.t * 1.8 - 0.35)));
        }
      };
      render();
      renderRef.current = render;
      // load-in: the canvas rises and fades in once the first real frame exists
      mount.classList.add("is-ready");

      // grab to spin: pointer drag adds yaw on top of the scroll pose
      let lastX = 0;
      const down = (e: PointerEvent) => {
        state.dragging = true;
        state.interacted = true;
        lastX = e.clientX;
        mount.classList.add("is-grabbing");
        mount.setPointerCapture?.(e.pointerId);
      };
      const move = (e: PointerEvent) => {
        if (!state.dragging) return;
        state.yaw += (e.clientX - lastX) * 0.006;
        lastX = e.clientX;
      };
      const up = () => {
        state.dragging = false;
        mount.classList.remove("is-grabbing");
      };
      mount.addEventListener("pointerdown", down);
      mount.addEventListener("pointermove", move);
      mount.addEventListener("pointerup", up);
      mount.addEventListener("pointercancel", up);

      const onResize = () => {
        camera.aspect = mount.clientWidth / mount.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(mount.clientWidth, mount.clientHeight);
        render();
      };
      window.addEventListener("resize", onResize);

      cleanup = () => {
        renderRef.current = null;
        mount.removeEventListener("pointerdown", down);
        mount.removeEventListener("pointermove", move);
        mount.removeEventListener("pointerup", up);
        mount.removeEventListener("pointercancel", up);
        window.removeEventListener("resize", onResize);
        renderer.dispose();
        mount.innerHTML = "";
      };
    })().catch(() => setWebglOk(false));

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  if (webglOk === false) {
    return (
      <img
        src={`${import.meta.env.BASE_URL ?? "/"}landing/drone-poster.png`}
        alt="The HADES drone, a 3D printed airframe with four brushless motors"
        className="hero3d-poster"
        draggable={false}
      />
    );
  }
  return <div ref={mountRef} className="hero3d-mount" aria-hidden />;
}
