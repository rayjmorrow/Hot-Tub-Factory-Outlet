export const SERVICE_RULES = Object.freeze({
  laborRatePerHour: 150,
  diagnosticCharge: 100,
  diagnosticWaivedWhenRepairCompleted: true,
  defaultAppointmentMinutes: 60,
  partsTaxRate: 0.07,
  partsGrossMarginPercent: 50,
  partsPriceMultiplier: 2,
  laborTaxable: false,
  diagnosticTaxable: false,
  tripTaxable: false,
  customerLocationAssignmentRequired: false,
  serviceOperationsLocationModel: 'single_operations_location',
  chargeOverrideRoles: ['admin','owner','service_manager']
});

export function canOverrideCharges(user){
  return SERVICE_RULES.chargeOverrideRoles.includes(user?.role);
}

export function calculateLaborAmount(hours){
  const h=Math.max(0,Number(hours)||0);
  return Number((h*SERVICE_RULES.laborRatePerHour).toFixed(2));
}

export function calculatePartsTax(partsAmount){
  const p=Math.max(0,Number(partsAmount)||0);
  return Number((p*SERVICE_RULES.partsTaxRate).toFixed(2));
}

export function calculateDefaultPartSellPrice(cost){
  const c=Math.max(0,Number(cost)||0);
  return Number((c*SERVICE_RULES.partsPriceMultiplier).toFixed(2));
}

export function diagnosticAmountForRepair(repairCompleted){
  return repairCompleted&&SERVICE_RULES.diagnosticWaivedWhenRepairCompleted?0:SERVICE_RULES.diagnosticCharge;
}

export function defaultScheduledEnd(start, minutes=SERVICE_RULES.defaultAppointmentMinutes){
  if(!start) return null;
  const d=new Date(start);
  if(Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime()+Math.max(0,Number(minutes)||0)*60000).toISOString();
}
