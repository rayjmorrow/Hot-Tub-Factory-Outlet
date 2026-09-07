import express from 'express';
import jwt from 'jsonwebtoken';
import { q } from './service-db.js';

const router=express.Router();
const clean=v=>v==null?null:String(v).trim();
function secret(){if(!process.env.SERVICE_JWT_SECRET)throw new Error('SERVICE_JWT_SECRET is required');return process.env.SERVICE_JWT_SECRET}
function auth(req,res,next){try{const raw=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!raw)return res.status(401).json({error:'Login required'});req.user=jwt.verify(raw,secret());next()}catch{res.status(401).json({error:'Session expired or invalid'})}}

export async function initServiceCommercialRules(){
  await q(`
    ALTER TABLE service_work_orders ADD COLUMN IF NOT EXISTS repair_completed BOOLEAN NOT NULL DEFAULT FALSE;

    CREATE OR REPLACE FUNCTION htfo_apply_service_charge_rules() RETURNS trigger AS $$
    BEGIN
      IF NEW.repair_completed IS TRUE THEN
        NEW.diagnostic_amount := 0;
      END IF;
      NEW.tax_amount := ROUND(GREATEST(COALESCE(NEW.parts_amount,0),0) * 0.07, 2);
      NEW.total_amount := ROUND(
        GREATEST(COALESCE(NEW.diagnostic_amount,0),0) +
        GREATEST(COALESCE(NEW.labor_amount,0),0) +
        GREATEST(COALESCE(NEW.parts_amount,0),0) +
        GREATEST(COALESCE(NEW.trip_amount,0),0) +
        GREATEST(COALESCE(NEW.tax_amount,0),0), 2
      );
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS htfo_service_charge_rules ON service_work_orders;
    CREATE TRIGGER htfo_service_charge_rules
      BEFORE INSERT OR UPDATE ON service_work_orders
      FOR EACH ROW EXECUTE FUNCTION htfo_apply_service_charge_rules();
  `);

  const existing=await q(`SELECT id FROM service_pricing_rules WHERE name=$1 LIMIT 1`,['HTFO Default Parts 50% Margin']);
  if(existing.rowCount){
    await q(`UPDATE service_pricing_rules SET category=NULL,rule_type='margin_percent',value=50,minimum_sell=NULL,minimum_profit=NULL,active=true,priority=1,updated_at=NOW() WHERE id=$1`,[existing.rows[0].id]);
  }else{
    await q(`INSERT INTO service_pricing_rules(name,category,rule_type,value,minimum_sell,minimum_profit,active,priority) VALUES($1,NULL,'margin_percent',50,NULL,NULL,true,1)`,['HTFO Default Parts 50% Margin']);
  }
}

router.patch('/work-orders/:id/repair-completed',auth,async(req,res)=>{
  const completed=req.body?.repair_completed!==false;
  const current=(await q('SELECT * FROM service_work_orders WHERE id=$1',[req.params.id])).rows[0];
  if(!current)return res.status(404).json({error:'Work order not found'});
  const diagnostic=completed?0:100;
  const note=clean(req.body?.note);
  const r=await q(`UPDATE service_work_orders
    SET repair_completed=$2,
        diagnostic_amount=$3,
        internal_notes=CASE WHEN $4 IS NULL THEN internal_notes ELSE concat_ws(E'\n',internal_notes,$4) END,
        updated_at=NOW()
    WHERE id=$1 RETURNING *`,[req.params.id,completed,diagnostic,note]);
  res.json(r.rows[0]);
});

router.get('/commercial-rules',auth,(req,res)=>res.json({
  parts_gross_margin_percent:50,
  parts_price_multiplier:2,
  diagnostic_charge:100,
  diagnostic_waived_when_repair_completed:true,
  customer_location_assignment_required:false,
  service_and_delivery_location_model:'single_operations_location'
}));

export default router;
