'use strict';

/*
 * Jiangshan / Cross-era Generals
 *
 * The engine is deliberately self contained.  It uses a small xorshift
 * generator so a replay only needs the public seed and the map.  No battle
 * result is selected by a list of winners: a battle compares the forces,
 * supply, terrain and commanders, while the seeded generator only supplies a
 * bounded field condition and target tie-breaks.
 */

const TERRAIN_BONUS = {
  plain: { attack: 1, defend: 1 },
  mountain: { attack: 0.9, defend: 1.28 },
  river: { attack: 0.88, defend: 1.18 },
};

const DOMESTIC_ZONES = new Set(['china', 'china-border', 'domestic']);
const FOREIGN_ZONES = new Set(['overseas', 'foreign', 'world-overseas']);

// These are the seven permanent character dimensions used by every system in
// the simulation.  They describe the character, so they never change when a
// battle, recruitment action, or allegiance event changes the map state.
const ATTRIBUTES = [
  { key: 'strength', label: '武力', description: '影响正面冲击、伤亡与近战攻坚。' },
  { key: 'intelligence', label: '智力', description: '影响识破谋略、应对计策与临场判断。' },
  { key: 'strategy', label: '谋略', description: '影响策动计谋、战术收益与进攻计划。' },
  { key: 'charisma', label: '魅力', description: '影响招揽归顺、士气与阵营凝聚。' },
  { key: 'command', label: '统帅', description: '影响调度、征募与可投入战力。' },
  { key: 'development', label: '政务', description: '影响粮秣、经济与领地发展。' },
  { key: 'defense', label: '守御', description: '影响守城、要塞与阵地防护。' },
];

const BASE_FACTIONS = [
  {
    id: 'hanxin',
    name: '韩信',
    era: '西汉',
    style: '奇正并用',
    role: '统帅',
    description: '善于以少击众，调度迅捷，喜欢从薄弱边境打开缺口。',
    color: '#b4893e',
    stats: {
      strength: 83, intelligence: 95, strategy: 99, charisma: 68,
      command: 96, development: 76, defense: 64,
    },
    initialRegion: null,
  },
  {
    id: 'guanyu',
    name: '关羽',
    era: '东汉末',
    style: '威震守险',
    role: '猛将',
    description: '正面作战强，依托险要地形时防线更难撼动。',
    color: '#6c8455',
    stats: {
      strength: 96, intelligence: 72, strategy: 78, charisma: 88,
      command: 90, development: 68, defense: 91,
    },
    initialRegion: null,
  },
  {
    id: 'lvbu',
    name: '吕布',
    era: '东汉末',
    style: '锐骑突击',
    role: '猛将',
    description: '冲击力极强，但长期治理与补给的效率偏低。',
    color: '#86677f',
    stats: {
      strength: 100, intelligence: 36, strategy: 42, charisma: 72,
      command: 72, development: 52, defense: 70,
    },
    initialRegion: null,
  },
  {
    id: 'zhuyuanzhang',
    name: '朱元璋',
    era: '明初',
    style: '整军安民',
    role: '君主',
    description: '善于经营粮源和民心，疆域扩大后恢复力很强。',
    color: '#a75e4c',
    stats: {
      strength: 75, intelligence: 83, strategy: 86, charisma: 97,
      command: 88, development: 100, defense: 85,
    },
    initialRegion: null,
  },
  {
    id: 'xuda',
    name: '徐达',
    era: '明初',
    style: '稳进善守',
    role: '统帅',
    description: '推进节奏稳定，攻守均衡，适合经营连续战线。',
    color: '#597f91',
    stats: {
      strength: 88, intelligence: 82, strategy: 85, charisma: 73,
      command: 92, development: 78, defense: 88,
    },
    initialRegion: null,
  },
  {
    id: 'changyuchun',
    name: '常遇春',
    era: '明初',
    style: '疾战破阵',
    role: '猛将',
    description: '进攻决断快，连续胜利时士气上升明显。',
    color: '#b07847',
    stats: {
      strength: 94, intelligence: 70, strategy: 74, charisma: 76,
      command: 94, development: 66, defense: 76,
    },
    initialRegion: null,
  },
  {
    id: 'chenyouliang',
    name: '陈友谅',
    era: '元末',
    style: '水陆并进',
    role: '君主',
    description: '河网与平原战场适应力好，初期扩张意愿较强。',
    color: '#558b86',
    stats: {
      strength: 80, intelligence: 76, strategy: 79, charisma: 74,
      command: 88, development: 75, defense: 71,
    },
    initialRegion: null,
  },
  {
    id: 'zhugeliang',
    name: '诸葛亮',
    era: '三国蜀汉',
    style: '屯田持重',
    role: '谋臣',
    description: '善于长期建设和后勤调度，战争越久越不易崩溃。',
    color: '#90984d',
    stats: {
      strength: 52, intelligence: 100, strategy: 99, charisma: 86,
      command: 78, development: 94, defense: 82,
    },
    initialRegion: null,
  },
  {
    id: 'caocao',
    name: '曹操',
    era: '东汉末',
    style: '挟势整合',
    role: '君主',
    description: '能够快速吸纳周边资源，兼具进攻和经营能力。',
    color: '#6c7091',
    stats: {
      strength: 78, intelligence: 90, strategy: 92, charisma: 91,
      command: 91, development: 88, defense: 79,
    },
    initialRegion: null,
  },
  {
    id: 'lishi',
    name: '李靖',
    era: '初唐',
    style: '远近相形',
    role: '统帅',
    description: '擅长选择战场和分割战线，边境稳定后行动效率提高。',
    color: '#9e6976',
    stats: {
      strength: 86, intelligence: 93, strategy: 96, charisma: 79,
      command: 93, development: 80, defense: 80,
    },
    initialRegion: null,
  },
];

// The six canonical relationship pairs intentionally remain a small, auditable
// data set.  Alliance and rivalry are read symmetrically by the engine; the
// directed allegiance and gratitude entries retain their historical direction.
const BASE_RELATIONSHIPS = [
  {
    id: 'xuda-zhuyuanzhang-allegiance',
    from: 'xuda',
    to: 'zhuyuanzhang',
    type: 'allegiance',
    name: '旧主',
    description: '徐达与朱元璋属于旧主与部将关系，局势有利时更容易重归麾下。',
  },
  {
    id: 'changyuchun-zhuyuanzhang-allegiance',
    from: 'changyuchun',
    to: 'zhuyuanzhang',
    type: 'allegiance',
    name: '旧主',
    description: '常遇春与朱元璋属于旧主与部将关系，军心动摇时可能主动归顺。',
  },
  {
    id: 'guanyu-zhugeliang-alliance',
    from: 'guanyu',
    to: 'zhugeliang',
    type: 'alliance',
    name: '同阵营',
    description: '关羽与诸葛亮视为同阵营协作关系，彼此较少主动交战。',
  },
  {
    id: 'guanyu-caocao-gratitude',
    from: 'guanyu',
    to: 'caocao',
    type: 'gratitude',
    name: '旧恩',
    description: '关羽与曹操保留旧恩牵制，降低相互进攻倾向，但不构成忠属。',
  },
  {
    id: 'caocao-lvbu-rivalry',
    from: 'caocao',
    to: 'lvbu',
    type: 'rivalry',
    name: '宿敌',
    description: '曹操与吕布视为宿敌，边界相接时更容易相互施压。',
  },
  {
    id: 'zhuyuanzhang-chenyouliang-rivalry',
    from: 'zhuyuanzhang',
    to: 'chenyouliang',
    type: 'rivalry',
    name: '宿敌',
    description: '朱元璋与陈友谅视为宿敌，双方会提高对彼此边界的进攻意愿。',
  },
];

const ATTRIBUTE_KEYS = ATTRIBUTES.map((attribute) => attribute.key);
const EXTRA_CHARACTER_IDS = new Set([
  'liubei', 'zhangfei', 'zhaoyun', 'zhouyu', 'simayi', 'sunquan',
  'yuefei', 'qijiguang', 'xiangyu', 'genghiskhan', 'saladin', 'richard',
]);

function readCharacterExpansion() {
  const sources = [];
  if (typeof globalThis !== 'undefined' && globalThis.CHARACTER_EXPANSION) {
    sources.push(globalThis.CHARACTER_EXPANSION);
  }
  if (typeof globalThis !== 'undefined' && globalThis.WORLD_CHARACTERS) {
    sources.push(globalThis.WORLD_CHARACTERS);
  }
  if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
    try {
      const loaded = require('./character-data.js');
      sources.push(loaded && (loaded.default || loaded.CHARACTER_EXPANSION || loaded));
    } catch (error) {
      // The browser build and legacy ten-person build do not require the
      // optional expansion file, so a missing file is a valid state.
    }
  }
  if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
    try {
      const loaded = require('./world-characters.js');
      sources.push(loaded && (loaded.default || loaded.WORLD_CHARACTERS || loaded));
    } catch (error) {
      // The world registry is optional for the classic ten-person build.
    }
  }
  const factions = [];
  const relationships = [];
  const seenFactionIds = new Set();
  const seenRelationshipIds = new Set();
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const faction of Array.isArray(source.factions) ? source.factions : []) {
      const id = faction && faction.id != null ? String(faction.id) : '';
      if (!id || seenFactionIds.has(id)) continue;
      seenFactionIds.add(id);
      factions.push(faction);
    }
    for (const relationship of Array.isArray(source.relationships) ? source.relationships : []) {
      const id = relationship && relationship.id != null ? String(relationship.id) : '';
      if (!id || seenRelationshipIds.has(id)) continue;
      seenRelationshipIds.add(id);
      relationships.push(relationship);
    }
  }
  return {
    factions,
    relationships,
  };
}

function normalizeExpandedFaction(faction) {
  if (!faction || typeof faction !== 'object' || !EXPANSION_CHARACTER_IDS.has(String(faction.id))) return null;
  const stats = {};
  for (const key of ATTRIBUTE_KEYS) {
    const value = Number(faction.stats && faction.stats[key]);
    if (!Number.isInteger(value) || value < 1 || value > 100) {
      throw new Error(`WarEngine: expanded faction ${faction.id}.${key} must be an integer from 1 to 100`);
    }
    stats[key] = value;
  }
  return {
    id: String(faction.id),
    name: faction.name == null ? String(faction.id) : String(faction.name),
    era: faction.era == null ? '跨时代' : String(faction.era),
    style: faction.style == null ? '自定其势' : String(faction.style),
    role: faction.role == null ? '统帅' : String(faction.role),
    description: faction.description == null ? '扩展人物，参与本局娱乐推演。' : String(faction.description),
    color: faction.color == null ? '#887c67' : String(faction.color),
    ...(faction.portrait == null ? {} : { portrait: String(faction.portrait) }),
    ...(faction.eraNote == null ? {} : { eraNote: String(faction.eraNote) }),
    ...(faction.portraitNote == null ? {} : { portraitNote: String(faction.portraitNote) }),
    ...(faction.relationshipNote == null ? {} : { relationshipNote: String(faction.relationshipNote) }),
    ...(faction.region == null ? {} : { region: String(faction.region) }),
    ...(faction.cultureKey == null ? {} : { cultureKey: String(faction.cultureKey) }),
    stats,
    initialRegion: null,
  };
}

const ENGINE_CHARACTER_EXPANSION = readCharacterExpansion();
const EXPANSION_CHARACTER_IDS = new Set([
  ...EXTRA_CHARACTER_IDS,
  ...ENGINE_CHARACTER_EXPANSION.factions.map((faction) => String(faction && faction.id || '')),
]);
const EXTRA_FACTIONS = ENGINE_CHARACTER_EXPANSION.factions
  .map(normalizeExpandedFaction)
  .filter(Boolean)
  .filter((faction, index, values) => values.findIndex((candidate) => candidate.id === faction.id) === index
    && !BASE_FACTIONS.some((baseFaction) => baseFaction.id === faction.id));
const FACTIONS = [...BASE_FACTIONS, ...EXTRA_FACTIONS];
const RELATIONSHIP_KEYS = (relationship) => {
  const type = String(relationship.type || '');
  const pair = type === 'alliance' || type === 'rivalry'
    ? [String(relationship.from || ''), String(relationship.to || '')].sort().join('|')
    : `${String(relationship.from || '')}>${String(relationship.to || '')}`;
  return `${pair}:${type}`;
};
const RELATIONSHIPS = [...BASE_RELATIONSHIPS, ...ENGINE_CHARACTER_EXPANSION.relationships
  .filter((relationship) => relationship && typeof relationship === 'object')
  .map((relationship) => ({
    id: String(relationship.id || `${relationship.from}-${relationship.to}-${relationship.type}`),
    from: String(relationship.from || ''),
    to: String(relationship.to || ''),
    type: String(relationship.type || 'alliance'),
    name: relationship.name == null ? '特殊关系' : String(relationship.name),
    description: relationship.description == null ? '扩展关系，影响双方的局势倾向。' : String(relationship.description),
  }))
  .filter((relationship, index, values) => values.findIndex((candidate) => candidate.id === relationship.id) === index)
  .filter((relationship, index, values) => values.findIndex((candidate) => RELATIONSHIP_KEYS(candidate) === RELATIONSHIP_KEYS(relationship)) === index)];

const FACTION_BY_ID = Object.create(null);
for (const faction of FACTIONS) FACTION_BY_ID[faction.id] = faction;
const ALL_FACTION_IDS = FACTIONS.map((faction) => faction.id);
const BASE_FACTION_IDS = BASE_FACTIONS.map((faction) => faction.id);
const FACTION_IDS = ALL_FACTION_IDS;

function participantIds(state) {
  if (Array.isArray(state && state.worldFactionIds) && state.worldFactionIds.length) {
    return state.worldFactionIds;
  }
  return Array.isArray(state && state.participantIds) && state.participantIds.length
    ? state.participantIds
    : BASE_FACTION_IDS;
}

function selectedFactionIds(state) {
  if (Array.isArray(state && state.selectedFactionIds) && state.selectedFactionIds.length) {
    return state.selectedFactionIds;
  }
  if (state && state.options && Array.isArray(state.options.factionIds)
    && state.options.factionIds.length) {
    return state.options.factionIds;
  }
  return participantIds(state);
}

function participantIndex(state, id) {
  return participantIds(state).indexOf(id);
}

function relationshipBetween(from, to) {
  for (const relationship of RELATIONSHIPS) {
    if (relationship.from === from && relationship.to === to) return relationship;
    if ((relationship.type === 'alliance' || relationship.type === 'rivalry')
      && relationship.from === to && relationship.to === from) return relationship;
  }
  return null;
}

function hostilityRelationship(from, to) {
  const direct = relationshipBetween(from, to);
  if (direct) return direct;
  // Gratitude and old-lord ties are stored in historical direction, but their
  // pre-surrender military restraint applies to both sides.  They still remain
  // directed relationships for allegiance checks.
  return RELATIONSHIPS.find((relationship) => ['gratitude', 'allegiance'].includes(relationship.type)
    && relationship.from === to && relationship.to === from) || null;
}

function relationshipValue(from, to) {
  const relationship = hostilityRelationship(from, to);
  if (!relationship) return 0;
  return {
    allegiance: -0.28,
    alliance: -0.34,
    gratitude: -0.16,
    rivalry: 0.34,
  }[relationship.type] || 0;
}

function canonicalStats(id) {
  const faction = FACTION_BY_ID[id];
  if (!faction) return null;
  return faction.stats;
}

function lordDistance(state, subjectId, lordId) {
  if (!state || !state.factions || !FACTION_BY_ID[subjectId] || !FACTION_BY_ID[lordId]) return Infinity;
  let current = subjectId;
  const seen = new Set();
  let distance = 0;
  while (current && !seen.has(current)) {
    if (current === lordId) return distance;
    seen.add(current);
    const faction = state.factions[current];
    current = faction && faction.lordId ? faction.lordId : null;
    distance += 1;
  }
  return Infinity;
}

// Team bonuses are calculated from the permanent roster at read time.  A
// surrendered general therefore remains useful to their new lord without
// mutating either character's fixed stat block.  Nested retainers contribute
// less, and every dimension has an explicit cap.
function effectiveStats(state, id) {
  const base = canonicalStats(id);
  if (!base) throw new Error(`WarEngine: unknown faction ${id}`);
  const result = Object.fromEntries(ATTRIBUTE_KEYS.map((key) => [key, base[key]]));
  if (!state || !state.factions) return result;
  for (const subjectId of participantIds(state)) {
    if (subjectId === id) continue;
    const distance = lordDistance(state, subjectId, id);
    if (!Number.isFinite(distance)) continue;
    const subjectStats = canonicalStats(subjectId);
    const weight = distance === 1 ? 0.18 : distance === 2 ? 0.11 : 0.07;
    for (const key of ATTRIBUTE_KEYS) {
      result[key] += subjectStats[key] * weight;
    }
  }
  for (const key of ATTRIBUTE_KEYS) {
    result[key] = clamp(Math.round(result[key]), 1, 125);
  }
  return result;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Math.max(0, Math.round(value));
}

function hashString(value) {
  const text = String(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  hash += hash << 13;
  hash ^= hash >>> 7;
  hash += hash << 3;
  hash ^= hash >>> 17;
  hash += hash << 5;
  return hash >>> 0;
}

class SeededRandom {
  constructor(value) {
    const numeric = Number(value) >>> 0;
    this.state = numeric || 0x9e3779b9;
  }

  next() {
    let x = this.state >>> 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 0x100000000;
  }

  int(min, max) {
    if (max <= min) return min;
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick(values) {
    return values[this.int(0, values.length - 1)];
  }

  shuffle(values) {
    const copy = values.slice();
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const other = this.int(0, index);
      const swap = copy[index];
      copy[index] = copy[other];
      copy[other] = swap;
    }
    return copy;
  }
}

function addInitialOwner(assignments, regionId, owner, regionCount, source) {
  if (owner == null || owner === '') return;
  const numericRegionId = Number(regionId);
  if (!Number.isInteger(numericRegionId) || numericRegionId < 0 || numericRegionId >= regionCount) {
    throw new Error(`WarEngine: ${source || 'initialOwners'} references invalid region ${regionId}`);
  }
  const factionId = String(owner);
  if (!FACTION_BY_ID[factionId]) {
    throw new Error(`WarEngine: initial owner ${factionId} is not in the character pool`);
  }
  if (assignments[numericRegionId] && assignments[numericRegionId] !== factionId) {
    throw new Error(`WarEngine: conflicting initial owners for region ${numericRegionId}`);
  }
  assignments[numericRegionId] = factionId;
}

function normalizeInitialOwners(map, regions) {
  const assignments = Object.create(null);
  const ownerSlots = map && map.ownerSlots;
  const resolveOwner = (owner) => {
    if (owner == null || owner === '') return owner;
    if (owner && typeof owner === 'object') {
      owner = owner.factionId ?? owner.ownerId ?? owner.owner ?? owner.faction
        ?? owner.characterId ?? owner.ownerSlot ?? owner.id;
      if (owner == null || owner === '') return owner;
    }
    const candidate = String(owner);
    if (FACTION_BY_ID[candidate]) return candidate;
    let slot = null;
    let recognizedSlot = false;
    if (Array.isArray(ownerSlots)) {
      slot = /^\d+$/.test(candidate) ? ownerSlots[Number(candidate)] : null;
      if (slot == null) {
        slot = ownerSlots.find((entry) => entry && typeof entry === 'object'
          && String(entry.slot ?? entry.key ?? entry.id ?? '') === candidate);
      }
      recognizedSlot = slot != null;
    } else if (ownerSlots && typeof ownerSlots === 'object') {
      slot = ownerSlots[candidate];
      recognizedSlot = Object.prototype.hasOwnProperty.call(ownerSlots, candidate);
    }
    if (slot && typeof slot === 'object') {
      slot = slot.factionId ?? slot.owner ?? slot.faction ?? slot.characterId ?? slot.id ?? null;
    }
    // A geography-only owner slot (for example world-china or a foreign
    // region waiting for its historical NPC) is a placement label, not a
    // faction.  Leave those regions open for deterministic world seeding;
    // direct unknown faction IDs still fail loudly below.
    if (recognizedSlot && (slot == null || slot === candidate)) return null;
    return slot == null ? owner : slot;
  };
  const assign = (regionId, owner, source) => addInitialOwner(
    assignments, regionId, resolveOwner(owner), regions.length, source,
  );
  const raw = map && map.initialOwners;
  if (Array.isArray(raw)) {
    const objectEntries = raw.length > 0 && raw.every((entry) => entry && typeof entry === 'object');
    if (objectEntries) {
      for (const entry of raw) {
        const regionId = entry.regionId ?? entry.region ?? entry.id;
        const owner = entry.factionId ?? entry.ownerId ?? entry.owner ?? entry.faction
          ?? entry.characterId ?? entry.ownerSlot;
        assign(regionId, owner, 'initialOwners');
      }
    } else if (raw.length === regions.length) {
      raw.forEach((owner, regionId) => assign(regionId, owner, 'initialOwners'));
    } else if (raw.length > 0) {
      throw new Error('WarEngine: initialOwners array must match region count or contain assignment objects');
    }
  } else if (raw && typeof raw === 'object') {
    for (const [regionId, owner] of Object.entries(raw)) {
      assign(regionId, owner, 'initialOwners');
    }
  }
  regions.forEach((region) => {
    const fixedOwner = region.initialOwner ?? region.fixedOwner ?? region.ownerSlot;
    assign(region.id, fixedOwner, 'region.initialOwner');
  });
  return assignments;
}

function normalizeMap(map) {
  if (!map || typeof map !== 'object' || !Array.isArray(map.regions)) {
    throw new Error('WarEngine: map.regions must be an array');
  }
  if (map.regions.length < 3) {
    throw new Error('WarEngine: map needs at least 3 regions');
  }
  if (!Number.isFinite(Number(map.width)) || !Number.isFinite(Number(map.height))) {
    throw new Error('WarEngine: map.width and map.height must be finite numbers');
  }

  const regions = map.regions.map((region, index) => {
    if (!region || Number(region.id) !== index) {
      throw new Error(`WarEngine: region ids must be continuous from 0 (bad id at ${index})`);
    }
    const neighbors = Array.isArray(region.neighbors) ? region.neighbors.map(Number) : [];
    if (neighbors.some((neighbor) => !Number.isInteger(neighbor) || neighbor < 0 || neighbor >= map.regions.length)) {
      throw new Error(`WarEngine: invalid neighbor in region ${index}`);
    }
    if (neighbors.includes(index)) {
      throw new Error(`WarEngine: region ${index} cannot neighbor itself`);
    }
    const terrain = region.terrain || 'plain';
    if (!Object.prototype.hasOwnProperty.call(TERRAIN_BONUS, terrain)) {
      throw new Error(`WarEngine: unsupported terrain ${terrain} in region ${index}`);
    }
    const fertility = Number(region.fertility);
    if (!Number.isFinite(fertility) || fertility < 0.8 || fertility > 1.3) {
      throw new Error(`WarEngine: fertility for region ${index} must be between 0.8 and 1.3`);
    }
    return {
      id: index,
      name: region.name == null ? `区域${index + 1}` : String(region.name),
      x: Number.isFinite(Number(region.x)) ? Number(region.x) : 0,
      y: Number.isFinite(Number(region.y)) ? Number(region.y) : 0,
      neighbors: Array.from(new Set(neighbors)),
      terrain,
      fertility,
      zone: region.zone == null
        ? (region.worldZone == null
          ? (region.group == null
            ? (region.area == null ? null : String(region.area))
            : String(region.group))
          : String(region.worldZone))
        : String(region.zone),
      initialOwner: region.initialOwner == null
        ? (region.fixedOwner == null ? null : String(region.fixedOwner))
        : String(region.initialOwner),
      ownerSlot: region.ownerSlot == null ? null : String(region.ownerSlot),
    };
  });
  const links = [];
  const linkKeys = new Set();
  const rawLinks = [
    ...(Array.isArray(map.links) ? map.links : []),
    ...(Array.isArray(map.seaLinks)
      ? map.seaLinks.map((link) => ({ ...link, kind: 'sea' }))
      : []),
  ];
  for (const [index, rawLink] of rawLinks.entries()) {
    if (!rawLink || typeof rawLink !== 'object') {
      throw new Error(`WarEngine: map.links[${index}] must be an object`);
    }
    const a = Number(rawLink.a ?? rawLink.from ?? rawLink.source);
    const b = Number(rawLink.b ?? rawLink.to ?? rawLink.target);
    if (!Number.isInteger(a) || !Number.isInteger(b)
      || a < 0 || b < 0 || a >= regions.length || b >= regions.length || a === b) {
      throw new Error(`WarEngine: map.links[${index}] has invalid endpoints`);
    }
    const kind = rawLink.kind == null ? 'sea' : String(rawLink.kind);
    const key = `${Math.min(a, b)}-${Math.max(a, b)}:${kind}`;
    if (linkKeys.has(key)) continue;
    linkKeys.add(key);
    links.push({
      a,
      b,
      kind,
      label: rawLink.label == null ? (kind === 'sea' ? '海路' : '连接线') : String(rawLink.label),
    });
  }
  const adjacency = regions.map((region) => region.neighbors.slice());
  for (const link of links) {
    if (!adjacency[link.a].includes(link.b)) adjacency[link.a].push(link.b);
    if (!adjacency[link.b].includes(link.a)) adjacency[link.b].push(link.a);
  }
  const initialOwners = normalizeInitialOwners(map, regions);
  const suppliedDomesticIds = Array.isArray(map.domesticRegionIds)
    ? map.domesticRegionIds.map(Number)
    : null;
  if (suppliedDomesticIds && suppliedDomesticIds.some((id) => !Number.isInteger(id)
    || id < 0 || id >= regions.length)) {
    throw new Error('WarEngine: domesticRegionIds contains an invalid region');
  }
  const domesticRegionIds = suppliedDomesticIds
    ? Array.from(new Set(suppliedDomesticIds))
    : regions.filter((region) => ['china', 'china-border', 'domestic'].includes(region.zone))
      .map((region) => region.id);
  const worldMode = map.worldMode === true;
  const ownerSlotValues = map && map.ownerSlots;
  const resolveRequiredFaction = (value) => {
    const candidate = String(value);
    if (FACTION_BY_ID[candidate]) return candidate;
    let slot = Array.isArray(ownerSlotValues)
      ? (/^\d+$/.test(candidate) ? ownerSlotValues[Number(candidate)] : null)
      : ownerSlotValues && typeof ownerSlotValues === 'object' ? ownerSlotValues[candidate] : null;
    const recognizedSlot = slot != null || (ownerSlotValues && typeof ownerSlotValues === 'object'
      && Object.prototype.hasOwnProperty.call(ownerSlotValues, candidate));
    if (slot == null && Array.isArray(ownerSlotValues)) {
      slot = ownerSlotValues.find((entry) => entry && typeof entry === 'object'
        && String(entry.slot ?? entry.key ?? entry.id ?? '') === candidate);
    }
    const slotFound = recognizedSlot || slot != null;
    if (slot && typeof slot === 'object') {
      slot = slot.factionId ?? slot.owner ?? slot.faction ?? slot.characterId ?? slot.id ?? null;
    }
    if (slotFound && (slot == null || slot === candidate)) return null;
    return String(slot == null ? value : slot);
  };
  const requiredFactionIds = Array.isArray(map.requiredFactionIds)
    ? map.requiredFactionIds.map(resolveRequiredFaction).filter(Boolean)
    : [];
  for (const factionId of requiredFactionIds) {
    if (!FACTION_BY_ID[factionId]) {
      throw new Error(`WarEngine: required faction ${factionId} is not in the character pool`);
    }
  }
  const foreignRegionIds = new Set(regions
    .filter((region) => FOREIGN_ZONES.has(region.zone)
      || Boolean(region.ownerSlot && String(region.ownerSlot).startsWith('foreign-')))
    .map((region) => region.id));
  const foreignFactionIds = Array.from(new Set([
    ...Object.entries(initialOwners)
      .filter(([regionId]) => foreignRegionIds.has(Number(regionId)))
      .map(([, factionId]) => factionId),
    ...requiredFactionIds.filter((factionId) => FACTION_BY_ID[factionId]
      && FACTION_BY_ID[factionId].region != null),
  ]));
  const sites = Array.isArray(map.expeditionSites) ? map.expeditionSites : [];
  const expeditionSites = sites.map((site, index) => {
    if (!site || site.id == null) throw new Error(`WarEngine: expedition site ${index} needs an id`);
    const distance = Number(site.distance);
    const difficulty = Number(site.difficulty);
    if (!Number.isFinite(distance) || distance < 1 || distance > 12) {
      throw new Error(`WarEngine: expedition site ${site.id} distance must be 1-12`);
    }
    if (!Number.isFinite(difficulty) || difficulty < 1 || difficulty > 100) {
      throw new Error(`WarEngine: expedition site ${site.id} difficulty must be 1-100`);
    }
    const rewards = {};
    for (const key of ['grain', 'troops', 'morale', 'development', 'fort']) {
      if (site.rewards && site.rewards[key] != null) {
        const value = Number(site.rewards[key]);
        if (!Number.isFinite(value)) throw new Error(`WarEngine: expedition site ${site.id} reward ${key} is invalid`);
        rewards[key] = value;
      }
    }
    return {
      id: String(site.id),
      name: site.name == null ? `远征地${index + 1}` : String(site.name),
      kind: site.kind == null ? '地方势力' : String(site.kind),
      description: site.description == null ? '远方势力，出征不会直接改变主地图归属。' : String(site.description),
      distance: Math.round(distance),
      difficulty: Math.round(difficulty),
      rewards,
      cooldownMonths: site.cooldownMonths == null ? 12 : clamp(Math.round(Number(site.cooldownMonths)), 1, 60),
    };
  });
  if (new Set(expeditionSites.map((site) => site.id)).size !== expeditionSites.length) {
    throw new Error('WarEngine: expedition site ids must be unique');
  }
  return {
    regions,
    adjacency,
    links,
    width: Number(map.width),
    height: Number(map.height),
    expeditionSites,
    worldMode,
    initialOwners,
    requiredFactionIds: Array.from(new Set(requiredFactionIds)),
    domesticRegionIds,
    foreignFactionIds,
  };
}

function ensureStateRegion(state, id) {
  const region = state.regions[id];
  if (!region || region.id !== id) throw new Error(`WarEngine: missing state region ${id}`);
  return region;
}

function graphDistances(context, start) {
  const distances = Array(context.regions.length).fill(Infinity);
  distances[start] = 0;
  const queue = [start];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    for (const neighbor of context.adjacency[current]) {
      if (distances[neighbor] === Infinity) {
        distances[neighbor] = distances[current] + 1;
        queue.push(neighbor);
      }
    }
  }
  return distances;
}

function linkBetween(context, from, to) {
  if (!context || !Array.isArray(context.links)) return null;
  return context.links.find((link) => (link.a === from && link.b === to)
    || (link.a === to && link.b === from)) || null;
}

function isDomesticRegion(context, regionId) {
  if (!context || !context.regions || !context.regions[regionId]) return false;
  if (Array.isArray(context.domesticRegionIds)
    && context.domesticRegionIds.includes(regionId)) return true;
  return DOMESTIC_ZONES.has(context.regions[regionId].zone);
}

function isForeignRegion(context, regionId) {
  if (!context || !context.regions || !context.regions[regionId]) return false;
  const region = context.regions[regionId];
  return FOREIGN_ZONES.has(region.zone)
    || Boolean(region.ownerSlot && String(region.ownerSlot).startsWith('foreign-'));
}

function isForeignFaction(context, factionId) {
  if (!context || context.worldMode !== true) return false;
  if (Array.isArray(context.foreignFactionIds)
    && context.foreignFactionIds.includes(factionId)) return true;
  const faction = FACTION_BY_ID[factionId];
  return Boolean(faction && faction.region != null);
}

function isChineseFaction(context, factionId) {
  return Boolean(FACTION_BY_ID[factionId]) && !isForeignFaction(context, factionId);
}

function stateIsForeignFaction(state, factionId) {
  if (!state || state.worldMode !== true) return false;
  if (Array.isArray(state.foreignFactionIds)
    && state.foreignFactionIds.includes(factionId)) return true;
  const faction = FACTION_BY_ID[factionId];
  return Boolean(faction && faction.region != null);
}

function campaignPhase(state) {
  return state && ['domestic', 'truce', 'world'].includes(state.campaignPhase)
    ? state.campaignPhase : 'domestic';
}

function combatRouteAllowed(state, context, factionId, source, target) {
  const phase = campaignPhase(state);
  if (phase === 'truce') return false;
  if (!context.worldMode) return phase !== 'truce';
  if (phase === 'domestic') {
    return isChineseFaction(context, factionId)
      && isDomesticRegion(context, source.id)
      && isDomesticRegion(context, target.id)
      && (!target.owner || isChineseFaction(context, target.owner));
  }
  // In the world phase Chinese factions may project power overseas and
  // foreign factions may resist or counterattack.  Neither side is allowed
  // to turn the world chapter into a second civil war: Chinese actors target
  // foreign owners, while foreign actors target Chinese owners.  The route
  // itself must still be a real land neighbour or explicit sea link because
  // callers only reach this helper through context.adjacency.
  const actorIsForeign = stateIsForeignFaction(state, factionId);
  const targetIsForeign = target.owner ? stateIsForeignFaction(state, target.owner) : false;
  if (actorIsForeign) {
    return isForeignRegion(context, target.id) && Boolean(target.owner) && !targetIsForeign;
  }
  return isForeignRegion(context, target.id) && (!target.owner || targetIsForeign);
}

function chooseOpenSeeds(context, seed, random, count, candidates) {
  if (!count) return [];
  const order = candidates.map((id) => ({
    id,
    tie: hashString(`${seed}|world-start|${id}`),
  })).sort((left, right) => left.tie - right.tie);
  const selected = [];
  while (selected.length < count) {
    let best = null;
    for (const candidate of order) {
      if (selected.includes(candidate.id)) continue;
      const minDistance = selected.length
        ? Math.min(...selected.map((start) => graphDistances(context, start)[candidate.id]))
        : 0;
      const distanceScore = Number.isFinite(minDistance) ? minDistance * 1000000 : 500000000;
      const score = distanceScore + (candidate.tie % 1000000);
      if (!best || score > best.score) best = { id: candidate.id, score };
    }
    if (!best) break;
    selected.push(best.id);
  }
  return random.shuffle(selected);
}

function buildWorldOwners(
  context,
  seed,
  random,
  worldFactionIds,
  selectedIds = worldFactionIds,
  requiredIds = context.requiredFactionIds || [],
) {
  const owners = Array(context.regions.length).fill(null);
  for (const [regionId, factionId] of Object.entries(context.initialOwners || {})) {
    owners[Number(regionId)] = factionId;
  }
  const selected = Array.from(new Set(selectedIds.filter((id) => worldFactionIds.includes(id))));
  const required = Array.from(new Set(requiredIds.filter((id) => worldFactionIds.includes(id))));
  const isDomesticRegion = (regionId) => {
    if ((context.domesticRegionIds || []).includes(regionId)) return true;
    const zone = context.regions[regionId] && context.regions[regionId].zone;
    return ['china', 'china-border', 'domestic'].includes(zone);
  };
  const isForeignRegion = (regionId) => {
    const region = context.regions[regionId];
    const zone = region && region.zone;
    return ['overseas', 'foreign', 'world-overseas'].includes(zone)
      || Boolean(region && region.ownerSlot && String(region.ownerSlot).startsWith('foreign-'));
  };
  const openRegions = (predicate) => owners
    .map((owner, regionId) => owner == null && (!predicate || predicate(regionId)) ? regionId : null)
    .filter((regionId) => regionId != null);
  const assignSeeds = (factionIds, candidates, label) => {
    if (!factionIds.length) return;
    if (candidates.length < factionIds.length) {
      throw new Error(`WarEngine: world map needs ${factionIds.length} unclaimed ${label} regions for the selected factions`);
    }
    const starts = chooseOpenSeeds(context, seed, random, factionIds.length, candidates);
    random.shuffle(factionIds).forEach((factionId, index) => {
      owners[starts[index]] = factionId;
    });
  };
  const missingSelected = selected.filter((factionId) => !owners.includes(factionId));
  assignSeeds(missingSelected, openRegions(isDomesticRegion), 'domestic');

  // Overseas/foreign regions must remain with an explicitly bound overseas
  // owner or with a required non-classic representative.  This prevents an
  // unbound foreign slot from silently becoming Chinese merely because the
  // global graph fallback happened to choose a nearby domestic seed.
  const foreignRequired = required.filter((factionId) => !BASE_FACTION_IDS.includes(factionId));
  const missingForeignRequired = foreignRequired.filter((factionId) => !owners.includes(factionId));
  assignSeeds(missingForeignRequired, openRegions(isForeignRegion), 'foreign');

  const domesticRequired = required.filter((factionId) => !foreignRequired.includes(factionId))
    .filter((factionId) => !owners.includes(factionId));
  assignSeeds(domesticRequired, openRegions(isDomesticRegion), 'domestic');

  const ownerDistances = Object.create(null);
  for (const factionId of worldFactionIds) {
    const regions = owners.reduce((list, owner, regionId) => {
      if (owner === factionId) list.push(regionId);
      return list;
    }, []);
    if (!regions.length) continue;
    const distances = Array(context.regions.length).fill(Infinity);
    for (const regionId of regions) {
      const fromRegion = graphDistances(context, regionId);
      for (let id = 0; id < distances.length; id += 1) {
        if (fromRegion[id] < distances[id]) distances[id] = fromRegion[id];
      }
    }
    ownerDistances[factionId] = distances;
  }
  for (let regionId = 0; regionId < owners.length; regionId += 1) {
    if (owners[regionId]) continue;
    const foreign = isForeignRegion(regionId);
    const zoneOwners = worldFactionIds.filter((factionId) => owners.some((owner, ownerRegionId) => {
      return owner === factionId && (foreign ? isForeignRegion(ownerRegionId) : isDomesticRegion(ownerRegionId));
    }));
    if (foreign && !zoneOwners.length) {
      throw new Error(`WarEngine: foreign region ${regionId} has no bound foreign faction`);
    }
    const candidates = zoneOwners.length ? zoneOwners : worldFactionIds;
    let best = null;
    for (const factionId of candidates) {
      const distance = ownerDistances[factionId] && ownerDistances[factionId][regionId];
      if (!Number.isFinite(distance)) continue;
      const score = distance * 1000000 + (hashString(`${seed}|world-owner|${regionId}|${factionId}`) % 1000000);
      if (!best || score < best.score) best = { factionId, score };
    }
    if (!best) {
      const fallbackIndex = hashString(`${seed}|world-fallback|${regionId}`) % candidates.length;
      best = { factionId: candidates[fallbackIndex], score: 0 };
    }
    owners[regionId] = best.factionId;
  }
  return owners;
}

function chooseStartRegions(context, seed, random, count = BASE_FACTION_IDS.length) {
  if (!Number.isInteger(count) || count < 1 || count > context.regions.length) {
    throw new Error(`WarEngine: map needs at least ${count} regions for this roster`);
  }
  const firstOrder = context.regions
    .map((region) => ({
      id: region.id,
      tie: hashString(`${seed}|start|${region.id}`),
    }))
    .sort((left, right) => left.tie - right.tie);
  const selected = [firstOrder[0].id];
  while (selected.length < count) {
    let best = null;
    for (const candidate of firstOrder) {
      if (selected.includes(candidate.id)) continue;
      const distances = selected.map((start) => graphDistances(context, start)[candidate.id]);
      const minDistance = Math.min(...distances);
      const score = minDistance * 1000000 + (candidate.tie % 1000000);
      if (!best || score > best.score) best = { id: candidate.id, score };
    }
    selected.push(best.id);
  }
  return random.shuffle(selected);
}

function createFactionState(faction, random, aggressive = false) {
  return {
    id: faction.id,
    name: faction.name,
    era: faction.era,
    style: faction.style,
    role: faction.role,
    description: faction.description,
    color: faction.color,
    stats: { ...faction.stats },
    grain: 405 + faction.stats.development * 0.34 + random.int(0, 44),
    economy: 1,
    morale: 1,
    fatigue: 0,
    territories: 0,
    troops: 0,
    victories: 0,
    alive: true,
    aggressive: Boolean(aggressive),
    // The global month may already be deep in attrition when a player opens
    // an invasion.  Keep the local war clock so mobilization and weariness
    // measure active war time rather than quietly charging through peace.
    aggressionSince: aggressive ? 0 : null,
    lordId: null,
    initialRegion: null,
  };
}

function normalizeGameOptions(options, context = null) {
  const input = options && typeof options === 'object' ? options : {};
  const factionIds = input.factionIds == null
    ? BASE_FACTION_IDS.slice()
    : Array.isArray(input.factionIds) ? input.factionIds.map(String) : null;
  if (!factionIds || factionIds.length < 3 || factionIds.length > 12) {
    throw new Error('WarEngine: factionIds must select 3-12 characters');
  }
  if (new Set(factionIds).size !== factionIds.length) {
    throw new Error('WarEngine: factionIds must be unique');
  }
  for (const factionId of factionIds) {
    if (!FACTION_BY_ID[factionId]) throw new Error(`WarEngine: unknown selected faction ${factionId}`);
  }
  const requiredFromMap = context && context.worldMode ? context.requiredFactionIds : [];
  const requiredFromOptions = context && context.worldMode && Array.isArray(input.requiredFactionIds)
    ? input.requiredFactionIds.map(String)
    : [];
  const initialOwnerIds = context && context.worldMode
    ? Object.values(context.initialOwners || {}) : [];
  const requiredFactionIds = Array.from(new Set([
    ...requiredFromMap,
    ...requiredFromOptions,
    ...initialOwnerIds,
  ])).filter((factionId) => !factionIds.includes(factionId));
  for (const factionId of requiredFactionIds) {
    if (!FACTION_BY_ID[factionId]) throw new Error(`WarEngine: required faction ${factionId} is not in the character pool`);
  }
  const worldFactionIds = Array.from(new Set([...factionIds, ...requiredFactionIds]));
  // Classic regional maps retain their automatic campaign.  World maps use
  // the same default for their selected Chinese roster, while fixed foreign
  // representatives are filtered out when faction state is created.
  const autoWar = input.autoWar == null ? true : input.autoWar === true;
  return {
    factionIds,
    requiredFactionIds,
    worldFactionIds,
    coalitions: input.coalitions !== false,
    expeditions: input.expeditions !== false,
    autoWar,
  };
}

function createGame(map, seed, options = {}) {
  const context = normalizeMap(map);
  const gameOptions = normalizeGameOptions(options, context);
  const normalizedSeed = String(seed == null ? 'default' : seed);
  const random = new SeededRandom(hashString(normalizedSeed));
  const worldMode = context.worldMode === true;
  const worldFactionIds = gameOptions.worldFactionIds.slice();
  const ownerByRegion = worldMode
    ? buildWorldOwners(context, normalizedSeed, random, worldFactionIds,
      gameOptions.factionIds, gameOptions.requiredFactionIds)
    : (() => {
      const starts = chooseStartRegions(context, normalizedSeed, random, gameOptions.factionIds.length);
      const factionOrder = random.shuffle(gameOptions.factionIds);
      const owners = Array(context.regions.length).fill(null);
      starts.forEach((regionId, index) => { owners[regionId] = factionOrder[index]; });
      return owners;
    })();
  const factions = Object.create(null);
  for (const factionId of worldFactionIds) {
    const startsAggressive = worldMode
      ? gameOptions.autoWar && !isForeignFaction(context, factionId)
      : gameOptions.autoWar;
    factions[factionId] = createFactionState(FACTION_BY_ID[factionId], random, startsAggressive);
  }
  const regions = context.regions.map((region) => {
    const owner = ownerByRegion[region.id] || null;
    if (owner) {
      const faction = FACTION_BY_ID[owner];
      if (factions[owner].initialRegion == null) factions[owner].initialRegion = region.id;
      return {
        id: region.id,
        owner,
        troops: 108 + Math.round(faction.stats.command * 0.22) + random.int(0, 15),
        development: 7 + Math.round(faction.stats.development / 32),
        fort: 20 + Math.round(faction.stats.defense / 7) + random.int(0, 6),
      };
    }
    return {
      id: region.id,
      owner: null,
      troops: 25 + random.int(0, 16),
      development: 1 + random.int(0, 3),
      fort: 7 + random.int(0, 12),
    };
  });

  const state = {
    seed: normalizedSeed,
    participantIds: worldFactionIds.slice(),
    selectedFactionIds: gameOptions.factionIds.slice(),
    requiredFactionIds: gameOptions.requiredFactionIds.slice(),
    worldFactionIds: worldFactionIds.slice(),
    worldMode,
    campaignPhase: 'domestic',
    domesticWinner: null,
    worldCompleted: false,
    victoryType: null,
    winningFactionIds: [],
    foreignFactionIds: context.foreignFactionIds.slice(),
    initialOwners: Object.fromEntries(ownerByRegion.map((owner, regionId) => [regionId, owner])),
    links: context.links.map((link) => ({ ...link })),
    options: {
      ...gameOptions,
      factionIds: gameOptions.factionIds.slice(),
      requiredFactionIds: gameOptions.requiredFactionIds.slice(),
      worldMode,
    },
    month: 0,
    phase: 'development',
    regions,
    factions,
    events: [],
    lastEvents: [],
    winner: null,
    finished: false,
    rngState: random.state >>> 0,
    eventCounter: 0,
    tacticCooldowns: Object.create(null),
    allegianceCooldowns: Object.create(null),
    monthlyTacticCaptures: 0,
    monthlyAllegiances: 0,
    coalitions: [],
    coalitionCooldowns: Object.create(null),
    coalitionEventMonths: Object.create(null),
    expeditions: [],
    expeditionCooldowns: Object.create(null),
    expeditionSites: context.expeditionSites.map((site) => ({ ...site, rewards: { ...site.rewards } })),
  };
  updateFactionSnapshots(state);
  assertInvariants(state, map);
  return state;
}

function phaseForMonth(month) {
  if (month <= 12) return 'development';
  if (month <= 84) return 'war';
  if (month <= 360) return 'attrition';
  return 'decisive';
}

function phaseLabel(phase) {
  return {
    development: '休养生息',
    war: '群雄交锋',
    attrition: '长战消耗',
    decisive: '决胜之势',
    victory: '一统天下',
  }[phase] || phase;
}

function appendEvent(state, events, type, text, fields) {
  const event = {
    id: `${state.seed}:${state.eventCounter}`,
    month: state.month,
    type,
    text,
    ...(fields || {}),
  };
  state.eventCounter += 1;
  state.events.push(event);
  events.push(event);
  return event;
}

function ownedRegions(state, factionId) {
  return state.regions.filter((region) => region.owner === factionId);
}

function updateFactionSnapshots(state) {
  for (const factionId of participantIds(state)) {
    const faction = state.factions[factionId];
    if (!faction) continue;
    const owned = ownedRegions(state, factionId);
    faction.territories = owned.length;
    faction.troops = owned.reduce((sum, region) => sum + region.troops, 0);
    // A surrendered faction stays out of the independent roster even though
    // its fixed character stats continue to feed the receiving lord's team.
    if (faction.lordId) {
      faction.alive = false;
    } else if (owned.length === 0) {
      faction.alive = false;
    } else {
      faction.alive = true;
    }
    if (!faction.alive) {
      faction.aggressive = false;
      faction.aggressionSince = null;
    }
  }
}

function sortRegionsForDevelopment(regions, context) {
  return regions.slice().sort((left, right) => {
    const leftValue = left.development + context.regions[left.id].fertility * 2;
    const rightValue = right.development + context.regions[right.id].fertility * 2;
    return leftValue - rightValue || left.id - right.id;
  });
}

function monthlyEconomy(state, context, events) {
  for (const factionId of participantIds(state)) {
    const faction = state.factions[factionId];
    if (!faction || !faction.alive) continue;
    const stats = effectiveStats(state, factionId);
    const owned = ownedRegions(state, factionId);
    const income = owned.reduce((sum, region) => {
      const mapRegion = context.regions[region.id];
      return sum + (6.2 + mapRegion.fertility * 3.4 + region.development * 0.68) * (1 + stats.development / 700);
    }, 0) * faction.economy;
    const maintenance = faction.troops * (0.11 + faction.fatigue * 0.0004);
    faction.grain = clamp(faction.grain + income - maintenance, 0, 1100);

    if (faction.grain < Math.max(28, faction.troops * 0.045)) {
      const shortage = clamp((faction.troops * 0.045 - faction.grain) / Math.max(1, faction.troops * 0.045), 0, 1);
      const lossRate = 0.008 + shortage * 0.022;
      for (const region of owned) region.troops = Math.max(8, region.troops - round(region.troops * lossRate));
      faction.morale = clamp(faction.morale - 0.018 - shortage * 0.03, 0.45, 1.2);
      faction.fatigue = clamp(faction.fatigue + 1.8, 0, 100);
      if (state.month % 8 === 0) {
        appendEvent(state, events, 'system', `${faction.name}粮秣吃紧，军队开始消耗战备。`, {
          actor: factionId,
          success: false,
          details: `缺粮比例=${shortage.toFixed(2)}`,
        });
      }
    } else {
      faction.morale = clamp(faction.morale + 0.006, 0.45, 1.2);
      faction.fatigue = Math.max(0, faction.fatigue - 0.55);
    }
  }
}

function developAndRecruit(state, context, random, events) {
  const developmentChance = state.phase === 'development' ? 0.92 : state.phase === 'war' ? 0.56 : state.phase === 'attrition' ? 0.34 : 0.22;
  for (const factionId of participantIds(state)) {
    const faction = state.factions[factionId];
    if (!faction || !faction.alive) continue;
    const stats = effectiveStats(state, factionId);
    const owned = ownedRegions(state, factionId);
    if (!owned.length) continue;
    const targets = sortRegionsForDevelopment(owned, context);
    const target = targets[0];
    const developmentCost = 8 + target.development * 0.9;
    if (target.development < 22 && faction.grain >= developmentCost && random.next() < developmentChance) {
      faction.grain -= developmentCost;
      target.development += 1;
      target.fort = Math.min(60, target.fort + 0.55 + stats.defense / 300);
      faction.economy = clamp(faction.economy + 0.004 + stats.development / 25000, 0.8, 1.32);
      faction.morale = clamp(faction.morale + stats.charisma / 50000, 0.45, 1.2);
      appendEvent(state, events, 'develop', `${faction.name}在${context.regions[target.id].name}整备屯田与城防。`, {
        actor: factionId,
        to: target.id,
        success: true,
        details: `发展度=${target.development}`,
      });
    }

    const recruitmentTarget = owned.slice().sort((left, right) => left.troops - right.troops || left.id - right.id)[0];
    const desired = 8 + Math.floor(stats.command / 34) + (state.phase === 'war' ? 2 : 1);
    const recruitCost = desired * (0.9 - stats.development / 2600);
    if (faction.grain >= recruitCost && recruitmentTarget.troops < 150) {
      faction.grain -= recruitCost;
      recruitmentTarget.troops += desired;
      faction.morale = clamp(faction.morale + 0.002, 0.45, 1.2);
    }
  }
}

function targetPower(state, context, target, attackerId) {
  const mapRegion = context.regions[target.id];
  const terrain = TERRAIN_BONUS[mapRegion.terrain];
  const defender = target.owner ? state.factions[target.owner] : null;
  const defenderStats = defender ? effectiveStats(state, target.owner) : null;
  const defenseStat = defenderStats ? defenderStats.defense : 44;
  const strategyStat = defenderStats ? defenderStats.strategy : 36;
  const intelligenceStat = defenderStats ? defenderStats.intelligence : 42;
  const supply = defender ? clamp(0.8 + defender.grain / 1000, 0.72, 1.16) : 0.86;
  const fatigue = defender ? clamp(1 - defender.fatigue / 300, 0.68, 1) : 0.92;
  const morale = defender ? defender.morale : 0.92;
  const territoryMomentum = defender && state.phase === 'decisive'
    ? 1 + defender.territories * 0.012
    : 1;
  return target.troops
    * (1 + defenseStat / 350 + strategyStat / 800 + intelligenceStat / 1200 + target.fort / 150 + target.development / 250)
    * terrain.defend
    * supply
    * fatigue
    * morale
    * territoryMomentum
    * (attackerId && target.owner === attackerId ? 0 : 1);
}

function garrisonFor(state, source) {
  // Long wars keep a smaller reserve so a quiet border can eventually move
  // again after repeated attrition; the reserve still scales with the fort.
  if (state.phase === 'decisive') return Math.max(8, 8 + Math.round(source.fort * 0.08));
  if (state.phase === 'attrition') return Math.max(10, 10 + Math.round(source.fort * 0.1));
  return Math.max(14, 12 + Math.round(source.fort * 0.14));
}

function activeWarMonths(state, factionId) {
  const faction = state && state.factions ? state.factions[factionId] : null;
  if (!faction || faction.aggressive !== true) return 0;
  const started = Number(faction.aggressionSince);
  if (!Number.isFinite(started)) return 0;
  return Math.max(0, (Number(state.month) || 0) - started);
}

function attackPower(state, context, source, target, faction, random) {
  // The army is marching into the target region.  A mountain or river
  // therefore penalizes the attack as well as strengthening the defender.
  const mapRegion = context.regions[target.id];
  const terrain = TERRAIN_BONUS[mapRegion.terrain];
  const stats = effectiveStats(state, faction.id);
  const garrison = garrisonFor(state, source);
  const marchShare = state.phase === 'decisive' ? 0.8 : 0.68;
  const committed = Math.min(Math.floor(source.troops * marchShare), source.troops - garrison);
  const supply = clamp(0.78 + faction.grain / 1200, 0.72, 1.14);
  const morale = clamp(faction.morale - faction.fatigue / 260, 0.5, 1.16);
  const weather = random ? 0.9 + random.next() * 0.2 : 1;
  const territoryMomentum = state.phase === 'decisive'
    ? 1 + faction.territories * 0.024
    : 1;
  return {
    committed,
    garrison,
    power: committed
      * (1 + stats.strength / 360 + stats.command / 300 + stats.strategy / 660 + stats.intelligence / 1800 + source.development / 220)
      * terrain.attack
      * supply
      * morale
      * territoryMomentum
      * weather,
  };
}

function reinforceFront(state, context, factionId, source) {
  const faction = state.factions[factionId];
  if (!faction || !source || source.owner !== factionId || faction.aggressive !== true) return 0;
  const stats = effectiveStats(state, factionId);
  const aggressionSince = Number(faction.aggressionSince);
  // A late activation follows a long peaceful build-up.  Its first fronts
  // are often only one garrison deep even though the faction has a large
  // interior.  Muster from that interior before asking the front to attack;
  // the transfer is bounded and still leaves a terrain-scaled garrison.
  const lateActivation = Number.isFinite(aggressionSince) && aggressionSince >= 60;
  if (state.phase !== 'decisive' && !lateActivation) return 0;
  const desired = lateActivation
    ? clamp(Math.round(42 + stats.command / 2.2), 64, 100)
    : clamp(Math.round(16 + stats.command / 3.5), 28, 48);
  const frontTarget = lateActivation
    ? clamp(Math.round(150 + stats.command * 0.9), 180, 260)
    : null;
  let moved = 0;
  const distances = graphDistances(context, source.id);
  const reserves = ownedRegions(state, factionId)
    .filter((region) => region.id !== source.id)
    .sort((left, right) => distances[right.id] - distances[left.id]
      || right.troops - left.troops || left.id - right.id);
  for (const reserve of reserves) {
    if (moved >= desired) break;
    const reserveKeep = garrisonFor(state, reserve);
    const available = Math.max(0, Math.floor(reserve.troops - reserveKeep));
    const needed = lateActivation
      ? Math.max(0, frontTarget - source.troops - moved)
      : desired - moved;
    const transfer = Math.min(needed, desired - moved, available);
    if (transfer <= 0) continue;
    reserve.troops -= transfer;
    source.troops += transfer;
    moved += transfer;
  }
  return moved;
}

function attackOptions(state, context, factionId) {
  const faction = state.factions[factionId];
  // The product opens every map in diplomacy mode.  An independent faction
  // can still develop and defend while peaceful, but it must opt into
  // aggression before it can create a military action.
  if (!faction || !faction.alive || faction.lordId || faction.aggressive !== true) return [];
  const factionStats = effectiveStats(state, factionId);
  const options = [];
  for (const source of ownedRegions(state, factionId)) {
    const sourcePower = source.troops - garrisonFor(state, source);
    // In the decisive phase a commander may pull reserves from the interior
    // before marching, so even a thin exposed garrison remains an eligible
    // front.  Earlier phases keep the stronger reserve gate.
    if (sourcePower < (state.phase === 'decisive' ? 4 : 16)) continue;
    for (const targetId of context.adjacency[source.id]) {
      const target = ensureStateRegion(state, targetId);
      if (target.owner === factionId) continue;
      if (!combatRouteAllowed(state, context, factionId, source, target)) continue;
      const targetFaction = target.owner ? state.factions[target.owner] : null;
      const estimatedAttack = attackPower(state, context, source, target, faction).power;
      const estimatedDefense = targetPower(state, context, target, factionId);
      const relative = estimatedAttack / Math.max(1, estimatedDefense);
      const neutralBonus = target.owner == null ? (state.phase === 'development' ? 34 : 12) : 0;
      const weakEnemyBonus = targetFaction && targetFaction.territories <= 2 ? 12 : 0;
      const valuableBonus = context.regions[target.id].fertility * 9 + target.development * 1.6;
      const pressure = targetFaction && targetFaction.alive ? (faction.troops - targetFaction.troops) / Math.max(20, targetFaction.troops) * 11 : 0;
      const defensePenalty = target.fort * 0.45 + (context.regions[target.id].terrain === 'mountain' ? 12 : 0);
      const relationship = targetFaction ? hostilityRelationship(factionId, targetFaction.id) : null;
      const relationPressure = targetFaction ? relationshipValue(factionId, targetFaction.id) * 42 : 0;
      const commandPressure = factionStats.command / 18 + factionStats.strategy / 28;
      const coalition = targetFaction ? coalitionAgainst(state, factionId, targetFaction.id) : null;
      if (targetFaction && coalitionPartner(state, factionId, targetFaction.id)) continue;
      const coalitionPressure = coalition ? 36 + factionStats.strategy / 8 : 0;
      options.push({
        sourceId: source.id,
        targetId,
        score: relative * 28 + neutralBonus + weakEnemyBonus + valuableBonus + pressure
          + relationPressure + commandPressure + coalitionPressure - defensePenalty,
        relationship,
      });
    }
  }
  return options.sort((left, right) => right.score - left.score || left.sourceId - right.sourceId || left.targetId - right.targetId);
}

function activeCoalitions(state) {
  return Array.isArray(state && state.coalitions)
    ? state.coalitions.filter((coalition) => coalition && coalition.active !== false
      && (!coalition.status || coalition.status === 'active'))
    : [];
}

function coalitionAgainst(state, memberId, targetId) {
  return activeCoalitions(state).find((coalition) => coalition.target === targetId
    && coalition.members.includes(memberId)) || null;
}

function coalitionPartner(state, leftId, rightId) {
  return activeCoalitions(state).some((coalition) => coalition.members.includes(leftId)
    && coalition.members.includes(rightId));
}

function borderPair(state, context, fromId, toId) {
  const fromRegions = ownedRegions(state, fromId);
  const toRegions = ownedRegions(state, toId);
  for (const source of fromRegions) {
    for (const target of toRegions) {
      if (context.adjacency[source.id].includes(target.id)
        || context.adjacency[target.id].includes(source.id)) {
        return { source, target };
      }
    }
  }
  return null;
}

function factionRetainers(state, factionId) {
  return participantIds(state)
    .filter((candidateId) => candidateId !== factionId && Number.isFinite(lordDistance(state, candidateId, factionId)))
    .sort((left, right) => lordDistance(state, left, factionId) - lordDistance(state, right, factionId)
      || participantIndex(state, left) - participantIndex(state, right));
}

function canAcceptAllegiance(state, context, actorId, subjectId) {
  if (actorId === subjectId || !FACTION_BY_ID[actorId] || !FACTION_BY_ID[subjectId]) return false;
  const actor = state.factions[actorId];
  const subject = state.factions[subjectId];
  if (!actor || !subject || !actor.alive || actor.lordId || !subject.alive || subject.lordId) return false;
  if (campaignPhase(state) === 'truce') return false;
  if (context.worldMode && (campaignPhase(state) !== 'domestic'
    || !isChineseFaction(context, actorId) || !isChineseFaction(context, subjectId)
    || !ownedRegions(state, actorId).some((region) => isDomesticRegion(context, region.id))
    || !ownedRegions(state, subjectId).some((region) => isDomesticRegion(context, region.id)))) {
    return false;
  }
  // Whole-faction allegiance is reserved for explicit old-lord relationship
  // entries.  Alliance and gratitude affect hostility, but do not turn a
  // character into an automatic subject.
  const relationship = relationshipBetween(subjectId, actorId);
  if (!relationship || relationship.type !== 'allegiance'
    || relationship.from !== subjectId || relationship.to !== actorId) return false;
  if (actor.territories < subject.territories) return false;
  const troopRatio = actor.troops / Math.max(1, subject.troops);
  if (troopRatio < 0.85) return false;
  const actorStats = effectiveStats(state, actorId);
  if (actorStats.charisma < 75 || actor.grain < 40) return false;
  // A subordinate cannot be handed to one of their own descendants: that
  // would create a cycle in the lord graph.
  if (Number.isFinite(lordDistance(state, actorId, subjectId))) return false;
  return Boolean(borderPair(state, context, subjectId, actorId));
}

function surrenderFaction(state, context, actorId, subjectId, events, reason) {
  if (!canAcceptAllegiance(state, context, actorId, subjectId)) return false;
  const actor = state.factions[actorId];
  const subject = state.factions[subjectId];
  const members = [subjectId, ...factionRetainers(state, subjectId)];
  let transferredTerritories = 0;
  let transferredTroops = 0;
  let transferredGrain = 0;
  for (const memberId of members) {
    const member = state.factions[memberId];
    transferredGrain += Math.max(0, Number(member.grain) || 0);
    for (const region of ownedRegions(state, memberId)) {
      transferredTerritories += 1;
      transferredTroops += Math.max(0, Number(region.troops) || 0);
      region.owner = actorId;
    }
  }
  actor.grain = Math.max(0, actor.grain + transferredGrain);
  actor.economy = clamp(actor.economy + members.length * 0.025, 0.8, 1.6);
  actor.morale = clamp(actor.morale + 0.035 + effectiveStats(state, actorId).charisma / 2500, 0.45, 1.2);
  actor.victories += 1;
  for (const memberId of members) {
    const member = state.factions[memberId];
    member.lordId = actorId;
    member.alive = false;
    member.grain = 0;
    member.troops = 0;
    member.territories = 0;
    state.allegianceCooldowns[memberId] = state.month;
  }
  state.allegianceCooldowns[actorId] = state.month;
  updateFactionSnapshots(state);
  const relationship = relationshipBetween(subjectId, actorId);
  const relationshipName = relationship ? relationship.name : '边境形势';
  appendEvent(state, events, 'allegiance', `${subject.name}向${actor.name}归顺，旧部并入麾下。`, {
    actor: actorId,
    subject: subjectId,
    success: true,
    details: `${reason}；关系=${relationshipName}；转入领地=${transferredTerritories}；兵力=${transferredTroops}；军粮=${round(transferredGrain)}`,
  });
  return true;
}

function attemptAllegiances(state, context, random, events) {
  if (state.month < 18) return;
  if (campaignPhase(state) === 'truce'
    || (context.worldMode && campaignPhase(state) !== 'domestic')) return;
  // A peaceful world may negotiate among its own actors, but this whole-faction
  // surrender is a campaign action and is only considered by an active lord.
  if (!participantIds(state).some((factionId) => {
    const faction = state.factions[factionId];
    return faction && faction.alive && !faction.lordId && faction.aggressive === true;
  })) return;
  // A single monthly diplomatic event keeps the opening legible and prevents
  // the fixed relationships from collapsing the map at startup.
  const subjects = random.shuffle(participantIds(state));
  for (const subjectId of subjects) {
    const subject = state.factions[subjectId];
    if (!subject || !subject.alive || subject.lordId) continue;
    const lastSubjectMonth = Number(state.allegianceCooldowns[subjectId]);
    if (Number.isFinite(lastSubjectMonth) && state.month - lastSubjectMonth < 6) continue;
    const candidates = [];
    for (const actorId of participantIds(state)) {
      const actor = state.factions[actorId];
      if (!actor || actor.aggressive !== true) continue;
      if (!canAcceptAllegiance(state, context, actorId, subjectId)) continue;
      const lastActorMonth = Number(state.allegianceCooldowns[actorId]);
      if (Number.isFinite(lastActorMonth) && state.month - lastActorMonth < 6) continue;
      const relationship = relationshipBetween(subjectId, actorId);
      if (!relationship || relationship.type !== 'allegiance'
        || relationship.from !== subjectId || relationship.to !== actorId) continue;
      const actorStats = effectiveStats(state, actorId);
      const subjectStats = effectiveStats(state, subjectId);
      const ratio = (actor.troops + actor.territories * 34) / Math.max(1, subject.troops + subject.territories * 34);
      const oldLordBonus = relationship && relationship.type === 'allegiance'
        && relationship.from === subjectId && relationship.to === actorId ? 0.45 : 0;
      const strengthPressure = clamp((ratio - 0.82) * 0.17, -0.08, 0.34);
      const moralePressure = clamp((0.9 - subject.morale) * 0.42 + subject.fatigue / 420, -0.02, 0.3);
      const charismaPressure = clamp((actorStats.charisma - 55) / 300, 0, 0.22);
      const stabilityPressure = clamp((actorStats.development - subjectStats.development) / 800, -0.05, 0.14);
      const chance = clamp(0.018 + oldLordBonus + strengthPressure + moralePressure
        + charismaPressure + stabilityPressure, 0.01, 0.86);
      candidates.push({ actorId, relationship, chance, ratio, actorStats, subjectStats });
    }
    candidates.sort((left, right) => right.chance - left.chance
      || right.ratio - left.ratio
      || participantIndex(state, left.actorId) - participantIndex(state, right.actorId));
    const best = candidates[0];
    if (!best) continue;
    if (random.next() >= best.chance) continue;
    const relationText = best.relationship
      ? `${best.relationship.name}关系促成归顺`
      : '边境压力与招揽促成归顺';
    const reason = `${relationText}；阵营魅力=${best.actorStats.charisma}；实力比=${best.ratio.toFixed(2)}；概率=${Math.round(best.chance * 100)}%`;
    if (surrenderFaction(state, context, best.actorId, subjectId, events, reason)) {
      state.monthlyAllegiances += 1;
      return;
    }
  }
}

function factionThreatPower(state, factionId) {
  const faction = state.factions[factionId];
  if (!faction) return 0;
  const stats = effectiveStats(state, factionId);
  return faction.troops * (1 + stats.command / 260 + stats.strategy / 520)
    + faction.territories * (42 + stats.development * 0.18);
}

function coalitionKey(members, target) {
  return `${members.slice().sort().join('|')}->${target}`;
}

function noteCoalitionCoordinate(state, coalition, actorId, from, to, events, context) {
  const key = coalition.id || coalitionKey(coalition.members, coalition.target);
  if (state.coalitionEventMonths[key] === state.month) return;
  state.coalitionEventMonths[key] = state.month;
  const actor = state.factions[actorId];
  const target = state.factions[coalition.target];
  const link = linkBetween(context, from, to);
  appendEvent(state, events, 'coalition', `${actor.name}与盟友协同进攻${target.name}。`, {
    actor: actorId,
    members: coalition.members.slice(),
    target: coalition.target,
    from,
    to,
    crossSea: Boolean(link && link.kind === 'sea'),
    ...(link ? { linkKind: link.kind, linkLabel: link.label } : {}),
    action: 'coordinate',
    success: true,
    details: `共同威胁=${target.name}；盟友互不进攻；有效期至第${coalition.expiresMonth}月`,
  });
}

function updateCoalitions(state, context, random, events) {
  if (!state.options.coalitions) return;
  if (campaignPhase(state) === 'truce'
    || (context.worldMode && campaignPhase(state) !== 'domestic')) return;
  const ids = participantIds(state);
  const active = activeCoalitions(state);
  for (const coalition of active) {
    const target = state.factions[coalition.target];
    const members = coalition.members.map((id) => state.factions[id]);
    let action = null;
    let reason = '';
    if (!target || !target.alive || members.some((member) => !member || !member.alive || member.lordId)) {
      action = 'dissolve';
      reason = '成员退出独立势力或共同威胁已退场';
    } else if (members.some((member) => member.aggressive !== true)) {
      action = 'dissolve';
      reason = '成员已停战，合纵不能绕过侵略开关';
    } else if (state.month >= coalition.expiresMonth) {
      action = 'expire';
      reason = '约定期限届满';
    } else if (target.territories <= Math.max(...members.map((member) => member.territories)) + 1
      || factionThreatPower(state, coalition.target)
        <= Math.max(...coalition.members.map((id) => factionThreatPower(state, id))) * 1.08) {
      action = 'expire';
      reason = '共同威胁已明显缓解';
    }
    if (action) {
      coalition.active = false;
      coalition.status = action === 'expire' ? 'expired' : 'dissolved';
      state.coalitionCooldowns[coalitionKey(coalition.members, coalition.target)] = state.month;
      appendEvent(state, events, 'coalition', action === 'expire'
        ? '共同威胁缓解，合纵关系到期。'
        : '合纵关系解体，盟友不再共同进军。', {
        actor: coalition.members[0],
        members: coalition.members.slice(),
        target: coalition.target,
        action,
        success: true,
        details: reason,
      });
    }
  }
  if (state.month < 13) return;
  const activeMembers = new Set(activeCoalitions(state).flatMap((coalition) => coalition.members));
  const livingIds = ids.filter((id) => state.factions[id] && state.factions[id].alive
    && !state.factions[id].lordId && state.factions[id].aggressive === true);
  const candidates = [];
  for (let leftIndex = 0; leftIndex < livingIds.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < livingIds.length; rightIndex += 1) {
      const leftId = livingIds[leftIndex];
      const rightId = livingIds[rightIndex];
      if (activeMembers.has(leftId) || activeMembers.has(rightId)) continue;
      for (const targetId of livingIds) {
        if (targetId === leftId || targetId === rightId) continue;
        if (!borderPair(state, context, leftId, targetId) || !borderPair(state, context, rightId, targetId)) continue;
        const pair = [leftId, rightId];
        const key = coalitionKey(pair, targetId);
        const last = Number(state.coalitionCooldowns[key]);
        if (Number.isFinite(last) && state.month - last < 6) continue;
        const targetThreat = factionThreatPower(state, targetId);
        const leftThreat = factionThreatPower(state, leftId);
        const rightThreat = factionThreatPower(state, rightId);
        const weaker = Math.max(leftThreat, rightThreat);
        if (targetThreat < weaker * 1.18) continue;
        const targetFaction = state.factions[targetId];
        const leftFaction = state.factions[leftId];
        const rightFaction = state.factions[rightId];
        const weakness = clamp((targetThreat - weaker) / Math.max(1, targetThreat), 0, 0.55);
        const pairNeed = clamp((targetFaction.territories - Math.max(leftFaction.territories, rightFaction.territories)) * 0.035, 0, 0.3);
        const chance = clamp(0.06 + weakness * 0.42 + pairNeed, 0.05, 0.8);
        candidates.push({ leftId, rightId, targetId, chance, targetThreat, weakness });
      }
    }
  }
  candidates.sort((left, right) => right.chance - left.chance
    || right.targetThreat - left.targetThreat
    || left.targetId.localeCompare(right.targetId));
  const best = candidates[0];
  if (!best || random.next() >= best.chance) return;
  const members = [best.leftId, best.rightId];
  const coalition = {
    id: `${state.seed}:coalition:${state.month}:${members.slice().sort().join('-')}:${best.targetId}`,
    members,
    target: best.targetId,
    formedMonth: state.month,
    expiresMonth: state.month + 12 + random.int(0, 12),
    active: true,
    status: 'active',
  };
  state.coalitions.push(coalition);
  appendEvent(state, events, 'coalition', `${state.factions[best.leftId].name}与${state.factions[best.rightId].name}合纵抗衡${state.factions[best.targetId].name}。`, {
    actor: best.leftId,
    members: members.slice(),
    target: best.targetId,
    action: 'form',
    success: true,
    details: `共同威胁=${state.factions[best.targetId].name}；双方边界相接；有效期至第${coalition.expiresMonth}月；形成概率=${Math.round(best.chance * 100)}%`,
  });
}

function expeditionSite(state, siteId) {
  const wanted = String(siteId);
  return (Array.isArray(state && state.expeditionSites) ? state.expeditionSites : [])
    .find((site) => site.id === wanted) || null;
}

function expeditionActorId(actor) {
  if (actor && typeof actor === 'object') return String(actor.id || '');
  return String(actor || '');
}

function expeditionPlan(state, actorId, site) {
  const actor = state.factions && state.factions[actorId];
  const owned = actor ? ownedRegions(state, actorId) : [];
  const origin = owned.slice().sort((left, right) => right.troops - left.troops || left.id - right.id)[0] || null;
  const duration = clamp(Math.round(site.distance), 1, 12);
  const troops = clamp(Math.round(26 + site.difficulty * 0.62 + duration * 3), 24, 120);
  const grain = Math.max(18, round(troops * (0.44 + duration * 0.14) + site.difficulty * 0.35));
  return {
    origin,
    duration,
    troops,
    grain,
    reserve: origin ? garrisonFor(state, origin) : 0,
  };
}

function expeditionCooldownKey(actorId, siteId) {
  return `${actorId}:${siteId}`;
}

function expeditionMonthlyCost(troops, site) {
  return Math.max(3, round(troops * (0.06 + site.difficulty / 1600)));
}

function canStartExpedition(state, actor, siteId) {
  if (!state || typeof state !== 'object') {
    return { allowed: false, reason: '战局状态无效。', siteId: String(siteId) };
  }
  const actorId = expeditionActorId(actor);
  const site = expeditionSite(state, siteId);
  if (!site) return { allowed: false, reason: '找不到这处远征地点。', siteId: String(siteId) };
  const plan = expeditionPlan(state, actorId, site);
  const details = {
    allowed: false,
    reason: '',
    actor: actorId,
    siteId: site.id,
    siteName: site.name,
    cost: { grain: plan.grain, troops: plan.troops },
    duration: plan.duration,
    monthlyGrain: expeditionMonthlyCost(plan.troops, site),
    estimatedTotalGrain: plan.grain + expeditionMonthlyCost(plan.troops, site) * plan.duration,
    originRegion: plan.origin ? plan.origin.id : null,
  };
  const faction = state.factions && state.factions[actorId];
  if (state.finished) {
    details.reason = '沙盘已经统一，无法再派出远征军。';
    return details;
  }
  if (!state.options || state.options.expeditions === false) {
    details.reason = '本局已关闭远征。';
    return details;
  }
  if (campaignPhase(state) === 'truce') {
    details.reason = '议和期间不能派出新的远征军。';
    return details;
  }
  if (state.worldMode && campaignPhase(state) !== 'world') {
    details.reason = '国内争霸阶段暂不开放域外远征，请先进入世界征服。';
    return details;
  }
  if (!faction || !participantIds(state).includes(actorId)) {
    details.reason = '该人物未参加本局。';
    return details;
  }
  if (faction.aggressive !== true) {
    details.reason = '请先开启侵略，和平期间不能派出远征军。';
    return details;
  }
  if (!faction.alive || faction.lordId) {
    details.reason = '只有独立且存活的势力可以出征。';
    return details;
  }
  if (!plan.origin || plan.origin.troops < plan.reserve + plan.troops) {
    details.reason = '边境兵力不足，必须保留本土守军。';
    return details;
  }
  if (faction.grain < plan.grain) {
    details.reason = '军粮不足，无法负担这次远征。';
    return details;
  }
  if (!Array.isArray(state.expeditions)) state.expeditions = [];
  if (!state.expeditionCooldowns || typeof state.expeditionCooldowns !== 'object') {
    state.expeditionCooldowns = Object.create(null);
  }
  if (state.expeditions.some((expedition) => expedition.actor === actorId && expedition.status === 'started')) {
    details.reason = '该势力已有远征军在外。';
    return details;
  }
  const last = Number(state.expeditionCooldowns[expeditionCooldownKey(actorId, site.id)]);
  if (Number.isFinite(last) && state.month < last + site.cooldownMonths) {
    details.reason = `该地点仍在冷却中，还需${last + site.cooldownMonths - state.month}个月。`;
    details.cooldownRemaining = last + site.cooldownMonths - state.month;
    return details;
  }
  details.allowed = true;
  details.reason = '可以出征。';
  return details;
}

function startExpeditionInternal(state, actor, siteId, events) {
  const check = canStartExpedition(state, actor, siteId);
  if (!check.allowed) return { ok: false, ...check };
  const actorId = check.actor;
  const faction = state.factions[actorId];
  const site = expeditionSite(state, check.siteId);
  const origin = ensureStateRegion(state, check.originRegion);
  origin.troops = Math.max(0, origin.troops - check.cost.troops);
  faction.grain = Math.max(0, faction.grain - check.cost.grain);
  const expedition = {
    actor: actorId,
    siteId: site.id,
    siteName: site.name,
    status: 'started',
    startMonth: state.month,
    returnMonth: state.month + check.duration,
    result: null,
    originRegion: origin.id,
    troopsCommitted: check.cost.troops,
    grainCommitted: check.cost.grain,
    grainSpent: check.cost.grain,
    troopLoss: 0,
    difficulty: site.difficulty,
  };
  state.expeditions.push(expedition);
  appendEvent(state, events, 'expedition', `${faction.name}向${site.name}出征，预计${check.duration}个月后回师。`, {
    actor: actorId,
    siteId: site.id,
    from: origin.id,
    to: null,
    status: 'started',
    success: null,
    grainCost: check.cost.grain,
    troopCommitment: check.cost.troops,
    duration: check.duration,
    details: `远征地=${site.name}；难度=${site.difficulty}；耗粮=${check.cost.grain}；出兵=${check.cost.troops}；主地图领土不变`,
  });
  return { ok: true, reason: '远征已出发。', expedition };
}

function startExpedition(state, actor, siteId) {
  if (!state || typeof state !== 'object') return { ok: false, reason: '战局状态无效。' };
  if (!Array.isArray(state.lastEvents)) state.lastEvents = [];
  if (!state.expeditions || !Array.isArray(state.expeditions)) state.expeditions = [];
  if (!state.expeditionCooldowns || typeof state.expeditionCooldowns !== 'object') {
    state.expeditionCooldowns = Object.create(null);
  }
  if (state.finished) return { ok: false, reason: '沙盘已经统一，无法再派出远征军。' };
  const result = startExpeditionInternal(state, actor, siteId, state.lastEvents);
  if (result.ok) updateFactionSnapshots(state);
  return result;
}

function applyCampaignPosture(state, phase) {
  const world = state.worldMode === true;
  for (const factionId of participantIds(state)) {
    const faction = state.factions[factionId];
    if (!faction) continue;
    const independent = faction.alive && !faction.lordId;
    const allowed = phase === 'truce' ? false
      : phase === 'world' ? independent
        : independent && (!world || !stateIsForeignFaction(state, factionId));
    if (allowed) {
      if (faction.aggressive !== true) faction.aggressionSince = Number.isInteger(state.month)
        ? state.month : 0;
      faction.aggressive = true;
    } else {
      faction.aggressive = false;
      faction.aggressionSince = null;
    }
  }
  if (phase !== 'domestic' && Array.isArray(state.coalitions)) {
    for (const coalition of state.coalitions) {
      if (!coalition || coalition.active === false) continue;
      coalition.active = false;
      coalition.status = 'dissolved';
      if (!state.coalitionCooldowns || typeof state.coalitionCooldowns !== 'object') {
        state.coalitionCooldowns = Object.create(null);
      }
      state.coalitionCooldowns[coalitionKey(coalition.members, coalition.target)] = Number.isInteger(state.month)
        ? state.month : 0;
    }
  }
}

function setCampaignPhase(state, nextPhase) {
  if (!state || typeof state !== 'object') return { ok: false, reason: '战局状态无效。' };
  const phase = String(nextPhase == null ? '' : nextPhase);
  if (!['domestic', 'truce', 'world'].includes(phase)) {
    return { ok: false, reason: '未知的战局阶段。' };
  }
  if (state.finished) return { ok: false, reason: '沙盘已经统一，不能再改变战局阶段。' };
  const current = campaignPhase(state);
  if (phase === current) {
    return { ok: true, phase, reason: '战局阶段未改变。' };
  }
  if (phase === 'world' && state.worldMode !== true) {
    return { ok: false, reason: '当前地图没有域外战区。' };
  }
  if (state.worldMode === true && phase === 'world' && current !== 'truce') {
    return { ok: false, reason: '须先天下息兵，方可开启域外收服。' };
  }
  if (state.worldMode === true && phase === 'domestic' && current === 'world') {
    return { ok: false, reason: '域外征服进行中，请先天下息兵。' };
  }
  state.campaignPhase = phase;
  applyCampaignPosture(state, phase);
  if (!Array.isArray(state.events)) state.events = [];
  if (!Array.isArray(state.lastEvents)) state.lastEvents = [];
  if (!Number.isInteger(state.eventCounter) || state.eventCounter < 0) state.eventCounter = state.events.length;
  const textByPhase = {
    domestic: '再启烽烟，诸侯重整旗鼓，逐鹿之争再起。',
    truce: '诸侯会盟，各守其土，天下息兵。',
    world: '海内稍定，普天之下莫非王土，域外收服开始。',
  };
  appendEvent(state, state.lastEvents, 'phase', textByPhase[phase], {
    phase,
    success: true,
    details: textByPhase[phase],
  });
  return {
    ok: true,
    phase,
    reason: textByPhase[phase],
  };
}

/**
 * Toggle a living independent faction's war posture.
 *
 * The flag remains as a compatibility hook for callers that pause one lord.
 * World campaigns use campaignPhase for the public posture, while this hook
 * can still pause an individual actor without disturbing replay determinism
 * for the rest of the state.  Turning a member peaceful also dissolves its
 * active coalitions; an alliance is never allowed to smuggle a military action
 * past this switch.
 */
function setAggression(state, actorId, enabled) {
  if (!state || typeof state !== 'object' || !state.factions) {
    return { ok: false, reason: '战局状态无效。' };
  }
  const id = String(actorId == null ? '' : actorId);
  const faction = state.factions[id];
  if (!faction || !participantIds(state).includes(id)) {
    return { ok: false, reason: '该人物未参加本局。', actor: id };
  }
  const next = Boolean(enabled);
  if (next && state.finished) {
    return { ok: false, reason: '沙盘已经统一，无法开启新的侵略。', actor: id };
  }
  if (next && (!faction.alive || faction.lordId)) {
    return { ok: false, reason: '只有存活且独立的势力可以开启侵略。', actor: id };
  }
  if (next && faction.aggressive !== true) faction.aggressionSince = Number.isInteger(state.month)
    ? state.month : 0;
  if (!next) faction.aggressionSince = null;
  faction.aggressive = next;
  if (!next && Array.isArray(state.coalitions)) {
    for (const coalition of state.coalitions) {
      if (!coalition || coalition.active === false || !coalition.members.includes(id)) continue;
      coalition.active = false;
      coalition.status = 'dissolved';
      if (!state.coalitionCooldowns || typeof state.coalitionCooldowns !== 'object') {
        state.coalitionCooldowns = Object.create(null);
      }
      state.coalitionCooldowns[coalitionKey(coalition.members, coalition.target)] = Number.isInteger(state.month)
        ? state.month : 0;
      if (!Array.isArray(state.events)) state.events = [];
      if (!Array.isArray(state.lastEvents)) state.lastEvents = [];
      if (!Number.isInteger(state.eventCounter) || state.eventCounter < 0) state.eventCounter = state.events.length;
      const target = state.factions[coalition.target];
      appendEvent(state, state.lastEvents, 'coalition', '成员停战，合纵关系解体。', {
        actor: id,
        members: coalition.members.slice(),
        target: coalition.target,
        action: 'dissolve',
        success: true,
        details: `${faction.name}关闭侵略，盟约不能绕过和平开关${target ? `；共同目标=${target.name}` : ''}`,
      });
    }
  }
  return {
    ok: true,
    actor: id,
    aggressive: next,
    reason: next ? '已开启侵略，可主动征战与派出远征军。' : '已停战，不再主动征战、用计或派出新的远征军。',
  };
}

function finishExpedition(state, context, expedition, site, random, events) {
  const faction = state.factions[expedition.actor];
  if (!faction || !faction.alive || faction.lordId) {
    expedition.status = 'cancelled';
    expedition.result = {
      success: false,
      grainCost: round(expedition.grainSpent),
      troopLoss: expedition.troopsCommitted,
      reward: {},
      details: '主将已退出独立势力，远征军无法回到原阵营。',
    };
    expedition.result.text = expedition.result.details;
    state.expeditionCooldowns[expeditionCooldownKey(expedition.actor, site.id)] = state.month;
    appendEvent(state, events, 'expedition', `${expedition.siteName}远征中止，军队未能回师。`, {
      actor: expedition.actor,
      siteId: site.id,
      from: expedition.originRegion,
      to: null,
      status: 'cancelled',
      success: false,
      grainCost: round(expedition.grainSpent),
      troopLoss: expedition.troopsCommitted,
      details: expedition.result.details,
    });
    return;
  }
  const stats = effectiveStats(state, expedition.actor);
  const supplyRatio = clamp(faction.grain / Math.max(1, expedition.troopsCommitted * 0.25), 0, 1);
  const chance = clamp(0.2 + stats.strength / 360 + stats.strategy / 300 + stats.command / 500
    + stats.intelligence / 700 - site.difficulty / 145 + supplyRatio * 0.08, 0.08, 0.9);
  const success = random.next() < chance;
  const lossRate = success
    ? clamp(0.12 + site.difficulty / 700 - stats.defense / 1500, 0.08, 0.34)
    : clamp(0.36 + site.difficulty / 420 - stats.defense / 1200, 0.28, 0.82);
  const troopLoss = Math.min(expedition.troopsCommitted, Math.max(1, round(expedition.troopsCommitted * lossRate)));
  const survivors = Math.max(0, expedition.troopsCommitted - troopLoss);
  const reward = success ? { ...site.rewards } : {};
  const destination = ownedRegions(state, expedition.actor).slice()
    .sort((left, right) => left.id - right.id)[0];
  if (destination && survivors > 0) destination.troops += survivors;
  let rewardGrain = 0;
  if (success && reward.grain) {
    rewardGrain = Math.max(0, round(reward.grain));
    faction.grain += rewardGrain;
  }
  if (success && reward.troops && destination) destination.troops += Math.max(0, round(reward.troops));
  if (success && reward.morale) faction.morale = clamp(faction.morale + Number(reward.morale), 0.45, 1.2);
  if (success && reward.development && destination) destination.development += Math.max(0, Number(reward.development));
  if (success && reward.fort && destination) destination.fort += Math.max(0, Number(reward.fort));
  faction.fatigue = clamp(faction.fatigue + (success ? 3.4 : 7.8), 0, 100);
  if (success) faction.victories += 1;
  expedition.status = success ? 'victory' : 'defeat';
  expedition.troopLoss = troopLoss;
  expedition.result = {
    success,
    grainCost: round(expedition.grainSpent),
    troopLoss,
    survivors,
    reward,
    details: `成功概率=${Math.round(chance * 100)}%；远征难度=${site.difficulty}；耗粮=${round(expedition.grainSpent)}；伤亡=${troopLoss}；${success ? `取得${site.name}的远征奖励。` : '远征失利，残军退回本土。'}`,
  };
  expedition.result.text = expedition.result.details;
  state.expeditionCooldowns[expeditionCooldownKey(expedition.actor, site.id)] = state.month;
  appendEvent(state, events, 'expedition', success
    ? `${faction.name}远征${site.name}得胜，残军回到本土。`
    : `${faction.name}远征${site.name}失利，残军退回本土。`, {
    actor: expedition.actor,
    siteId: site.id,
    from: expedition.originRegion,
    to: null,
    status: expedition.status,
    success,
    grainCost: round(expedition.grainSpent),
    troopLoss,
    reward,
    duration: expedition.returnMonth - expedition.startMonth,
    details: expedition.result.details,
  });
}

function advanceExpeditions(state, context, random, events) {
  if (!Array.isArray(state.expeditions) || !state.expeditions.length) return;
  for (const expedition of state.expeditions) {
    if (!expedition || expedition.status !== 'started') continue;
    const faction = state.factions[expedition.actor];
    const site = expeditionSite(state, expedition.siteId);
    if (!site) {
      expedition.status = 'cancelled';
      expedition.result = { success: false, grainCost: round(expedition.grainSpent), troopLoss: expedition.troopsCommitted, reward: {}, details: '远征地点资料已失效。' };
      expedition.result.text = expedition.result.details;
      continue;
    }
    const monthlyCost = expeditionMonthlyCost(expedition.troopsCommitted, site);
    const availableGrain = faction ? Math.max(0, Number(faction.grain) || 0) : 0;
    const paidGrain = faction ? Math.min(availableGrain, monthlyCost) : 0;
    const affordable = faction && availableGrain >= monthlyCost;
    if (faction) {
      faction.grain = Math.max(0, availableGrain - paidGrain);
      expedition.grainSpent += paidGrain;
      if (!affordable) faction.morale = clamp(faction.morale - 0.025, 0.45, 1.2);
    }
    if (state.month >= expedition.returnMonth) finishExpedition(state, context, expedition, site, random, events);
  }
}

function runExpeditionAI(state, context, random, events) {
  if (!state.options.expeditions || state.month < 12 || !state.expeditionSites.length) return;
  if (campaignPhase(state) === 'truce'
    || (state.worldMode && campaignPhase(state) !== 'world')) return;
  const ids = random.shuffle(participantIds(state));
  for (const actorId of ids) {
    const faction = state.factions[actorId];
    if (!faction || !faction.alive || faction.lordId || faction.aggressive !== true) continue;
    const stats = effectiveStats(state, actorId);
    const initiative = clamp(0.02 + stats.strategy / 1800 + stats.command / 2600, 0.02, 0.18);
    if (random.next() >= initiative) continue;
    const available = state.expeditionSites
      .slice()
      .sort((left, right) => left.difficulty - right.difficulty || left.id.localeCompare(right.id));
    for (const site of available) {
      const check = canStartExpedition(state, actorId, site.id);
      if (!check.allowed) continue;
      startExpeditionInternal(state, actorId, site.id, events);
      return;
    }
  }
}

// Late in a long war, a single exposed border garrison can still lay down
// arms.  This is deliberately a one-region capture, separate from the
// whole-faction allegiance path above, so ordinary battles never silently
// absorb an entire roster.
function shouldSurrender(state, context, source, target, faction, targetFaction, random) {
  if (state.month < 115 || !targetFaction || !targetFaction.alive
    || targetFaction.lordId || (faction.fatigue > 96 && faction.grain < 40)) return false;
  if (state.phase === 'decisive'
    && faction.territories + 1 < targetFaction.territories
    && targetFaction.morale > 0.6) return false;
  const territoryLimit = state.phase === 'decisive' ? 50 : 8;
  if (targetFaction.territories > territoryLimit) return false;
  const attackerStats = effectiveStats(state, faction.id);
  const defenderStats = effectiveStats(state, targetFaction.id);
  const sourcePower = source.troops
    * (1 + attackerStats.strength / 330 + attackerStats.command / 220 + attackerStats.strategy / 500)
    * (1 + faction.territories * (state.phase === 'decisive' ? 0.012 : 0.006));
  const defensePower = target.troops
    * (1 + defenderStats.defense / 230 + defenderStats.intelligence / 1200 + target.fort / 100)
    * (1 + targetFaction.territories * (state.phase === 'decisive' ? 0.012 : 0.004));
  const minimumRatio = state.phase === 'decisive' ? 0.88 : 2.25;
  const ratio = sourcePower / Math.max(1, defensePower);
  if (ratio < minimumRatio) return false;
  const strengthPressure = clamp((ratio - minimumRatio) * 0.2, 0, 0.34);
  const moralePressure = clamp((0.86 - targetFaction.morale) * 0.75, 0, 0.3);
  const territorialPressure = clamp((faction.territories - targetFaction.territories - 1) * 0.055, 0, 0.48);
  const collapsePressure = state.phase === 'decisive'
    ? clamp((faction.territories - targetFaction.territories) * 0.08, 0, 0.55)
    : 0;
  const strategyPressure = attackerStats.strategy / 1000;
  const chance = clamp(0.08 + strengthPressure + moralePressure + territorialPressure + collapsePressure + strategyPressure, 0, 0.94);
  return random.next() < chance;
}

function tryTactic(state, context, source, target, factionId, random, events) {
  const defenderId = target.owner;
  const faction = state.factions[factionId];
  const defender = defenderId ? state.factions[defenderId] : null;
  if (!defender || !defender.alive || !faction || !faction.alive || faction.aggressive !== true) return null;
  if (!combatRouteAllowed(state, context, factionId, source, target)) return null;
  const lastMonth = Number(state.tacticCooldowns[factionId]);
  if (Number.isFinite(lastMonth) && state.month - lastMonth < 6) return null;
  const actorStats = effectiveStats(state, factionId);
  const defenderStats = effectiveStats(state, defenderId);
  const strategicEdge = actorStats.strategy - defenderStats.intelligence;
  const chance = clamp(0.14 + strategicEdge * 0.008 + actorStats.intelligence * 0.0012, 0.08, 0.9);
  const cost = Math.max(10, round(14 + actorStats.strategy * 0.055));
  if (faction.grain < cost) return null;
  const link = linkBetween(context, source.id, target.id);
  const routeFields = {
    crossSea: Boolean(link && link.kind === 'sea'),
    ...(link ? { linkKind: link.kind, linkLabel: link.label } : {}),
  };
  faction.grain = Math.max(0, faction.grain - cost);
  state.tacticCooldowns[factionId] = state.month;
  const success = random.next() < chance;
  if (success) {
    const reduction = clamp(0.16 + strategicEdge * 0.0045 + actorStats.strategy * 0.0007, 0.16, 0.48);
    appendEvent(state, events, 'tactic', `${faction.name}在${context.regions[target.id].name}施展谋略，守军阵脚动摇。`, {
      actor: factionId,
      defender: defenderId,
      from: source.id,
      to: target.id,
      ...routeFields,
      success: true,
      details: `成功概率=${Math.round(chance * 100)}%；阵营谋略=${actorStats.strategy}；守方阵营智力=${defenderStats.intelligence}；耗粮=${cost}；效果=守方有效防御-${Math.round(reduction * 100)}%`,
    });
    return { success: true, defenseMultiplier: 1 - reduction };
  }
  appendEvent(state, events, 'tactic', `${faction.name}试图在${context.regions[target.id].name}设伏，但被识破。`, {
    actor: factionId,
    defender: defenderId,
    from: source.id,
    to: target.id,
    ...routeFields,
    success: false,
    detected: true,
    details: `成功概率=${Math.round(chance * 100)}%；阵营谋略=${actorStats.strategy}；守方阵营智力=${defenderStats.intelligence}；耗粮=${cost}；效果=被识破，守方防御不变`,
  });
  return { success: false, defenseMultiplier: 1 };
}

function executeAttack(state, context, source, target, factionId, random, events, tacticResult = null) {
  const faction = state.factions[factionId];
  if (!combatRouteAllowed(state, context, factionId, source, target)) return false;
  const targetFactionId = target.owner;
  const targetFaction = targetFactionId ? state.factions[targetFactionId] : null;
  const link = linkBetween(context, source.id, target.id);
  const routeFields = {
    crossSea: Boolean(link && link.kind === 'sea'),
    ...(link ? { linkKind: link.kind, linkLabel: link.label } : {}),
  };

  if (shouldSurrender(state, context, source, target, faction, targetFaction, random)) {
    const oldOwner = target.owner;
    target.owner = factionId;
    target.troops = Math.max(9, round(target.troops * 0.36));
    faction.grain = Math.max(0, faction.grain - 12);
    faction.fatigue = clamp(faction.fatigue + 1.2, 0, 100);
    faction.victories += 1;
    appendEvent(state, events, 'capture', `${context.regions[target.id].name}在相邻劝降后转入${faction.name}。`, {
      from: source.id,
      to: target.id,
      actor: factionId,
      ...routeFields,
      success: true,
      details: `边地劝降；原归属=${FACTION_BY_ID[oldOwner] ? FACTION_BY_ID[oldOwner].name : '中立'}；整势力仍保持独立`,
    });
    return true;
  }

  const power = attackPower(state, context, source, target, faction, random);
  if (power.committed < (state.phase === 'decisive' ? 12 : 16)) return false;
  const globalAdvantage = targetFaction
    ? factionThreatPower(state, factionId) / Math.max(1, factionThreatPower(state, targetFactionId))
    : Infinity;
  // A very long decisive phase represents the point at which a materially
  // stronger side can finally turn repeated sieges into a breakthrough.  It
  // lowers the effective wall gradually and still requires a real adjacent
  // attack, so it cannot teleport territory or bypass the battle system.
  const decisivePressure = state.phase === 'decisive'
    ? globalAdvantage >= 1.25 ? 0.76 : globalAdvantage <= 0.8 ? 1.06 : 0.94
    : 1;
  const defenderPower = targetPower(state, context, target, factionId)
    * decisivePressure
    * (tacticResult && tacticResult.success ? tacticResult.defenseMultiplier : 1);
  const defenderWeather = 0.91 + random.next() * 0.18;
  const effectiveDefenderPower = defenderPower * defenderWeather;
  const advantage = power.power / Math.max(1, effectiveDefenderPower);
  const territoryGap = targetFaction ? targetFaction.territories - faction.territories : 0;
  const lateThreshold = targetFaction
    ? clamp(0.8 + territoryGap * 0.1, 0.8, 5.5)
    : 0.58;
  const decisiveThreshold = state.phase === 'decisive'
    ? clamp(lateThreshold - Math.max(0, state.month - 360) * 0.0022, 0.48, 1.45)
    : null;
  const decisiveBreakthrough = state.phase === 'decisive' && state.month >= 390
    && targetFaction
    && faction.territories >= targetFaction.territories
    && globalAdvantage >= 0.88
    && advantage >= 0.34;
  const territoryLead = targetFaction ? faction.territories - targetFaction.territories : 0;
  const decisiveCollapse = state.phase === 'decisive' && state.month >= 450
    && targetFaction
    && territoryLead >= 4
    && globalAdvantage >= 1.1
    && advantage >= (territoryLead >= 8 && globalAdvantage >= 1.35 ? 0.18 : 0.26);
  const neutralBreakthrough = state.phase === 'decisive' && state.month >= 390
    && !targetFaction && advantage >= 0.45;
  const won = advantage >= (state.phase === 'decisive' ? decisiveThreshold : state.phase === 'attrition' ? 0.86 : 0.94)
    || decisiveBreakthrough || decisiveCollapse || neutralBreakthrough;
  const attackerShare = power.power / Math.max(1, power.power + effectiveDefenderPower);
  const attackerLosses = Math.max(2, round(power.committed * (won ? 0.095 + (1 - attackerShare) * 0.24 : 0.12 + attackerShare * 0.2)));
  const defenderLosses = Math.max(1, round(target.troops * (won ? 0.46 + attackerShare * 0.28 : 0.055 + attackerShare * 0.1)));
  source.troops = Math.max(power.garrison, source.troops - power.committed);
  faction.grain = Math.max(0, faction.grain - 7 - power.committed * 0.045);
  faction.fatigue = clamp(faction.fatigue + (won ? 3.3 : 5.1), 0, 100);

  if (won) {
    const oldOwner = target.owner;
    const survivors = Math.max(8, power.committed - attackerLosses);
    target.owner = factionId;
    target.troops = Math.max(12, round(survivors * 0.43 + Math.max(0, target.troops - defenderLosses)));
    target.fort = Math.max(3, target.fort - 2.4);
    faction.victories += 1;
    if (targetFaction) {
      targetFaction.fatigue = clamp(targetFaction.fatigue + 5.4, 0, 100);
      targetFaction.morale = clamp(targetFaction.morale - 0.045, 0.45, 1.2);
    }
    appendEvent(state, events, 'battle', `${faction.name}攻入${context.regions[target.id].name}并击退守军。`, {
      from: source.id,
      to: target.id,
      actor: factionId,
      ...routeFields,
      success: true,
      details: `进攻方伤亡=${attackerLosses}；守方伤亡=${defenderLosses}；力量比=${advantage.toFixed(2)}`,
    });
    appendEvent(state, events, 'capture', `${faction.name}占领${context.regions[target.id].name}。`, {
      from: source.id,
      to: target.id,
      actor: factionId,
      ...routeFields,
      success: true,
      details: `原归属=${oldOwner && FACTION_BY_ID[oldOwner] ? FACTION_BY_ID[oldOwner].name : '中立'}；占领后兵力=${target.troops}`,
    });
    return true;
  }

  const retreat = round(Math.max(0, power.committed - attackerLosses) * 0.22);
  source.troops = Math.max(power.garrison, source.troops + retreat);
  target.troops = Math.max(8, target.troops - defenderLosses);
  if (state.phase === 'decisive') target.fort = Math.max(0, target.fort - 1.15);
  if (targetFaction) targetFaction.fatigue = clamp(targetFaction.fatigue + 1.1, 0, 100);
  faction.morale = clamp(faction.morale - 0.018, 0.45, 1.2);
  appendEvent(state, events, 'battle', `${faction.name}进攻${context.regions[target.id].name}受挫，战线暂稳。`, {
      from: source.id,
      to: target.id,
      actor: factionId,
      ...routeFields,
      success: false,
    details: `进攻方伤亡=${attackerLosses}；守方伤亡=${defenderLosses}；力量比=${advantage.toFixed(2)}`,
  });
  return false;
}

function runCampaign(state, context, random, events) {
  if (state.month < 13) return;
  const actionOrder = random.shuffle(participantIds(state));
  // Once the decisive phase has lasted long enough, the campaign commits to
  // the strongest surviving independent power's main front.  Other armies
  // have already had the whole war to contest the map; concentrating the
  // final pressure prevents three depleted borders from endlessly trading
  // the same low-garrison region while every move remains an adjacent battle.
  const endgameLeader = state.month >= 420
    ? actionOrder
      .filter((id) => state.factions[id] && state.factions[id].alive && !state.factions[id].lordId)
      .filter((id) => state.factions[id].aggressive === true)
      .sort((left, right) => {
        const leftFaction = state.factions[left];
        const rightFaction = state.factions[right];
        return rightFaction.territories - leftFaction.territories
          || factionThreatPower(state, right) - factionThreatPower(state, left)
          || participantIndex(state, left) - participantIndex(state, right);
      })[0] || null
    : null;
  for (const factionId of actionOrder) {
    if (endgameLeader && factionId !== endgameLeader) continue;
    const faction = state.factions[factionId];
    if (!faction || !faction.alive) continue;
    const options = attackOptions(state, context, factionId);
    if (!options.length) continue;
    const best = options[0];
    const source = ensureStateRegion(state, best.sourceId);
    const target = ensureStateRegion(state, best.targetId);
    if (source.owner !== factionId || target.owner === factionId) continue;
    const threshold = state.phase === 'war' ? 0.28 : state.phase === 'attrition' ? 0.18 : 0.1;
    const campaignStats = effectiveStats(state, factionId);
    const initiative = clamp(0.16 + campaignStats.command / 600 + campaignStats.strategy / 900
      + campaignStats.charisma / 2400 - faction.fatigue / 400, 0.08, 0.92);
    if (state.month < 25 && target.owner && random.next() > threshold + initiative) continue;
    if (state.phase === 'attrition' && faction.grain < 18 && random.next() > 0.28) continue;
    reinforceFront(state, context, factionId, source);
    // A faction that waited through a long peace has mature forts on both
    // sides of the border.  Do not burn a tiny sortie merely because a
    // garrison is technically eligible: after the bounded muster above, let
    // the front regroup until its force can make a credible attack.  The
    // threshold relaxes with active war months, so this is a local invasion
    // clock rather than a permanent immunity or a forced capture.
    const aggressionSince = Number(faction.aggressionSince);
    const lateActivation = Number.isFinite(aggressionSince) && aggressionSince >= 60;
    if (lateActivation && target.owner) {
      const preparedAttack = attackPower(state, context, source, target, faction, null).power;
      const preparedDefense = targetPower(state, context, target, factionId);
      const minimumRatio = activeWarMonths(state, factionId) < 18 ? 0.5 : 0.4;
      if (preparedAttack / Math.max(1, preparedDefense) < minimumRatio) {
        faction.fatigue = Math.max(0, faction.fatigue - 1.4);
        faction.morale = clamp(faction.morale + 0.003, 0.45, 1.2);
        continue;
      }
    }
    if (target.owner) {
      const coalition = coalitionAgainst(state, factionId, target.owner);
      if (coalition) noteCoalitionCoordinate(state, coalition, factionId, source.id, target.id, events, context);
    }
    const tacticResult = target.owner ? tryTactic(state, context, source, target, factionId, random, events) : null;
    const captured = executeAttack(state, context, source, target, factionId, random, events, tacticResult);

    // A successful tactic can open one immediate adjacent follow-up push.  It
    // is a single extra map capture for the whole month, and the new captured
    // region itself must be the marching source for that push.
    if (captured && tacticResult && tacticResult.success && state.monthlyTacticCaptures < 1) {
      const followOptions = attackOptions(state, context, factionId)
        .filter((option) => option.sourceId === target.id);
      const bestFollow = followOptions[0];
      if (bestFollow) {
        const followStats = effectiveStats(state, factionId);
        const followChance = clamp(0.66 + followStats.command / 420 + followStats.strategy / 650
          - faction.fatigue / 500, 0.25, 0.98);
        if (random.next() < followChance) {
          const followSource = ensureStateRegion(state, bestFollow.sourceId);
          const followTarget = ensureStateRegion(state, bestFollow.targetId);
          if (followSource.owner === factionId && followTarget.owner !== factionId) {
            const followEventStart = events.length;
            const followCaptured = executeAttack(state, context, followSource, followTarget, factionId, random, events);
            for (const event of events.slice(followEventStart)) {
              event.pursuit = true;
              event.text = event.text.replace(faction.name, `${faction.name}乘胜追击，`);
            }
            if (followCaptured) state.monthlyTacticCaptures += 1;
          }
        }
      }
    }
  }
}

function updateFactionStatus(state, events) {
  const previous = Object.create(null);
  for (const factionId of participantIds(state)) previous[factionId] = Boolean(state.factions[factionId] && state.factions[factionId].alive);
  updateFactionSnapshots(state);
  for (const factionId of participantIds(state)) {
    const faction = state.factions[factionId];
    if (previous[factionId] && faction && !faction.alive && !faction.lordId) {
      appendEvent(state, events, 'eliminate', `${faction.name}失去最后一块领地，退出沙盘。`, {
        actor: factionId,
        success: false,
      });
    }
  }
  // Snapshotting a defeated member also turns off its war posture.  Release
  // any coalition that still references it in this same month so the state
  // never exposes an active alliance with a departed or peaceful member.
  for (const coalition of state.coalitions || []) {
    if (!coalition || coalition.active === false) continue;
    const invalidMember = coalition.members.some((id) => {
      const faction = state.factions[id];
      return !faction || !faction.alive || faction.lordId || faction.aggressive !== true;
    });
    if (!invalidMember) continue;
    coalition.active = false;
    coalition.status = 'dissolved';
    state.coalitionCooldowns[coalitionKey(coalition.members, coalition.target)] = state.month;
    appendEvent(state, events, 'coalition', '合纵关系解体，盟友不再共同进军。', {
      actor: coalition.members[0],
      members: coalition.members.slice(),
      target: coalition.target,
      action: 'dissolve',
      success: true,
      details: '成员已退出独立势力，盟约随之解除。',
    });
  }
}

function recallExpeditionsAfterVictory(state, winnerId, events) {
  if (!Array.isArray(state.expeditions)) return;
  const winner = state.factions[winnerId];
  const winnerName = winner ? winner.name : '统一势力';
  for (const expedition of state.expeditions) {
    if (!expedition || expedition.status !== 'started') continue;
    const faction = state.factions[expedition.actor];
    const canReturn = faction && faction.alive && !faction.lordId
      && ownedRegions(state, expedition.actor).length > 0;
    let survivors = 0;
    let troopLoss = expedition.troopsCommitted;
    if (canReturn) {
      const destination = ownedRegions(state, expedition.actor)
        .slice().sort((left, right) => left.id - right.id)[0];
      if (destination) {
        // Recall restores only troops that were already committed at departure;
        // the unfinished expedition never earns site rewards.
        survivors = Math.max(0, expedition.troopsCommitted);
        troopLoss = 0;
        destination.troops += survivors;
      }
    }
    expedition.status = 'cancelled';
    expedition.troopLoss = troopLoss;
    expedition.result = {
      success: false,
      grainCost: round(expedition.grainSpent),
      troopLoss,
      survivors,
      reward: {},
      reason: 'victory_recall',
      details: canReturn
        ? `天下已由${winnerName}统一，远征军奉诏撤回；行程未完成，未取得远征奖励。`
        : `天下已由${winnerName}统一，${expedition.siteName}远征中止；原势力已无独立领地，未取得远征奖励。`,
    };
    expedition.result.text = expedition.result.details;
    if (!state.expeditionCooldowns || typeof state.expeditionCooldowns !== 'object') {
      state.expeditionCooldowns = Object.create(null);
    }
    state.expeditionCooldowns[expeditionCooldownKey(expedition.actor, expedition.siteId)] = state.month;
    appendEvent(state, events, 'expedition', canReturn
      ? `${faction.name}的远征军奉诏撤回，未取得${expedition.siteName}奖励。`
      : `${expedition.siteName}远征随统一战局中止，未取得奖励。`, {
      actor: expedition.actor,
      siteId: expedition.siteId,
      from: expedition.originRegion,
      to: null,
      status: 'cancelled',
      success: false,
      grainCost: round(expedition.grainSpent),
      troopLoss,
      survivors,
      winner: winnerId,
      reason: 'victory_recall',
      details: expedition.result.details,
    });
  }
}

function factionBelongsToSide(state, factionId, sideIds) {
  const side = sideIds instanceof Set ? sideIds : new Set(sideIds || []);
  let current = factionId;
  const seen = new Set();
  while (current && !seen.has(current)) {
    if (side.has(current)) return true;
    seen.add(current);
    const faction = state.factions && state.factions[current];
    current = faction && faction.lordId ? faction.lordId : null;
  }
  return false;
}

function factionLineageRoot(state, factionId) {
  let current = factionId;
  const seen = new Set();
  while (current && !seen.has(current)) {
    seen.add(current);
    const faction = state.factions && state.factions[current];
    if (!faction || !faction.lordId) return current;
    current = faction.lordId;
  }
  return factionId;
}

function selectedChineseIds(state, context) {
  return selectedFactionIds(state)
    .filter((factionId) => isChineseFaction(context, factionId));
}

function livingDomesticFactionIds(state, context) {
  return selectedChineseIds(state, context).filter((factionId) => {
    const faction = state.factions[factionId];
    return Boolean(faction && faction.alive && !faction.lordId
      && ownedRegions(state, factionId).some((region) => isDomesticRegion(context, region.id)));
  });
}

// Once the mainland has one independent Chinese owner, the domestic leg is
// complete.  A world campaign can still continue from the truce phase, so
// this deliberately does not set state.finished.
function updateDomesticWinner(state, context, events) {
  if (!state.worldMode || campaignPhase(state) !== 'domestic' || state.domesticWinner) return false;
  const remaining = livingDomesticFactionIds(state, context);
  if (remaining.length !== 1) return false;
  const winnerId = remaining[0];
  const winner = state.factions[winnerId];
  state.domesticWinner = winnerId;
  state.campaignPhase = 'truce';
  applyCampaignPosture(state, 'truce');
  const text = `${winner.name}平定海内，国内诸侯暂息兵戈。`;
  appendEvent(state, events, 'phase', text, {
    actor: winnerId,
    phase: 'truce',
    domesticWinner: winnerId,
    success: true,
    details: text,
  });
  return true;
}

function completeWorldCampaign(state, context, foreignRegions, sideIds, events) {
  if (!foreignRegions.length || !foreignRegions.every((region) => {
    return region.owner && factionBelongsToSide(state, region.owner, sideIds);
  })) return false;
  const winningIds = Array.from(new Set(foreignRegions
    .map((region) => factionLineageRoot(state, region.owner))
    .filter((factionId) => sideIds.has(factionId))));
  if (!winningIds.length) return false;
  const leaderCandidates = selectedChineseIds(state, context)
    .filter((factionId) => winningIds.includes(factionLineageRoot(state, factionId))
      || factionBelongsToSide(state, factionId, sideIds));
  const candidates = leaderCandidates.length ? leaderCandidates : winningIds;
  const winnerId = candidates.slice().sort((left, right) => {
    const leftFaction = state.factions[left];
    const rightFaction = state.factions[right];
    return ownedRegions(state, right).length - ownedRegions(state, left).length
      || factionThreatPower(state, right) - factionThreatPower(state, left)
      || participantIndex(state, left) - participantIndex(state, right);
  })[0];
  state.worldCompleted = true;
  state.victoryType = 'world-campaign';
  state.winningFactionIds = winningIds.slice();
  state.winner = winnerId;
  recallExpeditionsAfterVictory(state, winnerId, events);
  state.finished = true;
  state.phase = 'victory';
  const winner = state.factions[winnerId];
  const text = `${winner.name}率诸侯收服域外，普天之下归于华夏阵营，沙盘结束。`;
  appendEvent(state, events, 'victory', text, {
    actor: winnerId,
    winningFactionIds: winningIds.slice(),
    victoryType: 'world-campaign',
    worldCompleted: true,
    success: true,
    details: `域外区域=${foreignRegions.length}；完成月数=${state.month}`,
  });
  return true;
}

function checkVictory(state, context, events) {
  if (state.worldMode && campaignPhase(state) === 'world') {
    const foreignRegions = state.regions.filter((region) => isForeignRegion(context, region.id));
    const sideIds = new Set(selectedChineseIds(state, context));
    if (completeWorldCampaign(state, context, foreignRegions, sideIds, events)) return;
  }
  const owners = new Set(state.regions.map((region) => region.owner));
  if (!state.worldMode && owners.size === 1 && !owners.has(null)) {
    state.winner = Array.from(owners)[0];
    state.winningFactionIds = [state.winner];
    state.victoryType = 'regional';
    recallExpeditionsAfterVictory(state, state.winner, events);
    state.finished = true;
    state.phase = 'victory';
    const winner = state.factions[state.winner];
    appendEvent(state, events, 'victory', `${winner.name}统一${state.regions.length}块区域，沙盘结束。`, {
      actor: state.winner,
      winningFactionIds: [state.winner],
      victoryType: 'regional',
      success: true,
      details: `统一月数=${state.month}`,
    });
  }
}

function step(state, map) {
  if (!state || typeof state !== 'object') throw new Error('WarEngine: step requires a state');
  if (state.finished) return state;
  // Keep replay compatibility with states serialized before diplomatic and
  // tactic bookkeeping was introduced.
  if (!Array.isArray(state.participantIds) || !state.participantIds.length) {
    state.participantIds = BASE_FACTION_IDS.slice();
  }
  if (!state.options || typeof state.options !== 'object') {
    state.options = {
      factionIds: selectedFactionIds(state).slice(),
      coalitions: true,
      expeditions: true,
      autoWar: true,
      worldMode: Boolean(state.worldMode),
    };
  } else {
    if (!Array.isArray(state.options.factionIds)) state.options.factionIds = selectedFactionIds(state).slice();
    if (state.options.coalitions == null) state.options.coalitions = true;
    if (state.options.expeditions == null) state.options.expeditions = true;
    if (state.options.autoWar == null) state.options.autoWar = true;
  }
  if (!state.tacticCooldowns || typeof state.tacticCooldowns !== 'object') state.tacticCooldowns = Object.create(null);
  if (!state.allegianceCooldowns || typeof state.allegianceCooldowns !== 'object') state.allegianceCooldowns = Object.create(null);
  if (!state.coalitions || !Array.isArray(state.coalitions)) state.coalitions = [];
  if (!state.coalitionCooldowns || typeof state.coalitionCooldowns !== 'object') state.coalitionCooldowns = Object.create(null);
  if (!state.coalitionEventMonths || typeof state.coalitionEventMonths !== 'object') state.coalitionEventMonths = Object.create(null);
  if (!state.expeditions || !Array.isArray(state.expeditions)) state.expeditions = [];
  if (!state.expeditionCooldowns || typeof state.expeditionCooldowns !== 'object') state.expeditionCooldowns = Object.create(null);
  const context = normalizeMap(map);
  if (state.worldMode == null) state.worldMode = context.worldMode === true;
  if (!Array.isArray(state.worldFactionIds) || !state.worldFactionIds.length) {
    state.worldFactionIds = participantIds(state).slice();
  }
  if (!Array.isArray(state.selectedFactionIds) || !state.selectedFactionIds.length) {
    state.selectedFactionIds = Array.isArray(state.options.factionIds)
      ? state.options.factionIds.slice() : participantIds(state).slice();
  }
  if (!Array.isArray(state.requiredFactionIds)) state.requiredFactionIds = [];
  if (!Array.isArray(state.links)) state.links = context.links.map((link) => ({ ...link }));
  if (!['domestic', 'truce', 'world'].includes(state.campaignPhase)) state.campaignPhase = 'domestic';
  if (state.domesticWinner === undefined) state.domesticWinner = null;
  if (state.worldCompleted === undefined) state.worldCompleted = false;
  if (!Array.isArray(state.winningFactionIds)) {
    state.winningFactionIds = state.winner ? [state.winner] : [];
  }
  if (state.victoryType === undefined) {
    state.victoryType = state.finished
      ? (state.worldMode ? 'world-campaign' : 'regional') : null;
  }
  if (!Array.isArray(state.foreignFactionIds)) {
    state.foreignFactionIds = context.foreignFactionIds.slice();
  }
  for (const factionId of participantIds(state)) {
    const faction = state.factions && state.factions[factionId];
    if (faction && typeof faction.aggressive !== 'boolean') {
      const worldAllowed = !state.worldMode
        || campaignPhase(state) === 'world'
        || !stateIsForeignFaction(state, factionId);
      faction.aggressive = state.options.autoWar === true
        && campaignPhase(state) !== 'truce' && worldAllowed;
    }
    if (faction && faction.aggressive === true && !Number.isFinite(Number(faction.aggressionSince))) {
      faction.aggressionSince = state.options.autoWar === true ? 0 : (Number(state.month) || 0);
    }
    if (faction && faction.aggressive !== true) faction.aggressionSince = null;
    if (faction && state.worldMode && campaignPhase(state) !== 'world'
      && stateIsForeignFaction(state, factionId)) {
      faction.aggressive = false;
      faction.aggressionSince = null;
    }
    if (faction && campaignPhase(state) === 'truce') {
      faction.aggressive = false;
      faction.aggressionSince = null;
    }
  }
  if (!Array.isArray(state.expeditionSites)) {
    state.expeditionSites = context.expeditionSites.map((site) => ({ ...site, rewards: { ...site.rewards } }));
  }
  assertInvariants(state, map);
  state.month += 1;
  state.phase = phaseForMonth(state.month);
  state.lastEvents = [];
  state.monthlyTacticCaptures = 0;
  state.monthlyAllegiances = 0;
  const events = state.lastEvents;
  const random = new SeededRandom(state.rngState);
  const previousPhase = state.month === 1 ? null : phaseForMonth(state.month - 1);
  if (previousPhase !== state.phase) {
    appendEvent(state, events, 'system', `进入${phaseLabel(state.phase)}阶段，补给与战线压力重新计算。`, {
      success: true,
      details: `当前阶段：${phaseLabel(state.phase)}`,
    });
  }

  monthlyEconomy(state, context, events);
  advanceExpeditions(state, context, random, events);
  developAndRecruit(state, context, random, events);
  updateCoalitions(state, context, random, events);
  runExpeditionAI(state, context, random, events);
  attemptAllegiances(state, context, random, events);
  runCampaign(state, context, random, events);
  updateFactionStatus(state, events);
  updateDomesticWinner(state, context, events);
  checkVictory(state, context, events);
  state.rngState = random.state >>> 0;
  updateFactionSnapshots(state);
  assertInvariants(state, map);
  return state;
}

function ranking(state, map) {
  const context = normalizeMap(map);
  assertInvariants(state, map);
  return participantIds(state).map((factionId) => FACTION_BY_ID[factionId]).map((faction) => {
    const stateFaction = state.factions[faction.id];
    const owned = ownedRegions(state, faction.id);
    const teamStats = effectiveStats(state, faction.id);
    const development = owned.reduce((sum, region) => sum + region.development, 0);
    const fort = owned.reduce((sum, region) => sum + region.fort, 0);
    const power = stateFaction.troops
      * (1 + teamStats.strength / 420 + teamStats.command / 250 + teamStats.strategy / 500)
      + development * 4
      + fort * 1.5;
    return {
      id: faction.id,
      name: faction.name,
      color: faction.color,
      territories: owned.length,
      troops: round(stateFaction.troops),
      grain: round(stateFaction.grain),
      development: round(development),
      fort: round(fort),
      morale: Number(stateFaction.morale.toFixed(3)),
      fatigue: Number(stateFaction.fatigue.toFixed(3)),
      power: round(power),
      alive: Boolean(stateFaction.alive),
      aggressive: Boolean(stateFaction.aggressive),
      victories: stateFaction.victories,
      initialRegion: stateFaction.initialRegion,
      era: faction.era,
      style: faction.style,
      role: faction.role,
      lordId: stateFaction.lordId,
      stats: { ...faction.stats },
      effectiveStats: teamStats,
    };
  }).sort((left, right) => right.territories - left.territories
    || right.power - left.power
    || right.grain - left.grain
    || participantIndex(state, left.id) - participantIndex(state, right.id));
}

function assertFiniteNonNegative(value, label) {
  if (!Number.isFinite(Number(value)) || Number(value) < 0) throw new Error(`WarEngine invariant: ${label} must be non-negative`);
}

function assertInvariants(state, map) {
  if (!state || typeof state !== 'object') throw new Error('WarEngine invariant: state must be an object');
  const context = normalizeMap(map);
  if (!Number.isInteger(state.month) || state.month < 0) throw new Error('WarEngine invariant: month must be a non-negative integer');
  if (!Array.isArray(state.regions) || state.regions.length !== context.regions.length) throw new Error('WarEngine invariant: region count changed');
  if (!state.factions || typeof state.factions !== 'object') throw new Error('WarEngine invariant: factions missing');
  const ids = participantIds(state);
  if (!Array.isArray(state.participantIds) || state.participantIds.length !== ids.length) {
    // A state serialized before the roster-selection release is allowed to
    // omit participantIds; all newly-created games always include it.
    if (state.participantIds != null) throw new Error('WarEngine invariant: participantIds must be an array');
  }
  const selectedIds = selectedFactionIds(state);
  const worldMode = state.worldMode === true;
  if (ids.length < 3 || (!worldMode && ids.length > 12)) {
    throw new Error(worldMode
      ? 'WarEngine invariant: world participant count must be at least 3'
      : 'WarEngine invariant: participant count must be 3-12');
  }
  if (new Set(ids).size !== ids.length || ids.some((id) => !FACTION_BY_ID[id])) {
    throw new Error('WarEngine invariant: participantIds contain duplicates or unknown characters');
  }
  if (!Array.isArray(state.worldFactionIds) || state.worldFactionIds.length !== ids.length
    || state.worldFactionIds.some((id, index) => id !== ids[index])) {
    throw new Error('WarEngine invariant: worldFactionIds must match participantIds');
  }
  if (!Array.isArray(state.selectedFactionIds)
    || selectedIds.length < 3 || selectedIds.length > 12
    || new Set(selectedIds).size !== selectedIds.length
    || selectedIds.some((id) => !ids.includes(id))) {
    throw new Error('WarEngine invariant: selectedFactionIds must select 3-12 participating characters');
  }
  if (!Array.isArray(state.requiredFactionIds)
    || new Set(state.requiredFactionIds).size !== state.requiredFactionIds.length
    || state.requiredFactionIds.some((id) => !ids.includes(id) || selectedIds.includes(id))) {
    throw new Error('WarEngine invariant: requiredFactionIds must be participating unselected characters');
  }
  if (worldMode !== (context.worldMode === true)) {
    throw new Error('WarEngine invariant: worldMode does not match map');
  }
  if (!['domestic', 'truce', 'world'].includes(state.campaignPhase)) {
    throw new Error('WarEngine invariant: campaignPhase is invalid');
  }
  if (!worldMode && state.campaignPhase === 'world') {
    throw new Error('WarEngine invariant: regional maps cannot enter world phase');
  }
  if (state.domesticWinner != null) {
    if (!ids.includes(state.domesticWinner)
      || !isChineseFaction(context, state.domesticWinner)) {
      throw new Error('WarEngine invariant: domesticWinner must be a participating Chinese faction');
    }
    if (state.campaignPhase !== 'truce' && state.campaignPhase !== 'world') {
      throw new Error('WarEngine invariant: domesticWinner requires truce or world phase');
    }
  }
  if (typeof state.worldCompleted !== 'boolean') {
    throw new Error('WarEngine invariant: worldCompleted must be boolean');
  }
  if (!['regional', 'world-campaign'].includes(state.victoryType)
    && state.victoryType !== null) {
    throw new Error('WarEngine invariant: victoryType is invalid');
  }
  if (!Array.isArray(state.winningFactionIds)
    || new Set(state.winningFactionIds).size !== state.winningFactionIds.length
    || state.winningFactionIds.some((id) => !ids.includes(id))) {
    throw new Error('WarEngine invariant: winningFactionIds is malformed');
  }
  if (state.worldCompleted
    && (!worldMode || !state.finished || state.victoryType !== 'world-campaign'
      || state.winningFactionIds.length === 0)) {
    throw new Error('WarEngine invariant: world completion fields are inconsistent');
  }
  if (!Array.isArray(state.foreignFactionIds)
    || new Set(state.foreignFactionIds).size !== state.foreignFactionIds.length
    || state.foreignFactionIds.some((id) => !ids.includes(id))) {
    throw new Error('WarEngine invariant: foreignFactionIds is malformed');
  }
  if (state.options != null) {
    if (typeof state.options !== 'object') throw new Error('WarEngine invariant: options malformed');
    if (!Array.isArray(state.options.factionIds)
      || state.options.factionIds.length !== selectedIds.length
      || state.options.factionIds.some((id, index) => id !== selectedIds[index])) {
      throw new Error('WarEngine invariant: options.factionIds must match selectedFactionIds');
    }
    if (typeof state.options.coalitions !== 'boolean' || typeof state.options.expeditions !== 'boolean'
      || typeof state.options.autoWar !== 'boolean') {
      throw new Error('WarEngine invariant: campaign options must be boolean');
    }
    if (state.options.worldMode != null && state.options.worldMode !== worldMode) {
      throw new Error('WarEngine invariant: options.worldMode does not match state');
    }
    if (state.options.requiredFactionIds != null
      && (!Array.isArray(state.options.requiredFactionIds)
        || state.options.requiredFactionIds.some((id, index) => id !== state.requiredFactionIds[index])
        || state.options.requiredFactionIds.length !== state.requiredFactionIds.length)) {
      throw new Error('WarEngine invariant: options.requiredFactionIds must match state');
    }
  }
  if (!Array.isArray(state.links)) throw new Error('WarEngine invariant: links missing');
  const stateLinkKeys = new Set();
  for (const link of state.links) {
    if (!link || !Number.isInteger(link.a) || !Number.isInteger(link.b)
      || link.a < 0 || link.b < 0 || link.a >= context.regions.length
      || link.b >= context.regions.length || link.a === link.b) {
      throw new Error('WarEngine invariant: malformed map link');
    }
    const linkKey = `${Math.min(link.a, link.b)}-${Math.max(link.a, link.b)}:${String(link.kind || 'sea')}`;
    if (stateLinkKeys.has(linkKey)) throw new Error('WarEngine invariant: duplicate state link');
    stateLinkKeys.add(linkKey);
    const contextLink = linkBetween(context, link.a, link.b);
    if (!contextLink || contextLink.kind !== (link.kind || 'sea')) {
      throw new Error('WarEngine invariant: state link does not match map links');
    }
  }
  if (!state.tacticCooldowns || typeof state.tacticCooldowns !== 'object') throw new Error('WarEngine invariant: tactic cooldowns missing');
  if (!state.allegianceCooldowns || typeof state.allegianceCooldowns !== 'object') throw new Error('WarEngine invariant: allegiance cooldowns missing');
  if (!Number.isInteger(state.monthlyTacticCaptures) || state.monthlyTacticCaptures < 0 || state.monthlyTacticCaptures > 1) {
    throw new Error('WarEngine invariant: monthly tactic captures must be 0 or 1');
  }
  if (!Number.isInteger(state.monthlyAllegiances) || state.monthlyAllegiances < 0) {
    throw new Error('WarEngine invariant: monthly allegiances must be a non-negative integer');
  }
  if (!Array.isArray(state.coalitions)) throw new Error('WarEngine invariant: coalitions missing');
  if (!state.coalitionCooldowns || typeof state.coalitionCooldowns !== 'object') {
    throw new Error('WarEngine invariant: coalition cooldowns missing');
  }
  if (!state.coalitionEventMonths || typeof state.coalitionEventMonths !== 'object') {
    throw new Error('WarEngine invariant: coalition event bookkeeping missing');
  }
  if (!Array.isArray(state.expeditions)) throw new Error('WarEngine invariant: expeditions missing');
  if (!state.expeditionCooldowns || typeof state.expeditionCooldowns !== 'object') {
    throw new Error('WarEngine invariant: expedition cooldowns missing');
  }
  if (!Array.isArray(state.expeditionSites)) throw new Error('WarEngine invariant: expedition sites missing');
  const siteIds = new Set();
  for (const site of state.expeditionSites) {
    if (!site || site.id == null || siteIds.has(String(site.id))) {
      throw new Error('WarEngine invariant: expedition site ids must be unique');
    }
    siteIds.add(String(site.id));
    if (!Number.isInteger(site.distance) || site.distance < 1 || site.distance > 12
      || !Number.isInteger(site.difficulty) || site.difficulty < 1 || site.difficulty > 100) {
      throw new Error(`WarEngine invariant: expedition site ${site.id} is malformed`);
    }
    if (!site.rewards || typeof site.rewards !== 'object') throw new Error(`WarEngine invariant: expedition site ${site.id} rewards missing`);
    if (!Number.isInteger(site.cooldownMonths) || site.cooldownMonths < 1 || site.cooldownMonths > 60) {
      throw new Error(`WarEngine invariant: expedition site ${site.id} cooldown is malformed`);
    }
  }
  const owners = new Set();
  state.regions.forEach((region, index) => {
    if (!region || region.id !== index) throw new Error(`WarEngine invariant: state region ${index} is malformed`);
    if (region.owner !== null && !ids.includes(region.owner)) throw new Error(`WarEngine invariant: invalid owner ${region.owner}`);
    if (worldMode && region.owner === null) throw new Error(`WarEngine invariant: world region ${index} has no owner`);
    assertFiniteNonNegative(region.troops, `region ${index} troops`);
    assertFiniteNonNegative(region.development, `region ${index} development`);
    assertFiniteNonNegative(region.fort, `region ${index} fort`);
    if (region.owner) owners.add(region.owner);
  });
  for (const factionId of participantIds(state)) {
    const faction = state.factions[factionId];
    if (!faction) throw new Error(`WarEngine invariant: faction ${factionId} missing`);
    if (!faction.role || typeof faction.role !== 'string') throw new Error(`WarEngine invariant: ${factionId} role missing`);
    if (typeof faction.aggressive !== 'boolean') throw new Error(`WarEngine invariant: ${factionId} aggression flag missing`);
    if (faction.aggressive
      && (!Number.isInteger(faction.aggressionSince) || faction.aggressionSince < 0
        || faction.aggressionSince > state.month)) {
      throw new Error(`WarEngine invariant: ${factionId} aggression clock is malformed`);
    }
    if (!faction.aggressive && faction.aggressionSince != null) {
      throw new Error(`WarEngine invariant: peaceful ${factionId} retains an aggression clock`);
    }
    if (!faction.stats || typeof faction.stats !== 'object') throw new Error(`WarEngine invariant: ${factionId} stats missing`);
    for (const key of ATTRIBUTE_KEYS) {
      const value = faction.stats[key];
      if (!Number.isInteger(value) || value < 1 || value > 100) {
        throw new Error(`WarEngine invariant: ${factionId}.${key} must be an integer from 1 to 100`);
      }
      if (value !== FACTION_BY_ID[factionId].stats[key]) {
        throw new Error(`WarEngine invariant: ${factionId}.${key} permanent stat changed`);
      }
    }
    if (Object.keys(faction.stats).length !== ATTRIBUTE_KEYS.length) {
      throw new Error(`WarEngine invariant: ${factionId} stats dimensions changed`);
    }
    if (faction.lordId !== null && !ids.includes(faction.lordId)) {
      throw new Error(`WarEngine invariant: ${factionId} has invalid lord ${faction.lordId}`);
    }
    if (faction.lordId === factionId) throw new Error(`WarEngine invariant: ${factionId} cannot be their own lord`);
    const lineage = new Set([factionId]);
    let lineageCursor = faction.lordId;
    while (lineageCursor) {
      if (lineage.has(lineageCursor)) throw new Error(`WarEngine invariant: lord cycle includes ${lineageCursor}`);
      lineage.add(lineageCursor);
      const lord = state.factions[lineageCursor];
      if (!lord || lord.lordId === undefined) throw new Error(`WarEngine invariant: ${factionId} lord chain is malformed`);
      lineageCursor = lord.lordId;
    }
    assertFiniteNonNegative(faction.grain, `${factionId} grain`);
    assertFiniteNonNegative(faction.fatigue, `${factionId} fatigue`);
    assertFiniteNonNegative(faction.economy, `${factionId} economy`);
    assertFiniteNonNegative(faction.troops, `${factionId} troops`);
    if (!Number.isFinite(faction.morale) || faction.morale < 0) throw new Error(`WarEngine invariant: ${factionId} morale`);
    const territories = state.regions.filter((region) => region.owner === factionId).length;
    if (faction.territories !== territories) throw new Error(`WarEngine invariant: ${factionId} territory snapshot mismatch`);
    if (faction.lordId && territories > 0) throw new Error(`WarEngine invariant: surrendered ${factionId} still owns territory`);
    if (Boolean(faction.alive) !== (territories > 0 && !faction.lordId)) throw new Error(`WarEngine invariant: ${factionId} alive snapshot mismatch`);
  }
  for (const coalition of state.coalitions) {
    if (!coalition || !Array.isArray(coalition.members) || coalition.members.length < 2
      || new Set(coalition.members).size !== coalition.members.length
      || coalition.members.some((id) => !ids.includes(id))) {
      throw new Error('WarEngine invariant: malformed coalition members');
    }
    if (!ids.includes(coalition.target) || coalition.members.includes(coalition.target)) {
      throw new Error('WarEngine invariant: malformed coalition target');
    }
    if (!Number.isInteger(coalition.formedMonth) || !Number.isInteger(coalition.expiresMonth)
      || coalition.formedMonth < 0 || coalition.expiresMonth < coalition.formedMonth) {
      throw new Error('WarEngine invariant: malformed coalition duration');
    }
    if (coalition.active != null && typeof coalition.active !== 'boolean') {
      throw new Error('WarEngine invariant: coalition active flag must be boolean');
    }
    if (coalition.status != null && !['active', 'expired', 'dissolved'].includes(coalition.status)) {
      throw new Error('WarEngine invariant: coalition status is invalid');
    }
    if (coalition.active === true && coalition.status != null && coalition.status !== 'active') {
      throw new Error('WarEngine invariant: inactive coalition cannot have active status');
    }
    if (coalition.active === true && coalition.members.some((id) => state.factions[id].aggressive !== true)) {
      throw new Error('WarEngine invariant: active coalition member must have aggression enabled');
    }
  }
  for (const expedition of state.expeditions) {
    if (!expedition || !ids.includes(expedition.actor) || !siteIds.has(String(expedition.siteId))) {
      throw new Error('WarEngine invariant: malformed expedition actor or site');
    }
    if (!['started', 'victory', 'defeat', 'cancelled'].includes(expedition.status)) {
      throw new Error('WarEngine invariant: invalid expedition status');
    }
    if (!Number.isInteger(expedition.startMonth) || !Number.isInteger(expedition.returnMonth)
      || expedition.startMonth < 0 || expedition.returnMonth < expedition.startMonth) {
      throw new Error('WarEngine invariant: malformed expedition schedule');
    }
    if (!Number.isInteger(expedition.originRegion) || expedition.originRegion < 0
      || expedition.originRegion >= context.regions.length) {
      throw new Error('WarEngine invariant: malformed expedition origin');
    }
    for (const key of ['troopsCommitted', 'grainCommitted', 'grainSpent', 'troopLoss']) {
      assertFiniteNonNegative(expedition[key], `expedition ${expedition.siteId} ${key}`);
    }
    if (expedition.result != null && typeof expedition.result !== 'object') {
      throw new Error('WarEngine invariant: expedition result must be an object or null');
    }
    if (expedition.status === 'started' && expedition.result != null) {
      throw new Error('WarEngine invariant: active expedition cannot have a result');
    }
    if (expedition.status !== 'started' && expedition.result == null) {
      throw new Error('WarEngine invariant: completed expedition needs a result');
    }
  }
  if (state.finished && !state.winner) throw new Error('WarEngine invariant: finished state needs a winner');
  if (state.finished && !['regional', 'world-campaign'].includes(state.victoryType)) {
    throw new Error('WarEngine invariant: finished state needs a victoryType');
  }
  if (state.winner && !ids.includes(state.winner)) throw new Error('WarEngine invariant: invalid winner');
  if (!Number.isInteger(state.rngState) || state.rngState < 0) throw new Error('WarEngine invariant: rngState malformed');
  if (!Array.isArray(state.events) || !Array.isArray(state.lastEvents)) throw new Error('WarEngine invariant: events missing');
  for (const event of state.events) {
    if (!event || typeof event !== 'object' || !event.id || !Number.isInteger(event.month) || !event.type) {
      throw new Error('WarEngine invariant: malformed event');
    }
    if (event.from != null && (!Number.isInteger(event.from)
      || event.from < 0 || event.from >= context.regions.length)) {
      throw new Error('WarEngine invariant: event.from references an invalid region');
    }
    if (event.to != null && (!Number.isInteger(event.to)
      || event.to < 0 || event.to >= context.regions.length)) {
      throw new Error('WarEngine invariant: event.to references an invalid region');
    }
    if (event.crossSea != null && typeof event.crossSea !== 'boolean') {
      throw new Error('WarEngine invariant: event.crossSea must be boolean');
    }
    if (event.from != null && event.to != null && event.crossSea != null) {
      const route = linkBetween(context, event.from, event.to);
      if (Boolean(event.crossSea) !== Boolean(route && route.kind === 'sea')) {
        throw new Error(`WarEngine invariant: event.crossSea does not match route (${event.from}, ${event.to})`);
      }
      if (event.linkKind != null && (!route || String(event.linkKind) !== String(route.kind))) {
        throw new Error(`WarEngine invariant: event.linkKind does not match route (${event.from}, ${event.to})`);
      }
    }
    for (const key of ['actor', 'subject', 'defender']) {
      if (event[key] != null && !ids.includes(event[key])) {
        throw new Error(`WarEngine invariant: event.${key} references an invalid faction`);
      }
    }
    if (event.members != null && (!Array.isArray(event.members)
      || event.members.length < 2 || event.members.some((id) => !ids.includes(id)))) {
      throw new Error('WarEngine invariant: event.members references invalid coalition members');
    }
    if (event.type === 'battle' || event.type === 'capture') {
      if (event.from == null || event.to == null || !context.adjacency[event.from].includes(event.to)) {
        throw new Error(`WarEngine invariant: ${event.type} is not adjacent (${event.from}, ${event.to})`);
      }
    }
    if (event.type === 'tactic') {
      if (event.from == null || event.to == null
        || !(context.adjacency[event.from].includes(event.to)
          || context.adjacency[event.to].includes(event.from))) {
        throw new Error(`WarEngine invariant: tactic is not adjacent (${event.from}, ${event.to})`);
      }
      if (!event.actor || !event.defender || event.actor === event.defender
        || typeof event.success !== 'boolean') {
        throw new Error('WarEngine invariant: malformed tactic event');
      }
    }
    if (event.type === 'allegiance') {
      if (!event.actor || !event.subject || event.actor === event.subject || event.success !== true) {
        throw new Error('WarEngine invariant: malformed allegiance event');
      }
    }
    if (event.type === 'coalition') {
      if (!event.members || !ids.includes(event.target)
        || !['form', 'coordinate', 'expire', 'dissolve'].includes(event.action)
        || event.success !== true) {
        throw new Error('WarEngine invariant: malformed coalition event');
      }
      if (event.action === 'coordinate') {
        if (event.from == null || event.to == null
          || !(context.adjacency[event.from].includes(event.to)
            || context.adjacency[event.to].includes(event.from))) {
          throw new Error(`WarEngine invariant: coalition coordinate is not adjacent (${event.from}, ${event.to})`);
        }
      }
    }
    if (event.type === 'expedition') {
      if (!event.actor || !siteIds.has(String(event.siteId))
        || !['started', 'victory', 'defeat', 'cancelled'].includes(event.status)
        || (typeof event.success !== 'boolean' && event.success !== null)) {
        throw new Error('WarEngine invariant: malformed expedition event');
      }
      if (event.from != null && (!Number.isInteger(event.from)
        || event.from < 0 || event.from >= context.regions.length)) {
        throw new Error('WarEngine invariant: expedition event.from references an invalid region');
      }
      if (event.to != null) throw new Error('WarEngine invariant: expedition event.to must be null');
    }
  }
  return true;
}

const WarEngine = {
  version: '1.1.0',
  ATTRIBUTES: ATTRIBUTES.map((attribute) => ({ ...attribute })),
  FACTIONS: FACTIONS.map((faction) => ({
    ...faction,
    stats: { ...faction.stats },
  })),
  RELATIONSHIPS: RELATIONSHIPS.map((relationship) => ({ ...relationship })),
  createGame,
  step,
  ranking,
  effectiveStats,
  setAggression,
  setCampaignPhase,
  canStartExpedition,
  startExpedition,
  assertInvariants,
};

if (typeof globalThis !== 'undefined') globalThis.WarEngine = WarEngine;
if (typeof module !== 'undefined' && module.exports) module.exports = WarEngine;
