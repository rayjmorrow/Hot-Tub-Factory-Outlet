import express from 'express';
import { q } from './service-db.js';

const router=express.Router();
const clean=v=>v==null?'':String(v).trim();
const digits=v=>clean(v).replace(/\D/g,'');

router.post('/public/service-request',async(req,res)=>{
  try{
    const b=req.body||{};
    if(clean(b._honey))return res.status(202).json({ok:true});
    const first=clean(b.first_name),last=clean(b.last_name),street=clean(b.street),city=clean(b.city),state=clean(b.state)||'PA',zip=clean(b.zip),phone=clean(b.phone),email=clean(b.email).toLowerCase(),complaint=clean(b.description||b.complaint);
    const missing=[];
    for(const [name,value] of Object.entries({first_name:first,last_name:last,street,city,zip,phone,email,description:complaint}))if(!value)missing.push(name);
    if(missing.length)return res.status(400).json({error:`Missing required field(s): ${missing.join(', ')}`});
    if(!/^\S+@\S+\.\S+$/.test(email))return res.status(400).json({error:'Please enter a valid email address'});

    let customer=null;
    const byEmail=await q('SELECT * FROM service_customers WHERE lower(email)=lower($1) ORDER BY id LIMIT 1',[email]);
    if(byEmail.rowCount)customer=byEmail.rows[0];
    if(!customer&&digits(phone)){
      const byPhone=await q("SELECT * FROM service_customers WHERE regexp_replace(phone,'\\D','','g')=$1 ORDER BY id LIMIT 1",[digits(phone)]);
      if(byPhone.rowCount)customer=byPhone.rows[0];
    }
    if(!customer){
      const c=await q(`INSERT INTO service_customers(first_name,last_name,email,phone,street,city,state,zip,source) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'website_service_request') RETURNING *`,[first,last,email,phone,street,city,state,zip]);
      customer=c.rows[0];
    }else{
      await q(`UPDATE service_customers SET first_name=COALESCE(NULLIF(first_name,''),$2),last_name=COALESCE(NULLIF(last_name,''),$3),email=COALESCE(NULLIF(email,''),$4),phone=COALESCE(NULLIF(phone,''),$5),street=COALESCE(NULLIF(street,''),$6),city=COALESCE(NULLIF(city,''),$7),state=COALESCE(NULLIF(state,''),$8),zip=COALESCE(NULLIF(zip,''),$9),updated_at=NOW() WHERE id=$1`,[customer.id,first,last,email,phone,street,city,state,zip]);
    }

    const r=await q(`INSERT INTO service_requests(customer_id,complaint,status,manager_note) VALUES($1,$2,'requested',$3) RETURNING id,created_at,status`,[customer.id,complaint,'Submitted from HTFO public service request page']);
    res.status(201).json({ok:true,request_id:r.rows[0].id,status:r.rows[0].status,received_at:r.rows[0].created_at});
  }catch(e){
    console.error('Public service request error',e);
    res.status(500).json({error:'Unable to save service request right now'});
  }
});

export default router;
