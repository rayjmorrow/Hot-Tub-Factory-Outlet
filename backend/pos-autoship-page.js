export const posAutoShipPage=`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hot Tub Factory Outlet AutoShip</title><style>
body{font:16px system-ui;margin:2rem auto;max-width:34rem;padding:0 1rem;color:#082642}label{display:block;margin:.65rem 0}input:not([type=checkbox]){display:block;width:100%;box-sizing:border-box;padding:.55rem}button{font:inherit;padding:.6rem 1rem}#status{white-space:pre-wrap}
</style><script src="/pos-autoship.js" defer></script></head>
<body><h1>Set up Hot Tub Factory Outlet AutoShip</h1><p id="status" role="status">Opening your secure enrollment…</p>
<form id="address" hidden><h2>Shipping address</h2>
<label>Street<input name="street" autocomplete="address-line1" required></label>
<label>Apartment or suite<input name="street2" autocomplete="address-line2"></label>
<label>City<input name="city" autocomplete="address-level2" required></label>
<label>State<input name="state" autocomplete="address-level1" pattern="[A-Za-z]{2}" maxlength="2" required></label>
<label>ZIP code<input name="zip" autocomplete="postal-code" required></label>
<button>Review charges</button></form>
<form id="consent" hidden><h2>Review and authorize AutoShip</h2><ul id="items"></ul><p id="schedule"></p>
<label>Type your full name<input name="name" autocomplete="name" required minlength="3"></label>
<label><input name="accepted" type="checkbox" required> I authorize the first order and the recurring card charges shown above. I can cancel future shipments through my AutoShip account or by contacting Hot Tub Factory Outlet.</label>
<button>Continue to secure card entry</button></form></body></html>`;

export const posAutoShipScript=`const token=location.hash.slice(1);
history.replaceState(null,'',location.pathname);
const status=document.getElementById('status'),address=document.getElementById('address'),consent=document.getElementById('consent');
let quote='';
const money=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);
async function request(action,data={}){
 const response=await fetch('/pos-autoship/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,...data})});
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(result.error||'This link is unavailable. Contact your showroom for a new link.');
 return result;
}
request('review').then(()=>{status.textContent='Enter the address where we should ship your AutoShip orders.';address.hidden=false;}).catch(error=>{status.textContent=error.message});
address.onsubmit=async event=>{
 event.preventDefault();
 const button=address.querySelector('button');button.disabled=true;
 consent.hidden=true;status.textContent='Calculating your order total…';
 try{
  const result=await request('quote',{shippingAddress:Object.fromEntries(new FormData(address))});
  quote=result.quote;
  const lines=document.getElementById('items');lines.replaceChildren();
  for(const item of result.items){const li=document.createElement('li');li.textContent=item.quantity+' × '+item.description;lines.append(li);}
  document.getElementById('schedule').textContent='First order today: '+money(result.total)+'. Then '+money(result.total)+' every '+result.months+' month(s), starting '+result.start_date+', for '+result.occurrences+' recurring charges unless canceled. Totals include shipping and tax.';
  status.textContent='Review your authorization below.';consent.hidden=false;
 }catch(error){status.textContent=error.message}finally{button.disabled=false}
};
consent.onsubmit=async event=>{
 event.preventDefault();
 const button=consent.querySelector('button');button.disabled=true;status.textContent='Opening Authorize.Net…';
 try{
  const result=await request('start',{quote,name:consent.elements.name.value,accepted:consent.elements.accepted.checked});
  const form=document.createElement('form'),input=document.createElement('input');
  form.method='post';form.action=result.formUrl;
  input.type='hidden';input.name='token';input.value=result.token;form.append(input);
  document.body.append(form);form.submit();
 }catch(error){status.textContent=error.message;button.disabled=false}
};`;
