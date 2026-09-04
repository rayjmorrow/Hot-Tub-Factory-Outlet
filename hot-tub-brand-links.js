(()=>{
const map={'American Whirlpool':'american-whirlpool','Vita Spa':'vita-spas','Cal Spas':'cal-spas','AquaSolus':'aquasolus','Eco Spas':'eco-spas','Innova Spas':'innova-spas'};
const ecoImages={
'E1':'https://ecospas.com/images/e1-topview.jpg',
'E2':'https://ecospas.com/images/e2-topview.jpg',
'E3':'https://ecospas.com/images/e3-topview.jpg',
'E4':'https://ecospas.com/images/e4-topview.jpg',
'E5':'https://ecospas.com/images/e5-top-view.jpg',
'E5 DLUX':'https://ecospas.com/images/e5-top-view.jpg',
'E6':'https://ecospas.com/images/e6-top-view.jpg',
'E6 DLUX':'https://ecospas.com/images/e6-top-view.jpg'
};
function linkify(){document.querySelectorAll('.brand-head h2').forEach(h=>{if(h.querySelector('a'))return;const name=h.textContent.trim();const slug=map[name];if(!slug)return;h.innerHTML=`<a class="brand-about-link" href="brand.html?brand=${slug}" title="Explore ${name}">${name}<span>About & features →</span></a>`})}
function fixEcoThumbs(){document.querySelectorAll('.brand-block').forEach(block=>{const h=block.querySelector('.brand-head h2');if(!h||!h.textContent.trim().startsWith('Eco Spas'))return;block.querySelectorAll('.row').forEach(row=>{const name=row.querySelector('.modelname')?.textContent.trim();const src=ecoImages[name];const img=row.querySelector('.thumb img');if(!src||!img)return;if(img.src!==src){img.onerror=()=>{img.onerror=null;img.src='assets/htfo-logo.webp';img.parentElement.classList.add('fallback')};img.src=src}img.parentElement.classList.remove('fallback');row.querySelectorAll('.thumb-note').forEach(n=>n.remove())})})}
const style=document.createElement('style');style.textContent=`.brand-about-link{display:flex;align-items:baseline;justify-content:space-between;gap:18px;color:var(--n);text-decoration:none}.brand-about-link:hover{color:var(--b)}.brand-about-link span{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;font-weight:850;color:var(--b);white-space:nowrap}@media(max-width:650px){.brand-about-link{align-items:flex-start;flex-direction:column;gap:4px}.brand-about-link span{font-size:12px}}`;document.head.appendChild(style);
function refresh(){linkify();fixEcoThumbs()}
const catalog=document.getElementById('catalog');if(catalog){refresh();new MutationObserver(refresh).observe(catalog,{childList:true,subtree:true})}
})();