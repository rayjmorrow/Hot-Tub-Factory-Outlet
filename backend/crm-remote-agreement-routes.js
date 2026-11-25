import express from 'express';
import {requireAgreementReservation} from './htfo-agreement-reservation.js';
import {randomBytes,createHash,createCipheriv,createDecipheriv} from 'node:crypto';
export function remoteAgreementRouter({q,guard,salesIdentity,ensureSalesDrafts,validateSalesDraft,signatureImage,staffEmail,email,sms,opted,signedPdf,ensureExecutedContracts,sendContractPdf}){
 const router=express.Router(),hash=t=>createHash('sha256').update(t).digest('hex');
 const terms=()=>({text:String(process.env.HTFO_APPROVED_SALES_TERMS||'').trim(),version:String(process.env.HTFO_SALES_TERMS_VERSION||'').trim()});
 const ready=()=>{const t=terms();if(!t.text||!t.version)throw Error('Final terms await approval');return t};
 const schema=()=>q(`CREATE TABLE IF NOT EXISTS crm_sales_remote_signatures(
 draft_id BIGINT PRIMARY KEY REFERENCES crm_sales_drafts(id),token_hash TEXT UNIQUE NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,status TEXT NOT NULL,
 frozen_document JSONB NOT NULL,version INTEGER NOT NULL,terms TEXT NOT NULL,terms_version TEXT NOT NULL,
 staff_name TEXT NOT NULL,staff_email TEXT NOT NULL,staff_signature BYTEA NOT NULL,
 channel TEXT NOT NULL,destination TEXT NOT NULL,feedback TEXT,signed_at TIMESTAMPTZ);
 ALTER TABLE crm_sales_remote_signatures ADD COLUMN IF NOT EXISTS token_ciphertext TEXT;
 ALTER TABLE crm_sales_remote_signatures ADD COLUMN IF NOT EXISTS delivery_status TEXT;
 ALTER TABLE crm_sales_remote_signatures ADD COLUMN IF NOT EXISTS delivery_error TEXT;
 ALTER TABLE crm_sales_remote_signatures ADD COLUMN IF NOT EXISTS provider_id TEXT;
 ALTER TABLE crm_sales_remote_signatures ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ`);
 const tokenKey=()=>{const secret=String(process.env.SERVICE_JWT_SECRET||'');if(!secret)throw Error('Secure signing configuration is unavailable');return createHash('sha256').update('htfo-remote-signing:'+secret).digest()};
 const seal=(token,id)=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',tokenKey(),iv);cipher.setAAD(Buffer.from(String(id)));const encrypted=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64')};
 const unseal=(value,id)=>{try{const bytes=Buffer.from(value,'base64'),cipher=createDecipheriv('aes-256-gcm',tokenKey(),bytes.subarray(0,12));cipher.setAAD(Buffer.from(String(id)));cipher.setAuthTag(bytes.subarray(12,28));return Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString('utf8')}catch{return null}};
 const tokenRecord=async token=>{
  if(!/^[a-f0-9]{64}$/.test(String(token||'')))return null;
  await schema();return (await q("SELECT r.*,d.version current_version FROM crm_sales_remote_signatures r JOIN crm_sales_drafts d ON r.draft_id=d.id WHERE r.token_hash=$1 AND r.expires_at>NOW()",[hash(token)])).rows[0]||null;
 };
 router.post('/sales-drafts/:id/send-for-signing',...guard,salesIdentity,async(req,res)=>{
  try{
   const t=ready(),channel=req.body.channel;if(!['email','sms'].includes(channel))throw Error('Choose email or SMS');
   if(req.body.terms_version!==t.version)throw Error('Please review the latest terms');
   await ensureSalesDrafts();await schema();await ensureExecutedContracts();
   const draft=(await q('SELECT * FROM crm_sales_drafts WHERE id=$1',[req.params.id])).rows[0];if(!draft)throw Error('Agreement not found');
   if(!['owner','admin'].includes(req.user.role)&&String(draft.owner_user_id)!==String(req.user.sub))throw Error('Not authorized');
   if((await q('SELECT 1 FROM crm_sales_executed_contracts WHERE draft_id=$1',[draft.id])).rowCount)throw Error('Agreement already signed');
   const doc=validateSalesDraft(draft.document);if(!doc.customer.first_name||!doc.customer.last_name||!doc.spa.model||!doc.msrp)throw Error('Complete customer details and spa pricing');
   await requireAgreementReservation(q,draft.id,doc.spa);
   const destination=channel==='email'?doc.customer.email:doc.customer.phone;if(!destination)throw Error('Customer contact missing');
   if(channel==='sms'&&await opted(destination))throw Error('Customer has opted out of SMS');
   const name=String(req.body.staff_name||'').trim(),staff=staffEmail(req.user);if(name.length<3||!staff)throw Error('Salesperson details missing');
   const signature=signatureImage(req.body.staff_signature,'Salesperson');
   const previous=(await q('SELECT * FROM crm_sales_remote_signatures WHERE draft_id=$1',[draft.id])).rows[0];
   const reusable=previous?.status==='pending'&&previous.version===draft.version&&previous.terms===t.text&&previous.terms_version===t.version&&previous.staff_name===name&&previous.staff_email===staff&&Buffer.from(previous.staff_signature).equals(signature)&&new Date(previous.expires_at).getTime()>Date.now();
   const recovered=reusable&&previous.token_ciphertext?unseal(previous.token_ciphertext,draft.id):null;
   const token=recovered&&hash(recovered)===previous.token_hash?recovered:randomBytes(32).toString('hex');
   await q(`INSERT INTO crm_sales_remote_signatures(draft_id,token_hash,expires_at,status,frozen_document,version,terms,terms_version,staff_name,staff_email,staff_signature,channel,destination,token_ciphertext,delivery_status)
   VALUES($1,$2,NOW()+INTERVAL '7 days','pending',$3::jsonb,$4,$5,$6,$7,$8,$9,$10,$11,$12,'sending')
   ON CONFLICT(draft_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,expires_at=EXCLUDED.expires_at,status='pending',frozen_document=EXCLUDED.frozen_document,version=EXCLUDED.version,terms=EXCLUDED.terms,terms_version=EXCLUDED.terms_version,staff_name=EXCLUDED.staff_name,staff_email=EXCLUDED.staff_email,staff_signature=EXCLUDED.staff_signature,channel=EXCLUDED.channel,destination=EXCLUDED.destination,token_ciphertext=EXCLUDED.token_ciphertext,delivery_status='sending',delivery_error=NULL,provider_id=NULL,feedback=NULL,signed_at=NULL`,
   [draft.id,hash(token),JSON.stringify(doc),draft.version,t.text,t.version,name,staff,signature,channel,destination,seal(token,draft.id)]);
   const url='https://htfo-service-operations.onrender.com/api/service/crm/v1/remote-customer#'+token;
   const message='Please review your Hot Tub Factory Outlet agreement #'+draft.id+' and sign or request corrections: '+url+' (expires in 7 days)';
   try{
    const accepted=channel==='sms'?await sms(destination,message):await email(destination,'Please review and sign HTFO agreement #'+draft.id,message,doc.customer.first_name,req.user,doc.submission_id||null);
    if(['failed','undelivered'].includes(accepted?.status))throw Error('The text provider could not send this request');
    await q("UPDATE crm_sales_remote_signatures SET delivery_status='accepted',delivery_error=NULL,provider_id=$2,last_sent_at=NOW() WHERE draft_id=$1 AND token_hash=$3",[draft.id,accepted?.sid||accepted?.messageId||null,hash(token)]);
   }catch(e){
    await q("UPDATE crm_sales_remote_signatures SET delivery_status='failed',delivery_error=$2 WHERE draft_id=$1 AND token_hash=$3",[draft.id,String(e.message).slice(0,500),hash(token)]);
    console.error('Remote agreement delivery failed',JSON.stringify({draft_id:draft.id,channel,error:String(e.message).slice(0,500)}));throw e;
   }
   res.json({sent:true,delivery_status:'accepted',channel,destination});
  }catch(e){res.status(400).json({error:e.message})}
 });
 router.post('/remote-customer/review',async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  try{const r=await tokenRecord(req.body.token);if(!r||r.status!=='pending'||r.version!==r.current_version)return res.status(410).json({error:'Link expired or agreement changed'});
   const d=r.frozen_document;res.json({id:r.draft_id,customer:d.customer.first_name+' '+d.customer.last_name,customer_details:d.customer,contract_date:d.contract_date,finance:d.finance,spa:d.spa,items:d.items,msrp:d.msrp,discount:d.discount,totals:d.totals,notes:d.notes,terms:r.terms,terms_version:r.terms_version});
  }catch(e){res.status(500).json({error:'Unable to load agreement'})}
 });
 router.post('/remote-customer/correction',async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  try{const r=await tokenRecord(req.body.token);if(!r||r.status!=='pending')return res.status(410).json({error:'Link expired'});
   const feedback=String(req.body.feedback||'').trim().slice(0,2000);if(feedback.length<8)throw Error('Describe the correction requested');
   await q("UPDATE crm_sales_remote_signatures SET status='correction_requested',feedback=$2 WHERE draft_id=$1 AND token_hash=$3 AND status='pending'",[r.draft_id,feedback,hash(req.body.token)]);
   try{await email(r.staff_email,'Customer requested correction to agreement #'+r.draft_id,feedback,'Sales team',{username:'sales',name:'HTFO Sales'})}catch(_){}
   res.json({status:'correction_requested'});
  }catch(e){res.status(400).json({error:e.message})}
 });
 router.get('/sales-drafts/:id/remote-status',...guard,salesIdentity,async(req,res)=>{
  try{await schema();const result=(await q('SELECT status,expires_at,channel,destination,feedback,signed_at,delivery_status,delivery_error,last_sent_at FROM crm_sales_remote_signatures WHERE draft_id=$1',[req.params.id])).rows[0];res.json(result||{status:'not_sent'})}catch(e){res.status(500).json({error:'Unable to load status'})}
 });
 return router;
}
