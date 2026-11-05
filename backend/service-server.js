import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import path from 'path';
import { fileURLToPath } from 'url';
import serviceRoutes,{ensureBootstrapAdmin} from './service-routes.js';
import partsRoutes from './parts-routes.js';
import financialRoutes from './financial-routes.js';
import fieldRoutes from './field-routes.js';
import paymentMethodRoutes,{initServicePaymentMethods} from './service-payment-methods.js';
import operationsRoutes from './service-operations-routes.js';
import publicServiceRoutes from './public-service-routes.js';
import adminRoutes from './service-admin-routes.js';
import customerValueRoutes,{initServiceCustomerValue} from './service-customer-value.js';
import invoiceItemRoutes,{initServiceInvoiceItems} from './service-invoice-items.js';
import customerOrderControls,{initCustomerOrderControls} from './customer-order-controls.js';
import customerOrderRoutes,{initCustomerOrders} from './customer-orders-routes.js';
import fulfillmentRoutes,{initFulfillment,runFulfillmentAutomation} from './fulfillment-routes.js';
import commercialRulesRoutes,{initServiceCommercialRules} from './service-commercial-rules.js';
import customerImportRoutes,{initServiceCustomerImport} from './service-customer-import-routes.js';
import customerPrivacyRoutes,{initCustomerPrivacy} from './service-customer-privacy-routes.js';
import customerEditRoutes from './service-customer-edit-routes.js';
import equipmentEditRoutes from './service-equipment-edit-routes.js';
import workOrderDetailRoutes from './service-workorder-detail-routes.js';
import {promoteLatestStagedCustomers} from './service-customer-promote.js';
import {initServiceDb,q,transaction} from './service-db.js';
import {initServiceFinancials} from './service-financials.js';
import {initServiceScheduling} from './service-scheduling.js';
import {initServiceTenancy} from './service-tenancy.js';
import {initServiceAudit} from './service-audit.js';
import {initServicePaymentGuard} from './service-payment-guard.js';
import crmRoutes,{syncTwilioMessages} from './crm-routes.js';
import crmV1Routes from './crm-v1-routes.js';
import htfoInventoryPosRoutes from './htfo-inventory-pos-routes.js';
import htfoCommissionPreviewRoutes from './htfo-commission-preview-routes.js';
import htfoDepartmentReportRoutes from './htfo-department-report-routes.js';
import htfoInventoryOperationsRoutes,{ensureInventoryOperations} from './htfo-inventory-operations-routes.js';
import crmHistoryRoutes from './crm-history-routes.js';
import crmSchedulingRoutes,{runCrmScheduledMessages} from './crm-scheduling-routes.js';
import crmEmailInboundRoutes from './crm-email-inbound-routes.js';
import {syncGmailReplies} from './crm-gmail-sync.js';
import crmEmailTrackingRoutes,{ensureEmailTrackingSchema,ensureBrevoEmailTrackingWebhook} from './crm-email-tracking-routes.js';
import serviceMessagingRoutes,{syncServiceTwilioMessages} from './service-messaging-routes.js';
import serviceEmailRoutes,{ensureServiceCustomerEmails} from './service-email-routes.js';
import serviceBillingRoutes from './service-billing-routes.js';
import serviceDepartmentFinancials from './service-department-financials.js';

const app=express();
const port=Number(process.env.PORT||process.env.SERVICE_PORT||8790);
const allowed=(process.env.ALLOWED_ORIGIN||'https://service.hottubfactoryoutlet.com,https://hottubfactoryoutlet.com,https://www.hottubfactoryoutlet.com').split(',').map(x=>x.trim()).filter(Boolean);
const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);
const portalRoot=path.resolve(__dirname,'..');

app.set('trust proxy',1);
app.disable('x-powered-by');
app.use((req,res,next)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  res.setHeader('Cache-Control',req.path.startsWith('/api/')?'no-store':'no-cache');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://accept.authorize.net https://test.authorize.net");
  next();
});
app.use(cors((req,cb)=>{
  const origin=req.get('Origin');
  const ownOrigin=origin&&(()=>{try{return new URL(origin).host===req.get('host')}catch{return false}})();
  cb(null,{origin:!origin||ownOrigin||allowed.includes(origin)});
}));
app.use(express.json({limit:'2mb',verify:(req,res,buf)=>{req.rawBody=buf}}));
app.use(express.urlencoded({extended:false,limit:'256kb'}));

const loginAttempts=new Map();
app.use('/api/service/auth/login',(req,res,next)=>{
  if(req.method!=='POST')return next();
  const key=req.ip||req.socket?.remoteAddress||'unknown';
  const now=Date.now(),windowMs=15*60*1000,maxAttempts=10;
  const recent=(loginAttempts.get(key)||[]).filter(t=>now-t<windowMs);
  if(recent.length>=maxAttempts){
    res.setHeader('Retry-After','900');
    return res.status(429).json({error:'Too many failed login attempts. Try again in 15 minutes.'});
  }
  res.on('finish',()=>{
    if(res.statusCode>=200&&res.statusCode<300)loginAttempts.delete(key);
    else if(res.statusCode===401){recent.push(Date.now());loginAttempts.set(key,recent)}
  });
  next();
});
setInterval(()=>{const cutoff=Date.now()-15*60*1000;for(const [k,v] of loginAttempts){const recent=v.filter(t=>t>cutoff);if(recent.length)loginAttempts.set(k,recent);else loginAttempts.delete(k)}},15*60*1000).unref();

app.get('/health',(req,res)=>res.json({ok:true,servicePortal:true,crm:true,liveWebsiteLeads:true,parts:true,quickSpaParts:true,estimates:true,tripCharges:true,warrantyReceivables:true,dispatchCalendar:true,fieldService:true,fieldPayments:true,cardOnFile:true,paymentAuthorization:true,paymentSchedulingGuard:true,operationsViews:true,publicServiceIntake:true,staffAdmin:true,auditTrail:true,customerValueHistory:true,invoiceLineItems:true,controlledDiscounts:true,customerOrders:true,autoShipManagement:true,orderPricebook:true,presetDiscountCodes:true,roleControlledOrderPricing:true,partsMargin50:true,diagnosticRepairWaiver:true,singleServiceOperationsLocation:true,protectedPortal:true,tenancyFoundation:true,secureCustomerImportStaging:true,customerPrivacyControls:true,customerProfileEditing:true,equipmentProfileEditing:true,workOrderDetailAndDelete:true,fulfillment:true,autoshipFulfillment:true,inventoryReservations:process.env.HTFO_INVENTORY_LIVE_RESERVATIONS==='true',pirateShipExport:true}));
app.get('/ready',async(req,res)=>{try{await q('SELECT 1');res.json({ok:true,database:true})}catch(e){res.status(503).json({ok:false,database:false,error:'Database unavailable'})}});

// Cashier permissions belong to the employee, never the physical workstation.
// Existing service and sales endpoints predate this role and must not be exposed to it.
app.use('/api/service',async(req,res,next)=>{
 const bearer=String(req.get('authorization')||'').match(/^Bearer\s+(.+)$/i);
 if(!bearer)return next();
 try{
  const claims=jwt.verify(bearer[1],process.env.SERVICE_JWT_SECRET);
  const row=(await q('SELECT role,active FROM service_users WHERE id=$1',[claims.sub])).rows[0];
  if(!row||!row.active)return res.status(401).json({error:'Active employee account required'});
  if(['cashier','retail'].includes(String(row.role).toLowerCase())){
   const permitted=req.path==='/auth/me'||req.path.startsWith('/htfo-pos/');
   if(!permitted)return res.status(403).json({error:'Retail cashier accounts cannot access sales leads, service administration or spa agreements'});
  }
  next();
 }catch(e){return res.status(401).json({error:'Session expired or invalid'})}
});
app.use('/api/service',publicServiceRoutes);
app.use('/api/service',commercialRulesRoutes);
app.use('/api/service',customerPrivacyRoutes);
app.use('/api/service',customerEditRoutes);
app.use('/api/service',equipmentEditRoutes);
app.use('/api/service',workOrderDetailRoutes);
app.use('/api/service',serviceRoutes);
app.use('/api/service',partsRoutes);
app.use('/api/service',financialRoutes);
app.use('/api/service',fieldRoutes);
app.use('/api/service',paymentMethodRoutes);
app.use('/api/service',operationsRoutes);
app.use('/api/service',adminRoutes);
app.use('/api/service',customerValueRoutes);
app.use('/api/service',invoiceItemRoutes);
app.use('/api/service',customerOrderControls);
app.use('/api/service',customerOrderRoutes);
app.use('/api/service',fulfillmentRoutes);
app.use('/api/service',customerImportRoutes);
app.use('/api/service',crmRoutes);
app.use('/api/service',crmV1Routes);
app.use('/api/service/htfo-pos',htfoInventoryPosRoutes);
app.use('/api/service',htfoCommissionPreviewRoutes);
app.use('/api/service',htfoDepartmentReportRoutes);
app.use('/api/service/htfo-inventory',htfoInventoryOperationsRoutes);
app.use('/api/service',crmHistoryRoutes);
app.use('/api/service',crmSchedulingRoutes);
app.use('/api/service',crmEmailInboundRoutes);
app.use('/api/service',crmEmailTrackingRoutes);
app.use('/api/service',serviceMessagingRoutes);
app.use('/api/service',serviceEmailRoutes);
app.use('/api/service',serviceBillingRoutes);
app.use('/api/service',serviceDepartmentFinancials);

const portalAssets=new Set([
  'service-portal.css','service-portal.js','htfo-retail-pos.js','htfo-retail-pos.css','htfo-inventory-admin.js','service-customer-click-fix.js','service-customer-profile-view.js','service-payment-ui.js','service-customer-value-ui.js','service-quickspa-ui.js',
  'service-operations-ui.js','service-invoice-items-ui.js','customer-orders-ui.js','service-admin-ui.js','service-customer-import-ui.js','service-customer-edit-ui.js','service-workorder-detail-ui.js',
  'service-field.css','service-field.js','service-field-manifest.webmanifest','order-payment.html','order-payment.js','fulfillment-ui.js','service-calendar-hotfix.js'
]);
app.get('/retail-pos',(req,res)=>res.sendFile(path.join(portalRoot,'htfo-retail-pos.html')));
app.get(['/', '/service-portal.html'],(req,res)=>res.sendFile(path.join(portalRoot,'service-portal.html')));
app.get('/field',(req,res)=>res.sendFile(path.join(portalRoot,'service-field.html')));
app.get('/:asset',(req,res,next)=>{
  if(!portalAssets.has(req.params.asset))return next();
  res.sendFile(path.join(portalRoot,req.params.asset));
});
app.use((req,res)=>res.status(404).send('Not found'));

try{
  await initServiceDb();
  await initServiceFinancials();
  await initCustomerOrders();
  await initFulfillment();
  await initServiceScheduling();
  await initServiceTenancy();
  await initServicePaymentMethods();
  await initServicePaymentGuard();
  await initServiceCustomerValue();
  await initServiceInvoiceItems();
  await initCustomerOrderControls();
  await initServiceCommercialRules();
  await initServiceAudit();
  await initServiceCustomerImport();
  await initCustomerPrivacy();
  await ensureServiceCustomerEmails();
  await ensureEmailTrackingSchema();
  await ensureBootstrapAdmin();
  await ensureInventoryOperations().then(()=>console.log('HTFO inventory schema checked')).catch(e=>console.error('HTFO inventory schema needs attention:',e));
  await q("UPDATE service_users SET role='technician' WHERE active=true AND (lower(username)='bill' OR lower(display_name)='bill' OR lower(display_name) LIKE 'bill %')");
  await runFulfillmentAutomation();
  await runCrmScheduledMessages();
  await syncTwilioMessages(3,500).catch(e=>console.error('Initial Twilio CRM sync error:',e));
  await syncServiceTwilioMessages(7,500).catch(e=>console.error('Initial service Twilio sync error:',e));
  await ensureBrevoEmailTrackingWebhook().catch(e=>console.error('Brevo tracking webhook setup error:',e));
  await promoteLatestStagedCustomers();
  app.listen(port,()=>{
    console.log(`HTFO service backend listening on ${port}`);
    // One-time retail catalog reconciliation. Existing part records are kept intact.
    (async()=>{
      const catalogVersion="2026-11-05-life-sku-reconciled";
      const products=[{"sku":"CHSE200","name":"Purifier Mineral Sticks","category":"Spa Care","price_cents":3999,"aliases":[]},{"sku":"CHSE101","name":"Chlorinating Granules \u00b7 2 lb","category":"Spa Care","price_cents":3199,"aliases":[]},{"sku":"CHSE201","name":"Chlorinating Granules \u00b7 1 lb","category":"Spa Care","price_cents":1849,"aliases":[]},{"sku":"CHSE102","name":"Brom Bank \u00b7 32 oz","category":"Spa Care","price_cents":2299,"aliases":[]},{"sku":"CHSE103","name":"Brominating Tablets \u00b7 1.5 lb","category":"Spa Care","price_cents":3299,"aliases":[]},{"sku":"CHSE202","name":"Sodium Bromide Packet \u00b7 2 oz","category":"Spa Care","price_cents":499,"aliases":[]},{"sku":"CHSE104","name":"Spa Activator \u00b7 2 lb","category":"Spa Care","price_cents":2199,"aliases":[]},{"sku":"CHSE204","name":"Spa Activator \u00b7 1 lb","category":"Spa Care","price_cents":1399,"aliases":[]},{"sku":"CHSE119","name":"Oxy Blast \u00b7 2 lb","category":"Spa Care","price_cents":2299,"aliases":[]},{"sku":"CHSE105","name":"pH / Alkalinity Up \u00b7 2 lb","category":"Spa Care","price_cents":1099,"aliases":[]},{"sku":"CHSE205","name":"pH / Alkalinity Up \u00b7 1 lb","category":"Spa Care","price_cents":799,"aliases":[]},{"sku":"CHSE106","name":"pH / Alkalinity Down \u00b7 1.5 lb","category":"Spa Care","price_cents":899,"aliases":[]},{"sku":"CHSE107","name":"Protection Plus \u00b7 1 qt","category":"Spa Care","price_cents":1599,"aliases":[]},{"sku":"CHSE120","name":"pH Hold & H2O Softener","category":"Spa Care","price_cents":1499,"aliases":[]},{"sku":"CHSE108","name":"Stain & Scale \u00b7 1 pt","category":"Spa Care","price_cents":1099,"aliases":[]},{"sku":"CHSE109","name":"Natural & Clear \u00b7 1 qt","category":"Spa Care","price_cents":1599,"aliases":[]},{"sku":"CHSE110","name":"Spa Foam Away \u00b7 1 qt","category":"Spa Care","price_cents":1799,"aliases":[]},{"sku":"CHSE111","name":"Liquid Calcium \u00b7 1 qt","category":"Spa Care","price_cents":1299,"aliases":[]},{"sku":"CHSE112","name":"All Purpose Cleaner \u00b7 1 qt","category":"Spa Care","price_cents":1699,"aliases":[]},{"sku":"CHSE114","name":"Filter Cleaner \u00b7 1 qt","category":"Spa Care","price_cents":1699,"aliases":[]},{"sku":"CHSE115","name":"Instant Cartridge Cleaner \u00b7 1 qt","category":"Spa Care","price_cents":1799,"aliases":[]},{"sku":"CHSE116","name":"Jet Line Cleaner \u00b7 1 pt","category":"Spa Care","price_cents":1499,"aliases":[]},{"sku":"CHSE117","name":"Cover Conditioner \u00b7 1 pt","category":"Spa Care","price_cents":1599,"aliases":[]},{"sku":"TSLM109","name":"Insta-TEST 4 Plus \u00b7 50","category":"Spa Care","price_cents":999,"aliases":[]},{"sku":"TSLM111","name":"Salt Test Strips \u00b7 12","category":"Spa Care","price_cents":1099,"aliases":[]},{"sku":"ACSP101","name":"Floating Bromine Dispenser","category":"Accessories","price_cents":999,"aliases":[]},{"sku":"ACSP102","name":"Ultra Mitt","category":"Accessories","price_cents":1799,"aliases":[]},{"sku":"ACSP104","name":"Cover Wipes","category":"Accessories","price_cents":1999,"aliases":[]},{"sku":"ACFL105","name":"NucLear Cartridge Cleaner","category":"Accessories","price_cents":3499,"aliases":[]},{"sku":"ACFL106","name":"Filter Flosser","category":"Accessories","price_cents":4999,"aliases":[]},{"sku":"ACSP108","name":"Paradise Spa Vac","category":"Accessories","price_cents":10999,"aliases":[]},{"sku":"ACSP113","name":"Waterproof Playing Cards","category":"Accessories","price_cents":1699,"aliases":[]},{"sku":"ACSP114","name":"Cool Duck","category":"Accessories","price_cents":1199,"aliases":[]},{"sku":"ACSP115","name":"LED Light Up Pals","category":"Accessories","price_cents":1499,"aliases":[]},{"sku":"ACSP116","name":"Duck Thermometer","category":"Accessories","price_cents":1999,"aliases":[]},{"sku":"ACSP117","name":"Shark Thermometer","category":"Accessories","price_cents":1999,"aliases":[]},{"sku":"ACSP123","name":"Floating Wireless Speaker & Light Show","category":"Accessories","price_cents":15999,"aliases":[]},{"sku":"ACSP124","name":"Life Spa Booster Seat","category":"Accessories","price_cents":2999,"aliases":[]},{"sku":"ACSP125","name":"Sun Sorb","category":"Accessories","price_cents":1699,"aliases":[]},{"sku":"ACFL126","name":"Filter Saver Basket Liner","category":"Accessories","price_cents":999,"aliases":[]},{"sku":"LFSE050","name":"Cover Roller","category":"Accessories","price_cents":6900,"aliases":[]},{"sku":"LFSE100","name":"SpaEase 100","category":"Accessories","price_cents":15900,"aliases":[]},{"sku":"LFSE150","name":"SpaEase 150","category":"Accessories","price_cents":19900,"aliases":[]},{"sku":"LFSE175","name":"SpaEase 175","category":"Accessories","price_cents":22900,"aliases":[]},{"sku":"LFSE200","name":"SpaEase 200","category":"Accessories","price_cents":34900,"aliases":[]},{"sku":"CLP100HT","name":"ConvertALift","category":"Accessories","price_cents":179500,"aliases":[]},{"sku":"STCS101","name":"Classic 2-Tier Step","category":"Accessories","price_cents":9900,"aliases":[]},{"sku":"STDS201G","name":"Designer Step","category":"Accessories","price_cents":16900,"aliases":[]},{"sku":"RASM102","name":"Side-Mount Rail","category":"Accessories","price_cents":19900,"aliases":[]},{"sku":"RADM054","name":"Deck-Mount Rail","category":"Accessories","price_cents":25900,"aliases":[]},{"sku":"RAUM054","name":"Under-Mount Rail","category":"Accessories","price_cents":29900,"aliases":[]},{"sku":"STDSDRW","name":"Designer Step Drawers","category":"Accessories","price_cents":5900,"aliases":[]},{"sku":"FRSZ101-6","name":"SpaZazz Original Elizer \u00b7 9 oz","category":"Accessories","price_cents":1399,"aliases":[]},{"sku":"FRSZ107-10","name":"SpaZazz Escape Crystals \u00b7 22 oz","category":"Accessories","price_cents":1899,"aliases":[]},{"sku":"FRSZ111-12","name":"SpaZazz Set The Mood \u00b7 22 oz","category":"Accessories","price_cents":1799,"aliases":[]},{"sku":"01-14-3256","name":"FROG @ease Floating System \u00b7 Hot Tubs","category":"FROG @ease","price_cents":5799,"aliases":[]},{"sku":"01-14-3258","name":"FROG @ease SmartChlor Refills \u00b7 3 Pack","category":"FROG @ease","price_cents":5799,"aliases":[]},{"sku":"01-14-3288","name":"FROG @ease Floating System \u00b7 Swim Spas","category":"FROG @ease","price_cents":13499,"aliases":["FROG-SS-SYSTEM"]},{"sku":"01-14-3284","name":"FROG @ease SmartChlor Refill \u00b7 Swim Spa","category":"FROG @ease","price_cents":4699,"aliases":[]},{"sku":"TSAC103","name":"Total Hardness Test Strips","category":"Accessories","price_cents":1799,"aliases":[]},{"sku":"TSAC104","name":"TDS Test Strips","category":"Accessories","price_cents":1799,"aliases":[]},{"sku":"VSL400","name":"VacuSeal 400 Cover Lifter","category":"Accessories","price_cents":59900,"aliases":[]},{"sku":"VSLA201","name":"VacuSeal 200 \u2192 400 Conversion Kit","category":"Accessories","price_cents":24900,"aliases":[]},{"sku":"CLP100SS","name":"Swim Spa ConvertALift","category":"Accessories","price_cents":279500,"aliases":[]},{"sku":"CLP100SS-UG","name":"Hot Tub \u2192 Swim Spa ConvertALift Upgrade","category":"Accessories","price_cents":129900,"aliases":[]},{"sku":"RADM036","name":"Deck-Mount Rail \u00b7 up to 22 in","category":"Accessories","price_cents":18900,"aliases":[]},{"sku":"LCH-50-4035","name":"1 pt pH Up Liquid","category":"LIFE Spa Care","price_cents":982,"aliases":["life-ph-up-liquid"]},{"sku":"LCH-50-1005","name":"5 lb Brominating Tabs","category":"LIFE Spa Care","price_cents":12992,"aliases":["life-brom-tabs-5"]},{"sku":"LCH-50-5090","name":"1 pt Waterline & Surface Cleaner","category":"LIFE Spa Care","price_cents":1062,"aliases":["life-waterline-cleaner"]},{"sku":"LCH-50-5011","name":"1 pt Scale Defense","category":"LIFE Spa Care","price_cents":1058,"aliases":["life-scale-defense"]},{"sku":"LCH-50-5070","name":"1 pt Cover Cleaner & Conditioner","category":"LIFE Spa Care","price_cents":2818,"aliases":["life-cover-cleaner"]},{"sku":"LCH-50-5030","name":"1 pt Scum Free","category":"LIFE Spa Care","price_cents":1084,"aliases":["life-scum-free"]},{"sku":"LCH-50-0030","name":"Fresh Start Spa Maintenance Kit","category":"LIFE Spa Care","price_cents":6564,"aliases":["life-fresh-start"]},{"sku":"LCH-50-5005","name":"2 lbs SpaSoft","category":"LIFE Spa Care","price_cents":2076,"aliases":["life-spasoft"]},{"sku":"LCH-50-2005","name":"5 lb Chlorinating Granules","category":"LIFE Spa Care","price_cents":8390,"aliases":["life-chlor-5"]},{"sku":"LCH-50-5040","name":"1 pt Foam Free","category":"LIFE Spa Care","price_cents":1084,"aliases":["life-foam-free"]},{"sku":"LCH-50-5010","name":"1 pt Metal Out","category":"LIFE Spa Care","price_cents":980,"aliases":["life-metal-out"]},{"sku":"LCH-50-5080","name":"1 pt Filter Cleaner with Sprayer","category":"LIFE Spa Care","price_cents":1446,"aliases":["life-filter-cleaner"]},{"sku":"LCH-50-3005","name":"5 lb Oxidizing Shock","category":"LIFE Spa Care","price_cents":6094,"aliases":["life-oxidizer-5"]},{"sku":"LCH-50-4030","name":"1 lb Alkalinity & pH Up","category":"LIFE Spa Care","price_cents":854,"aliases":["life-alk-up"]},{"sku":"LCH-50-4010","name":"14 oz Calcium Booster","category":"LIFE Spa Care","price_cents":740,"aliases":["life-calcium"]},{"sku":"LCH-50-1015","name":"1.5 lb Brominating Tabs","category":"LIFE Spa Care","price_cents":4228,"aliases":["life-brom-tabs-15"]},{"sku":"LCH-50-5020","name":"1 pt Natural Clarifier","category":"LIFE Spa Care","price_cents":858,"aliases":["life-clarifier"]},{"sku":"LCH-50-3015","name":"1.5 lb Oxidizing Shock","category":"LIFE Spa Care","price_cents":1838,"aliases":["life-oxidizer-15"]},{"sku":"LCH-50-2002","name":"2 lb Chlorinating Granules","category":"LIFE Spa Care","price_cents":3292,"aliases":["life-chlor-2"]},{"sku":"LCH-50-4020","name":"1.5 lb Alkalinity & pH Down","category":"LIFE Spa Care","price_cents":1040,"aliases":["life-alk-down"]},{"sku":"LCH-50-5060","name":"1 pt Purge & Jet Line Cleaner","category":"LIFE Spa Care","price_cents":1266,"aliases":["life-jet-cleaner"]}];
      const result=await transaction(async run=>{
        await run('LOCK TABLE service_parts IN SHARE ROW EXCLUSIVE MODE');
        const {rows:[summary]}=await run(`WITH catalog AS (
          SELECT * FROM jsonb_to_recordset($1::jsonb) AS c(sku text,name text,category text,price_cents int,aliases jsonb)
        ), inserted AS (
          INSERT INTO service_parts(supplier_part_number,description,category,sell_price,source_updated_at)
          SELECT c.sku,c.name,c.category,c.price_cents::numeric/100,NOW() FROM catalog c
          WHERE NOT EXISTS(SELECT 1 FROM service_parts p WHERE lower(c.sku) IN
            (lower(trim(p.supplier_part_number)),lower(trim(p.manufacturer_part_number)),lower(trim(p.barcode)))
            OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(c.aliases) alias(sku) WHERE lower(alias.sku) IN
              (lower(trim(p.supplier_part_number)),lower(trim(p.manufacturer_part_number)),lower(trim(p.barcode)))))
          RETURNING id
        ) SELECT count(*)::int inserted FROM inserted`,[JSON.stringify(products)]);
        const {rows:[checks]}=await run(`WITH catalog AS (
          SELECT * FROM jsonb_to_recordset($1::jsonb) AS c(sku text,price_cents int)
        ), audit AS (
          SELECT c.sku,c.price_cents,count(p.id) AS matches,max(round(coalesce(nullif(p.sell_price,0),p.list_price,0)*100)) AS stored,
          max(p.quantity_on_hand) AS stock,max(p.cost) AS cost
          FROM catalog c LEFT JOIN service_parts p ON p.active AND lower(trim(p.supplier_part_number))=lower(c.sku)
          GROUP BY c.sku,c.price_cents
        ) SELECT count(*) FILTER(WHERE matches=1)::int matched,
          count(*) FILTER(WHERE matches=1 AND stored=price_cents)::int price_matches,
          count(*) FILTER(WHERE matches=0)::int missing,
          count(*) FILTER(WHERE matches>1)::int ambiguous,
          count(*) FILTER(WHERE matches=1 AND stock=0)::int zero_stock,
          count(*) FILTER(WHERE matches=1 AND cost=0)::int cost_not_entered FROM audit`,[JSON.stringify(products)]);
        return {...summary,...checks};
      });
      console.log('HTFO_CATALOG_RECONCILED '+JSON.stringify({version:catalogVersion,...result}));
    })().catch(error=>console.error('HTFO_CATALOG_RECONCILE_ERROR '+error.message));
    syncGmailReplies(Number(process.env.GMAIL_SYNC_DAYS||30),150).then(r=>console.log('Initial Gmail reply sync:',r)).catch(e=>console.error('Initial Gmail reply sync error:',e));
  });
  setInterval(()=>runFulfillmentAutomation().catch(e=>console.error('Fulfillment automation error:',e)),60*60*1000).unref();
  setInterval(()=>runCrmScheduledMessages().catch(e=>console.error('CRM scheduled-message error:',e)),60*1000).unref();
  setInterval(()=>syncTwilioMessages(3,500).catch(e=>console.error('Twilio CRM sync error:',e)),60*1000).unref();
  setInterval(()=>syncServiceTwilioMessages(7,500).catch(e=>console.error('Service Twilio sync error:',e)),60*1000).unref();
  setInterval(()=>syncGmailReplies(Number(process.env.GMAIL_SYNC_DAYS||30),150).then(r=>{if(r.saved_sales||r.saved_service||r.errors?.length)console.log('Gmail reply sync:',r)}).catch(e=>console.error('Gmail reply sync error:',e)),2*60*1000).unref();
}catch(err){
  console.error('Unable to start HTFO service backend:',err);
  process.exit(1);
}
