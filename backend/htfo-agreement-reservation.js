export async function requireAgreementReservation(query,draftId,spa,lock=false){
 if(spa.inventory_mode!=='in_stock')return;
 const result=await query(`SELECT 1 FROM htfo_inventory_spa
  WHERE id=$1 AND reserved_draft_id=$2 AND status='reserved' AND serial=$3
  AND brand=$4 AND model=$5 AND coalesce(shell,'')=$6 AND coalesce(cabinet,'')=$7
  AND coalesce(options,'')=$8${lock?' FOR UPDATE':''}`,
  [spa.inventory_unit_id,draftId,spa.serial,spa.brand,spa.model,spa.shell||'',spa.cabinet||'',spa.manufacturer_add_ons||'']);
 if(!result.rowCount)throw Error('The selected stock spa and configuration must be reserved to this agreement before signing.');
}
