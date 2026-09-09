(()=>{
  const d=document.createElement('dialog');
  d.id='workOrderDetailDialog';
  d.innerHTML=`<div class="dialog-form" style="min-width:min(920px,94vw)"><div class="row between wrap"><div><h2 id="woDetailTitle">Work Order</h2><div id="woDetailStatus" class="muted"></div></div><button type="button" class="secondary" id="woDetailClose">Close</button></div><div id="woDetailBody"></div><div class="row end wrap" id="woDetailActions"></div></div>`;
  document.body.appendChild(d);
  $('#woDetailClose').onclick=()=>d.close();

  function detailLine(label,value){return value?`<div><b>${esc(label)}:</b> ${esc(value)}</div>`:''}
  function formatAddress(w){return [w.street,w.street2,w.city,w.state,w.zip].filter(Boolean).join(', ')}
  function val(v){return v==null?'':String(v)}
  function n(v){const x=Number(v);return Number.isFinite(x)?x:0}
  let currentId=null,currentDetail=null,partTimer=null;

  async function renderInvoiceItems(id){
    const box=$('#woPartsBox');
    if(!box)return;
    try{
      const x=await api(`/work-orders/${id}/invoice-items`);
      box.innerHTML=`<div class="row between wrap"><h3 style="margin:.2rem 0">Parts / Line Items</h3><button type="button" id="woAddPartBtn">+ Add Part</button></div>
        ${x.items.length?x.items.map(i=>`<div class="item"><div class="row between wrap"><div><b>${esc(i.description)}</b>${i.sku?`<div class="muted">${esc(i.sku)}</div>`:''}</div><div><b>${esc(i.quantity)} × ${money(i.unit_price)} = ${money(i.line_total)}</b> <button type="button" class="secondary" data-remove-item="${i.id}" style="padding:.35rem .55rem">Remove</button></div></div></div>`).join(''):'<p class="muted">No parts have been added to this work order yet.</p>'}
        <div class="row end wrap"><span>Parts subtotal: <b>${money(x.totals.parts_subtotal)}</b></span><span>Tax: <b>${money(x.totals.tax)}</b></span><span>Total: <b>${money(x.totals.total)}</b></span></div>
        <div id="woPartPicker" hidden style="margin-top:1rem;border-top:1px solid #dfe5ec;padding-top:1rem"><h3>Add Part</h3><input id="woPartSearch" placeholder="Search part number, description, brand…"><div id="woPartResults" class="list"></div></div>`;
      $('#woAddPartBtn').onclick=()=>{const p=$('#woPartPicker');p.hidden=!p.hidden;if(!p.hidden){$('#woPartSearch').focus();searchParts('')}};
      $$('[data-remove-item]').forEach(b=>b.onclick=async()=>{if(!confirm('Remove this part from the work order?'))return;try{await api(`/work-orders/${id}/invoice-items/${b.dataset.removeItem}`,{method:'DELETE'});await refreshWorkOrder(id)}catch(e){alert(e.message)}});
      $('#woPartSearch').oninput=()=>{clearTimeout(partTimer);partTimer=setTimeout(()=>searchParts($('#woPartSearch').value||''),250)};
    }catch(e){box.innerHTML=`<p class="error">${esc(e.message)}</p>`}
  }

  async function searchParts(term){
    const out=$('#woPartResults');if(!out)return;
    try{
      const rows=await api('/parts?q='+encodeURIComponent(term||''));
      out.innerHTML=rows.slice(0,30).map(p=>`<div class="item"><div class="row between wrap"><div><b>${esc(p.description)}</b><div class="muted">${esc([p.brand,p.manufacturer_part_number||p.supplier_part_number].filter(Boolean).join(' · '))}</div></div><div class="row"><b>${money(p.calculated_sell_price)}</b><input type="number" min="0.01" step="0.01" value="1" data-part-qty="${p.id}" style="width:85px"><button type="button" data-add-part="${p.id}">Add</button></div></div></div>`).join('')||'<p class="muted">No matching parts found.</p>';
      $$('[data-add-part]').forEach(b=>b.onclick=async()=>{const qty=$(`[data-part-qty="${b.dataset.addPart}"]`)?.value||1;try{await api(`/work-orders/${currentId}/invoice-items/part`,{method:'POST',body:JSON.stringify({part_id:b.dataset.addPart,quantity:qty})});await refreshWorkOrder(currentId)}catch(e){alert(e.message)}});
    }catch(e){out.innerHTML=`<p class="error">${esc(e.message)}</p>`}
  }

  function renderServiceEditor(w){
    return `<div class="card" id="woServiceEditBox"><div class="row between wrap"><h3 style="margin:.2rem 0">Service / Labor</h3><button type="button" id="woEditServiceBtn">Edit Service</button></div>
      <div id="woServiceReadout">
        <div class="row wrap"><span>Labor hours: <b>${esc(val(w.labor_hours||0))}</b></span><span>Labor: <b>${money(w.labor_amount)}</b></span><span>Travel: <b>${esc(val(w.travel_minutes||0))} min</b></span><span>Trip: <b>${money(w.trip_amount)}</b></span></div>
      </div>
      <form id="woServiceForm" hidden>
        <div class="grid2">
          <label>Labor hours<input name="labor_hours" type="number" min="0" step="0.25" value="${esc(val(w.labor_hours||0))}"></label>
          <label>Travel minutes<input name="travel_minutes" type="number" min="0" step="1" value="${esc(val(w.travel_minutes||0))}"></label>
          <label>Status<select name="status"><option value="scheduled">scheduled</option><option value="in_progress">in progress</option><option value="waiting_parts">waiting parts</option><option value="completed">completed</option><option value="cancelled">cancelled</option></select></label>
          <label>Trip charge override ($)<input name="trip_charge_override" type="number" min="0" step="0.01" placeholder="Leave blank for automatic" value="${w.trip_charge_override==null?'':esc(val(w.trip_charge_override))}"></label>
        </div>
        <label>Diagnosis<textarea name="diagnosis">${esc(w.diagnosis||'')}</textarea></label>
        <label>Work performed<textarea name="work_performed">${esc(w.work_performed||'')}</textarea></label>
        <label>Internal / technician notes<textarea name="internal_notes">${esc(w.internal_notes||'')}</textarea></label>
        <label>Override reason (only needed if changing an automatic charge)<input name="charge_override_reason" value="${esc(w.charge_override_reason||'')}"></label>
        <div class="row end"><button type="button" class="secondary" id="woCancelServiceEdit">Cancel</button><button type="submit">Save Service</button></div>
      </form>
    </div>`;
  }

  async function refreshWorkOrder(id){
    const x=await api(`/work-orders/${id}/detail`),w=x.workOrder;
    currentId=String(id);currentDetail=x;
    $('#woDetailTitle').textContent=w.work_order_number||'Work Order';
    $('#woDetailStatus').textContent=`${w.status||''}${w.priority?` · ${w.priority} priority`:''}`;
    $('#woDetailBody').innerHTML=`
      <div class="detail-grid">
        <div class="card">
          <h3>Customer</h3>
          ${detailLine('Name',w.customer_name)}
          ${detailLine('Phone',w.phone)}
          ${detailLine('Email',w.email)}
          ${detailLine('Address',formatAddress(w))}
          <h3>Appointment</h3>
          ${detailLine('Scheduled',dt(w.scheduled_start))}
          ${detailLine('Assigned to',w.assigned_to)}
          ${detailLine('Team',w.assigned_team)}
          ${detailLine('Job type',w.job_type)}
          ${detailLine('Appointment length',w.appointment_minutes?`${w.appointment_minutes} minutes`:'')}
        </div>
        <div class="card">
          <h3>Product / Equipment</h3>
          ${detailLine('Type',w.equipment_type)}
          ${detailLine('Brand',w.brand)}
          ${detailLine('Model',w.model)}
          ${detailLine('Serial number',w.serial_number)}
          ${detailLine('Installed/Purchased',w.install_date)}
          ${detailLine('Warranty through',w.warranty_expires)}
          <h3>Service Information</h3>
          ${detailLine('Customer complaint',w.complaint)}
          ${detailLine('Diagnosis',w.diagnosis)}
          ${detailLine('Work performed',w.work_performed)}
          ${detailLine('Internal notes',w.internal_notes)}
        </div>
      </div>
      ${renderServiceEditor(w)}
      <div class="card" id="woPartsBox"><p class="muted">Loading parts…</p></div>
      <div class="card"><h3>Charges</h3>
        <div class="row wrap"><span>Diagnostic: <b>${money(w.diagnostic_amount)}</b></span><span>Labor: <b>${money(w.labor_amount)}</b></span><span>Parts: <b>${money(w.parts_amount)}</b></span><span>Trip: <b>${money(w.trip_amount)}</b></span><span>Tax: <b>${money(w.tax_amount)}</b></span><span>Total: <b>${money(w.total_amount)}</b></span></div>
      </div>
      ${x.invoices.length?`<div class="card"><h3>Invoices</h3>${x.invoices.map(i=>`<div>${esc(i.invoice_number)} · ${esc(i.status)} · ${money(i.total_amount)}</div>`).join('')}</div>`:''}
      ${x.estimates.length?`<div class="card"><h3>Estimates</h3>${x.estimates.map(i=>`<div>${esc(i.estimate_number)} · ${esc(i.status)} · ${money(i.total_amount)}</div>`).join('')}</div>`:''}
    `;
    const status=$('#woServiceForm [name="status"]');if(status)status.value=w.status||'scheduled';
    $('#woEditServiceBtn').onclick=()=>{$('#woServiceReadout').hidden=true;$('#woEditServiceBtn').hidden=true;$('#woServiceForm').hidden=false};
    $('#woCancelServiceEdit').onclick=()=>{$('#woServiceForm').hidden=true;$('#woServiceReadout').hidden=false;$('#woEditServiceBtn').hidden=false};
    $('#woServiceForm').onsubmit=async e=>{
      e.preventDefault();const b=Object.fromEntries(new FormData(e.currentTarget));
      b.labor_hours=n(b.labor_hours);b.travel_minutes=n(b.travel_minutes);
      if(b.trip_charge_override==='')delete b.trip_charge_override;else b.trip_charge_override=n(b.trip_charge_override);
      try{await api(`/work-orders/${id}`,{method:'PATCH',body:JSON.stringify(b)});await refreshWorkOrder(id);await loadWorkOrders();if(activeCustomerId)try{await loadCustomer(activeCustomerId)}catch{}}catch(err){alert(err.message)}
    };
    $('#woDetailActions').innerHTML=x.canDelete?`<button type="button" class="secondary" id="woDeleteBtn">Delete Work Order</button>`:'';
    if($('#woDeleteBtn')) $('#woDeleteBtn').onclick=async()=>{
      if(!confirm(`Delete work order ${w.work_order_number}? This is only for a mistaken/unneeded work order.`))return;
      try{await api(`/work-orders/${id}`,{method:'DELETE'});d.close();await loadWorkOrders();if(activeCustomerId)try{await loadCustomer(activeCustomerId)}catch{}}catch(e){alert(e.message)}
    };
    await renderInvoiceItems(id);
  }

  async function openWorkOrderDetail(id){
    try{await refreshWorkOrder(id);d.showModal()}catch(e){alert(e.message)}
  }

  const originalWorkCard=workCard;
  workCard=function(w){return `<button type="button" class="item work-order-row" data-work-id="${w.id}" style="width:100%;text-align:left;color:inherit;background:white">${originalWorkCard(w).replace(/^<div class="item">|<\/div>$/g,'')}</button>`};
  const originalLoadWorkOrders=loadWorkOrders;
  loadWorkOrders=async function(){await originalLoadWorkOrders();$$('[data-work-id]').forEach(b=>b.onclick=()=>openWorkOrderDetail(b.dataset.workId))};
  const originalLoadCustomer=loadCustomer;
  loadCustomer=async function(id){await originalLoadCustomer(id);$$('[data-work-id]').forEach(b=>b.onclick=()=>openWorkOrderDetail(b.dataset.workId))};
  document.addEventListener('click',e=>{const b=e.target.closest?.('[data-work-id]');if(b){e.preventDefault();openWorkOrderDetail(b.dataset.workId)}});
})();
