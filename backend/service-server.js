import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import serviceRoutes,{ensureBootstrapAdmin} from './service-routes.js';
import partsRoutes from './parts-routes.js';
import {initServiceDb} from './service-db.js';

const app=express();
const port=Number(process.env.SERVICE_PORT||8790);
const allowed=(process.env.ALLOWED_ORIGIN||'https://rayjmorrow.github.io,https://hottubfactoryoutlet.com,https://www.hottubfactoryoutlet.com').split(',').map(x=>x.trim());
app.use(cors({origin:(o,cb)=>!o||allowed.includes(o)?cb(null,true):cb(new Error('Origin not allowed'))}));
app.use(express.json({limit:'2mb'}));
app.get('/health',(req,res)=>res.json({ok:true,servicePortal:true,parts:true,estimates:true}));
app.use('/api/service',serviceRoutes);
app.use('/api/service',partsRoutes);

try{
  await initServiceDb();
  await ensureBootstrapAdmin();
  app.listen(port,()=>console.log(`HTFO service backend listening on ${port}`));
}catch(err){
  console.error('Unable to start HTFO service backend:',err);
  process.exit(1);
}
