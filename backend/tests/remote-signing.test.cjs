const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path');
(async()=>{
 const routes={},router={post:(p,...h)=>routes[p]=h.at(-1),get:(p,...h)=>routes[p]=h.at(-1)};
 let stored=null,fail=false,optout=false;const messages=[];
 const draft={id:23,version:3,owner_user_id:1,document:{customer:{first_name:'Test',last_name:'Customer',email:'test@example.test',phone:'+15555550123'},spa:{model:'Example'},msrp:1000000}};
 const q=async(sql,p=[])=>{
  if(sql.startsWith('SELECT * FROM crm_sales_drafts'))return {rows:[draft]};
  if(sql.startsWith('SELECT 1 FROM crm_sales_executed'))return {rows:[],rowCount:0};
  if(sql.startsWith('SELECT * FROM crm_sales_remote'))return {rows:stored?[stored]:[]};
  if(sql.startsWith('INSERT INTO crm_sales_remote')){stored={draft_id:p[0],token_hash:p[1],frozen_document:JSON.parse(p[2]),version:p[3],terms:p[4],terms_version:p[5],staff_name:p[6],staff_email:p[7],staff_signature:p[8],channel:p[9],destination:p[10],token_ciphertext:p[11],expires_at:new Date(Date.now()+86400000).toISOString(),status:'pending'};}
  if(sql.includes("delivery_status='failed'")){stored.delivery_status='failed';stored.delivery_error=p[1];}
  if(sql.includes("delivery_status='accepted'"))stored.delivery_status='accepted';
  return {rows:[],rowCount:0};
 };
 const deliver=async(...args)=>{messages.push(args);if(fail)throw Error('Provider test rejection');return {messageId:'mock',sid:'mock',status:'queued'}};
 const ctx={express:{Router:()=>router},requireAgreementReservation:async()=>{},...crypto,Buffer,Date,console:{error(){}},process:{env:{HTFO_APPROVED_SALES_TERMS:'Approved test terms',HTFO_SALES_TERMS_VERSION:'test-v1',SERVICE_JWT_SECRET:'test-secret-only'}}};vm.createContext(ctx);
 const src=fs.readFileSync(path.join(__dirname,'../crm-remote-agreement-routes.js'),'utf8').replace(/^import .*;\n/gm,'').replace('export function','function');
 vm.runInContext(src+'\nthis.factory=remoteAgreementRouter;',ctx);
 ctx.factory({q,guard:[],salesIdentity:()=>{},ensureSalesDrafts:async()=>{},validateSalesDraft:x=>x,signatureImage:()=>Buffer.from('staff signature test'),staffEmail:()=> 'ray@example.test',email:deliver,sms:deliver,opted:async()=>optout,ensureExecutedContracts:async()=>{}});
 const response=()=>({code:200,status(n){this.code=n;return this},json(x){this.body=x;return this}});
 const req={params:{id:'23'},user:{role:'owner',sub:1},body:{channel:'email',terms_version:'test-v1',staff_name:'Test Staff',staff_signature:'mock'}};
 let res=response();await routes['/sales-drafts/:id/send-for-signing'](req,res);assert.equal(res.body.sent,true);const first=stored.token_hash;assert.notEqual(stored.token_ciphertext,messages[0][2].split('#').at(-1));
 req.body.channel='sms';res=response();await routes['/sales-drafts/:id/send-for-signing'](req,res);assert.equal(res.body.sent,true);assert.equal(stored.token_hash,first,'Email and text must preserve the same signing link');
 fail=true;res=response();await routes['/sales-drafts/:id/send-for-signing'](req,res);assert.equal(res.code,400);assert.equal(stored.status,'pending');assert.equal(stored.token_hash,first);assert.equal(stored.delivery_status,'failed');
 optout=true;const n=messages.length;res=response();await routes['/sales-drafts/:id/send-for-signing'](req,res);assert.equal(messages.length,n);assert.match(res.body.error,/opted out/);
 optout=false;fail=false;draft.version++;res=response();await routes['/sales-drafts/:id/send-for-signing'](req,res);assert.notEqual(stored.token_hash,first,'A changed agreement must invalidate the old link');
 const page=await import('../remote-sign-page.js');assert.ok(page.remoteSignaturePage.includes('src="/api/service/crm/v1/remote-customer.js"'));assert.equal(/<script>/.test(page.remoteSignaturePage),false);new Function(page.remoteSignatureScript);
 console.log('Remote signing passed: email/text link reuse, failed resend preservation, opt-out blocking, changed agreement invalidation and external script syntax.');
})().catch(e=>{console.error(e);process.exitCode=1});
