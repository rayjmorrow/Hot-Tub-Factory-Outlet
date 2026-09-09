import express from 'express';
import jwt from 'jsonwebtoken';
import { q } from './service-db.js';

const router=express.Router();
const secret=()=>{if(!process.env.SERVICE_JWT_SECRET)throw new Error('SERVICE_JWT_SECRET is required');return process.env.SERVICE_JWT_SECRET};
const clean=v=>v==null?null:String(v).trim();
function auth(req,res,next){try{const raw=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!raw)return res.status(401).json({error:'Login required'});req.user=jwt.verify(raw,secret());next()}catch{res.status(401).json({error:'Session expired or invalid'})}}

router.patch('/equipment/:id',auth,async(req,res)=>{
  const b=req.body||{};
  const r=await q(`UPDATE service_equipment SET
    equipment_type=coalesce($2,equipment_type),
    brand=$3,
    model=$4,
    serial_number=$5,
    install_date=$6,
    warranty_expires=$7,
    location_notes=$8,
    notes=$9,
    updated_at=NOW()
    WHERE id=$1 RETURNING *`,[
      req.params.id,
      clean(b.equipment_type),
      clean(b.brand),
      clean(b.model),
      clean(b.serial_number),
      b.install_date||null,
      b.warranty_expires||null,
      clean(b.location_notes),
      clean(b.notes)
    ]);
  if(!r.rowCount)return res.status(404).json({error:'Product not found'});
  res.json(r.rows[0]);
});

export default router;
