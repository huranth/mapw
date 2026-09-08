// The Arrangement
import * as THREE from "three";
import { gsap } from "gsap";

// Brutalist tokens
const PAPER = 0xf0f2f5;
const SURFACE = 0xffffff;
const INK = 0x0a0a0a;
const TEAL = 0x0a0a0a;
const LIVE = 0xff2e00;

function buildPane(width, height, depth) {
  // Pane build
  // and one
  const group = new THREE.Group();

  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshBasicMaterial({ color: SURFACE }),
  );
  slab.name = "slab";
  group.add(slab);

  // Pane shadow
  // Shadow compact
  const shadow = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth * 0.92),
    new THREE.MeshBasicMaterial({ color: INK }),
  );
  shadow.position.set(0.04, -0.04, -0.028);
  shadow.name = "shadow";
  group.add(shadow);

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(slab.geometry),
    new THREE.LineBasicMaterial({ color: INK, transparent: false, opacity: 1 }),
  );
  edges.name = "edges";
  group.add(edges);

  // Pane chrome
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

  // Command bars
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
  if (hostEl.dataset.mounted === "1") return function () {};
  hostEl.dataset.mounted = "1";
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(PAPER, 0);
  hostEl.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
  camera.position.set(0, 0, 6.65);

  const arrangement = new THREE.Group();
  arrangement.rotation.x = -0.32;
  arrangement.rotation.y = 0.38;
// Small nudge
  arrangement.position.x = 0.18;
  scene.add(arrangement);

  // The default
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

  // Cursor lerp
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

  // Hover raycast
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hostRect = () => hostEl.getBoundingClientRect();
  let hovered = null;

  function resetHovered(pane) {
    gsap.to(pane.position, { z: pane.userData.base.z, duration: 0.5, ease: "power2.out" });
    gsap.to(pane.getObjectByName("edges").material, { color: INK, duration: 0.4 });
    gsap.to(pane.scale, { x: 1, y: 1, duration: 0.5, ease: "power2.out" });
  }

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
    if (hovered) resetHovered(hovered);
    hovered = slab;
    if (hovered) {
      gsap.to(hovered.position, { z: hovered.userData.base.z + 0.28, duration: 0.5, ease: "power2.out" });
      gsap.to(hovered.getObjectByName("edges").material, { color: LIVE, duration: 0.3 });
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
      resetHovered(hovered);
      hovered = null;
    }
  }
  function onHostLeave() {
    if (!hovered) return;
    resetHovered(hovered);
    hovered = null;
  }
  hostEl.addEventListener("pointermove", onHoverMove, { passive: true });
  hostEl.addEventListener("pointerleave", onHostLeave);

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

  // loop immediate
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
  resize();
  renderer.render(scene, camera);
  raf = requestAnimationFrame(tick);

  return function dispose() {
    cancelAnimationFrame(raf);
    window.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerleave", onPointerLeave);
    window.removeEventListener("resize", resize);
    hostEl.removeEventListener("pointermove", onHoverMove);
    hostEl.removeEventListener("pointerleave", onHostLeave);
    renderer.dispose();
    hostEl.dataset.mounted = "";
    hostEl.innerHTML = "";
  };
}