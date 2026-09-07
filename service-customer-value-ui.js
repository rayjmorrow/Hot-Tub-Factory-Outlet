(()=>{
  const originalLoadCustomer=loadCustomer;
  const moneySafe=n=>Number(n||0).toLocaleString('en-US',{style:'currency',currency:'USD'});
  const dateSafe=v=>v?new Date(v).toLocaleDateString():'—';
  const style=document.createElement('style');
  style.textContent=`.customer-value{margin:1rem 0}.customer-value .value-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.65rem}.customer-value .value-stat{background:#f8fafc;border:1px solid #dfe5ec;border-radius:10px;padding:.75rem}.customer-value .value-stat b{display:block;font-size:1.2rem}.customer-value .value-tabs{display:flex;gap:.45rem;flex-wrap:wrap;margin:.8rem 0}.customer-value .value-tab{background:#eef3f8;color:#17202a;border:0;border-radius:999px;padding:.45rem .7rem}.customer-value .value-tab.active{background:#0b5cab;color:white}.customer-value .timeline-row{border-left:3px solid #c7d4df;padding:.35rem 0 .35rem .75rem;margin:.5rem 0}.customer-value .relationship{font-weight:800}.customer-value .relationship.strong{color:#16733c}@media(max-width:850px){.customer-value .value-stats{grid-template-columns:1fr 1fr}}@media(max-width:520px){.customer-value .value-stats{grid-template-columns:1fr}}`;
  document.head.appendChild(style);

  loadCustomer=async function(id){
    await originalLoadCustomer(id);
    try{await renderValueHistory(id)}catch(e){console.warn('Customer value history unavailable',e)}
  };

  async function renderValueHistory(customerId){
    const detail=$('#customerDetail');if(!detail)return;
    const x=await api(`/customers/${customerId}/value-history`),s=x.summary||{};
    const panel=document.createElement('div');panel.className='card customer-value';
    const relClass=/Strong|Active|Repeat/.test(s.relationship||'')?'strong':'';
    panel.innerHTML=`<div class="row between wrap"><div><h3 style="margin:.1rem 0">Customer Value & History</h3><div class="relationship ${relClass}">${esc(s.relationship||'Customer')}</div></div><button class="secondary" id="addRetailTxn">+ Add Purchase</button></div>
      <div class="value-stats">
        <div class="value-stat"><span class="muted">Lifetime Retail</span><b>${moneySafe(s.lifetime_retail)}</b></div>
        <div class="value-stat"><span class="muted">Lifetime Service</span><b>${moneySafe(s.lifetime_service)}</b></div>
        <div class="value-stat"><span class="muted">Chemicals · 12 mo</span><b>${moneySafe(s.chemical_12_months)}</b></div>
        <div class="value-stat"><span class="muted">Total Relationship</span><b>${moneySafe(s.lifetime_total)}</b></div>
        <div class="value-stat"><span class="muted">Products Owned</span><b>${Number(s.products_owned||0)}</b></div>
        <div class="value-stat"><span class="muted">Service Calls</span><b>${Number(s.service_calls||0)}</b></div>
        <div class="value-stat"><span class="muted">Last Retail Purchase</span><b>${dateSafe(s.last_retail_purchase)}</b></div>
        <div class="value-stat"><span class="muted">Last Chemical Purchase</span><b>${dateSafe(s.last_chemical_purchase)}</b></div>
      </div>
      <div class="value-tabs"><button class="value-tab active" data-value-tab="timeline">Timeline</button><button class="value-tab" data-value-tab="purchases">Purchase History</button><button class="value-tab" data-value-tab="service">Service History</button></div>
      <div id="valueTimeline"></div><div id="valuePurchases" hidden></div><div id="valueService" hidden></div>`;
    detail.appendChild(panel);
    $('#valueTimeline').innerHTML=(x.timeline||[]).map(t=>`<div class="timeline-row"><div class="row between wrap"><b>${dateSafe(t.date)} · ${esc(t.title||'Activity')}</b>${t.amount!=null?`<b>${moneySafe(t.amount)}</b>`:''}</div><div>${esc(t.detail||'')}</div>${t.status?`<span class="pill">${esc(t.status)}</span>`:''}</div>`).join('')||'<p class="muted">No history yet.</p>';
    $('#valuePurchases').innerHTML=(x.retail||[]).map(r=>`<div class="item"><div class="row between wrap"><div><b>${dateSafe(r.transaction_date)} · ${esc(r.description)}</b><div class="muted">${esc([r.category,r.brand,r.model,r.transaction_number].filter(Boolean).join(' · '))}</div></div><b>${moneySafe(r.total_amount)}</b></div>${r.salesperson?`<div class="muted">Salesperson: ${esc(r.salesperson)}</div>`:''}</div>`).join('')||'<p class="muted">No retail purchases imported yet.</p>';
    $('#valueService').innerHTML=(x.serviceCalls||[]).map(w=>`<div class="item"><div class="row between wrap"><b>${dateSafe(w.scheduled_start||w.created_at)} · ${esc(w.work_order_number)}</b><span class="pill">${esc(w.status)}</span></div><div>${esc([w.equipment_type,w.brand,w.model,w.serial_number].filter(Boolean).join(' · '))}</div><div>${esc(w.complaint||'')}</div>${w.diagnosis?`<div class="muted">Diagnosis: ${esc(w.diagnosis)}</div>`:''}${w.work_performed?`<div class="muted">Work: ${esc(w.work_performed)}</div>`:''}</div>`).join('')||'<p class="muted">No service calls yet.</p>';
    $$('[data-value-tab]').forEach(b=>b.onclick=()=>{const tab=b.dataset.valueTab;$$('[data-value-tab]').forEach(x=>x.classList.toggle('active',x===b));$('#valueTimeline').hidden=tab!=='timeline';$('#valuePurchases').hidden=tab!=='purchases';$('#valueService').hidden=tab!=='service'});
    $('#addRetailTxn').onclick=async()=>{
      const description=prompt('Purchase description (example: Caribbean Blue chemicals, filter set, spa cover):','');if(!description)return;
      const category=prompt('Category (chemicals, filter, cover, accessory, hot tub, sauna, grill, other):','chemicals')||'retail';
      const amount=Number(prompt('Total sale amount:','0')||0);if(amount<0)return;
      try{await api(`/customers/${customerId}/retail-transactions`,{method:'POST',body:JSON.stringify({description,category,total_amount:amount,subtotal:amount,source:'manual'})});await loadCustomer(customerId)}catch(e){alert(e.message)}
    };
  }
})();