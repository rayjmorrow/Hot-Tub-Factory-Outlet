import express from 'express';
import {transaction} from './service-db.js';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {anetApi,anetCredentials,paymentSchema} from './crm-authorize-checkout.js';
export function authorizePaymentWebhook({q,validateSalesDraft}){
 const router=express.Router();
 router.post('/pay/authorize-webhook',async(req,res)=>{
  try{
   const m=anetCredentials(),incoming=String(req.get('X-ANET-Signature')||'').replace(/^sha512=/i,'');
   if(!/^[a-f0-9]{128}$/i.test(incoming))return res.sendStatus(401);
   const expected=createHmac('sha512',Buffer.from(m.signature,'hex')).update(req.rawBody||Buffer.alloc(0)).digest();
   if(!timingSafeEqual(expected,Buffer.from(incoming,'hex')))return res.sendStatus(401);
   const event=req.body||{};
   if(event.eventType!=='net.authorize.payment.authcapture.created')return res.sendStatus(200);
   const id=String(event.payload?.id||'');if(!/^\d+$/.test(id))return res.sendStatus(200);
   const result=await anetApi(m,{getTransactionDetailsRequest:{merchantAuthentication:{name:m.login,transactionKey:m.key},transId:id}});
   const txn=result.transaction;
   if(!txn||result.messages?.resultCode!=='Ok')throw Error('Transaction verification failed');
   if(!['capturedPendingSettlement','settledSuccessfully'].includes(txn.transactionStatus))return res.sendStatus(200);
   await paymentSchema(q);
   await transaction(async run=>{
    const record=(await run('SELECT * FROM crm_authorize_payment_requests WHERE invoice=$1 FOR UPDATE',[txn.order?.invoiceNumber||''])).rows[0];
    if(!record||record.status!=='pending')return;
    if(Math.round(Number(txn.authAmount)*100)!==record.amount_cents)throw Error('Payment amount mismatch');
    const draft=(await run('SELECT * FROM crm_sales_drafts WHERE id=$1 FOR UPDATE',[record.draft_id])).rows[0];
    if(!draft)throw Error('Draft missing');
    const payments=[...(draft.document.payments||[])];
    if(!payments.some(p=>p.reference===id)){
     const date=String(txn.submitTimeLocal||txn.submitTimeUTC||new Date().toISOString()).slice(0,10);
     payments.push({date,method:'Card — paid externally',amount:record.amount_cents,reference:id});
     const document=validateSalesDraft({...draft.document,payments});
     await run('UPDATE crm_sales_drafts SET document=$1::jsonb,version=version+1,updated_at=NOW() WHERE id=$2',[JSON.stringify(document),record.draft_id]);
    }
    await run("UPDATE crm_authorize_payment_requests SET status='confirmed',processor_transaction_id=$2,confirmed_at=NOW() WHERE id=$1",[record.id,id]);
   });
   res.sendStatus(200);
  }catch(e){res.status(503).json({error:'Payment reconciliation will retry'})}
 });
 return router;
}
