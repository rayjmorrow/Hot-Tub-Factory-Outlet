(()=>{
const models={
  Crown:{thumb:'assets/crown-thumb.jpg',detail:'assets/crown-detail.jpg'},
  Monarch:{thumb:'assets/monarch-thumb.jpg',detail:'assets/monarch-detail.jpg'},
  Royal:{thumb:'assets/royal-thumb.jpg',detail:'assets/royal-detail.jpg'},
  Legacy:{thumb:'assets/legacy-thumb.jpg',detail:'assets/legacy-detail.jpg'}
};
function modelNameFromRow(row){const n=row&&row.querySelector('.modelname');return n?n.textContent.trim():''}
function applyThumbs(root=document){root.querySelectorAll('.row').forEach(row=>{const name=modelNameFromRow(row),cfg=models[name];if(!cfg)return;const thumb=row.querySelector('.thumb');if(!thumb)return;thumb.dataset.legendImage='1';thumb.removeAttribute('style');thumb.classList.remove('fallback');thumb.innerHTML=`<img src="${cfg.thumb}" alt="Cal Spas Platinum Legend ${name}" style="width:100%;height:100%;object-fit:cover;background:#fff" onerror="this.onerror=null;this.parentElement.innerHTML='<span style=&quot;font-weight:900;color:#082642;font-size:12px&quot;>${name}</span>'">`;});}
function applyExplorer(root=document){root.querySelectorAll('.legend-hero').forEach(hero=>{const title=hero.querySelector('h2');const name=title?title.textContent.trim():'';const cfg=models[name];if(!cfg)return;let photo=hero.querySelector('.legend-photo');if(!photo){const mark=hero.querySelector('.legend-mark');if(!mark)return;photo=document.createElement('div');photo.className='legend-photo';photo.style.cssText='background:#fff;border:1px solid #dce7ed;border-radius:20px;padding:10px;box-shadow:0 12px 32px #08264222;display:flex;align-items:center;justify-content:center;min-height:240px';mark.replaceWith(photo);}photo.innerHTML=`<img src="${cfg.detail}" alt="Cal Spas Platinum Legend ${name}" style="display:block;width:100%;max-height:520px;object-fit:contain">`;hero.dataset.legendImage='1';});}
function apply(){applyThumbs();applyExplorer();}
apply();
const observer=new MutationObserver(apply);
observer.observe(document.documentElement,{childList:true,subtree:true});
})();
