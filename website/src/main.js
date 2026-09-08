import './style.css';
import { initSite } from './site/ui.js';
// Fix old #download hash — redirect to real download
if (location.hash === "#download") history.replaceState(null, "", "/download");
initSite();
// Mount hero
const el = document.getElementById("arrangement");
if (el && !matchMedia("(prefers-reduced-motion: reduce)").matches) import('./scene/arrangement.js').then((m) => m.mountArrangement(el));
