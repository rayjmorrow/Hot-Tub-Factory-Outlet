(()=>{
  const QUICK='https://quickspaparts.com/Hot-Tub-Parts';
  const ACTION='https://actionspaparts.com/';

  function openQuick(){window.open(QUICK,'_blank','noopener,noreferrer')}
  function openAction(){window.open(ACTION,'_blank','noopener,noreferrer')}

  const partsSection=document.getElementById('parts');
  if(partsSection){
    const card=document.createElement('div');
    card.className='card';
    card.style.marginBottom='1rem';
    card.innerHTML=`<div class="row between wrap"><div><h2 style="margin:.2rem 0">Supplier Catalogs</h2><p class="muted" style="margin:.3rem 0">Quick Spa Parts is the live retail catalog. Action Spa Parts requires Rick/manager login for dealer pricing and availability.</p></div><div class="row wrap"><button type="button" id="openQuickSpaParts">Quick Spa Parts</button><button type="button" class="secondary" id="openActionSpaParts">Action Spa Parts</button></div></div>`;
    const firstCard=partsSection.querySelector('.card');
    if(firstCard)partsSection.insertBefore(card,firstCard);else partsSection.appendChild(card);
    document.getElementById('openQuickSpaParts').onclick=openQuick;
    document.getElementById('openActionSpaParts').onclick=openAction;
  }

  function addExternalPartBox(picker,{idPrefix,title,description,supplier,url,openFn,priceLabel}){
    if(document.getElementById(`${idPrefix}WorkOrderBox`))return;
    const q=document.createElement('div');
    q.id=`${idPrefix}WorkOrderBox`;q.className='card';q.style.marginTop='1rem';
    q.innerHTML=`<div class="row between wrap"><div><h3 style="margin:.2rem 0">${title}</h3><div class="muted">${description}</div></div><button type="button" id="${idPrefix}OpenCatalog">Open Catalog</button></div>
      <div class="grid2" style="margin-top:.8rem">
        <label>Part number<input id="${idPrefix}Sku" placeholder="Part number"></label>
        <label>${priceLabel}<input id="${idPrefix}Price" type="number" min="0.01" step="0.01"></label>
        <label style="grid-column:1/-1">Description<input id="${idPrefix}Description" placeholder="Part description"></label>
        <label>Quantity<input id="${idPrefix}Qty" type="number" min="0.01" step="0.01" value="1"></label>
      </div>
      <div class="row end"><button type="button" id="${idPrefix}Add">Add to Work Order</button></div>
      <div id="${idPrefix}Feedback" class="muted"></div>`;
    picker.appendChild(q);
    document.getElementById(`${idPrefix}OpenCatalog`).onclick=openFn;
    document.getElementById(`${idPrefix}Add`).onclick=async()=>{
      const partDescription=document.getElementById(`${idPrefix}Description`).value.trim();
      const sku=document.getElementById(`${idPrefix}Sku`).value.trim();
      const unit_price=Number(document.getElementById(`${idPrefix}Price`).value||0);
      const quantity=Number(document.getElementById(`${idPrefix}Qty`).value||1);
      const feedback=document.getElementById(`${idPrefix}Feedback`);
      if(!partDescription||unit_price<=0){feedback.textContent='Enter a description and customer retail price.';return;}
      if(!currentId){feedback.textContent='Open a work order first.';return;}
      try{
        const btn=document.getElementById(`${idPrefix}Add`);btn.disabled=true;btn.textContent='Adding…';
        await api(`/work-orders/${currentId}/invoice-items/external-part`,{method:'POST',body:JSON.stringify({description:partDescription,sku,unit_price,quantity,supplier,source_url:url})});
        await refreshWorkOrder(currentId);
      }catch(e){feedback.textContent=e.message||'Unable to add part.';const btn=document.getElementById(`${idPrefix}Add`);btn.disabled=false;btn.textContent='Add to Work Order';}
    };
  }

  function enhanceWorkOrderParts(){
    const box=document.getElementById('woPartsBox');
    if(!box)return;
    const addBtn=document.getElementById('woAddPartBtn');
    if(addBtn&&!document.getElementById('woQuickSpaBtn')){
      const b=document.createElement('button');b.type='button';b.id='woQuickSpaBtn';b.className='secondary';b.textContent='Quick Spa Parts';b.onclick=openQuick;addBtn.parentElement?.appendChild(b);
    }
    if(addBtn&&!document.getElementById('woActionSpaBtn')){
      const b=document.createElement('button');b.type='button';b.id='woActionSpaBtn';b.className='secondary';b.textContent='Action Spa Parts';b.onclick=openAction;addBtn.parentElement?.appendChild(b);
    }
    const picker=document.getElementById('woPartPicker');
    if(!picker)return;
    addExternalPartBox(picker,{idPrefix:'qsp',title:'Add from Quick Spa Parts',description:'Open the retail catalog, copy the part number, description and retail price, then add it directly to this work order.',supplier:'Quick Spa Parts',url:QUICK,openFn:openQuick,priceLabel:'Retail price'});
    addExternalPartBox(picker,{idPrefix:'asp',title:'Add from Action Spa Parts',description:'Rick/manager can open Action, sign in, compare dealer pricing/availability, then enter the customer retail price to charge on this work order.',supplier:'Action Spa Parts',url:ACTION,openFn:openAction,priceLabel:'Customer retail price'});
  }

  new MutationObserver(enhanceWorkOrderParts).observe(document.body,{childList:true,subtree:true});
  enhanceWorkOrderParts();
})();
