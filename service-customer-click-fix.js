(()=>{
  document.addEventListener('click', async e=>{
    const row=e.target.closest?.('.customer-row[data-id]');
    if(!row)return;
    e.preventDefault();
    e.stopPropagation();
    const id=row.dataset.id;
    const detail=document.getElementById('customerDetail');
    try{
      if(detail) detail.innerHTML='<div class="card"><p class="muted">Loading customer…</p></div>';
      await loadCustomer(id);
    }catch(err){
      console.error('Unable to open customer',err);
      if(detail) detail.innerHTML=`<div class="card"><p class="error">Unable to open customer: ${esc(err?.message||'Unknown error')}</p></div>`;
      else alert(err?.message||'Unable to open customer');
    }
  },true);
})();
