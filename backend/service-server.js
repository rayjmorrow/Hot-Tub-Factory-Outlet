import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import serviceRoutes,{ensureBootstrapAdmin} from './service-routes.js';
import partsRoutes from './parts-routes.js';
import financialRoutes from './financial-routes.js';
import fieldRoutes from './field-routes.js';
import {initServiceDb} from './service-db.js';
import {initServiceFinancials} from './service-financials.js';
import {initServiceScheduling} from './service-scheduling.js';

const app=express();
const port=Number(process.env.SERVICE_PORT||8790);
const allowed=(process.env.ALLOWED_ORIGIN||'https://rayjmorrow.github.io,https://hottubfactoryoutlet.com,https://www.hottubfactoryoutlet.com').split(',').map(x=>x.trim());
app.use(cors({origin:(o,cb)=>!o||allowed.includes(o)?cb(null,true):cb(new Error('Origin not allowed'))}));
app.use(express.json({limit:'2mb'}));
app.get('/health',(req,res)=>res.json({ok:true,servicePortal:true,parts:true,estimates:true,tripCharges:true,warrantyReceivables:true,dispatchCalendar:true,fieldService:true,fieldPayments:true}));
app.use('/api/service',serviceRoutes);
app.use('/api/service',partsRoutes);
app.use('/api/service',financialRoutes);
app.use('/api/service',fieldRoutes);

try{
  await initServiceDb();
  await initServiceFinancials();
  await initServiceScheduling();
  await ensureBootstrapAdmin();
  app.listen(port,()=>console.log(`HTFO service backend listening on ${port}`));
}catch(err){
  console.error('Unable to start HTFO service backend:',err);
  process.exit(1);
}
