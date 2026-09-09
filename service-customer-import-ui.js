(()=>{
  const btn=document.querySelector('#importCsvBtn');
  const file=document.querySelector('#csvFile');
  const result=document.querySelector('#importResult');
  if(!btn||!file||!result)return;

  function parseCsv(text){
    const rows=[];let row=[],cell='',quoted=false;
    for(let i=0;i<text.length;i++){
      const c=text[i];
      if(quoted){
        if(c==='"'&&text[i+1]==='"'){cell+='"';i++}
        else if(c==='"')quoted=false;
        else cell+=c;
      }else if(c==='"')quoted=true;
      else if(c===','){row.push(cell);cell=''}
      else if(c==='\n'){row.push(cell);rows.push(row);row=[];cell=''}
      else if(c!=='\r')cell+=c;
    }
    if(cell.length||row.length){row.push(cell);rows.push(row)}
    return rows.filter(r=>r.some(v=>String(v||'').trim()));
  }
  function keyName(v){return String(v||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'')}
  function mapRow(headers,values){
    const src={};headers.forEach((h,i)=>src[keyName(h)]=String(values[i]??'').trim());
    const first=(...keys)=>{for(const k of keys){if(src[k])return src[k]}return''};
    return {
      source_customer_id:first('master_customer_id','customer_id'),
      customer_name:first('customer_name','name'),
      first_name:first('first_name'),
      last_name:first('last_name'),
      aliases:first('all_name_variants_aliases','aliases'),
      street:first('street_address','street','address'),
      city:first('city'),
      state:first('state'),
      zip:first('zip','postal_code'),
      primary_phone:first('primary_phone','phone'),
      secondary_phone:first('secondary_phone'),
      additional_phones:first('additional_phones'),
      primary_email:first('primary_email','email'),
      additional_emails:first('additional_emails'),
      spa_makes:first('spa_make_s','spa_makes','spa_make'),
      spa_models:first('spa_model_s','spa_models','spa_model'),
      purchase_date:first('earliest_purchase_date','purchase_date'),
      first_activity:first('first_calendar_activity'),
      latest_activity:first('latest_calendar_activity'),
      calendar_event_count:Number(first('calendar_event_count')||0),
      source:first('source'),
      merged_record_count:Number(first('merged_record_count')||1),
      merged_customer_ids:first('merged_customer_ids'),
      review_note:first('name_serial_review_note','review_note'),
      recent_notes:first('recent_calendar_notes','recent_notes')
    };
  }
  function isoDate(v){
    if(!v)return'';
    if(/^\d{4}-\d{2}-\d{2}$/.test(v))return v;
    const d=new Date(v);return Number.isNaN(d.getTime())?'':d.toISOString().slice(0,10);
  }

  const intro=document.querySelector('#import p');
  if(intro)intro.textContent='Manager-only secure staging import. Customer data is written to the private service database staging tables only. It does not create production customers or Authorize.Net profiles.';
  btn.textContent='Stage Customer Database';

  btn.onclick=async()=>{
    const f=file.files[0];
    if(!f){result.textContent='Choose the approved customer CSV first.';return}
    btn.disabled=true;result.textContent='Reading and staging customer database…';
    try{
      const parsed=parseCsv(await f.text());
      if(parsed.length<2)throw new Error('The CSV has no customer rows.');
      const headers=parsed.shift();
      const mapped=parsed.map(r=>mapRow(headers,r)).filter(r=>r.street||r.primary_phone||r.primary_email||r.customer_name);
      mapped.forEach(r=>{r.purchase_date=isoDate(r.purchase_date);r.first_activity=isoDate(r.first_activity);r.latest_activity=isoDate(r.latest_activity)});
      const batchKey=`htfo-master-${new Date().toISOString().slice(0,10)}`;
      let staged=0,updated=0,rejected=0;
      for(let i=0;i<mapped.length;i+=250){
        const chunk=mapped.slice(i,i+250);
        const x=await api('/customer-import/staging',{method:'POST',body:JSON.stringify({batch_key:batchKey,source_name:f.name,source_row_count:mapped.length,rows:chunk})});
        staged+=Number(x.staged||0);updated+=Number(x.updated||0);rejected+=Number(x.rejected||0);
        result.textContent=`Staging ${Math.min(i+chunk.length,mapped.length)} of ${mapped.length}…`;
      }
      result.textContent=`Staging complete. ${mapped.length} rows processed; ${staged} new staged households, ${updated} refreshed, ${rejected} rejected. Production customers changed: 0.`;
    }catch(e){result.textContent=e.message}
    finally{btn.disabled=false}
  };
})();
