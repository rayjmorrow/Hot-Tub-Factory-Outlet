(()=>{
const products=[
{name:'1 pt pH Up Liquid',price:9.82,sprite:15},
{name:'5 lb Brominating Tabs',price:129.92,sprite:3},
{name:'1 pt Waterline & Surface Cleaner',price:10.62,sprite:20},
{name:'1 pt Scale Defense',price:10.58,sprite:17},
{name:'1 pt Cover Cleaner & Conditioner',price:28.18,sprite:7},
{name:'1 pt Scum Free',price:10.84,sprite:18},
{name:'Fresh Start Spa Maintenance Kit',price:65.64,sprite:10},
{name:'2 lbs SpaSoft',price:20.76,sprite:19},
{name:'5 lb Chlorinating Granules',price:83.90,sprite:6},
{name:'1 pt Foam Free',price:10.84,sprite:9},
{name:'1 pt Metal Out',price:9.80,sprite:11},
{name:'1 pt Filter Cleaner with Sprayer',price:14.46,sprite:8},
{name:'5 lb Oxidizing Shock',price:60.94,sprite:14},
{name:'1 lb Alkalinity & pH Up',price:8.54,sprite:1},
{name:'14 oz Calcium Booster',price:7.40,sprite:4},
{name:'1.5 lb Brominating Tabs',price:42.28,sprite:2},
{name:'1 pt Natural Clarifier',price:8.58,sprite:12},
{name:'1.5 lb Oxidizing Shock',price:18.38,sprite:13},
{name:'2 lb Chlorinating Granules',price:32.92,sprite:5},
{name:'1.5 lb Alkalinity & pH Down',price:10.40,sprite:0},
{name:'1 pt Purge & Jet Line Cleaner',price:12.66,sprite:16}
];
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
function addToCart(p){
  if(window.HTFOCart?.add){window.HTFOCart.add({id:`life-${p.sprite}`,sku:`life-${p.sprite}`,name:p.name,price:p.price});return;}
  const key='htfo_cart_v1';let c=[];try{c=JSON.parse(localStorage.getItem(key)||'[]')}catch{}
  const id=`life-${p.sprite}`;const hit=c.find(x=>x.id===id);if(hit)hit.qty++;else c.push({id,sku:id,name:p.name,price:p.price,qty:1});localStorage.setItem(key,JSON.stringify(c));location.href='cart.html';
}
function build(){
  const frog=document.getElementById('frog-ease'),chem=document.getElementById('chemicals');if(!chem||document.getElementById('life-chemicals'))return;
  const sec=document.createElement('section');sec.className='section';sec.id='life-chemicals';
  sec.innerHTML=`<div class="wrap"><div class="head"><span class="eyebrow">Spa water care</span><h2>LIFE Spa Chemicals</h2><p>A complete everyday spa-care line for sanitizing, balancing, cleaning and maintenance. Every item below is shown at Hot Tub Factory Outlet's current sale price.</p></div><div class="life-grid"></div></div>`;
  chem.parentNode.insertBefore(sec,chem);
  const grid=sec.querySelector('.life-grid');
  products.forEach((p,i)=>{
    const col=p.sprite%4,row=Math.floor(p.sprite/4);const card=document.createElement('article');card.className='life-card';
    card.innerHTML=`<div class="life-img-wrap"><div class="life-img" style="background-position:${-col*300}px ${-row*180}px"></div></div><div class="life-body"><h3>${p.name}</h3><div class="life-sale">This Week's Sale Price</div><div class="life-price">${money(p.price)}</div><button type="button" class="life-add">Add to Cart</button></div>`;
    card.querySelector('.life-add').addEventListener('click',()=>addToCart(p));grid.appendChild(card);
  });
  const style=document.createElement('style');style.textContent=`.life-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin-top:25px}.life-card{background:#fff;border:1px solid #dce6eb;border-radius:18px;overflow:hidden;box-shadow:0 6px 20px #0826420d;display:flex;flex-direction:column}.life-img-wrap{height:205px;display:flex;align-items:center;justify-content:center;background:#fff;border-bottom:1px solid #dce6eb;overflow:hidden}.life-img{width:300px;height:180px;max-width:100%;background-image:url('assets/accessories/life/life-products-sprite.jpg');background-size:1200px 1080px;background-repeat:no-repeat;flex:0 0 auto}.life-body{padding:18px;display:flex;flex-direction:column;flex:1}.life-body h3{margin:0 0 14px;color:#082642;font-size:19px;line-height:1.25}.life-sale{margin-top:auto;font-size:11px;text-transform:uppercase;font-weight:900;color:#687985;letter-spacing:.06em}.life-price{font-size:27px;font-weight:900;color:#082642;margin-top:3px}.life-add{margin-top:14px;width:100%;border:0;border-radius:10px;background:#0b79b7;color:#fff;font-weight:900;padding:12px 14px;cursor:pointer;font-size:15px}@media(max-width:980px){.life-grid{grid-template-columns:repeat(3,1fr)}}@media(max-width:760px){.life-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:520px){.life-grid{grid-template-columns:1fr}.life-img-wrap{height:220px}}`;
  document.head.appendChild(style);
  const dept=document.querySelector('.dept[href="#chemicals"]');if(dept&&!document.querySelector('.dept[href="#life-chemicals"]'))dept.insertAdjacentHTML('beforebegin','<a class="dept" href="#life-chemicals"><small>Spa water care</small>LIFE Chemicals</a>');
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',build);else build();
})();