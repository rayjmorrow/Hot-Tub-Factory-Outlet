(()=>{
  const key=new URLSearchParams(location.search).get('brand');
  if(!['eco-spas','innova-spas'].includes(key))return;
  const pages={
    'eco-spas':{
      name:'Eco Spas',tag:'Simple. Affordable. Durable.',lede:'Eco Spas focuses on uncomplicated ownership: rotationally molded construction, straightforward hydrotherapy and the integrated Original Hard Cover Spa® concept in a lineup built to be easy to live with.',chips:['Original Hard Cover Spa®','Rotationally molded construction','110V / 220V options','E1 through E6'],
      features:[
        ['The Original Hard Cover Spa®','A rigid, integrated hard-cover system is the defining Eco Spas idea — designed to make covering the spa quick while creating a durable barrier over the water.','Hard-cover simplicity'],
        ['One-piece durability','Rotationally molded construction creates a tough, low-maintenance spa body without conventional exterior cabinet materials.','Built for everyday ownership'],
        ['Simple power choices','Depending on model and configuration, the lineup includes convenient plug-and-play choices as well as higher-performance 240V operation.','Flexible installation']
      ],
      series:[['E1 & E2','Compact choices for couples, smaller patios and buyers who want the simplest path into hot-tub ownership.'],['E3, E4 & E5','Midsize layouts that add seating flexibility while keeping the Eco Spas ownership philosophy intact.'],['E6','The roomier family/social option with more space for people who want to share the spa.']],
      url:'https://ecospas.com/'
    },
    'innova-spas':{
      name:'Innova Spas',tag:'Comfort within reach of all.',lede:'Innova Spas builds portable, one-piece polyethylene spas around comfort, simple installation and practical ownership — with models that emphasize different seating and massage experiences.',chips:['One-piece polyethylene','120V convertible models','All-season insulation','Portable & serviceable'],
      features:[
        ['Triangulation Massage','Innova varies jet spacing and placement from seat to seat so different positions deliver different massage patterns instead of repeating the same feel everywhere.','Massage variety'],
        ['Plug & Play Convenience','Models such as Storm and Fantom can operate from a standard 120V connection and can be converted to 240V when faster heating performance is preferred.','Easy way to get started'],
        ['Built for Practical Ownership','One-piece polyethylene construction, broad equipment access and reusable insulation are designed to make placement and future service less complicated.','Simple to own & service']
      ],
      series:[['Stream','A roomy five-seat layout with multiple massage positions, lounge-style seating and a large footwell.'],['Fantom','Contemporary four-to-five-person seating with a full-body lounger, waterfall and 20 adjustable stainless-steel jets.'],['Storm','A five-to-six-person layout with 20 adjustable jets, lounge capability and flexible 120V-to-240V power.']],
      url:'https://innovaspa.com/en_us/product-category/spas-en_us'
    }
  };
  const x=pages[key];
  document.title=`${x.name} | Hot Tub Factory Outlet`;
  const featureCards=x.features.map((f,i)=>`<article class="visual-feature value-feature"><div class="value-art"><span class="value-number">${String(i+1).padStart(2,'0')}</span><span class="eyebrow">${x.name}</span><strong>${f[2]}</strong><small>HTFO brand guide</small></div><div class="feature-copy"><span class="eyebrow">${String(i+1).padStart(2,'0')} · ${x.name}</span><h3>${f[0]}</h3><p>${f[1]}</p><a href="${x.url}" target="_blank" rel="noopener">Explore ${x.name} manufacturer information →</a></div></article>`).join('');
  document.querySelector('#app').innerHTML=`
    <section class="hero value-brand-hero"><div><span class="eyebrow">Hot Tub Factory Outlet · Pittsburgh</span><h1>${x.name}</h1><p class="tagline">${x.tag}</p><p class="lede">${x.lede}</p><div class="actions" style="margin-top:28px"><a class="btn primary" href="index.html#specials">See This Week's Special</a><a class="btn secondary" href="hot-tubs.html">Shop ${x.name} Models</a></div><a class="text-link" href="${x.url}" target="_blank" rel="noopener">Visit ${x.name} manufacturer site ↗</a></div><div class="hero-card value-hero-card"><span class="eyebrow">Why it earns a place at HTFO</span><h3>${key==='eco-spas'?'Straightforward ownership without unnecessary complexity.':'Portable construction with thoughtful massage and seating.'}</h3><p>${key==='eco-spas'?'Eco Spas is the conversation for shoppers who value durability, integrated cover convenience and a simpler ownership experience.':'Innova fits shoppers who want a portable, practical spa with distinctive seating choices and easy installation.'}</p></div></section>
    <section class="section alt"><div class="head"><span class="eyebrow">At a glance</span><h2>Why ${x.name} belongs on your shortlist.</h2></div><div class="chips">${x.chips.map(c=>`<span class="chip">${c}</span>`).join('')}</div></section>
    <section class="section"><div class="head"><span class="eyebrow">Signature features</span><h2>What makes ${x.name} different.</h2><p>These are the ideas worth understanding before you start comparing individual model numbers.</p></div><div class="visual-features">${featureCards}</div></section>
    <section class="section alt"><div class="head"><span class="eyebrow">Where to start</span><h2>Choose the model family that fits you.</h2></div><div class="series">${x.series.map(s=>`<article class="series-card"><small>${x.name}</small><h3>${s[0]}</h3><p>${s[1]}</p></article>`).join('')}</div></section>
    <section class="cta-band"><h2>Ready to compare one in person?</h2><div class="actions"><a class="btn primary" href="hot-tubs.html">Shop Hot Tubs</a><a class="btn secondary" href="spa-quiz.html">Let Bubbles Help Me Choose</a></div></section>`;
  const style=document.createElement('style');
  style.textContent=`.value-brand-hero{background:linear-gradient(135deg,#eef7fb,#fff 58%,#f5f2ec)}.value-hero-card{border-top:5px solid var(--blue)}.value-art{min-height:360px;background:linear-gradient(145deg,#082642,#0b79b7);color:#fff;display:flex;flex-direction:column;justify-content:center;padding:48px;position:relative;overflow:hidden}.value-art:after{content:'';position:absolute;width:260px;height:260px;border:34px solid rgba(255,255,255,.08);border-radius:50%;right:-70px;bottom:-90px}.value-art .eyebrow{color:#8ed8f5}.value-art strong{font-family:Georgia,'Times New Roman',serif;font-size:42px;line-height:1.05;font-weight:500;max-width:430px;margin:12px 0}.value-art small{color:#b9d8e8;font-weight:750}.value-number{font-size:70px;font-weight:950;color:rgba(255,255,255,.10);position:absolute;top:24px;right:30px}.value-feature:nth-child(even) .value-art{order:2;background:linear-gradient(145deg,#0b79b7,#16465f)}@media(max-width:900px){.value-feature:nth-child(even) .value-art{order:0}.value-art{min-height:280px;padding:34px}.value-art strong{font-size:34px}}`;
  document.head.appendChild(style);
})();