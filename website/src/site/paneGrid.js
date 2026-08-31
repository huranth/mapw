// Footer band — "the canvas". mapw's own signature: an outlined Fraunces
// wordmark over a grid of pane cells drawn on canvas. Cells near the cursor
// illuminate like panes being placed on the canvas; the wordmark fill follows
// the same spotlight. Pure DOM + one small canvas, reduced-motion aware.

export function initPaneGrid(band, opts = {}) {
  const word = opts.word || "mapw";

  band.innerHTML = `
    <canvas class="mark-grid" aria-hidden="true"></canvas>
    <div class="mark-word" data-word="${word}">
      <span class="mark-ghost">${word}</span>
      <span class="mark-fill" style="clip-path: circle(0px at 50% 50%)">${word}</span>
    </div>
  `;

  const fill = band.querySelector(".mark-fill");
  const canvas = band.querySelector(".mark-grid");
  const ctx = canvas.getContext("2d");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- spotlight fill (wordmark) ----
  let raf = 0;
  const target = { x: 0.5, y: 0.5, r: 0 };
  const cur = { x: 0.5, y: 0.5, r: 0 };

  function onMove(e) {
    const rect = band.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    const inside =
      src.clientX >= rect.left && src.clientX <= rect.right &&
      src.clientY >= rect.top && src.clientY <= rect.bottom;
    target.x = (src.clientX - rect.left) / rect.width;
    target.y = (src.clientY - rect.top) / rect.height;
    target.r = inside ? 170 : 0;
    kick();
  }
  function onLeave() { target.r = 0; kick(); }
  function kick() { if (!raf) raf = requestAnimationFrame(tickFill); }
  function tickFill() {
    cur.x += (target.x - cur.x) * 0.18;
    cur.y += (target.y - cur.y) * 0.18;
    cur.r += (target.r - cur.r) * 0.12;
    fill.style.clipPath = `circle(${cur.r}px at ${(cur.x * 100).toFixed(2)}% ${(cur.y * 100).toFixed(2)}%)`;
    if (Math.abs(target.r - cur.r) > 0.4 || target.r > 0.5) raf = requestAnimationFrame(tickFill);
    else raf = 0;
  }

  window.addEventListener("mousemove", onMove);
  window.addEventListener("touchmove", onMove, { passive: true });
  band.addEventListener("mouseleave", onLeave);

  // ---- the pane grid ----
  // Cells light up beneath the cursor with a soft falloff and a slow decay —
  // like panes you've placed and that are still warm. When the pointer rests,
  // the lit cluster breathes — a low, desynchronised shimmer, not a blink.
  let w = 0, h = 0;
  let cols = 0, rows = 0;
  const CELL = 34;
  const GAP = 7;
  const heat = new Map(); // "c,r" → 0..1
  // idle breathing state — premium, not a strobe
  let lastMoveAt = performance.now();
  let idleMix = 0; // 0 → moving, 1 → at rest (lerped)

  function resize() {
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    w = band.clientWidth;
    h = band.clientHeight;
    if (!w || !h) return;
    canvas.width = w * scale;
    canvas.height = h * scale;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    cols = Math.ceil(w / (CELL + GAP));
    rows = Math.ceil(h / (CELL + GAP));
  }

  function drawGrid(px, py, pr, now) {
    now = now || performance.now();
    ctx.clearRect(0, 0, w, h);
    // decay existing heat
    for (const [key, v] of heat) {
      const nv = v - 0.02;
      if (nv <= 0) heat.delete(key);
      else heat.set(key, nv);
    }
    if (pr > 0) {
      const c0 = Math.max(0, Math.floor((px - pr) / (CELL + GAP)));
      const c1 = Math.min(cols - 1, Math.ceil((px + pr) / (CELL + GAP)));
      const r0 = Math.max(0, Math.floor((py - pr) / (CELL + GAP)));
      const r1 = Math.min(rows - 1, Math.ceil((py + pr) / (CELL + GAP)));
      for (let c = c0; c <= c1; c++) {
        for (let r = r0; r <= r1; r++) {
          const cx = c * (CELL + GAP) + CELL / 2;
          const cy = r * (CELL + GAP) + CELL / 2;
          const d = Math.hypot(cx - px, cy - py);
          if (d < pr) {
            const add = (1 - d / pr) * 0.5;
            const key = c + "," + r;
            heat.set(key, Math.min(1, (heat.get(key) || 0) + add));
          }
        }
      }
    }

    // idle detection — pointer at rest inside the band → premium shimmer
    // reduced-motion disables it entirely; otherwise we want it OBVIOUS
    // but still refined — not a cheap global blink.
    if (!reduce) {
      const resting = pr > 0 && (now - lastMoveAt) > 260;
      const target = resting ? 1 : 0;
      idleMix += (target - idleMix) * (target ? 0.058 : 0.16);
      if (idleMix < 0.015) idleMix = 0;
      if (idleMix > 0.99) idleMix = 1;
    } else {
      idleMix = 0;
    }

    const radius = 4;
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const x = c * (CELL + GAP);
        const y = r * (CELL + GAP);
        let v = heat.get(c + "," + r) || 0;
        if (v <= 0) {
          ctx.strokeStyle = "rgba(247, 244, 236, 0.07)";
          ctx.lineWidth = 1;
          roundRect(ctx, x, y, CELL, CELL, radius);
          ctx.stroke();
        } else {
          // PREMIUM IDLE SHIMMER — visible, desynchronised, organic wave
          // Each lit cell breathes on its own phase + a distance wave from
          // the cursor so the cluster ripples outward, not blinks in unison.
          let drawX = x, drawY = y, drawCell = CELL, drawRadius = radius;
          let displayV = v;
          if (idleMix > 0.015 && v > 0.12) {
            const cx = c * (CELL + GAP) + CELL / 2;
            const cy = r * (CELL + GAP) + CELL / 2;
            const dist = Math.hypot(cx - px, cy - py);
            // stable per-cell offset so neighbours are never in phase
            const cellPhase = (c * 0.71 + r * 0.83) * 2.1 + (c * r * 0.0047);
            // outward travelling wave — premium ripple, not a strobe
            const wave = Math.sin(now * 0.00185 - dist * 0.022 + cellPhase);
            const wave2 = Math.sin(now * 0.00095 + cellPhase * 0.6 + 1.7);
            // ±0.22 is deliberately VISIBLE — you will see it. idleMix gates it
            // so it only appears when you rest, and the per-cell phase keeps it
            // from looking like a cheap global blink.
            const breathe = (wave * 0.68 + wave2 * 0.32) * 0.22;
            const centreBias = 0.78 + v * 0.45; // hots breathe harder, edges stay calmer
            displayV = Math.max(0, Math.min(1, v * (1 + breathe * centreBias * idleMix) + breathe * 0.035 * idleMix));
            // subtle scale pulse — 1px inset at trough, flush at peak
            // keeps the grid feeling like a living material, not a screen
            const scale = 1 + breathe * 0.045 * idleMix;
            const inset = (CELL - CELL * scale) / 2;
            drawX = x + inset;
            drawY = y + inset;
            drawCell = CELL * scale;
            drawRadius = Math.max(2, radius * scale);
          }
          const a = 0.1 + displayV * 0.55;
          ctx.fillStyle = `rgba(94, 178, 170, ${a.toFixed(3)})`;
          roundRect(ctx, drawX, drawY, drawCell, drawCell, drawRadius);
          ctx.fill();
          // border follows the same wave — so the whole tile breathes
          const ba = 0.3 + displayV * 0.5;
          ctx.strokeStyle = `rgba(126, 194, 189, ${ba.toFixed(3)})`;
          ctx.lineWidth = 1;
          roundRect(ctx, drawX, drawY, drawCell, drawCell, drawRadius);
          ctx.stroke();
        }
      }
    }
  }

  function roundRect(c, x, y, w2, h2, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w2, y, x + w2, y + h2, r);
    c.arcTo(x + w2, y + h2, x, y + h2, r);
    c.arcTo(x, y + h2, x, y, r);
    c.arcTo(x, y, x + w2, y, r);
    c.closePath();
  }

  let mouse = { x: -9999, y: -9999, r: 0 };
  function loop(now) {
    // ease the spotlight center so the heat trail feels physical
    drawGrid(mouse.x, mouse.y, mouse.r, now);
    requestAnimationFrame(loop);
  }

  function onGridMove(e) {
    const rect = band.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    const inside =
      src.clientX >= rect.left && src.clientX <= rect.right &&
      src.clientY >= rect.top && src.clientY <= rect.bottom;
    const nx = src.clientX - rect.left;
    const ny = src.clientY - rect.top;
    // only treat real movement as a reset — micro-jitter shouldn't thrash idle
    if (Math.abs(nx - mouse.x) > 1.5 || Math.abs(ny - mouse.y) > 1.5 || (inside ? 150 : 0) !== mouse.r) {
      lastMoveAt = performance.now();
    }
    mouse.x = nx;
    mouse.y = ny;
    mouse.r = inside ? 150 : 0;
  }
  window.addEventListener("mousemove", onGridMove, { passive: true });
  window.addEventListener("touchmove", onGridMove, { passive: true });

  window.addEventListener("resize", () => {
    resize();
    if (reduce) drawGrid(-9999, -9999, 0);
  });
  resize();

  if (reduce) {
    drawGrid(-9999, -9999, 0); // static grid, no interaction heat
  } else {
    requestAnimationFrame(loop);
  }
}
