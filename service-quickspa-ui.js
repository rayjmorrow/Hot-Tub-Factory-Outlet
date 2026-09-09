(()=>{
  const QUICK='https://quickspaparts.com/Hot-Tub-Parts';

  function openQuick(){window.open(QUICK,'_blank','noopener,noreferrer')}

  const partsSection=document.getElementById('parts');
  if(partsSection){
    const card=document.createElement('div');
    card.className='card';
    card.style.marginBottom='1rem';
    card.innerHTML=`<div class="row between wrap"><div><h2 style="margin:.2rem 0">Quick Spa Parts</h2><p class="muted" style="margin:.3rem 0">Use Quick Spa Parts as HTFO's live retail supplier catalog. Find the part there, then add it to the work order at the retail price shown.</p></div><button type="button" id="openQuickSpaParts">Open Quick Spa Parts</button></div>`;
    const firstCard=partsSection.querySelector('.card');
    if(firstCard)partsSection.insertBefore(card,firstCard);else partsSection.appendChild(card);
    document.getElementById('openQuickSpaParts').onclick=openQuick;
  }

  function enhanceWorkOrderParts(){
    const box=document.getElementById('woPartsBox');
    if(!box)return;
    const addBtn=document.getElementById('woAddPartBtn');
    if(addBtn&&!document.getElementById('woQuickSpaBtn')){
      const b=document.createElement('button');
      b.type='button';b.id='woQuickSpaBtn';b.className='secondary';b.textContent='Quick Spa Parts';
      b.onclick=openQuick;
      addBtn.parentElement?.appendChild(b);
    }
    const picker=document.getElementById('woPartPicker');
    if(picker&&!document.getElementById('quickSpaWorkOrderBox')){
      const q=document.createElement('div');
      q.id='quickSpaWorkOrderBox';q.className='card';q.style.marginTop='1rem';
      q.innerHTML=`<div class="row between wrap"><div><h3 style="margin:.2rem 0">Add from Quick Spa Parts</h3><div class="muted">Open their catalog, copy the part number/description/retail price, then add it directly to this work order.</div></div><button type="button" id="openQuickSpaFromPicker">Open Catalog</button></div>
        <div class="grid2" style="margin-top:.8rem">
          <label>Part number<input id="qspSku" placeholder="Example: HEA14600015"></label>
          <label>Retail price<input id="qspPrice" type="number" min="0.01" step="0.01" placeholder="102.61"></label>
          <label style="grid-column:1/-1">Description<input id="qspDescription" placeholder="Heater Flow Thru 5.5 KW 240V Assembly"></label>
          <label>Quantity<input id="qspQty" type="number" min="0.01" step="0.01" value="1"></label>
        </div>
        <div class="row end"><button type="button" id="addQuickSpaToWorkOrder">Add Quick Spa Part to Work Order</button></div>
        <div id="qspFeedback" class="muted"></div>`;
      picker.appendChild(q);
      document.getElementById('openQuickSpaFromPicker').onclick=openQuick;
      document.getElementById('addQuickSpaToWorkOrder').onclick=async()=>{
        const description=document.getElementById('qspDescription').value.trim();
        const sku=document.getElementById('qspSku').value.trim();
        const unit_price=Number(document.getElementById('qspPrice').value||0);
        const quantity=Number(document.getElementById('qspQty').value||1);
        const feedback=document.getElementById('qspFeedback');
        if(!description||unit_price<=0){feedback.textContent='Enter a description and the retail price shown on Quick Spa Parts.';return;}
        if(!currentId){feedback.textContent='Open a work order first.';return;}
        try{
          const btn=document.getElementById('addQuickSpaToWorkOrder');btn.disabled=true;btn.textContent='Adding…';
          await api(`/work-orders/${currentId}/invoice-items/external-part`,{method:'POST',body:JSON.stringify({description,sku,unit_price,quantity,supplier:'Quick Spa Parts',source_url:QUICK})});
          await refreshWorkOrder(currentId);
        }catch(e){feedback.textContent=e.message||'Unable to add part.';document.getElementById('addQuickSpaToWorkOrder').disabled=false;document.getElementById('addQuickSpaToWorkOrder').textContent='Add Quick Spa Part to Work Order';}
      };
    }
  }

  new MutationObserver(enhanceWorkOrderParts).observe(document.body,{childList:true,subtree:true});
  enhanceWorkOrderParts();
})();
