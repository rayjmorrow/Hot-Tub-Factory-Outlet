const departmentRoutes=Object.freeze({
 monroeville_sales:'sales',wexford_sales:'sales',online_sales:'sales',service:'service'
});

export function merchantRouteForDepartment(department){
 return Object.hasOwn(departmentRoutes,department)?departmentRoutes[department]:null;
}

export function merchantRoutingReadiness(env=process.env){
 const accounts={};
 for(const route of ['sales','service']){
  const prefix='HTFO_'+route.toUpperCase()+'_AUTHORIZE_';
  accounts[route]={
   credentials_present:Boolean(env[prefix+'API_LOGIN_ID']&&env[prefix+'TRANSACTION_KEY']),
   webhook_key_present:/^[a-f0-9]{128}$/i.test(env[prefix+'SIGNATURE_KEY']||'')
  };
 }
 return {department_routes:departmentRoutes,accounts,live_split_enabled:false};
}
