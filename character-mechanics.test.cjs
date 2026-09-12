'use strict';

/*
 * Character mechanics acceptance suite.
 *
 * This suite deliberately drives the public createGame/step/query surface.  A
 * few scenarios redistribute owners after createGame so that a relationship
 * can be observed without relying on a private mutating test hook.  The
 * redistribution only writes fields that createGame itself owns and then
 * recomputes the public faction snapshots before calling assertInvariants.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const WarEngine = require('./engine.js');

const ATTRIBUTE_KEYS = [
  'strength',
  'intelligence',
  'strategy',
  'charisma',
  'command',
  'development',
  'defense',
];

const FACTION_IDS = [
  'hanxin',
  'guanyu',
  'lvbu',
  'zhuyuanzhang',
  'xuda',
  'changyuchun',
  'chenyouliang',
  'zhugeliang',
  'caocao',
  'lishi',
];

const EXPANDED_FACTION_IDS = [
  'liubei', 'zhangfei', 'zhaoyun', 'zhouyu', 'simayi', 'sunquan',
  'yuefei', 'qijiguang', 'xiangyu', 'genghiskhan', 'saladin', 'richard',
];

const WORLD_FACTION_IDS = [
  'gwanggaeto', 'ieyasu', 'ashoka', 'jayavarman7', 'stefan', 'mansamusa',
  'moctezuma2', 'pachacuti', 'kamehameha',
];

const EXPECTED_RELATIONSHIPS = [
  ['xuda', 'zhuyuanzhang', 'allegiance'],
  ['changyuchun', 'zhuyuanzhang', 'allegiance'],
  ['guanyu', 'zhugeliang', 'alliance'],
  ['guanyu', 'caocao', 'gratitude'],
  ['caocao', 'lvbu', 'rivalry'],
  ['zhuyuanzhang', 'chenyouliang', 'rivalry'],
];

const TEST_MAP = makeLineMap(14);
const DEFAULT_SEED = '江山-2026';

function makeLineMap(count) {
  const regions = [];
  for (let id = 0; id < count; id += 1) {
    const neighbors = [];
    if (id > 0) neighbors.push(id - 1);
    if (id + 1 < count) neighbors.push(id + 1);
    regions.push({
      id,
      name: `机制测试区域${id + 1}`,
      x: id,
      y: 0,
      neighbors,
      terrain: id % 7 === 0 ? 'mountain' : 'plain',
      fertility: 1,
    });
  }
  return { width: count, height: 1, regions };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mapFactionTable() {
  const table = Object.create(null);
  for (const faction of WarEngine.FACTIONS || []) table[faction.id] = faction;
  return table;
}

function assertKnownFactions() {
  const actual = (WarEngine.FACTIONS || []).map((faction) => faction.id);
  assert.deepEqual(actual.slice(0, FACTION_IDS.length), FACTION_IDS,
    'the roster must retain the ten fixed characters first');
  assert.deepEqual(actual.slice(FACTION_IDS.length, FACTION_IDS.length + EXPANDED_FACTION_IDS.length), EXPANDED_FACTION_IDS,
    'the roster must expose the twelve selectable expansion characters');
  assert.deepEqual(actual.slice(FACTION_IDS.length + EXPANDED_FACTION_IDS.length), WORLD_FACTION_IDS,
    'the world registry must expose its nine additional representatives');
}

function attributeTable() {
  const attributes = WarEngine.ATTRIBUTES;
  assert.ok(attributes && typeof attributes === 'object', 'ATTRIBUTES must be exported metadata');
  const entries = Array.isArray(attributes)
    ? attributes.map((attribute, index) => [attribute.key || attribute.id || ATTRIBUTE_KEYS[index], attribute])
    : Object.entries(attributes);
  assert.deepEqual(entries.map(([key]) => key).sort(), ATTRIBUTE_KEYS.slice().sort(),
    'ATTRIBUTES must describe exactly the seven fixed dimensions');
  for (const [key, metadata] of entries) {
    assert.ok(metadata && typeof metadata === 'object', `${key} metadata must be an object`);
    assert.ok(metadata.label || metadata.name, `${key} metadata needs a display label`);
    assert.ok(metadata.description || metadata.help || metadata.detail,
      `${key} metadata needs a description`);
  }
  return Object.fromEntries(entries);
}

function staticFactionSnapshot() {
  return (WarEngine.FACTIONS || []).map((faction) => ({
    id: faction.id,
    role: faction.role,
    stats: Object.fromEntries(ATTRIBUTE_KEYS.map((key) => [key, faction.stats[key]])),
  }));
}

function assertFixedRoster(snapshot) {
  assert.deepEqual(staticFactionSnapshot(), snapshot, 'role/stats must stay fixed after simulation');
}

function assertStatsShape(stats, label, max = 100) {
  assert.ok(stats && typeof stats === 'object', `${label} stats must be an object`);
  assert.deepEqual(Object.keys(stats).sort(), ATTRIBUTE_KEYS.slice().sort(), `${label} stats keys`);
  for (const key of ATTRIBUTE_KEYS) {
    assert.equal(typeof stats[key], 'number', `${label}.${key} must be numeric`);
    assert.ok(Number.isFinite(stats[key]), `${label}.${key} must be finite`);
    assert.ok(stats[key] >= 1 && stats[key] <= max,
      `${label}.${key} must remain between 1 and ${max}`);
  }
}

function relationFields(relation) {
  return {
    from: relation.from ?? relation.actor ?? relation.source ?? relation.subject,
    to: relation.to ?? relation.target ?? relation.lord ?? relation.object,
    type: relation.type ?? relation.kind ?? relation.relation,
  };
}

function testStaticData() {
  assertKnownFactions();
  const metadata = attributeTable();
  assert.ok((WarEngine.RELATIONSHIPS || []).length >= 6, 'the six base relationship pairs must remain');
  const relationships = WarEngine.RELATIONSHIPS.map(relationFields);
  const relationshipKeys = relationships.map(({ from, to, type }) => `${from}>${to}:${type}`);
  for (const [from, to, type] of EXPECTED_RELATIONSHIPS) {
    assert.ok(relationshipKeys.includes(`${from}>${to}:${type}`),
      `base relationship ${from}>${to}:${type} must remain explicit and auditable`);
  }

  const snapshot = staticFactionSnapshot();
  for (const faction of WarEngine.FACTIONS) {
    assert.ok(faction.role, `${faction.id} needs a role`);
    assertStatsShape(faction.stats, `${faction.id} roster`);
  }
  for (const seed of ['static-a', 'static-b', 17, DEFAULT_SEED]) {
    const state = WarEngine.createGame(TEST_MAP, seed, { autoWar: true });
    for (const factionId of FACTION_IDS) {
      assertStatsShape(state.factions[factionId].stats, `${factionId} state`);
      assert.deepEqual(state.factions[factionId].stats, mapFactionTable()[factionId].stats,
        `${factionId} state stats must come from fixed roster data`);
      assert.equal(state.factions[factionId].role, mapFactionTable()[factionId].role,
        `${factionId} role must come from fixed roster data`);
      if (typeof WarEngine.effectiveStats === 'function') {
        assert.deepEqual(WarEngine.effectiveStats(state, factionId), state.factions[factionId].stats,
          `${factionId} with no retainers should have its base effective stats`);
      }
    }
    assertFixedRoster(snapshot);
  }
  return {
    attributeKeys: ATTRIBUTE_KEYS,
    metadataKeys: Object.keys(metadata),
    relationshipPairs: relationships,
  };
}

function factionRoot(state, id) {
  const seen = new Set();
  let current = id;
  while (current && state.factions[current] && state.factions[current].lordId) {
    assert.ok(!seen.has(current), `lord chain for ${id} must not contain a cycle`);
    seen.add(current);
    current = state.factions[current].lordId;
  }
  return current;
}

function syncControlledState(state) {
  for (const factionId of FACTION_IDS) {
    const faction = state.factions[factionId];
    const owned = state.regions.filter((region) => region.owner === factionId);
    faction.territories = owned.length;
    faction.troops = owned.reduce((sum, region) => sum + region.troops, 0);
    faction.alive = Boolean(owned.length) && !faction.lordId;
  }
  state.finished = false;
  state.winner = null;
  state.lastEvents = [];
  WarEngine.assertInvariants(state, TEST_MAP);
  return state;
}

function configurePair(seed, actor, subject, options = {}) {
  const state = WarEngine.createGame(TEST_MAP, seed, { autoWar: true });
  const targetId = options.targetId ?? 7;
  const sourceId = options.sourceId ?? targetId - 1;
  assert.ok(TEST_MAP.regions[sourceId].neighbors.includes(targetId), 'controlled pair must be adjacent');
  const actorRegionIds = options.actorRegionIds || state.regions
    .map((region) => region.id)
    .filter((id) => id !== targetId);
  const subjectRegionIds = options.subjectRegionIds || [targetId];
  for (const region of state.regions) {
    const isSubject = subjectRegionIds.includes(region.id);
    const isActor = actorRegionIds.includes(region.id);
    region.owner = isSubject ? subject : isActor ? actor : null;
    region.troops = isSubject ? (options.subjectTroops ?? 32)
      : isActor ? (options.actorTroops ?? 160) : 18;
    region.development = isSubject ? 2 : isActor ? 12 : 1;
    region.fort = isSubject ? 4 : isActor ? 12 : 7;
  }
  for (const factionId of FACTION_IDS) {
    state.factions[factionId].lordId = null;
    state.factions[factionId].grain = factionId === actor
      ? (options.actorGrain ?? 900)
      : factionId === subject ? (options.subjectGrain ?? 260) : 0;
    state.factions[factionId].morale = factionId === subject ? (options.subjectMorale ?? 0.52) : 1.12;
    state.factions[factionId].fatigue = 0;
    state.factions[factionId].economy = 1;
    state.factions[factionId].victories = 0;
  }
  Object.assign(state.factions[actor].stats, options.actorStats || {});
  Object.assign(state.factions[subject].stats, options.subjectStats || {});
  state.month = options.month ?? 130;
  state.phase = options.phase || (state.month > 360 ? 'decisive' : state.month > 84 ? 'attrition' : state.month > 12 ? 'war' : 'development');
  syncControlledState(state);
  return { state, sourceId, targetId };
}

function configurePursuitScenario(seed) {
  const state = WarEngine.createGame(TEST_MAP, seed, { autoWar: true });
  const actor = 'hanxin';
  const firstDefender = 'lvbu';
  const secondDefender = 'lishi';
  const firstSourceId = 5;
  const firstTargetId = 6;
  const secondTargetId = 7;
  for (const region of state.regions) {
    region.owner = actor;
    region.troops = 8;
    region.development = 1;
    region.fort = 3;
  }
  state.regions[firstSourceId].troops = 480;
  state.regions[firstSourceId].development = 15;
  state.regions[firstSourceId].fort = 5;
  state.regions[firstTargetId].owner = firstDefender;
  state.regions[firstTargetId].troops = 12;
  state.regions[firstTargetId].fort = 2;
  state.regions[secondTargetId].owner = secondDefender;
  state.regions[secondTargetId].troops = 12;
  state.regions[secondTargetId].fort = 2;
  for (const factionId of FACTION_IDS) {
    const faction = state.factions[factionId];
    faction.lordId = null;
    faction.grain = factionId === actor ? 1100
      : factionId === firstDefender || factionId === secondDefender ? 30 : 0;
    faction.morale = 1;
    faction.fatigue = 0;
    faction.economy = 1;
    faction.victories = 0;
  }
  state.month = 24;
  state.phase = 'war';
  syncControlledState(state);
  return {
    state,
    actor,
    firstDefender,
    secondDefender,
    firstSourceId,
    firstTargetId,
    secondTargetId,
  };
}

function eventDetails(event) {
  if (typeof event.details === 'string') return event.details;
  if (event.details == null) return '';
  return JSON.stringify(event.details);
}

function eventPair(event) {
  return {
    actor: event.actor ?? event.fromFaction ?? event.attacker ?? event.sourceFaction,
    subject: event.subject ?? event.vassal ?? event.targetFaction ?? event.subordinate,
    defender: event.defender ?? event.targetFaction ?? event.defenderId,
  };
}

function assertEventAdjacency(map, event) {
  if (event.from == null || event.to == null) return;
  assert.ok(Number.isInteger(event.from) && Number.isInteger(event.to),
    `${event.type} event region refs must be integers`);
  assert.ok(map.regions[event.from].neighbors.includes(event.to),
    `${event.type} ${event.from}->${event.to} must be adjacent`);
}

function assertEventShape(state, map) {
  for (const event of state.events) {
    if (['battle', 'capture', 'tactic', 'pursuit'].includes(event.type)) {
      assertEventAdjacency(map, event);
    }
    if (event.type === 'allegiance') {
      assert.equal(typeof event.success, 'boolean', 'allegiance needs success');
      const { actor, subject } = eventPair(event);
      assert.ok(actor && subject, 'allegiance needs actor and subject');
      assertEventAdjacency(map, event);
      assert.ok(eventDetails(event), 'allegiance needs details');
    }
    if (event.type === 'tactic') {
      assert.equal(typeof event.success, 'boolean', 'tactic needs success/detected boolean');
      const { actor, defender } = eventPair(event);
      assert.ok(actor && defender, 'tactic needs actor and defender');
      assertEventAdjacency(map, event);
      assert.ok(eventDetails(event), 'tactic needs details');
    }
  }
}

function runOne(state, map) {
  WarEngine.step(state, map);
  WarEngine.assertInvariants(state, map);
  assertEventShape(state, map);
  return state;
}

function findAllegiance(actor, subject, maxSeeds = 1200) {
  for (let index = 0; index < maxSeeds; index += 1) {
    const seed = `allegiance-search-${index}`;
    const scenario = configurePair(seed, actor, subject);
    const before = clone(scenario.state);
    runOne(scenario.state, TEST_MAP);
    const event = scenario.state.lastEvents.find((item) => item.type === 'allegiance'
      && eventPair(item).actor === actor && eventPair(item).subject === subject);
    if (event) return { ...scenario, before, event, seed };
  }
  return null;
}

function testAllegianceAndTeams(staticSnapshot) {
  const found = findAllegiance('zhuyuanzhang', 'xuda');
  assert.ok(found, 'a seed search must find a controlled old-lord allegiance');
  const { state, before, event, sourceId, targetId, seed } = found;
  assert.equal(event.type, 'allegiance');
  assert.equal(event.success, true);
  assert.equal(eventPair(event).actor, 'zhuyuanzhang');
  assert.equal(eventPair(event).subject, 'xuda');
  assert.equal(state.factions.xuda.lordId, 'zhuyuanzhang', 'subject must retain its lord link');
  assert.ok(state.factions.xuda, 'subject talent record must remain present');
  assert.deepEqual(state.factions.xuda.stats, before.factions.xuda.stats,
    'surrender must not mutate the subject base stats');
  assert.deepEqual(staticFactionSnapshot(), staticSnapshot, 'allegiance must not mutate roster stats');

  const beforeControlled = before.regions.filter((region) => factionRoot(before, region.owner) === 'zhuyuanzhang').length;
  const afterControlled = state.regions.filter((region) => factionRoot(state, region.owner) === 'zhuyuanzhang').length;
  assert.ok(afterControlled >= beforeControlled, 'allegiance must transfer territory into the receiving team');
  assert.ok(state.regions[targetId].owner === 'zhuyuanzhang' || state.regions[targetId].owner === 'xuda',
    'allegiance target must stay inside the receiving team');
  assert.equal(state.factions.xuda.territories, 0, 'surrendered subject territory must transfer out of its roster');
  assert.equal(state.factions.xuda.troops, 0, 'surrendered subject troops must merge into the receiving army');
  assert.equal(state.factions.xuda.grain, 0, 'surrendered subject grain must merge into the receiving treasury');
  assert.ok(state.factions.zhuyuanzhang.troops >= before.factions.zhuyuanzhang.troops + before.factions.xuda.troops,
    'receiving army must include the surrendered troops');
  assert.ok(state.factions.zhuyuanzhang.grain >= before.factions.zhuyuanzhang.grain,
    'receiving treasury must include the surrendered grain after monthly accounting');
  const allegianceDetails = eventDetails(event);
  assert.match(allegianceDetails, /转入领地=\d+/,
    'allegiance details must report transferred territory');
  assert.match(allegianceDetails, /兵力=\d+/,
    'allegiance details must report transferred troops');
  assert.match(allegianceDetails, /军粮=\d+/,
    'allegiance details must report transferred grain');

  const beforeEffective = WarEngine.effectiveStats(before, 'zhuyuanzhang');
  const afterEffective = WarEngine.effectiveStats(state, 'zhuyuanzhang');
  assertStatsShape(beforeEffective, 'before allegiance effective stats', 125);
  assertStatsShape(afterEffective, 'after allegiance effective stats', 125);
  assert.ok(ATTRIBUTE_KEYS.some((key) => afterEffective[key] > beforeEffective[key]),
    'receiving lord effective stats must include the retained general');
  assert.equal(WarEngine.effectiveStats(state, 'xuda').strength, before.factions.xuda.stats.strength,
    'subject query must remain based on the subject character, not a mutated base stat');

  // Add a legal nested retainer in this isolated state to exercise the graph
  // query without exposing a private mutation entry point from the engine.
  state.factions.lishi.lordId = 'xuda';
  state.factions.lishi.alive = false;
  state.factions.lishi.territories = 0;
  state.factions.lishi.troops = 0;
  state.factions.lishi.grain = 0;
  WarEngine.assertInvariants(state, TEST_MAP);
  assert.equal(factionRoot(state, 'lishi'), 'zhuyuanzhang', 'nested retainer chain must resolve to its root lord');
  const nestedEffective = WarEngine.effectiveStats(state, 'zhuyuanzhang');
  assert.ok(ATTRIBUTE_KEYS.some((key) => nestedEffective[key] > afterEffective[key]),
    'nested retained talent must contribute to the root team without changing base stats');

  const totalBefore = before.regions.reduce((sum, region) => sum + region.troops, 0);
  const totalAfter = state.regions.reduce((sum, region) => sum + region.troops, 0);
  assert.ok(totalAfter > 0 && totalBefore > 0, 'allegiance must conserve non-empty armies');
  assert.equal(before.regions.filter((region) => region.owner != null).length,
    state.regions.filter((region) => region.owner != null).length,
    'allegiance must conserve the number of owned regions');
  assert.ok(state.factions.zhuyuanzhang.grain >= 0 && state.factions.xuda.grain >= 0,
    'allegiance merged grain must remain non-negative');
  assert.ok(sourceId != null, 'controlled allegiance must have a source region');
  return {
    seed,
    month: event.month,
    actor: eventPair(event).actor,
    subject: eventPair(event).subject,
    source: event.from,
    target: event.to,
    beforeControlled,
    afterControlled,
    effectiveBefore: beforeEffective,
    effectiveAfter: afterEffective,
  };
}

function testAllegianceBoundaries() {
  const invalidPairs = [
    ['caocao', 'lvbu'],
    ['zhuyuanzhang', 'chenyouliang'],
    ['zhuyuanzhang', 'hanxin'],
  ];
  const events = [];
  for (const [actor, subject] of invalidPairs) {
    for (let index = 0; index < 40; index += 1) {
      const scenario = configurePair(`invalid-allegiance-${actor}-${subject}-${index}`, actor, subject);
      runOne(scenario.state, TEST_MAP);
      events.push(...scenario.state.lastEvents.filter((event) => event.type === 'allegiance'));
    }
  }
  assert.equal(events.length, 0, 'rivals and non-specified pairs must never emit allegiance');

  return { rejectedPairs: invalidPairs, allegianceEvents: events.length };
}

function testAllegianceGates() {
  const checks = [];
  const cases = [
    {
      name: 'non-adjacent',
      options: {
        actorRegionIds: [1],
        subjectRegionIds: [12],
        actorTroops: 600,
        subjectTroops: 20,
        actorGrain: 900,
      },
    },
    {
      name: 'weaker-lord',
      options: {
        actorRegionIds: [6],
        subjectRegionIds: [7, 8],
        actorTroops: 20,
        subjectTroops: 500,
        actorGrain: 900,
      },
    },
    {
      name: 'insufficient-grain',
      options: {
        actorRegionIds: [6],
        subjectRegionIds: [7],
        actorTroops: 600,
        subjectTroops: 20,
        actorGrain: 0,
      },
    },
  ];
  for (const item of cases) {
    const scenario = configurePair(`allegiance-gate-${item.name}`, 'zhuyuanzhang', 'xuda', item.options);
    runOne(scenario.state, TEST_MAP);
    const events = scenario.state.lastEvents.filter((event) => event.type === 'allegiance');
    assert.equal(events.length, 0, `${item.name} condition must block old-lord allegiance`);
    checks.push({ name: item.name, allegianceEvents: events.length });
  }

  let successCount = 0;
  const sampleCount = 48;
  for (let index = 0; index < sampleCount; index += 1) {
    const scenario = configurePair(`allegiance-probability-${index}`, 'zhuyuanzhang', 'xuda');
    runOne(scenario.state, TEST_MAP);
    if (scenario.state.lastEvents.some((event) => event.type === 'allegiance')) successCount += 1;
  }
  assert.ok(successCount > 0 && successCount < sampleCount,
    `old-lord allegiance must remain seed-probabilistic (${successCount}/${sampleCount})`);
  return { gates: checks, probability: { successCount, sampleCount } };
}

function makeTacticScenario(seed, defenderId) {
  return configurePair(seed, 'hanxin', defenderId, {
    month: 24,
    phase: 'war',
    actorTroops: 180,
    subjectTroops: 110,
    actorGrain: 860,
    subjectGrain: 520,
    subjectMorale: 1,
  });
}

function tacticEventFor(state, actor, defender) {
  return state.lastEvents.find((event) => event.type === 'tactic'
    && eventPair(event).actor === actor
    && eventPair(event).defender === defender);
}

function testTacticContrast() {
  const matched = [];
  for (let index = 0; index < 240; index += 1) {
    const seed = `tactic-search-${index}`;
    const lowInt = makeTacticScenario(seed, 'lvbu');
    const highInt = makeTacticScenario(seed, 'zhugeliang');
    assert.equal(lowInt.state.rngState, highInt.state.rngState, 'contrast states must share the random sample');
    const lowBeforeGrain = lowInt.state.factions.hanxin.grain;
    const highBeforeGrain = highInt.state.factions.hanxin.grain;
    runOne(lowInt.state, TEST_MAP);
    runOne(highInt.state, TEST_MAP);
    const lowEvent = tacticEventFor(lowInt.state, 'hanxin', 'lvbu');
    const highEvent = tacticEventFor(highInt.state, 'hanxin', 'zhugeliang');
    if (lowEvent && highEvent) {
      matched.push({ seed, lowInt, highInt, lowEvent, highEvent, lowBeforeGrain, highBeforeGrain });
      if (lowEvent.success !== highEvent.success) break;
    }
  }
  assert.ok(matched.length > 0, 'tactic must appear in a controlled campaign');
  const contrast = matched.find((item) => item.lowEvent.success !== item.highEvent.success);
  assert.ok(contrast, 'the same random sample must expose intelligence affecting tactic detection');
  assert.equal(contrast.lowEvent.success, true,
    'low-intelligence defender should allow the contrasted high-strategy tactic');
  assert.equal(contrast.highEvent.success, false,
    'high-intelligence defender should detect the same tactic sample');
  for (const item of matched) {
    const lowDetails = eventDetails(item.lowEvent);
    const highDetails = eventDetails(item.highEvent);
    assert.match(lowDetails + highDetails, /粮|粮耗|军粮/, 'tactic details must expose its grain cost');
    const lowCost = Number((lowDetails.match(/耗粮=(\d+(?:\.\d+)?)/) || [])[1]);
    const highCost = Number((highDetails.match(/耗粮=(\d+(?:\.\d+)?)/) || [])[1]);
    assert.ok(Number.isFinite(lowCost) && lowCost > 0, 'successful or detected tactic must consume positive grain');
    assert.ok(Number.isFinite(highCost) && highCost > 0, 'high-intelligence tactic attempt must consume positive grain');
    assert.equal(item.lowInt.state.tacticCooldowns.hanxin, item.lowEvent.month,
      'tactic use must set the actor cooldown at the event month');
    assert.equal(item.highInt.state.tacticCooldowns.hanxin, item.highEvent.month,
      'detected tactic attempt must also set the actor cooldown');
    assert.ok(item.lowInt.state.factions.hanxin.grain <= item.lowBeforeGrain + 120,
      'tactic run must account for a grain cost within the month economy');
    assert.ok(item.highInt.state.factions.hanxin.grain <= item.highBeforeGrain + 120,
      'tactic detection run must account for tactic resource accounting');
  }

  const eventGap = [];
  const defaultState = WarEngine.createGame(loadRealMap(), DEFAULT_SEED, { autoWar: true });
  const beforeRole = staticFactionSnapshot();
  for (let index = 0; index < 500 && !defaultState.finished; index += 1) {
    runOne(defaultState, loadRealMap());
  }
  assertFixedRoster(beforeRole);
  const byActor = new Map();
  for (const event of defaultState.events.filter((item) => item.type === 'tactic')) {
    const actor = eventPair(event).actor;
    const list = byActor.get(actor) || [];
    list.push(event.month);
    byActor.set(actor, list);
  }
  for (const [actor, months] of byActor) {
    for (let index = 1; index < months.length; index += 1) {
      eventGap.push({ actor, from: months[index - 1], to: months[index], gap: months[index] - months[index - 1] });
      assert.ok(months[index] - months[index - 1] >= 2,
        `${actor} tactic cooldown must leave at least one month between tactics`);
    }
  }
  return {
    matchedSamples: matched.length,
    contrastSeed: contrast.seed,
    lowIntelligence: { success: contrast.lowEvent.success, details: eventDetails(contrast.lowEvent) },
    highIntelligence: { success: contrast.highEvent.success, details: eventDetails(contrast.highEvent) },
    defaultSeedTactics: defaultState.events.filter((event) => event.type === 'tactic').map((event) => ({
      month: event.month,
      actor: eventPair(event).actor,
      defender: eventPair(event).defender,
    })),
    eventGap,
  };
}

function testConcretePursuitTrace() {
  const scenario = configurePursuitScenario('pursuit-4');
  const { state, actor, firstDefender, secondDefender, firstSourceId, firstTargetId, secondTargetId } = scenario;
  runOne(state, TEST_MAP);
  const events = state.lastEvents;
  const tacticIndex = events.findIndex((event) => event.type === 'tactic'
    && event.actor === actor && event.defender === firstDefender && event.success === true);
  assert.ok(tacticIndex >= 0, 'controlled pursuit must begin with a successful tactic');
  const firstCaptureIndex = events.findIndex((event, index) => index > tacticIndex
    && event.type === 'capture' && event.actor === actor && event.pursuit !== true);
  assert.ok(firstCaptureIndex >= 0, 'successful tactic must be followed by the first capture');
  const firstCapture = events[firstCaptureIndex];
  assert.equal(firstCapture.from, firstSourceId, 'first capture must march from the prepared source');
  assert.equal(firstCapture.to, firstTargetId, 'first capture must take the first weak adjacent defender');
  assert.equal(firstCapture.success, true);
  const pursuitCaptures = events.filter((event) => event.type === 'capture'
    && event.actor === actor && event.pursuit === true);
  assert.equal(pursuitCaptures.length, 1, 'controlled successful tactic must produce one extra pursuit capture');
  const pursuitCapture = pursuitCaptures[0];
  assert.equal(pursuitCapture.month, firstCapture.month, 'pursuit must happen in the same month');
  assert.equal(pursuitCapture.from, firstCapture.to,
    'pursuit must launch from the region captured by the first attack');
  assert.equal(pursuitCapture.to, secondTargetId, 'pursuit must take the next contiguous weak enemy');
  assert.equal(pursuitCapture.actor, firstCapture.actor);
  assert.equal(pursuitCapture.success, true);
  assertEventAdjacency(TEST_MAP, firstCapture);
  assertEventAdjacency(TEST_MAP, pursuitCapture);
  const pursuitBattles = events.filter((event) => event.type === 'battle'
    && event.actor === actor && event.pursuit === true);
  assert.equal(pursuitBattles.length, 1, 'pursuit capture must have a marked pursuit battle');
  assert.equal(pursuitBattles[0].from, firstCapture.to);
  assert.equal(pursuitBattles[0].to, pursuitCapture.to);
  assert.equal(state.monthlyTacticCaptures, 1, 'state must account for the one monthly pursuit capture');
  assert.equal(state.regions[firstTargetId].owner, actor, 'first region must remain with the attacker');
  assert.equal(state.regions[secondTargetId].owner, actor, 'pursuit target must be captured by the attacker');
  return {
    seed: 'pursuit-4',
    month: firstCapture.month,
    actor,
    tactic: { from: events[tacticIndex].from, to: events[tacticIndex].to, success: true },
    firstCapture: { from: firstCapture.from, to: firstCapture.to, pursuit: Boolean(firstCapture.pursuit) },
    pursuitCapture: { from: pursuitCapture.from, to: pursuitCapture.to, pursuit: true },
  };
}

function pursuitEvents(state) {
  return state.events.filter((event) => event.type === 'pursuit'
    || event.pursuit === true
    || /追击/.test(`${event.text || ''}${eventDetails(event)}`));
}

function testReplayAndLongRun(staticSnapshot) {
  const map = loadRealMap();
  const first = WarEngine.createGame(map, DEFAULT_SEED, { autoWar: true });
  const second = WarEngine.createGame(map, DEFAULT_SEED, { autoWar: true });
  const firstTrace = [];
  const secondTrace = [];
  for (let month = 0; month < 500 && !first.finished; month += 1) {
    runOne(first, map);
    firstTrace.push({ month: first.month, events: clone(first.lastEvents), snapshot: clone(first) });
  }
  for (let month = 0; month < 500 && !second.finished; month += 1) {
    runOne(second, map);
    secondTrace.push({ month: second.month, events: clone(second.lastEvents), snapshot: clone(second) });
  }
  assert.deepEqual(firstTrace, secondTrace, 'same seed must reproduce allegiance/tactic/replay state exactly');
  assert.equal(first.finished, true, 'default real-map seed must still unify');
  assert.ok(first.winner, 'unified run must expose a winner');
  assert.equal(new Set(first.regions.map((region) => factionRoot(first, region.owner))).size, 1,
    'unified run must have one controlling team');
  assertFixedRoster(staticSnapshot);

  const pursuitByMonth = new Map();
  for (const event of pursuitEvents(first)) {
    assertEventAdjacency(map, event);
    const actor = eventPair(event).actor || event.actor;
    const key = `${event.month}:${actor}`;
    pursuitByMonth.set(key, (pursuitByMonth.get(key) || 0) + 1);
  }
  for (const [key, count] of pursuitByMonth) {
    assert.ok(count <= 1, `extra pursuit must be at most one region per faction/month (${key})`);
  }
  const capturesByMonth = new Map();
  for (const event of first.events.filter((item) => item.type === 'capture')) {
    const actor = eventPair(event).actor || event.actor;
    const key = `${event.month}:${actor}`;
    capturesByMonth.set(key, (capturesByMonth.get(key) || 0) + 1);
  }
  for (const [key, count] of capturesByMonth) {
    assert.ok(count <= 2, `one campaign plus at most one extra pursuit capture is allowed (${key})`);
  }
  for (const event of first.events.filter((item) => item.type === 'battle' || item.type === 'capture' || item.type === 'tactic')) {
    assertEventAdjacency(map, event);
  }
  return {
    seed: DEFAULT_SEED,
    months: first.month,
    winner: first.winner,
    events: first.events.length,
    tacticEvents: first.events.filter((event) => event.type === 'tactic').length,
    allegianceEvents: first.events.filter((event) => event.type === 'allegiance').length,
    pursuitEvents: pursuitEvents(first).length,
  };
}

function loadRealMap() {
  const candidates = [
    path.join(__dirname, 'map-data.js'),
    path.join(__dirname, 'map-data.cjs'),
    path.join(__dirname, 'map-data.json'),
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const loaded = require(candidate);
    const map = loaded && (loaded.default || loaded.MAP_DATA || loaded.map || loaded);
    if (map && Array.isArray(map.regions)) return map;
  }
  throw new Error('character mechanics tests need map-data.js');
}

function main() {
  const staticResult = testStaticData();
  const allegiance = testAllegianceAndTeams(staticFactionSnapshot());
  const boundaries = testAllegianceBoundaries();
  const allegianceGates = testAllegianceGates();
  const tactic = testTacticContrast();
  const pursuit = testConcretePursuitTrace();
  const replay = testReplayAndLongRun(staticFactionSnapshot());
  const output = {
    ok: true,
    static: staticResult,
    allegiance,
    boundaries,
    allegianceGates,
    tactic,
    pursuit,
    replay,
  };
  console.log(JSON.stringify(output, null, 2));
}

main();
