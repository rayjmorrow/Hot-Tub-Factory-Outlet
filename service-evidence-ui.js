(()=>{
  const labels={arrival_damage:'Damage on arrival',problem:'Problem / warranty evidence',old_part:'Old part',installed_part:'New part installed',other:'Other'};
  const extensions={'image/jpeg':'jpg','image/png':'png','image/heic':'heic','image/webp':'webp','video/mp4':'mp4','video/quicktime':'mov'};
  function element(tag,text){
    const el=document.createElement(tag);
    if(text)el.textContent=text;
    return el;
  }
  function button(text,action){
    const el=element('button',text);
    el.type='button';
    el.className='secondary';
    el.addEventListener('click',action);
    return el;
  }
  window.mountServiceEvidence=(parent,{jobId,customerId,token})=>{
    const section=element('section');
    section.className=jobId?'panel':'card';
    const status=element('p');
    status.setAttribute('role','status');
    const list=element('div');
    const endpoint=jobId?'/field/work-orders/'+jobId+'/evidence':'/customers/'+customerId+'/service-evidence';
    const request=async(path,options={})=>{
      const response=await fetch('/api/service'+path,{...options,headers:{Authorization:'Bearer '+token(),...options.headers}});
      if(!response.ok){
        const error=await response.json().catch(()=>({}));
        throw Error(error.error||(response.status===413?'Choose a file no larger than 25 MB.':'Request failed ('+response.status+')'));
      }
      return response;
    };
    const refresh=async(before=null)=>{
      const data=await (await request(endpoint+(before?'?before='+encodeURIComponent(before):''))).json();
      const items=jobId?data:data.items;
      if(!before)list.replaceChildren();
      if(!before&&!items.length)list.append(element('p','No photos or videos saved yet.'));
      for(const item of items){
        const entry=element('div');
        entry.className='item';
        entry.append(element('b',labels[item.category]||'Evidence'),
          element('div',[item.work_order_number,item.uploaded_by,new Date(item.created_at).toLocaleString()].filter(Boolean).join(' · ')));
        if(item.note)entry.append(element('p',item.note));
        entry.append(button('Preview',event=>openFile(item,event.currentTarget,true)),
          button('Download',event=>openFile(item,event.currentTarget,false)));
        list.append(entry);
      }
      if(data.next)list.append(button('Load older files',async event=>{
        const more=event.currentTarget;
        more.disabled=true;
        try{await refresh(data.next);more.remove()}catch(error){status.textContent=error.message;more.disabled=false}
      }));
    };
    async function openFile(item,control,preview){
      control.disabled=true;
      status.textContent='Loading file…';
      try{
        const response=await request('/service-evidence/'+item.id+'/file');
        const url=URL.createObjectURL(await response.blob());
        if(preview){
          const dialog=element('dialog');
          dialog.style.maxWidth='90vw';
          const media=element(item.mime_type.startsWith('video/')?'video':'img');
          media.style.cssText='display:block;max-width:80vw;max-height:70vh;margin-bottom:1rem';
          if(media.tagName==='VIDEO')media.controls=true;
          else media.alt=labels[item.category]||'Service evidence';
          media.addEventListener('error',()=>dialog.prepend(element('p','This device cannot preview this file. Use Download to open the original.')),{once:true});
          media.src=url;
          dialog.append(media,button('Close',()=>dialog.close()));
          dialog.addEventListener('close',()=>{URL.revokeObjectURL(url);dialog.remove()},{once:true});
          document.body.append(dialog);
          dialog.showModal();
        }else{
          const anchor=element('a');
          anchor.href=url;
          anchor.download='service-evidence-'+item.id+'.'+extensions[item.mime_type];
          anchor.click();
          setTimeout(()=>URL.revokeObjectURL(url),30000);
        }
        status.textContent='';
      }catch(error){status.textContent=error.message}
      finally{control.disabled=false}
    }
    section.append(element('h3','Service Photos & Videos'),status,list);
    if(jobId){
      const form=element('form');
      const category=element('select');
      category.required=true;
      category.append(new Option('Choose a category',''));
      for(const [value,name] of Object.entries(labels))category.append(new Option(name,value));
      const note=element('textarea');
      note.maxLength=500;
      note.rows=2;
      const photo=element('input'),video=element('input'),library=element('input');
      for(const input of [photo,video,library])input.type='file';
      photo.accept='image/*';photo.setAttribute('capture','environment');
      video.accept='video/*';video.setAttribute('capture','environment');
      library.accept='image/*,video/*,.heic,.mov';
      const inputs=[photo,video,library];
      for(const input of inputs)input.addEventListener('change',()=>{
        if(input.files.length)for(const other of inputs)if(other!==input)other.value='';
      });
      const submit=element('button','Save evidence');
      submit.type='submit';
      const label=(text,input)=>{const el=element('label',text);el.append(input);return el};
      form.append(label('Category',category),label('Take a photo',photo),label('Record a short video',video),
        label('Choose an existing photo or video',library),label('Note (optional)',note),
        element('p','Up to 25 MB per file. Trim longer videos before uploading.'),submit);
      form.addEventListener('submit',async event=>{
        event.preventDefault();
        const file=inputs.find(input=>input.files.length)?.files[0];
        if(!file||file.size>25*1024*1024){status.textContent='Choose a photo or video no larger than 25 MB.';return}
        submit.disabled=true;
        status.textContent='Uploading evidence…';
        try{
          await request(endpoint,{method:'POST',headers:{'Content-Type':'application/octet-stream',
            'X-Evidence-Category':category.value,'X-Evidence-Note':encodeURIComponent(note.value)},body:file});
          form.reset();
          status.textContent='Saved to the work order and customer record.';
          await refresh().catch(()=>{status.textContent='File saved. Reopen the job to refresh the list.'});
        }catch(error){status.textContent=error.message}
        finally{submit.disabled=false}
      });
      section.insertBefore(form,list);
    }
    parent.append(section);
    refresh().catch(error=>{status.textContent=error.message});
  };
})();
