(function(){
  'use strict';

  var GA4_ID='G-0QYM8K61XX';
  var GOOGLE_ADS_ID='AW-449611837';
  var GOOGLE_FORM_CONVERSION='AW-449611837/3OsCCOGliMgaEL2QstYB';
  var META_PIXEL_ID='1364747145817150';
  var LEAD_ENDPOINT='https://hot-tub-factory-outlet.onrender.com/lead';

  function loadGoogle(){
    window.dataLayer=window.dataLayer||[];
    window.gtag=window.gtag||function(){window.dataLayer.push(arguments);};
    window.gtag('js',new Date());
    window.gtag('config',GA4_ID);
    window.gtag('config',GOOGLE_ADS_ID);
    var s=document.createElement('script');
    s.async=true;
    s.src='https://www.googletagmanager.com/gtag/js?id='+encodeURIComponent(GA4_ID);
    document.head.appendChild(s);
  }

  function loadMeta(){
    if(window.fbq)return;
    var n=window.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments);};
    if(!window._fbq)window._fbq=n;
    n.push=n;n.loaded=true;n.version='2.0';n.queue=[];
    var s=document.createElement('script');
    s.async=true;
    s.src='https://connect.facebook.net/en_US/fbevents.js';
    var first=document.getElementsByTagName('script')[0];
    first.parentNode.insertBefore(s,first);
    n('init',META_PIXEL_ID);
    n('track','PageView');
    n('track','ViewContent',{content_name:document.title,content_category:'HTFO Ad Landing Page'});
  }

  function fireLead(){
    if(window.__htfoLeadTracked)return;
    window.__htfoLeadTracked=true;
    var params=new URLSearchParams(window.location.search);
    var data={
      page_path:window.location.pathname,
      page_title:document.title,
      utm_source:params.get('utm_source')||'',
      utm_campaign:params.get('utm_campaign')||'',
      utm_content:params.get('utm_content')||''
    };
    if(window.fbq)window.fbq('track','Lead',data);
    if(window.gtag){
      window.gtag('event','conversion',{send_to:GOOGLE_FORM_CONVERSION});
      window.gtag('event','generate_lead',data);
    }
  }

  function trackFormStart(){
    if(window.__htfoFormStartTracked)return;
    window.__htfoFormStartTracked=true;
    var data={page_path:window.location.pathname,page_title:document.title};
    if(window.fbq)window.fbq('trackCustom','LeadFormStart',data);
    if(window.gtag)window.gtag('event','lead_form_start',data);
  }

  loadGoogle();
  loadMeta();

  document.addEventListener('focusin',function(e){
    if(e.target&&e.target.closest&&e.target.closest('form'))trackFormStart();
  },{once:true});

  var originalFetch=window.fetch;
  window.fetch=function(input,init){
    var url=typeof input==='string'?input:(input&&input.url)||'';
    var method=((init&&init.method)||'GET').toUpperCase();
    return originalFetch.apply(this,arguments).then(function(response){
      if(url.indexOf(LEAD_ENDPOINT)===0&&method==='POST'&&response.ok){
        try{
          response.clone().json().then(function(body){if(!body||body.ok!==false)fireLead();}).catch(function(){fireLead();});
        }catch(e){fireLead();}
      }
      return response;
    });
  };
})();
