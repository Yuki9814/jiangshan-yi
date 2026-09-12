'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const WarEngine = require('./engine.js');

function makeSyntheticMap(width = 10, height = 5) {
  const regions = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const id = y * width + x;
      const neighbors = [];
      if (x > 0) neighbors.push(id - 1);
      if (x < width - 1) neighbors.push(id + 1);
      if (y > 0) neighbors.push(id - width);
      if (y < height - 1) neighbors.push(id + width);
      regions.push({
        id,
        name: `合成区域${id + 1}`,
        x,
        y,
        neighbors,
        terrain: id % 11 === 0 ? 'mountain' : id % 7 === 0 ? 'river' : 'plain',
        fertility: 0.8 + ((id * 7) % 6) * 0.1,
      });
    }
  }
  return { width, height, regions };
}

function makeLineMap() {
  const regions = [];
  for (let id = 0; id < 10; id += 1) {
    const neighbors = [];
    if (id > 0) neighbors.push(id - 1);
    if (id < 9) neighbors.push(id + 1);
    regions.push({ id, name: `对照区域${id + 1}`, x: id, y: 0, neighbors, terrain: 'plain', fertility: 1 });
  }
  return { width: 10, height: 1, regions };
}

function cloneMap(map) {
  return {
    ...map,
    regions: map.regions.map((region) => ({ ...region, neighbors: region.neighbors.slice() })),
  };
}

function runTargetTerrainContrast(map, seed, sourceId, targetId, targetTerrain) {
  const variant = cloneMap(map);
  variant.regions[targetId].terrain = targetTerrain;
  const state = WarEngine.createGame(variant, seed, { autoWar: true });
  for (const region of state.regions) {
    region.troops = 8;
    region.development = 0;
    region.fort = 0;
  }
  state.regions[sourceId].troops = 130;
  state.regions[sourceId].development = 8;
  state.regions[targetId].troops = 36;
  state.regions[targetId].development = 1;
  for (const faction of Object.values(state.factions)) {
    faction.grain = 40;
    faction.morale = 1;
    faction.fatigue = 0;
    faction.territories = state.regions.filter((region) => region.owner === faction.id).length;
    faction.troops = state.regions
      .filter((region) => region.owner === faction.id)
      .reduce((sum, region) => sum + region.troops, 0);
    faction.alive = faction.territories > 0;
  }
  state.factions[state.regions[sourceId].owner].grain = 220;
  state.month = 12;
  state.phase = 'development';
  WarEngine.step(state, variant);
  const battle = state.lastEvents.find((event) => event.type === 'battle'
    && event.from === sourceId && event.to === targetId);
  assert.ok(battle, `${targetTerrain} contrast should produce the controlled battle`);
  const match = battle.details.match(/力量比=([0-9.]+)/);
  assert.ok(match, `${targetTerrain} contrast should expose the battle ratio`);
  return Number(match[1]);
}

function testTargetTerrainContrast() {
  const map = makeLineMap();
  const initial = WarEngine.createGame(map, 'terrain-target-contrast', { autoWar: true });
  const source = initial.regions.find((region) => map.regions[region.id].neighbors.length === 1);
  const targetId = map.regions[source.id].neighbors[0];
  const plainAdvantage = runTargetTerrainContrast(map, 'terrain-target-contrast', source.id, targetId, 'plain');
  const mountainAdvantage = runTargetTerrainContrast(map, 'terrain-target-contrast', source.id, targetId, 'mountain');
  // This observes the engine's emitted battle ratio.  A mountain target must
  // reduce it by more than defense-only terrain mirroring would produce,
  // proving that attackPower also reads the target terrain.
  assert.ok(mountainAdvantage < plainAdvantage * 0.85,
    `mountain target should penalize the attack: plain=${plainAdvantage}, mountain=${mountainAdvantage}`);
  return { plainAdvantage, mountainAdvantage, source: source.id, target: targetId };
}

function loadRealMap() {
  const candidates = [
    path.join(__dirname, 'map-data.js'),
    path.join(__dirname, 'map-data.cjs'),
    path.join(__dirname, 'map-data.json'),
    path.join(__dirname, '..', 'map-data.js'),
    path.join(__dirname, '..', 'map-data.cjs'),
    path.join(__dirname, '..', 'map-data.json'),
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const loaded = candidate.endsWith('.json') ? require(candidate) : require(candidate);
      const map = loaded && (loaded.default || loaded.MAP_DATA || loaded.map || loaded);
      if (map && Array.isArray(map.regions)) return { map, source: candidate };
    } catch (error) {
      // The synthetic suite remains useful while a map-data module is being built.
    }
  }
  return null;
}

function run(map, seed, limit = 500, checkEveryStep = false) {
  const state = WarEngine.createGame(map, seed, { autoWar: true });
  let battleCount = 0;
  let captureCount = 0;
  let eliminateCount = 0;
  let allegianceCount = 0;
  for (let index = 0; index < limit && !state.finished; index += 1) {
    WarEngine.step(state, map);
    if (checkEveryStep) WarEngine.assertInvariants(state, map);
    for (const event of state.lastEvents) {
      if (event.type === 'battle') battleCount += 1;
      if (event.type === 'capture') captureCount += 1;
      if (event.type === 'eliminate') eliminateCount += 1;
      if (event.type === 'allegiance') allegianceCount += 1;
      if (event.type === 'battle' || event.type === 'capture') {
        assert.ok(map.regions[event.from].neighbors.includes(event.to), `attack ${event.from}->${event.to} must be adjacent`);
      }
    }
  }
  WarEngine.assertInvariants(state, map);
  return { state, months: state.month, battleCount, captureCount, eliminateCount, allegianceCount };
}

function assertTerminal(result, label) {
  assert.equal(result.state.finished, true, `${label} should unify before the limit`);
  assert.ok(result.state.winner, `${label} needs a winner`);
  assert.equal(new Set(result.state.regions.map((region) => region.owner)).size, 1, `${label} should have one owner`);
  assert.ok(result.eliminateCount + result.allegianceCount >= result.state.participantIds.length - 1,
    `${label} should resolve every losing faction by elimination or allegiance`);
}

function main() {
  const syntheticMap = makeSyntheticMap();
  const terrainContrast = testTargetTerrainContrast();
  const first = run(syntheticMap, 'replay-seed', 500, true);
  const second = run(syntheticMap, 'replay-seed', 500, true);
  assert.deepEqual(first.state, second.state, 'same seed must produce the same state');
  assertTerminal(first, 'synthetic replay');
  assert.ok(first.battleCount > 0, 'synthetic map should contain battles');
  assert.ok(first.captureCount > 0, 'synthetic map should contain captures');

  const seedResults = [];
  for (let seed = 1; seed <= 30; seed += 1) {
    const result = run(syntheticMap, `synthetic-${seed}`, 500);
    assertTerminal(result, `synthetic-${seed}`);
    seedResults.push({ seed, winner: result.state.winner, months: result.months });
  }
  const winners = new Set(seedResults.map((item) => item.winner));
  assert.ok(winners.size >= 3, `expected varied winners, got ${winners.size}`);

  const real = loadRealMap();
  let realSummary = null;
  if (real) {
    const realResults = [];
    for (let seed = 1; seed <= 30; seed += 1) {
      const result = run(real.map, `real-${seed}`, 500);
      assertTerminal(result, `real-${seed}`);
      realResults.push({ seed, winner: result.state.winner, months: result.months });
    }
    realSummary = {
      source: real.source,
      seeds: realResults.length,
      winners: Array.from(new Set(realResults.map((item) => item.winner))),
      minMonths: Math.min(...realResults.map((item) => item.months)),
      maxMonths: Math.max(...realResults.map((item) => item.months)),
      meanMonths: Math.round(realResults.reduce((sum, item) => sum + item.months, 0) / realResults.length),
    };
  }

  const output = {
    targetTerrainContrast: terrainContrast,
    synthetic: {
      regions: syntheticMap.regions.length,
      seeds: seedResults.length,
      winners: Array.from(winners),
      minMonths: Math.min(...seedResults.map((item) => item.months)),
      maxMonths: Math.max(...seedResults.map((item) => item.months)),
      meanMonths: Math.round(seedResults.reduce((sum, item) => sum + item.months, 0) / seedResults.length),
    },
    real: realSummary,
  };
  console.log(JSON.stringify(output));
}

main();
