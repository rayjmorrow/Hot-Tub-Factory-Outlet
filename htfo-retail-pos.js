const API='/api/service',POS=API+'/htfo-pos';let token='',user=null,permissions={},skus=[],spas=[],cart=[],customerId=null;
const $=s=>document.querySelector(s),text=(el,value)=>el.textContent=String(value),money=c=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(c||0)/100);
async function request(path,options={}){const res=await fetch(path,{...options,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,...(options.headers||{})}});const data=await res.json().catch(()=>({}));if(!res.ok)throw Error(data.error||'Request failed ('+res.status+')');return data}
function option(value,name){const o=document.createElement('option');o.value=value;o.textContent=name;return o}
function tab(name){for(const p of ['counter','inventory','receiving'])$('#'+p).hidden=p!==name}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>tab(b.dataset.tab));
$('#logout').onclick=()=>{token='';user=null;cart=[];$('#workspace').hidden=true;$('#login').hidden=false;$('#logout').hidden=true;$('#password').value=''};
$('#loginForm').onsubmit=async e=>{e.preventDefault();try{const session=await request(API+'/auth/login',{method:'POST',body:JSON.stringify({username:$('#username').value,password:$('#password').value})});token=session.token;const me=await request(POS+'/me');user=me.user;permissions=me.permissions;$('#openSpaSales').hidden=!permissions.sales;if(!permissions.retail&&!permissions.service)throw Error('No retail or inventory permissions');$('#workspace').hidden=false;$('#login').hidden=true;$('#logout').hidden=false;text($('#welcome'),'Hello, '+(user.name||user.username));text($('#role'),user.role);document.querySelectorAll('.manager').forEach(x=>x.hidden=!permissions.manage);document.querySelectorAll('.sales').forEach(x=>x.hidden=!permissions.sales);await refresh();tab(permissions.retail?'counter':'inventory')}catch(err){text($('#loginStatus'),err.message)}};
async function refresh(){skus=await request(POS+'/skus');const selectors=[$('#counterSku'),$('#receiveSku')];for(const select of selectors){select.replaceChildren(option('','Select product'));for(const p of skus)select.append(option(p.id,p.sku+' · '+p.name+' — '+money(p.price_cents)+' ('+p.available+' available)'))}
$('#skuTable').replaceChildren();for(const s of skus){const row=document.createElement('div');row.className='cardrow';text(row,s.sku+' · '+s.name+' | On hand '+s.on_hand+' | Committed '+s.committed+' | Available '+s.available);$('#skuTable').append(row)}
if(permissions.sales){spas=await request(POS+'/spas');$('#spaTable').replaceChildren();for(const unit of spas){const row=document.createElement('div');row.className='cardrow';text(row,unit.brand+' '+unit.model+' · '+unit.shell+' / '+unit.cabinet+' · Serial '+unit.serial+' · '+unit.location+' · '+unit.status);
 if(permissions.manage){
  const change=(caption,fn)=>{const button=document.createElement('button');button.textContent=caption;button.style.margin='4px';button.onclick=async()=>{try{await fn();await refresh()}catch(e){alert(e.message)}};row.append(button)};
  if(unit.status==='reserved'){
   change('Release reservation',async()=>{const reason=prompt('Reason for releasing this reserved spa (required)','');if(!reason)return;await request(POS+'/spas/'+unit.id+'/release',{method:'POST',body:JSON.stringify({reason})})});
   change('Mark sold (signed only)',async()=>{const reason=prompt('Sale confirmation / reason','Executed customer agreement');if(!reason)return;await request('/api/service/htfo-inventory/spas/'+unit.id+'/status',{method:'POST',body:JSON.stringify({status:'sold',reason})})});
  }else if(unit.status==='sold'){
   change('Mark delivered',async()=>{const reason=prompt('Delivery confirmation reference','Delivered and oriented');if(!reason)return;await request('/api/service/htfo-inventory/spas/'+unit.id+'/status',{method:'POST',body:JSON.stringify({status:'delivered',reason})})});
  }else if(['available','hold','in_transit'].includes(unit.status)){
   change('Move location',async()=>{const location=prompt('New location','Warehouse'),reason=prompt('Reason for move','Store inventory transfer');if(!location||!reason)return;await request('/api/service/htfo-inventory/spas/'+unit.id+'/location',{method:'POST',body:JSON.stringify({location,reason})})});
  }
 }
 $('#spaTable').append(row)}}
}
$('#customerQuery').oninput=async()=>{
 const query=$('#customerQuery').value.trim(),target=$('#customerResults');target.replaceChildren();
 if(query.length<2)return;
 try{
  const [service,signed]=await Promise.all([
   request(POS+'/retail/customers?q='+encodeURIComponent(query)),
   request(POS+'/retail/signed-customers?q='+encodeURIComponent(query))
  ]);
  for(const r of service){
   const b=document.createElement('button');text(b,(r.first_name||'')+' '+(r.last_name||'')+' · '+(r.phone||r.email||''));
   b.onclick=()=>{customerId=r.id;text($('#selectedCustomer'),'Customer: '+r.first_name+' '+r.last_name);target.replaceChildren()};
   target.append(b)
  }
  for(const r of signed){
   if(r.retail_customer_id&&service.some(x=>x.id===r.retail_customer_id))continue;
   const b=document.createElement('button');text(b,r.name+' · '+(r.phone||r.email||'')+' (signed spa customer)');
   b.onclick=async()=>{b.disabled=true;try{
    const linked=await request(POS+'/retail/signed-customers/'+r.signed_agreement_id+'/link',{method:'POST',body:'{}'});
    customerId=linked.id;text($('#selectedCustomer'),'Customer: '+linked.first_name+' '+linked.last_name);target.replaceChildren()
   }catch(e){b.disabled=false;text($('#saleStatus'),e.message)}};
   target.append(b)
  }
 }catch(e){text($('#saleStatus'),e.message)}
};
$('#addToCart').onclick=()=>{const p=skus.find(x=>x.id===Number($('#counterSku').value));const qty=Number($('#counterQty').value);if(!p||!Number.isInteger(qty)||qty<1||qty>99)return text($('#saleStatus'),'Choose a valid item and quantity');cart.push({p,qty});renderCart()};
function renderCart(){$('#cartBody').replaceChildren();cart.forEach((x,i)=>{const tr=document.createElement('tr');for(const val of [x.p.name,x.qty,money(x.qty*x.p.price_cents)]){const td=document.createElement('td');text(td,val);tr.append(td)}const td=document.createElement('td'),b=document.createElement('button');text(b,'Remove');b.onclick=()=>{cart.splice(i,1);renderCart()};td.append(b);tr.append(td);$('#cartBody').append(tr)});text($('#cartTotal'),'Subtotal: '+money(cart.reduce((n,x)=>n+x.qty*x.p.price_cents,0)))}
$('#saveReceipt').onclick=async()=>{if(!cart.length)return text($('#saleStatus'),'Add a product first');try{const receipt=await request(POS+'/receipts',{method:'POST',body:JSON.stringify({customer_id:customerId,items:cart.map(x=>({sku_id:x.p.id,qty:x.qty}))})});text($('#saleStatus'),'Retail draft #'+receipt.id+' saved — UNPAID. No stock deducted.');cart=[];renderCart()}catch(e){text($('#saleStatus'),e.message)}};
$('#skuForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);try{await request(POS+'/skus',{method:'POST',body:JSON.stringify({sku:f.get('sku'),name:f.get('name'),category:f.get('category'),price_cents:Math.round(Number(f.get('price'))*100),cost_cents:Math.round(Number(f.get('cost'))*100),reorder_point:Number(f.get('reorder'))})});text($('#manageStatus'),'SKU saved');await refresh()}catch(e){text($('#manageStatus'),e.message)}};
$('#receiveForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);try{await request(POS+'/skus/'+f.get('sku_id')+'/receive',{method:'POST',body:JSON.stringify({location:f.get('location'),qty:Number(f.get('qty'))})});text($('#manageStatus'),'Inventory received');await refresh()}catch(e){text($('#manageStatus'),e.message)}};
