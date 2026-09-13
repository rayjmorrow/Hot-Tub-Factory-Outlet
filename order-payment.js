const qs=new URLSearchParams(location.search);
const token=qs.get('t');
const status=document.getElementById('status');
const details=document.getElementById('details');
const pay=document.getElementById('pay');
let session=null;

async function start(){
  if(!token){status.innerHTML='<span class="error">This payment link is incomplete.</span>';return}
  try{
    const r=await fetch('/api/service/public/order-payment/session',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({token})
    });
    const x=await r.json();
    if(!r.ok)throw new Error(x.error||'Unable to prepare payment');
    if(x.paid){
      status.innerHTML='<span class="ok">This order is already paid in full.</span>';
      details.textContent='Order '+(x.order_number||'');
      return;
    }
    session=x;
    status.textContent='Review your remaining balance below.';
    details.innerHTML='<div class="amount">'+Number(x.balance||0).toLocaleString('en-US',{style:'currency',currency:'USD'})+'</div><div class="muted">Order '+String(x.order_number||'')+'</div><p>Your card information will be entered directly on the Authorize.Net secure payment page.</p>';
    pay.hidden=false;
  }catch(e){
    status.innerHTML='<span class="error">'+String(e.message||e)+'</span>';
  }
}

pay.onclick=()=>{
  if(!session)return;
  const f=document.createElement('form');
  f.method='POST';
  f.action=session.form_url;
  const i=document.createElement('input');
  i.type='hidden';
  i.name='token';
  i.value=session.token;
  f.appendChild(i);
  document.body.appendChild(f);
  f.submit();
};

start();