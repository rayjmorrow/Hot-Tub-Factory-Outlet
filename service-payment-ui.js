(()=>{
  const originalLoadCustomer=loadCustomer;
  loadCustomer=async function(id){
    await originalLoadCustomer(id);
    try{await renderPaymentPanel(id)}catch(e){console.warn('Payment panel unavailable',e)}
  };

  async function renderPaymentPanel(customerId){
    const detail=$('#customerDetail');
    if(!detail)return;
    const [pm,cx]=await Promise.all([api(`/customers/${customerId}/payment-method`),api(`/customers/${customerId}`)]);
    const p=pm.payment||{},status=p.status||'needed';
    const ready=status==='card_on_file'||status==='cash_check_approved';
    const label=status==='card_on_file'?`${esc(p.card_brand||'Card')} •••• ${esc(p.card_last_four||'')}`:status==='cash_check_approved'?'Cash / Check approved':'Payment method needed';
    const unpaid=(cx.invoices||[]).filter(i=>Number(i.total_amount)-Number(i.amount_paid)>0.001);
    const panel=document.createElement('div');
    panel.className='card payment-panel';
    panel.innerHTML=`<div class="row between wrap"><div><h3 style="margin:.1rem 0">Payment Method</h3><div class="${ready?'payment-ready':'payment-needed'}">${ready?'✓ ':'⚠ '}${label}</div>${p.authorized_at?`<div class="muted">Card authorization: ${dt(p.authorized_at)}</div>`:''}${p.cash_check_approved_at?`<div class="muted">Approved by ${esc(p.cash_check_approved_by_name||'manager')} · ${dt(p.cash_check_approved_at)}</div>`:''}</div><div class="row wrap"><button id="sendCardAuth">Send Card Authorization Link</button><button id="approveCashCheck" class="secondary">${status==='cash_check_approved'?'Remove Cash/Check Approval':'Approve Cash/Check'}</button></div></div><p class="muted">A payment method must be secured before a service appointment can be scheduled. Card numbers are stored by Authorize.Net, not in HTFO's service database.</p><div id="paymentLinkBox"></div><div id="cardChargeFeedback"></div>${unpaid.length?`<h4>Open invoices</h4>${unpaid.map(i=>`<div class="item"><div class="row between wrap"><div><b>${esc(i.invoice_number)}</b><div>Balance ${money(Number(i.total_amount)-Number(i.amount_paid))}</div></div>${status==='card_on_file'?`<button data-charge-invoice="${i.id}" data-balance="${Number(i.total_amount)-Number(i.amount_paid)}">Charge Card on File</button>`:'<span class="muted">Card required to charge remotely</span>'}</div></div>`).join('')}`:''}`;
    detail.prepend(panel);
    $('#sendCardAuth').onclick=async()=>{
      try{const x=await api(`/customers/${customerId}/payment-authorization-link`,{method:'POST',body:JSON.stringify({expires_days:7})});$('#paymentLinkBox').innerHTML=`<div class="sourcebox"><b>Secure authorization link</b><p class="muted">Send this link to the customer. It expires in ${x.expires_days} days.</p><input id="paymentAuthUrl" value="${esc(x.url)}" readonly><button id="selectPaymentAuthUrl" class="secondary">Select Link</button></div>`;$('#selectPaymentAuthUrl').onclick=()=>{$('#paymentAuthUrl').focus();$('#paymentAuthUrl').select()}}catch(e){alert(e.message)}
    };
    $('#approveCashCheck').onclick=async()=>{
      const remove=status==='cash_check_approved';
      const note=remove?'':prompt('Optional note for cash/check arrangement (for example: customer will leave check):','')||'';
      try{await api(`/customers/${customerId}/payment-cash-check`,{method:'PATCH',body:JSON.stringify({approved:!remove,note})});await loadCustomer(customerId)}catch(e){alert(e.message)}
    };
    $$('[data-charge-invoice]').forEach(b=>b.onclick=async()=>{
      const amount=Number(b.dataset.balance||0),feedback=$('#cardChargeFeedback');
      if(!confirm(`Charge the card on file ${money(amount)} for this invoice?`))return;
      b.disabled=true;b.textContent='Processing…';
      try{
        const x=await api(`/invoices/${b.dataset.chargeInvoice}/charge-card-on-file`,{method:'POST',body:JSON.stringify({amount})});
        feedback.innerHTML=`<div class="payment-ready" style="margin:.8rem 0"><b>✓ Card Approved — ${money(amount)} collected</b><div>Transaction ${esc(x.transaction_id||'recorded')}</div><div class="muted">The payment was recorded automatically and the invoice balance was updated.</div></div>`;
        setTimeout(()=>loadCustomer(customerId),900);
      }catch(e){
        feedback.innerHTML=`<div class="payment-needed" style="margin:.8rem 0;border-color:#f2a6a6;background:#fff1f1"><b>✕ Card Declined / Payment Not Collected</b><div>${esc(e.message||'The processor did not approve the charge.')}</div><div class="muted">The invoice remains unpaid. Send a new payment link, replace the card, or collect cash/check.</div></div>`;
        b.disabled=false;b.textContent='Charge Card on File';
      }
    });
  }
})();