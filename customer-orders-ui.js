(()=>{
  const originalLoadCustomer=loadCustomer;
  const moneySafe=n=>Number(n||0).toLocaleString('en-US',{style:'currency',currency:'USD'});
  const dateSafe=v=>v?new Date(String(v).length===10?v+'T12:00:00':v).toLocaleDateString():'—';
  const fullRoles=['admin','owner','manager','service_manager'];
  let currentRole='';
  const canFullOps=()=>fullRoles.includes(String(currentRole||'').toLowerCase());
  const style=document.createElement('style');
  style.textContent=`.customer-orders{margin:1rem 0}.customer-orders .order-grid{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}.customer-orders .order-card{border:1px solid #dfe5ec;border-radius:10px;padding:.8rem;background:#fff}.customer-orders .order-item{display:grid;grid-template-columns:1fr auto;gap:.5rem;padding:.45rem 0;border-bottom:1px solid #edf1f5}.customer-orders .order-item:last-child{border-bottom:0}.customer-orders .scope{font-size:.76rem;font-weight:800}.customer-orders .scope.recurring{color:#166534}.customer-orders .scope.one{color:#475467}.customer-orders .change-row{border-left:3px solid #d0d5dd;padding:.3rem 0 .3rem .65rem;margin:.4rem 0}.customer-orders .perm-note{background:#f8fafc;border:1px solid #dfe5ec;border-radius:8px;padding:.55rem .7rem;margin:.55rem 0}@media(max-width:800px){.customer-orders .order-grid{grid-template-columns:1fr}}`;
  document.head.appendChild(style);

  loadCustomer=async function(id){await originalLoadCustomer(id);try{const me=await api('/me');currentRole=me?.user?.role||'';await renderOrders(id)}catch(e){console.warn('Customer orders unavailable',e)}};

  async function renderOrders(customerId){
    const detail=$('#customerDetail');if(!detail)return;
    const x=await api(`/customers/${customerId}/orders`);
    const panel=document.createElement('div');panel.className='card customer-orders';
    const upcoming=(x.orders||[]).filter(o=>!['shipped','cancelled'].includes(o.status));
    const past=(x.orders||[]).filter(o=>['shipped','cancelled'].includes(o.status));
    panel.innerHTML=`<div class="row between wrap"><div><h3 style="margin:.1rem 0">Orders & Auto-Ship</h3><div class="muted">Scheduled online orders, past shipments and recurring shipment settings.</div></div>${canFullOps()?'<button class="secondary" id="newAutoship">+ Auto-Ship</button>':''}</div>
      <div class="perm-note">${canFullOps()?'<b>Manager access:</b> You can edit shipment settings, auto-ship, prices and approved discount codes.':'<b>Staff access:</b> You can add approved products and apply preset discount codes. Manual price discounts are not permitted.'}</div>
      <div class="value-tabs"><button class="value-tab active" data-order-tab="upcoming">Upcoming Orders (${upcoming.length})</button><button class="value-tab" data-order-tab="autoship">Auto-Ship (${(x.recurringOrders||[]).length})</button><button class="value-tab" data-order-tab="past">Past Orders (${past.length})</button><button class="value-tab" data-order-tab="changes">Change History</button></div>
      <div id="ordersUpcoming"></div><div id="ordersAutoship" hidden></div><div id="ordersPast" hidden></div><div id="ordersChanges" hidden></div>`;
    detail.appendChild(panel);
    $('#ordersUpcoming').innerHTML=upcoming.map(o=>orderCard(o,x.recurringOrders||[])).join('')||'<p class="muted">No upcoming online orders.</p>';
    $('#ordersPast').innerHTML=past.map(o=>orderCard(o,x.recurringOrders||[],true)).join('')||'<p class="muted">No past online orders yet.</p>';
    $('#ordersAutoship').innerHTML=(x.recurringOrders||[]).map(s=>autoshipCard(s)).join('')||'<p class="muted">No auto-ship plan on this customer.</p>';
    $('#ordersChanges').innerHTML=(x.changes||[]).map(c=>`<div class="change-row"><b>${dateSafe(c.created_at)} · ${esc(c.action.replaceAll('_',' '))}</b><div>${esc(c.description)}</div><div class="muted">${esc(c.actor||'System')}</div></div>`).join('')||'<p class="muted">No order changes yet.</p>';
    $$('[data-order-tab]').forEach(b=>b.onclick=()=>{const tab=b.dataset.orderTab;$$('[data-order-tab]').forEach(x=>x.classList.toggle('active',x===b));$('#ordersUpcoming').hidden=tab!=='upcoming';$('#ordersAutoship').hidden=tab!=='autoship';$('#ordersPast').hidden=tab!=='past';$('#ordersChanges').hidden=tab!=='changes'});
    bindOrderButtons(customerId,x);
  }

  function orderCard(o,subs,readOnly=false){
    const linked=subs.find(s=>String(s.id)===String(o.recurring_order_id));
    return `<div class="order-card"><div class="row between wrap"><div><b>${esc(o.order_number||`Order #${o.id}`)}</b><div>${o.scheduled_ship_date?`Ships ${dateSafe(o.scheduled_ship_date)}`:'No ship date'} · <span class="pill">${esc(o.status)}</span></div></div><b>${moneySafe(o.total_amount)}</b></div>${linked?`<div class="muted">Generated from auto-ship · every ${linked.frequency_value} ${esc(linked.frequency_unit)}</div>`:''}<div>${(o.items||[]).map(i=>`<div class="order-item"><div><b>${Number(i.quantity)} × ${esc(i.description)}</b><div class="muted">${esc(i.sku||'No SKU')} · ${moneySafe(i.unit_price)} each · <span class="scope ${i.item_scope==='recurring'?'recurring':'one'}">${i.item_scope==='recurring'?'Recurring':'This shipment only'}</span></div></div><div>${moneySafe(i.line_total)}${readOnly?'':`<br><button class="secondary" style="padding:.3rem .5rem" data-edit-order-item="${i.id}" data-order-id="${o.id}">Edit Qty</button>`}</div></div>`).join('')||'<p class="muted">No items.</p>'}</div>${readOnly?'':`<div class="row wrap" style="margin-top:.7rem"><button class="primary" data-add-order-item="${o.id}">+ Add Product</button><button class="secondary" data-discount-code="${o.id}">Apply Discount Code</button>${canFullOps()?`<button class="secondary" data-edit-order="${o.id}">Edit Shipment</button>`:''}</div>`}</div>`;
  }
  function autoshipCard(s){return `<div class="order-card"><div class="row between wrap"><div><b>Auto-Ship #${s.id}</b><div><span class="pill">${esc(s.status)}</span> · Every ${s.frequency_value} ${esc(s.frequency_unit)} · Next ${dateSafe(s.next_ship_date)}</div></div>${canFullOps()?`<button class="secondary" data-edit-autoship="${s.id}">Edit Auto-Ship</button>`:''}</div>${(s.items||[]).map(i=>`<div class="order-item"><div><b>${Number(i.quantity)} × ${esc(i.description)}</b><div class="muted">${esc(i.sku||'No SKU')} · ${moneySafe(i.unit_price)} each</div></div><b>${moneySafe(Number(i.quantity)*Number(i.unit_price))}</b></div>`).join('')||'<p class="muted">No recurring items.</p>'}</div>`}

  async function chooseCatalogProduct(){
    const term=prompt('Search approved product / SKU:','');if(term===null)return null;
    const rows=await api('/order-product-catalog?q='+encodeURIComponent(term));
    if(!rows.length){alert('No approved product found in the order pricebook. Ray or Rick can add it to the pricebook first.');return null}
    const menu=rows.slice(0,10).map((p,i)=>`${i+1}. ${p.description} · ${p.sku||'No SKU'} · ${moneySafe(p.unit_price)}`).join('\n');
    const pick=Number(prompt(`Choose product number:\n\n${menu}`,'1')||0);return rows[pick-1]||null;
  }

  function bindOrderButtons(customerId,x){
    $$('[data-add-order-item]').forEach(b=>b.onclick=async()=>{
      const orderId=b.dataset.addOrderItem,order=(x.orders||[]).find(o=>String(o.id)===String(orderId));
      let product;try{product=await chooseCatalogProduct()}catch(e){return alert(e.message)}if(!product)return;
      const quantity=Math.max(.01,Number(prompt('Quantity:','1')||1));
      const recurring=confirm('Add this product to FUTURE AUTO-SHIPMENTS too?\n\nOK = recurring\nCancel = this shipment only');
      let recurringOrderId=order?.recurring_order_id||null;
      if(recurring&&!recurringOrderId){const active=(x.recurringOrders||[]).find(s=>s.status==='active');if(active)recurringOrderId=active.id;else return alert('This customer does not have an active auto-ship yet. Ray or Rick can create one, or add this item to this shipment only.')}
      try{await api(`/orders/${orderId}/add-item`,{method:'POST',body:JSON.stringify({catalog_id:product.id,quantity,scope:recurring?'recurring':'one_time',recurring_order_id:recurringOrderId})});await loadCustomer(customerId)}catch(e){alert(e.message)}
    });
    $$('[data-discount-code]').forEach(b=>b.onclick=async()=>{
      const code=prompt('Approved discount code:','');if(!code)return;
      try{await api(`/orders/${b.dataset.discountCode}/apply-discount-code`,{method:'POST',body:JSON.stringify({code})});await loadCustomer(customerId)}catch(e){alert(e.message)}
    });
    $$('[data-edit-order-item]').forEach(b=>b.onclick=async()=>{
      const o=(x.orders||[]).find(v=>String(v.id)===b.dataset.orderId),i=o?.items?.find(v=>String(v.id)===b.dataset.editOrderItem);if(!i)return;
      const quantity=Math.max(.01,Number(prompt('Quantity:',i.quantity)||i.quantity));
      let updateRecurring=false;if(i.recurring_order_item_id)updateRecurring=confirm('Apply quantity change to FUTURE AUTO-SHIPMENTS too?\n\nOK = future shipments too\nCancel = this shipment only');
      const body={quantity,update_recurring:updateRecurring};
      if(canFullOps()){const price=prompt('Unit price (manager override allowed):',i.unit_price);if(price!==null&&price!=='')body.unit_price=Math.max(0,Number(price)||0)}
      try{await api(`/orders/${o.id}/items/${i.id}`,{method:'PATCH',body:JSON.stringify(body)});await loadCustomer(customerId)}catch(e){alert(e.message)}
    });
    if(canFullOps()){
      $$('[data-edit-order]').forEach(b=>b.onclick=async()=>{const o=(x.orders||[]).find(v=>String(v.id)===b.dataset.editOrder);if(!o)return;const ship=prompt('Scheduled ship date (YYYY-MM-DD):',o.scheduled_ship_date||'')??o.scheduled_ship_date;const status=prompt('Status (scheduled, processing, held, cancelled):',o.status)||o.status;try{await api(`/orders/${o.id}`,{method:'PATCH',body:JSON.stringify({scheduled_ship_date:ship,status})});await loadCustomer(customerId)}catch(e){alert(e.message)}});
      $$('[data-edit-autoship]').forEach(b=>b.onclick=async()=>{const s=(x.recurringOrders||[]).find(v=>String(v.id)===b.dataset.editAutoship);if(!s)return;const status=prompt('Auto-ship status (active, paused, cancelled):',s.status)||s.status;const frequency=Math.max(1,Number(prompt(`Frequency in ${s.frequency_unit}:`,s.frequency_value)||s.frequency_value));const next=prompt('Next ship date (YYYY-MM-DD):',s.next_ship_date||'')??s.next_ship_date;try{await api(`/recurring-orders/${s.id}`,{method:'PATCH',body:JSON.stringify({status,frequency_value:frequency,frequency_unit:s.frequency_unit,next_ship_date:next})});await loadCustomer(customerId)}catch(e){alert(e.message)}});
      if($('#newAutoship'))$('#newAutoship').onclick=async()=>{const frequency=Math.max(1,Number(prompt('How many days between shipments?','60')||60));const next=prompt('Next ship date (YYYY-MM-DD):','');if(!next)return;try{await api(`/customers/${customerId}/recurring-orders`,{method:'POST',body:JSON.stringify({frequency_value:frequency,frequency_unit:'days',next_ship_date:next,status:'active'})});await loadCustomer(customerId)}catch(e){alert(e.message)}};
    }
  }
})();