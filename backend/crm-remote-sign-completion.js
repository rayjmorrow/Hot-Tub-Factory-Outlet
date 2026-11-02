import express from 'express';
import {createHash,randomBytes} from 'node:crypto';
import {remoteSignaturePage} from './remote-sign-page.js';
export function remoteSigningCompletion({q,ensureExecutedContracts,validateSalesDraft,signatureImage,signedPdf,sendContractPdf,ensure}){
 const router=express.Router(),sha=s=>createHash('sha256').update(s).digest('hex');
 router.get('/remote-customer',(_req,res)=>res.set('Cache-Control','no-store').set('Referrer-Policy','no-referrer').type('html').send(remoteSignaturePage));
 router.post('/remote-customer/sign',async(req,res)=>{
  res.set('Cache-Control','no-store');
  try{
   const token=String(req.body?.token||'');if(!/^[a-f0-9]{64}$/.test(token))return res.status(410).json({error:'Invalid signing link'});
   const t=String(process.env.HTFO_APPROVED_SALES_TERMS||'').trim(),v=String(process.env.HTFO_SALES_TERMS_VERSION||'').trim();
   if(!t||!v||req.body.consent!==true||req.body.terms_version!==v)throw Error('Final sales terms must be reviewed and accepted');
   const rec=(await q("SELECT r.*,d.version current_version FROM crm_sales_remote_signatures r JOIN crm_sales_drafts d ON r.draft_id=d.id WHERE r.token_hash=$1 AND r.expires_at>NOW() AND r.status='pending'",[sha(token)])).rows[0];
   if(!rec||rec.version!==rec.current_version||rec.terms_version!==v)return res.status(410).json({error:'Agreement expired, changed or previously signed'});
   const d=validateSalesDraft(rec.frozen_document),name=String(req.body.name||'').trim();if(name.length<3)throw Error('Enter your full legal name');
   const png=signatureImage(req.body.signature,'Customer');await ensureExecutedContracts();
   let id=d.submission_id||null;
   if(id){if(!(await q('SELECT 1 FROM crm_website_leads WHERE submission_id=$1 AND deleted_at IS NULL',[id])).rowCount)throw Error('Linked customer profile not found')}
   else{const matches=(await q("SELECT submission_id FROM crm_website_leads WHERE deleted_at IS NULL AND lower(email)=lower($1) LIMIT 2",[d.customer.email])).rows;if(matches.length>1)throw Error('Please contact HTFO to verify your customer profile before signing');
    if(matches.length===1)id=matches[0].submission_id;
    else{
      await ensure();id='signed-'+randomBytes(10).toString('hex');
      await q(`INSERT INTO crm_website_leads(submission_id,first_name,last_name,email,phone,source,note,payload,product_interest,brand_interest,model_interest,assigned_to,showroom,lifecycle_stage,pipeline_stage,has_opportunity,received_at,updated_at)
       VALUES($1,$2,$3,$4,$5,'Walk-In','Remote signed agreement',$6::jsonb,'Hot Tub',$7,$8,$9,$10,'Customer','Won',true,NOW(),NOW())`,
      [id,d.customer.first_name,d.customer.last_name,d.customer.email,d.customer.phone,JSON.stringify({remote_agreement:rec.draft_id}),d.spa.brand,d.spa.model,rec.staff_name,d.location]);
    }}
   const pdf=await signedPdf(d,rec.draft_id,{customer_name:name,salesperson_name:rec.staff_name,customer_png:png,salesperson_png:rec.staff_signature,terms_text:t,terms_version:v});
   const accepted=await q("UPDATE crm_sales_remote_signatures SET status='signed',signed_at=NOW() WHERE draft_id=$1 AND status='pending' AND version=$2 RETURNING draft_id",[rec.draft_id,rec.current_version]);
   if(!accepted.rowCount)return res.status(409).json({error:'Already processed'});
   try{await q(`INSERT INTO crm_sales_executed_contracts(draft_id,submission_id,customer_email,salesperson_email,executed_document,customer_name,salesperson_name,customer_signature,salesperson_signature,terms_text,terms_version,pdf_data,pdf_sha256)
    VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13)`,[rec.draft_id,id,d.customer.email,rec.staff_email,JSON.stringify(d),name,rec.staff_name,png,rec.staff_signature,t,v,pdf,sha(pdf)]);}
   catch(e){await q("UPDATE crm_sales_remote_signatures SET status='pending',signed_at=NULL WHERE draft_id=$1",[rec.draft_id]);throw e}
   for(const [column,to,recipient] of [['sent_customer_at',d.customer.email,name],['sent_salesperson_at',rec.staff_email,rec.staff_name],['sent_owner_at','ray@hottubfactoryoutlet.com','HTFO Owner']]){
    try{await sendContractPdf(to,recipient,'Signed HTFO Agreement #'+rec.draft_id,'Signed sales agreement attached','HTFO-Signed-'+rec.draft_id+'.pdf',pdf,{username:'sales',name:'Hot Tub Factory Outlet'});await q('UPDATE crm_sales_executed_contracts SET '+column+'=NOW() WHERE draft_id=$1',[rec.draft_id])}
    catch(e){await q('UPDATE crm_sales_executed_contracts SET last_error=$2 WHERE draft_id=$1',[rec.draft_id,String(e.message).slice(0,300)])}
   }
   res.json({signed:true,id:rec.draft_id});
  }catch(e){res.status(400).json({error:e.message})}
 });
 return router;
}
