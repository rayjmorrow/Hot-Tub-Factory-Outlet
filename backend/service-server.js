import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import serviceRoutes,{ensureBootstrapAdmin} from './service-routes.js';
import partsRoutes from './parts-routes.js';
import financialRoutes from './financial-routes.js';
import fieldRoutes from './field-routes.js';
import paymentMethodRoutes,{initServicePaymentMethods} from './service-payment-methods.js';
import operationsRoutes from './service-operations-routes.js';
import publicServiceRoutes from './public-service-routes.js';
import adminRoutes from './service-admin-routes.js';
import customerValueRoutes,{initServiceCustomerValue} from './service-customer-value.js';
import {initServiceDb,q} from './service-db.js';
import {initServiceFinancials} from './service-financials.js';
import {initServiceScheduling} from './service-scheduling.js';
import {initServiceTenancy} from './service-tenancy.js';
import {initServiceAudit} from './service-audit.js';
import {initServicePaymentGuard} from './service-payment-guard.js';

const app=express();
const port=Number(process.env.SERVICE_PORT||8790);
const allowed=(process.env.ALLOWED_ORIGIN||'https://rayjmorrow.github.io,https://hottubfactoryoutlet.com,https://www.hottubfactoryoutlet.com').split(',').map(x=>x.trim());
app.use(cors({origin:(o,cb)=>!o||allowed.includes(o)?cb(null,true):cb(new Error('Origin not allowed'))}));
app.use(express.json({limit:'2mb'}));
app.get('/health',(req,res)=>res.json({ok:true,servicePortal:true,parts:true,estimates:true,tripCharges:true,warrantyReceivables:true,dispatchCalendar:true,fieldService:true,fieldPayments:true,cardOnFile:true,paymentAuthorization:true,paymentSchedulingGuard:true,operationsViews:true,publicServiceIntake:true,staffAdmin:true,auditTrail:true,customerValueHistory:true,tenancyFoundation:true}));
app.get('/ready',async(req,res)=>{try{await q('SELECT 1');res.json({ok:true,database:true})}catch(e){res.status(503).json({ok:false,database:false,error:'Database unavailable'})}});
app.use('/api/service',publicServiceRoutes);
app.use('/api/service',serviceRoutes);
app.use('/api/service',partsRoutes);
app.use('/api/service',financialRoutes);
app.use('/api/service',fieldRoutes);
app.use('/api/service',paymentMethodRoutes);
app.use('/api/service',operationsRoutes);
app.use('/api/service',adminRoutes);
app.use('/api/service',customerValueRoutes);

try{
  await initServiceDb();
  await initServiceFinancials();
  await initServiceScheduling();
  await initServiceTenancy();
  await initServicePaymentMethods();
  await initServicePaymentGuard();
  await initServiceCustomerValue();
  await initServiceAudit();
  await ensureBootstrapAdmin();
  app.listen(port,()=>console.log(`HTFO service backend listening on ${port}`));
}catch(err){
  console.error('Unable to start HTFO service backend:',err);
  process.exit(1);
}