(()=>{
  const dialog=document.createElement('dialog');
  dialog.id='legacySaleImportDialog';
  dialog.innerHTML=`<form id="legacySaleImportForm" class="dialog-form">
    <h2>Import Existing Signed Sale</h2>
    <p class="muted"><b>Internal record only:</b> No contract email, signature request or payment request will be sent. Enter the original agreement details, not a new agreement.</p>
    <div class="grid2">
      <label>Original agreement number / unique reference<input name="agreement_ref" required maxlength="140"></label>
      <label>Original date signed<input name="original_date" type="date" required></label>
      <label>Product type<select name="equipment_type"><option>Hot Tub</option><option>Swim Spa</option></select></label>
      <label>Brand<input name="brand" required></label>
      <label>Model<input name="model" required></label>
      <label>Serial number (optional)<input name="serial_number"></label>
      <label>Original contract total (including tax) $<input name="total_amount" type="number" min="0" max="10000000" step="0.01" required></label>
      <label>Included sales tax $<input name="tax_amount" type="number" min="0" step="0.01" value="0" required></label>
      <label>Previously paid (reference only) $<input name="previously_paid" type="number" min="0" step="0.01" value="0" required></label>
      <label>Location of original signed contract<input name="signed_document_location" placeholder="File cabinet / original PDF filename" required></label>
    </div>
    <label>Delivery notes / items sold<textarea name="delivery_notes" placeholder="Delivery access, actual included accessories, instructions. Nothing will be automatically added."></textarea></label>
    <label><input name="original_verified" type="checkbox" required> I have the original signed agreement or reliable proof of acceptance and have checked the recorded amounts.</label>
    <div id="legacySaleImportStatus" class="muted" role="status"></div>
    <div class="row end"><button id="cancelLegacySale" type="button" class="secondary">Cancel</button><button id="submitLegacySale" type="submit">Save Historical Sale — No Customer Contact</button></div>
  </form>`;
  document.body.append(dialog);
  let selectedCustomerId=null;
  const form=dialog.querySelector('form'),status=dialog.querySelector('#legacySaleImportStatus'),save=dialog.querySelector('#submitLegacySale');
  dialog.querySelector('#cancelLegacySale').onclick=()=>dialog.close();
  function addButton(){
    const toolbar=document.querySelector('#customerDetail .customer-toolbar .row.wrap');
    if(!toolbar||toolbar.querySelector('#importExistingSaleBtn'))return;
    const role=String(currentServiceUser?.role||'').toLowerCase();
    if(!['owner','admin','manager','service_manager'].includes(role))return;
    const btn=document.createElement('button');
    btn.type='button';btn.className='secondary';btn.id='importExistingSaleBtn';btn.textContent='Import Existing Sale';
    btn.onclick=()=>{if(!activeCustomerId)return;selectedCustomerId=String(activeCustomerId);form.reset();status.textContent='';dialog.showModal()};
    toolbar.prepend(btn);
  }
  new MutationObserver(addButton).observe(document.getElementById('customerDetail'),{childList:true,subtree:true});
  form.onsubmit=async event=>{
    event.preventDefault();
    if(!form.reportValidity()||!selectedCustomerId)return;
    save.disabled=true;status.className='muted';status.textContent='Saving historical sale (no messages or charges)…';
    const data=Object.fromEntries(new FormData(form));delete data.original_verified;
    try{
      const result=await api('/customers/'+encodeURIComponent(selectedCustomerId)+'/import-existing-sale',{method:'POST',body:JSON.stringify(data)});
      status.className='ok';status.textContent='Imported '+result.order_number+'. No email, signature request or charge sent.';
      await loadCustomer(selectedCustomerId);
      dialog.close();
    }catch(err){status.className='error';status.textContent=err.message||'Unable to import sale';}
    finally{save.disabled=false;}
  };
})();