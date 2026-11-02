import express from 'express';
import {randomBytes,createHash} from 'node:crypto';
export function remoteAgreementRouter({q,guard,salesIdentity,ensureSalesDrafts,validateSalesDraft,signatureImage,staffEmail,email,sms,opted,signedPdf,ensureExecutedContracts,sendContractPdf}){
 const router=express.Router(),hash=t=>createHash('sha256').update(t).digest('hex');
 const terms=()=>({text:String(process.env.HTFO_APPROVED_SALES_TERMS||'').trim(),version:String(process.env.HTFO_SALES_TERMS_VERSION||'').trim()});
 const ready=()=>{const t=terms();if(!t.text||!t.version)throw Error('Final terms await approval');return t};
 const schema=()=>q(`CREATE TABLE IF NOT EXISTS crm_sales_remote_signatures(
 draft_id BIGINT PRIMARY KEY REFERENCES crm_sales_drafts(id),token_hash TEXT UNIQUE NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,status TEXT NOT NULL,
 frozen_document JSONB NOT NULL,version INTEGER NOT NULL,terms TEXT NOT NULL,terms_version TEXT NOT NULL,
 staff_name TEXT NOT NULL,staff_email TEXT NOT NULL,staff_signature BYTEA NOT NULL,
 channel TEXT NOT NULL,destination TEXT NOT NULL,feedback TEXT,signed_at TIMESTAMPTZ)`);
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
   const doc=validateSalesDraft(draft.document);if(!doc.customer.email||!doc.customer.first_name||!doc.customer.last_name||!doc.spa.model||!doc.msrp)throw Error('Complete customer details and spa pricing');
   const destination=channel==='email'?doc.customer.email:doc.customer.phone;if(!destination)throw Error('Customer contact missing');
   if(channel==='sms'&&await opted(destination))throw Error('Customer has opted out of SMS');
   const name=String(req.body.staff_name||'').trim(),staff=staffEmail(req.user);if(name.length<3||!staff)throw Error('Salesperson details missing');
   const signature=signatureImage(req.body.staff_signature,'Salesperson'),token=randomBytes(32).toString('hex');
   await q(`INSERT INTO crm_sales_remote_signatures(draft_id,token_hash,expires_at,status,frozen_document,version,terms,terms_version,staff_name,staff_email,staff_signature,channel,destination)
   VALUES($1,$2,NOW()+INTERVAL '7 days','pending',$3::jsonb,$4,$5,$6,$7,$8,$9,$10,$11)
   ON CONFLICT(draft_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,expires_at=EXCLUDED.expires_at,status='pending',frozen_document=EXCLUDED.frozen_document,version=EXCLUDED.version,terms=EXCLUDED.terms,terms_version=EXCLUDED.terms_version,staff_name=EXCLUDED.staff_name,staff_email=EXCLUDED.staff_email,staff_signature=EXCLUDED.staff_signature,channel=EXCLUDED.channel,destination=EXCLUDED.destination,feedback=NULL,signed_at=NULL`,
   [draft.id,hash(token),JSON.stringify(doc),draft.version,t.text,t.version,name,staff,signature,channel,destination]);
   const url='https://htfo-service-operations.onrender.com/api/service/crm/v1/remote-customer#'+token;
   const message='Please review your Hot Tub Factory Outlet agreement #'+draft.id+' and sign or request corrections: '+url+' (expires in 7 days)';
   try{if(channel==='sms')await sms(destination,message);else await email(destination,'Please review and sign HTFO agreement #'+draft.id,message,doc.customer.first_name,req.user,doc.submission_id||null)}
   catch(e){await q("UPDATE crm_sales_remote_signatures SET status='delivery_failed' WHERE draft_id=$1",[draft.id]);throw e}
   res.json({sent:true,channel,destination});
  }catch(e){res.status(400).json({error:e.message})}
 });
 router.post('/remote-customer/review',async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  try{const r=await tokenRecord(req.body.token);if(!r||r.status!=='pending'||r.version!==r.current_version)return res.status(410).json({error:'Link expired or agreement changed'});
   const d=r.frozen_document;res.json({id:r.draft_id,customer:d.customer.first_name+' '+d.customer.last_name,spa:d.spa,items:d.items,msrp:d.msrp,discount:d.discount,totals:d.totals,notes:d.notes,terms:r.terms,terms_version:r.terms_version});
  }catch(e){res.status(500).json({error:'Unable to load agreement'})}
 });
 router.post('/remote-customer/correction',async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  try{const r=await tokenRecord(req.body.token);if(!r||r.status!=='pending')return res.status(410).json({error:'Link expired'});
   const feedback=String(req.body.feedback||'').trim().slice(0,2000);if(feedback.length<8)throw Error('Describe the correction requested');
   await q("UPDATE crm_sales_remote_signatures SET status='correction_requested',feedback=$2 WHERE draft_id=$1 AND status='pending'",[r.draft_id,feedback]);
   try{await email(r.staff_email,'Customer requested correction to agreement #'+r.draft_id,feedback,'Sales team',{username:'sales',name:'HTFO Sales'})}catch(_){}
   res.json({status:'correction_requested'});
  }catch(e){res.status(400).json({error:e.message})}
 });
 router.get('/sales-drafts/:id/remote-status',...guard,salesIdentity,async(req,res)=>{
  try{await schema();const result=(await q('SELECT status,expires_at,channel,destination,feedback,signed_at FROM crm_sales_remote_signatures WHERE draft_id=$1',[req.params.id])).rows[0];res.json(result||{status:'not_sent'})}catch(e){res.status(500).json({error:'Unable to load status'})}
 });
 return router;
}
