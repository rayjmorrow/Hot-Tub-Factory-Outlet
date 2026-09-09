import express from 'express';
import jwt from 'jsonwebtoken';
import { q } from './service-db.js';

const router=express.Router();
const clean=v=>v==null?null:String(v).trim();
const secret=()=>{
  if(!process.env.SERVICE_JWT_SECRET) throw new Error('SERVICE_JWT_SECRET is required');
  return process.env.SERVICE_JWT_SECRET;
};
function auth(req,res,next){
  try{
    const raw=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
    if(!raw) return res.status(401).json({error:'Login required'});
    req.user=jwt.verify(raw,secret());
    next();
  }catch{
    res.status(401).json({error:'Session expired or invalid'});
  }
}

router.patch('/customers/:id/profile',auth,async(req,res)=>{
  const b=req.body||{};
  const existing=await q('SELECT * FROM service_customers WHERE id=$1',[req.params.id]);
  if(!existing.rowCount) return res.status(404).json({error:'Customer not found'});
  const r=await q(`UPDATE service_customers SET
    first_name=$2,last_name=$3,company=$4,email=$5,phone=$6,street=$7,street2=$8,city=$9,state=$10,zip=$11,notes=$12,updated_at=NOW()
    WHERE id=$1 RETURNING *`,[
      req.params.id,clean(b.first_name),clean(b.last_name),clean(b.company),clean(b.email),clean(b.phone),
      clean(b.street),clean(b.street2),clean(b.city),clean(b.state)?.toUpperCase()||null,clean(b.zip),clean(b.notes)
    ]);
  res.json(r.rows[0]);
});

export default router;
