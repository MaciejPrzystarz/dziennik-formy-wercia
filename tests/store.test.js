/* Tests for the data format and changes in web/wercia/js/store.js. The GitHub part isn't covered: it needs the network. */
(function () {
  'use strict';

  const { test, assert } = DFTest;
  const store = DF.store;
  const GOALS = {
    name: 'Wercia', startDate: '2026-09-28', startWeight: 64, targetWeight: 58, targetDate: '2027-02-28',
    kcalTarget: 1750, weeklyTrainings: 3, trainings: ['FBW A', 'FBW B']
  };

  test('cleanEntry: parses, rounds and drops invalid values', () => {
    const e = store.cleanEntry({
      date: '2026-09-28', weight: '62,4', kcal: 1650.6, protein: '110', fat: 55.4, carbs: -5,
      mood: 7, sleep: '7,5', sleepScore: 82, note: '  hej ', extra: 1, empty: '', nothing: null
    });
    assert.deepEqual(e, {
      date: '2026-09-28', weight: 62.4, kcal: 1651, protein: 110, fat: 55,
      sleep: 7.5, sleepScore: 82, note: 'hej', extra: 1
    });
  });

  test('cleanEntry: invalid date, out-of-range weight or nothing but a date', () => {
    assert.equal(store.cleanEntry({ date: '2026-02-30', weight: 60 }), null);
    assert.equal(store.cleanEntry({ date: '2026-09-28' }), null);
    assert.equal(store.cleanEntry({ date: '2026-09-28', weight: 6.24 }), null, 'a typo like 6,24 kg is dropped');
    assert.equal(store.cleanEntry(null), null);
  });

  test('normalizeSettings: before the first-visit form the goals are missing', () => {
    const s = store.normalizeSettings({});
    assert.equal(s.name, 'Wercia');
    assert.equal(s.startWeight, null);
    assert.equal(s.kcalTarget, null);
    assert.deepEqual(s.trainings, ['FBW A', 'FBW B']);
    assert.ok(!store.isSetUp(s));
    assert.ok(store.isSetUp(store.normalizeSettings(GOALS)));
  });

  test('normalizeSettings: ranges shared with the forms', () => {
    assert.equal(store.normalizeSettings({ kcalTarget: 700 }).kcalTarget, null);
    assert.equal(store.normalizeSettings({ kcalTarget: 800 }).kcalTarget, 800);
    assert.equal(store.normalizeSettings({ weeklyTrainings: 15 }).weeklyTrainings, 3);
    assert.deepEqual(store.LIMITS.kcalTarget, [800, 10000]);
  });

  test('normalizeSettings: macro targets are optional', () => {
    const s = store.normalizeSettings(Object.assign({}, GOALS, { proteinTarget: '110', fatTarget: 0, carbsTarget: 'abc', custom: 'x' }));
    assert.equal(s.proteinTarget, 110);
    assert.ok(!('fatTarget' in s), 'zero is not a target');
    assert.ok(!('carbsTarget' in s), 'text is not a target');
    assert.equal(s.custom, 'x', 'unknown settings survive');
  });

  test('serialize: key order, one entry per line', () => {
    const data = store.normalize({
      settings: Object.assign({}, GOALS, { proteinTarget: 110 }),
      entries: [{ date: '2026-09-28', note: 'x', weight: 63.5, protein: 100, kcal: 1700, training: 'FBW A' }]
    });
    const expected = [
      '{',
      '  "settings": {',
      '    "name": "Wercia",',
      '    "startDate": "2026-09-28",',
      '    "startWeight": 64,',
      '    "targetWeight": 58,',
      '    "targetDate": "2027-02-28",',
      '    "kcalTarget": 1750,',
      '    "proteinTarget": 110,',
      '    "weeklyTrainings": 3,',
      '    "trainings": ["FBW A", "FBW B"]',
      '  },',
      '  "entries": [',
      '    {"date": "2026-09-28", "weight": 63.5, "kcal": 1700, "protein": 100, "training": "FBW A", "note": "x"}',
      '  ]',
      '}',
      ''
    ].join('\n');
    assert.equal(store.serialize(data), expected);
  });

  test('serialize and parse round-trip', () => {
    const data = store.demoData('2026-09-30');
    assert.deepEqual(store.parse(store.serialize(data), 'x'), data);
    assert.equal(store.serialize(store.parse(store.serialize(data), 'x')), store.serialize(data));
  });

  test('parse: syntax error is a parse error, empty file is an empty diary', () => {
    let err = null;
    try { store.parse('{"entries": [', 'data/wercia.json'); } catch (e) { err = e; }
    assert.ok(err && err.kind === 'parse');
    assert.deepEqual(store.parse('  ', 'x').entries, []);
  });

  test('applyOp: entry sets and unsets only the given fields', () => {
    let d = store.normalize({ settings: GOALS, entries: [{ date: '2026-09-28', weight: 63, kcal: 1700 }] });
    d = store.applyOp(d, { op: 'entry', date: '2026-09-28', set: { protein: 110 }, unset: ['kcal'] });
    assert.deepEqual(d.entries, [{ date: '2026-09-28', weight: 63, protein: 110 }]);
    d = store.applyOp(d, { op: 'entry', date: '2026-09-27', set: { mood: 4 } });
    assert.equal(d.entries[0].date, '2026-09-27', 'new entries are sorted in');
    d = store.applyOp(d, { op: 'delete', date: '2026-09-27' });
    assert.equal(d.entries.length, 1);
  });

  test('applyOp: settings with null removes a macro target', () => {
    let d = store.normalize({ settings: Object.assign({}, GOALS, { proteinTarget: 110, fatTarget: 55 }), entries: [] });
    d = store.applyOp(d, { op: 'settings', set: { proteinTarget: null, carbsTarget: 200 } });
    assert.ok(!('proteinTarget' in d.settings));
    assert.equal(d.settings.fatTarget, 55);
    assert.equal(d.settings.carbsTarget, 200);
  });

  test('applyOp: merge keeps what the file already has', () => {
    const file = store.normalize({ settings: GOALS, entries: [{ date: '2026-09-28', weight: 63 }] });
    const d = store.applyOp(file, {
      op: 'merge', settings: null,
      entries: [{ date: '2026-09-28', weight: 62, protein: 100 }, { date: '2026-09-29', kcal: 1600 }]
    });
    assert.deepEqual(d.entries, [{ date: '2026-09-28', weight: 63, protein: 100 }, { date: '2026-09-29', kcal: 1600 }]);
  });

  test('entryMessage: commit message as described in CLAUDE.md', () => {
    const e = {
      date: '2026-09-28', weight: 62.4, kcal: 1650, protein: 110, fat: 55, carbs: 200,
      training: 'FBW A', mood: 4, sleep: 7.5, sleepScore: 82, note: 'x'
    };
    assert.equal(store.entryMessage(e, e.date),
      'log: 2026-09-28 (62.4 kg, 1650 kcal, B 110 g, T 55 g, W 200 g, FBW A, 4/5, 7.5 h snu, sen 82/100)');
    assert.equal(store.entryMessage({ date: '2026-09-28', note: 'x' }, '2026-09-28'), 'log: 2026-09-28 (notatka)');
    assert.equal(store.entryMessage(null, '2026-09-28'), 'log: usuń 2026-09-28');
  });

  test('settingsMessage and commitMessage: macro targets only when set', () => {
    const s = store.normalizeSettings(GOALS);
    assert.equal(store.settingsMessage(s), 'settings: cel 58 kg do 2027-02-28, 1750 kcal, 3 treningi/tydz.');
    assert.equal(store.settingsMessage(store.normalizeSettings(Object.assign({}, GOALS, { proteinTarget: 110, carbsTarget: 200 }))),
      'settings: cel 58 kg do 2027-02-28, 1750 kcal, B 110 g, W 200 g, 3 treningi/tydz.');
    const next = store.normalize({ settings: GOALS, entries: [{ date: '2026-09-28', kcal: 1700 }, { date: '2026-09-29', mood: 3 }] });
    const ops = [{ op: 'entry', date: '2026-09-29' }, { op: 'entry', date: '2026-09-28' }, { op: 'settings', set: {} }];
    assert.equal(store.commitMessage(ops, next), 'log: 2026-09-28, 2026-09-29 + ustawienia');
  });

  test('demoData: stable, nine weeks, every entry already clean, with macros', () => {
    const a = store.demoData('2026-09-30');
    assert.equal(JSON.stringify(a), JSON.stringify(store.demoData('2026-09-30')));
    assert.equal(a.entries[a.entries.length - 1].date, '2026-09-30');
    a.entries.forEach((e) => assert.deepEqual(store.cleanEntry(e), e, e.date));
    assert.ok(a.entries.some((e) => DF.stats.macroKcal(e) != null), 'demo has macros');
    assert.ok(a.entries.every((e) => !e.training || a.settings.trainings.includes(e.training)), 'only trainings from the settings');
  });
})();
