import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { q } from './service-db.js';

const router=express.Router();
const clean=v=>v==null?null:String(v).trim();
function secret(){if(!process.env.SERVICE_JWT_SECRET)throw new Error('SERVICE_JWT_SECRET is required');return process.env.SERVICE_JWT_SECRET}
function auth(req,res,next){try{const raw=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!raw)return res.status(401).json({error:'Login required'});req.user=jwt.verify(raw,secret());next()}catch{res.status(401).json({error:'Session expired or invalid'})}}
function manager(req,res,next){if(!['admin','owner','manager','service_manager'].includes(req.user?.role))return res.status(403).json({error:'Manager permission required'});next()}
const allowedRoles=new Set(['admin','owner','manager','service_manager','technician','staff']);

router.get('/admin/users',auth,manager,async(req,res)=>{
  const r=await q(`SELECT id,username,display_name,role,active,created_at FROM service_users ORDER BY active DESC,display_name,username`);
  res.json(r.rows);
});

router.post('/admin/users',auth,manager,async(req,res)=>{
  const username=clean(req.body?.username),displayName=clean(req.body?.display_name),role=clean(req.body?.role)||'staff',password=String(req.body?.password||'');
  if(!username||!displayName||password.length<10)return res.status(400).json({error:'Username, display name, and a password of at least 10 characters are required'});
  if(!allowedRoles.has(role))return res.status(400).json({error:'Invalid role'});
  const exists=await q('SELECT id FROM service_users WHERE lower(username)=lower($1)',[username]);
  if(exists.rowCount)return res.status(409).json({error:'Username already exists'});
  const hash=await bcrypt.hash(password,12);
  const r=await q(`INSERT INTO service_users(username,password_hash,display_name,role) VALUES($1,$2,$3,$4) RETURNING id,username,display_name,role,active,created_at`,[username,hash,displayName,role]);
  res.status(201).json(r.rows[0]);
});

router.patch('/admin/users/:id',auth,manager,async(req,res)=>{
  const role=clean(req.body?.role),displayName=clean(req.body?.display_name),active=req.body?.active;
  if(role&&!allowedRoles.has(role))return res.status(400).json({error:'Invalid role'});
  const r=await q(`UPDATE service_users SET display_name=COALESCE($2,display_name),role=COALESCE($3,role),active=COALESCE($4,active) WHERE id=$1 RETURNING id,username,display_name,role,active,created_at`,[req.params.id,displayName,role,active==null?null:Boolean(active)]);
  if(!r.rowCount)return res.status(404).json({error:'User not found'});
  res.json(r.rows[0]);
});

router.patch('/admin/users/:id/password',auth,manager,async(req,res)=>{
  const password=String(req.body?.password||'');
  if(password.length<10)return res.status(400).json({error:'Password must be at least 10 characters'});
  const hash=await bcrypt.hash(password,12);
  const r=await q('UPDATE service_users SET password_hash=$2 WHERE id=$1 RETURNING id,username,display_name,role,active',[req.params.id,hash]);
  if(!r.rowCount)return res.status(404).json({error:'User not found'});
  res.json({ok:true,user:r.rows[0]});
});

router.get('/admin/audit',auth,manager,async(req,res)=>{
  const table=clean(req.query.table),recordId=clean(req.query.record_id),limit=Math.min(500,Math.max(1,Number(req.query.limit)||100));
  const params=[];let where='WHERE 1=1';
  if(table){params.push(table);where+=` AND table_name=$${params.length}`}
  if(recordId){params.push(recordId);where+=` AND record_id=$${params.length}`}
  params.push(limit);
  const r=await q(`SELECT id,table_name,record_id,action,actor,old_data,new_data,created_at FROM service_audit_log ${where} ORDER BY created_at DESC LIMIT $${params.length}`,params);
  res.json(r.rows);
});

export default router;
