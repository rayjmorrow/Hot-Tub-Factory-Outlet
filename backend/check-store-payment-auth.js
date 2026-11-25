import {readStorePaymentSettings,merchantAuthentication,storeGatewayRequest} from './store-payment-config.js';

// This endpoint validates gateway credentials only. It creates no transaction,
// customer profile, subscription, authorization, capture, or card charge.
const settings=readStorePaymentSettings();
if(!settings.ready){
 console.error('Store payment credential check cannot run.');
 if(!settings.loginId)console.error('Missing GitHub secret: AUTHORIZE_API_LOGIN_ID (or AUTHORIZENET_API_LOGIN_ID).');
 if(!settings.transactionKey)console.error('Missing GitHub secret: AUTHORIZE_TRANSACTION_KEY (or AUTHORIZENET_TRANSACTION_KEY).');
 for(const message of settings.errors)console.error(message);
 process.exitCode=1;
}else{
 try{
  await storeGatewayRequest({authenticateTestRequest:{merchantAuthentication:merchantAuthentication(settings)}},{settings});
  console.log('PASS: Authorize.Net accepted the configured '+(settings.sandbox?'sandbox':'live')+' store credentials. No transaction was created.');
 }catch(error){
  console.error('FAIL: '+error.message);
  process.exitCode=1;
 }
}
