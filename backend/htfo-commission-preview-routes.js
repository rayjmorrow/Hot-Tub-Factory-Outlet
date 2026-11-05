import express from 'express';
import jwt from 'jsonwebtoken';
import {q,transaction} from './service-db.js';

const router=express.Router();
const managerRoles=new Set(['owner','admin','manager']);
const normalize=s=>String(s||'').trim().toLowerCase();
const safeCents=v=>v!==null&&v!==undefined&&v!==''&&Number.isSafeInteger(Number(v))&&Number(v)>=0?Number(v):null;
async function authorize(req,res,next){
 try{
  const raw=String(req.get('authorization')||'').replace(/^Bearer\s+/i,'');
  const user=jwt.verify(raw,process.env.SERVICE_JWT_SECRET);
  const staff=(await q('SELECT id,role FROM service_users WHERE id=$1 AND active=true',[user.sub])).rows[0];
  if(!staff||!['owner','admin','manager','sales'].includes(staff.role))return res.status(403).json({error:'Sales or management access required'});
  req.staff=staff;next();
 }catch{return res.status(401).json({error:'Login required'})}
}
function calculate(doc,wholesaleCents,mapCents=null){
 const cost=safeCents(wholesaleCents),msrp=safeCents(doc?.msrp),discount=safeCents(doc?.discount);
 if((mapCents===null&&(cost===null||cost===0))||msrp===null||discount===null||discount>msrp)return null;
 // PAR = ((wholesale + $750 freight) / 60%) + $200 accessories + $400 delivery.
 const par=mapCents??Math.round(((cost+75000)/0.6)+60000);
 const sellingPrice=msrp-discount;
 const difference=sellingPrice-par;
 const base=Math.round(par*0.08);
 const adjustment=Math.round(difference*0.30);
 return {par_cents:par,spa_sale_cents:sellingPrice,over_under_cents:difference,base_commission_cents:base,over_under_adjustment_cents:adjustment,provisional_commission_cents:base+adjustment};
}
function managersOnly(req,res,next){
 if(!managerRoles.has(req.staff.role))return res.status(403).json({error:'Commission management requires a manager'});
 next();
}
router.get('/crm/v1/admin/commission-preview',authorize,managersOnly,async(req,res)=>{
 try{
  const rows=(await q(`SELECT e.draft_id,e.executed_at,e.executed_document
   FROM crm_sales_executed_contracts e ORDER BY e.executed_at DESC LIMIT 500`)).rows;
  const pricebook=(await q('SELECT brand,model,wholesale_cents FROM crm_sales_pricebook')).rows;
  const costs=new Map(pricebook.map(x=>[normalize(x.brand)+'|'+normalize(x.model),x.wholesale_cents]));
  const list=rows.map(r=>{
   const d=r.executed_document||{},spa=d.spa||{},key=normalize(spa.brand)+'|'+normalize(spa.model);
   const wholesale=costs.get(key),calc=wholesale===undefined||normalize(spa.brand)==='innova spas'?null:calculate(d,wholesale);
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

let ledgerSchema;
function ensureLedger(){
 if(!ledgerSchema)ledgerSchema=q(`CREATE TABLE IF NOT EXISTS htfo_sales_commissions (
  draft_id BIGINT PRIMARY KEY REFERENCES crm_sales_drafts(id),
  owner_user_id BIGINT NOT NULL REFERENCES service_users(id), draft_version INTEGER NOT NULL,
  department TEXT NOT NULL, eligible_on DATE NOT NULL, amount_cents BIGINT NOT NULL,
  basis JSONB NOT NULL, reviewed_by BIGINT NOT NULL REFERENCES service_users(id),
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), paid_at TIMESTAMPTZ,
  payroll_reference TEXT, paid_by BIGINT REFERENCES service_users(id)
 )`).catch(error=>{ledgerSchema=null;throw error});
 return ledgerSchema;
}
const pittsburghDate=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'});
function depositDate(doc){
 const total=safeCents(doc.totals?.total);
 if(!total)return null;
 const payments=(doc.payments||[]).filter(p=>['Cash','Check','Card — paid externally'].includes(p.method)&&safeCents(p.amount)>0)
  .sort((a,b)=>String(a.date).localeCompare(String(b.date)));
 let paid=0;
 for(const payment of payments){
  paid+=Number(payment.amount);
  if(paid*2>=total)return payment.date;
 }
 return null;
}

router.get('/crm/v1/commissions',authorize,async(req,res)=>{
 try{
  await ensureLedger();
  const month=String(req.query.month||pittsburghDate.format(new Date()).slice(0,7));
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return res.status(400).json({error:'Choose a valid report month'});
  const staff=managerRoles.has(req.staff.role)?null:req.staff.id;
  const {rows}=await q(`SELECT c.draft_id,c.department,c.eligible_on::text,c.amount_cents,c.paid_at,
    CASE WHEN c.paid_at IS NOT NULL THEN 'paid' WHEN c.draft_version<>d.version THEN 'review_required' ELSE 'approved' END AS status,
    u.display_name salesperson
    FROM htfo_sales_commissions c JOIN crm_sales_drafts d ON d.id=c.draft_id
    JOIN service_users u ON u.id=c.owner_user_id
    WHERE c.eligible_on>=$1::date AND c.eligible_on<($1::date+INTERVAL '1 month')
    AND ($2::bigint IS NULL OR c.owner_user_id=$2) ORDER BY u.display_name,c.eligible_on,c.draft_id`,[month+'-01',staff]);
  res.set('Cache-Control','no-store').json({month,rows});
 }catch(error){res.status(503).json({error:'Commission ledger unavailable'})}
});

router.post('/crm/v1/admin/commissions/:id/review',authorize,managersOnly,async(req,res)=>{
 try{
  const id=Number(req.params.id),body=req.body||{};
  if(!Number.isSafeInteger(id)||id<1||body.verified!==true)return res.status(400).json({error:'Confirm review of the agreement and payment records'});
  await ensureLedger();
  const approved=await transaction(async run=>{
   const row=(await run(`SELECT d.document,d.version,d.owner_user_id,e.executed_at
     FROM crm_sales_drafts d JOIN crm_sales_executed_contracts e ON e.draft_id=d.id WHERE d.id=$1 FOR UPDATE OF d`,[id])).rows[0];
   if(!row?.owner_user_id)throw Error('A signed agreement with an assigned salesperson is required');
   const d=row.document,brand=d.spa?.brand,model=d.spa?.model;
   const existing=(await run('SELECT paid_at FROM htfo_sales_commissions WHERE draft_id=$1 FOR UPDATE',[id])).rows[0];
   if(existing?.paid_at)throw Error('Payroll was already recorded for this agreement. Any adjustment requires separate review.');
   const innova=normalize(brand)==='innova spas';
   const map=innova?safeCents(body.innova_map_cents):null;
   if(innova&&!map)throw Error('Enter the approved Innova MAP in cents to use as PAR.');
   const pricebook=innova?[]:(await run('SELECT wholesale_cents FROM crm_sales_pricebook WHERE lower(brand)=lower($1) AND lower(model)=lower($2)',[brand,model])).rows;
   if(!innova&&pricebook.length!==1)throw Error('Exactly one approved wholesale price is required for this model.');
   const calculation=calculate(d,pricebook[0]?.wholesale_cents,map);
   if(!calculation)throw Error('The signed spa pricing could not be verified.');
   const financed=safeCents(d.finance?.amount)>0;
   let eligible=depositDate(d),deliveryId=null;
   if(financed){
    if(!d.finance?.complete||body.finance_fee_verified!==true)throw Error('Confirm the completed financing and actual dealer fee.');
    const delivery=(await run(`SELECT id,completed_at FROM service_work_orders
      WHERE id=$1 AND job_type='delivery' AND status='completed' AND completed_at IS NOT NULL
      AND lower(delivery_serial_number)=lower($2) AND coalesce(delivery_serial_number,'')<>''
      AND EXISTS(SELECT 1 FROM service_customers c WHERE c.id=service_work_orders.customer_id AND lower(c.email)=lower($3))`,
      [Number(body.delivery_work_order_id)||0,d.spa.serial,d.customer.email])).rows[0];
    if(!delivery)throw Error('A completed delivery work order matching the agreement serial and customer is required.');
    const next=new Date(pittsburghDate.format(new Date(delivery.completed_at))+'T00:00:00Z');
    next.setUTCDate(next.getUTCDate()+1);
    eligible=next.toISOString().slice(0,10);deliveryId=delivery.id;
   }
   if(!eligible)throw Error('At least 50% of the agreement total must be recorded as paid.');
   eligible=[eligible,pittsburghDate.format(new Date(row.executed_at))].sort().at(-1);
   const basis={...calculation,financed,delivery_work_order_id:deliveryId,verified_finance_fee:financed};
   return (await run(`INSERT INTO htfo_sales_commissions(draft_id,owner_user_id,draft_version,department,eligible_on,amount_cents,basis,reviewed_by)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
     ON CONFLICT(draft_id) DO UPDATE SET draft_version=excluded.draft_version,department=excluded.department,
      eligible_on=excluded.eligible_on,amount_cents=excluded.amount_cents,basis=excluded.basis,reviewed_by=excluded.reviewed_by,reviewed_at=NOW()
     WHERE htfo_sales_commissions.paid_at IS NULL RETURNING draft_id,eligible_on::text,amount_cents`,
     [id,row.owner_user_id,row.version,d.sales_department||'unassigned',eligible,calculation.provisional_commission_cents,JSON.stringify(basis),req.staff.id])).rows[0];
  });
  res.status(201).json(approved);
 }catch(error){res.status(409).json({error:error.message})}
});

router.post('/crm/v1/admin/commissions/:id/record-paid',authorize,managersOnly,async(req,res)=>{
 try{
  const id=Number(req.params.id),reference=String(req.body?.payroll_reference||'').trim(),amount=Number(req.body?.amount_cents);
  if(!Number.isSafeInteger(id)||id<1||!Number.isSafeInteger(amount)||!reference||reference.length>80||
    /(?:\d[ -]?){13,19}/.test(reference)||req.body?.confirmed_external_payroll!==true){
   return res.status(400).json({error:'Confirm the amount and provide the external payroll reference.'});
  }
  await ensureLedger();
  const paid=await transaction(async run=>{
   const d=(await run('SELECT version FROM crm_sales_drafts WHERE id=$1 FOR UPDATE',[id])).rows[0];
   return (await run(`UPDATE htfo_sales_commissions SET paid_at=NOW(),payroll_reference=$2,paid_by=$3
    WHERE draft_id=$1 AND amount_cents=$4 AND paid_at IS NULL AND eligible_on<=$5::date AND draft_version=$6
    RETURNING draft_id,amount_cents,paid_at`,[id,reference,req.staff.id,amount,pittsburghDate.format(new Date()),d?.version])).rows[0];
  });
  if(!paid)return res.status(409).json({error:'Commission is already paid, changed, ineligible, or does not match the approved amount.'});
  res.json(paid);
 }catch(error){res.status(503).json({error:'Payroll record could not be saved'})}
});
export default router;
