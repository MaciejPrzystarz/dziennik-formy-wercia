/* Tests for web/wercia/js/stats.js */
(function () {
  'use strict';

  const { test, assert } = DFTest;
  const U = DF.utils;
  const S = DF.stats;
  const settings = (patch) => DF.store.normalizeSettings(Object.assign({
    name: 'Wercia', startDate: '2026-09-28', startWeight: 64, targetWeight: 58, targetDate: '2027-02-28',
    kcalTarget: 1750, weeklyTrainings: 3, trainings: ['FBW A', 'FBW B']
  }, patch));

  // Consecutive days from `from`, one entry per item of `values` (null skips a day).
  function daily(from, values, make) {
    return values
      .map((v, i) => (v == null ? null : Object.assign({ date: U.addDays(from, i) }, make(v, i))))
      .filter(Boolean);
  }

  test('movingAverage: 7 calendar days, missing days ignored', () => {
    const ma = S.movingAverage([
      { date: '2026-10-01', weight: 60 },
      { date: '2026-10-03', weight: 62 },
      { date: '2026-10-08', weight: 64 }
    ]);
    assert.equal(ma.get('2026-10-02'), 60);
    assert.equal(ma.get('2026-10-07'), 61);
    assert.equal(ma.get('2026-10-08'), 63, '10-01 fell out of the window');
  });

  test('slope: exact on a straight line, null with too few weigh-ins', () => {
    const line = daily('2026-10-01', [64, 63.9, 63.8, 63.7, 63.6, 63.5, 63.4, 63.3], (w) => ({ weight: w }));
    assert.near(S.slope(line, '2026-10-08', 21), -0.1, 1e-9);
    assert.equal(S.slope(line.slice(0, 4), '2026-10-04', 21), null);
  });

  test('progress and plates: 6 kg goal is 6 plates', () => {
    const s = settings({});
    const p = S.progress([{ date: '2026-09-30', weight: 61.5 }], s);
    assert.equal(p.lost, 2.5);
    assert.equal(p.left, 3.5);
    const pl = S.plates(p);
    assert.equal(pl.count, 6);
    assert.equal(pl.full, 2);
    assert.near(pl.partial, 0.5);
  });

  test('streaks: today without an entry does not break the streak yet', () => {
    const entries = daily('2026-09-20', [1, 1, 1, 1, 1, null, null, null, 1, 1], () => ({ mood: 3 }));
    const st = S.streaks(entries, '2026-09-30');
    assert.equal(st.current, 2);
    assert.equal(st.best, 5);
  });

  test('weeks: macros averaged per week', () => {
    const w = S.weeks([
      { date: '2026-09-14', weight: 64 },
      { date: '2026-09-28', weight: 63, kcal: 1700, protein: 100, fat: 50 },
      { date: '2026-09-29', weight: 62.8, kcal: 1800, protein: 120, training: 'FBW A' }
    ], '2026-09-30');
    assert.equal(w.length, 3);
    assert.equal(w[1].logged, 0);
    assert.equal(w[2].macros.protein.avg, 110);
    assert.deepEqual(w[2].macros.fat, { avg: 50, count: 1 });
    assert.equal(w[2].macros.carbs, null);
    assert.equal(w[0].macros, null);
  });

  test('kcalState: 85–105% of the target is on target', () => {
    assert.equal(S.kcalState(1500, 1750), 'ok');
    assert.equal(S.kcalState(1480, 1750), 'under');
    assert.equal(S.kcalState(1840, 1750), 'over');
  });

  test('macroKcal: 4/9/4 kcal per gram, needs all three', () => {
    assert.equal(S.macroKcal({ protein: 110, fat: 55, carbs: 200 }), 1735);
    assert.equal(S.macroKcal({ protein: 110, fat: 55 }), null);
  });

  test('macroSummary: last 7 days only', () => {
    const m = S.macroSummary([
      { date: '2026-09-20', protein: 200 },
      { date: '2026-09-28', protein: 100 },
      { date: '2026-09-30', protein: 120, carbs: 180 }
    ], '2026-09-30');
    assert.equal(m.days, 2);
    assert.equal(m.protein.avg, 110);
    assert.equal(m.carbs.avg, 180);
  });

  test('sleepSummary: counts nights with hours', () => {
    const s = S.sleepSummary([{ date: '2026-09-29', sleep: 6 }, { date: '2026-09-30', sleepScore: 80 }], '2026-09-30');
    assert.equal(s.nights, 1);
    assert.equal(s.hours, 6);
    assert.equal(s.score, 80);
  });

  // Ten days from Tue 2026-09-01: even days short night, low mood, more food and a training;
  // odd days the opposite. One old entry falls outside the 90-day window.
  function patternData() {
    const days = daily('2026-09-01', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], (i) => {
      const even = i % 2 === 0;
      const e = { sleep: even ? 6 : 8, mood: even ? 2 : 4, kcal: even ? 2000 : 1700 };
      if (even) e.training = 'FBW A';
      return e;
    });
    return [{ date: '2026-06-01', sleep: 6, mood: 5, kcal: 900 }, ...days];
  }

  test('insights: sleep against mood and food', () => {
    const byId = new Map(S.insights(patternData(), '2026-09-30').map((it) => [it.id, it]));
    const mood = byId.get('sleep-mood');
    assert.ok(mood.ready);
    assert.equal(mood.a.n, 5, 'the June entry is outside the window');
    assert.equal(mood.diff, -2);
    assert.ok(mood.strong);
    assert.equal(byId.get('sleep-kcal').diff, 300);
  });

  test('insights: training compared with the sleep of the next night', () => {
    const it = S.insights(patternData(), '2026-09-30').find((x) => x.id === 'training-sleep');
    assert.ok(it.ready);
    assert.equal(it.a.n, 5);
    assert.equal(it.b.n, 4, 'the last day has no next night yet');
    assert.equal(it.diff, 2);
  });

  test('insights: not ready with fewer than 4 days in a group, weak when the gap is small', () => {
    const weekend = S.insights(patternData(), '2026-09-30').find((x) => x.id === 'weekend-kcal');
    assert.equal(weekend.a.n, 2);
    assert.ok(!weekend.ready);
    assert.equal(weekend.diff, null);
    const flat = daily('2026-09-01', [6, 8, 6, 8, 6, 8, 6, 8], (h) => ({ sleep: h, mood: 3 }));
    const m = S.insights(flat, '2026-09-30').find((x) => x.id === 'sleep-mood');
    assert.ok(m.ready);
    assert.ok(!m.strong);
  });

  test('badges: first entry and kilogram milestones', () => {
    const s = settings({});
    const entries = [{ date: '2026-09-28', weight: 62.5 }];
    const b = new Map(S.badges(entries, s, '2026-09-30', S.progress(entries, s)).map((x) => [x.id, x.unlocked]));
    assert.ok(b.get('first'));
    assert.ok(b.get('kg1'));
    assert.ok(!b.get('kg3'));
  });
})();
