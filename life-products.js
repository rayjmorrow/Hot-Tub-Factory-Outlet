(()=>{
const products=[
{id:'life-ph-up-liquid',name:'1 pt pH Up Liquid',price:9.82,image:'assets/LCH-50-4035_medium.jpg'},
{id:'life-brom-tabs-5',name:'5 lb Brominating Tabs',price:129.92,image:'assets/LCH-50-1005-1_medium.jpg'},
{id:'life-waterline-cleaner',name:'1 pt Waterline & Surface Cleaner',price:10.62,image:'assets/LCH-50-5090-1_medium.jpg'},
{id:'life-scale-defense',name:'1 pt Scale Defense',price:10.58,image:'assets/LCH-50-5011-1_medium.jpg'},
{id:'life-cover-cleaner',name:'1 pt Cover Cleaner & Conditioner',price:28.18,image:'assets/LCH-50-5070-2_large.jpg'},
{id:'life-scum-free',name:'1 pt Scum Free',price:10.84,image:'assets/LCH-50-5030-2_large.jpg'},
{id:'life-fresh-start',name:'Fresh Start Spa Maintenance Kit',price:65.64,image:'assets/LCH-50-0030-1_medium.jpg'},
{id:'life-spasoft',name:'2 lbs SpaSoft',price:20.76,image:'assets/LCH-50-5005_medium.jpg'},
{id:'life-chlor-5',name:'5 lb Chlorinating Granules',price:83.90,image:'assets/LCH-50-2005_medium.jpg'},
{id:'life-foam-free',name:'1 pt Foam Free',price:10.84,image:'assets/LCH-50-5040-2_large.jpg'},
{id:'life-metal-out',name:'1 pt Metal Out',price:9.80,image:'assets/LCH-50-5010-2_large.jpg'},
{id:'life-filter-cleaner',name:'1 pt Filter Cleaner with Sprayer',price:14.46,image:'assets/LCH-50-5080-2_large.jpg'},
{id:'life-oxidizer-5',name:'5 lb Oxidizing Shock',price:60.94,image:'assets/LCH-50-3005-2_large.jpg'},
{id:'life-alk-up',name:'1 lb Alkalinity & pH Up',price:8.54,image:'assets/LCH-50-4030-2_medium.jpg'},
{id:'life-calcium',name:'14 oz Calcium Booster',price:7.40,image:'assets/LCH-50-4010-2_large.jpg'},
{id:'life-brom-tabs-15',name:'1.5 lb Brominating Tabs',price:42.28,image:'assets/LCH-50-1015-2_large.jpg'},
{id:'life-clarifier',name:'1 pt Natural Clarifier',price:8.58,image:'assets/LCH-50-5020-2_large.jpg'},
{id:'life-oxidizer-15',name:'1.5 lb Oxidizing Shock',price:18.38,image:'assets/LCH-50-3015-2_medium.jpg'},
{id:'life-chlor-2',name:'2 lb Chlorinating Granules',price:32.92,image:'assets/LCH-50-2002-2_medium.jpg'},
{id:'life-alk-down',name:'1.5 lb Alkalinity & pH Down',price:10.40,image:'assets/LCH-50-4020-2_medium.jpg'},
{id:'life-jet-cleaner',name:'1 pt Purge & Jet Line Cleaner',price:12.66,image:'assets/LCH-50-5060-2_medium.jpg'}
];
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
function addToCart(p){
  if(window.HTFOCart?.add){window.HTFOCart.add({id:p.id,sku:p.id,name:p.name,price:p.price});return;}
  const key='htfo_cart_v1';let c=[];try{c=JSON.parse(localStorage.getItem(key)||'[]')}catch{}
  const hit=c.find(x=>x.id===p.id);if(hit)hit.qty++;else c.push({id:p.id,sku:p.id,name:p.name,price:p.price,qty:1});localStorage.setItem(key,JSON.stringify(c));location.href='cart.html';
}
function build(){
  const chem=document.getElementById('chemicals');if(!chem||document.getElementById('life-chemicals'))return;
  const sec=document.createElement('section');sec.className='section';sec.id='life-chemicals';
  sec.innerHTML=`<div class="wrap"><div class="head"><span class="eyebrow">Spa water care</span><h2>LIFE Spa Chemicals</h2><p>A complete everyday spa-care line for sanitizing, balancing, cleaning and maintenance. Every item below is shown at Hot Tub Factory Outlet's current sale price.</p></div><div class="life-grid"></div></div>`;
  chem.parentNode.insertBefore(sec,chem);
  const grid=sec.querySelector('.life-grid');
  products.forEach(p=>{const card=document.createElement('article');card.className='life-card';card.innerHTML=`<div class="life-img-wrap"><img src="${p.image}" alt="${p.name}" loading="lazy"></div><div class="life-body"><h3>${p.name}</h3><div class="life-sale">This Week's Sale Price</div><div class="life-price">${money(p.price)}</div><button type="button" class="life-add">Add to Cart</button></div>`;card.querySelector('.life-add').addEventListener('click',()=>addToCart(p));grid.appendChild(card)});
  const style=document.createElement('style');style.textContent=`.life-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin-top:25px}.life-card{background:#fff;border:1px solid #dce6eb;border-radius:18px;overflow:hidden;box-shadow:0 6px 20px #0826420d;display:flex;flex-direction:column}.life-img-wrap{height:205px;display:flex;align-items:center;justify-content:center;background:#fff;border-bottom:1px solid #dce6eb;padding:16px}.life-img-wrap img{width:100%;height:100%;object-fit:contain}.life-body{padding:18px;display:flex;flex-direction:column;flex:1}.life-body h3{margin:0 0 14px;color:#082642;font-size:19px;line-height:1.25}.life-sale{margin-top:auto;font-size:11px;text-transform:uppercase;font-weight:900;color:#687985;letter-spacing:.06em}.life-price{font-size:27px;font-weight:900;color:#082642;margin-top:3px}.life-add{margin-top:14px;width:100%;border:0;border-radius:10px;background:#0b79b7;color:#fff;font-weight:900;padding:12px 14px;cursor:pointer;font-size:15px}@media(max-width:980px){.life-grid{grid-template-columns:repeat(3,1fr)}}@media(max-width:760px){.life-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:520px){.life-grid{grid-template-columns:1fr}.life-img-wrap{height:220px}}`;
  document.head.appendChild(style);
  const dept=document.querySelector('.dept[href="#chemicals"]');if(dept&&!document.querySelector('.dept[href="#life-chemicals"]'))dept.insertAdjacentHTML('beforebegin','<a class="dept" href="#life-chemicals"><small>Spa water care</small>LIFE Chemicals</a>');
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',build);else build();
})();