/* Dziennik formy Wercii: where the data lives.
   Default: in this browser (localStorage), written on every change. Nothing to set up.
   Optional: a JSON file in a GitHub repo, connected in settings with a token. Every change is
   still written locally first, then queued in an outbox and sent in the background. The outbox
   survives reloads and lost connections, and each send re-reads the file and applies only the
   queued changes, so edits made elsewhere (another phone, Claude in chat) are kept. */
(function (DF) {
  'use strict';

  const U = DF.utils;

  const PREFIX = 'wercia.';
  const KEY_DATA = PREFIX + 'data';
  const KEY_OUTBOX = PREFIX + 'outbox';
  const KEY_GITHUB = PREFIX + 'github';
  const KEY_TOKEN = PREFIX + 'token';
  const API = 'https://api.github.com';

  const ENTRY_FIELDS = ['weight', 'kcal', 'protein', 'fat', 'carbs', 'training', 'mood', 'sleep', 'sleepScore', 'note'];
  // Macro targets in grams. Optional: without them macros are shown, just not judged.
  const MACRO_TARGETS = ['proteinTarget', 'fatTarget', 'carbsTarget'];
  // Key order in the file. The macro targets sit next to the calorie target.
  const SETTING_KEYS = ['name', 'startDate', 'startWeight', 'targetWeight', 'targetDate', 'kcalTarget',
    ...MACRO_TARGETS, 'weeklyTrainings', 'trainings'];
  const DEFAULT_TRAININGS = Object.freeze(['FBW A', 'FBW B']);

  // Valid ranges, shared by the file parser and the forms so both accept the same values.
  const LIMITS = Object.freeze({
    weight: [20, 400],
    kcal: [0, 20000],
    kcalTarget: [800, 10000],
    macro: [0, 1000],
    macroTarget: [1, 1000],
    weeklyTrainings: [0, 14],
    sleep: [0, 24],
    sleepScore: [0, 100]
  });

  class StoreError extends Error {
    constructor(kind, message, status) {
      super(message);
      this.name = 'StoreError';
      this.kind = kind;
      this.status = status || 0;
    }
  }

  const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // ---------- browser storage ----------

  function readLocal(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }

  function writeLocal(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
      return true;
    } catch (_) {
      return false;
    }
  }

  // ---------- data format (same as data/health.json) ----------

  // Before the first-visit form is filled, the weights, dates and calories are simply missing.
  function normalizeSettings(raw) {
    const src = isObj(raw) ? raw : {};
    const num = (v, lo, hi) => {
      const n = U.parseNumber(v);
      return n != null && n >= lo && n <= hi ? n : null;
    };
    const L = LIMITS;
    const kcal = num(src.kcalTarget, ...L.kcalTarget);
    const weekly = num(src.weeklyTrainings, ...L.weeklyTrainings);
    const out = {
      name: typeof src.name === 'string' && src.name.trim() ? src.name.trim().slice(0, 40) : 'Wercia',
      startDate: U.isValidKey(src.startDate) ? src.startDate : null,
      startWeight: num(src.startWeight, ...L.weight),
      targetWeight: num(src.targetWeight, ...L.weight),
      targetDate: U.isValidKey(src.targetDate) ? src.targetDate : null,
      kcalTarget: kcal == null ? null : Math.round(kcal),
      weeklyTrainings: weekly == null ? 3 : Math.round(weekly),
      trainings: Array.isArray(src.trainings)
        ? [...new Set(src.trainings.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim().slice(0, 24)))]
        : DEFAULT_TRAININGS.slice()
    };
    MACRO_TARGETS.forEach((k) => {
      const n = num(src[k], ...L.macroTarget);
      if (n != null) out[k] = Math.round(n);
    });
    // Keys this page doesn't know about survive a save untouched.
    Object.keys(src).forEach((k) => { if (!(k in out) && !MACRO_TARGETS.includes(k)) out[k] = src[k]; });
    return out;
  }

  function isSetUp(s) {
    return !!s && !!s.startDate && !!s.targetDate && s.startWeight != null && s.targetWeight != null &&
      s.kcalTarget != null && s.targetWeight < s.startWeight;
  }

  function cleanEntry(raw) {
    if (!isObj(raw) || !U.isValidKey(raw.date)) return null;
    const e = { date: raw.date };
    const within = (n, [lo, hi]) => n != null && n >= lo && n <= hi;
    const weight = U.parseNumber(raw.weight);
    if (within(weight, LIMITS.weight)) e.weight = Math.round(weight * 100) / 100;
    const kcal = U.parseNumber(raw.kcal);
    if (within(kcal, LIMITS.kcal)) e.kcal = Math.round(kcal);
    DF.stats.MACROS.forEach(({ key }) => {
      const g = U.parseNumber(raw[key]);
      if (within(g, LIMITS.macro)) e[key] = Math.round(g);
    });
    if (typeof raw.training === 'string' && raw.training.trim()) e.training = raw.training.trim();
    const mood = U.parseNumber(raw.mood);
    if (mood != null && mood >= 1 && mood <= 5) e.mood = Math.round(mood);
    const hours = U.parseNumber(raw.sleep);
    if (within(hours, LIMITS.sleep)) e.sleep = Math.round(hours * 100) / 100;
    const score = U.parseNumber(raw.sleepScore);
    if (within(score, LIMITS.sleepScore)) e.sleepScore = Math.round(score);
    if (typeof raw.note === 'string' && raw.note.trim()) e.note = raw.note.trim().slice(0, 280);
    Object.keys(raw).forEach((k) => {
      if (k === 'date' || ENTRY_FIELDS.includes(k)) return;
      if (raw[k] !== null && raw[k] !== undefined && raw[k] !== '') e[k] = raw[k];
    });
    return Object.keys(e).length > 1 ? e : null;
  }

  function normalize(raw) {
    const src = isObj(raw) ? raw : {};
    const byDate = new Map();
    (Array.isArray(src.entries) ? src.entries : []).forEach((r) => {
      const e = cleanEntry(r);
      if (e) byDate.set(e.date, Object.assign(byDate.get(e.date) || {}, e));
    });
    const data = {
      settings: normalizeSettings(src.settings),
      entries: [...byDate.values()].sort(DF.stats.byDate)
    };
    Object.keys(src).forEach((k) => { if (k !== 'settings' && k !== 'entries') data[k] = src[k]; });
    return data;
  }

  const inlineJson = (obj, keys) =>
    '{' + keys.map((k) => `${JSON.stringify(k)}: ${JSON.stringify(obj[k])}`).join(', ') + '}';

  function entryKeys(e) {
    return ['date',
      ...ENTRY_FIELDS.filter((k) => e[k] !== undefined),
      ...Object.keys(e).filter((k) => k !== 'date' && !ENTRY_FIELDS.includes(k))];
  }

  function settingValue(v) {
    if (Array.isArray(v) && v.every((x) => x === null || typeof x !== 'object')) {
      return '[' + v.map((x) => JSON.stringify(x)).join(', ') + ']';
    }
    return JSON.stringify(v);
  }

  function serialize(data) {
    const s = data.settings;
    const present = (k) => s[k] !== undefined && s[k] !== null;
    const sKeys = [...SETTING_KEYS.filter(present), ...Object.keys(s).filter((k) => !SETTING_KEYS.includes(k) && present(k))];
    const settings = sKeys.length
      ? '{\n' + sKeys.map((k) => `    ${JSON.stringify(k)}: ${settingValue(s[k])}`).join(',\n') + '\n  }'
      : '{}';
    const entries = data.entries.length
      ? '[\n' + data.entries.map((e) => '    ' + inlineJson(e, entryKeys(e))).join(',\n') + '\n  ]'
      : '[]';
    const extra = Object.keys(data)
      .filter((k) => k !== 'settings' && k !== 'entries')
      .map((k) => `,\n  ${JSON.stringify(k)}: ${JSON.stringify(data[k])}`)
      .join('');
    return `{\n  "settings": ${settings},\n  "entries": ${entries}${extra}\n}\n`;
  }

  function parse(text, where) {
    if (!text.trim()) return normalize({});
    let raw;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      throw new StoreError('parse', `${where} ma błąd składni JSON (${err.message}).`);
    }
    if (!isObj(raw)) throw new StoreError('parse', `${where} nie wygląda na dziennik (brak obiektu z danymi).`);
    return normalize(raw);
  }

  // ---------- changes ----------
  // Every change is a small operation, so the same operation can be applied to the local copy
  // right away and, later, to a freshly downloaded file without overwriting anything else in it.

  function applyOp(data, op) {
    if (op.op === 'replace') return normalize(clone(op.data));
    const d = clone(data);
    if (op.op === 'entry') {
      const i = d.entries.findIndex((e) => e.date === op.date);
      const e = i >= 0 ? d.entries[i] : { date: op.date };
      Object.keys(op.set || {}).forEach((k) => { e[k] = op.set[k]; });
      (op.unset || []).forEach((k) => { delete e[k]; });
      if (i >= 0) d.entries[i] = e;
      else d.entries.push(e);
    } else if (op.op === 'delete') {
      d.entries = d.entries.filter((e) => e.date !== op.date);
    } else if (op.op === 'settings') {
      d.settings = Object.assign({}, d.settings, op.set);
    } else if (op.op === 'merge') {
      // Local data joins a file that already has data: nothing in the file gets overwritten.
      if (op.settings && !isSetUp(normalizeSettings(d.settings))) d.settings = Object.assign({}, op.settings);
      (op.entries || []).forEach((le) => {
        const re = d.entries.find((e) => e.date === le.date);
        if (!re) d.entries.push(clone(le));
        else Object.keys(le).forEach((k) => { if (re[k] === undefined) re[k] = le[k]; });
      });
    }
    return normalize(d);
  }

  function entryMessage(e, date) {
    if (!e) return `log: usuń ${date}`;
    const parts = [];
    if (e.weight != null) parts.push(`${e.weight} kg`);
    if (e.kcal != null) parts.push(`${e.kcal} kcal`);
    DF.stats.MACROS.forEach(({ key, short }) => { if (e[key] != null) parts.push(`${short} ${e[key]} g`); });
    if (e.training) parts.push(e.training);
    if (e.mood != null) parts.push(`${e.mood}/5`);
    if (e.sleep != null) parts.push(`${e.sleep} h snu`);
    if (e.sleepScore != null) parts.push(`sen ${e.sleepScore}/100`);
    if (!parts.length && e.note) parts.push('notatka');
    return parts.length ? `log: ${date} (${parts.join(', ')})` : `log: ${date}`;
  }

  function settingsMessage(s) {
    const macros = DF.stats.MACROS
      .filter(({ key }) => s[`${key}Target`] != null)
      .map(({ key, short }) => `${short} ${s[`${key}Target`]} g`);
    return `settings: cel ${s.targetWeight} kg do ${s.targetDate}, ${s.kcalTarget} kcal` +
      `${macros.length ? `, ${macros.join(', ')}` : ''}, ${s.weeklyTrainings} treningi/tydz.`;
  }

  function commitMessage(ops, next) {
    const special = ops.find((o) => o.op === 'replace' || o.op === 'merge');
    if (special) return special.op === 'replace' ? 'import: dziennik z kopii' : 'sync: dane z przeglądarki';
    const dates = [...new Set(ops.filter((o) => o.op === 'entry' || o.op === 'delete').map((o) => o.date))];
    const withSettings = ops.some((o) => o.op === 'settings');
    if (dates.length === 1 && !withSettings) {
      return entryMessage(next.entries.find((e) => e.date === dates[0]), dates[0]);
    }
    if (!dates.length) return settingsMessage(next.settings);
    return `log: ${dates.sort().join(', ')}${withSettings ? ' + ustawienia' : ''}`;
  }

  // ---------- configuration ----------

  function readJson(key) {
    try { return JSON.parse(readLocal(key) || 'null'); } catch (_) { return null; }
  }

  // Sync only when set up on purpose: this browser's settings first, then config.js.
  function getConfig() {
    const sources = [readJson(KEY_GITHUB), typeof window !== 'undefined' ? window.WERCIA_CONFIG : null];
    for (const c of sources) {
      if (c && typeof c.owner === 'string' && c.owner.trim() && typeof c.repo === 'string' && c.repo.trim()) {
        return {
          owner: c.owner.trim(),
          repo: c.repo.trim(),
          branch: (typeof c.branch === 'string' && c.branch.trim()) || 'main',
          path: ((typeof c.path === 'string' && c.path.trim()) || (typeof c.dataPath === 'string' && c.dataPath.trim()) || 'data/wercia.json').replace(/^\/+/, '')
        };
      }
    }
    return null;
  }

  function saveConfig(cfg) {
    writeLocal(KEY_GITHUB, JSON.stringify({
      owner: cfg.owner.trim(),
      repo: cfg.repo.trim(),
      branch: (cfg.branch || '').trim() || 'main',
      path: ((cfg.path || '').trim() || 'data/wercia.json').replace(/^\/+/, '')
    }));
  }

  const getToken = () => (readLocal(KEY_TOKEN) || '').trim();

  function fileUrl(cfg) {
    const path = cfg.path.split('/').map(encodeURIComponent).join('/');
    return `https://github.com/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/blob/${encodeURIComponent(cfg.branch)}/${path}`;
  }

  // ---------- GitHub Contents API ----------

  function decodeBase64(b64) {
    const bin = atob(b64.replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function encodeBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }

  function contentsUrl(cfg) {
    const path = cfg.path.split('/').map(encodeURIComponent).join('/');
    return `${API}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${path}`;
  }

  async function httpError(res, cfg, method) {
    let detail = '';
    try { detail = (await res.json()).message || ''; } catch (_) { /* body isn't JSON */ }
    const s = res.status;
    if (s === 401) {
      return new StoreError('auth', 'GitHub odrzucił token (401). Mógł wygasnąć albo został wklejony z błędem. Wklej nowy w ustawieniach.', s);
    }
    if (s === 429 || (s === 403 && (res.headers.get('x-ratelimit-remaining') === '0' || /rate limit/i.test(detail)))) {
      return new StoreError('rate', 'Limit zapytań do GitHuba na tę godzinę się wyczerpał. Wpisy czekają w telefonie i pójdą później.', s);
    }
    if (s === 403) {
      return new StoreError('forbidden', `Token nie ma dostępu do ${cfg.owner}/${cfg.repo}. Potrzebne: Only select repositories → ${cfg.repo} i Contents: Read and write.`, s);
    }
    if (s === 404) {
      const where = `${cfg.path} w ${cfg.owner}/${cfg.repo} (gałąź ${cfg.branch})`;
      return new StoreError('not-found', method === 'GET'
        ? `Nie ma jeszcze pliku ${where}. Pierwszy zapis go utworzy.`
        : `Nie można zapisać do ${where}. Sprawdź nazwę repozytorium i gałęzi oraz dostęp tokenu.`, s);
    }
    if (s === 409 || (s === 422 && /sha/i.test(detail))) {
      return new StoreError('conflict', 'Plik na GitHubie zmienił się w trakcie zapisu.', s);
    }
    if (s === 422) return new StoreError('invalid', `GitHub odrzucił zapis: ${detail || 'nieprawidłowe dane'}.`, s);
    return new StoreError('http', `GitHub zwrócił błąd ${s}${detail ? `: ${detail}` : ''}.`, s);
  }

  async function request(cfg, method, body) {
    const headers = { Accept: 'application/vnd.github+json' };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body) headers['Content-Type'] = 'application/json';
    const url = contentsUrl(cfg) + (method === 'GET' ? `?ref=${encodeURIComponent(cfg.branch)}` : '');
    let res;
    try {
      res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    } catch (_) {
      throw new StoreError('network', 'Brak internetu. Wpisy są zapisane w telefonie i pójdą, gdy wróci połączenie.');
    }
    if (res.ok) return res.json();
    throw await httpError(res, cfg, method);
  }

  async function fetchFile(cfg) {
    const json = await request(cfg, 'GET');
    if (Array.isArray(json) || json.type !== 'file') {
      throw new StoreError('invalid', `${cfg.path} w repozytorium nie jest plikiem.`);
    }
    if (typeof json.content !== 'string' || (json.content === '' && json.size > 0)) {
      throw new StoreError('invalid', `${cfg.path} jest za duży dla GitHub Contents API (limit 1 MB).`);
    }
    return { data: parse(decodeBase64(json.content), cfg.path), sha: json.sha };
  }

  function putFile(cfg, text, sha, message) {
    const body = { message, content: encodeBase64(text), branch: cfg.branch };
    if (sha) body.sha = sha;
    return request(cfg, 'PUT', body);
  }

  // ---------- state ----------

  const state = {
    mode: 'local', // 'local' | 'github' | 'demo'
    data: normalize({}),
    sha: null,
    error: null, // last problem reading the GitHub file
    sync: { status: 'idle', error: null, at: 0 }, // idle | pending | syncing | offline | error
    savedAt: 0,
    loadedAt: 0,
    storageOk: true
  };

  const listeners = new Set();
  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
  function emit(kind) {
    listeners.forEach((fn) => {
      try { fn(kind); } catch (err) { console.error(err); }
    });
  }

  const readOutbox = () => {
    const box = readJson(KEY_OUTBOX);
    return Array.isArray(box) ? box : [];
  };
  const writeOutbox = (ops) => writeLocal(KEY_OUTBOX, ops.length ? JSON.stringify(ops) : null);

  function writeData(next) {
    state.data = next;
    state.storageOk = writeLocal(KEY_DATA, serialize(next));
    state.savedAt = Date.now();
  }

  function readLocalData() {
    const text = readLocal(KEY_DATA);
    if (!text) return null;
    try {
      return parse(text, 'Zapis w przeglądarce');
    } catch (_) {
      // Never throw away what can't be read: park it under another key and start clean.
      writeLocal(`${KEY_DATA}.broken-${Date.now()}`, text);
      return null;
    }
  }

  let generation = 0; // bumped on connect/disconnect/reset, so a send in flight can tell it's stale
  let syncTimer = 0;
  let retryTimer = 0;
  let syncPromise = null;
  let syncAgain = false;

  function setSync(status, error) {
    state.sync = { status, error: error || null, at: Date.now() };
  }

  function scheduleSync(delay) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { syncNow(); }, delay == null ? 1200 : delay);
  }

  function syncNow() {
    if (state.mode !== 'github') return Promise.resolve();
    clearTimeout(syncTimer);
    if (syncPromise) {
      syncAgain = true;
      return syncPromise;
    }
    syncPromise = runSync().finally(() => {
      syncPromise = null;
      if (syncAgain) {
        syncAgain = false;
        if (readOutbox().length) scheduleSync(150);
      }
    });
    return syncPromise;
  }

  async function runSync() {
    const cfg = getConfig();
    if (!cfg) return;
    if (!getToken()) {
      if (readOutbox().length) {
        setSync('error', new StoreError('auth', 'Wklej token GitHuba w ustawieniach, żeby wpisy poszły na GitHuba.'));
        emit('sync');
      }
      return;
    }
    const gen = generation;
    if (!readOutbox().length) {
      setSync('idle');
      return;
    }
    setSync('syncing');
    emit('sync');
    try {
      for (let attempt = 1; ; attempt++) {
        let fresh;
        try {
          fresh = await fetchFile(cfg);
        } catch (err) {
          if (err.kind !== 'not-found') throw err;
          fresh = { data: normalize({}), sha: null };
        }
        if (gen !== generation) return;
        const ops = readOutbox();
        const next = ops.reduce(applyOp, fresh.data);
        let sha = fresh.sha;
        if (!fresh.sha || serialize(next) !== serialize(fresh.data)) {
          try {
            const res = await putFile(cfg, serialize(next), fresh.sha, commitMessage(ops, next));
            sha = res && res.content ? res.content.sha : null;
          } catch (err) {
            if (err.kind === 'conflict' && attempt < 4) {
              await sleep(400 * attempt);
              continue;
            }
            throw err;
          }
        }
        if (gen !== generation) return;
        const rest = readOutbox().slice(ops.length); // changes made while this one was on its way
        writeOutbox(rest);
        state.sha = sha;
        state.error = null;
        writeData(rest.reduce(applyOp, next));
        setSync(rest.length ? 'pending' : 'idle');
        emit('sync');
        if (rest.length) scheduleSync(300);
        return;
      }
    } catch (err) {
      if (gen !== generation) return;
      const offline = err.kind === 'network' || err.kind === 'rate';
      setSync(offline ? 'offline' : 'error', err);
      emit('sync');
      if (offline) {
        clearTimeout(retryTimer);
        retryTimer = setTimeout(() => { syncNow(); }, 30000);
      }
    }
  }

  // ---------- public operations ----------

  async function load() {
    if (state.mode === 'demo') return state;
    state.data = readLocalData() || normalize({});
    const cfg = getConfig();
    // A public repo reads without a token, so anyone with the link sees the data; writing needs one.
    if (cfg) {
      state.mode = 'github';
      try {
        const file = await fetchFile(cfg);
        const ops = readOutbox();
        state.sha = file.sha;
        state.error = null;
        writeData(ops.reduce(applyOp, file.data));
        setSync(ops.length ? 'pending' : 'idle');
        if (ops.length) scheduleSync(300);
      } catch (err) {
        state.error = err.kind === 'not-found' ? null : err;
        if (err.kind === 'not-found' && readOutbox().length) scheduleSync(300);
        if (err.kind === 'network') setSync('offline', err);
      }
    } else {
      state.mode = 'local';
      state.error = null;
    }
    state.loadedAt = Date.now();
    return state;
  }

  // Back to the tab: pick up what changed elsewhere, or send what's waiting.
  async function refresh() {
    if (state.mode !== 'github') return false;
    if (readOutbox().length) {
      await syncNow();
      return true;
    }
    const before = serialize(state.data);
    await load();
    emit('load');
    return serialize(state.data) !== before;
  }

  function change(op) {
    if (state.mode === 'demo') {
      state.data = applyOp(state.data, op);
      state.savedAt = Date.now();
      emit('change');
      return;
    }
    writeData(applyOp(state.data, op));
    if (state.mode === 'github') {
      writeOutbox([...readOutbox(), op]);
      setSync('pending');
      scheduleSync();
    }
    emit('change');
  }

  // set: fields to write, unset: fields to remove. Only these fields are touched.
  function setEntry(date, set, unset) {
    change({ op: 'entry', date, set: set || {}, unset: unset || [] });
  }

  const deleteEntry = (date) => change({ op: 'delete', date });
  const saveSettings = (set) => change({ op: 'settings', set });

  // The first-visit form: goals plus today's weight as the first entry.
  function setup(v) {
    const today = U.todayKey();
    change({
      op: 'settings',
      set: {
        name: v.name, startDate: today, startWeight: v.weight, targetWeight: v.targetWeight,
        targetDate: v.targetDate, kcalTarget: v.kcalTarget, weeklyTrainings: v.weeklyTrainings, trainings: v.trainings
      }
    });
    setEntry(today, { weight: v.weight });
    try {
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    } catch (_) { /* best effort */ }
  }

  const needsSetup = () => state.mode !== 'demo' && !isSetUp(state.data.settings);
  // Reading the repo file needs no token, writing to it does.
  const canWrite = () => state.mode !== 'github' || !!getToken();

  function exportText() {
    return serialize(state.data);
  }

  function importText(text) {
    const data = parse(text, 'Plik');
    if (!isSetUp(data.settings) && !data.entries.length) {
      throw new StoreError('parse', 'W pliku nie ma ani celów, ani wpisów.');
    }
    change({ op: 'replace', data });
    return data;
  }

  async function connect(cfg, token) {
    saveConfig(cfg);
    if (token) writeLocal(KEY_TOKEN, token.trim());
    generation++;
    clearTimeout(syncTimer);
    if (state.mode === 'demo') exitDemo();
    const local = state.data;
    state.mode = 'github';
    let remote = null;
    try {
      remote = await fetchFile(getConfig());
    } catch (err) {
      if (err.kind !== 'not-found') {
        state.error = err;
        emit('load');
        return { error: err };
      }
    }
    const pending = readOutbox();
    const ops = [];
    if (isSetUp(local.settings) || local.entries.length) {
      const empty = !remote || (!isSetUp(remote.data.settings) && !remote.data.entries.length);
      ops.push(empty
        ? { op: 'replace', data: local }
        : { op: 'merge', settings: isSetUp(local.settings) ? local.settings : null, entries: local.entries });
    }
    writeOutbox([...ops, ...pending]);
    state.sha = remote ? remote.sha : null;
    state.error = null;
    writeData(readOutbox().reduce(applyOp, remote ? remote.data : normalize({})));
    setSync(readOutbox().length ? 'pending' : 'idle');
    if (readOutbox().length) await syncNow();
    emit('load');
    return { error: state.sync.status === 'error' ? state.sync.error : null, entries: state.data.entries.length };
  }

  // Stop syncing on this device. Data stays here; unsent changes stay queued for next time.
  function disconnect() {
    generation++;
    clearTimeout(syncTimer);
    clearTimeout(retryTimer);
    writeLocal(KEY_TOKEN, null);
    state.mode = 'local';
    state.sha = null;
    state.error = null;
    setSync('idle');
    emit('load');
  }

  // Wipe everything this page stored in the browser.
  function resetAll() {
    generation++;
    clearTimeout(syncTimer);
    clearTimeout(retryTimer);
    try {
      Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => localStorage.removeItem(k));
    } catch (_) { /* ignore */ }
    Object.assign(state, { mode: 'local', data: normalize({}), sha: null, error: null });
    setSync('idle');
    emit('load');
  }

  // ---------- demo (?demo in the address) ----------

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function demoData(today) {
    const end = today || U.todayKey();
    const rnd = mulberry32(20260929);
    const DAYS = 63;
    const start = U.addDays(end, -(DAYS - 1));
    const settings = normalizeSettings({
      name: 'Wercia', startDate: start, startWeight: 64, targetWeight: 58, targetDate: U.addDays(start, 150),
      kcalTarget: 1750, proteinTarget: 115, fatTarget: 55, carbsTarget: 200,
      weeklyTrainings: 3, trainings: DEFAULT_TRAININGS.slice()
    });
    const missed = new Set([8, 21, 22, 40]);
    const plan = { 0: 'FBW A', 2: 'FBW B', 4: 'FBW A' };
    const entries = [];
    for (let i = 0; i < DAYS; i++) {
      const r = [rnd(), rnd(), rnd(), rnd(), rnd(), rnd()];
      if (missed.has(i)) continue;
      const date = U.addDays(start, i);
      const wd = U.weekdayIndex(date);
      const isToday = i === DAYS - 1;
      const e = { date };
      if (r[0] > 0.08 || isToday) {
        e.weight = Math.round((64.1 - 0.042 * i + (r[1] - 0.5) * 0.6 + (wd === 0 ? 0.25 : 0)) * 10) / 10;
      }
      if (!isToday) {
        const party = wd >= 5 && r[2] < 0.3;
        e.kcal = Math.round((party ? 2150 + r[3] * 400 : 1620 + r[3] * 240) / 10) * 10;
        if (plan[wd] && r[4] < 0.85) e.training = plan[wd];
        e.mood = U.clamp(Math.round(3.5 + (r[5] - 0.5) * 2.2 + (e.training ? 0.5 : 0)), 1, 5);
        e.sleep = Math.round((6.4 + r[5] * 2) * 4) / 4;
        if (r[2] > 0.25) e.sleepScore = U.clamp(Math.round(58 + r[5] * 34), 40, 97);
        // Macros on most days from the day's existing draws, so the other fields stay as they were.
        // Carbs fill the rest of the calories.
        if (r[0] > 0.2) {
          e.protein = Math.round(95 + r[4] * 35 - (party ? 10 : 0));
          e.fat = Math.round(45 + r[1] * 20 + (party ? 20 : 0));
          e.carbs = Math.max(60, Math.round((e.kcal - 4 * e.protein - 9 * e.fat) / 4));
        }
      }
      entries.push(e);
    }
    const note = (test, text) => {
      const e = entries.find(test);
      if (e && !e.note) e.note = text;
    };
    note((e) => e.training === 'FBW A' && U.diffDays(start, e.date) >= 10, 'Hip thrust 60 kg × 8, rekord.');
    note((e) => e.kcal >= 2200, 'Urodziny u Oli.');
    return normalize({ settings, entries });
  }

  let beforeDemo = null;

  function enterDemo() {
    if (state.mode !== 'demo') beforeDemo = { mode: state.mode, data: state.data, sha: state.sha, error: state.error };
    Object.assign(state, { mode: 'demo', data: demoData(), sha: null, error: null });
  }

  function exitDemo() {
    if (state.mode !== 'demo') return;
    Object.assign(state, beforeDemo || { mode: 'local', data: readLocalData() || normalize({}), sha: null, error: null });
    beforeDemo = null;
  }

  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('online', () => { if (readOutbox().length) syncNow(); });
  }

  DF.store = {
    ENTRY_FIELDS, MACRO_TARGETS, LIMITS, DEFAULT_TRAININGS, StoreError, state,
    load, refresh, onChange, setEntry, deleteEntry, saveSettings, setup, needsSetup, isSetUp, canWrite,
    exportText, importText, connect, disconnect, resetAll, syncNow, enterDemo, exitDemo,
    getConfig, getToken, fileUrl, pendingCount: () => readOutbox().length,
    normalize, normalizeSettings, cleanEntry, serialize, parse, applyOp, entryMessage, settingsMessage, commitMessage, demoData
  };
})(window.DF = window.DF || {});
