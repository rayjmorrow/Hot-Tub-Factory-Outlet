(()=>{
const models={Crown:'crown.svg',Monarch:'monarch.svg',Royal:'royal.svg',Legacy:'legacy.svg'};
const base='assets/hot-tubs/cal-spas/';
function modelNameFromRow(row){const n=row&&row.querySelector('.modelname');return n?n.textContent.trim():''}
function applyThumbs(root=document){root.querySelectorAll('.row').forEach(row=>{const name=modelNameFromRow(row),file=models[name];if(!file)return;const thumb=row.querySelector('.thumb');if(!thumb||thumb.dataset.legendImage==='1')return;thumb.dataset.legendImage='1';thumb.removeAttribute('style');thumb.classList.remove('fallback');thumb.innerHTML=`<img src="${base}${file}" alt="Cal Spas Platinum Legend ${name}" style="width:100%;height:100%;object-fit:contain;background:#fff">`;});}
function applyExplorer(root=document){root.querySelectorAll('.legend-hero').forEach(hero=>{if(hero.dataset.legendImage==='1')return;const title=hero.querySelector('h2');const name=title?title.textContent.trim():'';const file=models[name];if(!file)return;const mark=hero.querySelector('.legend-mark');if(!mark)return;hero.dataset.legendImage='1';const photo=document.createElement('div');photo.className='legend-photo';photo.style.cssText='background:#fff;border:1px solid #dce7ed;border-radius:20px;padding:10px;box-shadow:0 12px 32px #08264222;display:flex;align-items:center;justify-content:center;min-height:220px';photo.innerHTML=`<img src="${base}${file}" alt="Cal Spas Platinum Legend ${name}" style="display:block;width:100%;height:220px;object-fit:contain">`;mark.replaceWith(photo);});}
function apply(){applyThumbs();applyExplorer();}
apply();
const observer=new MutationObserver(()=>apply());
observer.observe(document.documentElement,{childList:true,subtree:true});
})();
