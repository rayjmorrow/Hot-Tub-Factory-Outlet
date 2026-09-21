(()=>{
  const TZ='America/New_York';
  const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let mode='month',cursor=new Date(),rows=[];
  cursor=new Date(cursor.getFullYear(),cursor.getMonth(),1);

  async function hfApi(path){
    const token=sessionStorage.getItem('htfoServiceToken')||'';
    const r=await fetch('/api/service'+path,{headers:{Authorization:'Bearer '+token}});
    const j=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(j.error||('Request failed ('+r.status+')'));
    return j;
  }
  function ymdLocal(v){
    const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(v)).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
    return p.year+'-'+p.month+'-'+p.day;
  }
  function dateKey(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
  function time(v){return new Date(v).toLocaleTimeString('en-US',{timeZone:TZ,hour:'numeric',minute:'2-digit'})}
  function eventCard(r){
    return '<button type="button" class="hf-event '+(r.job_type==='delivery'?'delivery':'')+'" data-hf-work="'+r.id+'"><b>'+time(r.scheduled_start)+' · '+esc(r.customer_name||'Customer')+'</b><span>'+esc(r.job_type==='delivery'?'Delivery':'Service')+' · '+esc(r.assigned_to||r.assigned_team||'Unassigned')+'</span></button>';
  }
  function range(){
    if(mode==='month')return {from:new Date(cursor.getFullYear(),cursor.getMonth(),1),to:new Date(cursor.getFullYear(),cursor.getMonth()+1,1)};
    if(mode==='week'){
      const from=new Date(cursor);from.setHours(0,0,0,0);from.setDate(from.getDate()-from.getDay());
      const to=new Date(from);to.setDate(to.getDate()+7);return{from,to};
    }
    const from=new Date(cursor);from.setHours(0,0,0,0);const to=new Date(from);to.setDate(to.getDate()+1);return{from,to};
  }
  async function load(){
    const r=range(),assigned=$('#hfAssigned')?.value||'all',type=$('#hfType')?.value||'all';
    rows=await hfApi('/calendar?from='+encodeURIComponent(r.from.toISOString())+'&to='+encodeURIComponent(r.to.toISOString())+'&assigned='+encodeURIComponent(assigned)+'&job_type='+encodeURIComponent(type));
    render(r);
  }
  function render(r){
    $$('[data-hf-mode]').forEach(b=>b.classList.toggle('active',b.dataset.hfMode===mode));
    if(mode==='month')renderMonth();else if(mode==='week')renderWeek(r.from);else renderDay(r.from);
    bindEvents();
  }
  function renderMonth(){
    $('#hfLabel').textContent=cursor.toLocaleDateString('en-US',{month:'long',year:'numeric'});
    const y=cursor.getFullYear(),m=cursor.getMonth(),first=new Date(y,m,1),start=new Date(y,m,1-first.getDay());
    let html=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(x=>'<div class="hf-head">'+x+'</div>').join('');
    for(let i=0;i<42;i++){
      const d=new Date(start);d.setDate(start.getDate()+i);const key=dateKey(d),dayRows=rows.filter(r=>ymdLocal(r.scheduled_start)===key);
      html+='<div class="hf-day '+(d.getMonth()!==m?'other':'')+'" data-hf-day="'+key+'"><div class="hf-num">'+d.getDate()+'</div>'+dayRows.map(eventCard).join('')+'</div>';
    }
    $('#hfCalendar').className='hf-month';
    $('#hfCalendar').innerHTML=html;
    $$('[data-hf-day]').forEach(el=>el.addEventListener('click',e=>{if(e.target.closest('[data-hf-work]'))return;cursor=new Date(el.dataset.hfDay+'T12:00:00');mode='day';load()}));
  }
  function renderWeek(start){
    const end=new Date(start);end.setDate(end.getDate()+6);
    $('#hfLabel').textContent=start.toLocaleDateString('en-US',{month:'short',day:'numeric'})+' – '+end.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
    let html='';
    for(let i=0;i<7;i++){
      const d=new Date(start);d.setDate(start.getDate()+i);const key=dateKey(d),dayRows=rows.filter(r=>ymdLocal(r.scheduled_start)===key).sort((a,b)=>new Date(a.scheduled_start)-new Date(b.scheduled_start));
      html+='<div class="hf-weekday"><h3>'+d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})+'</h3>'+(dayRows.length?dayRows.map(eventCard).join(''):'<div class="muted">No appointments</div>')+'<button type="button" class="hf-open" data-hf-open-day="'+key+'">Open day</button></div>';
    }
    $('#hfCalendar').className='hf-week';
    $('#hfCalendar').innerHTML=html;
    $$('[data-hf-open-day]').forEach(b=>b.addEventListener('click',()=>{cursor=new Date(b.dataset.hfOpenDay+'T12:00:00');mode='day';load()}));
  }
  function renderDay(day){
    const key=dateKey(day);
    $('#hfLabel').textContent=day.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
    const dayRows=rows.filter(r=>ymdLocal(r.scheduled_start)===key);
    let html='';
    for(let h=8;h<=18;h++){
      const label=new Date(2000,0,1,h).toLocaleTimeString('en-US',{hour:'numeric'});
      const items=dayRows.filter(r=>Number(new Intl.DateTimeFormat('en-US',{timeZone:TZ,hour:'2-digit',hourCycle:'h23'}).format(new Date(r.scheduled_start)))===h);
      html+='<div class="hf-hour">'+label+'</div><div class="hf-slot">'+(items.length?items.map(eventCard).join(''):'<button type="button" class="hf-open" data-hf-slot="'+key+'T'+String(h).padStart(2,'0')+':00">Open slot — schedule appointment</button>')+'</div>';
    }
    $('#hfCalendar').className='hf-daygrid';
    $('#hfCalendar').innerHTML=html;
    $$('[data-hf-slot]').forEach(b=>b.addEventListener('click',async()=>{if(typeof openWorkDialog!=='function')return;await openWorkDialog();const i=$('#workForm [name="scheduled_start"]');if(i)i.value=b.dataset.hfSlot;}));
  }
  function bindEvents(){
    $$('[data-hf-work]').forEach(b=>b.addEventListener('click',async e=>{e.stopPropagation();try{const x=await hfApi('/work-orders/'+b.dataset.hfWork+'/detail'),w=x.workOrder;let d=$('#hfDetail');if(!d){d=document.createElement('dialog');d.id='hfDetail';d.className='hf-dialog';document.body.appendChild(d)}d.innerHTML='<div class="hf-detail"><div class="row between wrap"><h2>'+esc(w.work_order_number)+'</h2><button id="hfClose" class="secondary">Close</button></div><p><b>'+esc(w.customer_name||'')+'</b><br>'+esc(w.phone||'')+'</p><p><b>'+time(w.scheduled_start)+'</b> · '+esc(w.assigned_to||w.assigned_team||'Unassigned')+'</p><p>'+esc(w.complaint||'')+'</p></div>';$('#hfClose').onclick=()=>d.close();d.showModal()}catch(err){alert(err.message)}}));
  }
  function renderShell(){
    const schedule=$('#schedule');if(!schedule)return;
    const nav=$('nav [data-view="schedule"]');if(nav)nav.textContent='Calendar';
    schedule.innerHTML='<div class="row between wrap"><div><h1>Dispatch Calendar</h1><p class="muted">Service + Delivery schedule. Choose Day, Week, or Month.</p></div><div class="row wrap"><button class="secondary" id="hfDelivery">+ Delivery</button><button id="hfService">+ Service Call</button></div></div><div class="hf-toolbar"><button class="secondary" id="hfPrev">← Previous</button><button class="secondary" id="hfToday">Today</button><strong id="hfLabel"></strong><button class="secondary" id="hfNext">Next →</button><div class="hf-switch"><button class="secondary" data-hf-mode="day">Day</button><button class="secondary" data-hf-mode="week">Week</button><button class="secondary active" data-hf-mode="month">Month</button></div><label>Assigned to<select id="hfAssigned"><option value="all">All</option></select></label><label>Job type<select id="hfType"><option value="all">All</option><option value="service">Service</option><option value="delivery">Delivery</option></select></label></div><div id="hfCalendar"></div>';
    $('#hfService').onclick=()=>openWorkDialog();
    $('#hfDelivery').onclick=()=>openWorkDialog('','','delivery');
    $('[data-hf-mode="day"]').onclick=()=>{mode='day';load()};$('[data-hf-mode="week"]').onclick=()=>{mode='week';load()};$('[data-hf-mode="month"]').onclick=()=>{mode='month';cursor=new Date(cursor.getFullYear(),cursor.getMonth(),1);load()};
    $('#hfPrev').onclick=()=>{if(mode==='month')cursor=new Date(cursor.getFullYear(),cursor.getMonth()-1,1);else{cursor=new Date(cursor);cursor.setDate(cursor.getDate()-(mode==='week'?7:1))}load()};
    $('#hfNext').onclick=()=>{if(mode==='month')cursor=new Date(cursor.getFullYear(),cursor.getMonth()+1,1);else{cursor=new Date(cursor);cursor.setDate(cursor.getDate()+(mode==='week'?7:1))}load()};
    $('#hfToday').onclick=()=>{const n=new Date();cursor=mode==='month'?new Date(n.getFullYear(),n.getMonth(),1):n;load()};
    $('#hfAssigned').onchange=load;$('#hfType').onchange=load;
    hfApi('/dispatch-resources').then(rs=>{$('#hfAssigned').innerHTML='<option value="all">All</option>'+rs.map(r=>'<option value="'+esc(r.name)+'">'+esc(r.name)+'</option>').join('')}).finally(load);
  }
  const style=document.createElement('style');
  style.textContent='.hf-toolbar{display:flex;gap:.6rem;align-items:end;flex-wrap:wrap;margin:1rem 0}.hf-toolbar label{margin:0;min-width:140px}.hf-switch{display:flex;gap:.35rem}.hf-switch button.active{background:#0b5cab;color:#fff}.hf-month{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:.4rem}.hf-head{text-align:center;font-weight:800;padding:.4rem}.hf-day{min-height:125px;border:1px solid #dfe5ec;border-radius:10px;background:#fff;padding:.45rem}.hf-day.other{opacity:.4}.hf-num{font-weight:900;margin-bottom:.3rem}.hf-event{display:block;width:100%;text-align:left;border:0;border-left:4px solid #0b5cab;background:#eef5fb;color:#17202a;border-radius:6px;padding:.4rem;margin:.2rem 0;font-size:.78rem}.hf-event.delivery{border-left-color:#7c3aed;background:#f2edff}.hf-event span{display:block}.hf-week{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:.4rem}.hf-weekday{min-height:280px;border:1px solid #dfe5ec;border-radius:10px;background:#fff;padding:.5rem}.hf-weekday h3{margin:.1rem 0 .5rem}.hf-daygrid{display:grid;grid-template-columns:80px 1fr;border:1px solid #dfe5ec;border-radius:12px;overflow:hidden;background:#fff}.hf-hour{padding:.7rem;background:#f8fafc;border-bottom:1px solid #e5ebf1;font-weight:800}.hf-slot{min-height:62px;padding:.35rem;border-bottom:1px solid #e5ebf1}.hf-open{width:100%;min-height:44px;border:1px dashed #aebdca;background:#fbfcfd;color:#53606b;text-align:left}.hf-dialog{width:min(680px,calc(100% - 2rem))}.hf-detail{padding:1.25rem}@media(max-width:900px){.hf-month,.hf-week{grid-template-columns:1fr}.hf-head{display:none}.hf-day,.hf-weekday{min-height:auto}}';
  document.head.appendChild(style);
  const baseShow=window.showView;
  window.showView=function(id){baseShow(id);if(id==='schedule')renderShell()};
  const nav=$('nav [data-view="schedule"]');if(nav){nav.textContent='Calendar';nav.addEventListener('click',()=>setTimeout(renderShell,0))}
  if(!$('#schedule')?.hidden)renderShell();
})();