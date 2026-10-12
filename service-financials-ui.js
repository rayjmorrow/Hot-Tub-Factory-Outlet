(()=>{
  const financialOwner=()=>{const u=window.currentServiceUser||{};const role=String(u.role||'').toLowerCase();const user=String(u.username||'').toLowerCase();return role==='owner'||user==='ray'};

  const nav=document.querySelector('nav');
  if(financialOwner()&&nav&&!nav.querySelector('[data-view="financials"]')){
    const b=document.createElement('button');b.dataset.view='financials';b.textContent='Service Financials';nav.appendChild(b);
  }
  const main=document.querySelector('main');
  if(financialOwner()&&main&&!document.getElementById('financials')){
    const s=document.createElement('section');s.id='financials';s.className='view';s.hidden=true;
    s.innerHTML=`
      <div class="row between wrap"><div><h1>Service Department Financials</h1><p class="muted">Collections first: customer balances, warranty credits, delivery revenue, payroll and service P/L.</p></div><button class="secondary" id="finRefresh">Refresh</button></div>
      <div class="ops-toolbar"><label>From<input id="finFrom" type="date"></label><label>To<input id="finTo" type="date"></label><button id="finApply">Apply Period</button></div>
      <div id="finCollectionAlert"></div>
      <div class="stats" id="finStats"></div>
      <div class="detail-grid" style="margin-top:16px">
        <div class="card"><h2>Customer Balances — Collect These</h2><div id="finOpenBalances"></div></div>
        <div class="card"><h2>Manufacturer Warranty Credits Due</h2><div id="finWarranty"></div></div>
      </div>
      <div class="card" style="margin-top:16px"><h2>Work Order Financial History</h2><p class="muted">Every service and delivery work order, including customer billing, collections, warranty recovery, and the $400 internal delivery charge.</p><div id="finHistory"></div></div>
      <div class="detail-grid" style="margin-top:16px">
        <div class="card"><h2>Add Service Expense / Payroll</h2>
          <div class="grid2"><label>Date<input id="finExpenseDate" type="date"></label><label>Type<select id="finExpenseType"><option value="payroll">Payroll</option><option value="vehicle">Vehicle / Fuel</option><option value="tools">Tools / Equipment</option><option value="other">Other</option></select></label><label>Employee<input id="finEmployee" placeholder="Bill, Dave, Rick…"></label><label>Amount<input id="finExpenseAmount" type="number" min="0" step=".01"></label><label class="full">Description<input id="finExpenseDescription" placeholder="Weekly payroll check, fuel, tool purchase…"></label><label>Reference<input id="finExpenseReference" placeholder="Check # / payroll reference"></label></div>
          <button id="finSaveExpense">Save Expense</button><span class="muted" id="finExpenseStatus"></span>
        </div>
        <div class="card"><h2>Import Weekly Payroll / Expenses</h2><p class="muted">CSV columns can include date, employee, amount, description, check_number, expense_type. Weekly payroll checks are better for year-to-date service P/L than waiting for W-2s.</p><input type="file" id="finExpenseCsv" accept=".csv,text/csv"><button id="finImportExpenseCsv">Import CSV</button><div class="muted" id="finImportStatus"></div><h3>Current Period Expenses</h3><div id="finExpenses"></div></div>
      </div>`;
    main.appendChild(s);
  }

  function isoDate(d){return d.toISOString().slice(0,10)}
  function defaultDates(){const n=new Date(),f=new Date(n.getFullYear(),n.getMonth(),1);if(!$('#finFrom').value)$('#finFrom').value=isoDate(f);if(!$('#finTo').value)$('#finTo').value=isoDate(n);if(!$('#finExpenseDate').value)$('#finExpenseDate').value=isoDate(n)}
  const finQuery=()=>'?from='+encodeURIComponent($('#finFrom').value)+'&to='+encodeURIComponent($('#finTo').value);
  const badge=(text,ok)=>'<span class="pill" style="'+(ok?'background:#e7f6ec;color:#166534':'background:#fff0e5;color:#9a3412')+'">'+esc(text)+'</span>';

  async function loadFinancials(){
    defaultDates();
    const q=finQuery();
    try{
      const [sum,balances,warranty,history,expenses]=await Promise.all([
        api('/financials/summary'+q),api('/financials/open-balances'),api('/financials/warranty-receivables'),api('/financials/work-order-history'+q),api('/financials/expenses'+q).catch(()=>[])
      ]);
      const r=sum.receivables||{},col=sum.collections||{},cost=sum.costs||{},pl=sum.profit_loss||{};
      $('#finCollectionAlert').innerHTML=Number(r.total_open||0)>.009
        ?`<div class="payment-needed" style="margin:12px 0"><b>COLLECTIONS ATTENTION:</b> ${money(r.total_open)} is still open — customer A/R ${money(r.customer_ar)} + manufacturer warranty credits ${money(r.warranty_receivable)}. Goal: $0 unexplained open balance.</div>`
        :'<div class="payment-ready" style="margin:12px 0"><b>✓ Collections clear:</b> no open customer or manufacturer balances.</div>';
      $('#finStats').innerHTML=
        `<div class="stat"><b>${money(r.customer_ar)}</b><span>Customer A/R</span></div>`+
        `<div class="stat"><b>${money(r.warranty_receivable)}</b><span>Warranty Credits Due</span></div>`+
        `<div class="stat"><b>${money(col.customer_collected)}</b><span>Customer Cash Collected</span></div>`+
        `<div class="stat"><b>${money(col.warranty_credits_received)}</b><span>Warranty Credits Received</span></div>`+
        `<div class="stat"><b>${money(col.delivery_internal_revenue)}</b><span>Sales Dept Delivery Revenue</span></div>`+
        `<div class="stat"><b>${money(cost.payroll)}</b><span>Payroll</span></div>`+
        `<div class="stat"><b>${money(cost.parts_cost)}</b><span>Parts Cost</span></div>`+
        `<div class="stat"><b>${money(pl.net)}</b><span>${pl.self_sustaining?'Service Net Profit':'Service Net Loss'}</span></div>`;
      $('#finOpenBalances').innerHTML=balances.length?balances.map(x=>`<div class="item"><div class="row between wrap"><div><b>${esc(x.invoice_number)} · ${esc(x.customer_name)}</b><div>${money(x.balance)} due · ${x.age_days} day(s) old</div><div class="muted">${esc(x.payment_status)}${x.card_last_four?' · '+esc(x.card_brand||'Card')+' •••• '+esc(x.card_last_four):''}</div></div><div class="row wrap">${x.payment_status==='card_on_file'?'<button data-fin-charge="'+x.invoice_id+'" data-bal="'+x.balance+'">Charge Card</button>':x.payment_status==='cash_check_approved'?'<button data-fin-cash="'+x.invoice_id+'" data-bal="'+x.balance+'">Record Cash/Check</button>':badge('Payment Setup Needed',false)}${x.work_order_id?'<button class="secondary" data-fin-wo="'+x.work_order_id+'">Open Work Order</button>':''}</div></div></div>`).join(''):'<p class="muted">No customer balances. ✓</p>';
      $('#finWarranty').innerHTML=warranty.length?warranty.map(x=>`<div class="item"><div class="row between wrap"><div><b>${esc(x.supplier)} · ${esc(x.work_order_number)}</b><div>${money(x.outstanding)} due · ${x.age_days} day(s)</div><div class="muted">Claim ${esc(x.claim_number||'not assigned')} · ${esc(x.status)}</div></div><button data-fin-warranty="${x.id}" data-due="${x.outstanding}">Record Manufacturer Credit</button></div></div>`).join(''):'<p class="muted">No outstanding warranty credits. ✓</p>';
      $('#finHistory').innerHTML=history.length?history.map(x=>`<div class="item"><div class="row between wrap"><div><b>${esc(x.work_order_number)} · ${esc(x.customer_name)}</b><div>${esc(x.job_type)} · ${esc(x.status)} · ${esc([x.brand,x.model].filter(Boolean).join(' '))}</div></div><button class="secondary" data-fin-wo="${x.id}">Open</button></div><div class="row wrap"><span>Billed <b>${money(x.billed)}</b></span><span>Collected <b>${money(x.paid)}</b></span><span>Customer Balance <b>${money(x.balance)}</b></span>${Number(x.warranty_claimed||0)>0?'<span>Warranty '+money(x.warranty_paid)+' / '+money(x.warranty_claimed)+'</span>':''}${Number(x.delivery_internal_revenue||0)>0?'<span>Internal Delivery <b>'+money(x.delivery_internal_revenue)+'</b></span>':''}</div></div>`).join(''):'<p class="muted">No work orders in this period.</p>';
      $('#finExpenses').innerHTML=expenses.length?expenses.map(x=>`<div class="item"><b>${esc(x.expense_date)} · ${esc(x.expense_type)}</b><span>${esc(x.employee_name||'')} ${esc(x.description)}</span><strong>${money(x.amount)}</strong></div>`).join(''):'<p class="muted">No expenses entered for this period.</p>';
      bindFinancialActions();
    }catch(e){$('#finCollectionAlert').innerHTML='<div class="error">'+esc(e.message)+'</div>'}
  }

  async function chargeInvoice(id,balance){
    if(!confirm('Charge the authorized card on file '+money(balance)+'?'))return;
    try{await api('/invoices/'+id+'/charge-card-on-file',{method:'POST',body:JSON.stringify({amount:Number(balance)})});await loadFinancials()}catch(e){alert(e.message)}
  }
  async function recordCash(id,balance){
    const method=(prompt('Payment method: cash or check','cash')||'').trim().toLowerCase();if(!['cash','check'].includes(method))return alert('Enter cash or check.');
    const amount=Number(prompt('Amount collected',String(balance))||0);if(amount<=0)return;
    const reference=method==='check'?(prompt('Check number','')||''):'';
    if(method==='check'&&!reference)return alert('Check number is required.');
    try{await api('/invoices/'+id+'/payments',{method:'POST',body:JSON.stringify({payment_method:method,amount,reference_number:reference,notes:'Recorded from Service Financials collections dashboard'})});await loadFinancials()}catch(e){alert(e.message)}
  }
  async function recordWarranty(id,due){
    const amount=Number(prompt('Manufacturer credit/payment received',String(due))||0);if(amount<=0)return;
    const ref=prompt('Payment / credit reference','')||'';
    try{await api('/warranty-claims/'+id,{method:'PATCH',body:JSON.stringify({total_paid:amount,status:Math.abs(amount-Number(due))<.01?'paid':'partial',paid_at:new Date().toISOString(),payment_reference:ref})});await loadFinancials()}catch(e){alert(e.message)}
  }
  function bindFinancialActions(){
    $$('[data-fin-charge]').forEach(b=>b.onclick=()=>chargeInvoice(b.dataset.finCharge,b.dataset.bal));
    $$('[data-fin-cash]').forEach(b=>b.onclick=()=>recordCash(b.dataset.finCash,b.dataset.bal));
    $$('[data-fin-warranty]').forEach(b=>b.onclick=()=>recordWarranty(b.dataset.finWarranty,b.dataset.due));
    $$('[data-fin-wo]').forEach(b=>b.onclick=()=>{if(window.openHtfoWorkOrderDetail)window.openHtfoWorkOrderDetail(b.dataset.finWo)});
  }

  $('#finRefresh').onclick=loadFinancials;$('#finApply').onclick=loadFinancials;
  $('#finSaveExpense').onclick=async()=>{
    const body={expense_date:$('#finExpenseDate').value,expense_type:$('#finExpenseType').value,employee_name:$('#finEmployee').value,amount:Number($('#finExpenseAmount').value||0),description:$('#finExpenseDescription').value,reference:$('#finExpenseReference').value};
    try{await api('/financials/expenses',{method:'POST',body:JSON.stringify(body)});$('#finExpenseStatus').textContent='Saved';$('#finExpenseAmount').value='';$('#finExpenseDescription').value='';$('#finExpenseReference').value='';await loadFinancials()}catch(e){$('#finExpenseStatus').textContent=e.message}
  };
  function parseCsv(text){
    const lines=text.replace(/\r/g,'').split('\n').filter(Boolean);if(!lines.length)return[];
    const split=line=>{let out=[],s='',q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(q&&line[i+1]==='"'){s+='"';i++}else q=!q}else if(ch===','&&!q){out.push(s);s=''}else s+=ch}out.push(s);return out};
    const heads=split(lines.shift()).map(x=>x.trim().toLowerCase().replace(/[^a-z0-9]+/g,'_'));
    return lines.map(line=>{const vals=split(line),o={};heads.forEach((h,i)=>o[h]=vals[i]?.trim()||'');if(o.check_no&&!o.check_number)o.check_number=o.check_no;if(o.name&&!o.employee)o.employee=o.name;if(o.pay&&!o.amount)o.amount=o.pay;return o});
  }
  $('#finImportExpenseCsv').onclick=async()=>{
    const file=$('#finExpenseCsv').files[0];if(!file)return $('#finImportStatus').textContent='Choose a CSV first.';
    try{const rows=parseCsv(await file.text());const x=await api('/financials/expenses/import',{method:'POST',body:JSON.stringify({rows})});$('#finImportStatus').textContent='Imported '+x.inserted+' row(s); skipped '+x.skipped+'.';await loadFinancials()}catch(e){$('#finImportStatus').textContent=e.message}
  };

  const originalShowView=showView;
  showView=function(id){
    if(id==='financials'){
      if(!financialOwner())return originalShowView('dashboard');
      $('.view').forEach(v=>v.hidden=v.id!=='financials');loadFinancials();return;
    }
    originalShowView(id);
  };
  const finNav=document.querySelector('nav [data-view="financials"]');if(finNav)finNav.onclick=()=>showView('financials');
})();