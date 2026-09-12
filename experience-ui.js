/* Local saves and optional military orders. No remote services. */
(function () {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  class ExperienceUI {
    constructor(options) {
      Object.assign(this, options); this.store = new GameSession.Store(); this.ready = false;
      this.status = '每 12 月、下令和暂停时自动保存'; this.savedKey = ''; this.autoKey = ''; this.commandCount = 0;
      this.dialog = document.getElementById('experience-dialog');
      document.getElementById('experience-button').onclick = () => this.open();
      this.dialog.onclick = e => {
        if (e.target.closest('[data-close-save]')) this.dialog.close();
        const action = e.target.closest('[data-save-action]')?.dataset.saveAction;
        if (action === 'save') void this.save(true);
        if (action === 'export') this.exportSave();
        if (action === 'import') document.getElementById('save-file').click();
        if (action === 'backup') void this.restoreBackup();
        const kind = e.target.closest('[data-order-kind]')?.dataset.orderKind;
        if (kind) this.issue(kind);
      };
      this.dialog.onchange = e => { if (e.target.id === 'order-region') { this.regionId = Number(e.target.value); this.render(); document.getElementById('order-region')?.focus(); } };
      document.getElementById('save-file').onchange = e => { const file = e.target.files[0]; e.target.value = ''; if (file) void this.importSave(file); };
      document.addEventListener('visibilitychange', () => { if (document.hidden) { this.onPause(); void this.save(false); } });
    }
    key() { const s = this.getState(); return s ? `${this.getMap().id}|${s.seed}|${s.month}|${s.eventCounter}|${s.commandLog?.length || 0}` : ''; }
    activate() { this.ready = true; this.commandCount = this.getState().commandLog?.length || 0; }
    statusText() { const el = document.getElementById('save-status'); if (el) el.textContent = this.status; document.getElementById('experience-button').title = this.status; }
    async restoreLatest() {
      for (const slot of ['latest', 'backup']) {
        try {
          const value = await this.store.read(slot); if (!value) continue;
          const loaded = GameSession.loadSave(this.engine, this.maps, value);
          this.onRestore(loaded); this.savedKey = this.key(); this.status = `已恢复第 ${loaded.state.month} 月${slot === 'backup' ? '备份' : '存档'}`;
          this.toast(this.status); return true;
        } catch (error) { this.status = `存档未载入：${error.message}；旧文件保留。`; }
      }
      return false;
    }
    async save(manual = false) {
      if (!this.ready || !this.getState()) return false;
      const key = this.key(); if (!manual && key === this.savedKey) return true;
      try {
        const value = GameSession.makeSave(this.engine, this.getMap(), this.getState());
        await this.store.write(value); this.savedKey = key; this.status = `已保存第 ${value.state.month} 月 · 本浏览器本地`;
        if (manual) this.toast(this.status); this.statusText(); return true;
      } catch (error) {
        this.status = `本地保存失败：${error.message} 请导出存档。`;
        if (manual || !this.warned) { this.toast(this.status); this.warned = true; }
        this.statusText(); return false;
      }
    }
    changed() {
      if (!this.ready) return;
      const s = this.getState(), key = this.key(), count = s.commandLog?.length || 0;
      if (key !== this.autoKey && (s.month > 0 && s.month % 12 === 0 || count !== this.commandCount)) { this.autoKey = key; void this.save(false); }
      this.commandCount = count;
    }
    open() { this.onPause(); const selected = this.getSelected(); this.regionId = selected?.type === 'region' ? selected.id : null; this.render(); if (!this.dialog.open) this.dialog.showModal(); }
    render() {
      const s = this.getState(), map = this.getMap(), actor = s.options.playerFactionId || s.selectedFactionIds[0];
      const faction = s.factions[actor], owned = s.regions.filter(r => r.owner === actor), budget = MilitaryOrders.budget(s, actor);
      if (!owned.some(r => r.id === this.regionId)) this.regionId = owned[0]?.id ?? null;
      const ledger = faction?.resourceLedger;
      const orders = s.options.council ? `<p>${esc(faction.name)} · 剩余 <strong id="orders-remaining">${budget.remaining} / 3</strong> 军令 · 第 ${budget.nextMonth} 月恢复</p><p>军粮 ${Math.round(faction.grain)}${ledger ? ` · 上次产粮 ${Math.round(ledger.income)} / 养兵 ${Math.round(ledger.maintenance)}（其他支出另计）` : ''}</p><label class="order-target">下令地点<select id="order-region" aria-label="下令地点">${owned.map(r => `<option value="${r.id}" ${r.id === this.regionId ? 'selected' : ''}>${esc(map.regions[r.id].name)}</option>`).join('')}</select></label><div class="order-choices">${Object.entries(MilitaryOrders.KINDS).map(([kind, definition]) => {
        const plan = this.engine.canIssueOrder(s, map, actor, kind, this.regionId);
        return `<article><h4>${definition.name}</h4><p>${definition.description}</p><small>${esc(plan.allowed ? `本次实际增加 ${plan.gain}${kind === 'muster' ? ' 兵' : ''}。` : plan.reason)}</small><button class="primary-button" data-order-kind="${kind}" ${plan.allowed ? '' : 'disabled'}>下令${definition.name}</button></article>`;
      }).join('')}</div><p class="experience-note">只指挥开局选定的势力。其他势力按相同成本和季度上限自动军议。集结立即生效，仅允许相邻己方陆地；尚非完整行军系统。</p>` : '<p>本局保留自动观战。新开局时勾选「有限军议」并选择执掌势力，即可使用固守、集结和屯田。</p>';
      this.dialog.innerHTML = `<header class="dialog-header"><h2 id="experience-title">存档与军令</h2><button class="plain-button" data-close-save>返回战局</button></header><div class="experience-body"><section><h3>保存这局山河</h3><p id="save-status" role="status">${esc(this.status)}</p><div class="save-actions"><button class="plain-button" data-save-action="save">立即保存</button><button class="plain-button" data-save-action="export">导出存档</button><button class="plain-button" data-save-action="import">导入存档</button><button class="plain-button" data-save-action="backup">恢复上份备份</button></div><p class="experience-note">刷新后恢复并保持暂停。存档包含规则版本、随机状态与有序操作记录。清理浏览器数据会移除存档，请另行导出。备份是上一次成功保存的版本。</p></section><section><h3>${s.options.council ? '本季军议' : '纯观战模式'}</h3>${orders}</section></div>`;
    }
    issue(kind) {
      try {
        const s = this.getState(), result = this.engine.issueOrder(s, this.getMap(), s.options.playerFactionId, kind, this.regionId);
        this.toast(result.ok ? `${result.name}已执行，消耗 ${result.grainCost} 军粮和 1 军令。` : result.reason);
        this.onRefresh(); this.render(); this.dialog.querySelector('[data-close-save]')?.focus({ preventScroll: true });
      } catch (error) { this.toast(`下令失败，战局已恢复：${error.message}`); }
    }
    exportSave() {
      try {
        const save = GameSession.makeSave(this.engine, this.getMap(), this.getState());
        const url = URL.createObjectURL(new Blob([JSON.stringify(save)], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = `jiangshan-month-${save.state.month}.json`; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000); this.toast('存档已导出。');
      } catch (error) { this.toast(error.message); }
    }
    async importSave(file) {
      this.onPause();
      try {
        if (file.size > GameSession.MAX_BYTES) throw new Error('文件超过 12 MB。');
        const loaded = GameSession.loadSave(this.engine, this.maps, JSON.parse(await file.text()));
        if (!window.confirm(`载入第 ${loaded.state.month} 月战局？当前战局会先尝试保存。`)) return;
        await this.save(false); this.onRestore(loaded); this.savedKey = ''; await this.save(false); this.render(); this.toast('存档已载入，推演保持暂停。');
      } catch (error) { this.toast(`导入失败：${error.message}`); }
    }
    async restoreBackup() {
      this.onPause();
      try {
        const value = await this.store.read('backup'); if (!value) { this.toast('暂无备份。'); return; }
        const loaded = GameSession.loadSave(this.engine, this.maps, value);
        if (!window.confirm(`恢复第 ${loaded.state.month} 月备份？`)) return;
        this.onRestore(loaded); this.savedKey = ''; await this.save(false); this.render(); this.toast('备份已载入。');
      } catch (error) { this.toast(`备份未载入：${error.message}`); }
    }
  }
  window.ExperienceUI = ExperienceUI;
})();
