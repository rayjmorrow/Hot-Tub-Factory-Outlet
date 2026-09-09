(()=>{
  const models={
    Crown:{code:'PLL-873L',detail:'assets/crown-detail.jpg'},
    Monarch:{code:'PLL-873B',detail:'assets/monarch-detail.jpg'},
    Royal:{code:'PLL-773L',detail:'assets/royal-detail.jpg'},
    Legacy:{code:'PLL-773B',detail:'assets/legacy-detail.jpg'}
  };

  const style=document.createElement('style');
  style.textContent=`
    .legend-explorer-page{min-height:100%;padding:22px;background:#eef4f7;box-sizing:border-box}
    .legend-explorer-page-inner{width:min(920px,100%);margin:0 auto;background:#fff;border:1px solid #dce7ed;border-radius:16px;padding:14px;box-shadow:0 12px 32px rgba(8,38,66,.12)}
    .legend-explorer-page img{display:block;width:100%;height:auto;max-height:none;object-fit:contain;background:#fff}
    @media(max-width:760px){.legend-explorer-page{padding:8px}.legend-explorer-page-inner{padding:6px;border-radius:10px}}
  `;
  document.head.appendChild(style);

  function install(){
    if(!window.SpaExplorer||window.SpaExplorer.__legendPagesInstalled)return false;
    const originalOpen=window.SpaExplorer.open;
    window.SpaExplorer.open=function(brand,model){
      const cfg=brand==='Cal Spas'?models[model]:null;
      if(!cfg)return originalOpen(brand,model);

      originalOpen(brand,model);
      const el=document.getElementById('spaExplorer');
      if(!el)return;
      const wrap=el.querySelector('.spa-frame-wrap');
      const frame=el.querySelector('[data-frame]');
      const local=el.querySelector('[data-local]');
      const subtitle=el.querySelector('[data-subtitle]');
      if(!wrap||!frame||!local)return;

      wrap.classList.add('local-mode');
      frame.src='about:blank';
      local.innerHTML=`<div class="legend-explorer-page"><div class="legend-explorer-page-inner"><img src="${cfg.detail}" alt="Cal Spas Platinum Legend ${model} ${cfg.code} specifications"></div></div>`;
      if(subtitle)subtitle.textContent=`Platinum Legend · ${cfg.code} · brochure/specification page`;
    };
    window.SpaExplorer.__legendPagesInstalled=true;
    return true;
  }

  if(!install()){
    let tries=0;
    const timer=setInterval(()=>{if(install()||++tries>40)clearInterval(timer)},50);
  }
})();
