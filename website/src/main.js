import './style.css';
import { initSite } from './site/ui.js';
initSite();
// Mount hero
const el = document.getElementById("arrangement");
if (el && !matchMedia("(prefers-reduced-motion: reduce)").matches) import('./scene/arrangement.js').then((m) => m.mountArrangement(el));
