import 'dotenv/config';
import express from 'express';
import cors from 'cors';
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
import commercialRulesRoutes,{initServiceCommercialRules} from './service-commercial-rules.js';
import customerImportRoutes,{initServiceCustomerImport} from './service-customer-import-routes.js';
import customerPrivacyRoutes,{initCustomerPrivacy} from './service-customer-privacy-routes.js';
import customerEditRoutes from './service-customer-edit-routes.js';
import {promoteLatestStagedCustomers} from './service-customer-promote.js';
import {initServiceDb,q} from './service-db.js';
import {initServiceFinancials} from './service-financials.js';
import {initServiceScheduling} from './service-scheduling.js';
import {initServiceTenancy} from './service-tenancy.js';
import {initServiceAudit} from './service-audit.js';
import {initServicePaymentGuard} from './service-payment-guard.js';

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
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  next();
});
app.use(cors({origin:(o,cb)=>!o||allowed.includes(o)?cb(null,true):cb(new Error('Origin not allowed'))}));
app.use(express.json({limit:'2mb'}));

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

app.get('/health',(req,res)=>res.json({ok:true,servicePortal:true,parts:true,estimates:true,tripCharges:true,warrantyReceivables:true,dispatchCalendar:true,fieldService:true,fieldPayments:true,cardOnFile:true,paymentAuthorization:true,paymentSchedulingGuard:true,operationsViews:true,publicServiceIntake:true,staffAdmin:true,auditTrail:true,customerValueHistory:true,invoiceLineItems:true,controlledDiscounts:true,customerOrders:true,autoShipManagement:true,orderPricebook:true,presetDiscountCodes:true,roleControlledOrderPricing:true,partsMargin50:true,diagnosticRepairWaiver:true,singleServiceOperationsLocation:true,protectedPortal:true,tenancyFoundation:true,secureCustomerImportStaging:true,customerPrivacyControls:true,customerProfileEditing:true}));
app.get('/ready',async(req,res)=>{try{await q('SELECT 1');res.json({ok:true,database:true})}catch(e){res.status(503).json({ok:false,database:false,error:'Database unavailable'})}});

app.use('/api/service',publicServiceRoutes);
app.use('/api/service',commercialRulesRoutes);
app.use('/api/service',customerPrivacyRoutes);
app.use('/api/service',customerEditRoutes);
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
app.use('/api/service',customerImportRoutes);

const portalAssets=new Set([
  'service-portal.css','service-portal.js','service-payment-ui.js','service-customer-value-ui.js',
  'service-operations-ui.js','service-invoice-items-ui.js','customer-orders-ui.js','service-admin-ui.js','service-customer-import-ui.js','service-customer-edit-ui.js',
  'service-field.css','service-field.js','service-field-manifest.webmanifest'
]);
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
  await initServiceScheduling();
  await initServiceTenancy();
  await initServicePaymentMethods();
  await initServicePaymentGuard();
  await initServiceCustomerValue();
  await initServiceInvoiceItems();
  await initCustomerOrders();
  await initCustomerOrderControls();
  await initServiceCommercialRules();
  await initServiceAudit();
  await initServiceCustomerImport();
  await initCustomerPrivacy();
  await ensureBootstrapAdmin();
  await promoteLatestStagedCustomers();
  app.listen(port,()=>console.log(`HTFO service backend listening on ${port}`));
}catch(err){
  console.error('Unable to start HTFO service backend:',err);
  process.exit(1);
}
