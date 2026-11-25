// HTFO currently collects sales tax only in Pennsylvania, confirmed by the owner.
// Current accessory catalog items and their shipping charges are taxable.
// Destination sourcing: PA Revenue Local Sales Tax guidance, effective in 2026.
// Fractional-dollar brackets: PA Revenue REV-221, including separate local tax.
// https://www.pa.gov/agencies/revenue/resources/tax-types-and-information/sales-use-and-hotel-occupancy-tax/local-sales-tax
export function calculateStoreSalesTax({fulfillment,destination,taxableCents}){
 if(!Number.isSafeInteger(taxableCents)||taxableCents<0)throw Error('Invalid taxable order amount.');
 const pickup=['pickup-monroeville','pickup-wexford'].includes(fulfillment);
 const state=String(destination?.state||'').trim().toUpperCase();
 const states=new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '));
 if(!states.has(state))throw Error('Please enter a valid two-letter US state code.');
 if(!pickup&&state!=='PA')return {taxCents:0,rate:0,collecting:false,jurisdiction:'Outside Pennsylvania'};
 const county=pickup?'allegheny':String(destination?.county||'').trim().toLowerCase();
 if(!['allegheny','philadelphia','other_pa'].includes(county))throw Error('Please choose your Pennsylvania delivery county.');
 const local=county==='allegheny'?1:county==='philadelphia'?2:0;
 const dollars=Math.floor(taxableCents/100),fraction=taxableCents%100;
 const stateBracket=fraction<=10?0:fraction<=17?1:fraction<=34?2:fraction<=50?3:fraction<=67?4:fraction<=84?5:6;
 const stateTax=dollars*6+stateBracket;
 const localTax=local===1?Math.floor((taxableCents+49)/100):local===2?Math.floor((taxableCents+24)/50):0;
 return {taxCents:stateTax+localTax,rate:(6+local)/100,collecting:true,jurisdiction:county==='other_pa'?'Pennsylvania':county==='allegheny'?'Allegheny County, PA':'Philadelphia County, PA'};
}
