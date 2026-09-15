(()=>{
  const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmtDate=v=>v?new Date(v).toLocaleDateString():'';
  async function api(path,opts={}){
    const token=sessionStorage.getItem('htfoServiceToken')||'';
    const r=await fetch('/api/service'+path,{...opts,headers:{'Content-Type':'application/json',...(opts.headers||{}),...(token?{Authorization:'Bearer '+token}:{})}});
    const j=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(j.error||('Request failed ('+r.status+')'));
    return j;
  }
  function manager(){return ['admin','owner','manager','service_manager'].includes(String(window.currentServiceUser?.role||'').toLowerCase())}
  function money(v){return Number(v||0).toLocaleString('en-US',{style:'currency',currency:'USD'})}
  async function exportCsv(){
    const token=sessionStorage.getItem('htfoServiceToken')||'';
    const r=await fetch('/api/service/fulfillment/pirate-ship.csv',{headers:{Authorization:'Bearer '+token}});
    if(!r.ok)throw new Error('Could not create Pirate Ship export');
    const blob=await r.blob(),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='htfo-pirate-ship.csv';a.click();URL.revokeObjectURL(a.href);
  }
  function card(o){
    const overdue=o.scheduled_ship_date && new Date(o.scheduled_ship_date+'T12:00:00') < new Date(new Date().toDateString());
    let items=(o.items||[]).map(i=>'<div>• '+Number(i.quantity)+' × '+esc(i.description)+(i.sku?' <span class="muted">('+esc(i.sku)+')</span>':'')+'</div>').join('');
    if(!items)items='<span class="muted">No line items</span>';
    let actions='';
    if(manager())actions='<div class="row wrap" style="margin-top:12px">'+
      '<button class="secondary" data-fulfill-status="'+o.id+'" data-status="processing">Start Fulfillment</button>'+
      '<button class="secondary" data-fulfill-status="'+o.id+'" data-status="packed">Packed</button>'+
      '<button class="secondary" data-fulfill-status="'+o.id+'" data-status="hold">Put On Hold</button>'+
      '<button data-ship="'+o.id+'">Enter Tracking / Ship</button>'+
      '<button class="secondary" data-local="'+o.id+'">HTFO Local Delivery</button>'+
      '</div>';
    return '<div class="card" style="margin-bottom:12px">'+
      '<div class="row between wrap"><div><h3 style="margin:0">'+esc(o.order_number||('Order '+o.id))+(o.source==='autoship'?' <span class="pill">AUTOSHIP</span>':'')+'</h3>'+
      '<div class="muted">'+esc([o.first_name,o.last_name].filter(Boolean).join(' '))+' · '+esc(o.phone||'')+' · '+esc(o.email||'')+'</div></div>'+
      '<div><span class="pill">'+esc(o.fulfillment_status||'waiting')+'</span> '+(overdue?'<span class="pill" style="background:#fff0f0;color:#9b1c1c">OVERDUE</span>':'')+'</div></div>'+
      '<div style="margin-top:10px"><b>Ship to:</b> '+esc([o.street,o.street2,o.city,o.state,o.zip].filter(Boolean).join(', '))+'</div>'+
      '<div style="margin-top:8px">'+items+'</div>'+
      '<div class="muted" style="margin-top:8px">Target ship: '+esc(o.scheduled_ship_date||'ASAP')+' · Package '+Number(o.package_weight_lbs||10)+' lb · '+Number(o.package_length_in||12)+'×'+Number(o.package_width_in||12)+'×'+Number(o.package_height_in||12)+' in · Total '+money(o.total_amount)+'</div>'+
      actions+'</div>';
  }
  async function load(){
    const [rows,sum]=await Promise.all([api('/fulfillment/queue'),api('/fulfillment/summary')]);
    const stat=$('#fulfillmentStats');
    if(stat)stat.innerHTML='<div class="stat"><b>'+sum.waiting+'</b><span>Waiting to Fulfill</span></div><div class="stat"><b>'+sum.overdue+'</b><span>Overdue</span></div><div class="stat"><b>'+sum.mail.filter(x=>x.status==='pending').length+'</b><span>Emails Pending Setup</span></div>';
    const list=$('#fulfillmentList');
    if(list)list.innerHTML=rows.map(card).join('')||'<div class="card"><b>Fulfillment is clear.</b><p class="muted">No orders are waiting to ship.</p></div>';
    const alerts=$('#fulfillmentAlerts');
    if(alerts)alerts.innerHTML=(sum.alerts||[]).slice(0,12).map(a=>'<div class="item"><b>'+esc(String(a.event_type||'').replaceAll('_',' '))+'</b><span>'+esc(a.description)+'</span><span class="muted">'+fmtDate(a.created_at)+'</span></div>').join('')||'<p class="muted">No recent AutoShip alerts.</p>';
    bind();
  }
  function bind(){
    $$('[data-fulfill-status]').forEach(b=>b.onclick=async()=>{try{await api('/fulfillment/orders/'+b.dataset.fulfillStatus,{method:'PATCH',body:JSON.stringify({fulfillment_status:b.dataset.status})});await load()}catch(e){alert(e.message)}});
    $$('[data-ship]').forEach(b=>b.onclick=async()=>{const carrier=prompt('Carrier (UPS or USPS):','UPS');if(carrier===null)return;const service=prompt('Shipping service:','Ground');if(service===null)return;const tracking=prompt('Tracking number:','');if(!tracking)return;try{await api('/fulfillment/orders/'+b.dataset.ship+'/ship',{method:'POST',body:JSON.stringify({carrier,shipping_service:service,tracking_number:tracking})});await load()}catch(e){alert(e.message)}});
    $$('[data-local]').forEach(b=>b.onclick=async()=>{if(!confirm('Use HTFO staff for this local delivery? This option is internal only and is not shown on the website.'))return;try{await api('/fulfillment/orders/'+b.dataset.local+'/ship',{method:'POST',body:JSON.stringify({local_delivery:true})});await load()}catch(e){alert(e.message)}});
  }
  document.addEventListener('click',e=>{if(e.target?.id==='pirateShipExport')exportCsv().catch(x=>alert(x.message));if(e.target?.id==='refreshFulfillment')load().catch(x=>alert(x.message))});
  window.loadFulfillment=load;
})();