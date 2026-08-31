// Landing page DOM — mapw's own voice. Fraunces display headlines, mono
// eyebrows, the hero anchored by The Arrangement (four floating panes), the
// chip console, and the canvas footer band. Every number on the page is
// served, never invented.

import { initPaneGrid } from "./paneGrid.js";
import { initConsole } from "./chipsConsole.js";
import {
  topbarHTML, footerHTML, setupReveal, setupCtaGlow, wireCopy,
  wireDownloadControls, wireLiveCounters,
} from "./shared.js";

// The curated CLIs mapw ships chips for (mirrors Backend CURATED_CLIS).
const CHIPS = [
  { name: "opencode", id: "opencode", lab: "terminal agent", meta: "auto-launched on chip click" },
  { name: "claude",   id: "claude",   lab: "terminal agent", meta: "auto-launched on chip click" },
  { name: "aider",    id: "aider",    lab: "pair editor",    meta: "auto-launched on chip click" },
  { name: "codex",    id: "codex",    lab: "terminal agent", meta: "auto-launched on chip click" },
  { name: "gemini",   id: "gemini",   lab: "terminal agent", meta: "auto-launched on chip click" },
  { name: "amp",      id: "amp",      lab: "terminal agent", meta: "auto-launched on chip click" },
];

export function initSite() {
  const app = document.getElementById("app");
  app.innerHTML = `
    <div class="page">
      ${topbarHTML("")}

      <section class="hero">
        <div id="arrangement" class="arrangement-bg"></div>
        <div class="hero-inner">
          <div class="eyebrow" data-reveal>Multi-pane terminal workspace</div>
          <h1 data-reveal data-reveal-delay="1">Arrange your terminals <em>like paper</em>.</h1>
          <p data-reveal data-reveal-delay="2">Four panes on a calm sheet. Drag to move. Resize to fit. Pin a CLI to each.</p>
          <div class="actions" data-reveal data-reveal-delay="3">
            <a class="btn solid" href="#download" data-download><span data-download-label>Download for Windows</span></a>
            <a class="btn" href="#download" data-download-gz style="display:none">.gz</a>
            <a class="btn" href="#under-the-hood">How it works</a>
          </div>
          <div class="hero-endpoint" data-reveal data-reveal-delay="4">
            <span class="k">latest</span>
            <code data-release-version>checking…</code>
            <span data-live hidden><span class="live-dot" aria-hidden="true"></span><span data-live-online>0</span> online · <span data-live-installs>0</span> installs</span>
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
          <a class="btn ghost mt" href="handbook.html" data-reveal data-reveal-delay="7">Field notes</a>
        </div>
        <div class="right" data-reveal data-reveal-delay="2">
          <div class="code-label"><span>settings.json</span><button class="copy-btn" data-copy-code="#code">Copy</button></div>
          <pre class="code" id="code"><span class="c">// what mapw persists, %APPDATA%/@bridgespace/frontend</span>
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
}
