(()=>{
  const originalLoadCustomer=loadCustomer;
  const moneySafe=n=>Number(n||0).toLocaleString('en-US',{style:'currency',currency:'USD'});
  const dateSafe=v=>v?new Date(String(v).length===10?v+'T12:00:00':v).toLocaleDateString():'—';
  const style=document.createElement('style');
  style.textContent=`.customer-orders{margin:1rem 0}.customer-orders .order-grid{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}.customer-orders .order-card{border:1px solid #dfe5ec;border-radius:10px;padding:.8rem;background:#fff}.customer-orders .order-item{display:grid;grid-template-columns:1fr auto;gap:.5rem;padding:.45rem 0;border-bottom:1px solid #edf1f5}.customer-orders .order-item:last-child{border-bottom:0}.customer-orders .scope{font-size:.76rem;font-weight:800}.customer-orders .scope.recurring{color:#166534}.customer-orders .scope.one{color:#475467}.customer-orders .change-row{border-left:3px solid #d0d5dd;padding:.3rem 0 .3rem .65rem;margin:.4rem 0}@media(max-width:800px){.customer-orders .order-grid{grid-template-columns:1fr}}`;
  document.head.appendChild(style);

  loadCustomer=async function(id){await originalLoadCustomer(id);try{await renderOrders(id)}catch(e){console.warn('Customer orders unavailable',e)}};

  async function renderOrders(customerId){
    const detail=$('#customerDetail');if(!detail)return;
    const x=await api(`/customers/${customerId}/orders`);
    const panel=document.createElement('div');panel.className='card customer-orders';
    const upcoming=(x.orders||[]).filter(o=>!['shipped','cancelled'].includes(o.status));
    const past=(x.orders||[]).filter(o=>['shipped','cancelled'].includes(o.status));
    panel.innerHTML=`<div class="row between wrap"><div><h3 style="margin:.1rem 0">Orders & Auto-Ship</h3><div class="muted">See scheduled online orders, past shipments and recurring shipment settings from the customer record.</div></div><button class="secondary" id="newAutoship">+ Auto-Ship</button></div>
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
    return `<div class="order-card"><div class="row between wrap"><div><b>${esc(o.order_number||`Order #${o.id}`)}</b><div>${o.scheduled_ship_date?`Ships ${dateSafe(o.scheduled_ship_date)}`:'No ship date'} · <span class="pill">${esc(o.status)}</span></div></div><b>${moneySafe(o.total_amount)}</b></div>${linked?`<div class="muted">Generated from auto-ship · every ${linked.frequency_value} ${esc(linked.frequency_unit)}</div>`:''}<div>${(o.items||[]).map(i=>`<div class="order-item"><div><b>${Number(i.quantity)} × ${esc(i.description)}</b><div class="muted">${esc(i.sku||'No SKU')} · ${moneySafe(i.unit_price)} each · <span class="scope ${i.item_scope==='recurring'?'recurring':'one'}">${i.item_scope==='recurring'?'Recurring':'This shipment only'}</span></div></div><div>${moneySafe(i.line_total)}${readOnly?'':`<br><button class="secondary" style="padding:.3rem .5rem" data-edit-order-item="${i.id}" data-order-id="${o.id}">Edit</button>`}</div></div>`).join('')||'<p class="muted">No items.</p>'}</div>${readOnly?'':`<div class="row wrap" style="margin-top:.7rem"><button class="primary" data-add-order-item="${o.id}">+ Add Product</button><button class="secondary" data-edit-order="${o.id}">Edit Shipment</button></div>`}</div>`;
  }
  function autoshipCard(s){return `<div class="order-card"><div class="row between wrap"><div><b>Auto-Ship #${s.id}</b><div><span class="pill">${esc(s.status)}</span> · Every ${s.frequency_value} ${esc(s.frequency_unit)} · Next ${dateSafe(s.next_ship_date)}</div></div><button class="secondary" data-edit-autoship="${s.id}">Edit Auto-Ship</button></div>${(s.items||[]).map(i=>`<div class="order-item"><div><b>${Number(i.quantity)} × ${esc(i.description)}</b><div class="muted">${esc(i.sku||'No SKU')} · ${moneySafe(i.unit_price)} each</div></div><b>${moneySafe(Number(i.quantity)*Number(i.unit_price))}</b></div>`).join('')||'<p class="muted">No recurring items.</p>'}</div>`}

  function bindOrderButtons(customerId,x){
    $$('[data-add-order-item]').forEach(b=>b.onclick=async()=>{
      const orderId=b.dataset.addOrderItem,order=(x.orders||[]).find(o=>String(o.id)===String(orderId));
      const description=prompt('Product to add:','');if(!description)return;
      const sku=prompt('SKU (optional):','')||'';
      const quantity=Math.max(.01,Number(prompt('Quantity:','1')||1));
      const unitPrice=Math.max(0,Number(prompt('Unit price:','0')||0));
      const recurring=confirm('Add this product to FUTURE AUTO-SHIPMENTS too?\n\nOK = recurring\nCancel = this shipment only');
      let recurringOrderId=order?.recurring_order_id||null;
      if(recurring&&!recurringOrderId){const active=(x.recurringOrders||[]).find(s=>s.status==='active');if(active)recurringOrderId=active.id;else return alert('This customer does not have an active auto-ship yet. Create an auto-ship first, or add the item to this shipment only.')}
      try{await api(`/orders/${orderId}/add-item`,{method:'POST',body:JSON.stringify({description,sku,quantity,unit_price:unitPrice,scope:recurring?'recurring':'one_time',recurring_order_id:recurringOrderId})});await loadCustomer(customerId)}catch(e){alert(e.message)}
    });
    $$('[data-edit-order]').forEach(b=>b.onclick=async()=>{
      const o=(x.orders||[]).find(v=>String(v.id)===b.dataset.editOrder);if(!o)return;
      const ship=prompt('Scheduled ship date (YYYY-MM-DD):',o.scheduled_ship_date||'')??o.scheduled_ship_date;
      const status=prompt('Status (scheduled, processing, held, cancelled):',o.status)||o.status;
      try{await api(`/orders/${o.id}`,{method:'PATCH',body:JSON.stringify({scheduled_ship_date:ship,status})});await loadCustomer(customerId)}catch(e){alert(e.message)}
    });
    $$('[data-edit-order-item]').forEach(b=>b.onclick=async()=>{
      const o=(x.orders||[]).find(v=>String(v.id)===b.dataset.orderId),i=o?.items?.find(v=>String(v.id)===b.dataset.editOrderItem);if(!i)return;
      const quantity=Math.max(.01,Number(prompt('Quantity:',i.quantity)||i.quantity));
      const unitPrice=Math.max(0,Number(prompt('Unit price:',i.unit_price)||i.unit_price));
      let updateRecurring=false;if(i.recurring_order_item_id)updateRecurring=confirm('Apply this change to FUTURE AUTO-SHIPMENTS too?\n\nOK = future shipments too\nCancel = this shipment only');
      try{await api(`/orders/${o.id}/items/${i.id}`,{method:'PATCH',body:JSON.stringify({quantity,unit_price:unitPrice,update_recurring:updateRecurring})});await loadCustomer(customerId)}catch(e){alert(e.message)}
    });
    $$('[data-edit-autoship]').forEach(b=>b.onclick=async()=>{
      const s=(x.recurringOrders||[]).find(v=>String(v.id)===b.dataset.editAutoship);if(!s)return;
      const status=prompt('Auto-ship status (active, paused, cancelled):',s.status)||s.status;
      const frequency=Math.max(1,Number(prompt(`Frequency in ${s.frequency_unit}:`,s.frequency_value)||s.frequency_value));
      const next=prompt('Next ship date (YYYY-MM-DD):',s.next_ship_date||'')??s.next_ship_date;
      try{await api(`/recurring-orders/${s.id}`,{method:'PATCH',body:JSON.stringify({status,frequency_value:frequency,frequency_unit:s.frequency_unit,next_ship_date:next})});await loadCustomer(customerId)}catch(e){alert(e.message)}
    });
    $('#newAutoship').onclick=async()=>{
      const frequency=Math.max(1,Number(prompt('How many days between shipments?','60')||60));
      const next=prompt('Next ship date (YYYY-MM-DD):','');if(!next)return;
      try{await api(`/customers/${customerId}/recurring-orders`,{method:'POST',body:JSON.stringify({frequency_value:frequency,frequency_unit:'days',next_ship_date:next,status:'active'})});await loadCustomer(customerId)}catch(e){alert(e.message)}
    };
  }
})();