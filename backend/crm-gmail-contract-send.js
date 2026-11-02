import crypto from 'node:crypto';
const encode=x=>Buffer.from(x).toString('base64url');
const cleanHeader=x=>String(x||'').replace(/[\r\n]/g,' ').trim();
function account(){
 const raw=String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON||'').trim();
 if(!raw)throw Error('Google service account is not configured');
 const obj=JSON.parse(raw);
 if(!obj.client_email||!obj.private_key)throw Error('Google service account JSON is incomplete');
 return obj;
}
export function gmailContractConfigured(){
 try{account();return true}catch{return false}
}
async function gmailSendToken(mailbox){
 const sa=account(),now=Math.floor(Date.now()/1000);
 const jwt=encode(JSON.stringify({alg:'RS256',typ:'JWT'}))+'.'+encode(JSON.stringify({
  iss:sa.client_email,sub:mailbox,scope:'https://www.googleapis.com/auth/gmail.send',
  aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+900
 }));
 const signature=crypto.sign('RSA-SHA256',Buffer.from(jwt),sa.private_key).toString('base64url');
 const form=new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:jwt+'.'+signature});
 const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form,signal:AbortSignal.timeout(15000)});
 const data=await response.json().catch(()=>({}));
 if(!response.ok||!data.access_token)throw Error('Google Gmail sending authorization failed: '+String(data.error||'token unavailable')+'. Confirm Workspace domain-wide delegation includes gmail.send');
 return data.access_token;
}
export async function verifyGmailSendAccess(mailbox){await gmailSendToken(mailbox);return true;}
export async function sendSignedPdfWithGmail({from,to,recipient,subject,message,filename,pdf}){
 const sender=cleanHeader(from),destination=cleanHeader(to);
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sender)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination))throw Error('Sender or recipient email is invalid');
 if(!Buffer.isBuffer(pdf)||!pdf.length)throw Error('Signed PDF is missing');
 const token=await gmailSendToken(sender);
 const boundary='htfo_'+crypto.randomBytes(12).toString('hex');
 const mime=[
  'From: '+sender,'To: '+(recipient?'"'+cleanHeader(recipient).replace(/"/g,'')+'" <'+destination+'>':destination),
  'Subject: '+cleanHeader(subject),'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="'+boundary+'"','',
  '--'+boundary,'Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',Buffer.from(String(message)).toString('base64'),
  '--'+boundary,'Content-Type: application/pdf; name="'+cleanHeader(filename)+'"','Content-Disposition: attachment; filename="'+cleanHeader(filename)+'"','Content-Transfer-Encoding: base64','',pdf.toString('base64'),
  '--'+boundary+'--',''
 ].join('\r\n');
 const response=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{
  method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
  body:JSON.stringify({raw:Buffer.from(mime).toString('base64url')}),signal:AbortSignal.timeout(20000)
 });
 const result=await response.json().catch(()=>({}));
 if(!response.ok||!result.id)throw Error('Gmail PDF delivery failed: '+String(result.error?.message||response.status));
 return {id:result.id};
}
