(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const format=n=>new Intl.NumberFormat('zh-CN',{maximumFractionDigits:0}).format(n||0);
  const phaseNames={development:'休养生息',war:'群雄交锋',attrition:'长战消耗',decisive:'决胜之势',victory:'山河归一'};
  const terrainNames={plain:'平原',mountain:'山地',river:'河川'};
  const kinds={phase:'诏令',develop:'发展',battle:'交锋',capture:'易主',eliminate:'退场',victory:'统一',system:'纪事',allegiance:'归顺',tactic:'计谋',coalition:'结盟',coalition_end:'解盟',expedition:'远征',expedition_start:'出征',expedition_result:'远征战果'};
  const engine=window.WarEngine,maps=[...(window.WORLD_MAP?[window.WORLD_MAP]:[]),...(window.MAP_CATALOG||[{...window.MAP_DATA,id:'central',name:'中原逐鹿'}])];
  let map=maps[0];
  if(!map||!engine){$('inspector').hidden=false;$('inspector').innerHTML='<h2>资源未载入</h2><p>请保留完整文件夹，并重新打开 index.html。</p>';$('play-button').disabled=true;return;}
  const factions=engine.FACTIONS,byId=Object.fromEntries(factions.map(f=>[f.id,f]));
  const attributes=engine.ATTRIBUTES||[],relationships=engine.RELATIONSHIPS||[];
  const eventLabel=e=>e.pursuit?'追击':e.type==='coalition'?({form:'结盟',coordinate:'协同',expire:'届满',dissolve:'解盟'}[e.action]||'盟约'):e.type==='expedition'?({started:'出征',victory:'凯旋',defeat:'受挫',cancelled:'中止'}[e.status]||'远征'):kinds[e.type]||'纪事';
  const warKinds=['battle','capture','eliminate','victory','allegiance','tactic'];
  const portrait=id=>escape((byId[id]?.portrait||`assets/portraits/${id}.webp`)+'?v=20260912-chronicle');
  let campaign;
  let state,playing=false,speed=1,timer=null,selected={type:'faction',id:'hanxin',highlight:false},activeTab='ranking',victoryDismissed=false,toastTimer;
  const urlSeed=new URLSearchParams(location.search).get('seed');
  $('seed-input').value=(urlSeed||'江山-2026').slice(0,48);
  const atlas=new AtlasView($('world-map'),map,factions,selectRegion,selectFaction);
  const date=(month)=>month===0?'开局 · 一月':`第 ${Math.floor((month-1)/12)+1} 年 · ${((month-1)%12)+1} 月`;
  const briefDate=(month)=>month===0?'开局':`${Math.floor((month-1)/12)+1} 年 ${((month-1)%12)+1} 月`;
  const toast=text=>{$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,2500)};
  function stop(){playing=false;clearInterval(timer);timer=null;updateControls()}
  function start(){if(state.finished)return;playing=true;clearInterval(timer);timer=setInterval(()=>advance(),900/speed);updateControls()}
  function toggle(){playing?stop():start()}
  function advance(){
    if(state.finished){stop();return;}
    try{const priorDomesticWinner=state.domesticWinner;engine.step(state,map);if(state.finished&&state.winner)selected={type:'faction',id:state.winner,highlight:false};render(true);if(state.finished)stop();else if(!priorDomesticWinner&&state.domesticWinner){stop();toast('海内已定，诸侯息兵。可另启「普天之下，莫非王土」。');}}
    catch(error){stop();toast('推演已暂停：状态检查未通过，请重开。');console.error(error);}
  }
  function newGame(seed,config=campaign?.config){
    stop();const normalized=String(seed||'江山-2026').trim().slice(0,48)||'江山-2026';
    const nextMap=maps.find(m=>m.id===config?.mapId)||map;
    if(nextMap!==map){map=nextMap;atlas.setMap(map);}
    state=engine.createGame(map,normalized,config||{});$('seed-input').value=normalized;victoryDismissed=false;selected={type:'faction',id:state.participantIds?.[0]||Object.keys(state.factions)[0],highlight:false};
    updateMapDescription();
    atlas.reset();if(map.worldMode)atlas.focusArea({x:1240,y:145,w:360,h:245});atlas.clearEffects();$('inspector').hidden=true;syncDetails();render(false);
  }
  function randomSeed(){const n=new Uint32Array(1);crypto.getRandomValues(n);return `江山-${n[0].toString(36).toUpperCase()}`}
  function selectRegion(id){selected={type:'region',id};$('inspector').hidden=false;syncDetails();render(false)}
  function activeLord(id){const lord=state.factions[id]?.lordId;return lord&&state.factions[lord]?.alive?lord:null;}
  function personStatus(id){const f=state.factions[id],lord=activeLord(id);if(!f)return '未出场';return lord?`辅佐${byId[lord].name}`:f.alive?'独立领军':f.lordId?`随${byId[f.lordId].name}退场`:'已退场';}
  function selectedLeader(){const id=selected.type==='faction'?selected.id:state.regions[selected.id]?.owner;return activeLord(id)||id;}
  function updateWarControl(){
    const phase=state.campaignPhase||'domestic',truce=phase==='truce',button=$('truce-toggle');
    button.disabled=state.finished||(truce&&!!state.domesticWinner);button.textContent=phase==='world'?'止戈休整':truce?'再启烽烟':'天下息兵';
    $('chapter-status').textContent=phase==='world'?'副本 · 收服域外':truce?state.domesticWinner?'主线 · 山河已定':'主线 · 天下息兵':'主线 · 九州逐鹿';
    $('world-chapter').hidden=!map.worldMode||phase==='world';$('world-chapter').disabled=!truce||state.finished||state.worldCompleted;$('world-chapter').title=state.worldCompleted?'域外已定':truce?'开启域外收服副本':'天下息兵后可开启';
    $('war-order').classList.toggle('active',phase==='world');
  }
  function selectFaction(id){if(!state.factions[id]){campaign.openCharacter(id);return;}const changed=selected.type!=='faction'||selected.id!==id;const highlight=!(selected.type==='faction'&&selected.id===id&&selected.highlight!==false);selected={type:'faction',id,highlight};render(false);if(changed)$('inspector').scrollTop=0;atlas.ensureVisible(activeLord(id)||id)}
  function updateControls(){
    if(!state)return;
    $('play-button').querySelector('span').textContent=state.finished?state.worldCompleted?'四海归一':'已一统山河':playing?'暂停推演':state.month?'继续推演':'开始推演';
    $('play-button').querySelector('img').src=`assets/icons/player-${playing?'pause':'play'}.svg`;
    $('play-button').disabled=state.finished;$('step-button').disabled=state.finished;
    $('run-status').textContent=state.finished?'终局':playing?'推演中':state.month?'已暂停':'待启程';$('run-status').classList.toggle('running',playing);
    document.querySelectorAll('[data-speed]').forEach(b=>b.setAttribute('aria-pressed',Number(b.dataset.speed)===speed));
  }
  function syncDetails(){const open=!$('inspector').hidden;$('detail-toggle').setAttribute('aria-expanded',open);$('detail-toggle').querySelector('span').textContent=open?'收起详情':'属性与关系';}
  function renderRelationships(id){
    const related=relationships.filter(r=>r.from===id||r.to===id);
    return `<section class="person-relations" aria-label="人物关系"><h3>人物关系 <span>${related.length} 条</span></h3>${related.length?related.map(r=>{
      const otherId=r.from===id?r.to:r.from,other=byId[otherId];
      const label=r.type==='allegiance'?(r.from===id?'旧主':'旧部'):r.name;
      const joined=r.type==='allegiance'&&state.factions[r.from]?.lordId===r.to;
      return `<button class="relation-card ${r.type}" data-person="${otherId}" aria-label="查看${other.name}的属性与关系"><img src="${portrait(otherId)}" alt=""><span class="relation-copy"><span class="relation-heading"><b>${other.name}</b><i>${escape(label)}${joined?' · 已归顺':!state.factions[otherId]?' · 未出场':''}</i></span><span class="relation-description">${escape(r.description)}</span></span></button>`;
    }).join(''):'<p class="relation-empty">暂无特殊羁绊，凭自身才能逐鹿。</p>'}</section>`;
  }
  function renderRetinue(id){
    const leader=activeLord(id)||id,members=factions.filter(f=>state.factions[f.id]?.lordId===leader),serving=activeLord(id);
    if(!members.length&&!serving)return '';
    const leaderAlive=state.factions[leader].alive,effective=leaderAlive?engine.effectiveStats(state,leader):byId[leader].stats;
    const gains=attributes.filter(a=>effective[a.key]>byId[leader].stats[a.key]).map(a=>`${a.label} +${Math.round((effective[a.key]-byId[leader].stats[a.key])*10)/10}`);
    return `<section class="retinue-section" aria-label="麾下人才"><h3>${serving?'效力势力':'麾下人才'}</h3>${serving?`<button class="person-chip lord-chip" data-person="${leader}">${byId[leader].name}麾下</button>`:''}<div class="retinue-list">${members.map(f=>`<button class="person-chip" data-person="${f.id}"><img src="${portrait(f.id)}" alt="">${f.name}<span>${escape(f.role||f.style)}</span></button>`).join('')}</div><p class="retinue-note">${leaderAlive?gains.length?`${byId[leader].name}阵营协同：${gains.join(' · ')}。`:'麾下人才共同辅佐。':'所属势力已退场。'}个人基础属性保持不变。</p></section>`;
  }
  function renderInspector(rows){
    if(selected.type==='faction'){
      const f=byId[selected.id],row=rows.find(r=>r.id===f.id),fs=state.factions[f.id];
      const lord=activeLord(f.id),forceRow=lord?rows.find(r=>r.id===lord):row;
      $('commander-summary').innerHTML=`<img class="commander-portrait" src="${portrait(f.id)}" alt="${f.name}头像"><h2>${f.name}</h2><span class="commander-style">${escape(f.role||f.style)} · ${personStatus(f.id)}</span><div class="summary-metric"><img class="icon" src="assets/icons/users-group.svg" alt=""><span>${lord?'势力兵力':'总兵力'}</span><b>${format(forceRow.troops)}</b></div><div class="summary-metric grain"><img class="icon" src="assets/icons/coins.svg" alt=""><span>军粮储备</span><b>${format(forceRow.grain)}</b></div>`;
      $('inspector').style.setProperty('--faction',f.color);
      $('inspector').innerHTML=`<div class="eyeline"><i class="color-dot" style="background:${f.color}"></i>${escape(f.era)} · ${personStatus(f.id)}${row.alive?` · ${row.territories} 地`:''}</div><div class="detail-title"><h2>${f.name}</h2><span class="style-tag">${escape(f.style)}</span></div><p class="detail-description">${escape(f.description)}</p><div class="attribute-heading"><h3>固定属性</h3><button data-open-chart="${f.id}">雷达与详解</button></div><div class="mini-chart">${campaign.miniRadar(f.id)}</div><div class="ability-grid" aria-label="固定人物属性">${attributes.map(a=>`<button class="ability" data-attribute-detail="${a.key}" title="${escape(a.description)}" aria-label="${a.label} ${f.stats[a.key]}，查看详解"><span>${a.label}</span><i><b style="width:${f.stats[a.key]}%"></b></i><em>${f.stats[a.key]}</em></button>`).join('')}</div>${renderRetinue(f.id)}${renderRelationships(f.id)}`;
    }else{
      const r=state.regions[selected.id],geo=map.regions[selected.id],f=byId[r.owner],place=map.worldMode&&geo.group==='china'?'中国 · ':'';
      $('commander-summary').innerHTML=`${f?`<img class="commander-portrait" src="${portrait(f.id)}" alt="${f.name}头像">`:''}<h2>${escape(geo.name)}</h2><span class="commander-style">${place}${terrainNames[geo.terrain]} · ${f?f.name+'治下':'中立地盘'}</span><div class="summary-metric"><img class="icon" src="assets/icons/users-group.svg" alt=""><span>驻守兵力</span><b>${format(r.troops)}</b></div>`;
      $('inspector').style.setProperty('--faction',f?.color||'#999e89');
      $('inspector').innerHTML=`<div class="eyeline"><i class="color-dot" style="background:${f?.color||'#aaa995'}"></i>${place}地盘详情 · ${terrainNames[geo.terrain]}</div><div class="detail-title"><h2>${escape(geo.name)}</h2><span class="style-tag">${f?f.name+'治下':'中立地盘'}</span></div><p class="detail-description">${geo.terrain==='mountain'?'山路险阻，守军更占地利。':geo.terrain==='river'?'河川交汇，进军须付出渡河代价。':'沃野通途，适合发展与正面推进。'}</p><div class="metrics"><div class="metric"><div class="value">${format(r.troops)}</div><div class="label">驻守兵力</div></div><div class="metric"><div class="value">${Number(r.development).toFixed(1)}</div><div class="label">发展度</div></div></div><div class="region-meta">城防 <b>${Number(r.fort).toFixed(1)}</b>　产粮系数 <b>${geo.fertility.toFixed(2)}</b><br>归属 ${f?`<button class="owner-link" data-owner="${f.id}">${f.name}</button>`:'中立守备'}　·　${geo.neighbors.length} 处相邻地盘</div>`;
      const owner=$('inspector').querySelector('[data-owner]');if(owner)owner.addEventListener('click',()=>selectFaction(owner.dataset.owner));
    }
  }
  function renderRanking(rows){
    $('rank-count').textContent=rows.filter(r=>r.alive).length;
    const largest=Math.max(...rows.map(r=>r.territories),1);
    const filter=$('roster-filter').value,required=new Set(map.requiredFactionIds||[]);
    const visible=factions.filter(f=>state.factions[f.id]&&(filter==='all'||filter==='active'&&state.factions[f.id].alive&&state.factions[f.id].aggressive||filter==='china'&&!required.has(f.id)||filter==='overseas'&&required.has(f.id))).map(f=>rows.find(r=>r.id===f.id));
    $('rank-count').textContent=visible.filter(r=>r.alive).length;
    $('roster-total').textContent=visible.length;$('roster-alive').textContent=visible.filter(r=>r.alive).length;
    $('ranking-list').style.setProperty('--participant-count',Math.max(visible.length,8));
    $('ranking-list').innerHTML=visible.map(r=>{const lord=activeLord(r.id);return `<button class="faction-row ${selected.type==='faction'&&selected.id===r.id?'selected':''} ${lord?'serving':r.alive?'':'dead'}" style="--faction:${r.color}" data-faction="${r.id}" aria-label="${r.name}，${lord?`归顺${byId[lord].name}`:`${r.territories}块领土，兵力${format(r.troops)}`}" aria-pressed="${selected.type==='faction'&&selected.id===r.id}"><img class="roster-portrait" src="${portrait(r.id)}" alt=""><div class="row-info"><div class="row-main"><span class="name">${r.name}</span><span class="land-count">${lord?'从'+byId[lord].name:r.alive?r.territories+' 地':'退场'}</span></div><div class="row-bar"><i style="background:${lord?byId[lord].color:r.color};width:${100*r.territories/largest}%"></i></div><small class="row-posture">${!r.alive?'已退场':state.factions[r.id].aggressive?'参战中':byId[r.id].region||'和平发展'}</small></div></button>`;}).join('')||'<p class="event-empty">当前没有符合条件的势力。</p>';
  }
  function renderEvents(){
    const category=$('event-category').value;
    const matched=state.events.filter(e=>category==='all'||(category==='war'?warKinds.includes(e.type):category==='coalition'||category==='expedition'?String(e.type).startsWith(category):e.type===category));
    $('event-count').textContent=matched.length;
    const events=matched.slice(-80).reverse();
    $('event-list').innerHTML=events.length?events.map(e=>`<button class="event-item" data-event="${escape(e.id)}" style="--faction:${byId[e.actor]?.color||'#6d7f68'}"><small><span>${briefDate(e.month)}</span><span class="event-kind">${eventLabel(e)}</span></small><p>${escape(e.text)}</p>${e.details?`<div class="event-detail">${e.type==='tactic'&&byId[e.defender]?`对手：${escape(byId[e.defender].name)}；`:''}${escape(String(e.details).replaceAll("=","："))}</div>`:''}</button>`).join(''):'<p class="event-empty">当前还没有这类战报。继续推演，观察局势变化。</p>';
    const latest=state.lastEvents.findLast?.(e=>['phase','allegiance','tactic','victory','eliminate'].includes(e.type))||state.lastEvents.findLast?.(e=>warKinds.includes(e.type))||state.events[state.events.length-1];
    $('latest-event').textContent=latest?`${briefDate(latest.month)}　${latest.text}`:'诸将已至，点击「开始推演」静观风云。';
  }
  function renderVictory(){
    if((!state.finished&&!state.worldCompleted)||victoryDismissed){$('victory-panel').hidden=true;return;}
    if(state.worldCompleted){$('victory-panel').hidden=false;$('victory-panel').innerHTML=`<h2>四海归一</h2><div class="world-victory-seal">天下归心</div><p>诸侯共定域外，山河暂息干戈。<br>本局已历 ${state.month} 个月。</p><button class="primary-button" id="victory-new">再开一局</button><button class="plain-button" id="victory-close">纵览山河</button>`;$('victory-new').onclick=()=>campaign.openSetup();$('victory-close').onclick=()=>{victoryDismissed=true;$('victory-panel').hidden=true;};return;}
    const f=byId[state.winner];$('victory-panel').hidden=false;
    $('victory-panel').innerHTML=`<img class="victory-portrait" src="${portrait(f.id)}" alt="${f.name}头像"><h2>山河归一</h2><div class="victory-name" style="color:${f.color}">${f.name}</div><p>历经 ${state.month} 个月，尽取 ${map.regions.length} 块地盘。<br>本局种子：${escape(state.seed)}</p><button class="primary-button" id="victory-new">再开一局</button><button class="plain-button" id="victory-replay">同种子重演</button><button class="plain-button" id="victory-close">查看终局地图</button>`;
    $('victory-new').onclick=()=>campaign.openSetup();$('victory-replay').onclick=()=>newGame(state.seed);$('victory-close').onclick=()=>{victoryDismissed=true;$('victory-panel').hidden=true;};
  }
  function render(animate){
    const focus=document.activeElement,focusFaction=focus?.closest('[data-faction]'),focusEvent=focus?.closest('[data-event]'),focusPerson=focus?.closest('[data-person]');
    const restoreFocus=focusFaction?{kind:focusFaction.closest('#faction-portraits')?'map':'roster',id:focusFaction.dataset.faction}:focusEvent?{kind:'event',id:focusEvent.dataset.event}:focusPerson?{kind:'person',id:focusPerson.dataset.person}:null;
    const rows=engine.ranking(state,map),alive=rows.filter(r=>r.alive),neutral=state.regions.filter(r=>r.owner===null).length;
    $('date-label').textContent=date(state.month);$('date-label').dataset.month=state.month;
    const phase=state.campaignPhase||'domestic';
    $('phase-label').textContent=state.finished?'天下归一':phase==='world'?'域外征程':phase==='truce'?'暂息干戈 · 休养生息':'诸侯逐鹿 · 国内主线';
    const local=map.worldMode&&phase!=='world',domesticIds=state.selectedFactionIds||campaign?.config.factionIds||[],scopeRegions=local?state.regions.filter(r=>map.regions[r.id].group==='china'):state.regions,scopeRows=local?rows.filter(r=>domesticIds.includes(r.id)):rows,scopeAlive=new Set(scopeRegions.filter(r=>r.owner).map(r=>r.owner)).size,scopeNeutral=scopeRegions.filter(r=>!r.owner).length;
    $('roster-total').textContent=scopeRows.length;$('roster-alive').textContent=scopeAlive;$('alive-status').innerHTML=`<b>${scopeAlive}</b> 家${local?'诸侯':'势力'}`;$('territory-status').innerHTML=`<b>${scopeRegions.length}</b> 地盘`;$('neutral-status').textContent=local?'域外诸邦 · 静守山海':`${scopeNeutral} 块中立`;
    $('territory-strip').innerHTML=[...rows.map(r=>{const count=scopeRegions.filter(t=>t.owner===r.id).length;return count?`<span style="width:${100*count/scopeRegions.length}%;background:${r.color}" title="${r.name}：${count} 块"></span>`:'';}),scopeNeutral?`<span style="width:${100*scopeNeutral/scopeRegions.length}%;background:#cccbbb" title="中立：${scopeNeutral} 块"></span>`:''].join('');
    atlas.setSelection(selected.type==='region'?selected.id:null,selected.type==='faction'&&selected.highlight!==false?(activeLord(selected.id)||selected.id):null);atlas.render(state,animate);
    renderInspector(rows);renderRanking(rows);renderEvents();renderVictory();updateControls();updateWarControl();
    const treaties=(state.coalitions||[]).filter(c=>c.active!==false&&!c.endedMonth),journeys=(state.expeditions||[]).filter(e=>e.status==='started');
    $('council-status').textContent=`${phase==='world'?'海内会盟':phase==='truce'?'天下息兵':treaties.length?treaties.length+' 份合纵盟约':'暂无盟约'} · ${journeys.length?journeys.length+' 支远征军在途':'查看军议与远征'}`;$('council-status').classList.toggle('has-treaty',treaties.length>0);
    if(restoreFocus){const r=restoreFocus;const candidates=document.querySelectorAll(r.kind==='event'?'#event-list [data-event]':r.kind==='person'?'#inspector [data-person]':r.kind==='map'?'#faction-portraits [data-faction]':'#ranking-list [data-faction]');const target=[...candidates].find(el=>(r.kind==='event'?el.dataset.event:r.kind==='person'?el.dataset.person:el.dataset.faction)===r.id);target?.focus({preventScroll:true});}
  }
  function switchTab(tabName){activeTab=tabName;for(const key of ['ranking','events']){$(`${key}-tab`).setAttribute('aria-selected',key===tabName);$(`${key}-tab`).tabIndex=key==='events'||key===tabName?0:-1;$(`${key}-panel`).hidden=key!==tabName;}}
  $('play-button').onclick=toggle;$('step-button').onclick=()=>{stop();advance()};
  document.querySelectorAll('[data-speed]').forEach(b=>b.onclick=()=>{speed=Number(b.dataset.speed);if(playing)start();else updateControls();});
  $('seed-form').onsubmit=e=>{e.preventDefault();newGame($('seed-input').value);toast('已按种子重开，相同种子可复现战局。')};
  $('new-game-button').onclick=()=>campaign.openSetup();$('setup-button').onclick=()=>campaign.openSetup();$('council-button').onclick=() =>campaign.openCouncil();$('council-status').onclick=()=>campaign.openCouncil();
  $('ranking-list').onclick=e=>{const row=e.target.closest('[data-faction]');if(row)selectFaction(row.dataset.faction)};
  $('roster-filter').onchange=()=>renderRanking(engine.ranking(state,map));
  $('truce-toggle').onclick=()=>{const wasPlaying=playing;stop();const phase=state.campaignPhase==='truce'?'domestic':'truce',result=engine.setCampaignPhase(state,phase);if(!result.ok){toast(result.reason);return;}if(map.worldMode)$('roster-filter').value='china';render(false);if(phase==='domestic'&&map.worldMode)atlas.focusArea({x:1240,y:145,w:360,h:245});if(phase==='domestic'||wasPlaying)start();toast(phase==='domestic'?'再启烽烟，诸侯重回逐鹿之局。':'天下息兵，诸侯各守其土。可休养生息，或开启域外副本。');};
  $('world-chapter').onclick=()=>{const result=engine.setCampaignPhase(state,'world');if(!result.ok){toast(result.reason);return;}$('roster-filter').value='all';atlas.reset();render(false);start();toast('普天之下，莫非王土：国内维持议和，诸侯开始收服域外。');};
  $('inspector').addEventListener('click',e=>{const chart=e.target.closest('[data-open-chart]'),attribute=e.target.closest('[data-attribute-detail]');if(chart||attribute){campaign.openCharacter(selected.id,attribute?.dataset.attributeDetail);return;}const person=e.target.closest('[data-person]');if(person){if(!state.factions[person.dataset.person]){campaign.openCharacter(person.dataset.person);return;}selectFaction(person.dataset.person);$('inspector').hidden=false;syncDetails();const heading=$('inspector').querySelector('h2');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}}});
  $('event-list').onclick=e=>{const row=e.target.closest('[data-event]');if(row){const event=state.events.find(x=>String(x.id)===row.dataset.event);if(String(event?.type).startsWith('coalition')||String(event?.type).startsWith('expedition')){campaign.openCouncil();}else if(event?.type==='allegiance'){selectFaction(event.subject||event.actor);$('inspector').hidden=false;syncDetails();}else if(event?.to!=null)selectRegion(event.to);else if(event?.actor)selectFaction(event.actor);}};
  $('ranking-tab').onclick=()=>switchTab('ranking');$('events-tab').onclick=()=>switchTab('events');
  document.querySelector('.rail-tabs').onkeydown=e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();switchTab(activeTab==='ranking'?'events':'ranking');$(`${activeTab}-tab`).focus()}};
  $('detail-toggle').onclick=()=>{$('inspector').hidden=!$('inspector').hidden;syncDetails()};$('all-events').onclick=()=>switchTab('events');$('event-category').onchange=renderEvents;$('latest-event').onclick=()=>switchTab('events');
  $('zoom-in').onclick=()=>atlas.zoomBy(1.3);$('zoom-out').onclick=()=>atlas.zoomBy(1/1.3);$('zoom-reset').onclick=()=>atlas.reset();
  $('focus-china').onclick=()=>{if(map.worldMode)atlas.focusArea({x:1240,y:145,w:360,h:245});};
  $('help-button').onclick=()=>{stop();$('help-dialog').showModal()};$('help-close').onclick=()=>$('help-dialog').close();
  $('help-dialog').onclick=e=>{if(e.target===$('help-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close()}};
  $('fullscreen-button').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{toast('当前浏览器不支持全屏，可放大窗口观战。')}};
  document.addEventListener('fullscreenchange',()=>$('fullscreen-button').textContent=document.fullscreenElement?'退出全屏':'全屏观战');
  document.addEventListener('keydown',e=>{if(e.code==='Space'&&!/INPUT|TEXTAREA|BUTTON|SELECT/.test(e.target.tagName)&&e.target.getAttribute('role')!=='button'&&!document.querySelector('dialog[open]')){e.preventDefault();toggle()}});
  function updateMapDescription(){
  document.body.classList.toggle('world-mode',!!map.worldMode);$('focus-china').hidden=!map.focusAreas?.china;$('roster-filter').value=map.worldMode?'china':'all';
  $('geography-summary').textContent=map.worldMode?'山河铺展至整个世界。主线聚焦中国，诸侯各据一方；息兵之后，可渡海越山，开启域外征程。地形与海岸参考真实地理，内部势力疆界为虚构分区。缩小地图可纵览世界，点击「看中国」回到主线视野。':map.description;
  $('map-caption-title').textContent=`${map.name||'中原及周边'} · ${map.worldMode?'跨时代虚构势力':'山海围合战场'}`;$('world-map').setAttribute('aria-label',`${map.name||'中原'}可交互势力地图`);
  $('source-list').innerHTML=`<ul>${map.sources.map(s=>`<li><a href="${escape(s.url)}" target="_blank" rel="noopener">${escape(s.title)}</a></li>`).join('')}</ul>`;
  }
  $('rules-summary').innerHTML='<p>主线中，每个月收粮、养兵、建设与征募，诸侯沿中国境内相邻地盘争夺。域外势力各守其土。天下息兵时，各方领土保留，继续休养；再启烽烟后恢复逐鹿。议和由你决定，不受剩余势力数量限制。</p><p>普天之下，莫非王土是独立的域外征程。国内诸侯维持会盟，沿陆路与海路收服境外地盘，当地势力会应战。副本以诸侯共同完成域外收服为目标，不要求国内先归于一家。</p><p>武力影响正面打击，统帅影响调度，智力帮助识破计谋，谋略决定用计能力，魅力影响招揽与士气，政务影响后勤，守御配合城防和地形稳固防线。个人七维属性固定，均为游戏设定。</p><p>国内争斗中，旧主关系在接壤、实力与魅力合适时可能促成归顺；强敌崛起时，弱势双方可结成合纵。计谋消耗粮草并有冷却，成功后仍须赢得战斗。「军议 · 远征」可查看盟约与行军任务，安排完毕后继续推演。</p>';
  campaign=new CampaignUI({engine,maps,getState:()=>state,getMap:()=>map,getSelected:()=>selected,onStart:(config,seed)=>{newGame(seed,config);switchTab('ranking');toast('诸侯已就位，开始推演即可逐鹿。随时可选择天下息兵。');},onPause:stop,onRefresh:()=>render(false),toast});
  newGame($('seed-input').value);switchTab('ranking');
})();
