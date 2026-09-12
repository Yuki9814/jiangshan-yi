'use strict';

/*
 * Campaign release checks.  These tests keep map ownership and expedition
 * sites deliberately small so that the public engine contract is exercised
 * without depending on private simulation helpers.
 */

const assert = require('node:assert/strict');
const WarEngine = require('./engine.js');
const MAP_CATALOG = require('./map-catalog.js');

const THREE = ['caocao', 'liubei', 'sunquan'];
const TEN = [
  'hanxin', 'guanyu', 'lvbu', 'zhuyuanzhang', 'xuda', 'changyuchun',
  'chenyouliang', 'zhugeliang', 'caocao', 'lishi',
];
const TWELVE = [
  'liubei', 'zhangfei', 'zhaoyun', 'zhouyu', 'simayi', 'sunquan',
  'yuefei', 'qijiguang', 'xiangyu', 'genghiskhan', 'saladin', 'richard',
];

function makeGridMap(width = 4, height = 4, expeditionSites = []) {
  const regions = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const id = y * width + x;
      const neighbors = [];
      if (x > 0) neighbors.push(id - 1);
      if (x + 1 < width) neighbors.push(id + 1);
      if (y > 0) neighbors.push(id - width);
      if (y + 1 < height) neighbors.push(id + width);
      regions.push({
        id,
        name: `战役区域${id + 1}`,
        x,
        y,
        neighbors,
        terrain: id % 9 === 0 ? 'mountain' : id % 7 === 0 ? 'river' : 'plain',
        fertility: 1,
      });
    }
  }
  return { width, height, regions, expeditionSites };
}

function campaignMap() {
  return makeGridMap(4, 4, [
    {
      id: 'easy-site',
      name: '近郊地方势力',
      kind: '地方势力',
      description: '近郊的地方势力，胜利后带回少量粮秣。',
      distance: 1,
      difficulty: 18,
      rewards: { grain: 42, troops: 8, morale: 0.03 },
      cooldownMonths: 4,
    },
    {
      id: 'hard-site',
      name: '远方十字军营地',
      kind: '十字军营地',
      description: '远方营地，行军较久且战事凶险。',
      distance: 3,
      difficulty: 92,
      rewards: { grain: 70, troops: 14, fort: 1.5 },
      cooldownMonths: 6,
    },
  ]);
}

function syncSnapshots(state) {
  for (const id of state.participantIds) {
    const faction = state.factions[id];
    const owned = state.regions.filter((region) => region.owner === id);
    faction.territories = owned.length;
    faction.troops = owned.reduce((sum, region) => sum + region.troops, 0);
    faction.alive = owned.length > 0 && !faction.lordId;
  }
}

function owners(state) {
  return state.regions.map((region) => region.owner);
}

function advance(state, map, limit = 500) {
  for (let index = 0; index < limit && !state.finished; index += 1) {
    WarEngine.step(state, map);
    WarEngine.assertInvariants(state, map);
  }
  return state;
}

function testAllMapsAndSelections() {
  assert.equal(MAP_CATALOG.length, 4, 'the campaign catalog must contain four maps');
  const combinations = [THREE, TEN, TWELVE];
  const summaries = [];
  for (const map of MAP_CATALOG) {
    for (const factionIds of combinations) {
      const state = advance(WarEngine.createGame(map, `campaign-${map.id}-${factionIds.length}`, {
        factionIds,
        coalitions: true,
        expeditions: true,
        autoWar: true,
      }), map);
      assert.equal(state.finished, true, `${map.id}/${factionIds.length} must unify`);
      assert.ok(factionIds.includes(state.winner), `${map.id}/${factionIds.length} winner must be selected`);
      assert.equal(new Set(owners(state)).size, 1, `${map.id}/${factionIds.length} must have one owner`);
      assert.equal(WarEngine.ranking(state, map).length, factionIds.length,
        `${map.id}/${factionIds.length} ranking must contain only this selection`);
      assert.ok(state.events.every((event) => !event.actor || factionIds.includes(event.actor)),
        `${map.id}/${factionIds.length} events must not reference unselected actors`);
      summaries.push({
        map: map.id,
        count: factionIds.length,
        winner: state.winner,
        month: state.month,
        coalitions: state.events.filter((event) => event.type === 'coalition' && event.action === 'form').length,
        expeditions: state.events.filter((event) => event.type === 'expedition' && event.status === 'victory').length,
      });
    }
  }
  return summaries;
}

function forceCoalitionShape(state) {
  // In a 3x3 grid, both weak sides border central Cao Cao territory while
  // remaining independent.  This mirrors the intended “two weak states join
  // against a stronger Three Kingdoms rival” situation.
  const assignment = [
    'caocao', 'liubei', 'caocao',
    'caocao', 'caocao', 'liubei',
    'caocao', 'sunquan', 'sunquan',
  ];
  state.regions.forEach((region, index) => {
    region.owner = assignment[index];
    region.troops = assignment[index] === 'caocao' ? 260 : 72;
    region.development = 1;
    region.fort = 0;
  });
  state.factions.caocao.grain = 900;
  state.factions.liubei.grain = 300;
  state.factions.sunquan.grain = 300;
  syncSnapshots(state);
  state.month = 12;
  state.phase = 'development';
}

function testCoalitionFormAndRelease() {
  const map = makeGridMap(3, 3);
  let formed = null;
  let state = null;
  for (let seed = 0; seed < 100 && !formed; seed += 1) {
    const candidate = WarEngine.createGame(map, `coalition-${seed}`, {
      factionIds: THREE,
      coalitions: true,
      expeditions: false,
      autoWar: true,
    });
    forceCoalitionShape(candidate);
    WarEngine.step(candidate, map);
    formed = candidate.lastEvents.find((event) => event.type === 'coalition' && event.action === 'form');
    state = candidate;
  }
  assert.ok(formed, 'a strong common threat should eventually produce a coalition');
  assert.deepEqual(new Set(formed.members), new Set(['liubei', 'sunquan']),
    'the two weak neighbors should form the coalition');
  assert.equal(formed.target, 'caocao');
  const coalition = state.coalitions.find((item) => item.active);
  assert.ok(coalition, 'formed coalition must remain active');
  assert.equal(coalition.status, 'active');
  assert.equal(coalition.target, 'caocao');

  // Let the alliance make a few moves.  A coalition may pressure its target,
  // but its own members must never become military targets for one another.
  for (let month = 0; month < 4 && !state.finished; month += 1) {
    WarEngine.step(state, map);
    WarEngine.assertInvariants(state, map);
    for (const event of state.lastEvents) {
      if (event.type !== 'battle' && event.type !== 'capture') continue;
      const attacker = event.actor;
      const defender = state.regions[event.to] && state.regions[event.to].owner;
      assert.ok(!(coalition.members.includes(attacker) && coalition.members.includes(defender)),
        'coalition members must not attack each other');
    }
  }

  const active = state.coalitions.find((item) => item.id === coalition.id);
  if (active && active.active) {
    active.expiresMonth = state.month + 1;
    WarEngine.step(state, map);
    assert.ok(state.lastEvents.some((event) => event.type === 'coalition'
      && ['expire', 'dissolve'].includes(event.action)), 'coalition must be able to expire or dissolve');
    assert.equal(active.active, false);
  }
  return { seed: state.seed, formMonth: formed.month, endMonth: state.month };
}

function startExpedition(state, actor, siteId) {
  const check = WarEngine.canStartExpedition(state, actor, siteId);
  assert.equal(check.allowed, true, `${actor} should be able to start ${siteId}`);
  assert.ok(check.cost.grain > 0 && check.cost.troops > 0);
  assert.ok(Number.isInteger(check.duration) && check.duration >= 1 && check.duration <= 12);
  assert.ok(check.monthlyGrain > 0 && check.estimatedTotalGrain >= check.cost.grain);
  const origin = state.regions[check.originRegion];
  const beforeTroops = origin.troops;
  const beforeGrain = state.factions[actor].grain;
  const beforeOwners = owners(state);
  const result = WarEngine.startExpedition(state, actor, siteId);
  assert.equal(result.ok, true);
  assert.equal(origin.troops, beforeTroops - check.cost.troops,
    'departure must remove exactly the committed troops');
  assert.equal(state.factions[actor].grain, beforeGrain - check.cost.grain,
    'departure must remove exactly the committed grain');
  assert.deepEqual(owners(state), beforeOwners, 'departure cannot change main-map ownership');
  assert.equal(result.expedition.status, 'started');
  assert.ok(state.lastEvents.some((event) => event.type === 'expedition' && event.status === 'started'));
  WarEngine.assertInvariants(state, state.__testMap || campaignMap());
  return { check, result, beforeOwners };
}

function runExpeditionOutcome(seed, siteId = 'hard-site') {
  const map = campaignMap();
  const state = WarEngine.createGame(map, seed, {
    factionIds: THREE,
    coalitions: false,
    expeditions: true,
    autoWar: true,
  });
  state.__testMap = map;
  const actor = 'caocao';
  const started = startExpedition(state, actor, siteId);
  const expedition = started.result.expedition;
  while (state.month < expedition.returnMonth) WarEngine.step(state, map);
  WarEngine.assertInvariants(state, map);
  return { map, state, expedition, started };
}

function testExpeditionContract() {
  const map = campaignMap();
  const state = WarEngine.createGame(map, 'manual-expedition', {
    factionIds: THREE,
    coalitions: false,
    expeditions: true,
    autoWar: true,
  });
  state.__testMap = map;
  const started = startExpedition(state, 'caocao', 'easy-site');
  const expedition = started.result.expedition;
  const ownersBefore = started.beforeOwners;
  while (state.month < expedition.returnMonth) {
    WarEngine.step(state, map);
    assert.ok(state.factions.caocao.grain >= 0, 'expedition supply must not make grain negative');
    assert.ok(state.regions.every((region) => region.troops >= 0), 'expedition troops must stay non-negative');
  }
  assert.ok(['victory', 'defeat'].includes(expedition.status));
  assert.equal(expedition.result.troopLoss + expedition.result.survivors,
    expedition.troopsCommitted, 'expedition troops must not be created or destroyed twice');
  assert.ok(expedition.grainSpent >= expedition.grainCommitted);
  assert.deepEqual(owners(state), ownersBefore, 'expeditions cannot teleport or occupy main-map regions');
  assert.ok(state.lastEvents.some((event) => event.type === 'expedition' && event.status === expedition.status));
  const cooling = WarEngine.canStartExpedition(state, 'caocao', 'easy-site');
  assert.equal(cooling.allowed, false, 'a completed site must observe its cooldown');
  assert.match(cooling.reason, /冷却/);

  // A starving expedition can spend only the grain that is actually present;
  // an accounting record must not invent a debt as paid supply.
  const poorState = WarEngine.createGame(map, 'expedition-starvation', {
    factionIds: THREE,
    coalitions: false,
    expeditions: true,
    autoWar: true,
  });
  poorState.__testMap = map;
  const poorStart = startExpedition(poorState, 'caocao', 'hard-site');
  const poorExpedition = poorStart.result.expedition;
  poorState.factions.caocao.grain = 0;
  poorState.regions[poorExpedition.originRegion].troops = 1500;
  poorState.factions.caocao.troops = 1500;
  while (poorState.month < poorExpedition.returnMonth) WarEngine.step(poorState, map);
  assert.equal(poorExpedition.grainSpent, poorExpedition.grainCommitted,
    'zero available grain must contribute zero paid monthly supply');
  assert.equal(poorExpedition.result.grainCost, poorExpedition.grainSpent);
  WarEngine.assertInvariants(poorState, map);

  const disabled = WarEngine.createGame(map, 'expedition-disabled', {
    factionIds: THREE,
    coalitions: false,
    expeditions: false,
    autoWar: true,
  });
  assert.equal(WarEngine.canStartExpedition(disabled, 'caocao', 'easy-site').allowed, false);
  assert.equal(WarEngine.startExpedition(disabled, 'caocao', 'easy-site').ok, false);
  disabled.finished = true;
  assert.equal(WarEngine.canStartExpedition(disabled, 'caocao', 'easy-site').allowed, false);
  assert.equal(WarEngine.startExpedition(disabled, 'caocao', 'easy-site').ok, false);

  let sawVictory = false;
  let sawDefeat = false;
  for (let seed = 0; seed < 80 && (!sawVictory || !sawDefeat); seed += 1) {
    const outcome = runExpeditionOutcome(`expedition-outcome-${seed}`);
    sawVictory ||= outcome.expedition.status === 'victory';
    sawDefeat ||= outcome.expedition.status === 'defeat';
  }
  assert.equal(sawVictory, true, 'bounded seeds must expose expedition victory');
  assert.equal(sawDefeat, true, 'bounded seeds must expose expedition defeat');

  return {
    outcomeStatuses: { victory: sawVictory, defeat: sawDefeat },
    returnMonth: expedition.returnMonth,
    status: expedition.status,
  };
}

function testDefeatedActorAndVictoryRecall() {
  const map = campaignMap();
  const state = WarEngine.createGame(map, 'recall-defeated', {
    factionIds: THREE,
    coalitions: false,
    expeditions: true,
    autoWar: true,
  });
  state.__testMap = map;
  const started = startExpedition(state, 'caocao', 'easy-site');
  const expedition = started.result.expedition;
  // Remove the actor's only territory before the scheduled return.  This is
  // the ordinary defeated-lord path, without making the whole map terminal.
  const other = 'liubei';
  state.regions.forEach((region, index) => { region.owner = index === 0 ? other : 'sunquan'; });
  syncSnapshots(state);
  assert.equal(state.factions.caocao.alive, false);
  while (state.month < expedition.returnMonth) WarEngine.step(state, map);
  assert.equal(expedition.status, 'cancelled');
  assert.match(expedition.result.details, /已退出独立势力/);
  assert.equal(expedition.result.reward && Object.keys(expedition.result.reward).length, 0);
  assert.ok(state.events.some((event) => event.type === 'expedition' && event.status === 'cancelled'));

  const victoryState = WarEngine.createGame(map, 'recall-winner', {
    factionIds: THREE,
    coalitions: false,
    expeditions: true,
    autoWar: true,
  });
  victoryState.__testMap = map;
  const winnerStart = startExpedition(victoryState, 'caocao', 'hard-site');
  const active = winnerStart.result.expedition;
  victoryState.regions.forEach((region) => { region.owner = 'caocao'; });
  syncSnapshots(victoryState);
  WarEngine.step(victoryState, map);
  assert.equal(victoryState.finished, true);
  assert.equal(victoryState.winner, 'caocao');
  assert.equal(active.status, 'cancelled', 'terminal victory must close active expeditions');
  assert.equal(active.result.reason, 'victory_recall');
  assert.equal(active.result.reward && Object.keys(active.result.reward).length, 0,
    'terminal recall must not grant an unfinished site reward');
  assert.equal(active.result.survivors, active.troopsCommitted,
    'the winning expedition must recall its already committed troops');
  assert.equal(active.result.troopLoss, 0);
  const recallEvent = victoryState.lastEvents.find((event) => event.type === 'expedition'
    && event.status === 'cancelled');
  assert.ok(recallEvent && recallEvent.winner === 'caocao');
  assert.match(recallEvent.details, /统一/);
  WarEngine.assertInvariants(victoryState, map);
  return {
    defeatedStatus: expedition.status,
    recallStatus: active.status,
    recallReason: active.result.reason,
    winner: victoryState.winner,
  };
}

function main() {
  const summary = {
    selections: testAllMapsAndSelections(),
    coalition: testCoalitionFormAndRelease(),
    expedition: testExpeditionContract(),
    terminalRecall: testDefeatedActorAndVictoryRecall(),
  };
  console.log(JSON.stringify({ ok: true, ...summary }));
}

main();
