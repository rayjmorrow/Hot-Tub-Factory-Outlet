/* HTFO signature experience prototype: local preview only, never sends or finalizes a contract. */
(()=> {
const css=document.createElement('style');
css.textContent=`
#htfoSignPreview{border:0;border-radius:16px;width:min(820px,97vw);max-height:94dvh;padding:0;color:#12283c}
#htfoSignPreview::backdrop{background:#001a2dcc}
.hsp{padding:20px 24px}.hsp h2{margin:0 0 8px;color:#082642}.hsp-note{background:#fff5dc;padding:10px 12px;border-radius:8px;font-size:13px}
.hsp-warning{color:#bb1515;text-align:center;font-weight:900;font-size:clamp(19px,4vw,30px);line-height:1.35;border:2px solid #bb1515;padding:14px;margin:16px 0}
.hsp-terms{border:1px solid #cdd8e2;border-radius:9px;padding:12px;margin:12px 0}
.hsp-terms summary{cursor:pointer;color:#0b79b7;font-weight:700}
.hsp-terms p{font-size:13px;line-height:1.6}
#hspPad{display:block;width:100%;height:190px;touch-action:none;border:2px solid #aab8c5;border-radius:9px;background:white}
.hsp-actions{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}.hsp-actions button{min-height:44px}
.hsp-ack{display:flex;gap:10px;align-items:flex-start;font-size:14px;line-height:1.5}
.hsp-ack input{width:22px;height:22px;flex:none}
@media print {body>*{display:none!important}body>#hspPrint{display:block!important;color:black;font:14px Arial;padding:25px}#hspPrint img{max-width:100%;max-height:125px}}
`;document.head.append(css);
const dlg=document.createElement('dialog');dlg.id='htfoSignPreview';
dlg.innerHTML=`<div class="hsp"><div style="display:flex;justify-content:space-between;gap:10px"><div><h2>Signature section — enlarged preview</h2><div id="hspContext" class="small"></div></div><button type="button" class="btn secondary" id="hspClose">Close</button></div>
<p class="hsp-note"><b>TEST MODE ONLY.</b> This is an iPad / Apple Pencil / finger signing demonstration. Signatures here are not saved, emailed, or added to an agreement. Do not use it for a customer sale yet.</p>
<div style="border:1px solid #b7c7d3;border-radius:12px;padding:16px">
<div style="text-align:center"><b>HOT TUB FACTORY OUTLET</b><div class="small">Sales Agreement — Signature & Acknowledgment</div></div>
<div class="hsp-warning">ALL SALES FINAL<br>NO REFUNDS · NO RETURNS<br>NO EXCHANGES</div>
<p>Subject to applicable law and any legally required cancellation or refund rights.</p>
<details class="hsp-terms"><summary>Open full Terms and Conditions of Sale</summary><p><b>Preview placeholder:</b> The approved, complete HTFO contract terms must be inserted and reviewed before any real customer signature collection is enabled. This prototype does not substitute for the contract terms.</p></details>
<label class="hsp-ack"><input type="checkbox" id="hspConsent"> <span>I acknowledge that the Terms and Conditions of Sale have been made available to me, I have had the opportunity to review them, and I agree to them, subject to applicable law.</span></label>
<label for="hspSigner">Signer name</label><input id="hspSigner" autocomplete="name" placeholder="Customer or salesperson">
<label for="hspPad">Sign below with a finger, Apple Pencil, or mouse</label>
<canvas id="hspPad" aria-label="Handwritten signature canvas"></canvas>
<div class="hsp-actions"><button class="btn secondary" id="hspClear" type="button">Clear signature</button><button class="btn primary" id="hspComplete" type="button" disabled>Preview signed section</button></div>
<p id="hspMsg" role="status" class="small"></p></div></div>`;
document.body.append(dlg);
const $=s=>dlg.querySelector(s),pad=$('#hspPad');let ctx,drawing=false,hasInk=false,previous=null;
function resize(){const dpr=window.devicePixelRatio||1,rect=pad.getBoundingClientRect();pad.width=Math.max(1,Math.round(rect.width*dpr));pad.height=Math.max(1,Math.round(rect.height*dpr));ctx=pad.getContext('2d');ctx.scale(dpr,dpr);ctx.strokeStyle='#12283c';ctx.lineWidth=2.5;ctx.lineCap='round';ctx.lineJoin='round';hasInk=false;validate()}
function point(e){let r=pad.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}}
pad.addEventListener('pointerdown',e=>{e.preventDefault();pad.setPointerCapture(e.pointerId);drawing=true;previous=point(e);ctx.beginPath();ctx.arc(previous.x,previous.y,1.3,0,Math.PI*2);ctx.fillStyle='#12283c';ctx.fill();hasInk=true;validate()});
pad.addEventListener('pointermove',e=>{if(!drawing)return;e.preventDefault();const p=point(e);ctx.beginPath();ctx.moveTo(previous.x,previous.y);ctx.lineTo(p.x,p.y);ctx.stroke();previous=p});
for(const event of ['pointerup','pointercancel','lostpointercapture'])pad.addEventListener(event,()=>drawing=false);
function validate(){$('#hspComplete').disabled=!($('#hspConsent').checked&&$('#hspSigner').value.trim()&&hasInk)}
$('#hspConsent').onchange=validate;$('#hspSigner').oninput=validate;
$('#hspClear').onclick=()=>{ctx.clearRect(0,0,pad.width,pad.height);hasInk=false;validate()};
$('#hspClose').onclick=()=>dlg.close();
$('#hspComplete').onclick=()=>{if($('#hspComplete').disabled)return;const print=document.createElement('div');print.id='hspPrint';print.style.display='none';const safe=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));print.innerHTML='<h2>HOT TUB FACTORY OUTLET — SIGNATURE PREVIEW ONLY</h2><p>Not an executed sales agreement.</p><h2 style="color:#bb1515;text-align:center">ALL SALES FINAL — NO REFUNDS — NO RETURNS — NO EXCHANGES</h2><p>Terms acknowledgment checked: Yes (demonstration only)</p><p>Signer: '+safe($('#hspSigner').value.trim())+'</p><img alt="Demonstration signature" src="'+pad.toDataURL('image/png')+'"><p>Not submitted, saved, timestamped, or legally executed.</p>';document.getElementById('hspPrint')?.remove();document.body.append(print);$('#hspMsg').textContent='Preview prepared. No signature has been saved or sent. Use your browser print command to inspect the section.'};
const trigger=document.createElement('button');trigger.type='button';trigger.className='btn secondary';trigger.textContent='Try iPad signature preview';trigger.id='hspOpen';
const host=document.querySelector('#agreementDialog .sa-controls');
if(host){host.append(trigger);trigger.onclick=()=>{const d=document.querySelector('#agreementDialog');$('#hspContext').textContent='Demo only — customer or salesperson can sign on the iPad';$('#hspConsent').checked=false;$('#hspSigner').value='';$('#hspMsg').textContent='';d?.close();dlg.showModal();requestAnimationFrame(resize);dlg.addEventListener('close',()=>{if(d&&!d.open)d.showModal()},{once:true})}}
})();