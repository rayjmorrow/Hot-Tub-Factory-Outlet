import express from 'express';
import jwt from 'jsonwebtoken';
import { q } from './service-db.js';

const router=express.Router();
const clean=v=>v==null?null:String(v).trim();
function secret(){if(!process.env.SERVICE_JWT_SECRET)throw new Error('SERVICE_JWT_SECRET is required');return process.env.SERVICE_JWT_SECRET}
function auth(req,res,next){
  try{
    const raw=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
    if(!raw)return res.status(401).json({error:'Login required'});
    req.user=jwt.verify(raw,secret());next();
  }catch{res.status(401).json({error:'Session expired or invalid'})}
}

router.get('/crm/dashboard',auth,async(req,res)=>{
  const [totals,stages,sources,delivery]=await Promise.all([
    q(`SELECT count(*)::int total,
      count(*) FILTER (WHERE received_at>=NOW()-INTERVAL '24 hours')::int last_24_hours,
      count(*) FILTER (WHERE received_at>=NOW()-INTERVAL '7 days')::int last_7_days,
      count(*) FILTER (WHERE pipeline_stage NOT IN ('Sold','Lost'))::int open
      FROM crm_website_leads`),
    q(`SELECT pipeline_stage,count(*)::int count FROM crm_website_leads GROUP BY pipeline_stage ORDER BY count DESC`),
    q(`SELECT source,count(*)::int count FROM crm_website_leads GROUP BY source ORDER BY count DESC LIMIT 10`),
    q(`SELECT
      count(*) FILTER (WHERE ghl_contact_status='failed')::int contact_failures,
      count(*) FILTER (WHERE ghl_opportunity_status='failed')::int opportunity_failures,
      count(*) FILTER (WHERE ghl_contact_status='sent')::int contacts_sent,
      count(*) FILTER (WHERE ghl_opportunity_status='sent')::int opportunities_sent
      FROM crm_website_leads`)
  ]);
  res.json({totals:totals.rows[0],stages:stages.rows,sources:sources.rows,delivery:delivery.rows[0]});
});

router.get('/crm/leads',auth,async(req,res)=>{
  const term=clean(req.query.q)||'',stage=clean(req.query.stage),limit=Math.min(500,Math.max(1,Number(req.query.limit)||250));
  const params=[`%${term}%`];let where=`WHERE concat_ws(' ',first_name,last_name,email,phone,source,note) ILIKE $1`;
  if(stage){params.push(stage);where+=` AND pipeline_stage=$${params.length}`}
  params.push(limit);
  const rows=(await q(`SELECT submission_id,first_name,last_name,email,phone,source,tags,note,lifecycle_stage,pipeline_stage,
      ghl_contact_status,ghl_contact_id,ghl_contact_error,ghl_opportunity_status,ghl_opportunity_id,ghl_opportunity_error,received_at,updated_at
    FROM crm_website_leads ${where} ORDER BY received_at DESC LIMIT $${params.length}`,params)).rows;
  res.json(rows);
});

router.patch('/crm/leads/:submissionId',auth,async(req,res)=>{
  const stage=clean(req.body?.pipeline_stage),allowed=new Set(['New Lead','Contacted','Appointment','Visited Showroom','Quoted','Sold','Lost']);
  if(!allowed.has(stage))return res.status(400).json({error:'Invalid pipeline stage'});
  const row=(await q(`UPDATE crm_website_leads SET pipeline_stage=$2,lifecycle_stage=CASE WHEN $2='Sold' THEN 'Customer' WHEN $2='Lost' THEN 'Past Prospect' ELSE 'Prospect' END,updated_at=NOW() WHERE submission_id=$1 RETURNING *`,[req.params.submissionId,stage])).rows[0];
  if(!row)return res.status(404).json({error:'Lead not found'});
  res.json(row);
});

export default router;
