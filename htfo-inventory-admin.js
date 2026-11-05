// Manager-only inventory tools; all writes validated by the Operations API.
(()=>{
 const ROOT='/api/service/htfo-inventory';
 const $=s=>document.querySelector(s);
 const status=message=>{$('#inventoryAdminStatus').textContent=String(message)};
 const put=(path,data,method='POST')=>request(ROOT+path,{method,body:JSON.stringify(data)});
 function val(form){return Object.fromEntries(new FormData(form))}
 function dollars(v){const n=Math.round(Number(v)*100);if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid amount');return n}
 function setProducts(){for(const id of ['adjustSku','allocateSku','transferSku','poSku']){const field=$('#'+id);field.replaceChildren();for(const p of skus){const o=document.createElement('option');o.value=p.id;o.textContent=p.sku+' · '+p.name;field.append(o)}}}
 async function loadConfig(){try{
  setProducts();
  const [settings,low,suppliers]=await Promise.all([request(ROOT+'/settings'),request(ROOT+'/low-stock'),request(ROOT+'/suppliers')]);
  $('#htfoTaxRate').value=Number(settings.tax_rate_bps)/100;
  showLow(low);renderSuppliers(suppliers);
 }catch(e){status(e.message)}}
 document.querySelector('[data-tab="receiving"]').addEventListener('click',loadConfig);
 $('#taxSettingsForm').onsubmit=async e=>{e.preventDefault();try{const n=Math.round(Number($('#htfoTaxRate').value)*100);await put('/settings',{tax_rate_bps:n},'PUT');status('Tax rate saved: '+(n/100).toFixed(2)+'%')}catch(e){status(e.message)}};
 $('#adjustPartForm').onsubmit=async e=>{e.preventDefault();const x=val(e.target);if(!confirm('Record manager inventory correction: '+x.delta+' units at '+x.location+'?'))return;try{await put('/parts/'+x.part_id+'/adjust',{location:x.location,delta:Number(x.delta),reason:x.reason});status('Inventory correction recorded with audit entry');await refresh();setProducts()}catch(e){status(e.message)}};
 $('#allocateExistingForm').onsubmit=async e=>{e.preventDefault();const x=val(e.target);try{const r=await put('/parts/'+x.part_id+'/allocate-existing',{location:x.location,quantity:Number(x.quantity),reason:x.reason});status('Assigned '+r.quantity+' existing units to '+r.location+' without changing total inventory');await refresh();setProducts()}catch(err){status(err.message)}};
 $('#transferPartForm').onsubmit=async e=>{e.preventDefault();const x=val(e.target);if(!confirm('Transfer '+x.quantity+' units from '+x.from+' to '+x.to+'?'))return;try{await put('/parts/'+x.part_id+'/transfer',{from:x.from,to:x.to,quantity:Number(x.quantity)});status('Transfer completed and audited');await refresh();setProducts()}catch(e){status(e.message)}};
 function showLow(rows){const el=$('#lowStockList');el.replaceChildren();if(!rows.length){el.textContent='No products below reorder threshold';return}
  for(const r of rows.slice(0,100)){const p=document.createElement('p');p.textContent=(r.sku||r.id)+' · '+r.description+' | available '+r.available+' | reorder at '+r.reorder_point;el.append(p)}}
 $('#refreshLowStock').onclick=async()=>{try{showLow(await request(ROOT+'/low-stock'))}catch(e){status(e.message)}};
 function renderSuppliers(rows){const field=$('#poSupplier');field.replaceChildren();for(const s of rows){const o=document.createElement('option');o.value=s.id;o.textContent=s.name;field.append(o)}}
 $('#supplierForm').onsubmit=async e=>{e.preventDefault();try{await put('/suppliers',val(e.target));renderSuppliers(await request(ROOT+'/suppliers'));status('Supplier saved')}catch(e){status(e.message)}};
 $('#poForm').onsubmit=async e=>{e.preventDefault();const x=val(e.target);try{
  const result=await put('/purchase-orders',{supplier_id:Number(x.supplier_id),location:x.location,lines:[{part_id:Number(x.part_id),quantity:Number(x.quantity),unit_cost_cents:dollars(x.cost)}]});
  status('Draft purchase order #'+result.id+' created. No inventory changed.');await loadOrders()
 }catch(e){status(e.message)}};
 async function loadOrders(){const rows=await request(ROOT+'/purchase-orders'),el=$('#purchaseOrders');el.replaceChildren();for(const po of rows){
  const row=document.createElement('div');row.className='cardrow';row.textContent='PO '+po.id+' · '+po.supplier_name+' · '+po.location+' · '+po.status+' ';
  if(!['received','cancelled'].includes(po.status)){const button=document.createElement('button');button.textContent='Receive';button.onclick=()=>openReceiving(po.id);row.append(button)}
  el.append(row);
 }}
 async function openReceiving(id){try{
  const po=await request(ROOT+'/purchase-orders/'+id),lines=[];
  for(const line of po.lines){const remaining=Number(line.quantity_ordered)-Number(line.quantity_received);if(remaining<=0)continue;
   const entered=prompt('PO '+id+': '+line.description+'\nRemaining '+remaining+' units. Enter quantity physically received (0 to skip).',String(remaining));
   if(entered===null)return;const qty=Number(entered);if(!Number.isInteger(qty)||qty<0||qty>remaining)throw Error('Invalid received quantity');
   if(qty)lines.push({line_id:line.id,quantity:qty});
  }
  if(!lines.length)return status('No units received');
  if(!confirm('Confirm physical receipt of '+lines.reduce((a,x)=>a+x.quantity,0)+' units on PO '+id+'?'))return;
  const saved=await put('/purchase-orders/'+id+'/receive',{lines,reference_key:crypto.randomUUID()});status('PO '+id+' updated to '+saved.status);await refresh();await loadOrders()
 }catch(e){status(e.message)}}
 $('#refreshPurchaseOrders').onclick=()=>loadOrders().catch(e=>status(e.message));
 // Standard CSV parser including quoted fields, escaped quotes and line endings.
 function parseCsv(source){const rows=[];let current=[],field='',quoted=false;for(let i=0;i<source.length;i++){const c=source[i];
  if(c==='"'){if(quoted&&source[i+1]==='"'){field+='"';i++}else quoted=!quoted}
  else if(c===','&&!quoted){current.push(field);field=''}
  else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&source[i+1]==='\n')i++;current.push(field);if(current.some(x=>x.trim()))rows.push(current);field='';current=[]}
  else field+=c;
 }if(quoted)throw Error('Unclosed quoted CSV field');current.push(field);if(current.some(x=>x.trim()))rows.push(current);return rows}
 let reviewed=null;
 $('#spaImportFile').onchange=()=>{reviewed=null;$('#commitSpaImport').disabled=true;$('#spaImportPreview').textContent=''};
 $('#previewSpaImport').onclick=async()=>{
  try{
   const file=$('#spaImportFile').files[0];if(!file)throw Error('Select CSV first');
   const source=await file.text();if(source.length>100000)throw Error('Import file must be under 100 KB');
   const rows=parseCsv(source);if(rows.length<2)throw Error('No import rows found');
   const header=rows.shift().map(x=>x.trim().toLowerCase().replace(/^\ufeff/,''));
   for(const key of ['serial','brand','model'])if(!header.includes(key))throw Error('Missing column: '+key);
   const units=rows.map((r,i)=>{const unit={};header.forEach((h,index)=>unit[h]=(r[index]||'').trim());unit.wholesale_cents=unit.wholesale_cents?Number(unit.wholesale_cents):0;
    if(!unit.serial||!unit.brand||!unit.model)throw Error('Row '+(i+2)+' missing serial, brand or model');return unit});
   if(units.length>100)throw Error('Import up to 100 units at once');
   if(new Set(units.map(x=>x.serial.toLowerCase())).size!==units.length)throw Error('Duplicate serial number within file');
   reviewed=units;
   $('#spaImportPreview').textContent=units.map(x=>x.serial+' · '+x.brand+' · '+x.model+' · '+(x.shell||'')+' / '+(x.cabinet||'')).join('\n');
   $('#commitSpaImport').disabled=false;status('Previewed '+units.length+' units. No inventory changed yet.')
  }catch(e){status(e.message)}
 };
 $('#commitSpaImport').onclick=async()=>{try{
  if(!reviewed||!reviewed.length)throw Error('Preview the file first');
  const batch=$('#spaBatchKey').value.trim();if(!batch)throw Error('Enter a unique batch identifier');
  if(!confirm('Import '+reviewed.length+' serialized spas into inventory?'))return;
  const out=await put('/spas/import',{batch_key:batch,units:reviewed});status(out.created+' spas imported. Batch '+batch);
  reviewed=null;$('#commitSpaImport').disabled=true;$('#spaImportPreview').textContent='';await refresh()
 }catch(e){status(e.message)}};
 async function exportReport(kind){let endpoint,filename;
  if(kind==='valuation'){endpoint='/reports/valuation.csv';filename='inventory-valuation.csv'}
  else if(kind==='purchasing'){endpoint='/reports/purchasing.csv';filename='purchase-orders.csv'}
  else{const from=$('#reportFrom').value,to=$('#reportTo').value;if(!from||!to)throw Error('Select a start and end date');endpoint=(kind==='retail-lines'?'/reports/retail-lines.csv':'/reports/retail.csv')+'?from='+encodeURIComponent(from)+'&to='+encodeURIComponent(to);filename=(kind==='retail-lines'?'retail-items-':'retail-receipts-')+from+'-'+to+'.csv'}
  const response=await fetch(ROOT+endpoint,{headers:{Authorization:'Bearer '+token}});
  if(!response.ok){const body=await response.json().catch(()=>({}));throw Error(body.error||'Report failed')}
  const data=await response.blob(),url=URL.createObjectURL(data),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();URL.revokeObjectURL(url);
 }

 // Individual serialized spa receiving uses the exact model, color and factory-options source as Sales Agreements.
 const spaCatalog=window.HTFO_SPA_CATALOG;
 const spaEntry=$('#singleSpaForm'),spaBrand=$('#singleSpaBrand'),spaModel=$('#singleSpaModel'),spaShell=$('#singleSpaShell'),spaCabinet=$('#singleSpaCabinet');
 let spaFactory=null,spaConfigRev=0;
 function spaOpt(value,label){const o=document.createElement('option');o.value=value;o.textContent=label||value;return o}
 function setSpaColors(field,values){
   field.replaceChildren(spaOpt('','Choose color'));
   for(const v of values)field.append(spaOpt(v));
   field.append(spaOpt('__custom','Other / specify'));
   field.value='';
 }
 function spaColors(){
   const brand=spaBrand.value,model=spaModel.value,base=spaCatalog.configuration[brand]||{shell:[],cabinet:[]};
   let shell=base.shell,cabinet=base.cabinet;
   if(brand==='Cal Spas'){
     shell=/^(PZ-|PPZ-)/i.test(model)?['High Gloss White']:/^EC-/i.test(model)?['Sterling Silver','Glacier Mountain','Storm Clouds','Smoky Mountain','Tuscan Sun','Midnight Canyon']:base.shell;
     cabinet=spaCatalog.calCabinetsForModel(model);
   } else if(brand==='Innova Spas'){
     shell=/^Stream/i.test(model)?['Frost','Sand','Moka','Graphite']:/^Fantom/i.test(model)?['Dark Charcoal','Moka']:/^Storm/i.test(model)?['Frost','Sand','Midnight Grey','Moka']:/^Monsoon/i.test(model)?['Frost','Sand','Graphite','Moka']:[];
     cabinet=[];
   }
   setSpaColors(spaShell,shell);
   setSpaColors(spaCabinet,cabinet);
 }
 function otherColor(field,id){
   const label=$('#'+id+'Label');label.hidden=field.value!=='__custom';
   if(label.hidden)$('#'+id).value='';
 }
 spaShell.addEventListener('change',()=>{
   otherColor(spaShell,'singleSpaShellOther');
   if(spaBrand.value==='Innova Spas'){
     const vals=spaCatalog.innovaDoorPanels(spaModel.value,spaShell.value);
     setSpaColors(spaCabinet,vals);
     otherColor(spaCabinet,'singleSpaCabinetOther');
   }
 });
 spaCabinet.addEventListener('change',()=>otherColor(spaCabinet,'singleSpaCabinetOther'));
 spaBrand.addEventListener('change',()=>{
   const brand=spaBrand.value;
   spaModel.replaceChildren(spaOpt('','Choose factory model'));
   const codes=brand==='Cal Spas'&&spaFactory
      ?Object.keys(spaFactory.models).filter(k=>k.startsWith('Cal Spas|')).map(k=>k.slice('Cal Spas|'.length))
      :(spaCatalog.models[brand]||[]);
   for(const m of [...new Set(codes)])spaModel.append(spaOpt(m));
   spaModel.append(spaOpt('__custom','Other / enter factory model'));
   spaModel.value='';
   $('#singleSpaManualModelLabel').hidden=true;
   spaColors();renderSpaOptions();
 });
 function actualSpaModel(){return spaModel.value==='__custom'?$('#singleSpaManualModel').value.trim():spaModel.value}
 spaModel.addEventListener('change',()=>{
   $('#singleSpaManualModelLabel').hidden=spaModel.value!=='__custom';
   spaColors();renderSpaOptions();
 });
 $('#singleSpaManualModel').addEventListener('input',()=>renderSpaOptions());
 function renderSpaOptions(){
   const revision=++spaConfigRev,brand=spaBrand.value,model=actualSpaModel(),target=$('#singleSpaOptions'),message=$('#singleSpaOptionsMessage');
   target.replaceChildren();
   if(!brand||!model){message.textContent='Choose brand and model to load compatible options.';return}
   message.textContent='Loading compatible factory options…';
   spaCatalog.factoryOptions.then(catalog=>{
     if(revision!==spaConfigRev)return;
     const options=(catalog.models?.[brand+'|'+model]||[]).map(i=>catalog.opt[i]).filter(Boolean);
     const ecoExtras=brand==='Eco Spas'&&/^E[1-6](?: DLUX)?$/i.test(model)
       ?[['Wi-Fi control',400],['30-foot 110V GFCI cord',168],...(/^E[34]$/i.test(model)?[['4 HP pump upgrade',1010]]:[])]:[];
     for(const option of [...options,...ecoExtras]){
       const label=String(option[0]).replaceAll(',',';');
       const row=document.createElement('label'),checkbox=document.createElement('input');
       checkbox.type='checkbox';checkbox.value=label;checkbox.name='factory_option';
       row.append(checkbox,document.createTextNode(' '+label+' — 
})();
+Number(option[1]).toLocaleString()));
       target.append(row);
     }
     message.textContent=options.length||ecoExtras.length?'Choose any installed factory add-ons.':'No verified factory add-ons for this model. Specify an actual option below if needed.';
   }).catch(()=>{if(revision===spaConfigRev)message.textContent='Factory options unavailable. Check model before entering inventory.'});
 }
 if(spaCatalog){
   for(const brand of Object.keys(spaCatalog.models))spaBrand.append(spaOpt(brand));
   spaCatalog.factoryOptions.then(c=>{spaFactory=c;if(spaBrand.value==='Cal Spas')spaBrand.dispatchEvent(new Event('change'))}).catch(()=>{});
 }else{$('#singleSpaStatus').textContent='Shared spa configuration could not load. Refresh this page before receiving a spa.'}
 $('#showSingleSpaForm').onclick=()=>{
   spaEntry.hidden=!spaEntry.hidden;
   if(!spaEntry.hidden)spaBrand.focus();
 };
 $('#cancelSingleSpa').onclick=()=>{spaEntry.hidden=true;spaEntry.reset();spaBrand.dispatchEvent(new Event('change'));$('#singleSpaStatus').textContent=''};
 spaEntry.onsubmit=async event=>{
   event.preventDefault();if(!spaCatalog)return;
   const serial=$('#singleSpaSerial').value.trim(),brand=spaBrand.value,model=actualSpaModel();
   const shell=spaShell.value==='__custom'?$('#singleSpaShellOther').value.trim():spaShell.value;
   const cabinet=spaCabinet.value==='__custom'?$('#singleSpaCabinetOther').value.trim():spaCabinet.value;
   const location=$('#singleSpaLocation').value,rawCost=$('#singleSpaWholesale').value.trim();
   const picked=[...$('#singleSpaOptions').querySelectorAll('input[type=checkbox]:checked')].map(x=>x.value);
   const extra=$('#singleSpaOtherOptions').value.trim();
   const options=[...picked,...(extra?[extra]:[])].join(', ');
   if(!serial||!brand||!model){$('#singleSpaStatus').textContent='Brand, factory model and serial number are required.';return}
   if((spaShell.value==='__custom'&&!shell)||(spaCabinet.value==='__custom'&&!cabinet)){$('#singleSpaStatus').textContent='Specify the selected custom color.';return}
   if(!['Monroeville','Wexford','Warehouse','In Transit'].includes(location))return;
   const button=$('#saveSingleSpa');button.disabled=true;
   try{
     const payload={serial,brand,model,shell,cabinet,options,location,wholesale_cents:rawCost?dollars(rawCost):0};
     if(!confirm('Add serial '+serial+' — '+brand+' '+model+' at '+location+' to inventory?'))return;
     const added=await request('/api/service/htfo-pos/spas',{method:'POST',body:JSON.stringify(payload)});
     $('#singleSpaStatus').textContent='Spa '+added.serial+' added to '+added.location+' inventory (unit #'+added.id+').';
     spaEntry.reset();spaBrand.dispatchEvent(new Event('change'));await refresh();
   }catch(e){$('#singleSpaStatus').textContent='Spa not added: '+e.message}
   finally{button.disabled=false}
 };

 document.querySelectorAll('[data-export]').forEach(b=>b.onclick=()=>exportReport(b.dataset.export).catch(e=>status(e.message)));
})();
