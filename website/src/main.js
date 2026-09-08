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
// Loader hide
(function hideLoader(){
  var loader=document.getElementById('loader');
  if(!loader) return;
  var done=false;
  function out(){
    if(done) return;
    done=true;
    loader.classList.add('out');
    setTimeout(function(){ if(loader&&loader.parentNode) loader.parentNode.removeChild(loader); },380);
  }
  var fallback=setTimeout(out,2600);
  function ready(){
    clearTimeout(fallback);
    if(document.fonts&&document.fonts.ready) document.fonts.ready.then(function(){ requestAnimationFrame(function(){ requestAnimationFrame(out); }); });
    else requestAnimationFrame(function(){ requestAnimationFrame(out); });
  }
  if(document.readyState==='complete') ready();
  else window.addEventListener('load', ready, {once:true});
})();