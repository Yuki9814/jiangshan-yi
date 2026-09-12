'use strict';
// One-time, exact-match migration on the isolated implementation branch.
// Removed before the final PR merge; runtime never executes this file.
const fs = require('node:fs');
const path = require('node:path');
process.chdir(path.resolve(__dirname, '..'));
if (fs.readFileSync('engine.js', 'utf8').includes("version: '1.2.0'")) {
  console.log('Implementation already applied; validating current sources.'); process.exit(0);
}
const files = new Map();
function read(file) { if (!files.has(file)) files.set(file, fs.readFileSync(file, 'utf8')); return files.get(file); }
function edit(file, before, after, count = 1) {
  const text = read(file);
  if (typeof before === 'string') {
    const parts = text.split(before); if (parts.length - 1 !== count) throw new Error(`${file}: expected ${count} occurrences of ${before.slice(0, 100)}, got ${parts.length - 1}`);
    files.set(file, parts.join(after));
  } else {
    if (!before.test(text)) throw new Error(`${file}: missing guarded pattern ${before}`);
    files.set(file, text.replace(before, after));
  }
}
function append(file, text) { files.set(file, read(file) + text); }
edit('engine.js', "'use strict';", "'use strict';\nconst ORDER_RULES = typeof module !== 'undefined' && module.exports ? require('./military-orders.js') : globalThis.MilitaryOrders;");
edit('engine.js', 'frontTarget - source.troops - moved', 'frontTarget - source.troops');
edit('engine.js', /  \/\/ Once the decisive phase[\s\S]*?    : null;\n/, '  // Every eligible faction retains its turn, including late-game defenders.\n');
edit('engine.js', '    if (endgameLeader && factionId !== endgameLeader) continue;\n', '');
edit('engine.js', "version: '1.1.0'", "version: '1.2.0'");
edit('engine.js', '    expeditions: input.expeditions !== false,\n    autoWar,', "    expeditions: input.expeditions !== false,\n    council: input.council === true,\n    playerFactionId: factionIds.includes(input.playerFactionId) ? input.playerFactionId : factionIds[0],\n    autoWar,");
edit('engine.js', "    campaignPhase: 'domestic',\n    domesticWinner: null,", "    campaignPhase: 'domestic',\n    resumePhase: 'domestic',\n    orderBudgets: {},\n    domesticWinner: null,");
edit('engine.js', '  const current = campaignPhase(state);\n  if (phase === current)', "  const current = campaignPhase(state);\n  if (phase === 'domestic' && state.worldMode && state.domesticWinner) {\n    return { ok: false, reason: '海内已经平定，不能恢复已结束的国内争夺。可开启或继续域外征程。' };\n  }\n  if (phase === current)");
edit('engine.js', '  state.campaignPhase = phase;\n  applyCampaignPosture(state, phase);', "  state.resumePhase = phase === 'truce' ? current : phase;\n  state.campaignPhase = phase;\n  applyCampaignPosture(state, phase);");
edit('engine.js', '    faction.grain = clamp(faction.grain + income - maintenance, 0, 1100);', '    faction.resourceLedger = { month: state.month, income, maintenance };\n    faction.grain = clamp(faction.grain + income - maintenance, 0, 1100);');
// Eligibility queries must not initialise or mutate state.
const startQuery = read('engine.js').indexOf('function canStartExpedition(');
const endQuery = read('engine.js').indexOf('function startExpeditionInternal(');
let query = read('engine.js').slice(startQuery, endQuery);
query = query.replace("  if (!Array.isArray(state.expeditions)) state.expeditions = [];\n  if (!state.expeditionCooldowns || typeof state.expeditionCooldowns !== 'object') {\n    state.expeditionCooldowns = Object.create(null);\n  }\n", '');
query = query.replace('state.expeditions.some(', '(state.expeditions || []).some(').replace('state.expeditionCooldowns[expeditionCooldownKey(actorId, site.id)]', '(state.expeditionCooldowns || {})[expeditionCooldownKey(actorId, site.id)]');
files.set('engine.js', read('engine.js').slice(0, startQuery) + query + read('engine.js').slice(endQuery));
const accounting = `function accountBattle(before, source, target, committed, attackerLosses, defenderLosses, won, advantage) {
  const removed = before.source + before.target - source.troops - target.troops - attackerLosses - defenderLosses;
  return {
    before, after: { source: source.troops, target: target.troops }, committed,
    losses: { attacker: attackerLosses, defender: defenderLosses },
    dispersed: Math.max(0, removed), levies: Math.max(0, -removed),
    returned: won ? 0 : Math.max(0, source.troops - (before.source - committed)),
    surrendered: won ? Math.max(0, before.target - defenderLosses) : 0,
    advantage, outcome: won ? 'victory' : 'defeat'
  };
}

`;
edit('engine.js', 'function executeAttack(', accounting + 'function executeAttack(');
const attackStart = read('engine.js').indexOf('function executeAttack(');
const attackEnd = read('engine.js').indexOf('function runCampaign(');
let attack = read('engine.js').slice(attackStart, attackEnd);
attack = attack.replace('  const targetFactionId = target.owner;', '  const before = { source: source.troops, target: target.troops };\n  const targetFactionId = target.owner;');
attack = attack.replace("    appendEvent(state, events, 'battle',", "    const accounting = accountBattle(before, source, target, power.committed, attackerLosses, defenderLosses, true, advantage);\n    appendEvent(state, events, 'battle',");
attack = attack.replace("  appendEvent(state, events, 'battle',", "  const accounting = accountBattle(before, source, target, power.committed, attackerLosses, defenderLosses, false, advantage);\n  appendEvent(state, events, 'battle',");
// The second replacement above must target the failure branch, not the nested success call.
attack = attack.replace('    const accounting = accountBattle(before, source, target, power.committed, attackerLosses, defenderLosses, true, advantage);\n    const accounting = accountBattle(before, source, target, power.committed, attackerLosses, defenderLosses, false, advantage);\n  appendEvent', '    const accounting = accountBattle(before, source, target, power.committed, attackerLosses, defenderLosses, true, advantage);\n    appendEvent');
const failureMarker = "  faction.morale = clamp(faction.morale - 0.018, 0.45, 1.2);\n  appendEvent(state, events, 'battle',";
attack = attack.replace(failureMarker, "  faction.morale = clamp(faction.morale - 0.018, 0.45, 1.2);\n  const accounting = accountBattle(before, source, target, power.committed, attackerLosses, defenderLosses, false, advantage);\n  appendEvent(state, events, 'battle',");
attack = attack.replaceAll('details: `进攻方伤亡=', 'result: accounting,\n    details: `进攻方伤亡=');
attack = attack.replaceAll('力量比=${advantage.toFixed(2)}`', '力量比=${advantage.toFixed(2)}；未能归队=${accounting.dispersed}；接收守军=${accounting.surrendered}；临时征募=${accounting.levies}`');
files.set('engine.js', read('engine.js').slice(0, attackStart) + attack + read('engine.js').slice(attackEnd));
const council = `function canIssueOrder(state, map, actor, kind, regionId) {
  return ORDER_RULES.plan(state, map, actor, kind, regionId);
}
function issueOrder(state, map, actor, kind, regionId) {
  const result = ORDER_RULES.apply(state, map, actor, kind, regionId);
  if (!result.ok) return result;
  appendEvent(state, state.lastEvents, 'order', state.factions[actor].name + '在' + map.regions[regionId].name + '下令' + result.name + '。', {
    actor, to: regionId, success: true, order: result,
    details: '耗粮=' + result.grainCost + '；实际增益=' + result.gain + '；本季军令剩余=' + ORDER_RULES.budget(state, actor).remaining
  });
  updateFactionSnapshots(state);
  return result;
}
function runCouncilAI(state, context) {
  if (!state.options.council) return;
  for (const actor of participantIds(state)) {
    const faction = state.factions[actor];
    if (actor === state.options.playerFactionId || !faction.alive || faction.lordId || faction.grain < 120) continue;
    if (state.worldMode && campaignPhase(state) !== 'world' && stateIsForeignFaction(state, actor)) continue;
    if (ORDER_RULES.budget(state, actor).remaining < 1) continue;
    const owned = ownedRegions(state, actor).slice().sort((a, b) => a.development - b.development || a.id - b.id);
    let done = false;
    for (const region of owned) {
      const front = context.adjacency[region.id].some(id => state.regions[id].owner !== actor);
      const kinds = front && region.troops < 70 ? ['muster', 'fortify', 'farm'] : region.development < 18 ? ['farm', 'fortify'] : ['fortify'];
      for (const kind of kinds) {
        if (canIssueOrder(state, context, actor, kind, region.id).allowed) { issueOrder(state, context, actor, kind, region.id); done = true; break; }
      }
      if (done) break;
    }
  }
}

`;
edit('engine.js', 'function step(state, map) {', council + 'function step(state, map) {');
edit('engine.js', '  developAndRecruit(state, context, random, events);', '  developAndRecruit(state, context, random, events);\n  runCouncilAI(state, context);');
edit('engine.js', '  createGame,\n  step,', '  createGame,\n  canIssueOrder,\n  issueOrder,\n  step,');
edit('engine.js', "  if (!Array.isArray(state.expeditionSites)) throw new Error('WarEngine invariant: expedition sites missing');", `  if (state.options && state.options.council === true && !selectedFactionIds(state).includes(state.options.playerFactionId)) throw new Error('WarEngine invariant: invalid player faction');
  for (const [actor, budget] of Object.entries(state.orderBudgets || {})) {
    if (!ids.includes(actor) || !budget || !Number.isInteger(budget.used) || budget.used < 0 || budget.used > 3 || !Number.isInteger(budget.quarter) || budget.quarter < 0 || budget.quarter > Math.floor(state.month / 3)) throw new Error('WarEngine invariant: invalid order budget');
  }
  if (!Array.isArray(state.expeditionSites)) throw new Error('WarEngine invariant: expedition sites missing');`);
// Session integration and complete searchable event history.
edit('app.js', 'const engine=window.WarEngine,maps=', 'const engine=window.GameSession.wrap(window.WarEngine),maps=');
edit('app.js', '  let campaign;', "  let campaign,experience;\n  let eventLimit=80,eventRenderKey='';");
edit('app.js', 'function stop(){playing=false;clearInterval(timer);timer=null;updateControls()}', 'function stop(){playing=false;clearInterval(timer);timer=null;updateControls();void experience?.save(false)}');
edit('app.js', 'function start(){if(state.finished)return;', 'function start(){if(!state||state.finished)return;');
edit('app.js', '    stop();const normalized=', "    stop();eventLimit=80;eventRenderKey='';const normalized=");
edit('app.js', '推演已暂停：状态检查未通过，请重开。', '推演已暂停，并恢复到上一个有效月份。可保存后重试。');
edit('app.js', "button.disabled=state.finished||(truce&&!!state.domesticWinner);button.textContent=phase==='world'?'止戈休整':truce?'再启烽烟':'天下息兵';", "button.disabled=state.finished||(truce&&!!state.domesticWinner&&state.resumePhase!=='world');button.textContent=phase==='world'?'止戈休整':truce?(state.resumePhase==='world'?'续征域外':'再启烽烟'):'天下息兵';");
edit('app.js', "const phase=state.campaignPhase==='truce'?'domestic':'truce',result=", "const phase=state.campaignPhase==='truce'?(state.resumePhase||'domestic'):'truce',result=");
edit('app.js', "if(map.worldMode)$('roster-filter').value='china';render(false);", "if(map.worldMode)$('roster-filter').value=phase==='world'?'all':'china';render(false);");
edit('app.js', "if(phase==='domestic'||wasPlaying)start();toast(phase==='domestic'?", "if(phase!=='truce'||wasPlaying)start();toast(phase==='world'?'继续域外征程，国内维持息兵。':phase==='domestic'?");
edit('app.js', 'renderVictory();updateControls();updateWarControl();', 'renderVictory();updateControls();updateWarControl();experience?.changed();');
edit('app.js', "$(`${key}-tab`).tabIndex=key==='events'||key===tabName?0:-1;", "$(`${key}-tab`).tabIndex=key===tabName?0:-1;");
edit('app.js', '$(`${key}-panel`).hidden=key!==tabName;}}', "$(`${key}-panel`).hidden=key!==tabName;}if(tabName==='events')renderEvents();}");
const eventsStart = read('app.js').indexOf('  function renderEvents(){');
const eventsEnd = read('app.js').indexOf('  function renderVictory(){');
const eventCode = `  function renderEvents(){
    if(!state)return;
    const category=$('event-category').value,query=$('event-search').value.trim().toLowerCase();
    const matched=state.events.filter(e=>(category==='all'||(category==='war'?warKinds.includes(e.type):category==='coalition'||category==='expedition'?String(e.type).startsWith(category):e.type===category))&&(!query||(String(e.text)+' '+String(e.details||'')).toLowerCase().includes(query)));
    $('event-count').textContent=matched.length;
    const key=[map.id,state.seed,state.month,state.eventCounter,category,query,eventLimit].join('|');
    if(activeTab==='events'&&key!==eventRenderKey){
      eventRenderKey=key;
      const events=matched.slice(-eventLimit).reverse();
      $('event-list').innerHTML=events.length?events.map(e=>'<button class="event-item" data-event="'+escape(e.id)+'"><small><span>'+briefDate(e.month)+'</span><span class="event-kind">'+eventLabel(e)+'</span></small><p>'+escape(e.text)+'</p>'+(e.details?'<div class="event-detail">'+escape(String(e.details).replaceAll('=', '：'))+'</div>':'')+'</button>').join(''):'<p class="event-empty">没有符合条件的战报。</p>';
      $('event-more').hidden=matched.length<=eventLimit;
      $('event-more').textContent='加载更早战报（已显示 '+Math.min(eventLimit,matched.length)+' / '+matched.length+'）';
    }
    const latest=state.lastEvents.findLast?.(e=>['phase','allegiance','tactic','victory','eliminate','order'].includes(e.type))||state.lastEvents.findLast?.(e=>warKinds.includes(e.type))||state.events[state.events.length-1];
    $('latest-event').textContent=latest?briefDate(latest.month)+'　'+latest.text:'诸将已至，点击「开始推演」静观风云。';
  }
`;
files.set('app.js', read('app.js').slice(0, eventsStart)+eventCode+read('app.js').slice(eventsEnd));
edit('app.js', "$('event-category').onchange=renderEvents;", "$('event-category').onchange=()=>{eventLimit=80;renderEvents()};$('event-search').oninput=()=>{eventLimit=80;renderEvents()};$('event-more').onclick=()=>{eventLimit+=80;renderEvents()};");
edit('app.js', "e.preventDefault();newGame($('seed-input').value);", "e.preventDefault();if(state.month>0&&!window.confirm('重开将替换当前进度。重要战局建议先导出存档，继续？'))return;newGame($('seed-input').value);");
edit('app.js', "  newGame($('seed-input').value);switchTab('ranking');", `  function restoreGame(loaded){
    stop();map=loaded.map;atlas.setMap(map);engine.bindMap(map);state=loaded.state;campaign.config=loaded.config;
    $('seed-input').value=state.seed;victoryDismissed=false;eventLimit=80;eventRenderKey='';selected={type:'faction',id:state.selectedFactionIds[0],highlight:false};
    updateMapDescription();atlas.reset();if(map.worldMode&&state.campaignPhase!=='world')atlas.focusArea({x:1240,y:145,w:360,h:245});atlas.clearEffects();$('inspector').hidden=true;syncDetails();render(false);
  }
  experience=new ExperienceUI({engine,maps,getState:()=>state,getMap:()=>map,getSelected:()=>selected,onPause:stop,onRefresh:()=>render(false),onRestore:restoreGame,toast});
  async function boot(){
    document.body.inert=true;
    try{if(!await experience.restoreLatest())newGame($('seed-input').value);experience.activate();switchTab('ranking');}
    finally{document.body.inert=false;}
  }
  window.jiangshanReady=boot();`);
// New-game mode selection remains opt-in and is persisted with the roster.
const modeHtml = "<label><input id=council-option type=checkbox ${this.draft.council?'checked':''}> 有限军议</label><label class=council-player-label>执掌势力<select id=council-player aria-label=执掌势力></select></label>";
edit('campaign-ui.js', '<div class="campaign-options">', '<div class="campaign-options">'+modeHtml);
edit('campaign-ui.js', "$('setup-start').onclick=()=>{if(this.draft.factionIds.length", "$('council-option').onchange=()=>this.updateSetupSummary();\n      $('setup-start').onclick=()=>{if(this.getState()?.month>0&&!window.confirm('新开局会替换当前战局，重要进度建议先导出。继续？'))return;if(this.draft.factionIds.length");
edit('campaign-ui.js', "this.draft.coalitions=$('coalitions-option').checked;", "this.draft.council=$('council-option').checked;this.draft.playerFactionId=$('council-player').value;this.draft.coalitions=$('coalitions-option').checked;");
edit('campaign-ui.js', "      $('pick-count').textContent=", `      const chooser=$('council-player'),previous=chooser.value||this.draft.playerFactionId;
      chooser.innerHTML=this.draft.factionIds.map(id=>'<option value="'+esc(id)+'">'+esc(this.byId[id].name)+'</option>').join('');
      chooser.value=this.draft.factionIds.includes(previous)?previous:this.draft.factionIds[0]||'';chooser.disabled=!$('council-option').checked;
      $('pick-count').textContent=`);
// Explicit script order preserves the no-build, offline distribution.
edit('index.html', '<button id="help-button"', '<button id="experience-button" class="text-button">存档 · 军令</button><button id="help-button"');
edit('index.html', '<div id="event-list"></div>', '<label class="history-search">检索战史<input id="event-search" type="search" placeholder="人物、地点或战报关键词" aria-label="检索战史"></label><div id="event-list"></div><button id="event-more" class="plain-button" hidden>加载更早战报</button>');
edit('index.html', '<dialog id="setup-dialog"', '<dialog id="experience-dialog" aria-labelledby="experience-title"></dialog><input id="save-file" type="file" accept=".json,application/json" hidden><dialog id="setup-dialog"');
edit('index.html', '<script src="engine.js?', '<script src="military-orders.js?v=20260912-council"></script><script src="engine.js?');
edit('index.html', '<script src="app.js?', '<script src="game-session.js?v=20260912-council"></script><script src="experience-ui.js?v=20260912-council"></script><script src="app.js?');
edit('index.html', '普天之下，莫非王土</button>', '开启域外</button>');
// Cursor-anchored zoom for the existing xMinYMin SVG viewport.
edit('map-view.js', 'this.zoomBy(e.deltaY<0?1.12:1/1.12);', 'this.zoomBy(e.deltaY<0?1.12:1/1.12,{x:e.clientX,y:e.clientY});');
edit('map-view.js', /    zoomBy\(factor\)\{[^\n]+\}\n/, `    zoomBy(factor,anchor=null){
      if(!Number.isFinite(factor)||factor<=0)return;
      const next=Math.max(this.minZoom||.65,Math.min(this.map.worldMode?18:3.5,this.zoom*factor)),actual=next/this.zoom;
      const rect=this.svg.getBoundingClientRect(),pixel=Math.min(rect.width/this.view.w,rect.height/this.view.h)||1;
      const x=anchor?(anchor.x-rect.left)/pixel:this.view.w/2,y=anchor?(anchor.y-rect.top)/pixel:this.view.h/2;
      this.zoom=next;this.view.x+=x*(1-1/actual);this.view.y+=y*(1-1/actual);this.view.w/=actual;this.view.h/=actual;this.applyView();
    }
`);
append('styles.css', `
/* Readable council, complete history and touch-sized controls. */
#experience-dialog{width:800px;max-height:90dvh}.experience-body{padding:24px;display:grid;gap:24px}.experience-body section+section{border-top:1px solid var(--line);padding-top:20px}.experience-body h3{font:600 21px var(--serif);margin-bottom:10px}.experience-body p{font-size:14px;line-height:1.8}.experience-note{color:var(--muted);font-size:12px!important;margin-top:12px}.save-actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.save-actions button{border:1px solid var(--line);min-height:44px;padding:8px 13px;font-size:14px}.order-target{display:flex;align-items:center;gap:12px;margin:14px 0;font-size:14px}.order-target select{min-height:44px;flex:1;min-width:0}.order-choices{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.order-choices article{display:flex;flex-direction:column;padding:16px;border:1px solid var(--line);background:#ede9da66}.order-choices h4{margin:0 0 8px;font:600 22px var(--serif)}.order-choices p{font-size:13px}.order-choices small{display:block;min-height:46px;color:var(--muted);margin:10px 0}.order-choices button{min-height:44px;width:100%;margin-top:auto}.history-search{display:flex;flex-direction:column;gap:5px;font-size:12px;padding:4px 0 10px}.history-search input{width:100%;min-height:36px;border:1px solid var(--line);background:var(--paper);padding:6px;font:13px var(--sans)}#event-more{width:100%;white-space:normal;min-height:44px;justify-content:center}.event-item p{font-size:14px}.event-detail{font-size:12px}.event-item small{font-size:12px;justify-content:space-between}.commander-shell{min-width:0}.council-player-label{max-width:100%;flex-wrap:wrap}.council-player-label select{max-width:150px}
@media(max-width:1000px){.summary-metric.grain{display:none}.commander-style{max-width:100px;overflow:hidden;text-overflow:ellipsis}.header-actions{gap:12px}.entertainment-note{display:none}}
@media(max-width:760px){
:root{--header:104px;--footer:72px}body{height:100dvh;overflow:hidden}.app-header{height:var(--header);padding:7px 12px;display:flex;flex-wrap:wrap;align-content:center;gap:3px}.brand{gap:9px}.brand h1{font-size:28px}.brand-note{display:none}.header-actions{width:100%;max-width:100%;min-width:0;overflow-x:auto;flex-shrink:0;gap:17px;min-height:42px}.header-actions .text-button{font-size:13px;padding:10px 0;flex-shrink:0}.workspace{display:flex;flex-direction:column;height:calc(100dvh - var(--header) - var(--footer));min-height:0}.theater{order:0;flex:1;min-height:0;height:auto}.side-rail{order:1;flex:0 0 155px;width:100%;height:155px;min-height:0;border-right:0;border-top:1px solid var(--line)}.roster-heading,.rail-foot{display:none}.rail-tabs{height:32px;min-height:32px;justify-content:flex-start}.rail-tabs button{font-size:13px;min-height:30px}.ranking-panel{padding:3px 8px;overflow:auto}.roster-filter-label{padding:1px 4px 3px}#ranking-list{display:flex;height:auto;overflow-x:auto;gap:8px}.faction-row{flex:0 0 156px;min-height:64px}.roster-portrait{width:38px;height:44px}.row-main .name{font-size:16px}.events-panel{overflow:auto}.event-filter{padding:4px 0}.history-search input{min-height:40px}.control-bar{height:var(--footer);min-height:var(--footer);padding:6px 10px max(6px,env(safe-area-inset-bottom));gap:0}.seed-controls,.war-digest{display:none}.play-controls{width:100%;gap:5px;justify-content:space-between}.play-controls .primary-button{font-size:14px;padding:0 10px;min-height:44px}.play-controls .plain-button{min-height:44px;font-size:13px}.speed-control button{min-height:44px;min-width:36px;padding:7px 8px}.commander-shell{width:100%;height:50px;min-width:0}.commander-summary{gap:8px}.commander-portrait{width:48px;height:48px}.commander-style{display:none}.commander-summary h2{font-size:20px}.summary-metric{padding-left:8px;gap:5px}.summary-metric span{display:none}.summary-metric b{font-size:17px}.detail-toggle{min-height:44px;padding:0 8px;font-size:12px}.world-mode .map-heading{top:50px;left:0;right:0;min-height:42px;padding:3px 12px}.world-mode .time-display strong{font-size:16px}.war-order{top:99px;left:10px;max-width:calc(100% - 20px);padding:6px 8px;gap:5px}.war-order>span{font-size:11px}.war-order button,.war-order .world-chapter{min-height:40px;font-size:12px}.map-tools button{min-width:40px;min-height:40px}.council-status{left:10px;bottom:24px;max-width:calc(100% - 160px);font-size:11px}.map-caption{left:10px;bottom:6px;font-size:9px}.inspector{position:fixed;inset:auto 12px calc(var(--footer) + 10px);width:calc(100vw - 24px);max-height:60dvh;overflow:auto;z-index:20}.order-choices{grid-template-columns:1fr}.experience-body{padding:18px}.experience-body p{font-size:14px}.dialog-header{padding:14px 18px}.dialog-header h2{font-size:22px;letter-spacing:1px}.dialog-header button{min-height:44px}.china-islands{display:none}.setup-body{max-height:calc(90dvh - 190px)}
}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important}}
`);
// Stable origin is required for browser-local saves across launcher restarts.
edit('launcher.py', "default=0, help='默认自动选择空闲端口'", "default=8765, help='默认 8765，保持存档地址稳定；0 为临时随机端口'");
edit('launcher.py', "    server = ThreadingHTTPServer(('127.0.0.1', args.port), partial(LocalFiles, directory=str(root)))", "    try:\n        server = ThreadingHTTPServer(('127.0.0.1', args.port), partial(LocalFiles, directory=str(root)))\n    except OSError as error:\n        print(f'无法启动本机端口 {args.port}：{error}。可关闭旧启动器，或使用 --port 指定端口；更换端口会使用另一份浏览器存档。', file=sys.stderr)\n        raise SystemExit(1) from error");
edit('launcher.py', "    print(f'江山弈已就绪：{address}', flush=True)", "    print(f'江山弈已就绪：{address}', flush=True)\n    if args.port == 0:\n        print('当前为临时随机地址：关闭前请导出存档，重新启动后地址可能不同。', flush=True)");
edit('.github/workflows/ci.yml', '          node engine.test.cjs', '          node review-regressions.test.cjs\n          node engine.test.cjs');
append('.github/workflows/ci.yml', `
  browser:
    name: Browser save and council flows
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: '22'
      - run: npm install --no-save --package-lock=false --ignore-scripts playwright@1.55.0
      - run: npx playwright install --with-deps chromium
      - run: node source-tools/review-browser.test.cjs
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: browser-evidence
          path: work/review-*.png
          if-no-files-found: ignore
`);
append('RULES.md', `
## 1.2 版军议、战报与存档

有限军议为可选模式。开局选择执掌势力，每季度有 3 次军令；月 0–2 为首季，月 3 开始恢复。固守消耗 40 军粮、城防增加最多 6；屯田消耗 55 军粮、发展增加最多 2；集结消耗 30 军粮，从相邻己方陆地调集最多 60 兵，来源保留守军。目标兵力上限 260，建设城防上限 60、发展上限 22。失败命令不扣资源。其他势力使用相同军令成本与上限自动决策。

420 月之后所有合法参战势力仍有主动进攻资格。既有决胜阶段的力量阈值仍保留，尚非完全中性的战斗平衡重做。战斗事件 result 记录双方战前战后兵力、伤亡、未能归队、接收守军与临时征募，满足单场兵员对账；未能归队不等于阵亡。

息兵会记住当前篇章；域外息兵后可选择续征域外，不再默默切回国内争夺。已经平定的国内篇章拒绝复战命令。

浏览器通过 GameSession 执行带回滚保护的命令与推进，记录月份及同月顺序。存档包含 1.2 规则版本、地图人物数据标识、随机状态和命令记录；不兼容存档会被拒绝，不会直接套用旧规则。GameSession.replay 可重算记录，界面当前提供快照恢复与导入导出，尚无时间轴拖动回放。

本地存档保存在当前浏览器、当前地址的 IndexedDB。每 12 月、下令和暂停时自动保存，保留上次成功保存的备份；刷新自动恢复并暂停。浏览器关闭瞬间不保证异步写入完成，重要战局应手动保存或导出。默认启动端口固定为 8765；改端口、换浏览器或清理数据后需要导入文件。
`);
append('README.md', `
## 1.2 版新增

- 存档与军令：本地自动保存、刷新恢复、上份备份、JSON 导入导出；启动器默认固定 8765 端口。
- 可选有限军议：选定一家势力，每季三道军令；固守、相邻集结、屯田都有明确成本和上限。
- 完整战史：关键词检索和更早战报分页，不再只能访问最近 80 条。
- 推演修复：援军补充、阶段校验、域外休战恢复和 420 月后的行动资格；战斗兵员流向可对账。
- 新增回归测试与 Chromium 桌面、390/320 像素触屏交互检查。规则改变后旧种子的结局可能变化。
`);
for (const [file, text] of files) fs.writeFileSync(file, text);
console.log('Applied guarded edits to: ' + Array.from(files.keys()).join(', '));
