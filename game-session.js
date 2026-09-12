/* Session boundary: rollback, accepted commands, versioned saves and local storage. */
(function (root) {
  'use strict';
  const FORMAT = 1;
  const MAX_BYTES = 12 * 1024 * 1024;
  const clone = value => JSON.parse(JSON.stringify(value));
  function checksum(text) {
    // Corruption detection / content identity, not a cryptographic signature.
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return (hash >>> 0).toString(16).padStart(8, '0');
  }
  const identities = new WeakMap();
  function identity(engine, map) {
    let versions = identities.get(map);
    if (!versions) { versions = new Map(); identities.set(map, versions); }
    if (!versions.has(engine.version)) versions.set(engine.version, checksum(JSON.stringify({
      version: engine.version, factions: engine.FACTIONS, relationships: engine.RELATIONSHIPS,
      map: { id: map.id, width: map.width, height: map.height, worldMode: map.worldMode,
        regions: map.regions.map(({ path, ...logic }) => logic), links: map.links, seaLinks: map.seaLinks,
        expeditionSites: map.expeditionSites, initialOwners: map.initialOwners, ownerSlots: map.ownerSlots,
        requiredFactionIds: map.requiredFactionIds, domesticRegionIds: map.domesticRegionIds }
    })));
    return versions.get(engine.version);
  }
  function transaction(state, action, engine, map) {
    // Historical events are immutable after their tick. Copy the small mutable
    // domain plus array references, rather than deep-copying years of history.
    const events = (state.events || []).slice();
    const lastEvents = (state.lastEvents || []).slice();
    const snapshot = clone({ ...state, events: [], lastEvents: [] });
    const rollback = () => {
      for (const key of Object.keys(state)) delete state[key];
      Object.assign(state, snapshot, { events, lastEvents });
    };
    try {
      const result = action();
      if (result && result.ok === false) { rollback(); return result; }
      engine.assertInvariants(state, map);
      return result;
    } catch (error) { rollback(); throw error; }
  }
  function dispatch(engine, map, state, input) {
    if (!input || typeof input !== 'object') return { ok: false, reason: '命令无效。' };
    let command;
    if (input.type === 'phase' && typeof input.phase === 'string') command = { type: 'phase', phase: input.phase };
    else if (input.type === 'expedition' && typeof input.actor === 'string' && typeof input.siteId === 'string') command = { type: 'expedition', actor: input.actor, siteId: input.siteId };
    else if (input.type === 'order' && typeof input.actor === 'string' && typeof input.kind === 'string' && Number.isInteger(input.regionId)) {
      if (state.options.playerFactionId !== input.actor) return { ok: false, reason: '只能指挥开局选定的势力。' };
      command = { type: 'order', actor: input.actor, kind: input.kind, regionId: input.regionId };
    } else return { ok: false, reason: '未知或不完整的命令。' };
    return transaction(state, () => {
      const result = command.type === 'phase' ? engine.setCampaignPhase(state, command.phase)
        : command.type === 'expedition' ? engine.startExpedition(state, command.actor, command.siteId)
          : engine.issueOrder(state, map, command.actor, command.kind, command.regionId);
      if (result.ok) {
        if (!Array.isArray(state.commandLog)) state.commandLog = [];
        state.commandLog.push({ month: state.month, sequence: state.commandLog.length, command });
      }
      return result;
    }, engine, map);
  }
  function wrap(engine) {
    let map = null;
    const requireMap = () => { if (!map) throw new Error('尚未载入战场。'); return map; };
    return { ...engine, raw: engine,
      bindMap(next) { map = next; },
      createGame(next, seed, options) { map = next; const state = engine.createGame(map, seed, options); state.commandLog = []; return state; },
      step(state, next) { map = next; return transaction(state, () => engine.step(state, map), engine, map); },
      setCampaignPhase(state, phase) { return dispatch(engine, requireMap(), state, { type: 'phase', phase }); },
      startExpedition(state, actor, siteId) { return dispatch(engine, requireMap(), state, { type: 'expedition', actor, siteId }); },
      issueOrder(state, next, actor, kind, regionId) { map = next; return dispatch(engine, map, state, { type: 'order', actor, kind, regionId }); }
    };
  }
  function makeSave(engine, map, state) {
    engine.assertInvariants(state, map);
    const snapshot = clone(state);
    const json = JSON.stringify(snapshot);
    if (new TextEncoder().encode(json).length > MAX_BYTES - 4096) throw new Error('战史过大，暂不能写入单个存档。现有存档仍保留。');
    return { format: 'jiangshan-save', formatVersion: FORMAT, rulesVersion: engine.version,
      mapId: map.id, contentId: identity(engine, map), savedAt: new Date().toISOString(),
      checksum: checksum(json), state: snapshot };
  }
  function loadSave(engine, maps, value) {
    if (!value || value.format !== 'jiangshan-save' || value.formatVersion !== FORMAT) throw new Error('无法识别存档格式。');
    if (value.rulesVersion !== engine.version) throw new Error('存档规则版本不同，请使用对应版本打开；当前战局未变更。');
    const map = maps.find(candidate => candidate.id === value.mapId);
    if (!map || value.contentId !== identity(engine, map)) throw new Error('地图或人物数据版本不同，不能直接载入。');
    const text = JSON.stringify(value.state);
    if (new TextEncoder().encode(text).length > MAX_BYTES || checksum(text) !== value.checksum) throw new Error('存档不完整或内容已损坏。');
    const state = clone(value.state);
    if (typeof state.seed !== 'string' || state.seed.length > 48 || !Number.isInteger(state.month) || state.month > 10000) throw new Error('存档月份或种子无效。');
    if (!Array.isArray(state.commandLog) || state.commandLog.length > 100000) throw new Error('存档命令记录无效。');
    let month = -1;
    state.commandLog.forEach((entry, sequence) => {
      if (!entry || entry.sequence !== sequence || !Number.isInteger(entry.month) || entry.month < month || entry.month > state.month || !entry.command || !['phase', 'expedition', 'order'].includes(entry.command.type)) throw new Error('存档命令顺序无效。');
      month = entry.month;
    });
    engine.assertInvariants(state, map);
    return { state, map, config: { ...state.options, mapId: map.id, factionIds: state.selectedFactionIds.slice() } };
  }
  function replay(engine, maps, value) {
    const loaded = loadSave(engine, maps, value);
    const state = engine.createGame(loaded.map, loaded.state.seed, loaded.state.options);
    state.commandLog = [];
    for (const entry of loaded.state.commandLog) {
      while (state.month < entry.month) {
        if (state.finished) throw new Error('回放已结束，后续命令无效。');
        engine.step(state, loaded.map);
      }
      const result = dispatch(engine, loaded.map, state, entry.command);
      if (!result.ok) throw new Error(`回放命令被拒绝：${result.reason}`);
    }
    while (state.month < loaded.state.month) {
      if (state.finished) throw new Error('回放月份与存档不符。');
      engine.step(state, loaded.map);
    }
    return state;
  }
  class Store {
    constructor() { this.pending = Promise.resolve(); this.connection = null; }
    open() {
      if (this.connection) return this.connection;
      this.connection = new Promise((resolve, reject) => {
        if (!root.indexedDB) { reject(new Error('当前浏览器不允许本地存档，请导出保存。')); return; }
        const request = root.indexedDB.open('jiangshan-saves-v1', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('slots');
        request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('请关闭旧版本页面后再保存。'));
      });
      return this.connection;
    }
    async read(slot = 'latest') {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const request = db.transaction('slots').objectStore('slots').get(slot);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    }
    write(value) {
      const frozen = clone(value);
      const operation = this.pending.catch(() => {}).then(async () => {
        const db = await this.open();
        await new Promise((resolve, reject) => {
          const tx = db.transaction('slots', 'readwrite');
          const slots = tx.objectStore('slots');
          const previous = slots.get('latest');
          previous.onsuccess = () => { if (previous.result) slots.put(previous.result, 'backup'); slots.put(frozen, 'latest'); };
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error || new Error('写入失败。'));
          tx.onabort = () => reject(tx.error || new Error('写入被取消。'));
        });
      });
      this.pending = operation;
      return operation;
    }
  }
  const api = { FORMAT, MAX_BYTES, transaction, dispatch, wrap, makeSave, loadSave, replay, Store };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.GameSession = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
