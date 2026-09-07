import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { q } from './service-db.js';
import { SERVICE_RULES, canOverrideCharges, calculateLaborAmount, calculatePartsTax, defaultScheduledEnd } from './service-business-rules.js';

const router = express.Router();
const secret = () => {
  if(!process.env.SERVICE_JWT_SECRET) throw new Error('SERVICE_JWT_SECRET is required');
  return process.env.SERVICE_JWT_SECRET;
};
const clean = v => v == null ? null : String(v).trim();
const num = v => Number(v || 0);
const tokenFor = user => jwt.sign({sub:user.id,username:user.username,name:user.display_name,role:user.role}, secret(), {expiresIn:'12h'});
const canDispatch = req => ['admin','manager','service_manager','owner'].includes(req.user?.role);

export async function ensureBootstrapAdmin(){
  const username=clean(process.env.SERVICE_ADMIN_USER), password=process.env.SERVICE_ADMIN_PASSWORD, display=clean(process.env.SERVICE_ADMIN_NAME)||'HTFO Administrator';
  if(!username || !password) return;
  const hash=await bcrypt.hash(password,12);
  const hit=await q('SELECT id FROM service_users WHERE lower(username)=lower($1)',[username]);
  if(hit.rowCount){
    await q('UPDATE service_users SET password_hash=$2,display_name=$3,role=$4,active=true WHERE id=$1',[hit.rows[0].id,hash,display,'admin']);
    return;
  }
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
async function paymentReady(customerId){
  try{
    const r=await q('SELECT payment_status FROM service_customer_payment_settings WHERE customer_id=$1',[customerId]);
    return ['card_on_file','cash_check_approved'].includes(r.rows[0]?.payment_status);
  }catch{return false}
}

router.post('/auth/login', async(req,res)=>{
  const username=clean(req.body?.username), password=String(req.body?.password||'');
  const r=await q('SELECT * FROM service_users WHERE lower(username)=lower($1) AND active=true',[username]);
  const u=r.rows[0];
  if(!u || !(await bcrypt.compare(password,u.password_hash))) return res.status(401).json({error:'Invalid username or password'});
  res.json({token:tokenFor(u),user:{id:u.id,username:u.username,name:u.display_name,role:u.role}});
});
router.get('/me',auth,(req,res)=>res.json({user:req.user}));
router.get('/business-rules',auth,(req,res)=>res.json({
  labor_rate_per_hour:SERVICE_RULES.laborRatePerHour,
  diagnostic_charge:SERVICE_RULES.diagnosticCharge,
  default_appointment_minutes:SERVICE_RULES.defaultAppointmentMinutes,
  parts_tax_rate:SERVICE_RULES.partsTaxRate,
  labor_taxable:SERVICE_RULES.laborTaxable,
  charge_override_allowed:canOverrideCharges(req)
}));

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
  const r=await q(`SELECT w.*,concat_ws(' ',c.first_name,c.last_name) customer_name,c.phone,c.city,c.state,e.brand,e.model,e.equipment_type,e.serial_number
    FROM service_work_orders w JOIN service_customers c ON c.id=w.customer_id LEFT JOIN service_equipment e ON e.id=w.equipment_id
    WHERE (w.scheduled_start BETWEEN $1 AND $2) OR (w.scheduled_start IS NULL AND w.status NOT IN ('completed','cancelled')) ORDER BY w.scheduled_start NULLS LAST`,[from,to]);
  res.json(r.rows);
});
router.post('/work-orders',auth,async(req,res)=>{
  if(!canDispatch(req)) return res.status(403).json({error:'Dispatch permission required'});
  const b=req.body||{};
  if(b.scheduled_start && !(await paymentReady(b.customer_id))) return res.status(409).json({error:'Payment method must be secured before this service call can be scheduled. Add a card on file or approve cash/check first.'});
  const number=`WO-${new Date().getFullYear()}-${Date.now().toString().slice(-7)}`;
  const scheduledEnd=b.scheduled_end||defaultScheduledEnd(b.scheduled_start,b.appointment_minutes||SERVICE_RULES.defaultAppointmentMinutes);
  const appointmentMinutes=Math.max(15,Number(b.appointment_minutes)||SERVICE_RULES.defaultAppointmentMinutes);
  const r=await q(`INSERT INTO service_work_orders(work_order_number,customer_id,equipment_id,assigned_to,assigned_team,job_type,status,priority,scheduled_start,scheduled_end,appointment_minutes,complaint,warranty,internal_notes,diagnostic_amount,labor_rate,parts_tax_rate)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,[number,b.customer_id,b.equipment_id||null,clean(b.assigned_to),clean(b.assigned_team),clean(b.job_type)||'service',clean(b.status)||'scheduled',clean(b.priority)||'normal',b.scheduled_start||null,scheduledEnd,appointmentMinutes,clean(b.complaint),Boolean(b.warranty),clean(b.internal_notes),SERVICE_RULES.diagnosticCharge,SERVICE_RULES.laborRatePerHour,SERVICE_RULES.partsTaxRate]);
  res.status(201).json(r.rows[0]);
});
router.patch('/work-orders/:id',auth,async(req,res)=>{
  const current=(await q('SELECT * FROM service_work_orders WHERE id=$1',[req.params.id])).rows[0];
  if(!current) return res.status(404).json({error:'Work order not found'});
  const b=req.body||{},dispatch=canDispatch(req),override=canOverrideCharges(req);
  if(dispatch && b.scheduled_start && !(await paymentReady(current.customer_id))) return res.status(409).json({error:'Payment method must be secured before this service call can be scheduled.'});
  const laborHours=b.labor_hours==null?num(current.labor_hours):Math.max(0,num(b.labor_hours));
  const labor=override&&b.labor_amount!=null?Math.max(0,num(b.labor_amount)):calculateLaborAmount(laborHours);
  const parts=override&&b.parts_amount!=null?Math.max(0,num(b.parts_amount)):num(current.parts_amount);
  const diagnostic=override&&b.diagnostic_amount!=null?Math.max(0,num(b.diagnostic_amount)):num(current.diagnostic_amount||SERVICE_RULES.diagnosticCharge);
  const tax=calculatePartsTax(parts);
  const tripOverride=override&&b.trip_charge_override!=null?Math.max(0,num(b.trip_charge_override)):current.trip_charge_override;
  const overrideReason=override&&b.charge_override_reason!=null?clean(b.charge_override_reason):current.charge_override_reason;
  const overrideBy=override&&(b.labor_amount!=null||b.parts_amount!=null||b.diagnostic_amount!=null||b.trip_charge_override!=null)?(req.user?.name||req.user?.username):current.charge_override_by;
  const assigned=dispatch?clean(b.assigned_to):null,assignedTeam=dispatch?clean(b.assigned_team):null,jobType=dispatch?clean(b.job_type):null,priority=dispatch?clean(b.priority):null,scheduledStart=dispatch?(b.scheduled_start||null):null;
  const appointmentMinutes=dispatch&&b.appointment_minutes!=null?Math.max(15,Number(b.appointment_minutes)||SERVICE_RULES.defaultAppointmentMinutes):null;
  const scheduledEnd=dispatch?(b.scheduled_end||((b.scheduled_start||current.scheduled_start)?defaultScheduledEnd(b.scheduled_start||current.scheduled_start,appointmentMinutes||current.appointment_minutes||SERVICE_RULES.defaultAppointmentMinutes):null)):null;
  const updated=await q(`UPDATE service_work_orders SET assigned_to=coalesce($2,assigned_to),assigned_team=coalesce($3,assigned_team),job_type=coalesce($4,job_type),status=coalesce($5,status),priority=coalesce($6,priority),scheduled_start=coalesce($7,scheduled_start),scheduled_end=coalesce($8,scheduled_end),appointment_minutes=coalesce($9,appointment_minutes),complaint=coalesce($10,complaint),diagnosis=coalesce($11,diagnosis),work_performed=coalesce($12,work_performed),parts_used=coalesce($13,parts_used),labor_hours=$14,labor_amount=$15,parts_amount=$16,diagnostic_amount=$17,tax_amount=$18,parts_tax_rate=$19,trip_charge_override=$20,charge_override_reason=$21,charge_override_by=$22,warranty=coalesce($23,warranty),internal_notes=coalesce($24,internal_notes),customer_signature=coalesce($25,customer_signature),travel_minutes=coalesce($26,travel_minutes),completed_at=CASE WHEN $5='completed' THEN coalesce(completed_at,NOW()) ELSE completed_at END,updated_at=NOW() WHERE id=$1 RETURNING *`,
    [req.params.id,assigned,assignedTeam,jobType,clean(b.status),priority,scheduledStart,scheduledEnd,appointmentMinutes,clean(b.complaint),clean(b.diagnosis),clean(b.work_performed),clean(b.parts_used),laborHours,labor,parts,diagnostic,tax,SERVICE_RULES.partsTaxRate,tripOverride,overrideReason,overrideBy,b.warranty==null?null:Boolean(b.warranty),clean(b.internal_notes),clean(b.customer_signature),b.travel_minutes==null?null:Math.max(0,num(b.travel_minutes))]);
  const finalRow=(await q('UPDATE service_work_orders SET total_amount=diagnostic_amount+labor_amount+parts_amount+trip_amount+tax_amount WHERE id=$1 RETURNING *',[req.params.id])).rows[0];
  res.json(finalRow||updated.rows[0]);
});

router.post('/work-orders/:id/invoice',auth,async(req,res)=>{
  const w=(await q('SELECT * FROM service_work_orders WHERE id=$1',[req.params.id])).rows[0];
  if(!w) return res.status(404).json({error:'Work order not found'});
  const existing=await q('SELECT * FROM service_invoices WHERE work_order_id=$1',[w.id]);
  if(existing.rowCount) return res.json(existing.rows[0]);
  const diagnostic=num(w.diagnostic_amount), subtotal=diagnostic+num(w.labor_amount)+num(w.parts_amount)+num(w.trip_amount), tax=calculatePartsTax(w.parts_amount), total=subtotal+tax, inv=`SVC-${new Date().getFullYear()}-${Date.now().toString().slice(-7)}`;
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