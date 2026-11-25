const read=(env,key)=>String(env[key]||'').trim();

export function readStorePaymentSettings(env=process.env){
 const errors=[];
 function credential(primary,legacy,label){
  const a=read(env,primary),b=read(env,legacy);
  if(a&&b&&a!==b)errors.push('Conflicting '+label+' settings. Keep one current value.');
  return a||b;
 }
 const loginId=credential('AUTHORIZE_API_LOGIN_ID','AUTHORIZENET_API_LOGIN_ID','API Login ID');
 const transactionKey=credential('AUTHORIZE_TRANSACTION_KEY','AUTHORIZENET_TRANSACTION_KEY','Transaction Key');
 const mode=read(env,'AUTHORIZE_SANDBOX').toLowerCase();
 if(mode&&!['true','false'].includes(mode))errors.push('AUTHORIZE_SANDBOX must be true or false.');
 const sandbox=mode==='true';
 return {loginId,transactionKey,sandbox,errors,
  ready:Boolean(loginId&&transactionKey&&!errors.length),
  apiUrl:sandbox?'https://apitest.authorize.net/xml/v1/request.api':'https://api.authorize.net/xml/v1/request.api',
  paymentUrl:sandbox?'https://test.authorize.net/payment/payment':'https://accept.authorize.net/payment/payment',
  customerUrl:sandbox?'https://test.authorize.net/customer/manage':'https://accept.authorize.net/customer/manage'};
}

export function merchantAuthentication(settings){
 if(settings.errors.length)throw Error(settings.errors.join(' '));
 if(!settings.loginId||!settings.transactionKey)throw Error('The store payment credentials are not configured.');
 return {name:settings.loginId,transactionKey:settings.transactionKey};
}

export async function storeGatewayRequest(body,{settings=readStorePaymentSettings(),fetchImpl=fetch}={}){
 merchantAuthentication(settings);
 let response;
 try{
  response=await fetchImpl(settings.apiUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});
 }catch{throw Error('The payment service could not be reached. Please try again shortly.');}
 let result;
 try{result=JSON.parse((await response.text()).replace(/^\uFEFF/,''));}
 catch{throw Error('The payment service returned an unreadable response. Please try again shortly.');}
 if(!response.ok||result?.messages?.resultCode!=='Ok'){
  const rawCode=String(result?.messages?.message?.[0]?.code||'');
  const code=/^[EI][0-9]{5}$/.test(rawCode)?rawCode:'';
  const message=code==='E00007'
   ? 'The store’s payment connection could not be authenticated. Please call 412-326-0361. (E00007)'
   : 'The payment service could not complete this request.'+(code?' ('+code+')':'');
  const error=Error(message);error.code=code;throw error;
 }
 return result;
}
