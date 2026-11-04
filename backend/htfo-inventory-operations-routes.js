import express from 'express';
import jwt from 'jsonwebtoken';
import {q,transaction} from './service-db.js';
import {ensureInventory} from './htfo-inventory-pos-routes.js';
const router=express.Router();
const manager=new Set(['owner','admin','manager']);
const allowed=new Set(['owner','admin','manager','sales','cashier','retail','service_manager','technician','staff']);
const txt=(v,n=160)=>String(v??'').trim().slice(0,n);
const whole=(v,label,min=0)=>{const n=Number(v);if(!Number.isSafeInteger(n)||n<min||n>100000000)throw Error('Invalid '+label);return n};
const fail=(v)=>{throw Error(v)};
const wrap=fn=>(req,res)=>Promise.resolve().then(()=>fn(req,res)).catch(e=>res.status(/not found/i.test(e.message)?404:400).json({error:e.message}));
async function auth(req,res,next){try{const token=String(req.get('authorization')||'').replace(/^Bearer\s+/i,'');const user=jwt.verify(token,process.env.SERVICE_JWT_SECRET);const r=(await q('SELECT id,role FROM service_users WHERE id=$1 AND active=true',[user.sub])).rows[0];if(!r)return res.status(401).json({error:'Employee inactive'});req.operator=r;next()}catch{return res.status(401).json({error:'Login required'})}}
const permit=roles=>(req,res,next)=>roles.has(req.operator.role)?next():res.status(403).json({error:'Manager permission required'});
const csv=x=>'"'+String(x??'').replace(/"/g,'""').replace(/^[=+\-@\t\r]/,' $&')+'"';
const sendCsv=(res,name,header,rows)=>{res.set('Content-Type','text/csv; charset=utf-8');res.set('Content-Disposition','attachment; filename="'+name+'"');res.set('Cache-Control','no-store');res.send('\uFEFF'+[header,...rows].map(row=>row.map(csv).join(',')).join('\r\n')+'\r\n')};
async function ensure(){
 await ensureInventory();
 await q('CREATE TABLE IF NOT EXISTS htfo_dealer_settings(dealer_key TEXT PRIMARY KEY,display_name TEXT NOT NULL,tax_rate_bps INTEGER NOT NULL DEFAULT 700 CHECK(tax_rate_bps BETWEEN 0 AND 1500),updated_by BIGINT REFERENCES service_users(id),updated_at TIMESTAMPTZ DEFAULT NOW()); INSERT INTO htfo_dealer_settings(dealer_key,display_name,tax_rate_bps) VALUES ($1,$2,700) ON CONFLICT(dealer_key) DO NOTHING',['htfo','Hot Tub Factory Outlet']);
 await q('CREATE TABLE IF NOT EXISTS htfo_stock_adjustments(id BIGSERIAL PRIMARY KEY,part_id BIGINT REFERENCES service_parts(id),location TEXT,delta INTEGER NOT NULL,reason TEXT NOT NULL,performed_by BIGINT REFERENCES service_users(id),occurred_at TIMESTAMPTZ DEFAULT NOW()); CREATE TABLE IF NOT EXISTS htfo_stock_transfers(id BIGSERIAL PRIMARY KEY,part_id BIGINT REFERENCES service_parts(id),source_location TEXT,destination_location TEXT,quantity INTEGER NOT NULL,performed_by BIGINT REFERENCES service_users(id),created_at TIMESTAMPTZ DEFAULT NOW()); CREATE TABLE IF NOT EXISTS htfo_spa_events(id BIGSERIAL PRIMARY KEY,spa_id BIGINT REFERENCES htfo_inventory_spa(id),before_status TEXT,after_status TEXT,reason TEXT,actor_id BIGINT REFERENCES service_users(id),created_at TIMESTAMPTZ DEFAULT NOW())');
 await q("CREATE TABLE IF NOT EXISTS htfo_suppliers(id BIGSERIAL PRIMARY KEY,name TEXT NOT NULL UNIQUE,email TEXT,active BOOLEAN DEFAULT TRUE); CREATE TABLE IF NOT EXISTS htfo_purchase_orders(id BIGSERIAL PRIMARY KEY,supplier_id BIGINT REFERENCES htfo_suppliers(id),location TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft',created_by BIGINT REFERENCES service_users(id),created_at TIMESTAMPTZ DEFAULT NOW()); CREATE TABLE IF NOT EXISTS htfo_purchase_order_lines(id BIGSERIAL PRIMARY KEY,order_id BIGINT REFERENCES htfo_purchase_orders(id),part_id BIGINT REFERENCES service_parts(id),quantity_ordered INTEGER NOT NULL,quantity_received INTEGER NOT NULL DEFAULT 0,unit_cost_cents INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS htfo_import_batches(batch_key TEXT PRIMARY KEY,created_by BIGINT REFERENCES service_users(id),unit_count INTEGER NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW())");
}
router.use(auth);
router.get('/settings',permit(allowed),wrap(async(req,res)=>{await ensure();res.json((await q("SELECT dealer_key,display_name,tax_rate_bps FROM htfo_dealer_settings WHERE dealer_key='htfo'")).rows[0])}));
router.put('/settings',permit(manager),wrap(async(req,res)=>{await ensure();const rate=whole(req.body?.tax_rate_bps,'tax basis points');if(rate>1500)fail('Maximum configurable rate is 15%');res.json((await q("UPDATE htfo_dealer_settings SET tax_rate_bps=$1,updated_by=$2,updated_at=NOW() WHERE dealer_key='htfo' RETURNING dealer_key,display_name,tax_rate_bps",[rate,req.operator.id])).rows[0])}));
router.get('/low-stock',permit(allowed),wrap(async(req,res)=>{const rows=await q('SELECT id,supplier_part_number AS sku,description,quantity_on_hand,quantity_committed,reorder_point,(quantity_on_hand-quantity_committed) AS available FROM service_parts WHERE active=true AND (quantity_on_hand-quantity_committed)<=reorder_point ORDER BY description LIMIT 300');res.json(rows.rows)}));
router.post('/parts/:id/adjust',permit(manager),wrap(async(req,res)=>{
 await ensure();const id=whole(req.params.id,'part',1),delta=Number(req.body?.delta),location=txt(req.body?.location),reason=txt(req.body?.reason,400);
 if(!Number.isSafeInteger(delta)||!delta||Math.abs(delta)>100000||!location||reason.length<8)fail('Nonzero whole-unit change, location and reason (8+ characters) required');
 const output=await transaction(async run=>{
  const part=(await run('SELECT quantity_on_hand,quantity_committed FROM service_parts WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!part)fail('Part not found');
  const loc=(await run('SELECT on_hand FROM htfo_inventory_part_locations WHERE part_id=$1 AND location=$2 FOR UPDATE',[id,location])).rows[0];
  const current=Number(loc?.on_hand||0),total=Number(part.quantity_on_hand)+delta;
  if(current+delta<0||total<Number(part.quantity_committed))fail('Cannot reduce inventory below available/committed quantity');
  await run('UPDATE service_parts SET quantity_on_hand=$2,updated_at=NOW() WHERE id=$1',[id,total]);
  await run('INSERT INTO htfo_inventory_part_locations(part_id,location,on_hand) VALUES($1,$2,$3) ON CONFLICT(part_id,location) DO UPDATE SET on_hand=EXCLUDED.on_hand',[id,location,current+delta]);
  const row=(await run('INSERT INTO htfo_stock_adjustments(part_id,location,delta,reason,performed_by) VALUES($1,$2,$3,$4,$5) RETURNING id',[id,location,delta,reason,req.operator.id])).rows[0];
  await run('INSERT INTO htfo_inventory_part_movements(part_id,location,delta,reason,actor_id) VALUES($1,$2,$3,$4,$5)',[id,location,delta,'adjustment '+row.id,req.operator.id]);
  return {adjustment_id:row.id,part_id:id,on_hand:total};
 });res.json(output)
}));
router.post('/parts/:id/transfer',permit(manager),wrap(async(req,res)=>{
 await ensure();const id=whole(req.params.id,'part',1),quantity=whole(req.body?.quantity,'quantity',1),from=txt(req.body?.from),to=txt(req.body?.to);
 if(!from||!to||from===to)fail('Different source/destination locations required');
 res.json(await transaction(async run=>{
  const part=(await run('SELECT id FROM service_parts WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!part)fail('Part not found');
  const source=(await run('SELECT on_hand FROM htfo_inventory_part_locations WHERE part_id=$1 AND location=$2 FOR UPDATE',[id,from])).rows[0];
  if(!source||Number(source.on_hand)<quantity)fail('Not enough units at source');
  await run('UPDATE htfo_inventory_part_locations SET on_hand=on_hand-$3 WHERE part_id=$1 AND location=$2',[id,from,quantity]);
  await run('INSERT INTO htfo_inventory_part_locations(part_id,location,on_hand) VALUES($1,$2,$3) ON CONFLICT(part_id,location) DO UPDATE SET on_hand=htfo_inventory_part_locations.on_hand+EXCLUDED.on_hand',[id,to,quantity]);
  const entry=(await run('INSERT INTO htfo_stock_transfers(part_id,source_location,destination_location,quantity,performed_by) VALUES($1,$2,$3,$4,$5) RETURNING id',[id,from,to,quantity,req.operator.id])).rows[0];
  for(const pair of [[from,-quantity],[to,quantity]])await run('INSERT INTO htfo_inventory_part_movements(part_id,location,delta,reason,actor_id) VALUES($1,$2,$3,$4,$5)',[id,pair[0],pair[1],'transfer '+entry.id,req.operator.id]);
  return {transfer_id:entry.id,part_id:id,quantity,from,to}
 }))
}));
router.post('/spas/import',permit(manager),wrap(async(req,res)=>{
 await ensure();const batch=txt(req.body?.batch_key,100),units=req.body?.units;
 if(!batch||!Array.isArray(units)||!units.length||units.length>100)fail('Batch key and 1–100 spa records required');
 const records=units.map((u,i)=>{const serial=txt(u.serial),brand=txt(u.brand),model=txt(u.model);if(!serial||!brand||!model)fail('Row '+(i+1)+' needs serial, brand and model');return {serial,brand,model,shell:txt(u.shell),cabinet:txt(u.cabinet),options:txt(u.options,600),location:txt(u.location)||'Warehouse',cost:whole(u.wholesale_cents??0,'cost')}});
 if(new Set(records.map(r=>r.serial.toLowerCase())).size!==records.length)fail('Duplicate serial in import');
 res.status(201).json(await transaction(async run=>{
  const found=(await run('SELECT 1 FROM htfo_import_batches WHERE batch_key=$1',[batch])).rowCount;if(found)fail('Batch already processed');
  for(const item of records)await run('INSERT INTO htfo_inventory_spa(serial,brand,model,shell,cabinet,options,location,wholesale_cents) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',Object.values(item));
  await run('INSERT INTO htfo_import_batches(batch_key,created_by,unit_count) VALUES($1,$2,$3)',[batch,req.operator.id,records.length]);
  return {batch_key:batch,created:records.length}
 }))
}));
router.post('/spas/:id/location',permit(manager),wrap(async(req,res)=>{
 await ensure();const id=whole(req.params.id,'spa',1),location=txt(req.body?.location),reason=txt(req.body?.reason,400);
 if(!location||reason.length<8)fail('Location and reason required');
 res.json(await transaction(async run=>{
  const row=(await run('SELECT location,status FROM htfo_inventory_spa WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!row)fail('Spa not found');
  if(['sold','delivered'].includes(row.status))fail('Sold/delivered spa cannot be transferred as inventory');
  await run('UPDATE htfo_inventory_spa SET location=$2,updated_at=NOW() WHERE id=$1',[id,location]);
  const log=(await run('INSERT INTO htfo_spa_events(spa_id,before_status,after_status,reason,actor_id) VALUES($1,$2,$2,$3,$4) RETURNING id',[id,row.status,'Move '+row.location+' to '+location+': '+reason,req.operator.id])).rows[0];
  return {id,location,event_id:log.id}
 }))
}));
router.get('/suppliers',permit(manager),wrap(async(req,res)=>{await ensure();res.json((await q('SELECT id,name,email FROM htfo_suppliers WHERE active=true ORDER BY name')).rows)}));
router.post('/suppliers',permit(manager),wrap(async(req,res)=>{await ensure();const name=txt(req.body?.name);if(!name)fail('Name required');res.status(201).json((await q('INSERT INTO htfo_suppliers(name,email) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET email=EXCLUDED.email RETURNING id,name,email',[name,txt(req.body?.email)])).rows[0])}));
router.post('/purchase-orders',permit(manager),wrap(async(req,res)=>{
 await ensure();const supplier=whole(req.body?.supplier_id,'supplier',1),location=txt(req.body?.location),lines=req.body?.lines;if(!location||!Array.isArray(lines)||!lines.length||lines.length>100)fail('Location and PO lines required');
 const items=lines.map(l=>({id:whole(l.part_id,'part',1),qty:whole(l.quantity,'quantity',1),cost:whole(l.unit_cost_cents??0,'cost')}));
 res.status(201).json(await transaction(async run=>{
  const po=(await run('INSERT INTO htfo_purchase_orders(supplier_id,location,created_by) VALUES($1,$2,$3) RETURNING id,status',[supplier,location,req.operator.id])).rows[0];
  for(const item of items)await run('INSERT INTO htfo_purchase_order_lines(order_id,part_id,quantity_ordered,unit_cost_cents) VALUES($1,$2,$3,$4)',[po.id,item.id,item.qty,item.cost]);
  return po
 }))
}));
router.get('/purchase-orders',permit(manager),wrap(async(req,res)=>{await ensure();res.json((await q('SELECT p.id,p.location,p.status,p.created_at,s.name AS supplier_name FROM htfo_purchase_orders p JOIN htfo_suppliers s ON s.id=p.supplier_id ORDER BY p.id DESC LIMIT 200')).rows)}));
router.post('/purchase-orders/:id/receive',permit(manager),wrap(async(req,res)=>{
 await ensure();const id=whole(req.params.id,'PO',1),input=req.body?.lines;if(!Array.isArray(input)||!input.length)fail('Receipt lines required');
 const lines=input.map(l=>({id:whole(l.line_id,'line',1),qty:whole(l.quantity,'quantity',1)}));if(new Set(lines.map(l=>l.id)).size!==lines.length)fail('Duplicate PO line');
 res.json(await transaction(async run=>{
  const po=(await run('SELECT location,status FROM htfo_purchase_orders WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!po||['received','cancelled'].includes(po.status))fail('PO missing or closed');
  for(const item of lines){
   const line=(await run('SELECT part_id,quantity_ordered,quantity_received FROM htfo_purchase_order_lines WHERE order_id=$1 AND id=$2 FOR UPDATE',[id,item.id])).rows[0];if(!line)fail('Invalid PO line');
   if(Number(line.quantity_received)+item.qty>Number(line.quantity_ordered))fail('Over-receiving PO line');
   await run('UPDATE htfo_purchase_order_lines SET quantity_received=quantity_received+$2 WHERE id=$1',[item.id,item.qty]);
   await run('UPDATE service_parts SET quantity_on_hand=quantity_on_hand+$2,updated_at=NOW() WHERE id=$1',[line.part_id,item.qty]);
   await run('INSERT INTO htfo_inventory_part_locations(part_id,location,on_hand) VALUES($1,$2,$3) ON CONFLICT(part_id,location) DO UPDATE SET on_hand=htfo_inventory_part_locations.on_hand+EXCLUDED.on_hand',[line.part_id,po.location,item.qty]);
   await run('INSERT INTO htfo_inventory_part_movements(part_id,location,delta,reason,actor_id) VALUES($1,$2,$3,$4,$5)',[line.part_id,po.location,item.qty,'PO '+id+' line '+item.id,req.operator.id]);
  }
  const complete=(await run('SELECT bool_and(quantity_received=quantity_ordered) AS done FROM htfo_purchase_order_lines WHERE order_id=$1',[id])).rows[0]?.done;
  const status=complete?'received':'partially_received';
  await run('UPDATE htfo_purchase_orders SET status=$2 WHERE id=$1',[id,status]);return {id,status}
 }))
}));
router.get('/reports/valuation.csv',permit(manager),wrap(async(req,res)=>{const r=await q('SELECT supplier_part_number,description,quantity_on_hand,quantity_committed,cost,ROUND(quantity_on_hand*cost,2) AS value FROM service_parts WHERE active=true ORDER BY supplier_part_number');sendCsv(res,'inventory-valuation.csv',['SKU','Description','On Hand','Committed','Cost USD','Value USD'],r.rows.map(x=>[x.supplier_part_number,x.description,x.quantity_on_hand,x.quantity_committed,x.cost,x.value]))}));
router.get('/reports/retail.csv',permit(manager),wrap(async(req,res)=>{
 await ensure();const from=txt(req.query.from,10),to=txt(req.query.to,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to))fail('Specify from/to YYYY-MM-DD');
 const r=await q('SELECT r.id,r.created_at,r.payment_status,r.customer_id,p.supplier_part_number,l.qty,l.price_cents,r.tax_cents,r.total_cents FROM htfo_pos_receipts r JOIN htfo_pos_part_lines l ON l.receipt_id=r.id JOIN service_parts p ON p.id=l.part_id WHERE r.created_at >= $1::date AND r.created_at < $2::date + INTERVAL \'1 day\' ORDER BY r.id,l.id',[from,to]);
 sendCsv(res,'retail-'+from+'-'+to+'.csv',['Receipt ID','Date UTC','Payment Status','Customer ID','SKU','Quantity','Unit Price USD','Receipt Tax USD','Receipt Total USD'],r.rows.map(x=>[x.id,x.created_at,x.payment_status,x.customer_id,x.supplier_part_number,x.qty,(x.price_cents/100).toFixed(2),(x.tax_cents/100).toFixed(2),(x.total_cents/100).toFixed(2)]))
}));
router.get('/reports/purchasing.csv',permit(manager),wrap(async(req,res)=>{
 await ensure();const r=await q('SELECT o.id,o.created_at,s.name AS supplier,o.location,o.status,p.supplier_part_number,l.quantity_ordered,l.quantity_received,l.unit_cost_cents FROM htfo_purchase_orders o JOIN htfo_suppliers s ON s.id=o.supplier_id JOIN htfo_purchase_order_lines l ON l.order_id=o.id JOIN service_parts p ON p.id=l.part_id ORDER BY o.id,l.id');
 sendCsv(res,'purchasing.csv',['PO ID','Date UTC','Supplier','Location','Status','SKU','Ordered','Received','Unit Cost USD'],r.rows.map(x=>[x.id,x.created_at,x.supplier,x.location,x.status,x.supplier_part_number,x.quantity_ordered,x.quantity_received,(x.unit_cost_cents/100).toFixed(2)]))
}));
router.get('/audit',permit(manager),wrap(async(req,res)=>{await ensure();res.json({adjustments:(await q('SELECT * FROM htfo_stock_adjustments ORDER BY id DESC LIMIT 100')).rows,transfers:(await q('SELECT * FROM htfo_stock_transfers ORDER BY id DESC LIMIT 100')).rows})}));
export default router;
