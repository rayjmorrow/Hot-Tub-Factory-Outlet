(()=>{
const byId=id=>document.getElementById(id), year=byId('finder-year'),brand=byId('finder-brand'),series=byId('finder-series'),model=byId('finder-model'),result=byId('finder-result'), unknown=byId('finder-unknown');
const roots=[...document.querySelectorAll('.archive > details')];
const direct=(el,selector)=>[...el.children].filter(x=>x.matches(selector));
const label=el=>el.querySelector(':scope > summary')?.textContent.trim()||'';
const setOptions=(el,rows,placeholder)=>{el.replaceChildren(new Option(placeholder,''));rows.forEach(x=>el.add(new Option(x.label,x.value)));el.disabled=!rows.length};
const years=roots.map((e,i)=>({label:label(e),value:String(i)}));setOptions(year,years,'Select model year (or choose Not sure below)');
const brandsFor=y=>{if(!y)return[];const idx=Number(y);const root=roots[idx];let children=direct(root,'details');if(children.length===0)return[{label:label(root).replace(/^\\d{4} model year · /,''),value:'self'}];return children.map((e,i)=>({label:label(e).replace(/ · 2026 catalog models$/,''),value:String(i)}))};
function yearRoot(){return roots[Number(year.value)]}
function brandNode(){if(!year.value||!brand.value)return null;const root=yearRoot();return brand.value==='self'?root:direct(root,'details')[Number(brand.value)]}
function seriesNode(){const b=brandNode();if(!b)return null;if(!series.value||series.value==='self')return b;return direct(b,'details')[Number(series.value)]}
const clean=(s)=>s.replace(/ · .*$/,'').trim();
const selectedModel=()=>{const target=seriesNode();return target? [...target.querySelectorAll('.model')].find(x=>x.querySelector('h4')?.textContent.trim()===model.value):null};
function updateResult(){
result.replaceChildren();
if(!year.value){result.textContent='Choose whatever details you know, or use the identification help below.';return}
if(!brand.value){result.textContent='Select the brand. If you do not know it, use the identification help below.';return}
const b=brandNode(),n=seriesNode(),m=selectedModel(),shown=m||n||b;
if(!shown){result.textContent='Choose a series or model, or view the brand references below.';return}
const head=document.createElement('p');head.textContent=m?'Your matching archive entry: '+model.value:n&&n!==b?'Series references: '+label(n):'Brand references: '+label(b);
result.append(head);
const p=document.createElement('p');p.textContent='The available references are in the archive section below. Confirm the installed control panel before using instructions, especially on optioned or serviced spas.';result.append(p);
const button=document.createElement('button');button.type='button';button.textContent='Open matching guide ↓';button.className='finder-action';button.addEventListener('click',()=>{let node=shown.closest('details');while(node){node.open=true;node=node.parentElement.closest('details')}shown.scrollIntoView({behavior:'smooth',block:'center'});if(m){m.style.outline='3px solid #087fbd';setTimeout(()=>m.style.removeProperty('outline'),5000)}});result.append(button)
}
year.addEventListener('change',()=>{setOptions(brand,brandsFor(year.value),'Select brand');setOptions(series,[],'Select series (optional)');setOptions(model,[],'Select model (optional)');updateResult()});
brand.addEventListener('change',()=>{const b=brandNode();const children=b?direct(b,'details'):[];setOptions(series,children.length?children.map((e,i)=>({label:clean(label(e)),value:String(i)})):[{label:'View all models and guides',value:'self'}],'Select series or skip to brand');setOptions(model,[],'Select model (optional)');updateResult()});
series.addEventListener('change',()=>{const n=seriesNode();let models=n?[...n.querySelectorAll('.models .model h4')].map(x=>x.textContent.trim()):[];models=[...new Set(models)];setOptions(model,models.map(x=>({label:x,value:x})),'Choose model (optional)');updateResult()});
model.addEventListener('change',updateResult);
document.querySelectorAll('[data-finder-panel]').forEach(button=>button.addEventListener('click',()=>{
document.querySelectorAll('[data-finder-panel]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
const value=button.dataset.finderPanel;const messages={
'touch':'Touchscreen controls may be Gecko in.k1001, Balboa SpaTouch, or another panel. Look for a manufacturer name or model printed on the keypad or in the system settings. Do not use instructions based on appearance alone.',
'buttons':'Button-style controls may include Balboa TP500/TP740, Gecko K330/K506 or other keypads. Count the buttons and check the printed model number to narrow the correct tutorial.',
'unknown':'A photo of the whole control panel and its printed label is usually the fastest way to identify it. Call HTFO for help before changing settings.'
};unknown.textContent=messages[value]||messages.unknown;
}));
})();