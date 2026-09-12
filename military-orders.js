/* Quarterly council rules, independent of DOM, timers and random numbers. */
(function (root) {
  'use strict';
  const LIMIT = 3;
  const KINDS = Object.freeze({
    fortify: { name: '固守', grain: 40, description: '城防 +6（上限 60），消耗 40 军粮与 1 军令。' },
    muster: { name: '集结', grain: 30, description: '从相邻己方陆地调集最多 60 兵，来源保留守军；消耗 30 军粮与 1 军令。' },
    farm: { name: '屯田', grain: 55, description: '发展度 +2（上限 22），消耗 55 军粮与 1 军令。' }
  });
  function budget(state, actor) {
    const quarter = Math.floor(state.month / 3);
    const saved = state.orderBudgets && state.orderBudgets[actor];
    const used = saved && saved.quarter === quarter ? saved.used : 0;
    return { quarter, used, remaining: Math.max(0, LIMIT - used), nextMonth: (quarter + 1) * 3 };
  }
  function plan(state, map, actor, kind, regionId) {
    const reject = reason => ({ allowed: false, reason });
    if (!state || !state.options || state.options.council !== true) return reject('本局是纯观战模式，可在选将选图时开启军议。');
    if (state.finished) return reject('本局已经结束。');
    if (!Object.prototype.hasOwnProperty.call(KINDS, kind)) return reject('未知军令。');
    const faction = state.factions[actor];
    if (!faction || !faction.alive || faction.lordId) return reject('只有存活且独立的势力可以下令。');
    if (!Number.isInteger(regionId) || !map.regions[regionId]) return reject('请选择有效地盘。');
    const target = state.regions[regionId];
    if (!target || target.owner !== actor) return reject('只能向自己的地盘下令。');
    const allowance = budget(state, actor);
    if (allowance.remaining < 1) return reject(`本季军令已用尽，第 ${allowance.nextMonth} 月恢复。`);
    const definition = KINDS[kind];
    if (!Number.isFinite(faction.grain) || faction.grain < definition.grain) return reject(`军粮不足，需要 ${definition.grain}。`);
    const result = { allowed: true, actor, kind, regionId, grainCost: definition.grain, quarter: allowance.quarter, transfers: [] };
    if (kind === 'fortify') {
      result.gain = Math.min(6, Math.max(0, 60 - target.fort));
      if (result.gain <= 0) return reject('城防已达建设上限，无需重复投入。');
    } else if (kind === 'farm') {
      result.gain = Math.min(2, Math.max(0, 22 - target.development));
      if (result.gain <= 0) return reject('发展度已达建设上限。');
    } else {
      let remaining = Math.min(60, Math.max(0, Math.floor(260 - target.troops)));
      const ids = Array.from(new Set(map.regions[regionId].neighbors || [])).sort((a, b) => a - b);
      for (const id of ids) {
        const source = state.regions[id];
        // Land adjacency only. No teleporting across friendly pockets or sea routes.
        if (!source || source.owner !== actor || id === regionId) continue;
        const reserve = Math.max(20, 12 + Math.ceil(source.fort * 0.14));
        const troops = Math.min(remaining, Math.max(0, Math.floor(source.troops - reserve)));
        if (troops > 0) { result.transfers.push({ from: id, troops }); remaining -= troops; }
        if (!remaining) break;
      }
      result.gain = result.transfers.reduce((sum, transfer) => sum + transfer.troops, 0);
      if (!result.gain) return reject('相邻己方陆地没有可调兵员，或目标驻军已满。');
    }
    result.reason = `${definition.name}：${definition.description}`;
    return result;
  }
  function apply(state, map, actor, kind, regionId) {
    const checked = plan(state, map, actor, kind, regionId);
    if (!checked.allowed) return { ok: false, ...checked };
    const target = state.regions[regionId];
    state.factions[actor].grain -= checked.grainCost;
    if (!state.orderBudgets) state.orderBudgets = {};
    state.orderBudgets[actor] = { quarter: checked.quarter, used: budget(state, actor).used + 1 };
    if (kind === 'fortify') target.fort += checked.gain;
    if (kind === 'farm') target.development += checked.gain;
    if (kind === 'muster') {
      for (const transfer of checked.transfers) state.regions[transfer.from].troops -= transfer.troops;
      target.troops += checked.gain;
    }
    return { ok: true, ...checked, name: KINDS[kind].name };
  }
  const api = { LIMIT, KINDS, budget, plan, apply };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MilitaryOrders = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
