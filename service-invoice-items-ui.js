(()=>{
  let activeWoId=null,renderToken=0;
  const style=document.createElement('style');
  style.textContent=`.invoice-items-panel{margin-top:1rem}.invoice-item-row{display:grid;grid-template-columns:1fr auto auto;gap:.65rem;align-items:center;padding:.55rem 0;border-bottom:1px solid #e6ebf0}.invoice-item-row:last-child{border-bottom:0}.invoice-search-results{max-height:260px;overflow:auto;border:1px solid #dfe5ec;border-radius:10px;margin-top:.5rem}.invoice-search-result{width:100%;text-align:left;background:#fff;border:0;border-bottom:1px solid #e6ebf0;padding:.7rem}.invoice-search-result:last-child{border-bottom:0}.discount-row{background:#fff7ed}.invoice-totals{margin-top:.75rem}.discount-note{font-size:.82rem;color:#66717d}`;
  document.head.appendChild(style);
  document.addEventListener('click',e=>{const b=e.target.closest('[data-ops-wo]');if(b)activeWoId=b.dataset.opsWo},true);

  async function inject(){
    const host=document.querySelector('#opsWoDetail');
    if(!host||!activeWoId||host.querySelector('.invoice-items-panel'))return;
    const token=++renderToken;
    try{
      const x=await api(`/work-orders/${activeWoId}/invoice-items`);if(token!==renderToken)return;
      const panel=document.createElement('div');panel.className='card invoice-items-panel';
      panel.innerHTML=`<div class="row between wrap"><div><h3 style="margin:.1rem 0">Invoice Items</h3><div class="muted">Add actual parts used. Discounts require authorized charge-manager approval and a reason.</div></div><button class="secondary" id="invoiceAddPartBtn">+ Add Part</button></div><div id="invoiceItemRows"></div><div id="invoicePartSearch" hidden><div class="row wrap" style="margin-top:.75rem"><input id="invoicePartQuery" placeholder="Search part number or description…" style="flex:1;min-width:240px"><button id="invoicePartGo">Search</button></div><div id="invoicePartResults" class="invoice-search-results"></div></div>${x.can_discount?`<div class="actionbar"><h4 style="margin-top:0">Manager Discount</h4><div class="row wrap"><select id="discountType"><option value="fixed">Dollar amount</option><option value="percent">Percent</option></select><select id="discountTarget"><option value="subtotal">Entire subtotal</option><option value="parts">Parts</option><option value="labor">Labor</option><option value="diagnostic">Diagnostic</option><option value="trip">Trip</option></select><input id="discountValue" type="number" min="0" step="0.01" placeholder="Amount / %"><input id="discountReason" placeholder="Required reason" style="flex:1;min-width:220px"><button id="discountApply">Apply Discount</button></div><div class="discount-note">Only configured HTFO charge managers can add or remove discounts.</div></div>`:''}<div id="invoiceTotals" class="invoice-totals"></div>`;
      host.appendChild(panel);renderRows(x);
      panel.querySelector('#invoiceAddPartBtn').onclick=()=>{const s=panel.querySelector('#invoicePartSearch');s.hidden=!s.hidden;if(!s.hidden)panel.querySelector('#invoicePartQuery').focus()};
      panel.querySelector('#invoicePartGo').onclick=searchParts;panel.querySelector('#invoicePartQuery').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();searchParts()}};
      if(x.can_discount)panel.querySelector('#discountApply').onclick=applyDiscount;
    }catch(e){console.warn('Invoice items unavailable',e)}
  }

  function renderRows(x){
    const panel=document.querySelector('.invoice-items-panel');if(!panel)return;
    const rows=panel.querySelector('#invoiceItemRows');
    rows.innerHTML=(x.items||[]).map(i=>`<div class="invoice-item-row"><div><b>${esc(i.description)}</b><div class="muted">${esc(i.sku||'')} · ${Number(i.quantity)} × ${money(i.unit_price)}${i.taxable?' · taxable':''}</div></div><b>${money(i.line_total)}</b><button class="secondary" data-remove-item="${i.id}">Remove</button></div>`).join('')||'<p class="muted">No parts added yet.</p>';
    (x.discounts||[]).forEach(d=>rows.insertAdjacentHTML('beforeend',`<div class="invoice-item-row discount-row"><div><b>Discount — ${esc(d.reason)}</b><div class="muted">${esc(d.applies_to)} · approved by ${esc(d.approved_by_name)}</div></div><b>-${money(d.amount)}</b>${x.can_discount?`<button class="secondary" data-remove-discount="${d.id}">Remove</button>`:'<span></span>'}</div>`));
    panel.querySelector('#invoiceTotals').innerHTML=`<div class="line"><span>Parts subtotal</span><b>${money(x.totals.parts_subtotal)}</b></div><div class="line"><span>Discounts</span><b>-${money(x.totals.discount_total)}</b></div><div class="line"><span>Parts tax</span><b>${money(x.totals.tax)}</b></div><div class="line"><strong>Invoice total</strong><strong>${money(x.totals.total)}</strong></div>`;
    panel.querySelectorAll('[data-remove-item]').forEach(b=>b.onclick=async()=>{if(!confirm('Remove this part from the work order?'))return;await api(`/work-orders/${activeWoId}/invoice-items/${b.dataset.removeItem}`,{method:'DELETE'});await refresh()});
    panel.querySelectorAll('[data-remove-discount]').forEach(b=>b.onclick=async()=>{if(!confirm('Remove this discount?'))return;await api(`/work-orders/${activeWoId}/discounts/${b.dataset.removeDiscount}`,{method:'DELETE'});await refresh()});
  }

  async function refresh(){const x=await api(`/work-orders/${activeWoId}/invoice-items`);renderRows(x)}
  async function searchParts(){const q=document.querySelector('#invoicePartQuery')?.value||'';const out=document.querySelector('#invoicePartResults');out.innerHTML='<div class="item">Searching…</div>';try{const parts=await api(`/parts?q=${encodeURIComponent(q)}`);out.innerHTML=parts.slice(0,30).map(p=>`<button class="invoice-search-result" data-part-id="${p.id}" data-part-price="${p.calculated_sell_price}"><b>${esc(p.description)}</b><div class="muted">${esc(p.manufacturer_part_number||p.supplier_part_number||'No part number')} · Sell ${money(p.calculated_sell_price)} · On hand ${Number(p.quantity_on_hand||0)}</div></button>`).join('')||'<div class="item">No matching parts.</div>';out.querySelectorAll('[data-part-id]').forEach(b=>b.onclick=()=>addPart(b.dataset.partId,b.dataset.partPrice))}catch(e){out.innerHTML=`<div class="error">${esc(e.message)}</div>`}}
  async function addPart(partId,price){const qty=Number(prompt('Quantity:',1)||0);if(qty<=0)return;try{await api(`/work-orders/${activeWoId}/invoice-items/part`,{method:'POST',body:JSON.stringify({part_id:partId,quantity:qty})});document.querySelector('#invoicePartSearch').hidden=true;await refresh()}catch(e){alert(e.message)}}
  async function applyDiscount(){const type=document.querySelector('#discountType').value,target=document.querySelector('#discountTarget').value,value=Number(document.querySelector('#discountValue').value||0),reason=document.querySelector('#discountReason').value.trim();if(value<=0)return alert('Enter a discount amount.');if(!reason)return alert('A reason is required.');if(!confirm(`Apply ${type==='percent'?value+'%':money(value)} discount to ${target}?`))return;try{await api(`/work-orders/${activeWoId}/discounts`,{method:'POST',body:JSON.stringify({discount_type:type,applies_to:target,value,reason})});document.querySelector('#discountValue').value='';document.querySelector('#discountReason').value='';await refresh()}catch(e){alert(e.message)}}

  const target=document.querySelector('#opsWoDetail');if(target)new MutationObserver(()=>setTimeout(inject,0)).observe(target,{childList:true,subtree:false});
})();