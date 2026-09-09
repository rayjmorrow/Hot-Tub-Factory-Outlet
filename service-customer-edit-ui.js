(()=>{
  const d=document.createElement('dialog');
  d.id='editCustomerDialog';
  d.innerHTML=`<form method="dialog" id="editCustomerForm" class="dialog-form"><h2>Edit Customer</h2><input type="hidden" name="id"><div class="grid2"><label>First name<input name="first_name"></label><label>Last name<input name="last_name"></label><label>Phone<input name="phone"></label><label>Email<input name="email" type="email"></label><label>Street<input name="street"></label><label>Street 2<input name="street2"></label><label>City<input name="city"></label><label>State<input name="state"></label><label>ZIP<input name="zip"></label><label>Company<input name="company"></label></div><label>Notes<textarea name="notes"></textarea></label><div class="row end"><button value="cancel" class="secondary">Cancel</button><button id="saveCustomerEdit" value="default">Save Changes</button></div></form>`;
  document.body.appendChild(d);

  let currentCustomer=null;
  const baseLoadCustomer=loadCustomer;
  loadCustomer=async function(id){
    await baseLoadCustomer(id);
    try{
      const x=await api('/customers/'+id);
      currentCustomer=x.customer;
      const toolbar=document.querySelector('.customer-toolbar .row.wrap');
      if(toolbar && !document.getElementById('editCustomerBtn')){
        const b=document.createElement('button');
        b.id='editCustomerBtn';
        b.className='secondary';
        b.textContent='Edit Customer';
        b.onclick=()=>openEditCustomer(currentCustomer);
        toolbar.prepend(b);
      }
    }catch(e){console.error(e)}
  };

  function openEditCustomer(c){
    const f=document.getElementById('editCustomerForm');
    ['id','first_name','last_name','phone','email','street','street2','city','state','zip','company','notes'].forEach(k=>{
      if(f.elements[k]) f.elements[k].value=c?.[k]??'';
    });
    d.showModal();
  }

  document.getElementById('saveCustomerEdit').onclick=async e=>{
    e.preventDefault();
    const f=document.getElementById('editCustomerForm');
    const b=Object.fromEntries(new FormData(f));
    const id=b.id;
    delete b.id;
    try{
      await api(`/customers/${id}/profile`,{method:'PATCH',body:JSON.stringify(b)});
      d.close();
      await loadCustomers();
      await loadCustomer(id);
    }catch(err){alert(err.message)}
  };
})();
