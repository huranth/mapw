// Field Notes — factual journal.

import { SECTIONS, KEYS } from "./handbookData.js";
import { topbarHTML, footerHTML, setupReveal, setupCtaGlow, wireCopy } from "./shared.js";

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function cardVisual(id) {
  switch (id) {
    case "start":
      return `<div class="field-viz field-viz--term field-viz--interactive" role="group" aria-label="Terminal">
        <div class="field-viz__bar"><span class="field-viz__dot"></span><span class="field-viz__dot"></span><span class="field-viz__dot"></span></div>
        <div class="field-viz__code" tabindex="0" role="textbox" aria-label="Terminal" data-term><span class="field-viz__prompt">$</span> <span class="field-viz__typed" data-typed>npm run dev</span><span class="field-viz__caret" aria-hidden="true"></span></div>
        <div class="field-viz__out" data-term-out aria-live="polite"></div>
      </div>`;
    case "canvas":
      return `<div class="field-viz field-viz--grid field-viz--interactive-grid" data-canvas-grid aria-label="Drag the panes">
        <div class="field-viz__mini" data-mini>
          <span data-pane="0" tabindex="0" aria-label="Pane 1 draggable"></span>
          <span data-pane="1" tabindex="0" aria-label="Pane 2 draggable"></span>
          <span data-pane="2" tabindex="0" aria-label="Pane 3 draggable"></span>
          <span data-pane="3" tabindex="0" aria-label="Pane 4 draggable"></span>
        </div>
      </div>`;
    case "layouts":
      return `<div class="field-viz field-viz--layouts" aria-hidden="true"><div class="field-viz__stack"><span class="field-viz__card"></span><span class="field-viz__card"></span><span class="field-viz__card"></span></div></div>`;
    case "shells":
      return `<div class="field-viz field-viz--signal field-viz--wired" data-shell-grid aria-label="Drag the nodes">
        <svg class="field-viz__wires" data-wires aria-hidden="true"></svg>
        <div class="field-viz__node" data-node="0" tabindex="0" aria-label="133;A prompt"><span>133;A</span><small>prompt</small></div>
        <div class="field-viz__node" data-node="1" tabindex="0" aria-label="133;C output"><span>133;C</span><small>output</small></div>
        <div class="field-viz__node" data-node="2" tabindex="0" aria-label="133;D exit"><span>133;D</span><small>exit</small></div>
        <div class="field-viz__node" data-node="3" tabindex="0" aria-label="7 cwd"><span>7</span><small>cwd</small></div>
      </div>`;
    case "clis":
      return `<div class="field-viz field-viz--chips" aria-hidden="true"><span class="field-viz__chip">opencode</span><span class="field-viz__chip">claude</span><span class="field-viz__chip">codex</span><span class="field-viz__chip field-viz__chip--muted">+3</span></div>`;
    case "updates":
      return `<div class="field-viz field-viz--updates" aria-hidden="true">
        <div class="field-viz__release">
          <div class="field-viz__release-card is-next"><span>next</span><b>v1.2.3</b><small>staged in %TEMP%</small></div>
          <div class="field-viz__release-card is-current"><span>current</span><b>v1.2.0</b><small>running</small></div>
        </div>
      </div>`;
    case "data":
      return `<div class="field-viz field-viz--split" aria-hidden="true"><div class="field-viz__col"><b>LOCAL</b><span>settings</span><span>usage</span></div><div class="field-viz__sep"></div><div class="field-viz__col"><b>WIRE</b><span>installId</span><span>counts</span></div></div>`;
    case "reset":
      return `<div class="field-viz field-viz--path" aria-hidden="true"><code>%APPDATA%\\@mapw\\frontend\\settings.json</code></div>`;
    default:
      return `<div class="field-viz" aria-hidden="true"></div>`;
  }
}

export function renderHandbookPage() {
  const app = document.getElementById("app");
  app.innerHTML = `
    <div class="page">
      ${topbarHTML("handbook")}
      <section class="docs-hero field-hero">
        <div class="field-hero__grid" aria-hidden="true"></div>
        <div class="idx" data-reveal>Field notes</div>
        <h1 data-reveal data-reveal-delay="1">How <em>mapw</em> works</h1>
        <p data-reveal data-reveal-delay="2">Where your canvas lives, what your shells emit, and what leaves the machine.</p>
        <div class="docs-keys" data-reveal data-reveal-delay="3">
          ${KEYS.map((k) => `<div class="dk"><span class="dk-k">${esc(k.k)}</span><code>${esc(k.v)}</code></div>`).join("")}
        </div>
      </section>

      <section class="field-toolbar" aria-label="Filter">
        <div class="field-toolbar__inner">
          <label class="field-search">
            <span class="field-search__icon" aria-hidden="true">⌕</span>
            <input class="field-search__input" placeholder="Filter" spellcheck="false" autocomplete="off" />
          </label>
          <span class="field-toolbar__count" aria-live="polite">${SECTIONS.length} notes</span>
        </div>
        <div class="field-progress" aria-hidden="true"><span class="field-progress__bar"></span></div>
      </section>

      <section class="field-deck" aria-label="Field notes">
        ${SECTIONS.map((s, i) => {
          const n = String(i + 1).padStart(2, "0");
          return `<article class="field-card" id="ep-${s.id}" data-field="${s.id}" data-reveal>
            <span class="field-card__num" aria-hidden="true">${n}</span>
            <div class="field-card__spine" aria-hidden="true"></div>
            <header class="field-card__head">
              <h3 class="field-card__title">${esc(s.title)}</h3>
              <p class="field-card__desc">${esc(s.desc)}</p>
            </header>
            <div class="field-card__main">
              <div class="field-card__text">
                ${s.bullets ? `<ul class="field-card__bullets">${s.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}
                ${s.note ? `<div class="field-card__note"><span>${esc(s.note)}</span></div>` : ""}
              </div>
              <div class="field-card__aside">${cardVisual(s.id)}</div>
            </div>
            ${s.code ? `<div class="field-card__code">
              <div class="field-card__code-head"><button class="field-card__copy" data-copy-field>copy</button></div>
              <pre class="field-card__pre" data-code>${esc(s.code)}</pre>
            </div>` : ""}
          </article>`;
        }).join("")}
        <div class="field-empty" hidden>No matches</div>
      </section>

      ${footerHTML()}
    </div>
  `;

  wireCopy(app);
  setupReveal();
  setupCtaGlow(app);
  wireFieldNotes(app);
}

function wireFieldNotes(root) {
  wireQuickStartTerm(root);
  wireCanvasGrid(root);
  wireShellWires(root);
  root.querySelectorAll(".field-card").forEach((card) => {
    const code = card.querySelector("[data-code]");
    const btn = card.querySelector("[data-copy-field]");
    if (!code || !btn) return;
    btn.addEventListener("click", () => {
      if (navigator.clipboard) navigator.clipboard.writeText(code.textContent);
      const prev = btn.textContent;
      btn.textContent = "copied";
      btn.classList.add("on");
      clearTimeout(btn._t);
      btn._t = setTimeout(() => { btn.textContent = prev; btn.classList.remove("on"); }, 1200);
    });
  });

  const input = root.querySelector(".field-search__input");
  const cards = [...root.querySelectorAll(".field-card")];
  const count = root.querySelector(".field-toolbar__count");
  const empty = root.querySelector(".field-empty");
  function applyFilter() {
    const q = (input?.value || "").trim().toLowerCase();
    let visible = 0;
    cards.forEach((card) => {
      const hay = card.textContent.toLowerCase();
      const show = !q || hay.includes(q);
      card.hidden = !show;
      if (show) visible++;
    });
    if (count) count.textContent = q ? `${visible} / ${cards.length}` : `${cards.length} notes`;
    if (empty) empty.hidden = visible !== 0;
  }
  input?.addEventListener("input", applyFilter);
  input?.addEventListener("keydown", (e) => { if (e.key === "Escape") { input.value = ""; applyFilter(); input.blur(); } });

  const bar = root.querySelector(".field-progress__bar");
  const deck = root.querySelector(".field-deck");
  if (bar && deck) {
    const onScroll = () => {
      const r = deck.getBoundingClientRect();
      const total = r.height - window.innerHeight * 0.3;
      const progressed = Math.min(1, Math.max(0, -r.top / (total || 1)));
      bar.style.transform = `scaleX(${progressed})`;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    onScroll();
  }

  function highlightHash() {
    const id = location.hash.replace("#", "");
    if (!id) return;
    const target = root.querySelector(`#ep-${CSS.escape(id)}`);
    if (target) {
      target.classList.add("field-card--flash");
      setTimeout(() => target.classList.remove("field-card--flash"), 900);
    }
  }
  window.addEventListener("hashchange", highlightHash);
  highlightHash();
}

function wireQuickStartTerm(root) {
  const viz = root.querySelector(".field-viz--interactive");
  if (!viz) return;
  const code = viz.querySelector("[data-term]");
  const typed = viz.querySelector("[data-typed]");
  const out = viz.querySelector("[data-term-out]");
  if (!code || !typed || !out) return;
  let text = typed.textContent || "npm run dev";
  let hintTimer = 0;
  function render() { typed.textContent = text; }
  function flash(msg) {
    out.textContent = msg;
    out.classList.add("is-flash");
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { out.textContent = ""; out.classList.remove("is-flash"); }, 2600);
  }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function atanReply(raw) {
    const cmd = raw.trim();
    if (!cmd) return "say something";
    const low = cmd.toLowerCase();

    if (/^(help|\?|h)$/.test(low)) return pick([
      "help found you. try ls, pwd, git, npm, clear",
      "manual: ls pwd cat git npm node python clear exit. youre welcome",
    ]);
    if (/^(hi|hello|hey|yo|atan|mapw)\b/.test(low)) return pick([
      "hey. i'm Atan. i pretend to be a shell for fun",
      "hi. Atan here. i have opinions about your commands",
      "yo. Atan. four panes, one fake shell",
    ]);
    if (/^(ls|dir|ll|la)\b/.test(low)) return pick([
      "total 0. just like this filesystem",
      "four imaginary panes. nothing else to list",
      "ls: nothing here. try pwd instead",
    ]);
    if (/^pwd\b/.test(low)) return pick(["/dev/pretend/mapw", "/home/you/project (in your dreams)"]);
    if (/^cd(\s|$)/.test(low)) {
      if (low === "cd" || low === "cd ~") return "where to? this has no folders";
      if (low.includes("..")) return "nice try. you cannot escape the canvas";
      return `cd ${cmd.slice(3).trim() || "~"} — moved 0 files`;
    }
    if (/^(clear|cls|reset)\b/.test(low)) { setTimeout(() => { text = ""; render(); out.textContent = ""; }, 120); return pick(["cleared", "fresh start. still fake though"]); }
    if (/^echo\s*/.test(low)) { const m = cmd.slice(5).trim(); return m ? m : "echo what?"; }
    if (/^(cat|less|head|tail)\b/.test(low)) return "meow. file not found. files are imaginary here";
    if (/^(mkdir|touch|rmdir|cp|mv)\b/.test(low)) return pick(["done. 0 files changed, 0 regrets", "file operation complete. in another universe"]);
    if (/^rm\b/.test(low)) {
      if (low.includes("-rf") && (low.includes("/") || low.includes("*"))) return "nice. edgy. not deleting anything. try clear instead";
      return "rm: removed 0 files with great confidence";
    }
    if (/^sudo\b/.test(low)) return pick(["sudo? cute. you have no permissions here", "permission denied. Atan does not trust you yet"]);
    if (/^git\b/.test(low)) {
      if (low === "git") return "git? bold in a fake shell. try git status";
      if (low.startsWith("git status")) return "On branch main, nothing to commit. fake tree clean";
      if (low.startsWith("git commit")) return "committed: feat: procrastination. pushed to /dev/null";
      if (low.startsWith("git push")) return "pushing to origin… origin is imaginary. spiritually shipped";
      if (low.startsWith("git pull")) return "already up to date with your excuses";
      if (low.startsWith("git clone")) return "cloning into fake-repo… 0 bytes, 100% vibes";
      if (low.startsWith("git log")) return "log: you typed git log on a docs page. that is the history";
      if (low.startsWith("git diff")) return "diff: 0 insertions, 0 deletions. very clean";
      if (low.startsWith("git init")) return "initialized empty fake repository. congrats";
      return `git can do that. this cannot. but nice try`;
    }
    if (/^(npm|yarn|pnpm|bun|npx)\b/.test(low)) {
      if (/npm\s+run\s+dev/.test(low)) return pick(["now run it for real. four panes await", "copy paste champion. now do it locally"]);
      if (low.includes("install")) return "installing 847 packages… just kidding. node_modules is safe";
      if (low.includes("test")) return "tests passed. 212 green. in here, everything passes";
      if (low.includes("start")) return "starting… nothing started. enthusiasm 10/10";
      if (low.startsWith("npx")) return "npx: executed 0 packages with surprising speed";
      return pick(["package manager energy. this is a div though", "tried. your lockfile is untouched"]);
    }
    if (/^(node|deno|bun)\b/.test(low)) return "node? running js inside js. inception limited to this div";
    if (/^python3?\b/.test(low) || low.startsWith("pip")) return "python here would just say hello. try echo hello instead";
    if (/^(cargo|go|make)\b/.test(low)) return pick(["compiled 0 crates with 0 warnings", "built successfully. shipped to nowhere"]);
    if (/^(vim|nvim|nano|emacs|code)\b/.test(low)) return pick(["opened editor. closed editor. no files were harmed", "editor launched. you stared at it, then quit"]);
    if (/^(whoami|id|uname|hostname|who)\b/.test(low)) return pick(["you are you. Atan is Atan. mapw is mapw", "whoami: someone who types in docs for fun"]);
    if (/^(curl|wget)\b/.test(low)) return "fetching… from the void. 0 bytes, very fast";
    if (/^(kill|ps|top|htop|neofetch)\b/.test(low)) return "tried to be system-y. this is a docs page, not htop";
    if (/^(history|exit|quit|q)\b/.test(low)) return pick(["no history. no exit. only panes", "you cannot quit what was never real"]);
    if (low.length < 3) return "keep typing";
    return pick([
      `"${cmd.slice(0, 28)}" — noted. Atan is unimpressed`,
      `heard "${cmd.slice(0, 22)}". have you tried help?`,
      ` "${cmd.slice(0, 20)}" — creative. try ls or npm run dev`,
    ]);
  }

  function handleEnter() {
    const cmd = text.trim();
    const reply = atanReply(cmd);
    if (/npm\s+run\s+dev/.test(cmd)) { viz.classList.add("is-success"); setTimeout(() => viz.classList.remove("is-success"), 700); }
    flash(reply);
    text = "";
    render();
  }

  code.addEventListener("focus", () => viz.classList.add("is-focused"));
  code.addEventListener("blur", () => viz.classList.remove("is-focused"));
  viz.addEventListener("click", () => code.focus());
  code.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); handleEnter(); return; }
    if (e.key === "Backspace") { e.preventDefault(); text = text.slice(0, -1); render(); return; }
    if (e.key === "Escape") { e.preventDefault(); text = ""; render(); flash("cleared"); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.length !== 1) return;
    if (text.length >= 44) { flash("too long"); return; }
    text += e.key; render(); e.preventDefault();
  });
  code.addEventListener("paste", (e) => {
    const t = (e.clipboardData || window.clipboardData).getData("text");
    if (!t) return; e.preventDefault();
    text += t.replace(/[\r\n]+/g, " ").slice(0, 44 - text.length);
    render();
  });
  render();
}

function wireCanvasGrid(root) {
  const grid = root.querySelector("[data-canvas-grid]");
  const mini = grid?.querySelector("[data-mini]");
  if (!grid || !mini) return;
  const panes = [...mini.querySelectorAll("[data-pane]")];
  const PW = 38, PH = 26, GAP = 8;

  function bounds() {
    return { W: mini.clientWidth, H: mini.clientHeight };
  }
  function centeredStart() {
    const { W, H } = bounds();
    const gridW = PW * 2 + GAP;
    const gridH = PH * 2 + GAP;
    const ox = Math.max(0, Math.round((W - gridW) / 2));
    const oy = Math.max(0, Math.round((H - gridH) / 2));
    return [
      { x: ox, y: oy },
      { x: ox + PW + GAP, y: oy },
      { x: ox, y: oy + PH + GAP },
      { x: ox + PW + GAP, y: oy + PH + GAP },
    ];
  }
  let start = centeredStart();
  panes.forEach((el, i) => {
    el.style.left = start[i].x + "px";
    el.style.top = start[i].y + "px";
  });

  let drag = null;

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function onMove(e) {
    if (!drag) return;
    const rect = mini.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    const x = src.clientX - rect.left - drag.dx;
    const y = src.clientY - rect.top - drag.dy;
    const { W, H } = bounds();
    const nx = clamp(x, 0, W - PW);
    const ny = clamp(y, 0, H - PH);
    drag.el.style.left = nx + "px";
    drag.el.style.top = ny + "px";
  }
  function onUp() {
    if (!drag) return;
    drag.el.classList.remove("is-dragging");
    drag = null;
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    window.removeEventListener("touchmove", onMove);
    window.removeEventListener("touchend", onUp);
  }

  panes.forEach((el) => {
    const startDrag = (e) => {
      e.preventDefault();
      const rect = mini.getBoundingClientRect();
      const src = e.touches ? e.touches[0] : e;
      const r2 = el.getBoundingClientRect();
      const dx = src.clientX - r2.left;
      const dy = src.clientY - r2.top;
      drag = { el, dx, dy };
      el.classList.add("is-dragging");
      // bring to front
      panes.forEach((p) => (p.style.zIndex = "1"));
      el.style.zIndex = "3";
      window.addEventListener("mousemove", onMove, { passive: false });
      window.addEventListener("mouseup", onUp);
      window.addEventListener("touchmove", onMove, { passive: false });
      window.addEventListener("touchend", onUp);
      el.focus();
    };
    el.addEventListener("mousedown", startDrag);
    el.addEventListener("touchstart", startDrag, { passive: false });
    // keyboard nudge
    el.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 8 : 2;
      let x = parseInt(el.style.left, 10) || 0;
      let y = parseInt(el.style.top, 10) || 0;
      const { W, H } = bounds();
      if (e.key === "ArrowLeft") { e.preventDefault(); x = clamp(x - step, 0, W - PW); }
      else if (e.key === "ArrowRight") { e.preventDefault(); x = clamp(x + step, 0, W - PW); }
      else if (e.key === "ArrowUp") { e.preventDefault(); y = clamp(y - step, 0, H - PH); }
      else if (e.key === "ArrowDown") { e.preventDefault(); y = clamp(y + step, 0, H - PH); }
      else if (e.key === "Home") { e.preventDefault(); x = 0; y = 0; }
      else return;
      el.style.left = x + "px";
      el.style.top = y + "px";
    });
  });

  // Reset on
  mini.addEventListener("dblclick", () => {
    start = centeredStart();
    panes.forEach((el, i) => {
      el.style.left = start[i].x + "px";
      el.style.top = start[i].y + "px";
    });
  });
}

function wireShellWires(root) {
  const grid = root.querySelector("[data-shell-grid]");
  if (!grid) return;
  const svg = grid.querySelector("[data-wires]");
  const nodes = [...grid.querySelectorAll("[data-node]")];
  if (!svg || nodes.length < 2) return;

  const NW = 68, NH = 36;
  // Initial spread
  function layout() {
    const W = grid.clientWidth, H = grid.clientHeight;
    const gap = Math.max(12, Math.min(24, (W - NW * nodes.length) / (nodes.length + 1)));
    const totalW = NW * nodes.length + gap * (nodes.length - 1);
    const ox = Math.max(8, Math.round((W - totalW) / 2));
    const oy = Math.round((H - NH) / 2);
    nodes.forEach((el, i) => {
      el.style.left = ox + i * (NW + gap) + "px";
      el.style.top = oy + "px";
    });
    drawWires();
  }

  function center(p) {
    const x = parseInt(p.style.left, 10) || 0;
    const y = parseInt(p.style.top, 10) || 0;
    return { x: x + NW / 2, y: y + NH / 2 };
  }

  function drawWires() {
    const W = grid.clientWidth, H = grid.clientHeight;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    svg.innerHTML = "";
    const ns = "http://www.w3.org/2000/svg";
    for (let i = 0; i < nodes.length - 1; i++) {
      const a = center(nodes[i]), b = center(nodes[i + 1]);
      const dx = Math.abs(b.x - a.x) * 0.45;
      const path = document.createElementNS(ns, "path");
      const d = `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
      path.setAttribute("d", d);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", i === 1 ? "#0A0A0A" : "#6B6B6B");
      path.setAttribute("stroke-width", i === 1 ? "1.8" : "1.2");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("opacity", i === 1 ? "1" : "0.55");
      // arrow head via marker
      path.setAttribute("marker-end", "url(#arrow)");
      svg.appendChild(path);
    }
    // defs for arrow
    let defs = svg.querySelector("defs");
    if (!defs) {
      const ns2 = "http://www.w3.org/2000/svg";
      defs = document.createElementNS(ns2, "defs");
      const m = document.createElementNS(ns2, "marker");
      m.setAttribute("id", "arrow");
      m.setAttribute("viewBox", "0 0 10 10");
      m.setAttribute("refX", "8");
      m.setAttribute("refY", "5");
      m.setAttribute("markerWidth", "6");
      m.setAttribute("markerHeight", "6");
      m.setAttribute("orient", "auto-start-reverse");
      const p = document.createElementNS(ns2, "path");
      p.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
      p.setAttribute("fill", "#0A0A0A");
      p.setAttribute("opacity", "0.9");
      m.appendChild(p);
      defs.appendChild(m);
      svg.insertBefore(defs, svg.firstChild);
    }
  }

  layout();
  const ro = new ResizeObserver(() => { layout(); });
  ro.observe(grid);

  let drag = null;
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function onMove(e) {
    if (!drag) return;
    const r = grid.getBoundingClientRect();
    const s = e.touches ? e.touches[0] : e;
    const x = s.clientX - r.left - drag.dx;
    const y = s.clientY - r.top - drag.dy;
    const W = grid.clientWidth, H = grid.clientHeight;
    const nx = clamp(x, 0, W - NW);
    const ny = clamp(y, 0, H - NH);
    drag.el.style.left = nx + "px";
    drag.el.style.top = ny + "px";
    drawWires();
  }
  function onUp() {
    if (!drag) return;
    drag.el.classList.remove("is-dragging");
    drag = null;
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    window.removeEventListener("touchmove", onMove);
    window.removeEventListener("touchend", onUp);
  }

  nodes.forEach((el) => {
    const startDrag = (e) => {
      e.preventDefault();
      const gr = grid.getBoundingClientRect();
      const s = e.touches ? e.touches[0] : e;
      const er = el.getBoundingClientRect();
      drag = { el, dx: s.clientX - er.left, dy: s.clientY - er.top };
      el.classList.add("is-dragging");
      nodes.forEach((n) => (n.style.zIndex = "1"));
      el.style.zIndex = "3";
      window.addEventListener("mousemove", onMove, { passive: false });
      window.addEventListener("mouseup", onUp);
      window.addEventListener("touchmove", onMove, { passive: false });
      window.addEventListener("touchend", onUp);
      el.focus();
    };
    el.addEventListener("mousedown", startDrag);
    el.addEventListener("touchstart", startDrag, { passive: false });
    el.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 10 : 3;
      let x = parseInt(el.style.left, 10) || 0;
      let y = parseInt(el.style.top, 10) || 0;
      const W = grid.clientWidth, H = grid.clientHeight;
      if (e.key === "ArrowLeft") { e.preventDefault(); x = clamp(x - step, 0, W - NW); }
      else if (e.key === "ArrowRight") { e.preventDefault(); x = clamp(x + step, 0, W - NW); }
      else if (e.key === "ArrowUp") { e.preventDefault(); y = clamp(y - step, 0, H - NH); }
      else if (e.key === "ArrowDown") { e.preventDefault(); y = clamp(y + step, 0, H - NH); }
      else if (e.key === "Home") { e.preventDefault(); layout(); return; }
      else return;
      el.style.left = x + "px";
      el.style.top = y + "px";
      drawWires();
    });
  });

  grid.addEventListener("dblclick", () => layout());
}