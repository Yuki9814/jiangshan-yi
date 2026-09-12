'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const engine = require('./engine.js');
const Session = require('./game-session.js');
const Orders = require('./military-orders.js');
const clone = value => JSON.parse(JSON.stringify(value));
const map = { id: 'review-fixture', width: 900, height: 100,
  regions: Array.from({ length: 9 }, (_, id) => ({ id, name: `地${id}`, x: id * 100, y: 50,
    terrain: 'plain', fertility: 1, neighbors: [id - 1, id + 1].filter(n => n >= 0 && n < 9) })), expeditionSites: [] };
const roster = ['hanxin', 'caocao', 'liubei'];
let checks = 0;
function test(name, run) { run(); checks++; console.log(`PASS ${name}`); }
const sandbox = { require: createRequire(__filename), module: { exports: {} }, console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(require.resolve('./engine.js'), 'utf8') + '\nglobalThis.reviewInternals={reinforceFront,runCampaign,executeAttack,normalizeMap,SeededRandom,updateFactionSnapshots};', sandbox);
const internal = sandbox.reviewInternals;
const vmEngine = sandbox.module.exports;
function arranged() {
  const state = vmEngine.createGame(map, 'arranged', { factionIds: roster, expeditions: false });
  state.regions.forEach((r, i) => { r.owner = i < 3 ? 'hanxin' : i < 6 ? 'caocao' : 'liubei'; r.fort = 0; });
  internal.updateFactionSnapshots(state); return state;
}
test('late reinforcement does not subtract previous transfers twice', () => {
  const state = arranged(); state.month = 400; state.phase = 'decisive';
  state.factions.hanxin.aggressionSince = 100;
  state.regions[0].troops = 150; state.regions[1].troops = 100; state.regions[2].troops = 50;
  const before = state.regions.reduce((sum, r) => sum + r.troops, 0);
  const moved = internal.reinforceFront(state, internal.normalizeMap(map), 'hanxin', state.regions[0]);
  assert.equal(moved, 86); assert.equal(state.regions[0].troops, 236);
  assert.equal(before, state.regions.reduce((sum, r) => sum + r.troops, 0));
  assert.ok(state.regions[1].troops >= 8 && state.regions[2].troops >= 8);
});
test('every active faction retains action eligibility after month 420', () => {
  const state = arranged(); state.phase = 'decisive';
  sandbox.reviewActors = [];
  vm.runInContext('globalThis.originalAttackOptions=attackOptions;attackOptions=(state,context,id)=>{reviewActors.push(id);return [];};', sandbox);
  try {
    for (const month of [419, 420, 450, 700]) {
      state.month = month; sandbox.reviewActors.length = 0;
      internal.runCampaign(state, internal.normalizeMap(map), new internal.SeededRandom(1), []);
      assert.deepEqual(Array.from(sandbox.reviewActors).sort(), roster.slice().sort());
    }
  } finally { vm.runInContext('attackOptions=globalThis.originalAttackOptions;', sandbox); }
});
test('domestic winner cannot be switched into an invalid domestic phase', () => {
  const world = require('./world-map.js'); const state = engine.createGame(world, 'phase-guard');
  engine.setCampaignPhase(state, 'truce'); state.domesticWinner = state.selectedFactionIds[0];
  const before = JSON.stringify(state); assert.equal(engine.setCampaignPhase(state, 'domestic').ok, false);
  assert.equal(JSON.stringify(state), before); engine.assertInvariants(state, world);
});
test('truce remembers the world chapter', () => {
  const world = require('./world-map.js'); const state = engine.createGame(world, 'resume');
  engine.setCampaignPhase(state, 'truce'); engine.setCampaignPhase(state, 'world'); engine.setCampaignPhase(state, 'truce');
  assert.equal(state.resumePhase, 'world'); assert.equal(engine.setCampaignPhase(state, state.resumePhase).ok, true);
});
for (const won of [true, false]) test(`actual ${won ? 'winning' : 'losing'} battle has complete troop accounting`, () => {
  const state = arranged(); state.month = 100; state.phase = 'war';
  const source = state.regions[2], target = state.regions[3]; source.troops = won ? 800 : 80; target.troops = won ? 80 : 800;
  internal.updateFactionSnapshots(state); const events = [];
  internal.executeAttack(state, internal.normalizeMap(map), source, target, 'hanxin', new internal.SeededRandom(2), events);
  const event = events.find(e => e.type === 'battle'); assert.ok(event); assert.equal(event.success, won);
  const result = event.result; assert.ok(result); assert.equal(result.before.source + result.before.target + result.levies,
    result.after.source + result.after.target + result.losses.attacker + result.losses.defender + result.dispersed);
  for (const n of [result.dispersed, result.levies, result.surrendered, result.returned]) assert.ok(Number.isFinite(n) && n >= 0);
});
test('failed commands restore state and do not consume RNG or append commands', () => {
  const session = Session.wrap(engine), state = session.createGame(map, 'failure', { factionIds: roster });
  const before = JSON.stringify(state); assert.equal(session.setCampaignPhase(state, 'world').ok, false); assert.equal(JSON.stringify(state), before);
  assert.equal(Session.dispatch(engine, map, state, { type: 'unknown' }).ok, false); assert.equal(JSON.stringify(state), before);
  assert.throws(() => Session.transaction(state, () => { state.month = -1; state.events.push({ bad: true }); throw new Error('injected failure'); }, engine, map));
  assert.equal(JSON.stringify(state), before);
});
test('order previews are pure; budgets, ownership and grain are enforced', () => {
  const session = Session.wrap(engine), state = session.createGame(map, 'council', { factionIds: roster, council: true, playerFactionId: 'hanxin' });
  const target = state.regions.find(r => r.owner === 'hanxin');
  const before = JSON.stringify(state); assert.equal(engine.canIssueOrder(state, map, 'hanxin', 'fortify', target.id).allowed, true); assert.equal(JSON.stringify(state), before);
  const grain = state.factions.hanxin.grain;
  for (let i = 0; i < 3; i++) assert.equal(session.issueOrder(state, map, 'hanxin', 'fortify', target.id).ok, true);
  assert.equal(state.factions.hanxin.grain, grain - 120); assert.equal(Orders.budget(state, 'hanxin').remaining, 0);
  const used = JSON.stringify(state); assert.equal(session.issueOrder(state, map, 'hanxin', 'farm', target.id).ok, false); assert.equal(JSON.stringify(state), used);
  assert.equal(session.issueOrder(state, map, 'caocao', 'farm', target.id).ok, false); assert.equal(JSON.stringify(state), used);
  for (let i = 0; i < 3; i++) session.step(state, map);
  assert.equal(Orders.budget(state, 'hanxin').remaining, 3); engine.assertInvariants(state, map);
});
test('muster uses only adjacent owned land and conserves total troops', () => {
  const state = arranged(); state.options.council = true; state.orderBudgets = {};
  state.regions[0].troops = 30; state.regions[1].troops = 80; state.regions[2].troops = 500;
  const before = state.regions.reduce((sum, r) => sum + r.troops, 0);
  const result = Orders.apply(state, map, 'hanxin', 'muster', 0);
  assert.equal(result.ok, true); assert.equal(result.gain, 60); assert.equal(state.regions[2].troops, 500);
  assert.equal(before, state.regions.reduce((sum, r) => sum + r.troops, 0)); assert.ok(state.regions[1].troops >= 20);
});
test('save/load continuation and ordered command replay are deterministic', () => {
  const session = Session.wrap(engine), state = session.createGame(map, 'replay', { factionIds: roster, council: true, playerFactionId: 'hanxin' });
  const target = state.regions.find(r => r.owner === 'hanxin');
  session.issueOrder(state, map, 'hanxin', 'farm', target.id);
  for (let i = 0; i < 5; i++) session.step(state, map);
  session.setCampaignPhase(state, 'truce'); session.setCampaignPhase(state, 'domestic');
  for (let i = 0; i < 2; i++) session.step(state, map);
  const save = Session.makeSave(engine, map, state), loaded = Session.loadSave(engine, [map], clone(save));
  assert.deepEqual(loaded.state, clone(state)); assert.deepEqual(clone(Session.replay(engine, [map], save)), clone(state));
  engine.step(state, map); engine.step(loaded.state, map); assert.deepEqual(clone(loaded.state), clone(state));
  const broken = clone(save); broken.state.month++; assert.throws(() => Session.loadSave(engine, [map], broken), /损坏/);
  const old = clone(save); old.rulesVersion = '0.0.0'; assert.throws(() => Session.loadSave(engine, [map], old), /版本/);
});
test('council AI never overspends quarterly budgets', () => {
  const state = engine.createGame(map, 'ai-budget', { factionIds: roster, council: true, playerFactionId: 'hanxin' });
  for (let i = 0; i < 36 && !state.finished; i++) {
    engine.step(state, map); engine.assertInvariants(state, map);
    for (const record of Object.values(state.orderBudgets || {})) assert.ok(record.used >= 0 && record.used <= 3);
  }
});
console.log(JSON.stringify({ ok: true, checks, rulesVersion: engine.version }));
