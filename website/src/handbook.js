import "./style.css";
import { renderHandbookPage } from "./site/handbookPage.js";
renderHandbookPage();
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
