// Chip catalogue as a live console — types `mapw launch <chip>`, streams the
// real curated CLI list, filters live, copies launch commands. Pure DOM.

const PROMPT = "$ ";
const CMD = "mapw launch <chip>";

export function initConsole(root, chips) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  root.innerHTML = `
    <div class="term">
      <div class="term-bar">
        <span class="term-dot"></span><span class="term-dot"></span><span class="term-dot"></span>
        <span class="term-title">chips</span>
        <span class="term-meta"><span class="term-count">${chips.length}</span></span>
      </div>
      <div class="term-body">
        <div class="term-cmd" tabindex="0" role="textbox" aria-label="Catalog terminal" data-chip-term><span class="term-prompt">${PROMPT}</span><span class="term-typed"></span><span class="term-caret"></span></div>
        <div class="term-status" hidden>${chips.length} chips</div>
        <div class="term-filter" hidden>
          <input class="term-input" placeholder="Filter" spellcheck="false" autocomplete="off" />
        </div>
        <div class="term-out" hidden aria-live="polite"></div>
        <div class="term-rows"></div>
      </div>
    </div>
  `;

  const termCmd = root.querySelector("[data-chip-term]");
  const typed = root.querySelector(".term-typed");
  const caret = root.querySelector(".term-caret");
  const status = root.querySelector(".term-status");
  const filterWrap = root.querySelector(".term-filter");
  const input = root.querySelector(".term-input");
  const rowsEl = root.querySelector(".term-rows");
  const countEl = root.querySelector(".term-count");
  const outEl = root.querySelector(".term-out");

  const nameW = chips.reduce(function (m, x) { return Math.max(m, x.name.length); }, 0);
  const idW = chips.reduce(function (m, x) { return Math.max(m, x.id.length); }, 0);

  function pad(s, n) { return String(s).padEnd(n, " "); }

  function rowHTML(m, i) {
    return `<button class="term-row" data-id="${escapeHtml(m.id)}" data-i="${i}" style="--d:${i * 55}ms">
      <span class="tr-name">${escapeHtml(pad(m.name, nameW))}</span>
      <span class="tr-id">${escapeHtml(pad("$ " + m.id, idW + 2))}</span>
      <span class="tr-lab">${escapeHtml(m.lab)}</span>
      <span class="tr-price">chip</span>
      <span class="tr-copy">copy cmd</span>
    </button>`;
  }

  function paint(list) {
    rowsEl.innerHTML = list.map(function (m) { return rowHTML(m, m._i); }).join("");
    countEl.textContent = list.length;
  }

  function reveal() {
    status.hidden = false;
    filterWrap.hidden = false;
    chips.forEach(function (m, i) { m._i = i; });
    paint(chips);
    requestAnimationFrame(function () {
      rowsEl.querySelectorAll(".term-row").forEach(function (r) { r.classList.add("in"); });
    });
    wireRows();
  }

  let cmdText = CMD;
  function typeCmd() {
    if (reduce) { typed.textContent = CMD; cmdText = CMD; caret.style.display = "none"; reveal(); wireChipTerm(); return; }
    let i = 0;
    (function step() {
      typed.textContent = CMD.slice(0, i);
      i++;
      if (i <= CMD.length) setTimeout(step, 24 + Math.random() * 30);
      else { caret.classList.add("blink"); cmdText = CMD; setTimeout(reveal, 260); wireChipTerm(); }
    })();
  }

  function wireChipTerm() {
    if (!termCmd) return;
    termCmd.addEventListener("click", () => termCmd.focus());
    termCmd.addEventListener("focus", () => termCmd.classList.add("is-focused"));
    termCmd.addEventListener("blur", () => termCmd.classList.remove("is-focused"));
    termCmd.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const raw = cmdText.trim();
        const msg = atanForChips(raw) || `heard "${raw.slice(0, 22)}"`;
        if (/^mapw\s+launch\b/i.test(raw)) {
          const id = raw.toLowerCase().replace(/^mapw\s+launch\s+/, "").trim();
          const found = chips.find((c) => c.id === id);
          if (found && navigator.clipboard) navigator.clipboard.writeText(found.id);
        }
        const direct = chips.find((c) => c.id === raw.trim().toLowerCase());
        if (direct && navigator.clipboard) navigator.clipboard.writeText(direct.id);
        showOut(msg);
        cmdText = "";
        typed.textContent = "";
        return;
      }
      if (e.key === "Backspace") { e.preventDefault(); cmdText = cmdText.slice(0, -1); typed.textContent = cmdText; return; }
      if (e.key === "Escape") { e.preventDefault(); cmdText = ""; typed.textContent = ""; showOut(""); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length !== 1) return;
      if (cmdText.length >= 44) return;
      cmdText += e.key;
      typed.textContent = cmdText;
      e.preventDefault();
    });
    termCmd.addEventListener("paste", (e) => {
      const t = (e.clipboardData || window.clipboardData).getData("text");
      if (!t) return; e.preventDefault();
      cmdText += t.replace(/[\r\n]+/g, " ").slice(0, 44 - cmdText.length);
      typed.textContent = cmdText;
    });
  }

  let cursor = -1;

  function wireRows() {
    const rows = Array.prototype.slice.call(rowsEl.querySelectorAll(".term-row"));
    rows.forEach(function (r) {
      r.addEventListener("click", function () {
        const id = r.getAttribute("data-id");
        if (navigator.clipboard) navigator.clipboard.writeText(id);
        r.classList.add("copied");
        clearTimeout(r._t);
        r._t = setTimeout(function () { r.classList.remove("copied"); }, 1100);
      });
      r.addEventListener("mouseenter", function () {
        cursor = rows.indexOf(r);
        mark(rows);
      });
    });
  }

  function mark(rows) {
    rows.forEach(function (r, i) { r.classList.toggle("cur", i === cursor); });
  }

  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function atanForChips(raw) {
    const low = raw.trim().toLowerCase();
    if (!low) return "";
    if (/^(help|\?)$/.test(low)) return pick(["help: type a chip id, or mapw launch <chip>", "try: claude, opencode, codex, gemini, aider, amp"]);
    if (/^mapw\s+launch\b/.test(low)) {
      const id = low.replace(/^mapw\s+launch\s+/, "").trim();
      const found = chips.find((c) => c.id === id);
      if (found) return `launching ${found.id} — copied`;
      if (!id || id === "<chip>") return "mapw launch <chip> — pick one: claude, opencode, codex";
      return `"${id}" not found. try: ${chips.map((c) => c.id).join(", ")}`;
    }
    const hit = chips.find((c) => c.id === low || c.name.toLowerCase() === low);
    if (hit) return `${hit.id} — press Enter to copy`;
    if (/^(hi|hello|hey|yo|atan)\b/.test(low)) return pick(["hey. Atan here. six chips, one fake shell", "yo. Atan. pick a chip, any chip"]);
    if (/^(ls|dir|ll|la)\b/.test(low)) return "total 6 chips. try filtering instead of ls";
    if (/^pwd\b/.test(low)) return "/dev/pretend/chips";
    if (/^cd(\s|$)/.test(low)) return low.includes("..") ? "cannot cd out of chips" : "where to? chips have no folders";
    if (/^clear\b/.test(low)) return "cleared";
    if (/^echo\s*/.test(low)) { const m = raw.trim().slice(5).trim(); return m ? m : "echo what?"; }
    if (/^(cat|less)\b/.test(low)) return "file not found. chips are chips, not files";
    if (/^git\b/.test(low)) {
      if (low === "git") return "git? try git status for fake status";
      if (low.startsWith("git status")) return "On branch main, 6 chips, nothing to commit";
      if (low.startsWith("git clone")) return "cloning fake-repo… 0 bytes, 100% vibes";
      return "git can do that. this shows chips though";
    }
    if (/^(npm|yarn|pnpm|bun|npx)\b/.test(low)) {
      if (low.includes("install")) return "installing 6 chips… just kidding";
      if (/npm\s+run\s+dev/.test(low)) return "now run it for real. four panes await";
      return "package manager energy. this lists chips though";
    }
    if (/^(node|python3?|cargo|go|make)\b/.test(low)) return "trying to be system-y. this just lists chips";
    if (/^sudo\b/.test(low)) return "sudo? you have no permissions here";
    if (/^(whoami|neofetch)\b/.test(low)) return "you are someone who types in chip consoles";
    if (low.length < 2) return "";
    return "";
  }

  let outTimer = 0;
  function showOut(msg) {
    if (!msg) { outEl.hidden = true; outEl.textContent = ""; return; }
    outEl.textContent = msg;
    outEl.hidden = false;
    clearTimeout(outTimer);
    outTimer = setTimeout(() => { outEl.hidden = true; }, 2600);
  }

  input.addEventListener("input", function () {
    const raw = input.value;
    const q = raw.trim().toLowerCase();
    const at = atanForChips(raw);
    if (at) showOut(at); else if (!q) showOut("");
    const list = chips.filter(function (m) {
      return !q || m.name.toLowerCase().indexOf(q) >= 0 ||
             m.id.toLowerCase().indexOf(q) >= 0 ||
             m.lab.toLowerCase().indexOf(q) >= 0;
    });
    cursor = -1;
    paint(list);
    requestAnimationFrame(function () {
      rowsEl.querySelectorAll(".term-row").forEach(function (r) { r.classList.add("in"); });
    });
    wireRows();
    if (!list.length && !at) {
      rowsEl.innerHTML = '<div class="term-empty">no match</div>';
    }
  });

  input.addEventListener("keydown", function (e) {
    const rows = Array.prototype.slice.call(rowsEl.querySelectorAll(".term-row"));
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!rows.length) return;
      e.preventDefault();
      cursor += e.key === "ArrowDown" ? 1 : -1;
      if (cursor < 0) cursor = rows.length - 1;
      if (cursor >= rows.length) cursor = 0;
      mark(rows);
      rows[cursor].scrollIntoView({ block: "nearest" });
      return;
    }
    if (e.key === "Enter") {
      const raw = input.value.trim();
      const low = raw.toLowerCase();
      const direct = chips.find((c) => c.id === low);
      if (direct) { e.preventDefault(); if (navigator.clipboard) navigator.clipboard.writeText(direct.id); showOut(`${direct.id} copied`); return; }
      if (/^mapw\s+launch\b/.test(low)) {
        e.preventDefault();
        const id = low.replace(/^mapw\s+launch\s+/, "").trim();
        const found = chips.find((c) => c.id === id);
        if (found && navigator.clipboard) navigator.clipboard.writeText(found.id);
        showOut(atanForChips(raw));
        return;
      }
      if (low === "clear") { e.preventDefault(); input.value = ""; showOut("cleared"); const ev = new Event("input"); input.dispatchEvent(ev); return; }
      if (cursor >= 0 && rows[cursor]) { e.preventDefault(); rows[cursor].click(); return; }
      const msg = atanForChips(raw);
      if (msg) { e.preventDefault(); showOut(msg); }
    }
    if (e.key === "Escape") { input.value = ""; showOut(""); const ev = new Event("input"); input.dispatchEvent(ev); }
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  let started = false;
  function start() {
    if (!("IntersectionObserver" in window)) { typeCmd(); return; }
    const io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting && !started) { started = true; typeCmd(); io.disconnect(); }
      });
    }, { threshold: 0.25 });
    io.observe(root);
  }

  return { start: start };
}
