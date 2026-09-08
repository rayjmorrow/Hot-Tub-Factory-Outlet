window.HTFO_STORE_CONFIG={
  apiBase:"https://hot-tub-factory-outlet.onrender.com",
  authorizeMode:"production",
  shippingEnabled:true,
  pickupEnabled:true
};

document.addEventListener('DOMContentLoaded',()=>{
  const taxButton=document.getElementById('calcTax');
  if(taxButton) taxButton.remove();
  const taxLabel=document.getElementById('checkoutTax');
  if(taxLabel && /Calculated from address/i.test(taxLabel.textContent||'')) taxLabel.textContent='Calculated automatically';
});
