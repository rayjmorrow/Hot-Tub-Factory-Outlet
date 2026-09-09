(()=>{
  const customersSection=document.getElementById('customers');
  const list=document.getElementById('customerList');
  const search=document.getElementById('customerSearch');
  const detail=document.getElementById('customerDetail');
  if(!customersSection||!list||!search||!detail)return;

  const headingWrap=customersSection.querySelector('.row.between.wrap');

  function setProfileMode(on){
    if(headingWrap) headingWrap.hidden=on;
    search.hidden=on;
    list.hidden=on;
    detail.hidden=!on;
    if(on) window.scrollTo({top:0,behavior:'auto'});
  }

  async function openProfile(id){
    setProfileMode(true);
    detail.innerHTML='<div class="card"><p class="muted">Loading customer…</p></div>';
    try{
      await loadCustomer(id);
      const back=document.createElement('button');
      back.type='button';
      back.id='backToCustomersBtn';
      back.className='secondary';
      back.textContent='← Back to Customers';
      back.style.marginBottom='1rem';
      back.onclick=()=>{
        activeCustomerId=null;
        detail.innerHTML='';
        setProfileMode(false);
        loadCustomers();
        search.focus();
      };
      detail.prepend(back);
      window.scrollTo({top:0,behavior:'auto'});
    }catch(err){
      detail.innerHTML=`<button type="button" class="secondary" id="backToCustomersBtn">← Back to Customers</button><div class="card"><p class="error">Unable to open customer: ${esc(err?.message||'Unknown error')}</p></div>`;
      document.getElementById('backToCustomersBtn').onclick=()=>{detail.innerHTML='';setProfileMode(false);};
    }
  }

  document.addEventListener('click',e=>{
    const row=e.target.closest?.('.customer-row[data-id]');
    if(!row)return;
    e.preventDefault();
    e.stopImmediatePropagation();
    openProfile(row.dataset.id);
  },true);

  document.querySelectorAll('nav [data-view]').forEach(b=>b.addEventListener('click',()=>{
    if(b.dataset.view==='customers'){
      detail.innerHTML='';
      setProfileMode(false);
    }
  }));
})();