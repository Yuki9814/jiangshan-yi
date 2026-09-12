'use strict';

/*
 * World campaign checks.
 *
 * World maps open in the domestic phase: selected Chinese characters may
 * contest the mainland, while fixed overseas representatives remain still.
 * A truce pauses the mainland, and only a truce can open the world phase.
 * The only mainland-to-overseas routes in these fixtures are explicit sea
 * links, so a successful cross-sea capture is observable and auditable.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const WarEngine = require('./engine.js');

const SELECTED = ['caocao', 'liubei', 'sunquan'];
const WORLD_FOREIGN = ['genghiskhan', 'saladin'];

function makeWorldMap({ withSites = false, connectedForeign = false } = {}) {
  const regions = [];
  for (let id = 0; id < 5; id += 1) {
    const neighbors = [];
    if (id > 0) neighbors.push(id - 1);
    if (id < 4) neighbors.push(id + 1);
    regions.push({
      id,
      name: `中原${id + 1}`,
      x: id,
      y: 0,
      neighbors,
      terrain: 'plain',
      fertility: 1,
      zone: 'china',
    });
  }
  const foreignNeighbors = connectedForeign ? [[6], [5, 7], [6]] : [[], [], []];
  [5, 6, 7].forEach((id, index) => {
    regions.push({
      id,
      name: ['海外港', '远东营地', '远西营地'][index],
      x: index,
      y: 4,
      neighbors: foreignNeighbors[index],
      terrain: index === 2 ? 'mountain' : 'plain',
      fertility: index === 2 ? 0.9 : 1,
      zone: 'foreign',
    });
  });
  return {
    id: 'world-test',
    width: 5,
    height: 5,
    worldMode: true,
    regions,
    domesticRegionIds: [0, 1, 2, 3, 4],
    ownerSlots: {
      'foreign-east': 'genghiskhan',
      'foreign-west': { factionId: 'saladin' },
    },
    initialOwners: {
      5: 'foreign-east',
      6: 'foreign-east',
      7: 'foreign-west',
    },
    requiredFactionIds: ['foreign-east', 'foreign-west'],
    seaLinks: [{ a: 0, b: 5, label: '东海航线' }],
    ...(withSites ? {
      expeditionSites: [{
        id: 'world-site',
        name: '海外地方势力',
        kind: '地方势力',
        description: '跨海远征测试地点。',
        distance: 5,
        difficulty: 55,
        rewards: { grain: 20, troops: 4 },
        cooldownMonths: 4,
      }],
    } : {}),
  };
}

function loadWorldMap() {
  const file = path.join(__dirname, 'world-map.js');
  if (!fs.existsSync(file)) return null;
  try {
    const loaded = require(file);
    return loaded && (loaded.default || loaded.WORLD_MAP || loaded);
  } catch (error) {
    return null;
  }
}

function ownerSnapshot(state) {
  return state.regions.map((region) => region.owner);
}

function syncSnapshots(state) {
  for (const factionId of state.participantIds) {
    const faction = state.factions[factionId];
    const owned = state.regions.filter((region) => region.owner === factionId);
    faction.territories = owned.length;
    faction.troops = owned.reduce((sum, region) => sum + region.troops, 0);
    faction.alive = Boolean(owned.length) && !faction.lordId;
  }
}

function militaryEvents(state) {
  return state.events.filter((event) => [
    'battle', 'capture', 'tactic', 'allegiance', 'coalition', 'expedition',
  ].includes(event.type));
}

function advance(state, map, months) {
  for (let index = 0; index < months && !state.finished; index += 1) {
    WarEngine.step(state, map);
    WarEngine.assertInvariants(state, map);
  }
}

function setWorldPhase(state) {
  assert.equal(WarEngine.setCampaignPhase(state, 'truce').ok, true);
  assert.equal(state.campaignPhase, 'truce');
  assert.equal(WarEngine.setCampaignPhase(state, 'world').ok, true);
  assert.equal(state.campaignPhase, 'world');
}

function testDomesticDefaultAndTruce() {
  const map = makeWorldMap();
  const state = WarEngine.createGame(map, 'world-domestic', {
    factionIds: SELECTED,
    coalitions: true,
    expeditions: false,
  });
  assert.equal(state.worldMode, true);
  assert.deepEqual(state.selectedFactionIds, SELECTED);
  assert.deepEqual(state.requiredFactionIds, WORLD_FOREIGN);
  assert.equal(state.participantIds.length, 5);
  assert.equal(state.campaignPhase, 'domestic');
  assert.equal(state.worldCompleted, false);
  assert.equal(state.finished, false);
  assert.equal(state.factions.genghiskhan.aggressive, false);
  assert.equal(state.factions.saladin.aggressive, false);

  const beforeOwners = ownerSnapshot(state);
  advance(state, map, 40);
  const foreignIds = new Set([5, 6, 7]);
  assert.ok(state.events.some((event) => event.type === 'battle'
    && SELECTED.includes(event.actor)), 'domestic phase should produce mainland battles');
  assert.equal(state.regions.every((region, index) => !foreignIds.has(region.id)
    || region.owner === beforeOwners[index]), true,
  'foreign ownership remains unchanged in domestic phase');
  const domesticMilitary = militaryEvents(state);
  assert.equal(domesticMilitary.every((event) => !event.actor || SELECTED.includes(event.actor)), true);
  assert.equal(domesticMilitary.every((event) => event.from == null || !foreignIds.has(event.from)), true);
  assert.equal(domesticMilitary.every((event) => event.to == null || !foreignIds.has(event.to)), true);

  const grainBefore = state.factions.caocao.grain;
  const ownersAtTruce = ownerSnapshot(state);
  const truce = WarEngine.setCampaignPhase(state, 'truce');
  assert.equal(truce.ok, true);
  const truceMonth = state.month;
  assert.equal(state.factions.caocao.aggressive, false);
  assert.equal(state.factions.liubei.aggressive, false);
  assert.equal(state.factions.sunquan.aggressive, false);
  advance(state, map, 30);
  assert.deepEqual(ownerSnapshot(state), ownersAtTruce, 'truce cannot change ownership');
  assert.equal(militaryEvents(state).filter((event) => event.month > truceMonth).length, 0,
    'truce cannot create military, diplomatic, coalition, or expedition events');
  assert.ok(state.factions.caocao.grain !== grainBefore
    || state.factions.caocao.economy !== 1, 'truce still permits economic development');
  WarEngine.assertInvariants(state, map);

  const domestic = WarEngine.setCampaignPhase(state, 'domestic');
  assert.equal(domestic.ok, true);
  assert.equal(state.factions.genghiskhan.aggressive, false, 'foreign actors stay still in domestic phase');
  assert.equal(state.factions.caocao.aggressive, true, 'domestic phase resumes Chinese war posture');
  assert.equal(WarEngine.setCampaignPhase(state, 'world').ok, false,
    'world phase requires a truce transition first');
  return {
    month: state.month,
    domesticBattles: domesticMilitary.filter((event) => event.type === 'battle').length,
    grainChanged: state.factions.caocao.grain !== grainBefore,
  };
}

function prepareSingleChineseFront(state) {
  state.regions.forEach((region) => {
    if (region.id < 5) {
      region.owner = 'caocao';
      region.troops = 900;
      region.development = 0;
      region.fort = 0;
    } else {
      region.troops = region.id === 5 ? 8 : 30;
      region.development = 0;
      region.fort = 0;
    }
  });
  state.factions.caocao.grain = 1100;
  state.factions.liubei.grain = 100;
  state.factions.sunquan.grain = 100;
  state.month = 25;
  state.phase = 'war';
  syncSnapshots(state);
}

function testWorldPhaseSeaRoute() {
  const map = makeWorldMap();
  const state = WarEngine.createGame(map, 'world-sea-route', {
    factionIds: SELECTED,
    coalitions: false,
    expeditions: false,
  });
  prepareSingleChineseFront(state);
  assert.equal(map.regions[0].neighbors.includes(5), false, 'sea target is not a land neighbor');
  setWorldPhase(state);
  assert.equal(state.factions.caocao.aggressive, true);
  assert.equal(state.factions.genghiskhan.aggressive, true,
    'world phase allows local overseas resistance');
  const before = ownerSnapshot(state);
  WarEngine.step(state, map);
  WarEngine.assertInvariants(state, map);
  const seaEvents = state.lastEvents.filter((event) => ['battle', 'capture', 'tactic'].includes(event.type)
    && event.from === 0 && event.to === 5);
  assert.ok(seaEvents.length > 0, 'world phase can march through an explicit sea link');
  assert.ok(seaEvents.every((event) => event.crossSea === true && event.linkKind === 'sea'));
  assert.equal(state.regions[5].owner, 'caocao', 'controlled cross-sea attack captures the weak target');
  assert.equal(state.regions[6].owner, before[6]);
  assert.equal(state.regions[7].owner, before[7]);

  const afterCapture = ownerSnapshot(state);
  assert.equal(WarEngine.setCampaignPhase(state, 'truce').ok, true);
  advance(state, map, 20);
  assert.deepEqual(ownerSnapshot(state), afterCapture, 'truce pauses resumed world warfare');
  WarEngine.assertInvariants(state, map);
  return {
    month: state.month,
    seaEvents: seaEvents.map((event) => ({
      type: event.type,
      from: event.from,
      to: event.to,
      crossSea: event.crossSea,
    })),
  };
}

function testDomesticWinnerAndWorldVictory() {
  const map = makeWorldMap();
  const domestic = WarEngine.createGame(map, 'domestic-winner', {
    factionIds: SELECTED,
    coalitions: false,
    expeditions: false,
  });
  domestic.regions.forEach((region) => {
    if (region.id < 5) region.owner = 'caocao';
  });
  syncSnapshots(domestic);
  WarEngine.step(domestic, map);
  assert.equal(domestic.domesticWinner, 'caocao');
  assert.equal(domestic.campaignPhase, 'truce');
  assert.equal(domestic.finished, false, 'domestic unity does not finish the world campaign');
  assert.equal(domestic.worldCompleted, false);
  assert.ok(domestic.events.some((event) => event.type === 'phase'
    && event.domesticWinner === 'caocao'));

  const world = WarEngine.createGame(map, 'world-complete', {
    factionIds: SELECTED,
    coalitions: false,
    expeditions: false,
  });
  world.regions.forEach((region) => {
    if (region.id < 5) region.owner = SELECTED[region.id % SELECTED.length];
    if (region.id === 5) region.owner = 'caocao';
    if (region.id === 6) region.owner = 'liubei';
    if (region.id === 7) region.owner = 'sunquan';
    region.troops = 300;
  });
  syncSnapshots(world);
  setWorldPhase(world);
  WarEngine.step(world, map);
  WarEngine.assertInvariants(world, map);
  assert.equal(world.worldCompleted, true);
  assert.equal(world.finished, true);
  assert.equal(world.victoryType, 'world-campaign');
  assert.deepEqual(new Set(world.winningFactionIds), new Set(SELECTED));
  assert.equal(world.winner && SELECTED.includes(world.winner), true);
  assert.equal(world.regions.filter((region) => region.id < 5)
    .map((region) => region.owner).filter((owner, index, owners) => owners.indexOf(owner) === index).length, 3,
  'world victory keeps multiple Chinese mainland owners valid');
  const victory = world.events.find((event) => event.type === 'victory');
  assert.equal(victory.victoryType, 'world-campaign');
  assert.deepEqual(new Set(victory.winningFactionIds), new Set(SELECTED));
  return {
    domesticWinner: domestic.domesticWinner,
    worldMonth: world.month,
    worldWinner: world.winner,
    winningFactionIds: world.winningFactionIds,
  };
}

function runExpeditionOutcome(seed, { terminal = false } = {}) {
  const map = makeWorldMap({ withSites: true });
  const state = WarEngine.createGame(map, seed, {
    factionIds: SELECTED,
    coalitions: false,
    expeditions: true,
  });
  state.regions.forEach((region) => {
    if (region.id < 5) {
      region.owner = 'caocao';
      region.troops = 300;
      region.development = 0;
      region.fort = 0;
    }
  });
  syncSnapshots(state);
  setWorldPhase(state);
  const check = WarEngine.canStartExpedition(state, 'caocao', 'world-site');
  assert.equal(check.allowed, true);
  const totalBefore = state.regions.reduce((sum, region) => sum + region.troops, 0);
  const originBefore = state.regions[check.originRegion].troops;
  const grainBefore = state.factions.caocao.grain;
  const started = WarEngine.startExpedition(state, 'caocao', 'world-site');
  assert.equal(started.ok, true);
  assert.equal(state.regions[check.originRegion].troops, originBefore - check.cost.troops);
  assert.equal(state.factions.caocao.grain, grainBefore - check.cost.grain);
  assert.equal(state.regions.reduce((sum, region) => sum + region.troops, 0),
    totalBefore - check.cost.troops, 'dispatch removes troops from the origin');
  const expedition = started.expedition;

  if (terminal) {
    state.regions.forEach((region) => { region.owner = 'caocao'; });
    syncSnapshots(state);
    WarEngine.step(state, map);
    assert.equal(state.worldCompleted, true);
    assert.equal(state.finished, true);
    assert.equal(expedition.status, 'cancelled');
    assert.equal(expedition.result.reason, 'victory_recall');
    assert.equal(expedition.result.survivors, expedition.troopsCommitted);
    assert.equal(expedition.result.troopLoss, 0);
    assert.equal(expedition.result.reward && Object.keys(expedition.result.reward).length, 0);
    return { state, check, expedition };
  }

  while (expedition.status === 'started') WarEngine.step(state, map);
  WarEngine.assertInvariants(state, map);
  assert.ok(['victory', 'defeat'].includes(expedition.status));
  assert.equal(expedition.result.survivors + expedition.result.troopLoss, expedition.troopsCommitted);
  assert.equal(expedition.result.grainCost, expedition.grainSpent);
  const totalAfter = state.regions.reduce((sum, region) => sum + region.troops, 0);
  const legalRewardTroops = expedition.result.reward.troops || 0;
  assert.ok(totalAfter <= totalBefore + legalRewardTroops,
    'returning expedition cannot create troops beyond explicit rewards');
  return { state, check, expedition };
}

function testExpeditionsAndRecall() {
  const phaseBlocked = WarEngine.createGame(makeWorldMap({ withSites: true }), 'expedition-blocked', {
    factionIds: SELECTED,
    coalitions: false,
    expeditions: true,
  });
  const domesticCheck = WarEngine.canStartExpedition(phaseBlocked, 'caocao', 'world-site');
  assert.equal(domesticCheck.allowed, false);
  assert.match(domesticCheck.reason, /国内争霸|域外/);
  assert.equal(WarEngine.setCampaignPhase(phaseBlocked, 'truce').ok, true);
  const truceCheck = WarEngine.canStartExpedition(phaseBlocked, 'caocao', 'world-site');
  assert.equal(truceCheck.allowed, false);
  assert.match(truceCheck.reason, /议和/);
  const completed = new Set();
  const outcomes = [];
  for (let index = 0; index < 48 && completed.size < 2; index += 1) {
    const outcome = runExpeditionOutcome(`expedition-world-${index}`);
    completed.add(outcome.expedition.status);
    outcomes.push(outcome.expedition.status);
  }
  assert.equal(completed.has('victory'), true);
  assert.equal(completed.has('defeat'), true);

  const recalled = runExpeditionOutcome('expedition-terminal', { terminal: true });
  WarEngine.assertInvariants(recalled.state, makeWorldMap({ withSites: true }));
  const event = recalled.state.events.find((entry) => entry.type === 'expedition'
    && entry.status === 'cancelled');
  assert.ok(event);
  assert.match(event.details, /未取得远征奖励/);
  return {
    outcomes: Array.from(completed).sort(),
    terminalStatus: recalled.expedition.status,
    terminalReason: recalled.expedition.result.reason,
  };
}

function testRealWorldCatalog() {
  const map = loadWorldMap();
  if (!map) return { present: false };
  const selections = [
    ['caocao', 'liubei', 'sunquan'],
    ['hanxin', 'guanyu', 'lvbu', 'zhuyuanzhang', 'xuda', 'changyuchun', 'chenyouliang', 'zhugeliang', 'caocao', 'lishi'],
    ['hanxin', 'guanyu', 'lvbu', 'zhuyuanzhang', 'xuda', 'changyuchun', 'chenyouliang', 'zhugeliang', 'caocao', 'lishi', 'liubei', 'zhangfei'],
  ];
  const summaries = selections.map((factionIds) => {
    const state = WarEngine.createGame(map, `world-catalog-${factionIds.length}`, {
      factionIds,
      coalitions: true,
      expeditions: false,
    });
    WarEngine.assertInvariants(state, map);
    assert.equal(state.regions.every((region) => region.owner
      && state.participantIds.includes(region.owner)), true);
    assert.equal(WarEngine.ranking(state, map).length, state.participantIds.length);
    return {
      selected: factionIds.length,
      participants: state.participantIds.length,
      foreignRegions: map.regions.filter((region) => region.group === 'overseas').length,
    };
  });
  const state = WarEngine.createGame(map, 'world-catalog-peace', {
    factionIds: selections[0],
    coalitions: false,
    expeditions: false,
  });
  const foreignIds = new Set(state.regions
    .map((region, index) => map.regions[index].group === 'overseas' ? region.id : null)
    .filter((id) => id != null));
  const beforeOwners = ownerSnapshot(state);
  advance(state, map, 24);
  assert.equal(state.regions.every((region, index) => !foreignIds.has(region.id)
    || region.owner === beforeOwners[index]), true);
  return {
    present: true,
    regionCount: map.regions.length,
    summaries,
    domesticEvents: state.events.filter((event) => event.type === 'battle').length,
    foreignRegions: foreignIds.size,
  };
}

function main() {
  const output = {
    domestic: testDomesticDefaultAndTruce(),
    sea: testWorldPhaseSeaRoute(),
    victory: testDomesticWinnerAndWorldVictory(),
    expeditions: testExpeditionsAndRecall(),
    catalog: testRealWorldCatalog(),
  };
  console.log(JSON.stringify(output));
}

main();
