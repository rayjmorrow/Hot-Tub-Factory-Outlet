import {transaction} from './service-db.js';

const locations={monroeville_sales:'Monroeville',wexford_sales:'Wexford'};
export async function recordRetailTender(id,body,actor){
 const method=body?.method,reference=String(body?.reference||'').trim(),amount=body?.amount_cents;
 if(!Number.isSafeInteger(id)||id<1||!Number.isSafeInteger(amount)||amount<1||
  !['cash','check','external_card'].includes(method)||body?.confirmed_received!==true||
  (method!=='cash'&&!reference)||reference.length>80||/(?:\d[ -]?){13,19}/.test(reference)){
  throw Error('Confirm the amount already received and provide a check or terminal reference when applicable.');
 }
 return transaction(async run=>{
  const receipt=(await run('SELECT * FROM htfo_pos_receipts WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!receipt)throw Error('Retail receipt was not found.');
  if(receipt.payment_status==='paid'){
   const previous=(await run('SELECT method,reference,amount_cents FROM htfo_pos_external_tenders WHERE receipt_id=$1',[id])).rows[0];
   if(previous?.method!==method||previous.reference!==reference||Number(previous.amount_cents)!==amount)throw Error('This receipt already has a different payment.');
   return {id,payment_status:'paid',total_cents:amount,already_recorded:true};
  }
  const location=Object.hasOwn(locations,receipt.department)?locations[receipt.department]:null;
  if(receipt.payment_status!=='unpaid'||!location||Number(receipt.total_cents)!==amount)throw Error('Receipt, department or amount changed. Reopen the unpaid receipt.');
  const lines=(await run('SELECT part_id,SUM(qty)::integer qty FROM htfo_pos_part_lines WHERE receipt_id=$1 GROUP BY part_id ORDER BY part_id',[id])).rows;
  if(!lines.length)throw Error('This draft has no current product lines.');
  for(const line of lines){
   const part=(await run(`UPDATE service_parts SET quantity_on_hand=quantity_on_hand-$2,updated_at=NOW()
    WHERE id=$1 AND quantity_on_hand-quantity_committed>=$2 RETURNING id`,[line.part_id,line.qty])).rows[0];
   if(!part)throw Error('Not enough uncommitted stock for product '+line.part_id+'.');
   const local=(await run(`UPDATE htfo_inventory_part_locations SET on_hand=on_hand-$3
    WHERE part_id=$1 AND location=$2 AND on_hand>=$3 RETURNING part_id`,[line.part_id,location,line.qty])).rows[0];
   if(!local)throw Error('Not enough stock assigned to '+location+' for product '+line.part_id+'.');
   await run(`INSERT INTO htfo_inventory_part_movements(part_id,location,delta,reason,actor_id)
    VALUES($1,$2,$3,$4,$5)`,[line.part_id,location,-line.qty,'Paid retail receipt '+id,actor]);
  }
  await run(`INSERT INTO htfo_pos_external_tenders(receipt_id,method,reference,amount_cents,recorded_by)
   VALUES($1,$2,$3,$4,$5)`,[id,method,reference,amount,actor]);
  await run("UPDATE htfo_pos_receipts SET payment_status='paid' WHERE id=$1",[id]);
  return {id,payment_status:'paid',total_cents:amount};
 });
}
