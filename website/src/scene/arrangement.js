// The Arrangement — mapw's hero scene. Four terminal panes float on a canvas,
// because that's literally the product: panes you arrange on a sheet.
// Plain WebGL (no WebGPU dependency), ink outlines on paper, a slow group
// drift, buttery cursor tilt (lerp — never drops), and per-pane hover lifts.
import * as THREE from "three";
import { gsap } from "gsap";

const PAPER = 0xf7f4ec;
const SURFACE = 0xfffdf7;
const INK = 0x181712;
const TEAL = 0x134e4a;
const TEAL_BRIGHT = 0x5ba8a3;

function buildPane(width, height, depth) {
  // A pane: paper-white slab, ink edges, a header line, a few command bars
  // and one teal chip — the anatomy of a mapw terminal pane, in miniature.
  const group = new THREE.Group();

  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshBasicMaterial({ color: SURFACE }),
  );
  slab.name = "slab";
  group.add(slab);

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(slab.geometry),
    new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.85 }),
  );
  edges.name = "edges";
  group.add(edges);

  // Header strip: three dots + a teal chip square, like the pane chrome.
  const chrome = new THREE.Group();
  chrome.position.set(-width / 2 + 0.09, height / 2 - 0.14, depth / 2 + 0.001);
  const dotGeo = new THREE.CircleGeometry(0.022, 16);
  const dotMat = new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.28 });
  for (let i = 0; i < 3; i++) {
    const dot = new THREE.Mesh(dotGeo, dotMat);
    dot.position.x = i * 0.075;
    chrome.add(dot);
  }
  const chip = new THREE.Mesh(
    new THREE.PlaneGeometry(0.16, 0.09),
    new THREE.MeshBasicMaterial({ color: TEAL }),
  );
  chip.position.set(width - 0.32, 0, 0);
  chrome.add(chip);
  group.add(chrome);

  // Command bars — a prompt tick (teal) plus indented ink bars at low opacity.
  const bars = new THREE.Group();
  bars.position.set(-width / 2 + 0.12, -0.08, depth / 2 + 0.001);
  const rows = [0, 1, 2, 3];
  const barMat = new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.16 });
  const promptMat = new THREE.MeshBasicMaterial({ color: TEAL, transparent: true, opacity: 0.85 });
  rows.forEach((r) => {
    const isPrompt = r % 2 === 0;
    const bar = new THREE.Mesh(
      new THREE.PlaneGeometry(isPrompt ? 0.1 : 0.55 + Math.random() * 0.45, 0.045),
      isPrompt ? promptMat : barMat,
    );
    bar.position.set(isPrompt ? 0 : 0.16, -r * 0.13, 0);
    bars.add(bar);
  });
  group.add(bars);

  return group;
}

export function mountArrangement(hostEl) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(PAPER, 0);
  hostEl.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
  camera.position.set(0, 0, 6.2);

  const arrangement = new THREE.Group();
  arrangement.rotation.x = -0.32;
  arrangement.rotation.y = 0.38;
  scene.add(arrangement);

  // The default 2×2 sheet.
  const PW = 1.55;
  const PH = 0.95;
  const GAP = 0.22;
  const panes = [];
  const slots = [
    { x: -(PW + GAP) / 2, y: (PH + GAP) / 2, z: 0 },
    { x: (PW + GAP) / 2, y: (PH + GAP) / 2, z: 0 },
    { x: -(PW + GAP) / 2, y: -(PH + GAP) / 2, z: 0 },
    { x: (PW + GAP) / 2, y: -(PH + GAP) / 2, z: 0 },
  ];
  slots.forEach((slot, i) => {
    const pane = buildPane(PW, PH, 0.055);
    pane.position.set(slot.x, slot.y, slot.z);
    pane.userData = {
      base: new THREE.Vector3(slot.x, slot.y, slot.z),
      phase: i * 1.7,
      floatSpeed: 0.7 + i * 0.11,
    };
    panes.push(pane);
    arrangement.add(pane);
  });

  // ---- cursor: lerp tilt, never drops ------------------------------------
  const target = { x: 0, y: 0 };
  const cur = { x: 0, y: 0 };
  function onPointerMove(e) {
    const nx = (e.clientX / window.innerWidth) * 2 - 1;
    const ny = (e.clientY / window.innerHeight) * 2 - 1;
    target.x = ny * -0.22;
    target.y = nx * 0.34;
  }
  function onPointerLeave() {
    target.x = 0;
    target.y = 0;
  }
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  document.addEventListener("pointerleave", onPointerLeave);

  // ---- hover: raycast, lift + teal edges ---------------------------------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hostRect = () => hostEl.getBoundingClientRect();
  let hovered = null;

  function pick(e) {
    const rect = hostRect();
    ndc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(
      panes.map((p) => p.getObjectByName("slab")),
      false,
    );
    const slab = hits.length > 0 ? hits[0].object.parent : null;
    if (slab === hovered) return;
    if (hovered) {
      const prev = hovered;
      gsap.to(prev.position, { z: prev.userData.base.z, duration: 0.5, ease: "power2.out" });
      gsap.to(prev.getObjectByName("edges").material, { color: INK, duration: 0.4 });
      gsap.to(prev.scale, { x: 1, y: 1, duration: 0.5, ease: "power2.out" });
    }
    hovered = slab;
    if (hovered) {
      gsap.to(hovered.position, { z: hovered.userData.base.z + 0.28, duration: 0.5, ease: "power2.out" });
      gsap.to(hovered.getObjectByName("edges").material, { color: TEAL, duration: 0.3 });
      gsap.to(hovered.scale, { x: 1.04, y: 1.04, duration: 0.5, ease: "power2.out" });
    }
  }
  function onHoverMove(e) {
    const rect = hostRect();
    const inside =
      e.clientX >= rect.left && e.clientX <= rect.right &&
      e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (inside) pick(e);
    else if (hovered) {
      const prev = hovered;
      gsap.to(prev.position, { z: prev.userData.base.z, duration: 0.5, ease: "power2.out" });
      gsap.to(prev.getObjectByName("edges").material, { color: INK, duration: 0.4 });
      gsap.to(prev.scale, { x: 1, y: 1, duration: 0.5, ease: "power2.out" });
      hovered = null;
    }
  }
  hostEl.addEventListener("pointermove", onHoverMove, { passive: true });
  hostEl.addEventListener("pointerleave", () => {
    if (!hovered) return;
    const prev = hovered;
    gsap.to(prev.position, { z: prev.userData.base.z, duration: 0.5, ease: "power2.out" });
    gsap.to(prev.getObjectByName("edges").material, { color: INK, duration: 0.4 });
    gsap.to(prev.scale, { x: 1, y: 1, duration: 0.5, ease: "power2.out" });
    hovered = null;
  });

  // ---- size ---------------------------------------------------------------
  function resize() {
    const w = hostEl.clientWidth || 1;
    const h = hostEl.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();

  // ---- loop ----------------------------------------------------------------
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let raf = 0;
  function tick(now) {
    const t = now * 0.001;
    cur.x += (target.x - cur.x) * 0.055;
    cur.y += (target.y - cur.y) * 0.055;
    arrangement.rotation.x = -0.32 + cur.x;
    arrangement.rotation.y = 0.38 + cur.y + (reduce ? 0 : Math.sin(t * 0.18) * 0.04);
    panes.forEach((pane) => {
      const u = pane.userData;
      if (!reduce) {
        pane.position.y = u.base.y + Math.sin(t * u.floatSpeed + u.phase) * 0.045;
      }
    });
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);

  return function dispose() {
    cancelAnimationFrame(raf);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("resize", resize);
    renderer.dispose();
    hostEl.innerHTML = "";
  };
}
