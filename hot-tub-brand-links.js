(()=>{
const map={'American Whirlpool':'american-whirlpool','Vita Spa':'vita-spas','Cal Spas':'cal-spas','AquaSolus':'aquasolus','Eco Spas':'eco-spas','Innova Spas':'innova-spas'};
function linkify(){document.querySelectorAll('.brand-head h2').forEach(h=>{if(h.querySelector('a'))return;const name=h.textContent.trim();const slug=map[name];if(!slug)return;h.innerHTML=`<a class="brand-about-link" href="brand.html?brand=${slug}" title="Explore ${name}">${name}<span>About & features →</span></a>`})}
const catalog=document.getElementById('catalog');if(catalog){linkify();new MutationObserver(linkify).observe(catalog,{childList:true,subtree:true})}
})();