(()=>{
 'use strict';
 const form=document.getElementById('serviceRequestForm');
 if(!form)return;
 const status=document.getElementById('serviceRequestStatus'),button=form.querySelector('[type="submit"]');
 let pending=false,completed=false;
 function notice(message,bad=false){
  status.hidden=false;status.textContent=message;
  status.style.cssText='padding:18px;margin:18px 0;border-radius:10px;font-size:18px;font-weight:700;line-height:1.5;background:'+(bad?'#fff1f0;color:#922c26;border:2px solid #d99b96':'#eaf6ef;color:#175632;border:2px solid #91c7a5');
  status.setAttribute('role',bad?'alert':'status');
  status.focus();status.scrollIntoView({behavior:'smooth',block:'center'});
 }
 form.addEventListener('submit',async event=>{
  event.preventDefault();
  if(pending||completed||!form.reportValidity())return;
  pending=true;button.disabled=true;button.textContent='Sending your request…';
  notice('Sending your service request. Please keep this page open.');
  const data=Object.fromEntries(new FormData(form));
  try{
   // Keep the existing email destination; confirm the provider accepted the request.
   const response=await fetch(form.action.replace('https://formsubmit.co/','https://formsubmit.co/ajax/'),{
    method:'POST',signal:AbortSignal.timeout(45000),headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(data)
   });
   const result=await response.json();
   if(!response.ok||!(result.success===true||result.success==='true'))throw Error('The service request was not confirmed.');
   completed=true;button.textContent='Service request sent';
   form.querySelector('.service-grid').hidden=true;
   notice('✓ Your service request was sent successfully. Our service team will contact you to discuss the problem and arrange an appointment. Your appointment is not yet scheduled.');
  }catch(error){
   button.disabled=false;button.textContent='Request Service';
   notice('We could not confirm that your request was received. Your information is still here. Please call 412-326-0361 before submitting again so we can check for a duplicate.',true);
  }finally{pending=false}
 });
})();
