const API=(localStorage.getItem('htfoServiceApi')||'').replace(/\/$/,'')+'/api/service';
let token=sessionStorage.getItem('htfoServiceToken')||'',user=null,currentJob=null,currentInvoice=null,fieldMonth=new Date(new Date().getFullYear(),new Date().getMonth(),1),lastCalendarRows=[];
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)],money=n=>Number(n||0).toLocaleString('en-US',{style:'currency',currency:'USD'}),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path,opts={}){const r=await fetch(API+path,{...opts,headers:{'Content-Type':'application/json',...(opts.headers||{}),...(token?{Authorization:`Bearer ${token}`}:{})}}),j=await r.json().catch(()=>({}));if(!r.ok){if(r.status===401)logout();throw new Error(j.error||`Request failed (${r.status})`)}return j}
function logout(){token='';user=null;sessionStorage.removeItem('htfoServiceToken');$('#app').hidden=true;$('#login').hidden=false}
function localYmd(d=new Date()){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function time(v){return v?new Date(v).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}):'Unscheduled'}
function addr(w){return [w.street,w.street2,w.city,w.state,w.zip].filter(Boolean).join(', ')}
function wazeUrl(w){const a=addr(w);return a?`https://waze.com/ul?q=${encodeURIComponent(a)}&navigate=yes`:''}
function wazeLink(w,label='Open in Waze'){const u=wazeUrl(w);return u?`<a class=\"waze-link\" href=\"${u}\" target=\"_blank\" rel=\"noopener\">${esc(label)}</a>`:''}
function mine(rows){if(!user?.name&&!user?.username)return rows;const who=String(user?.name||user?.username||'').trim().toLowerCase();return rows.filter(w=>[w.assigned_to,w.assigned_team].some(v=>String(v||'').trim().toLowerCase()===who)||(/delivery/.test(who)&&String(w.job_type||'')==='delivery'))}
function canManageCalendar(){return ['admin','owner','manager','service_manager'].includes(String(user?.role||'').toLowerCase())}
function visibleRows(rows){return canManageCalendar()?rows:mine(rows)}
async function boot(){if(!token)return;try{const x=await api('/me');user=x.user;showApp()}catch{logout()}}
function showApp(){$('#login').hidden=true;$('#app').hidden=false;$('#who').textContent=user?.name||user?.username||'';const deliveryUser=/delivery/i.test(String(user?.name||user?.username||''));if(deliveryUser){const h=$('#jobsView h1');if(h)h.textContent='Delivery Loop';const w=$('#weekView h1');if(w)w.textContent='Upcoming Deliveries';}$('#todayLabel').textContent=new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});$('#showAll').checked=canManageCalendar();$('#weekSubtitle').textContent=canManageCalendar()?'Full dispatch view. Tap a job to open it.':'Read-only look ahead at your assigned work.';$('#calendarSubtitle').textContent=canManageCalendar()?'Full dispatch calendar — tap a day to schedule, edit, or reassign.':'Tap a day to see your assigned jobs.';showFieldView('jobsView')}
function showFieldView(id){$$('.fieldview').forEach(v=>v.hidden=v.id!==id);$$('[data-field-view]').forEach(b=>b.classList.toggle('active',b.dataset.fieldView===id));if(id==='jobsView')loadJobs();if(id==='weekView')loadWeek();if(id==='calendarView')loadFieldCalendar()}
$$('[data-field-view]').forEach(b=>b.onclick=()=>showFieldView(b.dataset.fieldView));
$('#loginForm').onsubmit=async e=>{e.preventDefault();$('#loginError').textContent='';try{const x=await api('/auth/login',{method:'POST',body:JSON.stringify({username:$('#username').value,password:$('#password').value})});token=x.token;user=x.user;sessionStorage.setItem('htfoServiceToken',token);showApp()}catch(err){$('#loginError').textContent=err.message}};
$('#logout').onclick=logout;$('#backJobs').onclick=()=>showFieldView('jobsView');$('#showAll').onchange=loadJobs;
async function loadJobs(){const rows=await api('/work-orders');const today=localYmd();let items=rows.filter(w=>w.scheduled_start&&localYmd(new Date(w.scheduled_start))===today);if(!$('#showAll').checked)items=mine(items);items.sort((a,b)=>new Date(a.scheduled_start)-new Date(b.scheduled_start));$('#jobs').innerHTML=items.map(w=>`<article class="job"><div class="row"><span class="pill">${esc(w.status)}</span><span class="muted">${esc(w.assigned_to||'Unassigned')}</span></div><h3>${time(w.scheduled_start)} · ${esc(w.customer_name||'Customer')}</h3><div>${esc(w.complaint||'Service call')}</div><div class="muted">${esc([w.city,w.state].filter(Boolean).join(', '))}</div><div>${wazeLink(w,'Navigate with Waze')}</div><button class="primary" data-open="${w.id}">${w.job_type==='delivery'?'Open Delivery':'Open Job'}</button></article>`).join('')||'<div class="card"><b>No jobs shown.</b><p class="muted">Use “Show all techs” if you need to see the full dispatch schedule.</p></div>';$$('[data-open]').forEach(b=>b.onclick=()=>openJob(b.dataset.open))}
async function loadWeek(){const start=new Date();start.setHours(0,0,0,0);const end=new Date(start);end.setDate(end.getDate()+7);const rows=visibleRows(await api(`/work-orders?from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(end.toISOString())}`)).filter(w=>w.scheduled_start).sort((a,b)=>new Date(a.scheduled_start)-new Date(b.scheduled_start));let last='';$('#weekJobs').innerHTML=rows.map(w=>{const d=new Date(w.scheduled_start),key=localYmd(d);let head='';if(key!==last){last=key;head=`<h3>${d.toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'})}</h3>`}return `${head}<article class="job"><div class="row"><span class="pill">${esc(w.status)}</span><span class="muted">${esc(w.assigned_to||'')}</span></div><h3>${time(w.scheduled_start)} · ${esc(w.customer_name||'Customer')}</h3><div>${esc(w.complaint||'Service call')}</div><div class="muted">${esc([w.city,w.state].filter(Boolean).join(', '))}</div><div>${wazeLink(w,'Navigate with Waze')}</div><button class="primary" data-open-week="${w.id}">${w.job_type==='delivery'?'Open Delivery':'Open Job'}</button></article>`}).join('')||'<div class="card"><b>No jobs scheduled in the next 7 days.</b></div>';$$('[data-open-week]').forEach(b=>b.onclick=()=>openJob(b.dataset.openWeek))}
function monthBounds(d){const start=new Date(d.getFullYear(),d.getMonth(),1);const end=new Date(d.getFullYear(),d.getMonth()+1,1);return{start,end}}
async function loadFieldCalendar(){const {start,end}=monthBounds(fieldMonth);lastCalendarRows=visibleRows(await api(`/work-orders?from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(end.toISOString())}`)).filter(w=>w.scheduled_start);$('#fieldMonthLabel').textContent=(canManageCalendar()?'Dispatch Calendar — ':'')+fieldMonth.toLocaleDateString('en-US',{month:'long',year:'numeric'});const first=new Date(fieldMonth.getFullYear(),fieldMonth.getMonth(),1),gridStart=new Date(first);gridStart.setDate(first.getDate()-first.getDay());let html=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>`<div class="calhead">${d}</div>`).join('');for(let i=0;i<42;i++){const d=new Date(gridStart);d.setDate(gridStart.getDate()+i);const key=localYmd(d),items=lastCalendarRows.filter(w=>localYmd(new Date(w.scheduled_start))===key);html+=`<button type="button" class="calday ${d.getMonth()!==fieldMonth.getMonth()?'other':''} ${items.length?'hasjobs':''}" data-cal-date="${key}"><span class="date">${d.getDate()}</span>${items.length?`<span class="count">${items.length} job${items.length===1?'':'s'}</span>`:''}</button>`}$('#fieldCalendar').innerHTML=html;$$('[data-cal-date]').forEach(b=>b.onclick=()=>showCalendarDay(b.dataset.calDate));$('#calendarDayDetail').hidden=true}
function showCalendarDay(key){const items=lastCalendarRows.filter(w=>localYmd(new Date(w.scheduled_start))===key).sort((a,b)=>new Date(a.scheduled_start)-new Date(b.scheduled_start)),d=new Date(key+'T12:00:00');$('#calendarDayDetail').hidden=false;$('#calendarDayDetail').innerHTML=`<div class="row" style="justify-content:space-between;align-items:flex-start"><h2>${d.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})}</h2>${canManageCalendar()?`<button class="primary" data-new-dispatch="${key}">+ Schedule Job</button>`:''}</div>${items.length?items.map(w=>`<div class="dayjob ${w.job_type==='delivery'?'delivery':''}"><b>${time(w.scheduled_start)} · ${esc(w.customer_name||'Customer')}</b><div>${esc(w.complaint||'Service call')}</div><div class="muted">${esc(w.job_type||'service')} · ${esc(w.assigned_to||'Unassigned')} · ${esc([w.city,w.state].filter(Boolean).join(', '))}</div><div>${wazeLink(w,'Navigate with Waze')}</div><div class="row"><button class="ghost dark" data-open-cal="${w.id}">${w.job_type==='delivery'?'Open Delivery':'Open Job'}</button>${canManageCalendar()?`<button class="primary" data-edit-cal="${w.id}">Edit / Reassign</button>`:''}</div></div>`).join(''):'<p class="muted">No jobs scheduled.</p>'}`;$$('[data-open-cal]').forEach(b=>b.onclick=()=>openJob(b.dataset.openCal));$$('[data-new-dispatch]').forEach(b=>b.onclick=()=>openDispatchEditor({date:b.dataset.newDispatch}));$$('[data-edit-cal]').forEach(b=>b.onclick=()=>openDispatchEditor({work:lastCalendarRows.find(w=>String(w.id)===String(b.dataset.editCal))}))}
$('#prevFieldMonth').onclick=()=>{fieldMonth=new Date(fieldMonth.getFullYear(),fieldMonth.getMonth()-1,1);loadFieldCalendar()};$('#nextFieldMonth').onclick=()=>{fieldMonth=new Date(fieldMonth.getFullYear(),fieldMonth.getMonth()+1,1);loadFieldCalendar()};
async function openDispatchEditor({date='',work=null}={}){if(!canManageCalendar())return;$('#dispatchWorkId').value=work?.id||'';$('#dispatchTitle').textContent=work?'Edit / Reassign Job':'Schedule Job';$('#dispatchCustomerWrap').hidden=Boolean(work);if(!work){const customers=await api('/customers');$('#dispatchCustomer').innerHTML='<option value="">Select customer…</option>'+customers.map(c=>`<option value="${c.id}">${esc([c.first_name,c.last_name].filter(Boolean).join(' ')||c.company||c.email||c.phone||'Customer')}</option>`).join('')}const when=work?.scheduled_start?new Date(work.scheduled_start):null;$('#dispatchDate').value=work?localYmd(when):date;$('#dispatchTime').value=work?`${String(when.getHours()).padStart(2,'0')}:${String(when.getMinutes()).padStart(2,'0')}`:'09:00';$('#dispatchType').value=work?.job_type||'service';$('#dispatchAssigned').value=work?.assigned_to||($('#dispatchType').value==='delivery'?'Delivery':'Bill');$('#dispatchDescription').value=work?.complaint||'';$('#dispatchDialog').showModal()}
$('#dispatchType').onchange=()=>{if($('#dispatchType').value==='delivery')$('#dispatchAssigned').value='Delivery'};
$('#saveDispatch').onclick=async e=>{e.preventDefault();if(!canManageCalendar())return;const id=$('#dispatchWorkId').value,date=$('#dispatchDate').value,timeValue=$('#dispatchTime').value;if(!date||!timeValue)return alert('Date and time are required.');const scheduled=new Date(`${date}T${timeValue}:00`).toISOString();try{if(id){const w=lastCalendarRows.find(x=>String(x.id)===String(id));await api(`/work-orders/${id}`,{method:'PATCH',body:JSON.stringify({assigned_to:$('#dispatchAssigned').value,job_type:$('#dispatchType').value,scheduled_start:scheduled,complaint:$('#dispatchDescription').value,status:w?.status||'scheduled',labor_hours:Number(w?.labor_hours||0),labor_amount:Number(w?.labor_amount||0),parts_amount:Number(w?.parts_amount||0),trip_amount:Number(w?.trip_amount||0),tax_amount:Number(w?.tax_amount||0),warranty:Boolean(w?.warranty)})})}else{const customer=$('#dispatchCustomer').value;if(!customer)return alert('Select a customer.');await api('/work-orders',{method:'POST',body:JSON.stringify({customer_id:customer,assigned_to:$('#dispatchAssigned').value,assigned_team:$('#dispatchAssigned').value==='Delivery'?'Delivery':null,job_type:$('#dispatchType').value,scheduled_start:scheduled,complaint:$('#dispatchDescription').value,status:'scheduled'})})}$('#dispatchDialog').close();fieldMonth=new Date(Number(date.slice(0,4)),Number(date.slice(5,7))-1,1);await loadFieldCalendar();showCalendarDay(date)}catch(err){alert(err.message)}};
async function openJob(id){const x=await api('/field/work-orders/'+id);currentJob=x.workOrder;currentInvoice=x.invoice;$('.fieldview').forEach(v=>v.hidden=true);$('#jobView').hidden=false;$('#backJobs').textContent=String(currentJob.job_type)==='delivery'?'← Back to Delivery Loop':'← Today’s Jobs';renderJob(x)}

function renderJob(x){if(String(x.workOrder?.job_type||'')==='delivery')return renderDeliveryWizard(x);return renderServiceJob(x)}
function renderServiceJob(x){const w=x.workOrder,i=x.invoice,balance=i?Number(i.balance||0):0;$('#jobDetail').innerHTML=`<div class="panel"><div class="row"><span class="pill">${esc(w.status)}</span><span class="muted">${esc(w.work_order_number)}</span></div><h1>${esc(w.customer_name)}</h1><div><a href="tel:${esc(w.phone||'')}">${esc(w.phone||'No phone')}</a></div><div>${esc(addr(w))}</div><div class="muted">${esc([w.equipment_type,w.brand,w.model,w.serial_number&&('S/N '+w.serial_number)].filter(Boolean).join(' · '))}</div></div><div class="panel"><h2>Work</h2><label>Status<select id="fieldStatus"><option>scheduled</option><option>confirmed</option><option>en route</option><option>on site</option><option>awaiting parts</option><option>return visit needed</option><option>completed</option></select></label><label>Diagnosis<textarea id="fieldDiagnosis" rows="3">${esc(w.diagnosis||'')}</textarea></label><label>Work performed<textarea id="fieldWork" rows="3">${esc(w.work_performed||'')}</textarea></label><div class="grid2"><label>Labor hours<input id="fieldHours" type="number" min="0" step="0.25" value="${Number(w.labor_hours||0)}"></label><label>Parts used<input id="fieldParts" value="${esc(w.parts_used||'')}"></label></div><button id="saveFieldWork" class="primary">Save Job Update</button></div><div class="panel"><h2>Invoice</h2>${i?`<div class="money">${money(i.total_amount)}</div><div>Paid ${money(i.amount_paid)} · <b>${money(balance)} balance</b></div><div class="muted">${esc(i.invoice_number)} · ${esc(i.status)}</div>${x.payments.length?`<h3>Payments</h3>${x.payments.map(p=>`<div>${money(p.amount)} · ${esc(p.payment_method)}${p.reference_number?` #${esc(p.reference_number)}`:''}<span class="muted"> · ${esc(p.collected_by_name||'')}</span></div>`).join('')}`:''}${balance>0?'<div class="paybar"><button id="collectPayment" class="primary">Collect Payment</button></div>':'<p class="ok">PAID IN FULL</p>'}`:`<p>No invoice yet.</p><button id="createInvoice" class="primary">Create Invoice</button>`}</div>`;$('#fieldStatus').value=w.status||'scheduled';$('#saveFieldWork').onclick=saveWork;if($('#createInvoice'))$('#createInvoice').onclick=createInvoice;if($('#collectPayment'))$('#collectPayment').onclick=()=>openPayment(i)}


function deliveryReadyStep(w){
  if(!w.delivery_correct_spa||!String(w.delivery_serial_number||'').trim())return 2;
  if(!w.delivery_package_confirmed)return 3;
  if(!w.delivery_damage_reviewed)return 4;
  if(!w.delivery_proof_photo)return 5;
  if(!w.delivery_happy_photo)return 6;
  if(!w.delivery_customer_reviewed)return 7;
  if(!w.delivery_acceptance_confirmed)return 8;
  if(!w.delivery_signature_accepted||!w.delivery_signature_data)return 9;
  return 10;
}
async function imageDataFromFile(file){
  if(!file)return null;
  return await new Promise((resolve,reject)=>{
    const fr=new FileReader();
    fr.onerror=reject;
    fr.onload=()=>{
      const img=new Image();
      img.onerror=reject;
      img.onload=()=>{
        const max=1024,scale=Math.min(1,max/Math.max(img.width,img.height));
        const c=document.createElement('canvas');c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);
        c.getContext('2d').drawImage(img,0,0,c.width,c.height);
        resolve(c.toDataURL('image/jpeg',.65));
      };
      img.src=fr.result;
    };
    fr.readAsDataURL(file);
  });
}
async function saveDeliveryProgress(payload){
  const r=await api('/field/deliveries/'+currentJob.id+'/progress',{method:'PATCH',body:JSON.stringify(payload)});
  currentJob={...currentJob,...r};
  return r;
}
function renderDeliveryWizard(x){
  const w=x.workOrder, brand=String(w.brand||''), model=String(w.model||''), addrText=addr(w), defaultLifter=!/innova|eco/i.test(brand)?'Spa Ease 100':'';
  const lifter=w.delivery_cover_lifter||defaultLifter;
  const orderItems=Array.isArray(x.deliveryOrderItems)?x.deliveryOrderItems:[];
  const orderItemChecks=orderItems.map(i=>`<label class="confirm-tile"><input type="checkbox" class="deliveryPackage"> ${esc(String(i.quantity||1))} × ${esc(i.description||'Order item')}</label>`).join('');
  const orderReview=orderItems.length?orderItems.map(i=>`${esc(String(i.quantity||1))} × ${esc(i.description||'Order item')}`).join('<br>'):'No additional order items';
  const startStep=deliveryReadyStep(w);
  $('#jobDetail').innerHTML=`
  <div class="delivery-wizard">
    <div class="delivery-topline"><button type="button" class="ghost dark" id="loopBack">← BACK TO DELIVERY LOOP</button><span class="pill">${esc(w.status)}</span></div>
    <div class="wizard-progress"><b id="deliveryStepLabel">STEP ${startStep} OF 10</b><div class="wizard-track"><div id="deliveryStepBar"></div></div></div>

    <section class="delivery-step" data-dstep="1">
      <div class="panel wizard-card"><div class="step-kicker">STEP 1 · GET THERE</div><h1>TODAY'S DELIVERY</h1>
      <h2>${esc(w.customer_name||'Customer')}</h2><p><b>${esc([brand,model].filter(Boolean).join(' ')||w.complaint||'Spa delivery')}</b></p>
      <p>${esc(addrText)}<br><a href="tel:${esc(w.phone||'')}">${esc(w.phone||'No phone')}</a></p>
      ${wazeLink(w,'OPEN IN WAZE')}
      <button type="button" class="primary huge" data-dnext>I'M AT THE CUSTOMER → CONTINUE</button></div>
    </section>

    <section class="delivery-step" data-dstep="2">
      <div class="panel wizard-card"><div class="step-kicker">STEP 2 · VERIFY SPA</div><h1>Is this the correct spa?</h1>
      <p><b>Expected:</b> ${esc([brand,model].filter(Boolean).join(' ')||'Spa')}</p>
      <label class="confirm-tile"><input type="checkbox" id="deliveryCorrectSpa" ${w.delivery_correct_spa?'checked':''}> YES — THIS IS THE CORRECT SPA</label>
      <label>ENTER SERIAL NUMBER FROM THE SPA<input id="deliverySerial" value="${esc(w.delivery_serial_number||w.serial_number||'')}" autocomplete="off"></label>
      <button type="button" class="primary huge" data-dnext>SAVE & CONTINUE</button>
      <button type="button" class="ghost dark huge" id="wrongSpa">NO — REPORT A PROBLEM</button></div>
    </section>

    <section class="delivery-step" data-dstep="3">
      <div class="panel wizard-card"><div class="step-kicker">STEP 3 · VERIFY INCLUDED ITEMS</div><h1>Check every item.</h1>
      <label class="confirm-tile"><input type="checkbox" class="deliveryPackage"> Promo Step is here</label>
      <label class="confirm-tile"><input type="checkbox" class="deliveryPackage"> Frog Ease Start-Up Kit is here</label>
      ${orderItemChecks}
      <label>Cover lifter<input id="deliveryLifter" value="${esc(lifter)}" placeholder="Spa Ease 100 or replacement model"></label>
      <label class="confirm-tile"><input type="checkbox" class="deliveryPackage"> Cover lifter / accessory status verified</label>
      <button type="button" class="primary huge" data-dnext>ALL ITEMS VERIFIED → CONTINUE</button></div>
    </section>

    <section class="delivery-step" data-dstep="4">
      <div class="panel wizard-card"><div class="step-kicker">STEP 4 · DAMAGE / BACKORDERS</div><h1>Stop and look around.</h1>
      <p>Any damage to the spa, customer property, missing item, backorder, or anything HTFO needs to know?</p>
      <label class="confirm-tile"><input type="radio" name="deliveryDamage" value="no"> NO PROBLEMS</label>
      <label class="confirm-tile"><input type="radio" name="deliveryDamage" value="yes"> YES — DOCUMENT A PROBLEM</label>
      <label>NOTES / DAMAGE / BACKORDER DETAILS<textarea id="deliveryNotes" rows="5">${esc(w.delivery_exception_notes||'')}</textarea></label>
      <button type="button" class="primary huge" data-dnext>SAVE REVIEW → CONTINUE</button></div>
    </section>

    <section class="delivery-step" data-dstep="5">
      <div class="panel wizard-card"><div class="step-kicker">STEP 5 · DELIVERY PHOTO</div><h1>Take the proof-of-delivery photo.</h1>
      <p>Take a clear picture showing the spa delivered and in place.</p>
      <input type="file" id="deliveryProofFile" accept="image/*" capture="environment">
      <div id="deliveryProofStatus" class="photo-status ${w.delivery_proof_photo?'ok':''}">${w.delivery_proof_photo?'PHOTO STORED ✓':'NO PHOTO YET'}</div>
      <button type="button" class="primary huge" data-dnext>PHOTO TAKEN → CONTINUE</button></div>
    </section>

    <section class="delivery-step" data-dstep="6">
      <div class="panel wizard-card"><div class="step-kicker">STEP 6 · HAPPY PICTURE</div><h1>Ask the customer to stand beside the spa.</h1>
      <p><b>Say:</b> “We need one quick happy picture with your new spa.”</p>
      <input type="file" id="deliveryHappyFile" accept="image/*" capture="environment">
      <div id="deliveryHappyStatus" class="photo-status ${w.delivery_happy_photo?'ok':''}">${w.delivery_happy_photo?'PHOTO STORED ✓':'NO PHOTO YET'}</div>
      <button type="button" class="primary huge" data-dnext>HAPPY PICTURE TAKEN → CONTINUE</button></div>
    </section>

    <section class="delivery-step customer-screen" data-dstep="7">
      <div class="panel wizard-card"><div class="handoff">HAND THE PHONE TO THE CUSTOMER</div><div class="step-kicker">STEP 7 · CUSTOMER REVIEW</div>
      <h1>Please review your delivery.</h1>
      <p><b>Customer:</b> ${esc(w.customer_name||'')}<br><b>Address:</b> ${esc(addrText)}<br><b>Spa:</b> ${esc([brand,model].filter(Boolean).join(' '))}</p>
      <p><b>Serial:</b> <span id="deliveryReviewSerial"></span><br><b>Cover lifter:</b> <span id="deliveryReviewLifter"></span><br><b>Order items:</b><br>${orderReview}<br><b>Notes:</b> <span id="deliveryReviewNotes"></span></p>
      <label class="confirm-tile"><input type="checkbox" id="deliveryCustomerReviewed" ${w.delivery_customer_reviewed?'checked':''}> I HAVE REVIEWED THIS DELIVERY INFORMATION</label>
      <button type="button" class="primary huge" data-dnext>I HAVE REVIEWED → CONTINUE</button></div>
    </section>

    <section class="delivery-step customer-screen" data-dstep="8">
      <div class="panel wizard-card"><div class="step-kicker">STEP 8 · CUSTOMER ACKNOWLEDGEMENT</div><h1>Please read this statement.</h1>
      <div class="acceptance-box">I acknowledge receipt of the merchandise and accessories listed above and confirm that they were delivered to me. I have reviewed the delivery information and any delivery notes shown above.</div>
      <label class="confirm-tile"><input type="checkbox" id="deliveryAcceptance" ${w.delivery_acceptance_confirmed?'checked':''}> I ACCEPT AND ACKNOWLEDGE RECEIPT</label>
      <button type="button" class="primary huge" data-dnext>ACCEPT & CONTINUE</button></div>
    </section>

    <section class="delivery-step customer-screen" data-dstep="9">
      <div class="panel wizard-card"><div class="step-kicker">STEP 9 · CUSTOMER SIGNATURE</div><h1>SIGN HERE WITH YOUR FINGER</h1>
      <canvas id="deliverySignature" width="700" height="280" class="signature-pad"></canvas>
      <div class="actions"><button type="button" class="ghost dark" id="clearDeliverySignature">CLEAR SIGNATURE</button><button type="button" class="primary" id="acceptDeliverySignature">ACCEPT SIGNATURE</button></div>
      <div id="deliverySignatureStatus" class="photo-status ${w.delivery_signature_accepted?'ok':''}">${w.delivery_signature_accepted?'SIGNATURE ACCEPTED ✓':'SIGNATURE NOT ACCEPTED'}</div>
      <button type="button" class="primary huge" data-dnext>SIGNATURE ACCEPTED → CONTINUE</button></div>
    </section>

    <section class="delivery-step" data-dstep="10">
      <div class="panel wizard-card"><div class="step-kicker">STEP 10 · FINAL CHECK</div><h1>Do not leave until every item is green.</h1>
      <div id="deliveryFinalChecks"></div>
      <button type="button" id="completeDelivery" class="primary huge" disabled>COMPLETE DELIVERY</button>
      <button type="button" class="ghost dark huge" id="loopBackBottom">BACK TO DELIVERY LOOP WITHOUT COMPLETING</button></div>
    </section>
  </div>`;

  let step=startStep, signatureMoved=false, signatureAccepted=Boolean(w.delivery_signature_accepted&&w.delivery_signature_data);
  const steps=[...document.querySelectorAll('.delivery-step')];
  function showStep(n){
    step=Math.max(1,Math.min(10,n));
    steps.forEach(el=>el.classList.toggle('active',Number(el.dataset.dstep)===step));
    $('#deliveryStepLabel').textContent='STEP '+step+' OF 10';
    $('#deliveryStepBar').style.width=(step*10)+'%';
    if(step===7){
      $('#deliveryReviewSerial').textContent=$('#deliverySerial').value||'Missing';
      $('#deliveryReviewLifter').textContent=$('#deliveryLifter').value||'None';
      $('#deliveryReviewNotes').textContent=$('#deliveryNotes').value||'No issues noted.';
    }
    if(step===10)renderDeliveryFinal();
    window.scrollTo({top:0,behavior:'smooth'});
  }
  async function next(){
    try{
      if(step===1){showStep(2);return}
      if(step===2){
        if(!$('#deliveryCorrectSpa').checked)return alert('Confirm this is the correct spa.');
        const serial=$('#deliverySerial').value.trim();if(!serial)return alert('Enter the spa serial number.');
        await saveDeliveryProgress({correct_spa:true,serial_number:serial});showStep(3);return;
      }
      if(step===3){
        if($$('.deliveryPackage').some(x=>!x.checked))return alert('Confirm every included item before continuing.');
        await saveDeliveryProgress({package_confirmed:true,cover_lifter:$('#deliveryLifter').value.trim()});showStep(4);return;
      }
      if(step===4){
        const choice=document.querySelector('[name=deliveryDamage]:checked');if(!choice)return alert('Choose NO PROBLEMS or YES.');
        if(choice.value==='yes'&&!$('#deliveryNotes').value.trim())return alert('Enter the damage / missing item / backorder details.');
        await saveDeliveryProgress({damage_reviewed:true,exception_notes:$('#deliveryNotes').value.trim()});showStep(5);return;
      }
      if(step===5){
        if(!currentJob.delivery_proof_photo)return alert('Take the proof-of-delivery photo before continuing.');
        showStep(6);return;
      }
      if(step===6){
        if(!currentJob.delivery_happy_photo)return alert('Take the happy picture before continuing.');
        showStep(7);return;
      }
      if(step===7){
        if(!$('#deliveryCustomerReviewed').checked)return alert('Customer must review the delivery and check the box.');
        await saveDeliveryProgress({customer_reviewed:true});showStep(8);return;
      }
      if(step===8){
        if(!$('#deliveryAcceptance').checked)return alert('Customer must accept the acknowledgement.');
        await saveDeliveryProgress({acceptance_confirmed:true});showStep(9);return;
      }
      if(step===9){
        if(!signatureAccepted)return alert('Customer must sign and tap ACCEPT SIGNATURE.');
        showStep(10);return;
      }
    }catch(e){alert(e.message)}
  }
  $$('[data-dnext]').forEach(b=>b.onclick=next);
  const backLoop=()=>showFieldView('jobsView');
  $('#loopBack').onclick=backLoop;$('#loopBackBottom').onclick=backLoop;
  $('#wrongSpa').onclick=async()=>{const notes=($('#deliveryNotes')?.value||'')+'\nWrong spa / model';await saveDeliveryProgress({exception_notes:notes.trim()});showStep(4)};

  async function persistPhoto(kind,file){
    if(!file)return;
    const st=$(kind==='proof'?'#deliveryProofStatus':'#deliveryHappyStatus');st.textContent='SAVING PHOTO…';
    try{
      const data=await imageDataFromFile(file);
      const payload=kind==='proof'?{proof_photo:data}:{happy_photo:data};
      await saveDeliveryProgress(payload);
      st.textContent='PHOTO STORED ✓';st.classList.add('ok');
    }catch(e){st.textContent='PHOTO FAILED — TRY AGAIN';alert(e.message)}
  }
  $('#deliveryProofFile').onchange=e=>persistPhoto('proof',e.target.files[0]);
  $('#deliveryHappyFile').onchange=e=>persistPhoto('happy',e.target.files[0]);

  const canvas=$('#deliverySignature'),ctx=canvas.getContext('2d');ctx.lineWidth=3;ctx.lineCap='round';ctx.strokeStyle='#111827';let drawing=false;
  function spos(e){const r=canvas.getBoundingClientRect(),t=e.touches?e.touches[0]:e;return{x:(t.clientX-r.left)*(canvas.width/r.width),y:(t.clientY-r.top)*(canvas.height/r.height)}}
  function sstart(e){e.preventDefault();drawing=true;const p=spos(e);ctx.beginPath();ctx.moveTo(p.x,p.y)}
  function smove(e){if(!drawing)return;e.preventDefault();const p=spos(e);ctx.lineTo(p.x,p.y);ctx.stroke();signatureMoved=true;signatureAccepted=false;$('#deliverySignatureStatus').textContent='SIGNATURE DRAWN — TAP ACCEPT SIGNATURE';$('#deliverySignatureStatus').classList.remove('ok')}
  function sstop(e){if(drawing){if(e)e.preventDefault();drawing=false}}
  ['mousedown','touchstart'].forEach(ev=>canvas.addEventListener(ev,sstart,{passive:false}));
  ['mousemove','touchmove'].forEach(ev=>canvas.addEventListener(ev,smove,{passive:false}));
  ['mouseup','mouseleave','touchend','touchcancel'].forEach(ev=>canvas.addEventListener(ev,sstop,{passive:false}));
  $('#clearDeliverySignature').onclick=()=>{ctx.clearRect(0,0,canvas.width,canvas.height);signatureMoved=false;signatureAccepted=false;$('#deliverySignatureStatus').textContent='SIGNATURE NOT ACCEPTED';$('#deliverySignatureStatus').classList.remove('ok')};
  $('#acceptDeliverySignature').onclick=async()=>{
    if(!signatureMoved&&!currentJob.delivery_signature_data)return alert('Customer needs to sign first.');
    const data=signatureMoved?canvas.toDataURL('image/png'):currentJob.delivery_signature_data;
    await saveDeliveryProgress({signature_data:data,signature_accepted:true});
    signatureAccepted=true;$('#deliverySignatureStatus').textContent='SIGNATURE ACCEPTED ✓';$('#deliverySignatureStatus').classList.add('ok');
  };
  function renderDeliveryFinal(){
    const checks=[
      ['Correct spa verified',Boolean(currentJob.delivery_correct_spa)],
      ['Serial number entered',Boolean(String(currentJob.delivery_serial_number||'').trim())],
      ['Included items verified',Boolean(currentJob.delivery_package_confirmed)],
      ['Damage / backorder review',Boolean(currentJob.delivery_damage_reviewed)],
      ['Proof photo',Boolean(currentJob.delivery_proof_photo)],
      ['Happy picture',Boolean(currentJob.delivery_happy_photo)],
      ['Customer reviewed delivery',Boolean(currentJob.delivery_customer_reviewed)],
      ['Customer acknowledgement',Boolean(currentJob.delivery_acceptance_confirmed)],
      ['Customer signature accepted',Boolean(currentJob.delivery_signature_accepted&&currentJob.delivery_signature_data)]
    ];
    $('#deliveryFinalChecks').innerHTML=checks.map(([label,ok])=>'<div class="final-check '+(ok?'ok':'bad')+'">'+(ok?'✓':'✕')+' '+esc(label)+'</div>').join('');
    $('#completeDelivery').disabled=checks.some(x=>!x[1]);
  }
  $('#completeDelivery').onclick=async()=>{
    renderDeliveryFinal();if($('#completeDelivery').disabled)return alert('Finish every required step first.');
    try{
      await api('/field/deliveries/'+currentJob.id+'/complete',{method:'POST',body:'{}'});
      $('#jobDetail').innerHTML='<div class="panel delivery-complete"><h1>DELIVERY COMPLETE ✓</h1><p>Do not leave until you see this screen.</p><button id="doneToLoop" class="primary huge">BACK TO DELIVERY LOOP</button></div>';
      $('#doneToLoop').onclick=()=>showFieldView('jobsView');
    }catch(e){alert(e.message)}
  };
  showStep(startStep);
}
async function saveWork(){try{await api('/work-orders/'+currentJob.id,{method:'PATCH',body:JSON.stringify({status:$('#fieldStatus').value,diagnosis:$('#fieldDiagnosis').value,work_performed:$('#fieldWork').value,labor_hours:Number($('#fieldHours').value||0),parts_used:$('#fieldParts').value,labor_amount:Number(currentJob.labor_amount||0),parts_amount:Number(currentJob.parts_amount||0),trip_amount:Number(currentJob.trip_amount||0),tax_amount:Number(currentJob.tax_amount||0)})});await openJob(currentJob.id)}catch(e){alert(e.message)}}
async function createInvoice(){try{const i=await api(`/work-orders/${currentJob.id}/invoice`,{method:'POST'});currentInvoice=i;await openJob(currentJob.id)}catch(e){alert(e.message)}}
function openPayment(i){currentInvoice=i;const balance=Number(i.balance??(Number(i.total_amount)-Number(i.amount_paid)));$('#paymentInvoice').innerHTML=`<div class="money">${money(balance)}</div><div class="muted">${esc(i.invoice_number)} remaining balance</div>`;$('#payAmount').value=balance.toFixed(2);$('#payMethod').value='card';$('#checkNo').value='';$('#payNote').value='';toggleCheck();$('#paymentDialog').showModal()}
function toggleCheck(){$('#checkWrap').hidden=$('#payMethod').value!=='check';$('#submitPayment').textContent=$('#payMethod').value==='card'?'Open Secure Card Payment':'Record Payment'}$('#payMethod').onchange=toggleCheck;
$('#submitPayment').onclick=async e=>{e.preventDefault();const method=$('#payMethod').value,amount=Number($('#payAmount').value||0);if(amount<=0)return alert('Enter a payment amount.');try{if(method==='cash'||method==='check'){await api(`/invoices/${currentInvoice.id}/payments`,{method:'POST',body:JSON.stringify({payment_method:method,amount,reference_number:$('#checkNo').value,notes:$('#payNote').value})});$('#paymentDialog').close();await openJob(currentJob.id);return}const c=await api(`/invoices/${currentInvoice.id}/card-checkout`,{method:'POST',body:JSON.stringify({amount})});const f=document.createElement('form');f.method='POST';f.action=c.form_url;f.innerHTML=`<input type="hidden" name="token" value="${esc(c.token)}">`;document.body.appendChild(f);f.submit()}catch(err){alert(err.message)}};
boot();