import express from 'express';
import jwt from 'jsonwebtoken';
import { q } from './service-db.js';

const router = express.Router();
function authorize(req,res,next){
  try {
    const token = String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
    const user=jwt.verify(token,process.env.SERVICE_JWT_SECRET);
    if(!['admin','owner','manager','service_manager','sales'].includes(String(user.role||'').toLowerCase())) return res.status(403).json({error:'Sales access required'});
    req.user=user; next();
  } catch { res.status(401).json({error:'Login required'}); }
}
// Reports are read-only and never infer showroom visits from a later pipeline stage.
router.get('/crm/v1/reports/marketing',authorize,async(req,res)=>{
 try {
  const days=Math.max(1,Math.min(365,Number.parseInt(req.query.days,10)||30));
  const showroom=String(req.query.showroom||'all');
  if(!['all','Monroeville','Wexford'].includes(showroom))return res.status(400).json({error:'Invalid showroom'});
  const params=[days,showroom];
  const scope="l.deleted_at IS NULL AND l.received_at >= NOW()-($1 * INTERVAL '1 day') AND ($2='all' OR l.showroom=$2)";
  const leadRows=(await q(`SELECT l.submission_id,l.source,l.showroom,l.pipeline_stage,l.has_opportunity,
    l.email,l.phone,l.ghl_contact_id,l.received_at
    FROM crm_website_leads l WHERE ${scope}`,params)).rows;
  // A lead is a unique CRM submission. Duplicates are flagged, not silently merged:
  // spouses, repeat buyers, and separate purchases can legitimately share contact details.
  const keyCount=new Map();
  for(const l of leadRows){
   const email=String(l.email||'').trim().toLowerCase();
   const phone=String(l.phone||'').replace(/\D/g,'');
   const key=l.ghl_contact_id?'ghl:'+l.ghl_contact_id:email?'email:'+email:phone.length>=10?'phone:'+phone:null;
   if(key)keyCount.set(key,(keyCount.get(key)||0)+1);
  }
  const knownDuplicateGroups=[...keyCount.values()].filter(n=>n>1).length;
  const grouped=new Map();
  for(const l of leadRows){
   const source=String(l.source||'Unknown').trim()||'Unknown';
   const entry=grouped.get(source)||{source,leads:0,won_opportunities:0};
   entry.leads++;
   if(l.pipeline_stage==='Won')entry.won_opportunities++;
   grouped.set(source,entry);
  }
  // Executed agreements, not pipeline stages, are the source of actual sales.
  // Values inside executed_document are stored in cents.
  const signed=(await q(`SELECT e.id,e.submission_id,e.executed_at,e.executed_document,
    l.source,l.showroom,l.received_at
    FROM crm_sales_executed_contracts e
    LEFT JOIN crm_website_leads l ON l.submission_id=e.submission_id
    WHERE e.executed_at >= NOW()-($1 * INTERVAL '1 day')
      AND ($2='all' OR l.showroom=$2)`,params)).rows;
  let revenueCents=0,attributedSales=0,unattributedSales=0;
  const bySource=new Map();
  for(const e of signed){
   const d=e.executed_document||{};
   const amount=Number(d.total);
   if(Number.isSafeInteger(amount)&&amount>=0) revenueCents+=amount;
   const source=String(e.source||'Unattributed').trim()||'Unattributed';
   const row=bySource.get(source)||{source,signed_sales:0,revenue:0};
   row.signed_sales++;
   if(Number.isSafeInteger(amount)&&amount>=0)row.revenue+=amount/100;
   bySource.set(source,row);
   if(e.submission_id&&e.source)attributedSales++;else unattributedSales++;
  }
  res.json({
   days,showroom,
   lead_definition:'Distinct CRM submission IDs created within period; historical duplicates are flagged, not merged',
   leads:leadRows.length,
   possible_duplicate_contact_groups:knownDuplicateGroups,
   current_stage_counts:{
    appointment_set:leadRows.filter(x=>x.pipeline_stage==='Appointment Set').length,
    showroom_visit:leadRows.filter(x=>x.pipeline_stage==='Showroom Visit').length,
    quoted:leadRows.filter(x=>x.pipeline_stage==='Quoted').length,
    won:leadRows.filter(x=>x.pipeline_stage==='Won').length
   },
   showroom_visits_historical:null,
   showroom_visits_note:'Historical showroom visits cannot be reconstructed reliably from current stage alone.',
   signed_agreements:signed.length,
   signed_agreement_revenue:revenueCents/100,
   attributed_signed_sales:attributedSales,
   unattributed_signed_sales:unattributedSales,
   lead_sources:[...grouped.values()].sort((a,b)=>b.leads-a.leads),
   signed_sales_by_source:[...bySource.values()].sort((a,b)=>b.signed_sales-a.signed_sales),
   ad_spend:null,ad_cost_per_sale:null,
   spend_note:'Advertising spend is not yet linked; no ROI or cost-per-sale figures are fabricated.'
  });
 } catch(e) {
  if(e.code==='42P01')return res.status(409).json({error:'Sales contract or CRM table not initialized; complete contract setup before enabling this report'});
  console.error('marketing report error',e);res.status(500).json({error:'Marketing report unavailable'});
 }
});
export default router;
