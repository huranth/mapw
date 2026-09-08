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
// Loader — stay 2.5s
(function(){
  var l=document.getElementById('loader');
  if(!l) return;
  var start=Date.now(),min=2400;
  function out(){
    var elapsed=Date.now()-start;
    var wait=Math.max(0,min-elapsed);
    setTimeout(function(){
      l.classList.add('out');
      setTimeout(function(){ if(l&&l.parentNode) l.parentNode.removeChild(l); },420);
    },wait);
  }
  if(document.readyState==='complete') out();
  else window.addEventListener('load', out, {once:true});
  setTimeout(out, 3000);
})();