import express from 'express';
import jwt from 'jsonwebtoken';
import {q,transaction} from './service-db.js';

const router=express.Router();
const clean=v=>String(v??'').trim();
const validMoney=v=>Number.isFinite(Number(v))&&Number(v)>=0&&Number(v)<=10000000;
function auth(req,res,next){
  try {
    const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
    const user=jwt.verify(token,process.env.SERVICE_JWT_SECRET);
    if(!['owner','admin','manager','service_manager'].includes(String(user.role||'').toLowerCase()))
      return res.status(403).json({error:'Manager access required to import prior sales'});
    req.user=user;next();
  }catch(e){return res.status(401).json({error:'Login required'});}
}
export async function initLegacySales(){
  await q(`CREATE TABLE IF NOT EXISTS service_legacy_sale_imports (
    id BIGSERIAL PRIMARY KEY,
    customer_id BIGINT NOT NULL REFERENCES service_customers(id),
    order_id BIGINT NOT NULL UNIQUE REFERENCES service_customer_orders(id),
    equipment_id BIGINT NOT NULL REFERENCES service_equipment(id),
    original_agreement_ref TEXT NOT NULL UNIQUE,
    original_signed_date DATE NOT NULL,
    signed_document_location TEXT NOT NULL,
    previously_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
    recorded_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
    delivery_notes TEXT,
    imported_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}
router.post('/customers/:id/import-existing-sale',auth,async(req,res)=>{
  const b=req.body||{},customerId=Number(req.params.id);
  const agreementRef=clean(b.agreement_ref),brand=clean(b.brand),model=clean(b.model);
  const originalDate=clean(b.original_date),documentLocation=clean(b.signed_document_location);
  const total=Number(b.total_amount),paid=Number(b.previously_paid),tax=Number(b.tax_amount||0);
  if(!Number.isSafeInteger(customerId)||customerId<=0)return res.status(400).json({error:'Invalid customer'});
  if(!agreementRef||agreementRef.length>140||!/^\d{4}-\d{2}-\d{2}$/.test(originalDate)||!documentLocation)
    return res.status(400).json({error:'Agreement reference, original signed date and location of signed original are required'});
  if(!brand||!model)return res.status(400).json({error:'Spa brand and model are required'});
  if(![total,paid,tax].every(validMoney)||paid>total||tax>total)return res.status(400).json({error:'Check contract total, tax, and previously paid amounts'});
  try{
    const result=await transaction(async exec=>{
      const cust=await exec('SELECT id FROM service_customers WHERE id=$1 AND archived_at IS NULL',[customerId]);
      if(!cust.rowCount)throw new Error('Customer not found');
      const old=await exec('SELECT id FROM service_legacy_sale_imports WHERE original_agreement_ref=$1',[agreementRef]);
      if(old.rowCount)throw new Error('This original agreement reference has already been imported');
      const equipment=(await exec(`INSERT INTO service_equipment(customer_id,equipment_type,brand,model,serial_number,notes)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[customerId,clean(b.equipment_type)||'Hot Tub',brand,model,clean(b.serial_number)||null,'Imported existing signed sale '+agreementRef])).rows[0];
      const number='LEGACY-'+agreementRef;
      const order=(await exec(`INSERT INTO service_customer_orders(customer_id,external_order_id,order_number,status,order_type,source,subtotal,tax_amount,total_amount,notes)
        VALUES($1,$2,$3,'scheduled','delivery','legacy_signed_sale',$4,$5,$6,$7) RETURNING id,order_number`,
        [customerId,'legacy:'+agreementRef,number,total-tax,tax,total,'Historical signed sale; no new contract or payment recorded. Original signed: '+originalDate+'. Original stored at: '+documentLocation+'. '+clean(b.delivery_notes)])).rows[0];
      await exec(`INSERT INTO service_customer_order_items(order_id,description,quantity,unit_price,line_total,item_scope)
        VALUES($1,$2,1,$3,$3,'one_time')`,[order.id,[brand,model,clean(b.serial_number)].filter(Boolean).join(' · '),total-tax]);
      await exec(`INSERT INTO service_legacy_sale_imports(customer_id,order_id,equipment_id,original_agreement_ref,original_signed_date,signed_document_location,previously_paid,recorded_balance,delivery_notes,imported_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [customerId,order.id,equipment.id,agreementRef,originalDate,documentLocation,paid,total-paid,clean(b.delivery_notes),req.user?.name||req.user?.username||'staff']);
      await exec(`INSERT INTO service_order_change_log(customer_id,order_id,action,description,actor)
        VALUES($1,$2,'legacy_sale_imported',$3,$4)`,[customerId,order.id,'Imported pre-existing signed agreement '+agreementRef+'; recorded prior paid amount for reference only; no charge/email/signature request.',req.user?.name||req.user?.username||'staff']);
      return {order_id:order.id,order_number:order.order_number,equipment_id:equipment.id,recorded_balance:total-paid};
    });
    res.status(201).json({...result,communications_sent:false,charges_created:false,signature_requested:false});
  }catch(err){
    if(err.code==='23505')return res.status(409).json({error:'Agreement reference already imported'});
    if(err.code==='22007')return res.status(400).json({error:'Invalid agreement date'});
    console.error('Legacy sale import rejected',err);
    res.status(400).json({error:err.message||'Could not import sale'});
  }
});
export default router;
