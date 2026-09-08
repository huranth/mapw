// Landing
import { initPaneGrid } from "./paneGrid.js";
import { initConsole } from "./chipsConsole.js";
import { topbarHTML, footerHTML, setupReveal, setupCtaGlow, wireCopy, wireDownloadControls, wireLiveCounters } from "./shared.js";

const CHIPS = ["opencode","claude","aider","codex","gemini","amp"].map((id) => ({ name: id, id, lab: id === "aider" ? "pair editor" : "terminal agent" }));

export function initSite() {
  const app = document.getElementById("app");
  app.innerHTML = `
    ${topbarHTML("")}
    <div class="page">
      <section class="hero">
        <div id="arrangement" class="arrangement-bg"></div>
        <div class="hero-inner">
          <div class="eyebrow" data-reveal>Multi-pane terminal workspace</div>
          <h1 data-reveal data-reveal-delay="1">Arrange your terminals <em>like paper</em>.</h1>
          <p data-reveal data-reveal-delay="2">Four panes on a calm sheet. Drag to move. Resize to fit. Pin a CLI to each.</p>
          <div class="actions" data-reveal data-reveal-delay="3">
            <a class="btn solid" href="/download" data-download><span data-download-label>Download for Windows</span></a>
            <a class="btn" href="/download" data-download-gz style="display:none">.gz</a>
            <a class="btn" href="/how-it-works">How it works</a>
          </div>
          <div class="hero-ledger" data-reveal data-reveal-delay="4">
            <div class="ledger-head">
              <span class="ledger-dots" aria-hidden="true"><i></i><i></i><i></i></span>
              <span class="ledger-title">fleet</span>
              <span class="ledger-edition">Edition <code data-release-version>checking…</code></span>
            </div>
            <div class="ledger-body" data-live hidden aria-live="polite">
              <div class="ledger-stat is-live">
                <div class="ledger-stat-head">live now</div>
                <b data-live-online>0</b>
              </div>
              <div class="ledger-rule" aria-hidden="true"></div>
              <div class="ledger-stat">
                <div class="ledger-stat-head">installs</div>
                <b data-live-installs>0</b>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="section" id="chips">
        <div class="section-head">
          <div>
            <div class="idx" data-reveal>Catalogue</div>
            <h2 data-reveal data-reveal-delay="1">Six agents, <em>one click</em> each</h2>
            <p data-reveal data-reveal-delay="2">Detects what is on your PATH. Pins it to the pane header.</p>
          </div>
        </div>
        <div class="netmap" data-reveal data-reveal-delay="3"></div>
      </section>

      <section class="section integrate" id="under-the-hood">
        <div class="left">
          <div class="idx" data-reveal>Under the hood</div>
          <h2 data-reveal data-reveal-delay="1">Terminal-native, <em>not a wrapper</em></h2>
          <p data-reveal data-reveal-delay="2">Real shell signal. Not screen scraping.</p>
          <div class="feature" data-reveal data-reveal-delay="3"><div class="ft"><b>Panes on a canvas</b><span>Positions and sizes persist.</span></div></div>
          <div class="feature" data-reveal data-reveal-delay="4"><div class="ft"><b>Shell-aware</b><span>OSC 133 for prompts and exit codes.</span></div></div>
          <div class="feature" data-reveal data-reveal-delay="5"><div class="ft"><b>Local</b><span>On disk. No account.</span></div></div>
          <div class="feature" data-reveal data-reveal-delay="6"><div class="ft"><b>Updates</b><span>Checks on launch.</span></div></div>
          <a class="btn ghost mt" href="/handbook" data-reveal data-reveal-delay="7">Field notes</a>
        </div>
        <div class="right" data-reveal data-reveal-delay="2">
          <div class="code-label"><span>settings.json</span><button class="copy-btn" data-copy-code="#code">Copy</button></div>
          <pre class="code" id="code"><span class="c">// what mapw persists, %APPDATA%/@mapw/frontend</span>
{
  <span class="k">"theme"</span>: <span class="s">"paper"</span>,
  <span class="k">"fontFamily"</span>: <span class="s">"JetBrains Mono"</span>,
  <span class="k">"lastCwd"</span>: <span class="s">"C:\\Users\\you\\project"</span>,
  <span class="k">"workspace"</span>: {
    <span class="k">"nodes"</span>: [
      { <span class="k">"paneId"</span>: <span class="s">"p1"</span>, <span class="k">"cwd"</span>: <span class="s">"…"</span>,
        <span class="k">"position"</span>: { <span class="k">"x"</span>: 0, <span class="k">"y"</span>: 0 },
        <span class="k">"cliId"</span>: <span class="s">"claude"</span> }
    ]
  },
  <span class="k">"savedLayouts"</span>: []
}</pre>
        </div>
      </section>

      <section class="lines-band" id="download"></section>

      ${footerHTML()}
    </div>
  `;

  wireCopy(app);
  setupReveal();
  setupCtaGlow(app);

  const band = document.querySelector(".lines-band");
  if (band) initPaneGrid(band, { word: "mapw" });

  const termHost = document.querySelector(".netmap");
  if (termHost) initConsole(termHost, CHIPS).start();

  void wireDownloadControls();
  void wireLiveCounters();
  // Clean URLs
  const ROUTE = { "/catalog":"chips","/chips":"chips","/how-it-works":"under-the-hood","/under-the-hood":"under-the-hood" };
  const go = (id) => document.getElementById(id)?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  const route = () => {
    const id = ROUTE[location.pathname.replace(/\/+$/, "") || "/"];
    if (id) requestAnimationFrame(() => setTimeout(() => go(id), 80));
    else if (location.hash) go(location.hash.slice(1));
  };
  app.addEventListener("click", (e) => {
    const a = e.target.closest('a[href="/catalog"],a[href="/chips"],a[href="/how-it-works"],a[href="/under-the-hood"]');
    if (!a) return;
    const id = ROUTE[new URL(a.href, location.origin).pathname];
    if (!id) return;
    e.preventDefault(); history.pushState(null, "", new URL(a.href).pathname); go(id);
  });
  addEventListener("popstate", route); route();
}
