'use strict';
// Final guarded migration; removed with the one-time implementation workflow.
const fs = require('node:fs'); const path = require('node:path');
process.chdir(path.resolve(__dirname, '..'));
const files = new Map();
function read(file) { if (!files.has(file)) files.set(file, fs.readFileSync(file, 'utf8')); return files.get(file); }
function edit(file, before, after) {
  const text = read(file); if (!text.includes(before)) throw new Error(file + ': missing finalization anchor ' + before.slice(0, 80));
  files.set(file, text.replace(before, after));
}
if (!read('engine.js').includes('    quickEndgame: input.quickEndgame !== false,')) {
  edit('engine.js', '    council: input.council === true,', '    council: input.council === true,\n    quickEndgame: input.quickEndgame !== false,');
  edit('engine.js', '  // Every eligible faction retains its turn, including late-game defenders.\n  for (const factionId of actionOrder) {', `  // The legacy completion mode is explicit in the UI. Its leader MUST have
  // a legal front; an isolated or unready leader can never block other actors.
  // Free simulation retains every faction's initiative at every month.
  const endgameLeader = state.options.quickEndgame && state.month >= 420
    ? actionOrder.filter(id => state.factions[id]?.alive && !state.factions[id].lordId && state.factions[id].aggressive === true)
      .filter(id => attackOptions(state, context, id).length > 0)
      .sort((left, right) => state.factions[right].territories - state.factions[left].territories
        || factionThreatPower(state, right) - factionThreatPower(state, left)
        || participantIndex(state, left) - participantIndex(state, right))[0] || null
    : null;
  for (const factionId of actionOrder) {
    if (endgameLeader && factionId !== endgameLeader) continue;`);
  edit('game-session.js', 'const state = engine.createGame(map, seed, options);', 'const state = engine.createGame(map, seed, { quickEndgame: false, ...options });');
  edit('campaign-ui.js', '<div class="campaign-options">', '<div class="campaign-options"><label><input id=quick-endgame-option type=checkbox ${this.draft.quickEndgame?\'checked\':\'\'}> 快速收尾（原版）</label>');
  edit('campaign-ui.js', "this.draft.council=$('council-option').checked;", "this.draft.quickEndgame=$('quick-endgame-option').checked;this.draft.council=$('council-option').checked;");
  edit('campaign-ui.js', "      $('setup-start').disabled=count<3||count>12;", "      $('setup-dialog').querySelector('.setup-footnote').textContent+=' 自由推演允许长期僵局；快速收尾在第 420 月后只让最强且有合法前线的势力主动进攻。';\n      $('setup-start').disabled=count<3||count>12;");
  edit('review-regressions.test.cjs', "{ factionIds: roster, expeditions: false }", "{ factionIds: roster, expeditions: false, quickEndgame: false }");
  edit('review-regressions.test.cjs', "test('every active faction retains action eligibility after month 420'", "test('free simulation retains every active faction after month 420'");
  edit('review-regressions.test.cjs', "test('domestic winner cannot", `test('fast completion cannot select a leader without a legal front', () => {
  const state = arranged(); state.month = 421; state.phase = 'decisive'; state.options.quickEndgame = true;
  state.regions[3].owner = 'hanxin';
  for (const region of state.regions) region.troops = region.owner === 'hanxin' ? 8 : 130;
  internal.updateFactionSnapshots(state); const events = [];
  internal.runCampaign(state, internal.normalizeMap(map), new internal.SeededRandom(9), events);
  assert.ok(events.some(event => ['battle', 'capture'].includes(event.type) && event.actor !== 'hanxin'));
});
test('domestic winner cannot`);
  edit('RULES.md', '420 月之后所有合法参战势力仍有主动进攻资格。', '自由推演模式下，420 月之后所有合法参战势力仍有主动进攻资格。');
  files.set('RULES.md', read('RULES.md') + '\n### 推演模式与旧版兼容\n\n浏览器默认自由推演，不保证每个种子在固定月份内统一。可在新局勾选“快速收尾（原版）”：第 420 月起，最强且确有合法进攻前线的势力取得主地图主动权，其他势力仍防守；无合法前线的领先者不再阻塞战局。这是公开的演出规则，不能等同于中性竞技模拟。\n\n为兼容原有调用方，底层 WarEngine.createGame 的 quickEndgame 选项默认 true；浏览器 GameSession 入口明确默认 false。原有 500 月收尾测试继续覆盖兼容模式，新回归测试另行验证自由模式的行动资格和快速模式的无前线情况。\n');
}
if (!read('game-session.js').includes('function validateNumericState(')) {
  const validation = `  function validateNumericState(state) {
    const requireNumber = (value, label) => { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('存档数值无效：' + label); };
    if (!state || !Array.isArray(state.regions) || !state.factions || !state.options) throw new Error('存档状态结构无效。');
    for (const region of state.regions) for (const key of ['troops', 'development', 'fort']) requireNumber(region?.[key], 'region.' + key);
    for (const faction of Object.values(state.factions)) for (const key of ['grain', 'troops', 'morale', 'fatigue', 'economy']) requireNumber(faction?.[key], 'faction.' + key);
    for (const key of ['coalitions', 'expeditions', 'autoWar', 'council', 'quickEndgame']) if (typeof state.options[key] !== 'boolean') throw new Error('存档玩法开关无效。');
    if (!Number.isInteger(state.rngState) || state.rngState < 0 || state.rngState > 0xffffffff) throw new Error('存档随机状态无效。');
  }
`;
  edit('game-session.js', '  function loadSave(engine, maps, value) {', validation + '  function loadSave(engine, maps, value) {');
  edit('game-session.js', '    const state = clone(value.state);', '    const state = clone(value.state);\n    validateNumericState(state);');
  edit('game-session.js', "if (previous.result) slots.put(previous.result, 'backup');", "if (previous.result && previous.result.checksum !== frozen.checksum) slots.put(previous.result, 'backup');");
}
files.set('index.html', read('index.html').replaceAll('20260912-chronicle', '20260912-council'));
files.set('.github/workflows/ci.yml', read('.github/workflows/ci.yml').replaceAll('actions/upload-artifact@v4', 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02'));
for (const [file, text] of files) fs.writeFileSync(file, text);
console.log('Finalized modes, import validation and cache revision.');
