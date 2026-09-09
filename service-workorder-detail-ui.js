(()=>{
  const d=document.createElement('dialog');
  d.id='workOrderDetailDialog';
  d.innerHTML=`<div class="dialog-form" style="min-width:min(760px,90vw)"><div class="row between wrap"><div><h2 id="woDetailTitle">Work Order</h2><div id="woDetailStatus" class="muted"></div></div><button type="button" class="secondary" id="woDetailClose">Close</button></div><div id="woDetailBody"></div><div class="row end" id="woDetailActions"></div></div>`;
  document.body.appendChild(d);
  $('#woDetailClose').onclick=()=>d.close();

  function detailLine(label,value){return value?`<div><b>${esc(label)}:</b> ${esc(value)}</div>`:''}
  function formatAddress(w){return [w.street,w.street2,w.city,w.state,w.zip].filter(Boolean).join(', ')}

  async function openWorkOrderDetail(id){
    try{
      const x=await api(`/work-orders/${id}/detail`),w=x.workOrder;
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
        <div class="card"><h3>Charges</h3>
          <div class="row wrap"><span>Diagnostic: <b>${money(w.diagnostic_amount)}</b></span><span>Labor: <b>${money(w.labor_amount)}</b></span><span>Parts: <b>${money(w.parts_amount)}</b></span><span>Trip: <b>${money(w.trip_amount)}</b></span><span>Tax: <b>${money(w.tax_amount)}</b></span><span>Total: <b>${money(w.total_amount)}</b></span></div>
        </div>
        ${x.invoices.length?`<div class="card"><h3>Invoices</h3>${x.invoices.map(i=>`<div>${esc(i.invoice_number)} · ${esc(i.status)} · ${money(i.total_amount)}</div>`).join('')}</div>`:''}
        ${x.estimates.length?`<div class="card"><h3>Estimates</h3>${x.estimates.map(i=>`<div>${esc(i.estimate_number)} · ${esc(i.status)} · ${money(i.total_amount)}</div>`).join('')}</div>`:''}
      `;
      $('#woDetailActions').innerHTML=x.canDelete?`<button type="button" class="secondary" id="woDeleteBtn">Delete Work Order</button>`:'';
      if($('#woDeleteBtn')) $('#woDeleteBtn').onclick=async()=>{
        if(!confirm(`Delete work order ${w.work_order_number}? This is only for a mistaken/unneeded work order.`))return;
        try{
          await api(`/work-orders/${id}`,{method:'DELETE'});
          d.close();
          await loadWorkOrders();
          if(activeCustomerId) try{await loadCustomer(activeCustomerId)}catch{}
        }catch(e){alert(e.message)}
      };
      d.showModal();
    }catch(e){alert(e.message)}
  }

  const originalWorkCard=workCard;
  workCard=function(w){
    return `<button type="button" class="item work-order-row" data-work-id="${w.id}" style="width:100%;text-align:left;color:inherit;background:white">${originalWorkCard(w).replace(/^<div class="item">|<\/div>$/g,'')}</button>`;
  };

  const originalLoadWorkOrders=loadWorkOrders;
  loadWorkOrders=async function(){
    await originalLoadWorkOrders();
    $$('[data-work-id]').forEach(b=>b.onclick=()=>openWorkOrderDetail(b.dataset.workId));
  };

  const originalLoadCustomer=loadCustomer;
  loadCustomer=async function(id){
    await originalLoadCustomer(id);
    $$('[data-work-id]').forEach(b=>b.onclick=()=>openWorkOrderDetail(b.dataset.workId));
  };

  document.addEventListener('click',e=>{
    const b=e.target.closest?.('[data-work-id]');
    if(b){e.preventDefault();openWorkOrderDetail(b.dataset.workId)}
  });
})();
