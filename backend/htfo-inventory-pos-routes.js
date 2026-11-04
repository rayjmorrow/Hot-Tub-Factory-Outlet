import express from 'express';
import jwt from 'jsonwebtoken';
import {q} from './service-db.js';

const router=express.Router();
const MANAGEMENT=new Set(['owner','admin','manager']);
const SALES=new Set(['owner','admin','manager','sales']);
const RETAIL=new Set(['owner','admin','manager','sales','cashier','retail']);
const SERVICE=new Set(['owner','admin','manager','sales','cashier','retail','service_manager','service','technician','staff']);
const code=x=>String(x||'').trim().slice(0,120);
const integer=(x,label,min=0,max=100000000)=>{if(!Number.isSafeInteger(x)||x<min||x>max)throw Error('Invalid '+label);return x};
const handle=fn=>(req,res)=>Promise.resolve().then(()=>fn(req,res)).catch(e=>res.status(e.status||400).json({error:e.message||'Request failed'}));
async function authenticate(req,res,next){
 try{
  const raw=String(req.get('authorization')||'').replace(/^Bearer\s+/i,'');
  const payload=jwt.verify(raw,process.env.SERVICE_JWT_SECRET);
  const u=(await q('SELECT id,role,username,display_name FROM service_users WHERE id=$1 AND active=true',[payload.sub])).rows[0];
  if(!u)return res.status(401).json({error:'Active employee login required'});
  req.stockUser=u;next();
 }catch{return res.status(401).json({error:'Session expired or invalid'})}
}
const permit=roles=>(req,res,next)=>roles.has(String(req.stockUser.role).toLowerCase())?next():res.status(403).json({error:'Your login does not permit this operation'});
export async function ensureInventory(){
 await q(`CREATE TABLE IF NOT EXISTS htfo_inventory_sku(
 id BIGSERIAL PRIMARY KEY,sku TEXT NOT NULL UNIQUE,name TEXT NOT NULL,category TEXT NOT NULL DEFAULT 'Supplies',
 price_cents INTEGER NOT NULL DEFAULT 0,cost_cents INTEGER NOT NULL DEFAULT 0,
 reorder_point INTEGER NOT NULL DEFAULT 0,active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS htfo_inventory_quantity(
 sku_id BIGINT NOT NULL REFERENCES htfo_inventory_sku(id),
 location TEXT NOT NULL, on_hand INTEGER NOT NULL DEFAULT 0 CHECK(on_hand>=0),
 committed INTEGER NOT NULL DEFAULT 0 CHECK(committed>=0 AND committed<=on_hand),
 PRIMARY KEY(sku_id,location));
 CREATE TABLE IF NOT EXISTS htfo_inventory_spa(
 id BIGSERIAL PRIMARY KEY,serial TEXT NOT NULL UNIQUE,
 brand TEXT NOT NULL,model TEXT NOT NULL,shell TEXT,cabinet TEXT,options TEXT,
 location TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'available'
 CHECK(status IN ('available','reserved','sold','delivered','in_transit','hold')),
 wholesale_cents INTEGER NOT NULL DEFAULT 0,
 reserved_draft_id BIGINT UNIQUE REFERENCES crm_sales_drafts(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK ((status='reserved' AND reserved_draft_id IS NOT NULL) OR (status<>'reserved' AND reserved_draft_id IS NULL)));
 CREATE TABLE IF NOT EXISTS htfo_inventory_movements(
 id BIGSERIAL PRIMARY KEY,sku_id BIGINT REFERENCES htfo_inventory_sku(id),
 spa_id BIGINT REFERENCES htfo_inventory_spa(id),location TEXT,delta INTEGER,
 reason TEXT,actor_id BIGINT NOT NULL REFERENCES service_users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS htfo_pos_receipts(
 id BIGSERIAL PRIMARY KEY,customer_id BIGINT REFERENCES service_customers(id),
 subtotal_cents INTEGER NOT NULL,tax_cents INTEGER NOT NULL,total_cents INTEGER NOT NULL,
 payment_status TEXT NOT NULL DEFAULT 'unpaid',
 created_by BIGINT NOT NULL REFERENCES service_users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS htfo_inventory_part_locations(
 part_id BIGINT NOT NULL REFERENCES service_parts(id),location TEXT NOT NULL,
 on_hand NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK(on_hand>=0),
 PRIMARY KEY(part_id,location));
 CREATE TABLE IF NOT EXISTS htfo_inventory_part_movements(
 id BIGSERIAL PRIMARY KEY,part_id BIGINT NOT NULL REFERENCES service_parts(id),
 location TEXT NOT NULL,delta NUMERIC(10,2) NOT NULL,reason TEXT NOT NULL,
 actor_id BIGINT NOT NULL REFERENCES service_users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS htfo_pos_part_lines(
 id BIGSERIAL PRIMARY KEY,receipt_id BIGINT NOT NULL REFERENCES htfo_pos_receipts(id),
 part_id BIGINT NOT NULL REFERENCES service_parts(id),qty INTEGER NOT NULL,price_cents INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS htfo_dealer_settings(
 dealer_key TEXT PRIMARY KEY,display_name TEXT NOT NULL,
 tax_rate_bps INTEGER NOT NULL DEFAULT 700 CHECK(tax_rate_bps BETWEEN 0 AND 1500),
 updated_by BIGINT REFERENCES service_users(id),updated_at TIMESTAMPTZ DEFAULT NOW());
 INSERT INTO htfo_dealer_settings(dealer_key,display_name,tax_rate_bps)
 VALUES('htfo','Hot Tub Factory Outlet',700) ON CONFLICT(dealer_key) DO NOTHING;
 CREATE TABLE IF NOT EXISTS htfo_pos_lines(
 id BIGSERIAL PRIMARY KEY,receipt_id BIGINT NOT NULL REFERENCES htfo_pos_receipts(id),
 sku_id BIGINT NOT NULL REFERENCES htfo_inventory_sku(id),qty INTEGER NOT NULL,
 price_cents INTEGER NOT NULL);
 `);
}
router.use(authenticate);
router.get('/me',(req,res)=>res.json({user:{id:req.stockUser.id,username:req.stockUser.username,name:req.stockUser.display_name,role:req.stockUser.role},permissions:{retail:RETAIL.has(req.stockUser.role),sales:SALES.has(req.stockUser.role),manage:MANAGEMENT.has(req.stockUser.role),service:SERVICE.has(req.stockUser.role)}}));
router.get('/retail/customers',permit(RETAIL),handle(async(req,res)=>{
 const term=code(req.query.q).slice(0,80);if(term.length<2)return res.json([]);
 const rows=await q(`SELECT id,first_name,last_name,phone,email FROM service_customers
 WHERE concat_ws(' ',first_name,last_name,phone,email) ILIKE $1 ORDER BY last_name,first_name LIMIT 20`,['%'+term+'%']);
 res.json(rows.rows);
}));
router.get('/retail/signed-customers',permit(RETAIL),handle(async(req,res)=>{
 const term=code(req.query.q).slice(0,80);
 if(term.length<2)return res.json([]);
 // Only people with executed contracts are visible. Unconverted CRM leads are never returned.
 const r=await q(`SELECT DISTINCT ON (lower(e.customer_email))
  e.draft_id AS signed_agreement_id,
  e.customer_name AS name,e.customer_email AS email,
  COALESCE(e.executed_document->'customer'->>'phone','') AS phone,
  s.id AS retail_customer_id
 FROM crm_sales_executed_contracts e
 LEFT JOIN service_customers s ON lower(s.email)=lower(e.customer_email)
 WHERE concat_ws(' ',e.customer_name,e.customer_email,e.executed_document->'customer'->>'phone') ILIKE $1
 ORDER BY lower(e.customer_email),e.draft_id DESC LIMIT 20`,['%'+term+'%']);
 res.json(r.rows);
}));
router.post('/retail/signed-customers/:id/link',permit(RETAIL),handle(async(req,res)=>{
 const draft=integer(Number(req.params.id),'signed agreement',1);
 const c=(await q(`SELECT executed_document->'customer' AS customer FROM crm_sales_executed_contracts WHERE draft_id=$1`,[draft])).rows[0]?.customer;
 if(!c)return res.status(404).json({error:'No signed customer found'});
 const email=code(c.email),phone=code(c.phone);
 const prior=(await q(`SELECT id,first_name,last_name,email,phone FROM service_customers
 WHERE (lower(email)=lower($1) AND $1<>'') OR (phone=$2 AND $2<>'')
 ORDER BY id LIMIT 2`,[email,phone])).rows;
 if(prior.length>1)return res.status(409).json({error:'Multiple customer profiles match. Manager must review duplicates.'});
 if(prior.length===1)return res.json(prior[0]);
 const created=(await q(`INSERT INTO service_customers(first_name,last_name,email,phone,street,city,state,zip,source)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,'signed_sales_agreement')
 RETURNING id,first_name,last_name,email,phone`,
 [code(c.first_name),code(c.last_name),email,phone,code(c.street),code(c.city),code(c.state),code(c.zip)])).rows[0];
 res.status(201).json(created);
}));
router.post('/retail/customers',permit(RETAIL),handle(async(req,res)=>{
 const {first_name,last_name,phone,email}=req.body||{};
 if(!code(last_name))throw Error('Last name is required');
 const r=await q('INSERT INTO service_customers(first_name,last_name,phone,email,source) VALUES($1,$2,$3,$4,$5) RETURNING id,first_name,last_name,phone,email',
 [code(first_name),code(last_name),code(phone),code(email),'retail_pos']);
 res.status(201).json(r.rows[0]);
}));
router.get('/skus',permit(SERVICE),handle(async(req,res)=>{
 await ensureInventory();
 const rows=await q(`SELECT p.id,COALESCE(NULLIF(p.supplier_part_number,''),NULLIF(p.manufacturer_part_number,''),'PART-'||p.id::text) AS sku,
 p.description AS name,COALESCE(p.category,'Supplies') AS category,
 ROUND(COALESCE(NULLIF(p.sell_price,0),p.list_price,0)*100)::int AS price_cents,
 COALESCE(p.reorder_point,0)::int AS reorder_point,
 COALESCE(p.quantity_on_hand,0)::numeric AS on_hand,
 COALESCE(p.quantity_committed,0)::numeric AS committed,
 (COALESCE(p.quantity_on_hand,0)-COALESCE(p.quantity_committed,0))::numeric AS available
 FROM service_parts p WHERE p.active=true ORDER BY p.category,p.description LIMIT 500`);
 res.json(rows.rows);
}));
router.post('/skus',permit(MANAGEMENT),handle(async(req,res)=>{
 await ensureInventory();const b=req.body||{};
 const sku=code(b.sku),name=code(b.name),category=code(b.category)||'Supplies';
 if(!sku||!name)throw Error('SKU and description required');
 const price=integer(b.price_cents,'price'),cost=integer(b.cost_cents,'cost'),reorder=integer(b.reorder_point??0,'reorder point',0,100000);
 const matches=(await q('SELECT id FROM service_parts WHERE lower(supplier_part_number)=lower($1) LIMIT 2',[sku])).rows;
 if(matches.length>1)throw Error('Duplicate supplier part numbers found; manager must resolve before updating');
 let r;
 if(matches.length){
  r=await q(`UPDATE service_parts SET description=$2,category=$3,sell_price=$4,cost=$5,reorder_point=$6,updated_at=NOW()
   WHERE id=$1 RETURNING id,supplier_part_number AS sku,description AS name,category,ROUND(COALESCE(sell_price,0)*100)::int AS price_cents`,
   [matches[0].id,name,category,price/100,cost/100,reorder]);
 }else{
  r=await q(`INSERT INTO service_parts(supplier_part_number,description,category,sell_price,cost,reorder_point)
   VALUES($1,$2,$3,$4,$5,$6) RETURNING id,supplier_part_number AS sku,description AS name,category,ROUND(COALESCE(sell_price,0)*100)::int AS price_cents`,
   [sku,name,category,price/100,cost/100,reorder]);
 }
 res.json(r.rows[0]);
}));
router.post('/skus/:id/receive',permit(MANAGEMENT),handle(async(req,res)=>{
 await ensureInventory();
 const id=integer(Number(req.params.id),'part ID',1),qty=integer(req.body.qty,'quantity',1,100000),location=code(req.body.location);
 if(!location)throw Error('Select a location');
 const r=await q(`WITH changed AS (
  UPDATE service_parts SET quantity_on_hand=COALESCE(quantity_on_hand,0)+$3,updated_at=NOW() WHERE id=$1 RETURNING id
 ),loc AS (
  INSERT INTO htfo_inventory_part_locations(part_id,location,on_hand)
  SELECT id,$2,$3 FROM changed
  ON CONFLICT(part_id,location) DO UPDATE SET on_hand=htfo_inventory_part_locations.on_hand+EXCLUDED.on_hand RETURNING part_id
 ),audit AS (
  INSERT INTO htfo_inventory_part_movements(part_id,location,delta,reason,actor_id)
  SELECT part_id,$2,$3,'receive',$4 FROM loc RETURNING id
 ) SELECT count(*)::int AS recorded FROM audit`,
 [id,location,qty,req.stockUser.id]);
 if(!r.rows[0]?.recorded)return res.status(404).json({error:'Part not found'});
 res.json({received:qty,location,part_id:id});
}));
router.get('/spas',permit(SALES),handle(async(req,res)=>{
 await ensureInventory();
 const list=(await q(`SELECT id,serial,brand,model,shell,cabinet,options,location,status
 FROM htfo_inventory_spa ORDER BY brand,model,serial LIMIT 500`)).rows;
 res.json(list);
}));
router.post('/spas',permit(MANAGEMENT),handle(async(req,res)=>{
 await ensureInventory();const b=req.body||{};
 if(!code(b.serial)||!code(b.brand)||!code(b.model))throw Error('Serial, brand and model required');
 const r=await q(`INSERT INTO htfo_inventory_spa(serial,brand,model,shell,cabinet,options,location,wholesale_cents)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,serial,brand,model,shell,cabinet,options,location,status`,
 [code(b.serial),code(b.brand),code(b.model),code(b.shell),code(b.cabinet),code(b.options),code(b.location)||'Warehouse',integer(b.wholesale_cents??0,'wholesale cost')]);
 res.status(201).json(r.rows[0]);
}));
router.post('/spas/:id/reserve',permit(SALES),handle(async(req,res)=>{
 if(process.env.HTFO_INVENTORY_LIVE_RESERVATIONS!=='true')return res.status(409).json({error:'Live reservations disabled pending acceptance testing'});
 await ensureInventory();const id=integer(Number(req.params.id),'spa',1),draft=integer(req.body.draft_id,'agreement',1);
 const owner=(await q('SELECT owner_user_id,document FROM crm_sales_drafts WHERE id=$1',[draft])).rows[0];
 if(!owner)return res.status(404).json({error:'Agreement not found'});
 if(owner.document?.spa?.inventory_mode!=='in_stock'||Number(owner.document?.spa?.inventory_unit_id)!==id)return res.status(409).json({error:'This exact serial must be selected and saved on the agreement before reservation'});
 if(!MANAGEMENT.has(req.stockUser.role)&&String(owner.owner_user_id)!==String(req.stockUser.id))return res.status(403).json({error:'Not your agreement'});
 const unit=(await q(`UPDATE htfo_inventory_spa SET status='reserved',reserved_draft_id=$2,updated_at=NOW()
 WHERE id=$1 AND status='available' AND reserved_draft_id IS NULL
 AND brand=$3 AND model=$4 AND COALESCE(shell,'')=COALESCE($5,'')
 AND COALESCE(cabinet,'')=COALESCE($6,'')
 AND serial=$7 AND COALESCE(options,'')=COALESCE($8,'')
 RETURNING id,serial,status`,[id,draft,owner.document?.spa?.brand,owner.document?.spa?.model,owner.document?.spa?.shell,owner.document?.spa?.cabinet,owner.document?.spa?.serial,owner.document?.spa?.manufacturer_add_ons])).rows[0];
 if(!unit)return res.status(409).json({error:'Spa not available, already reserved, or configuration differs'});
 res.json(unit);
}));
router.post('/spas/:id/release',permit(MANAGEMENT),handle(async(req,res)=>{
 await ensureInventory();const result=await q(`UPDATE htfo_inventory_spa SET status='available',reserved_draft_id=NULL,updated_at=NOW()
 WHERE id=$1 AND status='reserved' RETURNING id,serial,status`,[integer(Number(req.params.id),'spa',1)]);
 if(!result.rowCount)return res.status(409).json({error:'Only reserved spas can be released'});res.json(result.rows[0]);
}));
router.get('/receipts',permit(RETAIL),handle(async(req,res)=>{
 await ensureInventory();const rows=await q('SELECT id,customer_id,total_cents,payment_status,created_at FROM htfo_pos_receipts ORDER BY id DESC LIMIT 50');res.json(rows.rows);
}));
router.post('/receipts',permit(RETAIL),handle(async(req,res)=>{
 await ensureInventory();const lines=req.body?.items;
 if(!Array.isArray(lines)||!lines.length||lines.length>30)throw Error('Add 1–30 retail items');
 const items=[];for(const l of lines){
  const id=integer(l.sku_id,'part ID',1),qty=integer(l.qty,'quantity',1,99);
  const p=(await q(`SELECT id,taxable,ROUND(COALESCE(NULLIF(sell_price,0),list_price,0)*100)::int AS price_cents
  FROM service_parts WHERE id=$1 AND active=true`,[id])).rows[0];
  if(!p)throw Error('Product no longer available');items.push({id,qty,price:p.price_cents,taxable:p.taxable});
 }
 // Unpaid draft only: do not reduce stock or claim a terminal payment succeeded.
 const subtotal=items.reduce((n,x)=>n+x.qty*x.price,0),customer=req.body.customer_id?integer(req.body.customer_id,'customer ID',1):null;
 const settings=(await q("SELECT tax_rate_bps FROM htfo_dealer_settings WHERE dealer_key='htfo'")).rows[0];
 const taxable=items.filter(x=>x.taxable).reduce((n,x)=>n+x.qty*x.price,0);
 const tax=Math.round(taxable*Number(settings?.tax_rate_bps??700)/10000);
 const receipt=(await q('INSERT INTO htfo_pos_receipts(customer_id,subtotal_cents,tax_cents,total_cents,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id,total_cents,tax_cents,payment_status',[customer,subtotal,tax,subtotal+tax,req.stockUser.id])).rows[0];
 for(const it of items)await q('INSERT INTO htfo_pos_part_lines(receipt_id,part_id,qty,price_cents) VALUES($1,$2,$3,$4)',[receipt.id,it.id,it.qty,it.price]);
 res.status(201).json({...receipt,note:'Unpaid retail draft; inventory is unchanged. Payment and tax checkout not yet enabled.'});
}));
export default router;
