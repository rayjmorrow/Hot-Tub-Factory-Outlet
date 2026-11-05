import express from 'express';
import jwt from 'jsonwebtoken';
import {q} from './service-db.js';

const router=express.Router();
const managerRoles=new Set(['owner','admin','manager']);
const normalize=s=>String(s||'').trim().toLowerCase();
const safeCents=v=>Number.isSafeInteger(Number(v))&&Number(v)>=0?Number(v):null;
function authorize(req,res,next){
 try{
  const raw=String(req.get('authorization')||'').replace(/^Bearer\\s+/i,'');
  const user=jwt.verify(raw,process.env.SERVICE_JWT_SECRET);
  if(!managerRoles.has(normalize(user.role)))return res.status(403).json({error:'Commission preview is manager-only'});
  req.staff=user;next();
 }catch{return res.status(401).json({error:'Login required'})}
}
function calculate(doc,wholesaleCents){
 const cost=safeCents(wholesaleCents),msrp=safeCents(doc?.msrp),discount=safeCents(doc?.discount);
 if(cost===null||cost===0||msrp===null||discount===null||discount>msrp)return null;
 // PAR = ((wholesale + $750 freight) / 60%) + $200 accessories + $400 delivery.
 const par=Math.round(((cost+75000)/0.6)+60000);
 const sellingPrice=msrp-discount;
 const difference=sellingPrice-par;
 const base=Math.round(par*0.08);
 const adjustment=Math.round(difference*0.30);
 return {par_cents:par,spa_sale_cents:sellingPrice,over_under_cents:difference,base_commission_cents:base,over_under_adjustment_cents:adjustment,provisional_commission_cents:base+adjustment};
}
router.get('/crm/v1/admin/commission-preview',authorize,async(req,res)=>{
 try{
  const rows=(await q(`SELECT e.draft_id,e.executed_at,e.executed_document
   FROM crm_sales_executed_contracts e ORDER BY e.executed_at DESC LIMIT 500`)).rows;
  const pricebook=(await q('SELECT brand,model,wholesale_cents FROM crm_sales_pricebook')).rows;
  const costs=new Map(pricebook.map(x=>[normalize(x.brand)+'|'+normalize(x.model),x.wholesale_cents]));
  const list=rows.map(r=>{
   const d=r.executed_document||{},spa=d.spa||{},key=normalize(spa.brand)+'|'+normalize(spa.model);
   const wholesale=costs.get(key),calc=wholesale===undefined?null:calculate(d,wholesale);
   const financeAmount=safeCents(d.finance?.amount)||0;
   const holds=[];
   if(!calc)holds.push('approved_wholesale_missing_or_invalid');
   if(financeAmount>0)holds.push('finance_dealer_fee_requires_verification');
   holds.push('delivery_and_payment_eligibility_not_verified');
   return {agreement_id:r.draft_id,executed_at:r.executed_at,salesperson:d.salesperson||'',
    department:d.sales_department||'unassigned',brand:spa.brand||'',model:spa.model||'',
    ...calc,finance_amount_cents:financeAmount,holds,commission_status:'NOT_PAYABLE_PREVIEW_ONLY'};
  });
  res.set('Cache-Control','no-store');
  res.json({count:list.length,rule:'8% of PAR plus 30% of overage or minus 30% of underage, pending fee and delivery review',
   note:'Preview only; no payroll, payment eligibility, delivery completion, or commission ledger entries are modified.',rows:list});
 }catch(e){res.status(503).json({error:'Commission preview unavailable; verify wholesale pricebook and signed agreements'})}
});
export default router;
