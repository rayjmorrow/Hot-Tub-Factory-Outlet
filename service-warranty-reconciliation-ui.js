// HTFO owner-only manufacturer warranty evidence and receivables reconciliation.
(()=>{
 const $=s=>document.querySelector(s);
 const html=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fmt=v=>Number(v||0).toLocaleString('en-US',{style:'currency',currency:'USD'});
 const nav=document.querySelector('nav'),main=document.querySelector('main');
 if(!nav||!main)return;
 const manufacturers=[
 ['cal-spas','Cal Spas'],['vita-spas','Vita Spas'],['american-whirlpool','American Whirlpool'],
 ['aquasolus','AquaSolus'],['eco-spas','Eco Spas'],['innova-spas','Innova Spas'],['wellis','Wellis (legacy)']
 ];
 const selectedManufacturer=()=>$('#manufacturerWarrantyBrand').value;
 const selectedManufacturerName=()=>manufacturers.find(x=>x[0]===selectedManufacturer())?.[1]||'Manufacturer';
 const button=document.createElement('button');button.dataset.view='warrantyReconciliation';button.textContent='Manufacturer Warranty';button.hidden=true;nav.append(button);
 const section=document.createElement('section');section.id='warrantyReconciliation';section.className='view';section.hidden=true;
 section.innerHTML=`<h2>Manufacturer Warranty Reconciliation</h2>
 <label>Manufacturer <select id="manufacturerWarrantyBrand"><option value="cal-spas">Cal Spas</option><option value="vita-spas">Vita Spas</option><option value="american-whirlpool">American Whirlpool</option><option value="aquasolus">AquaSolus</option><option value="eco-spas">Eco Spas</option><option value="innova-spas">Innova Spas</option><option value="wellis">Wellis (existing warranty history)</option></select></label>
 <div class="card"><h3>HTFO Receivables — Who Owes Us?</h3><div id="manufacturerWarrantyTotals" role="status"></div><div id="manufacturerWarrantyBreakdown"></div><div id="manufacturerCustomerBalances"></div></div>
 <p id="manufacturerWarrantyPolicy" class="muted"></p>
 <p class="muted">Owner-only. Match manufacturer CSV records against serialized spa service history and our claims. Uploaded amounts are evidence, not recorded payments.</p>
 <button type="button" id="calWarrantyRefresh">Refresh warranty balances</button>
 <button type="button" id="calWarrantyExport">Download HTFO claim evidence (CSV)</button>
 <p id="calWarrantySummary" role="status"></p>
 <div class="card"><h3>Import manufacturer CSV</h3>
 <p class="muted">Required column: serial number. Optional columns: claim number, claimed, approved, paid, status, payment reference, notes. Rows must be reviewed before storing as manufacturer evidence.</p>
 <label>Statement month <input type="month" id="manufacturerWarrantyReportMonth" required></label>
 <label>Credit report amounts represent <select id="calWarrantyCreditMode"><option value="monthly_credit">Credits issued on THIS month's report (add to existing credits)</option><option value="cumulative_approved">Total credit approved to date (replace prior total)</option></select></label>
 <label>Manufacturer report <input id="calWarrantyFile" type="file" accept=".csv,text/csv"></label>
 <button type="button" id="calWarrantyPreview">Preview matches</button>
 <button type="button" id="calWarrantyCommit" disabled>Save reviewed report as evidence</button>
 <p id="calWarrantyImportStatus" role="status"></p>
 <div id="calWarrantyImportPreview" style="max-height:310px;overflow:auto"></div></div>
 <div class="card"><h3>Monthly reports — Apply approved credits</h3><p class="muted">After uploading and checking the report, use Apply Approved Credits. Only uniquely matched claim amounts will be updated. Provider-reported payments remain unverified until reconciled to bank deposits.</p><div id="calWarrantyBatches"></div><p id="calWarrantyCreditStatus" role="status"></p></div>
 <div class="card"><h3>Manufacturer outstanding claims</h3><div id="calWarrantyClaims" style="overflow:auto"></div></div>
 <div class="card"><h3>Warranty jobs without a manufacturer claim</h3><p class="muted">Create an HTFO claim from an existing completed warranty service work order. A technician's work record is evidence; a supplier acknowledgement is separate.</p><div id="calWarrantyUnclaimed"></div></div>
 <div class="card"><h3>Verified settlements — bank deposit or vendor credit used</h3><div id="calWarrantySettlements"></div></div>
 <div class="card"><h3>Manufacturer report lines and exceptions</h3><div id="calWarrantyImports" style="overflow:auto"></div></div>`;
 main.append(section);
 $('#manufacturerWarrantyReportMonth').value=new Date().toISOString().slice(0,7);
 let staged=null;
 function parseCsv(csv){
  const rows=[],line=[];let value='',quoted=false;
  for(let i=0;i<csv.length;i++){
   const c=csv[i];
   if(c==='"'){
    if(quoted&&csv[i+1]==='"'){value+='"';i++}else quoted=!quoted;
   }else if(c===','&&!quoted){line.push(value);value=''}
   else if((c==='\r'||c==='\n')&&!quoted){if(c==='\r'&&csv[i+1]==='\n')i++;line.push(value);if(line.some(x=>x.trim()))rows.push([...line]);line.length=0;value=''}
   else value+=c;
  }
  if(quoted)throw Error('Unclosed quoted CSV field');
  line.push(value);if(line.some(x=>x.trim()))rows.push(line);
  return rows;
 }
 const normalizeKey=k=>String(k||'').trim().toLowerCase().replace(/^\ufeff/,'').replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
 function mapCsv(source){
  if(source.length>500000)throw Error('File is larger than 500 KB; split into smaller reports');
  const matrix=parseCsv(source);if(matrix.length<2)throw Error('CSV contains no records');
  const header=matrix.shift().map(normalizeKey);
  const aliases={
   serial:['serial','serial_number','spa_serial','serial_no','serial_num','spa_serial_number','sn','s_n'],
   claim_number:['claim_number','claim_no','claim','warranty_claim','claim_id','service_claim'],
   claimed:['claimed','amount_claimed','claim_amount','total_claimed','billed_amount','invoice_amount'],
   approved:['approved','amount_approved','approved_amount','total_approved','credit','credit_amount','credited','credit_issued','warranty_credit','credit_value','credit_memo_amount'],
   paid:['paid','amount_paid','paid_amount','total_paid','payment_amount'],
   status:['status','claim_status','warranty_status'],
   payment_reference:['payment_reference','payment_id','check_number','check_no','reference','eft_reference'],
   notes:['notes','description','comments','repair_description']
  };
  const cols={};for(const [name,names] of Object.entries(aliases))cols[name]=header.findIndex(v=>names.includes(v));
  if(cols.serial<0)throw Error('No serial-number column found. Rename its column header to Serial Number.');
  const records=matrix.map((raw,i)=>{
   const result={};for(const [k,n] of Object.entries(cols))result[k]=n<0?'':String(raw[n]||'').trim();
   if(!result.serial)throw Error('CSV row '+(i+2)+' has no spa serial number');
   return result;
  });
  if(records.length>1000)throw Error('Import at most 1,000 rows per file');
  return records;
 }
 async function reloadSummary(){
  const holder=$('#manufacturerWarrantyTotals'),brands=$('#manufacturerWarrantyBreakdown'),customers=$('#manufacturerCustomerBalances');
  holder.textContent='Loading manufacturer and customer receivables…';
  try{
   const r=await api('/warranty/manufacturers/summary'),company=r.manufacturers||[],customer=r.customers||{};
   holder.innerHTML='<p><b>Manufacturers owe: '+fmt(r.manufacturer_unresolved)+'</b> · <b>Customers owe: '+fmt(customer.outstanding)+'</b> · <b>Total recorded unresolved: '+fmt(r.total_unresolved)+'</b></p>';
   brands.innerHTML='<table><thead><tr><th>Manufacturer</th><th>Claimed</th><th>Awaiting credit</th><th>Credit approved, not settled</th><th>Unresolved total</th></tr></thead><tbody>'+
    company.map(m=>'<tr><td>'+html(m.manufacturer)+(m.warranty_policy==='parts_only_customer_pays_labor'?' (parts only)':'')+'</td><td>'+fmt(m.claimed)+'</td><td>'+fmt(m.awaiting_credit)+'</td><td>'+fmt(m.credit_approved_not_settled)+'</td><td><b>'+fmt(m.total_unresolved)+'</b></td></tr>').join('')+'</tbody></table>';
   const b=customer.by_status||{};
   customers.innerHTML='<h4>Customer payment exceptions</h4><p>Declined cards: <b>'+fmt(b.declined)+'</b> · Processor errors: <b>'+fmt(b.processor_error)+'</b> · Authorized, not captured: <b>'+fmt(b.authorized_not_charged)+'</b> · Cash/check due: <b>'+fmt(b.cash_check_due)+'</b> · Authorization needed: <b>'+fmt(b.authorization_needed)+'</b></p><p class="muted">Customer balances stay open until payment succeeds. Manufacturer credits and bank deposits are tracked separately. Unverified invoice and claim balances are not proof of cash settlement.</p>';
  }catch(e){holder.textContent='Cross-brand receivables unavailable: '+e.message}
 }
 async function reload(){
  await reloadSummary();
  $('#manufacturerWarrantyPolicy').textContent=selectedManufacturer()==='aquasolus'?'AquaSolus: parts-only factory warranty. ALL labor is billed to the customer. Do not include labor in manufacturer claims.':'Manufacturer warranty terms must be verified for each claim.';
  const status=$('#calWarrantySummary');status.textContent='Loading service warranty claims…';
  try{
   const data=await api('/warranty/manufacturers/'+selectedManufacturer()+'/reconciliation'),s=data.summary;
   status.textContent='Claims '+s.claims+' | HTFO claimed '+fmt(s.claimed)+' | Still awaiting manufacturer credit '+fmt(s.uncredited_balance)+' | Approved but not received '+fmt(s.approved_not_received)+' | Total unresolved '+fmt(s.unreconciled_claim_balance)+' | Warranty jobs without claim '+s.warranty_jobs_without_claim;
   const claimed=data.claims||[];
   $('#calWarrantyClaims').innerHTML=claimed.length?'<table><thead><tr><th>Claim</th><th>Work order</th><th>Serial</th><th>Claimed</th><th>Credit approved</th><th>Actual receipts recorded</th><th>Awaiting credit</th><th>Approved not received</th><th>Status</th><th>Settlement</th></tr></thead><tbody>'+
    claimed.map(x=>'<tr><td>'+html(x.claim_number||('#'+x.id))+'</td><td>'+html(x.work_order_number)+'</td><td>'+html(x.serial_number)+'</td><td>'+fmt(x.total_claimed)+'</td><td>'+fmt(x.total_approved)+'</td><td>'+fmt(x.total_paid)+'</td><td>'+fmt(Math.max(0,Number(x.total_claimed)-Number(x.total_approved)))+'</td><td>'+fmt(Math.max(0,Number(x.total_approved)-Number(x.total_paid)))+'</td><td>'+html(x.status)+'</td><td><button type="button" data-record-cal-settlement="'+x.id+'">Record actual settlement</button></td></tr>').join('')+'</tbody></table>':'<p>No manufacturer claims recorded yet.</p>';

   $('#calWarrantyClaims').querySelectorAll('[data-record-cal-settlement]').forEach(b=>b.onclick=async()=>{
    const claim=claimed.find(x=>String(x.id)===String(b.dataset.recordCalSettlement));if(!claim)return;
    const kindChoice=prompt('Settlement type: enter BANK for actual bank deposit or VENDOR for an approved manufacturer credit that was actually applied against a vendor invoice.','VENDOR');
    if(kindChoice===null)return;
    const kind=kindChoice.trim().toUpperCase()==='BANK'?'bank_deposit':kindChoice.trim().toUpperCase()==='VENDOR'?'vendor_credit_applied':null;
    if(!kind)return alert('Enter BANK or VENDOR');
    const available=Math.max(0,Number(claim.total_approved)-Number(claim.total_paid));
    if(available<=0)return alert('No approved, unsettled credit is available on this claim.');
    const amt=prompt('Settlement amount ($), maximum '+fmt(available),String(available));
    if(amt===null)return;
    const amount=Number(amt);if(!Number.isFinite(amount)||amount<=0||amount>available)return alert('Amount must be positive and no more than the approved unsettled balance.');
    const ref=prompt(kind==='bank_deposit'?'Bank deposit/check reference:':'Manufacturer vendor invoice/credit application reference:','');
    if(ref===null)return;
    const settled_on=prompt('Date the deposit or vendor credit application ACTUALLY occurred (YYYY-MM-DD):',new Date().toISOString().slice(0,10));
    if(settled_on===null)return;
    if(!confirm('Confirm '+fmt(amount)+' was '+(kind==='bank_deposit'?'actually deposited to our bank':'actually applied against a manufacturer invoice')+'? This does not charge the customer.'))return;
    b.disabled=true;
    try{
     await api('/warranty/manufacturers/'+selectedManufacturer()+'/claims/'+claim.id+'/settlements',{method:'POST',body:JSON.stringify({amount,kind,reference:ref,settled_on,confirmed:true})});
     $('#calWarrantyCreditStatus').textContent='Settlement recorded with reference '+ref+'.';await reload();
    }catch(e){$('#calWarrantyCreditStatus').textContent='Not recorded: '+e.message}
    finally{b.disabled=false}
   });
   const batches=data.batches||[];
   $('#calWarrantyBatches').innerHTML=batches.length?batches.map(b=>'<div class="item"><b>'+html(b.file_name||'manufacturer report')+' · '+html(String(b.created_at||'').slice(0,10))+'</b><span>'+Number(b.row_count||0)+' rows · '+html(String(b.report_month||'').slice(0,7))+' · '+html(b.credit_mode==='cumulative_approved'?'Cumulative credit':'This month’s credit')+'</span><button type="button" data-apply-credits="'+b.id+'">Apply approved credits</button></div>').join(''):'<p>No monthly manufacturer reports uploaded yet.</p>';
   $('#calWarrantyBatches').querySelectorAll('[data-apply-credits]').forEach(b=>b.onclick=async()=>{
    const batchId=b.dataset.applyCredits;if(!confirm('Apply report #'+batchId+' as '+(batches.find(x=>String(x.id)===String(batchId))?.credit_mode==='cumulative_approved'?'cumulative approved-to-date credits':'credits issued this month')+'? Only uniquely matched claims will be updated. No bank payment or customer charge will be recorded.'))return;
    b.disabled=true;const note=$('#calWarrantyCreditStatus');note.textContent='Reviewing the report and applying verifiable credits…';
    try{
     const result=await api('/warranty/manufacturers/'+selectedManufacturer()+'/import-batches/'+batchId+'/apply-credits',{method:'POST',body:JSON.stringify({confirm:'APPLY_VERIFIED_MANUFACTURER_CREDITS'})});
     note.textContent=result.applied+' matched credits applied. Additional approved credit '+fmt(result.new_approved_credit)+'. '+result.already_applied+' previously applied; '+result.requires_review.length+' need manual review. Bank payments were NOT recorded.';
     if(result.requires_review.length)note.textContent+=' Exceptions: '+result.requires_review.slice(0,8).map(x=>'line '+x.line_id+': '+x.reason).join('; ');
     await reload();
    }catch(e){note.textContent='Credits NOT applied: '+e.message}
    finally{b.disabled=false}
   });
   const unclaimed=data.unclaimed_work_orders||[];
   $('#calWarrantyUnclaimed').innerHTML=unclaimed.length?unclaimed.map(w=>'<div class="item"><b>'+html(w.work_order_number)+' · '+html(w.serial_number)+'</b><span>'+html(w.customer_name)+' · Completed '+html(w.completed_at||'not yet')+'</span><span>Recorded labor '+fmt(w.labor_amount)+' · Parts '+fmt(w.parts_amount)+' · Trip '+fmt(w.trip_amount)+'</span><button type="button" class="secondary" data-claim-work="'+w.work_order_id+'">Create warranty claim</button></div>').join(''):'<p>Every matching warranty work order has a claim, or no warranty jobs are recorded.</p>';
   $('#calWarrantyUnclaimed').querySelectorAll('[data-claim-work]').forEach(b=>b.onclick=async()=>{
    const w=unclaimed.find(x=>String(x.work_order_id)===String(b.dataset.claimWork));if(!w)return;
    const claim_number=prompt('manufacturer claim number (leave empty if not assigned):','');if(claim_number===null)return;
    const labor=selectedManufacturer()==='aquasolus'?'0':prompt('Labor reimbursement claimed ($):',String(w.labor_amount||0));if(labor===null)return;
    const parts=prompt('Parts reimbursement claimed ($):',String(w.parts_amount||0));if(parts===null)return;
    const trip=selectedManufacturer()==='aquasolus'?'0':prompt('Trip reimbursement claimed ($):',String(w.trip_amount||0));if(trip===null)return;
    if(!confirm('Record '+(selectedManufacturer()==='aquasolus'?'PARTS-ONLY AquaSolus factory claim. Customer pays ALL labor and service charges.':'manufacturer warranty claim.')+' Work order '+w.work_order_number+' / '+w.serial_number+'? No payment will be recorded.'))return;
    try{
     b.disabled=true;
     await api('/work-orders/'+w.work_order_id+'/warranty-claim',{method:'POST',body:JSON.stringify({supplier:selectedManufacturerName().replace(' (legacy)',''),claim_number,status:'draft',labor_claimed:Number(labor),parts_claimed:Number(parts),trip_claimed:Number(trip),notes:'Created from serialized warranty work order'})});
     await reload();
    }catch(e){alert('Claim was not created: '+e.message);b.disabled=false}
   });
   const st=data.settlements||[];
   $('#calWarrantySettlements').innerHTML=st.length?st.map(v=>'<div class="item"><b>Claim #'+html(v.claim_id)+' — '+fmt(v.amount)+'</b><span>'+html(v.kind==='bank_deposit'?'Bank deposit':'Vendor credit applied')+' · '+html(v.reference)+' · '+html(String(v.settled_on).slice(0,10))+'</span></div>').join(''):'<p>No verified credit applications or deposits recorded yet.</p>';
   const lines=data.imports||[];
   $('#calWarrantyImports').innerHTML=lines.length?'<table><thead><tr><th>Import</th><th>Serial</th><th>Claim</th><th>Work order</th><th>Match</th><th>Manufacturer claimed</th><th>Manufacturer approved</th><th>Manufacturer reported paid</th><th>HTFO claimed</th><th>HTFO recorded paid</th></tr></thead><tbody>'+
    lines.map(x=>'<tr><td>'+html(x.file_name)+' · '+html(x.imported_at?.slice(0,10))+'</td><td>'+html(x.serial_number)+'</td><td>'+html(x.claim_number)+'</td><td>'+html(x.work_order_number)+'</td><td>'+html(x.match_status)+'</td><td>'+fmt(x.reported_claimed)+'</td><td>'+fmt(x.reported_approved)+'</td><td>'+fmt(x.reported_paid)+'</td><td>'+fmt(x.internal_claimed)+'</td><td>'+fmt(x.internal_paid)+'</td></tr>').join('')+'</tbody></table>':'<p>No manufacturer CSV reports imported yet.</p>';
  }catch(e){status.textContent='Warranty report unavailable: '+e.message}
 }
 button.onclick=()=>{showView('warrantyReconciliation');reload()};
 $('#manufacturerWarrantyBrand').onchange=()=>{staged=null;$('#calWarrantyCommit').disabled=true;$('#calWarrantyImportPreview').replaceChildren();reload()};
 const originalShowApp=showApp;
 showApp=function(user){
  originalShowApp(user);
  const role=String(user?.role||'').toLowerCase(),name=String(user?.username||user?.name||'').toLowerCase();
  button.hidden=!['owner','admin'].includes(role)&&!['ray','ray morrow','raymond morrow'].includes(name);
 };
 $('#calWarrantyRefresh').onclick=reload;
 $('#calWarrantyPreview').onclick=async()=>{
  const file=$('#calWarrantyFile').files?.[0],status=$('#calWarrantyImportStatus');
  staged=null;$('#calWarrantyCommit').disabled=true;$('#calWarrantyImportPreview').replaceChildren();
  if(!file)return status.textContent='Choose a CSV file first.';
  try{
   const rows=mapCsv(await file.text());
   const preview=await api('/warranty/manufacturers/'+selectedManufacturer()+'/preview',{method:'POST',body:JSON.stringify({rows})});
   staged={rows,file_name:file.name,credit_mode:$('#calWarrantyCreditMode').value,report_month:$('#manufacturerWarrantyReportMonth').value};const counts=preview.counts;
   status.textContent='Previewed '+rows.length+' records. '+Object.entries(counts).map(([k,v])=>k+': '+v).join(' · ')+'. No data was changed.';
   const table=document.createElement('table');table.innerHTML='<thead><tr><th>Serial</th><th>Claim #</th><th>Work order</th><th>Match</th><th>Claimed</th><th>Approved</th><th>Paid</th></tr></thead><tbody>'+preview.rows.map(x=>'<tr><td>'+html(x.serial)+'</td><td>'+html(x.claim_number)+'</td><td>'+html(x.internal?.work_order_number)+'</td><td>'+html(x.match_status)+'</td><td>'+fmt(x.reported_claimed)+'</td><td>'+fmt(x.reported_approved)+'</td><td>'+fmt(x.reported_paid)+'</td></tr>').join('')+'</tbody>';
   $('#calWarrantyImportPreview').append(table);
   $('#calWarrantyCommit').disabled=false;
  }catch(e){status.textContent='Preview failed: '+e.message}
 };
 $('#manufacturerWarrantyReportMonth').onchange=()=>{staged=null;$('#calWarrantyCommit').disabled=true;$('#calWarrantyImportStatus').textContent='Statement month changed. Preview the file again.'};
 $('#calWarrantyCreditMode').onchange=()=>{staged=null;$('#calWarrantyCommit').disabled=true;$('#calWarrantyImportStatus').textContent='Credit interpretation changed. Preview the file again.'};
 $('#calWarrantyFile').onchange=()=>{staged=null;$('#calWarrantyCommit').disabled=true;$('#calWarrantyImportPreview').replaceChildren()};
 $('#calWarrantyCommit').onclick=async()=>{
  if(!staged)return;
  if(!confirm('Store this manufacturer report as manufacturer evidence? It will not mark any invoices or claims paid.'))return;
  const b=$('#calWarrantyCommit');b.disabled=true;
  try{
   const x=await api('/warranty/manufacturers/'+selectedManufacturer()+'/import',{method:'POST',body:JSON.stringify({...staged,confirm:'IMPORT_AS_EVIDENCE'})});
   $('#calWarrantyImportStatus').textContent='Saved evidence batch #'+x.batch_id+': '+x.imported+' rows. Internal invoices and payments unchanged.';
   staged=null;await reload();
  }catch(e){$('#calWarrantyImportStatus').textContent='Import failed: '+e.message}
 };
 $('#calWarrantyExport').onclick=async()=>{
  const response=await fetch(API+'/warranty/manufacturers/'+selectedManufacturer()+'/reconciliation.csv',{headers:{Authorization:'Bearer '+token}});
  if(!response.ok){alert('CSV download unavailable');return}
  const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='HTFO-'+selectedManufacturer()+'-Warranty-Receivables.csv';a.click();URL.revokeObjectURL(url);
 };
})();
