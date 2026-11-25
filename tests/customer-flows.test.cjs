const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
(async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../service-request.js'),'utf8');
 async function service(result,ok=true){
  let handler,requests=0,resolve;
  const button={},grid={},status={style:{},setAttribute(){},focus(){this.focused=true},scrollIntoView(){}};
  const form={action:'https://formsubmit.co/ray@hottubfactoryoutlet.com',reportValidity:()=>true,querySelector:s=>s.includes('submit')?button:grid,addEventListener:(e,h)=>handler=h};
  const gate=new Promise(r=>resolve=r);
  const ctx={AbortSignal,document:{getElementById:id=>id==='serviceRequestForm'?form:status},FormData:class{*[Symbol.iterator](){yield ['First Name','Test']}},fetch:async(url,options)=>{requests++;assert.match(url,/formsubmit.co\/ajax\//);await gate;return {ok,json:async()=>result}}};
  vm.runInNewContext(source,ctx);
  const pending=handler({preventDefault(){}});await handler({preventDefault(){}});assert.equal(requests,1);assert.equal(button.disabled,true);resolve();await pending;
  return {button,grid,status,handler,count:()=>requests};
 }
 let s=await service({success:'true'});assert.equal(s.button.disabled,true);assert.equal(s.grid.hidden,true);assert.match(s.status.textContent,/sent successfully/);assert.ok(s.status.focused);await s.handler({preventDefault(){}});assert.equal(s.count(),1);
 s=await service({success:false});assert.equal(s.button.disabled,false);assert.notEqual(s.grid.hidden,true);assert.match(s.status.textContent,/could not confirm/);
 s=await service({success:true},false);assert.equal(s.button.disabled,false);
 const server=fs.readFileSync(path.join(__dirname,'../backend/server.js'),'utf8');
 const code=server.slice(server.indexOf('async function checkoutSession('),server.indexOf("app.post('/checkout/session'"));
 let request;
 const ctx={process:{env:{}},randomUUID:()=> '00000000-0000-0000-0000-000000000001',money:n=>Math.round(n*100)/100,auth:()=>({name:'mock',transactionKey:'mock'}),authForm:'https://accept.authorize.net/payment/payment',anet:async r=>{request=r;return {token:'test'}},ensureCustomerProfile:async()=> '42',signToken:()=> 'mock',taxForOrder:async()=>({items:[{id:'ACSP124',name:'Seat',description:'Seat',quantity:1,unit_price:29.99}],customer:{first:'Test',last:'Customer',email:'test@example.test',street:'Public store address',city:'Wexford',state:'PA',zip:'15090'},destination:{street:'Public store address',city:'Wexford',state:'PA',zip:'15090'},shipping:0,tax:2.10})};
 vm.createContext(ctx);vm.runInContext(code+'\nthis.run=checkoutSession;',ctx);await ctx.run({fulfillment:'pickup-wexford'});
 const tx=request.getHostedPaymentPageRequest.transactionRequest;
 assert.equal(tx.customer.email,'test@example.test');assert.equal('email' in tx.billTo,false);assert.equal(tx.amount,32.09);
 const keys=Object.keys(tx);assert.ok(keys.indexOf('customer')<keys.indexOf('billTo'));
 console.log('Customer flows passed: confirmed service success, duplicate prevention, failure recovery and hosted payment request.');
})().catch(e=>{console.error(e);process.exitCode=1});
