(()=>{
  const key=new URLSearchParams(location.search).get('brand');
  if(key!=='aquasolus') return;
  const app=document.querySelector('#app');
  if(!app) return;
  document.title='AquaSolus | Hot Tub Factory Outlet';
  app.innerHTML=`
    <section class="hero">
      <div>
        <span class="eyebrow">Hot Tub Factory Outlet · Pittsburgh</span>
        <h1>AquaSolus</h1>
        <p class="tagline">The Ultimate Wellness Experience.</p>
        <p class="lede">AquaSolus pairs contemporary styling with ergonomic comfort, hydrotherapy, premium audio and easy-to-understand collections. It is a strong choice for shoppers who want a modern wellness spa without getting buried in confusing model families.</p>
        <div class="actions" style="margin-top:28px">
          <a class="btn primary" href="index.html#specials">See This Week's Special</a>
          <a class="btn secondary" href="hot-tubs.html">Shop AquaSolus Models</a>
        </div>
        <a class="text-link" href="https://aquasolus.com/us/hot-tubs/" target="_blank" rel="noopener">Explore the complete AquaSolus collection ↗</a>
      </div>
      <div class="brand-hero-photo">
        <img src="assets/aquasolus-comfort.svg" alt="AquaSolus contemporary wellness hot tub">
        <div class="brand-hero-badge"><span>AquaSolus at HTFO</span><b>Modern wellness · thoughtful hydrotherapy</b></div>
      </div>
    </section>

    <section class="section alt">
      <div class="head"><span class="eyebrow">At a glance</span><h2>Why AquaSolus belongs on your shortlist.</h2><p>The lineup is organized around three clear steps, from accessible AquaPure models through the more advanced AquaLux collection.</p></div>
      <div class="chips"><span class="chip">AquaPure · Series One</span><span class="chip">NaturaBalance · Series Two</span><span class="chip">AquaLux · Series Three</span><span class="chip">Gecko controls</span><span class="chip">Premium audio</span><span class="chip">LED lighting</span></div>
    </section>

    <section class="section">
      <div class="head"><span class="eyebrow">Signature features</span><h2>Designed around comfort, water and wellness.</h2><p>AquaSolus keeps the feature story approachable: comfortable seating, purposeful massage, easy water care and the atmosphere that makes the spa feel like a retreat.</p></div>
      <div class="visual-features">
        <article class="visual-feature">
          <div class="feature-art product-photo"><img src="assets/aquasolus-comfort.svg" alt="AquaSolus ergonomic seating and hydrotherapy"><div class="photo-caption">AquaSolus · ergonomic comfort and hydrotherapy</div></div>
          <div class="feature-copy"><span class="eyebrow">01 · AQUASOLUS</span><h3>Ergonomic Comfort & Hydrotherapy</h3><p>Sculpted seating, supportive headrests and multiple jet sizes are designed to deliver both targeted massage and a comfortable place to stay awhile. Series Two and Series Three step up the intensity and control for shoppers who prioritize therapy.</p><a href="https://aquasolus.com/us/hot-tubs/aspen-hot-tub/" target="_blank" rel="noopener">See AquaSolus hydrotherapy in the Aspen →</a></div>
        </article>
        <article class="visual-feature">
          <div class="feature-art product-photo"><img src="assets/aquasolus-watercare.svg" alt="AquaSolus easy water care"><div class="photo-caption">AquaSolus · simplified water care</div></div>
          <div class="feature-copy"><span class="eyebrow">02 · AQUASOLUS</span><h3>Easy Water Care</h3><p>Dedicated circulation, filtration and ozone-based water management help keep water moving and make routine ownership more manageable. The goal is simple: spend less time thinking about the equipment and more time enjoying the spa.</p><a href="https://aquasolus.com/us/hot-tubs/brook-hot-tub/" target="_blank" rel="noopener">See the AquaPure Brook →</a></div>
        </article>
        <article class="visual-feature">
          <div class="feature-art product-photo"><img src="assets/aquasolus-audio.svg" alt="AquaSolus premium audio and lighting"><div class="photo-caption">AquaSolus · premium audio, lighting and ambience</div></div>
          <div class="feature-copy"><span class="eyebrow">03 · AQUASOLUS</span><h3>Lighting, Water Features & Premium Audio</h3><p>LED lighting, the Infinity Waterfall Fountain on current collections and integrated audio turn the hot tub into more than a massage machine. AquaSolus puts a lot of emphasis on the overall atmosphere of the soak.</p><a href="https://aquasolus.com/us/hot-tubs/zenith-hot-tub/" target="_blank" rel="noopener">See the AquaLux Zenith →</a></div>
        </article>
      </div>
    </section>

    <section class="section alt">
      <div class="head"><span class="eyebrow">Where to start</span><h2>Three collections. Three clear steps.</h2><p>Instead of sorting through dozens of nearly identical names, start with the collection that fits the experience you want.</p></div>
      <div class="series">
        <article class="series-card"><small>AquaSolus · Series One</small><h3>AquaPure</h3><p>Brook, Zephyr, Cove and Cypress bring AquaSolus styling and comfort at the most approachable point in the line, with current U.S. models offering practical 120V/240V choices.</p></article>
        <article class="series-card"><small>AquaSolus · Series Two</small><h3>NaturaBalance</h3><p>Sierra, Harmony, Eden, Aspen and Calma step up massage power, equipment and premium touches for customers who want stronger hydrotherapy.</p></article>
        <article class="series-card"><small>AquaSolus · Series Three</small><h3>AquaLux</h3><p>Cascade, Serenity, Solstice and Zenith form the premium end of the lineup with larger formats, advanced controls and the most complete wellness experience.</p></article>
      </div>
    </section>

    <section class="section">
      <div class="heritage"><div class="mark">AquaSolus</div><div><span class="eyebrow" style="color:#78c8ec">Health Through Water</span><h3>Part of the Superior Wellness portfolio</h3><p>AquaSolus is built around a wellness-first approach to hot water, combining contemporary design, hydrotherapy and an intentionally simplified product lineup.</p></div></div>
    </section>

    <section class="cta-band"><h2>Ready to sit in an AquaSolus?</h2><div class="actions"><a class="btn primary" href="hot-tubs.html">Shop AquaSolus Models</a><a class="btn secondary" href="spa-quiz.html">Let Bubbles Help Me Choose</a></div></section>`;
})();
