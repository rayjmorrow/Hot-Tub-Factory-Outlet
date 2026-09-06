import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { q } from './service-db.js';

const router = express.Router();
const secret = () => {
  if(!process.env.SERVICE_JWT_SECRET) throw new Error('SERVICE_JWT_SECRET is required');
  return process.env.SERVICE_JWT_SECRET;
};
const clean = v => v == null ? null : String(v).trim();
const num = v => Number(v || 0);
const tokenFor = user => jwt.sign({sub:user.id,username:user.username,name:user.display_name,role:user.role}, secret(), {expiresIn:'12h'});
const canDispatch = req => ['admin','manager','service_manager'].includes(req.user?.role);

export async function ensureBootstrapAdmin(){
  const username=clean(process.env.SERVICE_ADMIN_USER), password=process.env.SERVICE_ADMIN_PASSWORD, display=clean(process.env.SERVICE_ADMIN_NAME)||'HTFO Administrator';
  if(!username || !password) return;
  const hit=await q('SELECT id FROM service_users WHERE lower(username)=lower($1)',[username]);
  if(hit.rowCount) return;
  const hash=await bcrypt.hash(password,12);
  await q('INSERT INTO service_users(username,password_hash,display_name,role) VALUES($1,$2,$3,$4)',[username,hash,display,'admin']);
}

function auth(req,res,next){
  try{
    const raw=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
    if(!raw) return res.status(401).json({error:'Login required'});
    req.user=jwt.verify(raw,secret());
    next();
  }catch{ res.status(401).json({error:'Session expired or invalid'}); }
}

router.post('/auth/login', async(req,res)=>{
  const username=clean(req.body?.username), password=String(req.body?.password||'');
  const r=await q('SELECT * FROM service_users WHERE lower(username)=lower($1) AND active=true',[username]);
  const u=r.rows[0];
  if(!u || !(await bcrypt.compare(password,u.password_hash))) return res.status(401).json({error:'Invalid username or password'});
  res.json({token:tokenFor(u),user:{id:u.id,username:u.username,name:u.display_name,role:u.role}});
});
router.get('/me',auth,(req,res)=>res.json({user:req.user}));

router.get('/dashboard',auth,async(req,res)=>{
  const [today,open,unpaid,customers]=await Promise.all([
    q("SELECT count(*)::int n FROM service_work_orders WHERE scheduled_start::date=CURRENT_DATE"),
    q("SELECT count(*)::int n FROM service_work_orders WHERE status NOT IN ('completed','cancelled')"),
    q("SELECT coalesce(sum(total_amount-amount_paid),0)::numeric balance FROM service_invoices WHERE status<>'paid'"),
    q('SELECT count(*)::int n FROM service_customers')
  ]);
  res.json({today:today.rows[0].n,open:open.rows[0].n,unpaid:Number(unpaid.rows[0].balance),customers:customers.rows[0].n});
});

router.get('/customers',auth,async(req,res)=>{
  const term=`%${clean(req.query.q)||''}%`;
  const r=await q(`SELECT * FROM service_customers WHERE concat_ws(' ',first_name,last_name,company,email,phone,street,city,zip) ILIKE $1 ORDER BY last_name NULLS LAST, first_name NULLS LAST LIMIT 250`,[term]);
  res.json(r.rows);
});
router.post('/customers',auth,async(req,res)=>{
  const b=req.body||{};
  const r=await q(`INSERT INTO service_customers(first_name,last_name,company,email,phone,street,street2,city,state,zip,notes,source)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [clean(b.first_name),clean(b.last_name),clean(b.company),clean(b.email),clean(b.phone),clean(b.street),clean(b.street2),clean(b.city),clean(b.state),clean(b.zip),clean(b.notes),clean(b.source)||'manual']);
  res.status(201).json(r.rows[0]);
});
router.post('/customers/import',auth,async(req,res)=>{
  const rows=Array.isArray(req.body?.rows)?req.body.rows:[];
  let inserted=0, skipped=0;
  for(const b of rows){
    const email=clean(b.email), phone=clean(b.phone);
    let existing={rowCount:0};
    if(email) existing=await q('SELECT id FROM service_customers WHERE lower(email)=lower($1) LIMIT 1',[email]);
    if(!existing.rowCount && phone) existing=await q("SELECT id FROM service_customers WHERE regexp_replace(phone,'\\D','','g')=regexp_replace($1,'\\D','','g') LIMIT 1",[phone]);
    if(existing.rowCount){ skipped++; continue; }
    await q(`INSERT INTO service_customers(first_name,last_name,company,email,phone,street,street2,city,state,zip,notes,source) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'csv')`,
      [clean(b.first_name),clean(b.last_name),clean(b.company),email,phone,clean(b.street),clean(b.street2),clean(b.city),clean(b.state),clean(b.zip),clean(b.notes)]);
    inserted++;
  }
  res.json({inserted,skipped,total:rows.length});
});
router.get('/customers/:id',auth,async(req,res)=>{
  const [c,e,w,i]=await Promise.all([
    q('SELECT * FROM service_customers WHERE id=$1',[req.params.id]),
    q('SELECT * FROM service_equipment WHERE customer_id=$1 ORDER BY created_at DESC',[req.params.id]),
    q('SELECT * FROM service_work_orders WHERE customer_id=$1 ORDER BY scheduled_start DESC NULLS LAST,created_at DESC',[req.params.id]),
    q('SELECT * FROM service_invoices WHERE customer_id=$1 ORDER BY created_at DESC',[req.params.id])
  ]);
  if(!c.rowCount) return res.status(404).json({error:'Customer not found'});
  res.json({customer:c.rows[0],equipment:e.rows,workOrders:w.rows,invoices:i.rows});
});

router.post('/equipment',auth,async(req,res)=>{
  const b=req.body||{};
  const r=await q(`INSERT INTO service_equipment(customer_id,equipment_type,brand,model,serial_number,install_date,warranty_expires,location_notes,notes)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[b.customer_id,clean(b.equipment_type)||'Hot Tub',clean(b.brand),clean(b.model),clean(b.serial_number),b.install_date||null,b.warranty_expires||null,clean(b.location_notes),clean(b.notes)]);
  res.status(201).json(r.rows[0]);
});

router.get('/work-orders',auth,async(req,res)=>{
  const from=req.query.from||new Date(Date.now()-7*86400000).toISOString(), to=req.query.to||new Date(Date.now()+30*86400000).toISOString();
  const r=await q(`SELECT w.*,concat_ws(' ',c.first_name,c.last_name) customer_name,c.phone,c.city,c.state,e.brand,e.model
    FROM service_work_orders w JOIN service_customers c ON c.id=w.customer_id LEFT JOIN service_equipment e ON e.id=w.equipment_id
    WHERE (w.scheduled_start BETWEEN $1 AND $2) OR (w.scheduled_start IS NULL AND w.status NOT IN ('completed','cancelled')) ORDER BY w.scheduled_start NULLS LAST`,[from,to]);
  res.json(r.rows);
});
router.post('/work-orders',auth,async(req,res)=>{
  if(!canDispatch(req)) return res.status(403).json({error:'Dispatch permission required'});
  const b=req.body||{}, number=`WO-${new Date().getFullYear()}-${Date.now().toString().slice(-7)}`;
  const r=await q(`INSERT INTO service_work_orders(work_order_number,customer_id,equipment_id,assigned_to,assigned_team,job_type,status,priority,scheduled_start,scheduled_end,complaint,warranty,internal_notes)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,[number,b.customer_id,b.equipment_id||null,clean(b.assigned_to),clean(b.assigned_team),clean(b.job_type)||'service',clean(b.status)||'scheduled',clean(b.priority)||'normal',b.scheduled_start||null,b.scheduled_end||null,clean(b.complaint),Boolean(b.warranty),clean(b.internal_notes)]);
  res.status(201).json(r.rows[0]);
});
router.patch('/work-orders/:id',auth,async(req,res)=>{
  const b=req.body||{},dispatch=canDispatch(req);
  const labor=num(b.labor_amount), parts=num(b.parts_amount), trip=num(b.trip_amount), tax=num(b.tax_amount), total=labor+parts+trip+tax;
  const assigned=dispatch?clean(b.assigned_to):null,assignedTeam=dispatch?clean(b.assigned_team):null,jobType=dispatch?clean(b.job_type):null,priority=dispatch?clean(b.priority):null,scheduledStart=dispatch?(b.scheduled_start||null):null,scheduledEnd=dispatch?(b.scheduled_end||null):null;
  const r=await q(`UPDATE service_work_orders SET assigned_to=coalesce($2,assigned_to),assigned_team=coalesce($3,assigned_team),job_type=coalesce($4,job_type),status=coalesce($5,status),priority=coalesce($6,priority),scheduled_start=coalesce($7,scheduled_start),scheduled_end=coalesce($8,scheduled_end),complaint=coalesce($9,complaint),diagnosis=coalesce($10,diagnosis),work_performed=coalesce($11,work_performed),parts_used=coalesce($12,parts_used),labor_hours=coalesce($13,labor_hours),labor_amount=$14,parts_amount=$15,trip_amount=$16,tax_amount=$17,total_amount=$18,warranty=coalesce($19,warranty),internal_notes=coalesce($20,internal_notes),customer_signature=coalesce($21,customer_signature),completed_at=CASE WHEN $5='completed' THEN coalesce(completed_at,NOW()) ELSE completed_at END,updated_at=NOW() WHERE id=$1 RETURNING *`,
    [req.params.id,assigned,assignedTeam,jobType,clean(b.status),priority,scheduledStart,scheduledEnd,clean(b.complaint),clean(b.diagnosis),clean(b.work_performed),clean(b.parts_used),b.labor_hours==null?null:num(b.labor_hours),labor,parts,trip,tax,total,b.warranty==null?null:Boolean(b.warranty),clean(b.internal_notes),clean(b.customer_signature)]);
  if(!r.rowCount) return res.status(404).json({error:'Work order not found'});
  res.json(r.rows[0]);
});

router.post('/work-orders/:id/invoice',auth,async(req,res)=>{
  const w=(await q('SELECT * FROM service_work_orders WHERE id=$1',[req.params.id])).rows[0];
  if(!w) return res.status(404).json({error:'Work order not found'});
  const existing=await q('SELECT * FROM service_invoices WHERE work_order_id=$1',[w.id]);
  if(existing.rowCount) return res.json(existing.rows[0]);
  const subtotal=num(w.labor_amount)+num(w.parts_amount)+num(w.trip_amount), tax=num(w.tax_amount), total=subtotal+tax, inv=`SVC-${new Date().getFullYear()}-${Date.now().toString().slice(-7)}`;
  const r=await q(`INSERT INTO service_invoices(invoice_number,work_order_id,customer_id,status,subtotal,tax_amount,total_amount) VALUES($1,$2,$3,'open',$4,$5,$6) RETURNING *`,[inv,w.id,w.customer_id,subtotal,tax,total]);
  res.status(201).json(r.rows[0]);
});
router.patch('/invoices/:id/payment',auth,async(req,res)=>{
  const amount=num(req.body?.amount), method=clean(req.body?.payment_method);
  const r=await q(`UPDATE service_invoices SET amount_paid=least(total_amount,amount_paid+$2),payment_method=coalesce($3,payment_method),status=CASE WHEN amount_paid+$2>=total_amount THEN 'paid' ELSE 'partial' END,paid_at=CASE WHEN amount_paid+$2>=total_amount THEN NOW() ELSE paid_at END,updated_at=NOW() WHERE id=$1 RETURNING *`,[req.params.id,amount,method]);
  if(!r.rowCount) return res.status(404).json({error:'Invoice not found'});
  res.json(r.rows[0]);
});

export default router;
