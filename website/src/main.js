import './style.css';
import { initSite } from './site/ui.js'

// Build the site DOM first, then mount The Arrangement into its hero slot.
initSite()

const mountEl = document.getElementById("arrangement")
if (mountEl && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  import('./scene/arrangement.js').then(({ mountArrangement }) => mountArrangement(mountEl))
}
