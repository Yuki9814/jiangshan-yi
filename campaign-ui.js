/* Campaign setup and character reference views. All charts use the fixed data. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const STORE = 'jiangshan-world-v4';
  const explain = {
    strength: ['破阵之锋', '决定正面冲击的表现，配合统帅、兵力与士气参与战斗。武力强的将领适合攻坚，但仍需要粮草和可投入的兵员。', '留意交锋中的投入兵力与伤亡；武力优势不会绕过山地、城防和计谋。'],
    intelligence: ['识局之明', '帮助判断敌方计策。守方智力越高，越可能识破对手的谋略；也参与自身的策划能力。', '在“计谋与识破”战报中，对照守方阵营智力与计谋成功概率。'],
    strategy: ['运筹之术', '影响用计的成功概率和削弱防守的效果。成功用计后，若兵力允许，还可能从新占地盘追击一个相邻目标。', '用计有粮耗和冷却；被识破时仍会消耗准备资源。'],
    charisma: ['聚众之望', '影响招揽、军心与阵营凝聚。指定旧主关系在接壤和实力条件合适时，可能促使旧部带领地与兵粮归顺。', '归顺战报会说明关系、魅力和实力门槛；高魅力不会让所有人物自动投靠。'],
    command: ['驭军之能', '影响兵员征募、战场调度与可投入战力，是把兵力组织成有效攻势的能力。', '结合当时的军粮、疲劳和守备兵力观察，不能只凭单一分数判断胜负。'],
    development: ['经略之基', '影响领地经营与粮秣供给，为养兵、恢复与长期战争提供支撑。', '粮源充足更利于久战，也更能承担计谋和远征的额外开支。'],
    defense: ['守疆之固', '配合地形、城防和驻军提升防守效果。山地险隘与河川可以进一步改变攻守条件。', '点击地块查看驻军、城防和地形，再与人物的守御属性一起判断防线。']
  };
  const presets = {
    classic: ['hanxin','guanyu','lvbu','zhuyuanzhang','xuda','changyuchun','chenyouliang','zhugeliang','caocao','lishi'],
    kingdoms: ['liubei','guanyu','zhangfei','zhaoyun','zhugeliang','caocao','simayi','sunquan','zhouyu','lvbu'],
    world: ['hanxin','caocao','liubei','zhuyuanzhang','yuefei','qijiguang','xiangyu','genghiskhan','saladin','richard'],
    triangle: ['caocao','liubei','sunquan']
  };
  function radar(faction, attributes, comparison, selectedKey, compact = false) {
    const cx=180, cy=164, radius=112, n=attributes.length;
    const point=(i,r) => {const a=-Math.PI/2+i*2*Math.PI/n;return [cx+Math.cos(a)*r,cy+Math.sin(a)*r];};
    const points=scale=>attributes.map((_,i)=>point(i,radius*scale).map(v=>v.toFixed(2)).join(',')).join(' ');
    const polygon=f=>attributes.map((a,i)=>point(i,radius*f.stats[a.key]/100).map(v=>v.toFixed(2)).join(',')).join(' ');
    return `<svg class="ability-radar ${compact?'compact':''}" viewBox="0 0 360 330" role="img" aria-label="${esc(faction.name)}七维能力雷达图${comparison?'，与'+esc(comparison.name)+'对比':''}">
      ${[.2,.4,.6,.8,1].map(v=>`<polygon points="${points(v)}" class="radar-grid"/>`).join('')}
      ${attributes.map((a,i)=>{const p=point(i,radius);return `<line x1="${cx}" y1="${cy}" x2="${p[0]}" y2="${p[1]}" class="radar-axis"/>`;}).join('')}
      ${comparison?`<polygon points="${polygon(comparison)}" class="radar-compare"/>`:''}
      <polygon points="${polygon(faction)}" class="radar-value" style="--chart-color:${faction.color}"/>
      ${attributes.map((a,i)=>{const p=point(i,radius*faction.stats[a.key]/100),label=point(i,142),active=selectedKey===a.key;return `<circle cx="${p[0]}" cy="${p[1]}" r="${active?5:3}" fill="${faction.color}"/><text x="${label[0]}" y="${label[1]}" class="radar-label ${active?'active':''}">${a.label}<tspan x="${label[0]}" dy="17">${faction.stats[a.key]}</tspan></text>`;}).join('')}
    </svg>`;
  }
  class CampaignUI {
    constructor({engine,maps,getState,getMap,getSelected,onStart,onPause,onRefresh,toast}) {
      Object.assign(this,{engine,maps,getState,getMap,getSelected,onStart,onPause,onRefresh,toast});
      this.factions=engine.FACTIONS;this.byId=Object.fromEntries(this.factions.map(f=>[f.id,f]));
      this.attributes=engine.ATTRIBUTES;this.characterId=this.factions[0].id;this.attributeKey='strategy';this.comparisonId='';
      this.config={mapId:maps[0].id,factionIds:presets.classic.filter(id=>this.byId[id]),coalitions:true,expeditions:true};
      try{const saved=JSON.parse(localStorage.getItem(STORE));if(saved&&maps.some(m=>m.id===saved.mapId)&&Array.isArray(saved.factionIds)){const ids=[...new Set(saved.factionIds)].filter(id=>this.byId[id]);if(ids.length>=3&&ids.length<=12)this.config={...this.config,...saved,factionIds:ids};}}catch{/* Storage is optional for a local game. */}
      this.bind();
    }
    portrait(id){return esc((this.byId[id]?.portrait||`assets/portraits/${id}.webp`)+'?v=20260912-chronicle');}
    fixedIds(){const map=this.maps.find(m=>m.id===this.draft?.mapId);return new Set(map?.worldMode?map.requiredFactionIds||[]:[]);}
    bind(){
      for(const id of ['setup-dialog','character-dialog','council-dialog']){
        const dialog=$(id);
        dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}if(e.target.closest('[data-close]'))dialog.close();});
      }
      $('setup-dialog').addEventListener('click',e=>{
        const map=e.target.closest('[data-map-choice]'),pick=e.target.closest('[data-pick]'),inspect=e.target.closest('[data-inspect]'),preset=e.target.closest('[data-preset]');
        if(map){this.draft.mapId=map.dataset.mapChoice;this.draft.factionIds=this.draft.factionIds.filter(id=>!this.fixedIds().has(id));for(const choice of $('map-choices').querySelectorAll('[data-map-choice]'))choice.setAttribute('aria-pressed',choice.dataset.mapChoice===this.draft.mapId);this.renderCharacterChoices();this.updateSetupSummary();}
        if(pick){const id=pick.dataset.pick,index=this.draft.factionIds.indexOf(id);if(index>=0)this.draft.factionIds.splice(index,1);else if(this.draft.factionIds.length<12)this.draft.factionIds.push(id);else{this.toast('本局最多选择 12 位将领。');return;}this.updatePickButtons();this.updateSetupSummary();}
        if(inspect)this.openCharacter(inspect.dataset.inspect);
        if(preset){this.draft.factionIds=preset.dataset.preset==='clear'?[]:presets[preset.dataset.preset].filter(id=>this.byId[id]&&!this.fixedIds().has(id));this.updatePickButtons();this.updateSetupSummary();}
      });
      $('character-dialog').addEventListener('click',e=>{const attr=e.target.closest('[data-attribute]'),person=e.target.closest('[data-library-person]');if(attr){this.attributeKey=attr.dataset.attribute;this.renderCharacter();$('character-dialog').querySelector(`[data-attribute="${this.attributeKey}"]`)?.focus({preventScroll:true});}if(person){this.characterId=person.dataset.libraryPerson;this.renderCharacter();$('character-dialog').querySelector('[data-close]')?.focus({preventScroll:true});$('character-dialog').scrollTop=0;}});
      $('character-dialog').addEventListener('change',e=>{if(e.target.id==='compare-character'){this.comparisonId=e.target.value;this.renderCharacter();$('compare-character').focus({preventScroll:true});}});
      $('council-dialog').addEventListener('change',e=>{if(e.target.id==='expedition-actor'){this.expeditionActor=e.target.value;this.renderCouncil();$('expedition-actor').focus({preventScroll:true});}});
      $('council-dialog').addEventListener('click',e=>{const launch=e.target.closest('[data-expedition-site]');if(launch)this.launchExpedition(launch.dataset.expeditionSite);});
    }
    openSetup(){
      this.onPause();this.draft={...this.config,factionIds:[...this.config.factionIds]};
      $('setup-dialog').innerHTML=`<header class="dialog-header"><div><p class="dialog-eyebrow">开一局自己的山河</p><h2 id="setup-title">择地 · 点将</h2></div><button class="plain-button" data-close>返回战局</button></header>
        <div class="setup-body"><section class="battlefield-picker" aria-label="选择战场"><div class="section-heading"><h3>战场</h3><span>${this.maps.length} 处山河</span></div><div id="map-choices"></div><p class="setup-footnote">山水围合战场，带地名的地块参与本局争霸。外围势力通过远征抵达。</p><div class="campaign-options"><label><input id="coalitions-option" type="checkbox" ${this.draft.coalitions?'checked':''}> 弱势合纵</label><label><input id="expeditions-option" type="checkbox" ${this.draft.expeditions?'checked':''}> 开启远征</label></div></section>
        <section class="commander-picker" aria-label="选择出场将领"><div class="section-heading"><h3>出场人物</h3><span id="pick-count" aria-live="polite"></span></div><div class="preset-row"><button data-preset="classic">原班十将</button><button data-preset="kingdoms">三国群英</button><button data-preset="world">跨代群英</button><button data-preset="triangle">三足鼎立</button><button data-preset="clear">清空</button></div><div class="library-filter"><input id="character-search" type="search" placeholder="搜索姓名、时代或定位" aria-label="搜索将领"><select id="character-role" aria-label="按定位筛选"><option value="">全部定位</option>${[...new Set(this.factions.map(f=>f.role))].map(role=>`<option>${esc(role)}</option>`).join('')}</select></div><div id="character-choices" class="character-choices"></div><p id="character-search-empty" class="empty-note" hidden>没有符合条件的人物，试试其他名字或定位。</p></section></div>
        <footer class="setup-footer"><div><label for="setup-seed">本局种子</label><input id="setup-seed" maxlength="48" value="${esc(this.getState()?.seed||'江山-2026')}"><p id="setup-summary" aria-live="polite"></p></div><button id="setup-start" class="primary-button">开局观战</button></footer>`;
      this.renderMapChoices();this.renderCharacterChoices();this.updateSetupSummary();
      $('character-search').oninput=()=>this.renderCharacterChoices();$('character-role').onchange=()=>this.renderCharacterChoices();
      $('setup-start').onclick=()=>{if(this.draft.factionIds.length<3||this.draft.factionIds.length>12)return;this.draft.coalitions=$('coalitions-option').checked;this.draft.expeditions=$('expeditions-option').checked;this.config={...this.draft,factionIds:[...this.draft.factionIds]};try{localStorage.setItem(STORE,JSON.stringify(this.config));}catch{}const seed=$('setup-seed').value.trim()||'江山-2026';$('setup-dialog').close();this.onStart(this.config,seed);};
      $('setup-dialog').showModal();
    }
    renderMapChoices(){
      $('map-choices').innerHTML=this.maps.map(m=>`<button class="map-choice" data-map-choice="${esc(m.id)}" aria-pressed="${m.id===this.draft.mapId}"><svg viewBox="0 0 ${m.width} ${m.height}" aria-hidden="true"><rect width="${m.width}" height="${m.height}" fill="#c3d7d6"/><path d="${esc(m.landPath)}" fill="#e5e0cc"/>${m.regions.map(r=>`<path d="${esc(r.path)}" fill="#8fa189" fill-opacity=".32" stroke="#697a67" stroke-width="2"/>`).join('')}</svg><span><b>${esc(m.name||m.id)}</b><small>${esc(m.subtitle||m.description?.split('。')[0])}</small><em>${m.regions.length} 块地盘</em></span></button>`).join('');
    }
    renderCharacterChoices(){
      const query=($('character-search').value||'').trim().toLowerCase(),role=$('character-role').value;
      const list=this.factions.filter(f=>!this.fixedIds().has(f.id)&&(!role||f.role===role)&&(!query||`${f.name} ${f.era} ${f.role}`.toLowerCase().includes(query)));
      $('character-choices').innerHTML=list.map(f=>`<article class="pick-card" style="--faction:${f.color}"><button class="pick-person" data-pick="${f.id}" aria-label="选择${esc(f.name)}" aria-pressed="${this.draft.factionIds.includes(f.id)}"><img src="${this.portrait(f.id)}" alt="${esc(f.name)}头像"><span class="pick-mark">已选</span><span class="pick-name">${esc(f.name)}</span><span class="pick-era">${esc(f.era)}</span></button><button class="pick-inspect" data-inspect="${f.id}" aria-label="查看${esc(f.name)}图鉴">${esc(f.role)} · 查看属性</button></article>`).join('');
      $('character-search-empty').hidden=list.length>0;
    }
    updatePickButtons(){for(const b of $('character-choices').querySelectorAll('[data-pick]'))b.setAttribute('aria-pressed',this.draft.factionIds.includes(b.dataset.pick));}
    updateSetupSummary(){
      const count=this.draft.factionIds.length,map=this.maps.find(m=>m.id===this.draft.mapId);
      $('pick-count').textContent=`已选 ${count} / 12 · 至少 3 位`;
      $('setup-summary').textContent=`${map.name} · ${count} 位自选人物${map.worldMode?' + '+this.fixedIds().size+' 位域外驻守':''} · ${map.regions.length} 块地盘${count<3?'，还需选择 '+(3-count)+' 位':''}`;
      $('setup-dialog').querySelector('.setup-footnote').textContent=map.worldMode?'诸侯在中国境内逐鹿，域外人物驻守各自地区。可随时「天下息兵」，再开启域外收服副本。':'山水围合战场。诸侯自动逐鹿，亦可随时选择「天下息兵」。';
      $('setup-start').disabled=count<3||count>12;
    }
    openCharacter(id,attribute){
      if(!this.byId[id])return;this.onPause();this.characterId=id;if(attribute)this.attributeKey=attribute;this.renderCharacter();if(!$('character-dialog').open)$('character-dialog').showModal();
    }
    renderCharacter(){
      const f=this.byId[this.characterId];if(this.comparisonId===f.id)this.comparisonId='';
      const comparison=this.byId[this.comparisonId],active=this.attributes.find(a=>a.key===this.attributeKey)||this.attributes[0];
      const related=this.engine.RELATIONSHIPS.filter(r=>r.from===f.id||r.to===f.id),entry=explain[active.key];
      $('character-dialog').style.setProperty('--faction',f.color);
      $('character-dialog').innerHTML=`<header class="dialog-header"><div><p class="dialog-eyebrow">人物图鉴 / ${esc(f.era)}</p><h2 id="character-title">${esc(f.name)} <span>${esc(f.role)}</span></h2></div><button class="plain-button" data-close>关闭图鉴</button></header><div class="character-dossier"><section class="character-visual"><div class="dossier-identity"><img src="${this.portrait(f.id)}" alt="${esc(f.name)}头像"><div><h3>${esc(f.style)}</h3><p>${esc(f.description)}</p>${f.eraNote?`<p class="era-note">${esc(f.eraNote)}</p>`:""}${f.portraitNote?`<small class="portrait-note">${esc(f.portraitNote)}</small>`:""}</div></div>${radar(f,this.attributes,comparison,this.attributeKey)}<div class="radar-legend"><span><i style="background:${f.color}"></i>${esc(f.name)}</span>${comparison?`<span><i class="compare-key"></i>${esc(comparison.name)}</span>`:''}<small>固定值 · 满分 100</small></div><label class="compare-select">对照人物<select id="compare-character" aria-label="选择雷达图对照人物"><option value="">不对照</option>${this.factions.filter(p=>p.id!==f.id).map(p=>`<option value="${p.id}" ${this.comparisonId===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label><p class="fixed-note">个人基础属性固定。归顺后的阵营协同、士气和战疲单独计算。</p></section>
        <section class="character-analysis"><div class="section-heading"><h3>七维能力</h3><span>点击属性，查看作用</span></div><div class="attribute-bars">${this.attributes.map(a=>`<button data-attribute="${a.key}" class="attribute-bar" aria-pressed="${active.key===a.key}" aria-label="${a.label} ${f.stats[a.key]}，查看详解"><span>${a.label}</span><i><b style="width:${f.stats[a.key]}%"></b>${comparison?`<em style="left:${comparison.stats[a.key]}%"></em>`:''}</i><strong>${f.stats[a.key]}</strong>${comparison?`<small>${comparison.stats[a.key]}</small>`:''}</button>`).join('')}</div><article class="attribute-explanation" aria-live="polite"><div><span>${active.label}</span><h3>${entry[0]}</h3><b>${f.stats[active.key]}<small>/100</small></b></div><p>${entry[1]}</p><p class="observation-note">${entry[2]}</p></article><section class="dossier-relations"><h3>人物关系</h3>${related.length?`<div>${related.map(r=>{const id=r.from===f.id?r.to:r.from;return `<button data-library-person="${id}" class="dossier-relation"><img src="${this.portrait(id)}" alt=""><span>${esc(this.byId[id].name)}<small>${esc(r.type==='allegiance'?(r.from===f.id?'旧主':'旧部'):r.name)}</small></span></button>`;}).join('')}</div>`:'<p class="empty-note">暂无预设历史羁绊，可随局势参与合纵。</p>'}</section></section></div><p class="dossier-disclaimer">能力分数、跨时代同局与战场关系效果为游戏设定。史料和肖像来源见玩法说明。</p>`;
    }
    openCouncil(){
      this.onPause();const state=this.getState(),selected=this.getSelected(),id=selected?.type==='faction'?selected.id:null;
      this.expeditionActor=state.factions[id]?.alive?id:state.factions[id]?.lordId||this.engine.ranking(state,this.getMap()).find(f=>f.alive)?.id;
      this.renderCouncil();$('council-dialog').showModal();
    }
    renderCouncil(){
      const state=this.getState(),map=this.getMap(),alive=this.engine.ranking(state,map).filter(f=>f.alive&&(!map.worldMode||!map.requiredFactionIds.includes(f.id)));
      if(!alive.some(f=>f.id===this.expeditionActor))this.expeditionActor=alive[0]?.id;
      const coalitions=(state.coalitions||[]).filter(c=>c.active!==false&&!c.endedMonth),sites=state.expeditionSites||map.expeditionSites||[];
      $('council-dialog').innerHTML=`<header class="dialog-header"><div><p class="dialog-eyebrow">${esc(map.name)} / 第 ${state.month} 月</p><h2 id="council-title">军议 · 远征</h2></div><button class="plain-button" data-close>返回战局</button></header><div class="council-body"><section class="coalition-section"><div class="section-heading"><h3>${state.campaignPhase==='domestic'?'合纵盟约':'诸侯会盟'}</h3><span>${state.campaignPhase==='domestic'?coalitions.length+' 份生效':'各守封疆'}</span></div><p class="council-intro">${state.campaignPhase==='world'?'海内诸侯会盟，共定域外。故土息兵，域外同征。':state.campaignPhase==='truce'?'诸侯奉诏息兵，各守其土。何时再启烽烟，由你决定。':'强敌压境时，弱势双方可结盟互保、共同进攻。威胁消退或期限届满后，盟约会解除。'}</p><div id="coalition-cards">${coalitions.length?coalitions.map(c=>this.coalitionCard(c)).join(''):`<div class="council-empty"><h4>${state.campaignPhase==='world'?'共定域外':state.campaignPhase==='truce'?'天下息兵':state.options?.coalitions===false?'本局未开启合纵':'各据一方，尚无盟约'}</h4><p>${state.campaignPhase!=='domestic'?'天下暂息干戈，诸侯仍各领其地。休养与出征皆由当前篇章决定。':state.options?.coalitions===false?'可在「选将 · 选图」中开启合纵并新开一局。':'继续推演，观察领土与兵力的强弱变化。盟约由局势触发。'}</p></div>`}</div><div class="council-history"><h4>最近军议</h4>${state.events.filter(e=>String(e.type).startsWith('coalition')&&e.action!=='coordinate').slice(-4).reverse().map(e=>`<p><span>第 ${e.month} 月</span>${esc(e.text)}</p>`).join('')||'<p>暂无结盟纪事。</p>'}</div></section><section class="expedition-section"><div class="section-heading"><h3>远方战事</h3><select id="expedition-actor" aria-label="选择远征主将">${alive.map(f=>`<option value="${f.id}" ${f.id===this.expeditionActor?'selected':''}>${esc(f.name)}</option>`).join('')}</select></div><p class="council-intro">${state.options?.expeditions===false?'本局未开启远征。可在「选将 · 选图」中调整后新开一局。':map.worldMode&&state.campaignPhase!=='world'?'远方暂靖。先令天下息兵，再开启「普天之下，莫非王土」，即可安排远征。':'派出独立远征军，数月后带回战果。出征期间，本土的可用兵力与军粮会减少。'}</p><div id="expedition-cards">${sites.map(site=>this.expeditionCard(site)).join('')||'<p class="empty-note">当前战场尚无远征路线。</p>'}</div><div id="expedition-progress">${this.expeditionProgress()}</div></section></div><footer class="council-footer">推演已暂停。安排完毕后返回战局，继续时间即可推进行军。</footer>`;
    }
    coalitionCard(c){
      const members=c.members||c.memberIds||[],target=c.target||c.targetId;
      return `<article class="coalition-card"><p class="treaty-label">合纵 · 共御强敌</p><div class="treaty-members">${members.map(id=>`<span><img src="${this.portrait(id)}" alt="">${esc(this.byId[id]?.name||id)}</span>`).join('<i>与</i>')}</div><p>共同目标 <strong>${esc(this.byId[target]?.name||target||'强势势力')}</strong></p><small>盟内休战 · 协同进攻${c.expiresMonth?' · 约至第 '+c.expiresMonth+' 月':''}</small></article>`;
    }
    expeditionCard(site){
      const state=this.getState(),check=this.engine.canStartExpedition?.(state,this.expeditionActor,site.id)||{allowed:false,reason:'远征尚不可用'};
      const cost=check.cost||{},grain=cost.grain,troops=cost.troops,duration=check.duration;
      const rewardLabels={grain:'军粮',troops:'兵员',morale:'士气',development:'发展',fort:'城防'},reward=Object.entries(site.rewards||{}).filter(([,v])=>v>0).map(([k,v])=>`${rewardLabels[k]||k} +${k==='morale'?Math.round(v*100)+'%':v}`).join(' · '),kind={tribal:'地方联盟',tribe:'地方联盟',local:'地方势力',crusader:'十字军',city:'边地城邦',frontier:'边地关隘',fortress:'沿海堡垒',camp:'驻军营地','border-state':'边地城邦',league:'商路联盟',caravan:'商路城邦',maritime:'海上联盟'}[site.kind]||site.kind||'地方势力';
      return `<article class="expedition-card"><div class="expedition-card-title"><span>${esc(kind)}</span><h4>${esc(site.name)}</h4></div><p>${esc(site.description||'越过山海，在远方争取新的补给与战果。')}</p><div class="expedition-cost"><span>启程军粮 <b>${grain??'—'}</b></span><span>兵员 <b>${troops??'—'}</b></span><span>行程 <b>${duration??'—'} 月</b></span></div><p class="expedition-reward">难度 ${site.difficulty}/100${reward?' · 凯旋所得：'+esc(reward):''}<br>${check.monthlyGrain?'途中每月另需军粮 '+check.monthlyGrain+' · 预计总耗粮 '+check.estimatedTotalGrain:'行军期间另需持续补给'}</p><div class="expedition-action"><small>${esc(check.allowed?'可派遣远征军':check.reason||'暂不满足条件')}</small><button class="plain-button" data-expedition-site="${esc(site.id)}" ${check.allowed?'':'disabled'}>派出远征</button></div></article>`;
    }
    expeditionProgress(){
      const state=this.getState(),journeys=(state.expeditions||[]).filter(x=>x.actor===this.expeditionActor);
      if(!journeys.length)return '';
      return `<h4 class="journey-heading">行军与战果</h4>${journeys.slice(-5).reverse().map(x=>{const end=x.returnMonth,start=x.startMonth,progress=x.status==='started'?Math.max(0,Math.min(100,100*(state.month-start)/Math.max(1,end-start))):100,site=(state.expeditionSites||[]).find(s=>s.id===x.siteId);return `<article class="journey"><div><strong>${esc(x.siteName||site?.name||x.siteId)}</strong><span>${esc(x.status==='started'?'行军中':x.status==='victory'?'凯旋':x.status==='defeat'?'受挫归来':x.status==='cancelled'?'远征中止':'行程结束')}</span></div><progress max="100" value="${progress}" aria-label="远征行程"></progress><p>${x.status==='started'?'预计第 '+end+' 月归来，尚需 '+Math.max(0,end-state.month)+' 月':x.status==='cancelled'?'行程已中止':'已完成行程'}${x.result?.details?' · '+esc(x.result.details.replaceAll('=','：')):''}</p>${x.result?`<p class="journey-rewards">${Number.isFinite(x.result.survivors)?'归队兵员 '+x.result.survivors+' · ':''}${Object.entries(x.result.reward||{}).filter(([,v])=>v>0).map(([k,v])=>`${({grain:'军粮',troops:'兵员',morale:'士气',development:'发展',fort:'城防'})[k]||esc(k)} +${k==='morale'?Math.round(v*100)+'%':v}`).join(' · ')||'未获得额外奖励'}</p>`:''}</article>`;}).join('')}`;
    }
    launchExpedition(siteId){
      const result=this.engine.startExpedition(this.getState(),this.expeditionActor,siteId);
      if(result===false||result?.ok===false||result?.allowed===false){this.toast(result?.reason||'当前无法出征。');return;}
      this.onRefresh();this.renderCouncil();$('expedition-actor').focus({preventScroll:true});this.toast('远征军已出发，继续推演即可推进行军。');
    }
    miniRadar(id){return radar(this.byId[id],this.attributes,null,null,true);}
  }
  globalThis.CampaignUI=CampaignUI;
})();
