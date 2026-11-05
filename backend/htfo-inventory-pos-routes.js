import express from 'express';
import jwt from 'jsonwebtoken';
import {q,transaction} from './service-db.js';
import {publishedRetailCatalog,retailPriceOverrides,retailPriceJoin,retailPriceCents} from './htfo-retail-catalog.js';
import {recordRetailTender} from './htfo-retail-tender.js';
import {createUnpaidRetailDraft} from './htfo-retail-draft.js';

import {accessPOSAutoShipIntent,createPOSAutoShipIntent} from './htfo-pos-autoship.js';

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
 CREATE TABLE IF NOT EXISTS htfo_pos_external_tenders(
 receipt_id BIGINT PRIMARY KEY REFERENCES htfo_pos_receipts(id),method TEXT NOT NULL,reference TEXT NOT NULL,
 amount_cents INTEGER NOT NULL,recorded_by BIGINT NOT NULL REFERENCES service_users(id),
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
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
 ALTER TABLE htfo_pos_receipts ADD COLUMN IF NOT EXISTS tax_rate_bps INTEGER NOT NULL DEFAULT 700;
 ALTER TABLE htfo_pos_receipts ADD COLUMN IF NOT EXISTS reference_key TEXT;
 ALTER TABLE htfo_pos_receipts ADD COLUMN IF NOT EXISTS department TEXT NOT NULL DEFAULT 'unassigned';
 ALTER TABLE htfo_pos_receipts ADD COLUMN IF NOT EXISTS merchant_route TEXT NOT NULL DEFAULT 'unassigned';
 CREATE UNIQUE INDEX IF NOT EXISTS htfo_pos_receipt_ref ON htfo_pos_receipts(reference_key);
 ALTER TABLE htfo_pos_part_lines ADD COLUMN IF NOT EXISTS sku_at_sale TEXT;
 ALTER TABLE htfo_pos_part_lines ADD COLUMN IF NOT EXISTS description_at_sale TEXT;
 ALTER TABLE htfo_pos_part_lines ADD COLUMN IF NOT EXISTS taxable_at_sale BOOLEAN;
 ALTER TABLE service_parts ADD COLUMN IF NOT EXISTS barcode TEXT;
 CREATE UNIQUE INDEX IF NOT EXISTS htfo_parts_barcode_unique ON service_parts(barcode) WHERE barcode IS NOT NULL AND barcode<>'';
 CREATE TABLE IF NOT EXISTS htfo_pos_lines(
 id BIGSERIAL PRIMARY KEY,receipt_id BIGINT NOT NULL REFERENCES htfo_pos_receipts(id),
 sku_id BIGINT NOT NULL REFERENCES htfo_inventory_sku(id),qty INTEGER NOT NULL,
 price_cents INTEGER NOT NULL);
 `);
}
router.post('/retail/autoship-intent',accessPOSAutoShipIntent);
router.use(authenticate);
router.post('/retail/autoship-link',permit(RETAIL),handle(async(req,res)=>res.status(201).json(await createPOSAutoShipIntent(req.body,req.stockUser.id))));
router.get('/me',(req,res)=>res.json({user:{id:req.stockUser.id,username:req.stockUser.username,name:req.stockUser.display_name,role:req.stockUser.role},permissions:{retail:RETAIL.has(req.stockUser.role),sales:SALES.has(req.stockUser.role),manage:MANAGEMENT.has(req.stockUser.role),record_tender:RETAIL.has(req.stockUser.role)&&process.env.HTFO_POS_RECORD_EXTERNAL_PAYMENTS==='true',service:SERVICE.has(req.stockUser.role)}}));
router.get('/retail/customers',permit(RETAIL),handle(async(req,res)=>{
 const term=code(req.query.q).slice(0,80);if(term.length<2)return res.json([]);
 const rows=await q(`SELECT id,first_name,last_name,phone,email FROM service_customers
 WHERE archived_at IS NULL AND concat_ws(' ',first_name,last_name,phone,email) ILIKE $1 ORDER BY last_name,first_name LIMIT 20`,['%'+term+'%']);
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
 ${retailPriceCents} AS price_cents,
 COALESCE(p.reorder_point,0)::int AS reorder_point,
 COALESCE(p.quantity_on_hand,0)::numeric AS on_hand,
 COALESCE(p.quantity_committed,0)::numeric AS committed,
 (COALESCE(p.quantity_on_hand,0)-COALESCE(p.quantity_committed,0))::numeric AS available
 FROM service_parts p ${retailPriceJoin} WHERE p.active=true ORDER BY p.category,p.description LIMIT 500`,[await retailPriceOverrides()]);
 res.json(rows.rows);
}));
router.get('/skus/scan',permit(RETAIL),handle(async(req,res)=>{
 await ensureInventory();
 const lookup=code(req.query.code);
 if(!lookup)throw Error('Enter or scan barcode/SKU');
 const rows=(await q(`SELECT p.id,p.description AS name,
 COALESCE(NULLIF(p.supplier_part_number,''),NULLIF(p.manufacturer_part_number,''),'PART-'||p.id::text) AS sku,
 ${retailPriceCents} AS price_cents,(p.quantity_on_hand-p.quantity_committed) AS available
 FROM service_parts p ${retailPriceJoin}
 WHERE p.active=true AND (lower(p.barcode)=lower($2) OR lower(trim(p.supplier_part_number))=lower($2)
 OR lower(trim(p.manufacturer_part_number))=lower($2)) LIMIT 3`,[await retailPriceOverrides(),lookup])).rows;
 if(rows.length!==1)return res.status(rows.length?409:404).json({error:rows.length?'Multiple matching SKUs. Ask a manager to correct the catalog.':'Product barcode or SKU not found'});
 res.json(rows[0]);
}));
router.post('/skus',permit(MANAGEMENT),handle(async(req,res)=>{
 await ensureInventory();const b=req.body||{};
 const sku=code(b.sku),name=code(b.name),category=code(b.category)||'Supplies',barcode=code(b.barcode)||null;
 if(!sku||!name)throw Error('SKU and description required');
 const price=integer(b.price_cents,'price'),cost=integer(b.cost_cents,'cost'),reorder=integer(b.reorder_point??0,'reorder point',0,100000);
 const matches=(await q('SELECT id FROM service_parts WHERE lower(supplier_part_number)=lower($1) LIMIT 2',[sku])).rows;
 if(matches.length>1)throw Error('Duplicate supplier part numbers found; manager must resolve before updating');
 let r;
 if(matches.length){
  r=await q(`UPDATE service_parts SET description=$2,category=$3,sell_price=$4,cost=$5,reorder_point=$6,barcode=$7,updated_at=NOW()
   WHERE id=$1 RETURNING id,supplier_part_number AS sku,description AS name,category,ROUND(COALESCE(sell_price,0)*100)::int AS price_cents`,
   [matches[0].id,name,category,price/100,cost/100,reorder,barcode]);
 }else{
  r=await q(`INSERT INTO service_parts(supplier_part_number,description,category,sell_price,cost,reorder_point,barcode)
   VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,supplier_part_number AS sku,description AS name,category,ROUND(COALESCE(sell_price,0)*100)::int AS price_cents`,
   [sku,name,category,price/100,cost/100,reorder,barcode]);
 }
 res.json(r.rows[0]);
}));

async function retailCatalogComparison(){
 const catalog=await publishedRetailCatalog();
 const existing=(await q("SELECT id,supplier_part_number,description,ROUND(COALESCE(NULLIF(sell_price,0),list_price,0)*100)::int AS price_cents FROM service_parts WHERE active=true AND supplier_part_number IS NOT NULL")).rows;
 const bySku=new Map();
 for(const p of existing){const key=String(p.supplier_part_number).trim().toLowerCase();if(!bySku.has(key))bySku.set(key,[]);bySku.get(key).push(p)}
 const entries=catalog.products.map(p=>{
  const matches=bySku.get(p.sku.toLowerCase())||[];
  const state=p.sku_status!=='published_sku'?'verify_sku':matches.length>1?'duplicate_existing':matches.length===0?'not_in_pos':Number(matches[0].price_cents)===p.price_cents?'matches':'price_differs';
  return {...p,state,part_id:matches.length===1?matches[0].id:null,current_price_cents:matches.length===1?Number(matches[0].price_cents):null};
 });
 return {version:catalog.version,entries,excluded:catalog.excluded,counts:entries.reduce((counts,e)=>(counts[e.state]=(counts[e.state]||0)+1,counts),{})};
}
router.get('/catalog/preview',permit(MANAGEMENT),handle(async(req,res)=>res.json(await retailCatalogComparison())));
router.post('/catalog/sync-existing-prices',permit(MANAGEMENT),handle(async(req,res)=>{
 if(req.body?.confirm!=='SYNC_MATCHED_RETAIL_PRICES')throw Error('Manager confirmation required');
 const report=await retailCatalogComparison();
 if(req.body?.version!==report.version)throw Error('Catalog changed; preview again before applying prices');
 let updated=0;
 for(const p of report.entries.filter(x=>x.state==='price_differs')){
  const result=await q("UPDATE service_parts SET sell_price=$1,updated_at=NOW() WHERE id=$2 AND active=true AND ROUND(COALESCE(NULLIF(sell_price,0),list_price,0)*100)::int=$3 RETURNING id",[p.price_cents/100,p.part_id,p.current_price_cents]);
  if(result.rowCount===1)updated++;
 }
 res.json({ok:true,version:report.version,updated,notes:'Matched existing SKUs only. Missing SKUs, wholesale costs, quantities, and barcodes were not changed.'});
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
 const outcome=await transaction(async run=>{
 const owner=(await run('SELECT owner_user_id,document FROM crm_sales_drafts WHERE id=$1 FOR UPDATE',[draft])).rows[0];
 if(!owner)return {status:404,error:'Agreement not found'};
 if(owner.document?.spa?.inventory_mode!=='in_stock'||Number(owner.document?.spa?.inventory_unit_id)!==id)return {status:409,error:'This exact serial must be selected and saved on the agreement before reservation'};
 if(!MANAGEMENT.has(req.stockUser.role)&&String(owner.owner_user_id)!==String(req.stockUser.id))return {status:403,error:'Not your agreement'};
 const existing=(await run("SELECT id,serial,status FROM htfo_inventory_spa WHERE id=$1 AND reserved_draft_id=$2 AND status='reserved' FOR UPDATE",[id,draft])).rows[0];
 if(existing)return {unit:existing};
 const unit=(await run(`UPDATE htfo_inventory_spa SET status='reserved',reserved_draft_id=$2,updated_at=NOW()
 WHERE id=$1 AND status='available' AND reserved_draft_id IS NULL
 AND brand=$3 AND model=$4 AND COALESCE(shell,'')=COALESCE($5,'')
 AND COALESCE(cabinet,'')=COALESCE($6,'')
 AND serial=$7 AND COALESCE(options,'')=COALESCE($8,'')
 RETURNING id,serial,status`,[id,draft,owner.document?.spa?.brand,owner.document?.spa?.model,owner.document?.spa?.shell,owner.document?.spa?.cabinet,owner.document?.spa?.serial,owner.document?.spa?.manufacturer_add_ons])).rows[0];
 if(!unit)return {status:409,error:'Spa not available, already reserved, or configuration differs'};
 await run('INSERT INTO htfo_inventory_movements(spa_id,reason,actor_id) VALUES($1,$2,$3)',[id,'Reserved for agreement '+draft,req.stockUser.id]);
 return {unit};
 });
 if(outcome.error)return res.status(outcome.status).json({error:outcome.error});
 res.json(outcome.unit);
}));
router.post('/spas/:id/release',permit(MANAGEMENT),handle(async(req,res)=>{
 await ensureInventory();
 const reason=code(req.body?.reason);
 if(reason.length<8)return res.status(400).json({error:'Manager release reason is required (8+ characters)'});
 const outcome=await transaction(async run=>{
 const current=(await run('SELECT reserved_draft_id FROM htfo_inventory_spa WHERE id=$1 AND status=$2 FOR UPDATE',[integer(Number(req.params.id),'spa',1),'reserved'])).rows[0];
 if(current?.reserved_draft_id){
  const signed=(await run('SELECT id FROM crm_sales_executed_contracts WHERE draft_id=$1',[current.reserved_draft_id])).rows[0];
  if(signed){
   const currentDraft=(await run('SELECT document FROM crm_sales_drafts WHERE id=$1',[current.reserved_draft_id])).rows[0];
   if(String(currentDraft?.document?.spa?.inventory_unit_id||'')===String(req.params.id)&&currentDraft?.document?.spa?.inventory_mode==='in_stock')return {error:'Signed agreement still specifies this serial; customer-approved change order required'};
   const approved=(await run("SELECT c.id FROM crm_sales_change_orders c JOIN crm_sales_drafts d ON d.id=c.draft_id WHERE c.draft_id=$1 AND c.status='approved' AND (COALESCE(d.document #>> '{spa,inventory_mode}','')<>'in_stock' OR COALESCE(d.document #>> '{spa,inventory_unit_id}','')<>$2::text) ORDER BY c.id DESC LIMIT 1",[current.reserved_draft_id,String(req.params.id)])).rows[0];
   if(!approved)return {error:'Signed agreement requires an approved change order that removes this serial before release'};
  }
 }
const result=await run(`WITH changed AS (UPDATE htfo_inventory_spa SET status='available',reserved_draft_id=NULL,updated_at=NOW()
 WHERE id=$1 AND status='reserved' RETURNING id,serial,status), logged AS (INSERT INTO htfo_inventory_movements(spa_id,reason,actor_id)
 SELECT id,$2,$3 FROM changed RETURNING id) SELECT changed.* FROM changed JOIN logged ON true`,[integer(Number(req.params.id),'spa',1),'Manager release: '+reason,req.stockUser.id]);
 return result.rows[0]||{error:'Only reserved spas can be released'};
 });
 if(outcome.error)return res.status(409).json(outcome);
 res.json(outcome);
}));
router.post('/receipts/:id/tender',permit(RETAIL),handle(async(req,res)=>{
 if(process.env.HTFO_POS_RECORD_EXTERNAL_PAYMENTS!=='true')return res.status(409).json({error:'Recording outside payments is disabled pending register acceptance testing.'});
 await ensureInventory();
 res.json(await recordRetailTender(Number(req.params.id),req.body,req.stockUser.id));
}));
router.get('/receipts',permit(RETAIL),handle(async(req,res)=>{
 await ensureInventory();const rows=await q('SELECT id,customer_id,total_cents,payment_status,department,merchant_route,created_at FROM htfo_pos_receipts ORDER BY id DESC LIMIT 50');res.json(rows.rows);
}));
router.post('/receipts',permit(RETAIL),handle(async(req,res)=>{
 await ensureInventory();
 const receipt=await createUnpaidRetailDraft(req.body,req.stockUser.id);
 res.status(201).json({...receipt,note:'Unpaid draft. Tax captured; no inventory deducted and no card charge.'});
}));
export default router;
