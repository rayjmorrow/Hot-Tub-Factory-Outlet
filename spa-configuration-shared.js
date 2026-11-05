// Shared showroom and inventory spa configuration. Source: approved HTFO Sales Agreement choices.
// Loaded by BOTH the agreement and the single-spa receiving screen. Edit this shared source, not separate copies of options.
(()=>{
const MODELS={"American Whirlpool":["101","151","160","171","250","261","270","271","280","281","282","451","460","461","470","471","472","480","481","880","881","982"],"Vita Spa":["Duet","Image","Voeux","Amour","Intrigue","Elegant","Luxe","Sensation","Trio","Joli","Prestige","Monarque","Envie","Salon","Grand","Cabaret","Riviera","Vivre","Rendezvous","Mystique"],"Cal Spas":["Aloha","Balboa","Kona","Hawaiian","Maui","Balboa Plus","Kona Plus","Hawaiian Plus","Maui Plus","Pacifica Plus","Tropical Plus","Atlantic Plus","Bel Air Plus","Costa","Baja","Avalon","Cancun","Atlantic","Bel Air","Malibu","Atlantic X","Bel Air X","Avalon X","Cancun X","Malibu X","Crown","Monarch","Royal","Legacy","El Grande","Newporter"],"AquaSolus":["Brook","Cypress","Zephyr","Cove","Sierra","Eden","Harmony","Calma","Aspen","Cascade","Serenity","Solstice","Zenith"],"Eco Spas":["E1","E2","E3","E4","E5","E5 DLUX","E6","E6 DLUX"],"Innova Spas":["Storm","Fantom","Monsoon","Stream 110V","Stream 220V"]};
const FACTORY_OPTIONS_2026=(async()=>{
 const input=Uint8Array.from(atob('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'),c=>c.charCodeAt(0));
 const stream=new Blob([input]).stream().pipeThrough(new DecompressionStream('deflate'));
 return JSON.parse(await new Response(stream).text());
})();

const SPA_CONFIGURATION={
 'American Whirlpool':{shell:['Storm Clouds','Silver Marble','Midnight Canyon','Smokey Mountain','Glacier Mountain','Tuscan Sun'],cabinet:['Resort Gray','Light Fog','Modern Mocha','Charcoal']},
 'Vita Spa':{shell:['Storm Clouds','Silver Marble','Midnight Canyon','Smokey Mountain','Glacier Mountain','Tuscan Sun'],cabinet:['Resort Gray','Light Fog','Modern Mocha','Charcoal']},
 'Cal Spas':{shell:['Sterling Silver','Glacier Mountain','Storm Clouds','Smoky Mountain','Tuscan Sun','Midnight Canyon','High Gloss White','Moulin Rouge','Champagne Dreams','Arctic Blue','Ocean Wave Opal','Odyssey'],cabinet:['Smoke','Mist','Taupe']},
 'AquaSolus':{shell:['Sterling Silver','Odyssey Grey'],cabinet:['Lunar Grey']},'Eco Spas':{shell:['Greystone','Harvestone','Sandstone'],cabinet:["Stack Stone — Brown","Stack Stone — Latte","Stack Stone — Black","Stack Stone — Dolphin","Rattan — Brown","Rattan — Latte","Rattan — Black","Rattan — Dolphin"]},'Innova Spas':{shell:[],cabinet:[]}
};

function calCabinetsForModel(model){
 const m=String(model||'').trim().toUpperCase();
 if(!m)return [];
 // Escape X factory part numbers are EC-...X (including BX, LX and DLX).
 if(/^EC-[A-Z0-9-]+X$/.test(m)||/\b(?:ESCAPE\s*)?X(?:\s*SERIES)?$/.test(m))
  return ['Grey','Mocha','Lime Oak']; // Elite Plus
 // Patio / Patio Plus and non-X Escape / Deck have Cal Edge cabinets.
 if(/^(DE-|PL-)/.test(m))return ['Grey','Mocha','Lime Oak'];
 if(/^(PZ-|PPZ-|EC-)/.test(m))return ['Smoke','Mist','Taupe'];
 // Other collections have separate cabinets: don't invent factory choices.
 return [];
}

function innovaDoorPanels(model,shell){
 const m=String(model||'').toLowerCase(),s=String(shell||'').toLowerCase();
 if(!s)return [];
 if(m.startsWith('stream')||m==='monsoon')return ['Black doors'];
 if(m==='storm')return [s==='midnight grey'?'Grey doors':'Black doors'];
 if(m==='fantom')return ['Integrated shell-matched panels'];
 return [];
}

window.HTFO_SPA_CATALOG={models:MODELS,configuration:SPA_CONFIGURATION,factoryOptions:FACTORY_OPTIONS_2026,calCabinetsForModel,innovaDoorPanels};
})();
