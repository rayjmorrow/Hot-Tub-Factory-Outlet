/* HTFO conversion configuration. Keep internal par/dealer-fee data out of public production builds. */
window.HTFO_CONVERSION={
  version:'2026-08-23',
  leadSources:['spa_finder','get_price','check_inventory','compare_spas','payment_options','wet_test'],
  attributionFields:['utm_source','utm_medium','utm_campaign','utm_content','utm_term','gclid','fbclid','landing_page','referrer'],
  crmFields:['lead_intent','showroom','ownership','people','goals','features','timing','site_status','payment_priority','recommended_models'],
  paymentPriorities:['lowest_total_price','lowest_monthly_payment','interest_free','show_all_options'],
  financing:{
    publicMode:'payments_as_low_as',
    baselineProgram:{termMonths:120,apr:9.99,dealerFeePercent:0,status:'TERMS_TO_VERIFY_BEFORE_PUBLISHING'},
    promotionalMessage:'Additional promotional financing options may be available, including interest-free programs. Subject to approved credit.'
  },
  bubbles:{
    role:'shopping_assistant',
    goals:['help_choose','compare_models','answer_product_questions','capture_intent','prepare_for_appointment'],
    crmIntegration:'reserved'
  }
};
