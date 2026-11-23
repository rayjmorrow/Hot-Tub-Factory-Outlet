import express from 'express';
import bcrypt from 'bcryptjs';
import {randomBytes,createHash} from 'node:crypto';
import {q} from './service-db.js';
import {sendCrmEmailWithGmail} from './crm-gmail-contract-send.js';

const router=express.Router();
const digest=token=>createHash('sha256').update(token).digest('hex');
const generic='If this account has a verified recovery email, a reset link will be sent shortly.';
const LOGIN_URL='https://htfo-sales-crm-preview.onrender.com/';
const RESET_URL=LOGIN_URL+'?password-reset=';
const validEmail=value=>/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(value);
let readyPromise;
function ensureSchema(){
 if(!readyPromise)readyPromise=q(`CREATE TABLE IF NOT EXISTS service_password_resets (
   id BIGSERIAL PRIMARY KEY,
   user_id BIGINT NOT NULL REFERENCES service_users(id) ON DELETE CASCADE,
   token_hash TEXT UNIQUE,
   requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
   expires_at TIMESTAMPTZ NOT NULL,
   used_at TIMESTAMPTZ,
   request_ip_hash TEXT
 ); CREATE INDEX IF NOT EXISTS idx_service_password_reset_user ON service_password_resets(user_id,requested_at DESC);`).catch(e=>{readyPromise=null;throw e});
 return readyPromise;
}
// Addresses are provisioned by the owner, not supplied by an unauthenticated requester.
// For additional employees, set HTFO_PASSWORD_RECOVERY_EMAILS to JSON, e.g. {"steve":"verified@company.com"}.
function recoveryEmail(username){
 const u=String(username||'').trim().toLowerCase();
 if(u==='ray')return 'ray@hottubfactoryoutlet.com';
 let configured={};
 try{configured=JSON.parse(process.env.HTFO_PASSWORD_RECOVERY_EMAILS||'{}')}catch{return null}
 const destination=configured[u];
 return typeof destination==='string'&&validEmail(destination)?destination:null;
}
function requestIp(req){
 const ip=String(req.ip||req.socket?.remoteAddress||'unknown');
 return digest((process.env.SERVICE_JWT_SECRET||'reset-rate')+':'+ip);
}
router.post('/auth/forgot-password',async(req,res)=>{
 res.set('Cache-Control','no-store');
 const username=String(req.body?.username||'').trim().toLowerCase();
 if(username.length>100||!username)return res.json({message:generic});
 try{
  await ensureSchema();
  const ipHash=requestIp(req);
  // Bound both per IP and per account. Respond identically when throttled.
  const ipCount=await q("SELECT COUNT(*)::int AS n FROM service_password_resets WHERE request_ip_hash=$1 AND requested_at>NOW()-INTERVAL '1 hour'",[ipHash]);
  if(ipCount.rows[0].n>=12)return res.json({message:generic});
  const r=await q('SELECT id,username,display_name,active FROM service_users WHERE lower(username)=lower($1) LIMIT 1',[username]);
  const user=r.rows[0],to=recoveryEmail(username);
  if(!user?.active||!to)return res.json({message:generic});
  const count=await q("SELECT COUNT(*)::int AS n FROM service_password_resets WHERE user_id=$1 AND requested_at>NOW()-INTERVAL '1 hour'",[user.id]);
  if(count.rows[0].n>=3)return res.json({message:generic});
  const sender=String(process.env.CRM_FROM_EMAIL||process.env.FULFILLMENT_FROM_EMAIL||'').trim();
  if(!validEmail(sender)){console.error('Password recovery email sender is not configured');return res.json({message:generic})}
  const token=randomBytes(32).toString('hex');
  const inserted=await q("INSERT INTO service_password_resets(user_id,token_hash,expires_at,request_ip_hash) VALUES($1,$2,NOW()+INTERVAL '30 minutes',$3) RETURNING id",[user.id,digest(token),ipHash]);
  const url=RESET_URL+token;
  try{
   await sendCrmEmailWithGmail({from:sender,to,recipient:user.display_name,subject:'HTFO Sales CRM password reset',message:'A password reset was requested for your HTFO Sales CRM account.\\n\\nOpen this link to choose a new password (expires in 30 minutes):\\n'+url+'\\n\\nIf you did not request this, ignore this email. Your existing password remains valid.',replyTo:sender});
  }catch(error){
   await q('UPDATE service_password_resets SET used_at=NOW(),token_hash=NULL WHERE id=$1',[inserted.rows[0].id]);
   console.error('HTFO password recovery delivery failed:',error.message);
  }
 }catch(error){console.error('HTFO password reset request failed:',error.message)}
 return res.json({message:generic});
});
router.post('/auth/reset-password',async(req,res)=>{
 res.set('Cache-Control','no-store');
 const token=String(req.body?.token||'');
 const password=String(req.body?.password||'');
 if(!/^[a-f0-9]{64}$/.test(token))return res.status(400).json({error:'Invalid or expired reset link.'});
 if(password.length<12||password.length>128||!/[A-Z]/.test(password)||!/[a-z]/.test(password)||!/[0-9]/.test(password))
  return res.status(400).json({error:'Use 12–128 characters with uppercase, lowercase, and a number.'});
 try{
  await ensureSchema();
  const hash=digest(token);
  // Lock token before changing the password so that it can only be redeemed once.
  const pg=await import('./service-db.js');
  if(typeof pg.transaction!=='function')throw Error('Database transaction unavailable');
  const passwordHash=await bcrypt.hash(password,12);
  const changed=await pg.transaction(async run=>{
   const row=(await run("SELECT r.id,r.user_id FROM service_password_resets r JOIN service_users u ON u.id=r.user_id WHERE r.token_hash=$1 AND r.used_at IS NULL AND r.expires_at>NOW() AND u.active=true FOR UPDATE OF r",[hash])).rows[0];
   if(!row)return false;
   await run('UPDATE service_users SET password_hash=$1 WHERE id=$2',[passwordHash,row.user_id]);
   await run('UPDATE service_password_resets SET used_at=NOW(),token_hash=NULL WHERE user_id=$1 AND used_at IS NULL',[row.user_id]);
   return true;
  });
  if(!changed)return res.status(410).json({error:'This reset link is expired or has already been used.'});
  return res.json({ok:true,message:'Password changed. Sign in with your new password.'});
 }catch(error){console.error('HTFO password reset failed:',error.message);return res.status(500).json({error:'Unable to reset password. Please try again.'})}
});
export default router;
