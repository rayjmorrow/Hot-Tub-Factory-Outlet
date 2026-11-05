// HTFO owner-only manufacturer warranty evidence and receivables reconciliation.
(()=>{
 const $=s=>document.querySelector(s);
 const html=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fmt=v=>Number(v||0).toLocaleString('en-US',{style:'currency',currency:'USD'});
 const nav=document.querySelector('nav'),main=document.querySelector('main');
 if(!nav||!main)return;
 const button=document.createElement('button');button.dataset.view='warrantyReconciliation';button.textContent='Cal Spas Warranty';button.hidden=true;nav.append(button);
 const section=document.createElement('section');section.id='warrantyReconciliation';section.className='view';section.hidden=true;
 section.innerHTML=`<h2>Cal Spas — Warranty Reconciliation</h2>
 <p class="muted">Owner-only. Match manufacturer CSV records against serialized spa service history and our claims. Uploaded amounts are evidence, not recorded payments.</p>
 <button type="button" id="calWarrantyRefresh">Refresh warranty balances</button>
 <button type="button" id="calWarrantyExport">Download HTFO claim evidence (CSV)</button>
 <p id="calWarrantySummary" role="status"></p>
 <div class="card"><h3>Import Cal Spas CSV</h3>
 <p class="muted">Required column: serial number. Optional columns: claim number, claimed, approved, paid, status, payment reference, notes. Rows must be reviewed before storing as manufacturer evidence.</p>
 <label>Manufacturer report <input id="calWarrantyFile" type="file" accept=".csv,text/csv"></label>
 <button type="button" id="calWarrantyPreview">Preview matches</button>
 <button type="button" id="calWarrantyCommit" disabled>Save reviewed report as evidence</button>
 <p id="calWarrantyImportStatus" role="status"></p>
 <div id="calWarrantyImportPreview" style="max-height:310px;overflow:auto"></div></div>
 <div class="card"><h3>Cal Spas outstanding claims</h3><div id="calWarrantyClaims" style="overflow:auto"></div></div>
 <div class="card"><h3>Warranty jobs without a manufacturer claim</h3><p class="muted">Create an HTFO claim from an existing completed warranty service work order. A technician's work record is evidence; a supplier acknowledgement is separate.</p><div id="calWarrantyUnclaimed"></div></div>
 <div class="card"><h3>Manufacturer report lines and exceptions</h3><div id="calWarrantyImports" style="overflow:auto"></div></div>`;
 main.append(section);
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
   approved:['approved','amount_approved','approved_amount','total_approved'],
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
 async function reload(){
  const status=$('#calWarrantySummary');status.textContent='Loading service warranty claims…';
  try{
   const data=await api('/warranty/cal-spas/reconciliation'),s=data.summary;
   status.textContent='HTFO claims '+s.claims+' | Claimed '+fmt(s.claimed)+' | Recorded paid '+fmt(s.recorded_paid)+' | Unreconciled balance '+fmt(s.unreconciled_claim_balance)+' | Warranty jobs without claim '+s.warranty_jobs_without_claim;
   const claimed=data.claims||[];
   $('#calWarrantyClaims').innerHTML=claimed.length?'<table><thead><tr><th>Claim</th><th>Work order</th><th>Serial</th><th>Claimed</th><th>Approved</th><th>Recorded paid</th><th>Remaining</th><th>Status</th></tr></thead><tbody>'+
    claimed.map(x=>'<tr><td>'+html(x.claim_number||('#'+x.id))+'</td><td>'+html(x.work_order_number)+'</td><td>'+html(x.serial_number)+'</td><td>'+fmt(x.total_claimed)+'</td><td>'+fmt(x.total_approved)+'</td><td>'+fmt(x.total_paid)+'</td><td>'+fmt(Math.max(0,Number(x.total_claimed)-Number(x.total_paid)))+'</td><td>'+html(x.status)+'</td></tr>').join('')+'</tbody></table>':'<p>No Cal Spas claims recorded yet.</p>';
   const unclaimed=data.unclaimed_work_orders||[];
   $('#calWarrantyUnclaimed').innerHTML=unclaimed.length?unclaimed.map(w=>'<div class="item"><b>'+html(w.work_order_number)+' · '+html(w.serial_number)+'</b><span>'+html(w.customer_name)+' · Completed '+html(w.completed_at||'not yet')+'</span><span>Recorded labor '+fmt(w.labor_amount)+' · Parts '+fmt(w.parts_amount)+' · Trip '+fmt(w.trip_amount)+'</span><button type="button" class="secondary" data-claim-work="'+w.work_order_id+'">Create warranty claim</button></div>').join(''):'<p>Every matching warranty work order has a claim, or no warranty jobs are recorded.</p>';
   $('#calWarrantyUnclaimed').querySelectorAll('[data-claim-work]').forEach(b=>b.onclick=async()=>{
    const w=unclaimed.find(x=>String(x.work_order_id)===String(b.dataset.claimWork));if(!w)return;
    const claim_number=prompt('Cal Spas claim number (leave empty if not assigned):','');if(claim_number===null)return;
    const labor=prompt('Labor reimbursement claimed ($):',String(w.labor_amount||0));if(labor===null)return;
    const parts=prompt('Parts reimbursement claimed ($):',String(w.parts_amount||0));if(parts===null)return;
    const trip=prompt('Trip reimbursement claimed ($):',String(w.trip_amount||0));if(trip===null)return;
    if(!confirm('Record this HTFO warranty claim for '+w.work_order_number+' / '+w.serial_number+'? This does not mark it approved or paid.'))return;
    try{
     b.disabled=true;
     await api('/work-orders/'+w.work_order_id+'/warranty-claim',{method:'POST',body:JSON.stringify({supplier:'Cal Spas',claim_number,status:'draft',labor_claimed:Number(labor),parts_claimed:Number(parts),trip_claimed:Number(trip),notes:'Created from serialized warranty work order'})});
     await reload();
    }catch(e){alert('Claim was not created: '+e.message);b.disabled=false}
   });
   const lines=data.imports||[];
   $('#calWarrantyImports').innerHTML=lines.length?'<table><thead><tr><th>Import</th><th>Serial</th><th>Claim</th><th>Work order</th><th>Match</th><th>Cal claimed</th><th>Cal approved</th><th>Cal reported paid</th><th>HTFO claimed</th><th>HTFO recorded paid</th></tr></thead><tbody>'+
    lines.map(x=>'<tr><td>'+html(x.file_name)+' · '+html(x.imported_at?.slice(0,10))+'</td><td>'+html(x.serial_number)+'</td><td>'+html(x.claim_number)+'</td><td>'+html(x.work_order_number)+'</td><td>'+html(x.match_status)+'</td><td>'+fmt(x.reported_claimed)+'</td><td>'+fmt(x.reported_approved)+'</td><td>'+fmt(x.reported_paid)+'</td><td>'+fmt(x.internal_claimed)+'</td><td>'+fmt(x.internal_paid)+'</td></tr>').join('')+'</tbody></table>':'<p>No manufacturer CSV reports imported yet.</p>';
  }catch(e){status.textContent='Warranty report unavailable: '+e.message}
 }
 button.onclick=()=>{showView('warrantyReconciliation');reload()};
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
   const preview=await api('/warranty/cal-spas/preview',{method:'POST',body:JSON.stringify({rows})});
   staged={rows,file_name:file.name};const counts=preview.counts;
   status.textContent='Previewed '+rows.length+' records. '+Object.entries(counts).map(([k,v])=>k+': '+v).join(' · ')+'. No data was changed.';
   const table=document.createElement('table');table.innerHTML='<thead><tr><th>Serial</th><th>Claim #</th><th>Work order</th><th>Match</th><th>Claimed</th><th>Approved</th><th>Paid</th></tr></thead><tbody>'+preview.rows.map(x=>'<tr><td>'+html(x.serial)+'</td><td>'+html(x.claim_number)+'</td><td>'+html(x.internal?.work_order_number)+'</td><td>'+html(x.match_status)+'</td><td>'+fmt(x.reported_claimed)+'</td><td>'+fmt(x.reported_approved)+'</td><td>'+fmt(x.reported_paid)+'</td></tr>').join('')+'</tbody>';
   $('#calWarrantyImportPreview').append(table);
   $('#calWarrantyCommit').disabled=false;
  }catch(e){status.textContent='Preview failed: '+e.message}
 };
 $('#calWarrantyFile').onchange=()=>{staged=null;$('#calWarrantyCommit').disabled=true;$('#calWarrantyImportPreview').replaceChildren()};
 $('#calWarrantyCommit').onclick=async()=>{
  if(!staged)return;
  if(!confirm('Store this Cal Spas report as manufacturer evidence? It will not mark any invoices or claims paid.'))return;
  const b=$('#calWarrantyCommit');b.disabled=true;
  try{
   const x=await api('/warranty/cal-spas/import',{method:'POST',body:JSON.stringify({...staged,confirm:'IMPORT_AS_EVIDENCE'})});
   $('#calWarrantyImportStatus').textContent='Saved evidence batch #'+x.batch_id+': '+x.imported+' rows. Internal invoices and payments unchanged.';
   staged=null;await reload();
  }catch(e){$('#calWarrantyImportStatus').textContent='Import failed: '+e.message}
 };
 $('#calWarrantyExport').onclick=async()=>{
  const response=await fetch(API+'/warranty/cal-spas/reconciliation.csv',{headers:{Authorization:'Bearer '+token}});
  if(!response.ok){alert('CSV download unavailable');return}
  const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='HTFO-Cal-Spas-Warranty-Receivables.csv';a.click();URL.revokeObjectURL(url);
 };
})();
