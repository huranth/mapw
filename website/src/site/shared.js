// Shared UI
import { createClient } from "@supabase/supabase-js";

function supabaseOrigin() {
  try { const v = import.meta.env?.VITE_SUPABASE_URL?.trim(); if (v) return v.replace(/\/+$/, ""); } catch {}
  if (typeof process !== "undefined" && process.env?.SUPABASE_URL) return String(process.env.SUPABASE_URL).replace(/\/+$/, "");
  return "https://pdynfowdtiulrllqetbl.supabase.co";
}
const SUPABASE_URL = supabaseOrigin();
export const RELEASES_INDEX_URL = `${SUPABASE_URL}/storage/v1/object/public/releases/latest.json`;
export const LIVE_STATS_URL = `${SUPABASE_URL}/functions/v1/live-stats`;

// anon public — RLS gates (hardcoded fallback so local vercel --prod without env still works)
const SUPABASE_ANON_KEY = (() => {
  try { const k = import.meta.env?.VITE_SUPABASE_ANON_KEY?.trim(); if (k) return k; } catch {}
  return "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBkeW5mb3dkdGl1bHJsbHFldGJsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5ODEzNzAsImV4cCI6MjEwMzU1NzM3MH0.ZtPaxuiFHhGoZhgpD5wfr0kabHKC0G0lIS16BX27yLA";
})();
const supabase = SUPABASE_URL && SUPABASE_ANON_KEY ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { realtime: { params: { eventsPerSecond: 5 } } }) : null;

export function topbarHTML(active) {
  return `
    <header class="nav-term">
      <pre class="nav-term__line"><span class="prompt">&gt;</span> mapw <a href="/catalog">--catalog</a> <a href="/how-it-works">--how</a> <a href="/handbook">--notes</a> <a href="/download">--get</a><span class="caret" aria-hidden="true">▮</span></pre>
    </header>`;
}

export function footerHTML() {
  return `
    <footer class="foot-line">
      <p>© 2026 mapw · MIT · Terminals, like paper — <a href="/handbook">Field notes</a> · <a href="${RELEASES_INDEX_URL}" target="_blank" rel="noreferrer">Releases</a></p>
    </footer>`;
}

// Reveal
export function setupReveal() {
  const items = document.querySelectorAll("[data-reveal]");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (reduce || !("IntersectionObserver" in window)) {
    items.forEach(function (el) { el.classList.add("is-in"); });
    return;
  }

  const io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      const el = entry.target;
      if (entry.isIntersecting) {
        const step = parseInt(el.getAttribute("data-reveal-delay") || "0", 10);
        el.style.transitionDelay = (step * 60) + "ms";
        el.classList.add("is-in");
      } else {
        el.style.transitionDelay = "0ms";
        el.classList.remove("is-in");
      }
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });

  items.forEach(function (el) { io.observe(el); });
  // Fallback — if observer never fires (e.g. hero already in view but not intersecting), force visible
  setTimeout(function () {
    items.forEach(function (el) {
      if (!el.classList.contains("is-in")) {
        const step = parseInt(el.getAttribute("data-reveal-delay") || "0", 10);
        el.style.transitionDelay = (step * 60) + "ms";
        el.classList.add("is-in");
      }
    });
  }, 400);
}

// CTA glow
export function setupCtaGlow(root) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const cta = root.querySelector(".nav .cta");
  if (!cta || !window.matchMedia("(pointer: fine)").matches) return;
  window.addEventListener("mousemove", function (e) {
    const r = cta.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const near = Math.max(0, 1 - Math.hypot(dx, dy) / 300);
    cta.style.boxShadow = near > 0.02
      ? "0 " + (3 + near * 5).toFixed(1) + "px " + (12 + near * 12).toFixed(1) + "px -8px rgba(200,96,58," + (near * 0.55).toFixed(3) + ")"
      : "none";
  }, { passive: true });
}

// Copy
export function wireCopy(root) {
  root.addEventListener("click", function (e) {
    const c = e.target.closest("[data-copy]");
    if (c) { write(c.getAttribute("data-copy")); flash(c); return; }
    const cc = e.target.closest("[data-copy-code]");
    if (cc) {
      const pre = root.querySelector(cc.getAttribute("data-copy-code") || "#code");
      if (pre) write(pre.textContent);
      flash(cc);
    }
  });
  function write(t) { if (navigator.clipboard) navigator.clipboard.writeText(t).catch(() => {}); }
  function flash(btn) {
    const label = btn.dataset._label || btn.textContent;
    btn.dataset._label = label;
    btn.textContent = "Copied ✓";
    btn.classList.add("copied");
    clearTimeout(btn._ft);
    btn._ft = setTimeout(function () { btn.textContent = label; btn.classList.remove("copied"); }, 1300);
  }
}

// Data
function isTrustedReleaseUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase(), p = u.pathname;
    return (h === "pdynfowdtiulrllqetbl.supabase.co" && p.includes("/storage/v1/object/public/releases/")) ||
           (h === "mapw.vercel.app" && p.startsWith("/download")) ||
           (h === "github.com" && (p.startsWith("/huranth/mapw/releases/") || p.startsWith("/huranth/mapw-releases/releases/")));
  } catch { return false; }
}

async function fetchWithRetry(url, opts, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, opts);
      if (r.ok) return r;
      if (r.status < 500 || i === retries) return null;
    } catch { if (i === retries) return null; }
    await new Promise((x) => setTimeout(x, 300 * (2 ** i) + Math.random() * 200));
  }
  return null;
}

export async function fetchLatestRelease() {
  if (!RELEASES_INDEX_URL) return null;
  const busted = `${RELEASES_INDEX_URL}${RELEASES_INDEX_URL.includes("?") ? "&" : "?"}t=${Date.now()}`;
  const res = await fetchWithRetry(busted, { signal: AbortSignal.timeout(8000), cache: "no-store" });
  if (!res) return null;
  try {
    const data = await res.json();
    if (typeof data.version !== "string" || typeof data.url !== "string") return null;
    if (!isTrustedReleaseUrl(data.url)) return null;
    return data;
  } catch {
    return null;
  }
}

export async function fetchLiveStats() {
  if (!LIVE_STATS_URL) return null;
  const busted = `${LIVE_STATS_URL}${LIVE_STATS_URL.includes("?") ? "&" : "?"}t=${Date.now()}`;
  const res = await fetchWithRetry(busted, { signal: AbortSignal.timeout(8000), cache: "no-store" });
  if (!res) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// Download CTA
export async function wireDownloadControls() {
  const release = await fetchLatestRelease();
  document.querySelectorAll("[data-download]").forEach(function (el) {
    if (release && isTrustedReleaseUrl(release.url)) {
      el.setAttribute("href", "/download");
      el.removeAttribute("download");
      el.removeAttribute("data-disabled");
      const label = el.querySelector("[data-download-label]");
      if (label) label.textContent = "Download for Windows";
    } else if (el.matches("a")) {
      el.removeAttribute("href");
      el.setAttribute("aria-disabled", "true");
      el.style.opacity = "0.55";
      el.style.pointerEvents = "none";
      const label = el.querySelector("[data-download-label]");
      if (label) label.textContent = "Download — first release coming soon";
    }
  });
  document.querySelectorAll("[data-download-gz]").forEach(function (el) {
    if (release && release.gzUrl && isTrustedReleaseUrl(release.gzUrl)) {
      el.setAttribute("href", "/download");
      el.style.display = "";
    } else {
      el.style.display = "none";
    }
  });
  document.querySelectorAll("[data-release-version]").forEach(function (el) {
    el.textContent = release ? "v" + release.version : "no release published yet";
  });
}

// Live counters — always dynamic, no refresh needed
export async function wireLiveCounters() {
  async function render() {
    const stats = await fetchLiveStats();
    if (!stats) return;
    document.querySelectorAll("[data-live]").forEach(function (el) {
      el.hidden = false;
      const online = el.querySelector("[data-live-online]");
      const installs = el.querySelector("[data-live-installs]");
      if (online) online.textContent = stats.onlineNow;
      if (installs) installs.textContent = stats.installs;
    });
  }
  // show immediately as 0, then replace with real counts — no blank flash
  document.querySelectorAll("[data-live]").forEach(function (el) {
    el.hidden = false;
    const online = el.querySelector("[data-live-online]");
    const installs = el.querySelector("[data-live-installs]");
    if (online && !online.textContent) online.textContent = "0";
    if (installs && !installs.textContent) installs.textContent = "0";
  });
  void render();
  const poll = setInterval(() => { void render(); }, 2_000);
  document.addEventListener("visibilitychange", () => { void render(); });
  if (supabase) {
    try {
      const ch = supabase.channel("fleet:live", { config: { broadcast: { ack: false } } });
      ch.on("broadcast", { event: "fleet_update" }, () => { void render(); });
      await ch.subscribe();
      window.addEventListener("beforeunload", () => { try { supabase.removeChannel(ch); } catch {} clearInterval(poll); });
    } catch {}
  }
}
