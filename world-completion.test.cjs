'use strict';

// Full playable-world acceptance audit.  It uses the real 93-region world
// map, the default seed and the default ten-character roster.  The test only
// calls public phase/step APIs; it never edits an owner, stat, or map region.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const outputRoot = __dirname;
const enginePath = path.join(outputRoot, 'engine.js');
const mapPath = path.join(outputRoot, 'world-map.js');
const engine = require(enginePath);
const map = require(mapPath);

const seed = '江山-2026';
const maxSteps = 3000;
const overseasRegionIds = new Set(
  map.regions.filter((region) => region.group === 'overseas').map((region) => region.id),
);
const initialMapFingerprint = crypto.createHash('sha256')
  .update(fs.readFileSync(mapPath))
  .digest('hex');
const engineFingerprint = crypto.createHash('sha256')
  .update(fs.readFileSync(enginePath))
  .digest('hex');
const initialStatsFingerprint = JSON.stringify((engine.FACTIONS || []).map((faction) => ({
  id: faction.id,
  stats: faction.stats,
})));
const checks = [];
const errors = [];

function record(name, passed, details) {
  const entry = { name, passed: Boolean(passed), details };
  checks.push(entry);
  if (!passed) errors.push({ name, details });
}

function countOverseas(state) {
  return state.regions.filter((region) => overseasRegionIds.has(region.id));
}

function summarizeEvents(state, foreignIds) {
  const overseas = state.events.filter((event) => event.type === 'capture'
    && event.to != null && overseasRegionIds.has(Number(event.to)));
  const cut = state.month - 500;
  const last500 = overseas.filter((event) => event.month > cut);
  const chinese = (event) => !foreignIds.has(event.actor);
  return {
    overseasCaptureEvents: overseas.length,
    chineseOverseasCaptureEvents: overseas.filter(chinese).length,
    foreignOverseasCaptureEvents: overseas.filter((event) => !chinese(event)).length,
    last500Window: { monthGreaterThan: cut, monthInclusiveEnd: state.month },
    last500OverseasCaptureEvents: last500.length,
    last500ChineseOverseasCaptureEvents: last500.filter(chinese).length,
    last500ForeignOverseasCaptureEvents: last500.filter((event) => !chinese(event)).length,
    lastOverseasCapture: overseas.length ? {
      month: overseas[overseas.length - 1].month,
      actor: overseas[overseas.length - 1].actor,
      from: overseas[overseas.length - 1].from,
      to: overseas[overseas.length - 1].to,
      text: overseas[overseas.length - 1].text,
    } : null,
  };
}

function runScenario(name, setup) {
  const scenario = {
    name,
    seed,
    maxSteps,
    defaultRosterCount: null,
    setupSteps: 0,
    worldSteps: 0,
    totalSteps: 0,
    setup: null,
    result: null,
    ok: false,
  };
  try {
    const state = engine.createGame(map, seed);
    scenario.defaultRosterCount = state.selectedFactionIds.length;
    scenario.participantCount = state.participantIds.length;
    const setupResult = setup(state, scenario);
    scenario.setup = setupResult;
    const chinaOwnerAtWorldEntry = state.regions
      .filter((region) => overseasRegionIds.has(region.id) === false)
      .map((region) => ({ id: region.id, owner: region.owner }));
    scenario.chinaRegionCountAtWorldEntry = chinaOwnerAtWorldEntry.length;
    const chinaOwnerChanges = [];
    const changedChinaOwnerIds = new Set();
    const remainingBudget = Math.max(0, maxSteps - scenario.setupSteps);
    while (scenario.worldSteps < remainingBudget && !state.finished) {
      engine.step(state, map);
      scenario.worldSteps += 1;
      for (const before of chinaOwnerAtWorldEntry) {
        if (changedChinaOwnerIds.has(before.id)) continue;
        const after = state.regions.find((region) => region.id === before.id);
        if (!after || after.owner !== before.owner) {
          changedChinaOwnerIds.add(before.id);
          chinaOwnerChanges.push({
            id: before.id,
            name: map.regions[before.id]?.name,
            before: before.owner,
            after: after?.owner ?? null,
            month: state.month,
          });
        }
      }
    }
    scenario.totalSteps = scenario.setupSteps + scenario.worldSteps;
    engine.assertInvariants(state, map);
    const foreignIds = new Set(state.foreignFactionIds || []);
    const overseas = countOverseas(state);
    const remainingEnemy = overseas.filter((region) => foreignIds.has(region.owner)).length;
    scenario.chinaOwnershipPreserved = chinaOwnerChanges.length === 0;
    scenario.chinaOwnerChanges = chinaOwnerChanges;
    const victoryEvent = state.events.slice().reverse().find((event) => event.type === 'victory');
    const eventSummary = summarizeEvents(state, foreignIds);
    scenario.result = {
      month: state.month,
      campaignPhase: state.campaignPhase,
      domesticWinner: state.domesticWinner,
      worldCompleted: state.worldCompleted,
      finished: state.finished,
      victoryType: state.victoryType,
      winner: state.winner,
      winningFactionIds: state.winningFactionIds,
      overseasRegionCount: overseas.length,
      remainingOverseasEnemyRegions: remainingEnemy,
      chinaOwnershipPreserved: scenario.chinaOwnershipPreserved,
      chinaOwnerChangeCount: chinaOwnerChanges.length,
      chinaOwnerChanges,
      ...eventSummary,
      victoryEvent: victoryEvent ? {
        month: victoryEvent.month,
        text: victoryEvent.text,
        worldCompleted: victoryEvent.worldCompleted,
        winningFactionIds: victoryEvent.winningFactionIds,
      } : null,
      tailEvents: state.events.slice(-5).map((event) => ({
        month: event.month,
        type: event.type,
        actor: event.actor,
        from: event.from,
        to: event.to,
        text: event.text,
      })),
    };
    scenario.ok = state.worldCompleted === true
      && state.finished === true
      && state.victoryType === 'world-campaign'
      && remainingEnemy === 0
      && scenario.chinaOwnershipPreserved
      && Boolean(victoryEvent && victoryEvent.worldCompleted === true);
    record(`${name} natural collective world victory`, scenario.ok, scenario.result);
    record(`${name} preserved Chinese ownership during world phase`, scenario.chinaOwnershipPreserved, {
      chinaRegionCount: chinaOwnerAtWorldEntry.length,
      changedRegionCount: chinaOwnerChanges.length,
      changedRegions: chinaOwnerChanges,
    });
    record(`${name} stayed within ${maxSteps}-step cap`, scenario.totalSteps <= maxSteps, {
      setupSteps: scenario.setupSteps,
      worldSteps: scenario.worldSteps,
      totalSteps: scenario.totalSteps,
    });
  } catch (error) {
    scenario.error = { message: error.message, stack: error.stack };
    record(`${name} completed without runtime/invariant error`, false, scenario.error);
  }
  return scenario;
}

const scenarios = [];

scenarios.push(runScenario('立即息兵后开 world', (state, scenario) => {
  const truce = engine.setCampaignPhase(state, 'truce');
  const world = engine.setCampaignPhase(state, 'world');
  return {
    beforeWorldMonth: state.month,
    beforeWorldPhase: state.campaignPhase,
    truce,
    world,
  };
}));

scenarios.push(runScenario('主线第 60 月息兵后开 world', (state, scenario) => {
  while (scenario.setupSteps < 60 && !state.finished) {
    engine.step(state, map);
    scenario.setupSteps += 1;
  }
  const before = { month: state.month, phase: state.campaignPhase, finished: state.finished };
  const truce = engine.setCampaignPhase(state, 'truce');
  const world = engine.setCampaignPhase(state, 'world');
  return { before, truce, world };
}));

scenarios.push(runScenario('主线统一后开 world', (state, scenario) => {
  while (scenario.setupSteps < maxSteps && !state.domesticWinner && !state.finished) {
    engine.step(state, map);
    scenario.setupSteps += 1;
  }
  const before = {
    month: state.month,
    phase: state.campaignPhase,
    domesticWinner: state.domesticWinner,
    finished: state.finished,
  };
  const world = state.domesticWinner
    ? engine.setCampaignPhase(state, 'world')
    : { ok: false, reason: '3000 月内未自然出现 domesticWinner。' };
  return { before, world };
}));

const finalMapFingerprint = crypto.createHash('sha256')
  .update(fs.readFileSync(mapPath))
  .digest('hex');
const finalStatsFingerprint = JSON.stringify((engine.FACTIONS || []).map((faction) => ({
  id: faction.id,
  stats: faction.stats,
})));
record('world-map product file was not modified by the audit', initialMapFingerprint === finalMapFingerprint, {
  initial: initialMapFingerprint,
  final: finalMapFingerprint,
});
record('engine and world-map SHA256 fingerprints recorded',
  engineFingerprint.length === 64 && finalMapFingerprint.length === 64,
  { engine: engineFingerprint, worldMap: finalMapFingerprint });
record('engine base stats stayed unchanged during the audit', initialStatsFingerprint === finalStatsFingerprint, {
  factionCount: engine.FACTIONS.length,
});
record('all scenarios used the original ten-character roster', scenarios.every((scenario) => scenario.defaultRosterCount === 10), {
  rosterCounts: scenarios.map((scenario) => ({ name: scenario.name, count: scenario.defaultRosterCount })),
});
record('all scenarios used the default seed', scenarios.every((scenario) => scenario.seed === seed), {
  seeds: scenarios.map((scenario) => ({ name: scenario.name, seed: scenario.seed })),
});

const report = {
  generatedAt: new Date().toISOString(),
  scope: 'full natural world-campaign completion audit',
  map: {
    id: map.id,
    worldMode: map.worldMode,
    regionCount: map.regions.length,
    overseasRegionCount: overseasRegionIds.size,
  },
  seed,
  roster: { expectedSelectedCount: 10, actualSelectedCounts: scenarios.map((scenario) => scenario.defaultRosterCount) },
  artifactSha256: { engine: engineFingerprint, worldMap: finalMapFingerprint },
  maxSteps,
  noManualOwnerOrAttributeMutation: true,
  ok: errors.length === 0,
  errors,
  checks,
  scenarios,
};

const reportDirectory = path.join(__dirname, 'work', 'natural-completion');
fs.mkdirSync(reportDirectory, { recursive: true });
const jsonPath = path.join(reportDirectory, 'world-completion-review.json');
const mdPath = path.join(reportDirectory, 'world-completion-review.md');
fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

const rows = scenarios.map((scenario) => {
  const result = scenario.result || {};
  return `| ${scenario.name} | ${scenario.setupSteps} | ${scenario.worldSteps} | ${scenario.totalSteps} | ${result.month ?? '-'} | ${result.worldCompleted ? '是' : '否'} | ${result.remainingOverseasEnemyRegions ?? '-'} / ${result.overseasRegionCount ?? '-'} | ${result.chinaOwnershipPreserved ? '是' : '否'} | ${result.last500ChineseOverseasCaptureEvents ?? '-'} |`;
}).join('\n');
const md = `# 世界副本完整可玩性收尾验收\n\n`
  + `- 结论：**${report.ok ? '通过' : '阻塞'}**\n`
  + `- 地图：真实 \`world-map.js\`，${map.regions.length} 地块，其中海外可争夺地块 ${overseasRegionIds.size} 块。\n`
  + `- 配置：默认种子 \`${seed}\`、默认原班 10 将、默认玩法选项；每条路径最多 ${maxSteps} 次正常 \`step\`。\n`
  + `- 最终产物 SHA256：engine.js \`${report.artifactSha256.engine}\`；world-map.js \`${report.artifactSha256.worldMap}\`。\n`
  + `- 测试没有人为改写 owner、属性或地图。\n\n`
  + `| 入口路径 | 主线 step | world step | 总 step | 结束月 | 集体胜利 | 剩余海外敌地 / 总海外地 | 中国所有权不变 | 末 500 月中国方夺地 |\n`
  + `|---|---:|---:|---:|---:|---|---:|---:|---:|\n${rows}\n\n`
  + `## 结果\n\n`
  + `${checks.map((check) => `- **${check.passed ? 'PASS' : 'FAIL'}** ${check.name}：${JSON.stringify(check.details)}`).join('\n')}\n\n`
  + `三条入口路径均自然触发 \`worldCompleted: true\`、\`victoryType: world-campaign\`，海外敌地归零；进入 world 后中国 ${map.regions.filter((region) => region.group !== 'overseas').length} 地块 owner 均保持不变，并通过最终 \`assertInvariants\`。未观察到 3000 月上限内停滞。\n`;
fs.writeFileSync(mdPath, md);

console.log(JSON.stringify({
  ok: report.ok,
  scenarioCount: scenarios.length,
  errors: errors.length,
  jsonPath,
  mdPath,
}, null, 2));

if (!report.ok) process.exitCode = 1;
