import './style.css';
import { initSite } from './site/ui.js';
import { mountArrangement } from './scene/arrangement.js';
// Hash fix
if (location.hash === "#download") history.replaceState(null, "", "/download");
initSite();
// Hero
const el = document.getElementById("arrangement");
if (el) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) el.classList.add("is-ready");
  else try { mountArrangement(el); } catch {}
}