(()=>{
  const d=document.createElement('dialog');
  d.id='editCustomerDialog';
  d.innerHTML=`<form method="dialog" id="editCustomerForm" class="dialog-form"><h2>Edit Customer</h2><input type="hidden" name="id"><div class="grid2"><label>First name<input name="first_name"></label><label>Last name<input name="last_name"></label><label>Phone<input name="phone"></label><label>Email<input name="email" type="email"></label><label>Street<input name="street"></label><label>Street 2<input name="street2"></label><label>City<input name="city"></label><label>State<input name="state"></label><label>ZIP<input name="zip"></label><label>Company<input name="company"></label></div><label>Notes<textarea name="notes"></textarea></label><div class="card" style="margin-top:1rem"><div class="row between wrap"><h3 style="margin:.2rem 0">Products / Equipment</h3><button type="button" id="editCustomerAddProduct">+ Add Product</button></div><div id="editCustomerProducts" class="list"></div></div><div class="row end"><button type="button" id="cancelCustomerEdit" class="secondary">Cancel</button><button id="saveCustomerEdit" value="default">Save Changes</button></div></form>`;
  document.body.appendChild(d);

  const ed=document.createElement('dialog');
  ed.id='editEquipmentDialog';
  ed.innerHTML=`<form method="dialog" id="editEquipmentForm" class="dialog-form"><h2>Edit Product / Serial Number</h2><input type="hidden" name="id"><div class="grid2"><label>Product type<select name="equipment_type"><option>Hot Tub</option><option>Swim Spa</option><option>Pool</option><option>Sauna</option><option>Outdoor Kitchen</option><option>Grill / Smoker</option><option>Pool Equipment</option><option>Other</option></select></label><label>Brand<input name="brand"></label><label>Model<input name="model"></label><label>Serial number<input name="serial_number"></label><label>Purchase / install date<input name="install_date" type="date"></label><label>Warranty expires<input name="warranty_expires" type="date"></label></div><label>Location at property<input name="location_notes"></label><label>Equipment notes<textarea name="notes"></textarea></label><div class="row end"><button type="button" id="cancelEquipmentEdit" class="secondary">Cancel</button><button id="saveEquipmentEdit" value="default">Save Product</button></div></form>`;
  document.body.appendChild(ed);

  let currentCustomer=null,currentEquipment=[];
  const baseLoadCustomer=loadCustomer;
  loadCustomer=async function(id){
    await baseLoadCustomer(id);
    try{
      const x=await api('/customers/'+id);
      currentCustomer=x.customer;
      currentEquipment=x.equipment||[];
      const toolbar=document.querySelector('.customer-toolbar .row.wrap');
      if(toolbar && !document.getElementById('editCustomerBtn')){
        const b=document.createElement('button');
        b.id='editCustomerBtn';
        b.className='secondary';
        b.textContent='Edit Customer';
        b.onclick=()=>openEditCustomer(currentCustomer,currentEquipment);
        toolbar.prepend(b);
      }
    }catch(e){console.error(e)}
  };

  function renderProducts(){
    const box=document.getElementById('editCustomerProducts');
    box.innerHTML=currentEquipment.length?currentEquipment.map(e=>`<div class="item"><div class="row between wrap"><div><b>${esc([e.equipment_type,e.brand,e.model].filter(Boolean).join(' ')||'Product')}</b><div class="muted">Serial: ${esc(e.serial_number||'Not entered')}</div></div><button type="button" class="secondary" data-edit-equipment="${e.id}">Edit Product / Serial</button></div></div>`).join(''):'<p class="muted">No products recorded for this customer yet.</p>';
    box.querySelectorAll('[data-edit-equipment]').forEach(b=>b.onclick=()=>{
      const e=currentEquipment.find(x=>String(x.id)===String(b.dataset.editEquipment));
      if(e)openEditEquipment(e);
    });
  }

  function openEditCustomer(c,equipment=[]){
    currentCustomer=c;currentEquipment=equipment;
    const f=document.getElementById('editCustomerForm');
    ['id','first_name','last_name','phone','email','street','street2','city','state','zip','company','notes'].forEach(k=>{if(f.elements[k])f.elements[k].value=c?.[k]??''});
    renderProducts();
    d.showModal();
  }

  function openEditEquipment(e){
    const f=document.getElementById('editEquipmentForm');
    ['id','equipment_type','brand','model','serial_number','install_date','warranty_expires','location_notes','notes'].forEach(k=>{if(f.elements[k])f.elements[k].value=e?.[k]??''});
    ed.showModal();
  }

  document.getElementById('cancelCustomerEdit').onclick=()=>d.close();
  document.getElementById('cancelEquipmentEdit').onclick=()=>ed.close();
  document.getElementById('editCustomerAddProduct').onclick=()=>{
    if(!currentCustomer?.id)return;
    d.close();
    openEquipmentDialog(currentCustomer.id);
  };

  document.getElementById('saveEquipmentEdit').onclick=async e=>{
    e.preventDefault();
    const f=document.getElementById('editEquipmentForm');
    const b=Object.fromEntries(new FormData(f));
    const id=b.id;delete b.id;
    try{
      await api(`/equipment/${id}`,{method:'PATCH',body:JSON.stringify(b)});
      ed.close();
      const x=await api('/customers/'+currentCustomer.id);
      currentEquipment=x.equipment||[];
      renderProducts();
      await loadCustomer(currentCustomer.id);
    }catch(err){alert(err.message)}
  };

  document.getElementById('saveCustomerEdit').onclick=async e=>{
    e.preventDefault();
    const f=document.getElementById('editCustomerForm');
    const b=Object.fromEntries(new FormData(f));
    const id=b.id;delete b.id;
    try{
      await api(`/customers/${id}/profile`,{method:'PATCH',body:JSON.stringify(b)});
      d.close();
      await loadCustomers();
      await loadCustomer(id);
    }catch(err){alert(err.message)}
  };
})();
