// Shared page furniture + behaviours, carried over from the LingLing site and
// rebranded for mapw. Same motion, same copy flashes, same CTA glow.
// Real-data endpoints live here so both pages read identical values.

function supabaseOrigin() {
  try {
    const env = typeof import.meta !== "undefined" ? import.meta.env : null;
    const fromEnv = env?.VITE_SUPABASE_URL;
    if (typeof fromEnv === "string" && fromEnv.trim()) return fromEnv.trim().replace(/\/+$/, "");
  } catch {}
  if (typeof process !== "undefined" && process.env?.SUPABASE_URL) return String(process.env.SUPABASE_URL).replace(/\/+$/, "");
  return "";
}
const SUPABASE_URL = supabaseOrigin();
export const RELEASES_INDEX_URL = SUPABASE_URL ? `${SUPABASE_URL}/storage/v1/object/public/releases/latest.json` : "";
export const LIVE_STATS_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/live-stats` : "";

export function topbarHTML(active) {
  const link = function (href, label, id) {
    return `<a href="${href}"${active === id ? ' class="here"' : ""}>${label}</a>`;
  };
  return `
    <header class="topbar">
      <div class="brand"><a href="index.html"><img src="/logo.svg" alt="" width="28" height="28" style="vertical-align:middle;margin-right:8px"/><b>mapw</b></a></div>
      <nav class="nav">
        ${link("index.html#chips", "Chips", "chips")}
        ${link("index.html#under-the-hood", "Under the hood", "hood")}
        ${link("handbook.html", "Field notes", "handbook")}
        <a class="cta" href="#download">Download</a>
      </nav>
    </header>`;
}

export function footerHTML() {
  return `
    <footer class="foot">
      <div class="fl">© 2026 mapw</div>
      <div class="fr">
        <a href="handbook.html">Field notes</a><a href="${RELEASES_INDEX_URL}" target="_blank" rel="noreferrer">Releases</a>
      </div>
    </footer>`;
}

// Reveal blocks as they scroll into view; reset on exit so it replays.
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
}

// The primary CTA warms as the pointer nears it. The one place the accent glows.
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

// Copy-to-clipboard for [data-copy] and [data-copy-code] within a root.
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
  function write(t) { if (navigator.clipboard) navigator.clipboard.writeText(t); }
  function flash(btn) {
    const label = btn.dataset._label || btn.textContent;
    btn.dataset._label = label;
    btn.textContent = "Copied ✓";
    btn.classList.add("copied");
    clearTimeout(btn._ft);
    btn._ft = setTimeout(function () { btn.textContent = label; btn.classList.remove("copied"); }, 1300);
  }
}

// ---- real data ------------------------------------------------------------

function isTrustedReleaseUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname.endsWith(".supabase.co") && u.pathname.includes("/storage/v1/object/public/releases/");
  } catch { return false; }
}

async function fetchWithRetry(url, opts, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, opts);
      if (!res.ok) {
        if (res.status >= 500 && i < retries) {
          await new Promise((r) => setTimeout(r, 300 * Math.pow(2, i)));
          continue;
        }
        return null;
      }
      return res;
    } catch (err) {
      if (i === retries) return null;
      await new Promise((r) => setTimeout(r, 300 * Math.pow(2, i) + Math.random() * 200));
    }
  }
  return null;
}

export async function fetchLatestRelease() {
  if (!RELEASES_INDEX_URL) return null;
  const res = await fetchWithRetry(RELEASES_INDEX_URL, { signal: AbortSignal.timeout(8000) });
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
  const res = await fetchWithRetry(LIVE_STATS_URL, { signal: AbortSignal.timeout(8000) });
  if (!res) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// Wire the download CTA to the real release feed. Until a release exists the
// button says so honestly; once one exists it links straight to the exe.
export async function wireDownloadControls() {
  const release = await fetchLatestRelease();
  document.querySelectorAll("[data-download]").forEach(function (el) {
    if (release && isTrustedReleaseUrl(release.url)) {
      el.setAttribute("href", release.url);
      el.setAttribute("download", "");
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
      el.setAttribute("href", release.gzUrl);
      el.style.display = "";
    } else {
      el.style.display = "none";
    }
  });
  document.querySelectorAll("[data-release-version]").forEach(function (el) {
    el.textContent = release ? "v" + release.version : "no release published yet";
  });
}

// Live install/online counts from our edge function. Renders nothing until the
// server answers — the site never shows fake numbers.
export async function wireLiveCounters() {
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
