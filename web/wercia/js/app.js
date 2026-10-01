/* Dziennik formy Wercii: the UI. Data from DF.store, numbers from DF.stats. */
(function (DF) {
  'use strict';

  const U = DF.utils;
  const S = DF.stats;
  const store = DF.store;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = U.escapeHtml;

  const MOODS = [
    null,
    { emoji: '😭', label: 'Dramat' },
    { emoji: '😒', label: 'Meh' },
    { emoji: '😐', label: 'OK' },
    { emoji: '😊', label: 'Dobrze' },
    { emoji: '😈', label: 'Bestia' }
  ];
  const WEEKDAYS_LONG = ['poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota', 'niedziela'];
  const TRAINING_COLORS = ['pink', 'red', 'blue', 'black', 'white', 'blush'];
  const BADGE_COLORS = { steel: 'black', red: 'red', blue: 'blue', green: 'pink', yellow: 'blush', white: 'white' };
  const BADGE_COPY = {
    petarda: { title: 'Bestia 5×', desc: 'Pięć dni z samopoczuciem „bestia”' },
    notes: { title: 'Kronikarka' },
    allTypes: { title: 'Wszechstronna' }
  };
  const SEEN_KEY = 'wercia.seen';
  const RANGE_KEY = 'wercia.range';
  const HEAT_WEEKS = 20;
  const HEART = '<svg aria-hidden="true" viewBox="0 0 24 22"><use href="#i-heart"/></svg>';

  const ui = {
    vm: null,
    range: 30,
    logLimit: 21,
    weekLimit: 6,
    snap: null,
    today: null,
    savedThisVisit: false,
    lastWeightDate: null,
    updateTimer: 0,
    dashboardStale: false,
    deleteArmed: false,
    deleteTimer: 0,
    resetArmed: false,
    resetTimer: 0,
    importText: null,
    renderedText: ''
  };

  const entrySheet = $('#entry-sheet');
  const settingsSheet = $('#settings-sheet');
  let todayForm = null;
  let sheetForm = null;

  // ---------- model ----------

  function compute() {
    const { settings, entries } = store.state.data;
    const today = U.todayKey();
    const prog = S.progress(entries, settings);
    const latest = S.latestWeight(entries);
    const asOf = latest ? latest.date : today;
    const slopeDay = S.slope(entries, today, 21);
    const plan = S.planWeightAt(settings, asOf);
    const vm = {
      settings, entries, today, prog, latest, slopeDay, plan,
      planDiff: prog.trend != null ? prog.trend - plan : null,
      streak: S.streaks(entries, today),
      week: S.weekSummary(entries, today),
      kcal: S.kcalSummary(entries, today, settings.kcalTarget),
      mood: S.moodSummary(entries, today),
      sleep: S.sleepSummary(entries, today),
      macros: S.macroSummary(entries, today),
      pl: S.plates(prog),
      eta: S.eta(prog.trend, settings.targetWeight, slopeDay, asOf),
      badges: S.badges(entries, settings, today, prog).map((b) =>
        Object.assign({}, b, BADGE_COPY[b.id] || {}, { color: BADGE_COLORS[b.color] || 'pink' })),
      insights: S.insights(entries, today),
      byDate: new Map(entries.map((e) => [e.date, e]))
    };
    vm.coach = coachLine(vm);
    return vm;
  }

  // One line in the speech bubble, most important first. Sassy about the plan, never about her.
  function coachLine(c) {
    const s = c.settings;
    if (!c.entries.length) return 'Pusta sztanga. Wpisz dzisiejszą wagę i zaczynamy.';
    if (c.prog.trend != null && c.prog.trend <= s.targetWeight) {
      return `Cel ${U.fmt1(s.targetWeight)} kg zdobyty. Nowy ustawisz w ustawieniach.`;
    }
    if (S.isNewLow(c.entries, c.today)) return 'Najniższa waga od startu. Groźna jesteś.';
    if (c.mood && c.mood.count >= 3 && c.mood.avg <= 2.5) {
      return 'Samopoczucie od tygodnia słabe. Lżejszy tydzień to nie porażka, sen i jedzenie też się liczą.';
    }
    if (c.slopeDay != null && c.prog.trend && (-c.slopeDay * 7) / c.prog.trend > 0.01) {
      return 'Tempo ponad 1% masy ciała na tydzień. Szybciej, niż trzeba, więc jedz do celu i dbaj o regenerację.';
    }
    if (c.kcal && c.kcal.logged >= 4 && c.kcal.avg > s.kcalTarget * 1.05) {
      return `Średnia kalorii z 7 dni jest ${U.fmtInt(c.kcal.avg - s.kcalTarget)} kcal nad celem. Jutro wracamy do planu.`;
    }
    if (c.kcal && c.kcal.logged >= 4 && c.kcal.avg < s.kcalTarget * 0.85) {
      return `Średnia kalorii jest ${U.fmtInt(s.kcalTarget - c.kcal.avg)} kcal poniżej celu. Za mało jedzenia też spowalnia, dobijaj do celu.`;
    }
    if (c.sleep && c.sleep.nights >= 4 && c.sleep.hours < S.SLEEP_GOOD - 0.5) {
      return `Średnio ${U.fmt1(c.sleep.hours)} h snu z ostatnich nocy. Krótki sen podkręca głód i zabiera siłę, więc dziś wcześniej do łóżka.`;
    }
    const p = c.macros && c.macros.protein;
    if (s.proteinTarget && p && p.count >= 4 && p.avg < s.proteinTarget * 0.85) {
      return `Białko średnio ${U.fmtInt(p.avg)} g przy celu ${U.fmtInt(s.proteinTarget)} g. Na redukcji to ono chroni mięśnie.`;
    }
    if (s.weeklyTrainings > 0 && c.week.trainings.length >= s.weeklyTrainings) {
      return 'Wszystkie treningi z tego tygodnia odhaczone. Bestia.';
    }
    if (c.streak.current >= 7) return `${c.streak.current} dni z wpisem bez przerwy. Nikt Cię nie zatrzyma.`;
    if (c.planDiff != null && c.planDiff <= -0.1) return `Jesteś ${U.fmt1(-c.planDiff)} kg przed planem. Tak się to robi.`;
    return 'Waga skacze z dnia na dzień przez wodę i jedzenie. Liczy się średnia z 7 dni, nie jeden poranek.';
  }

  function trainingColor(name, settings) {
    const i = settings.trainings.indexOf(name);
    return i >= 0 && i < TRAINING_COLORS.length ? TRAINING_COLORS[i] : 'blush';
  }

  const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const entryFor = (date) => store.state.data.entries.find((e) => e.date === date) || null;
  const moodOf = (n) => MOODS[U.clamp(Math.round(n), 1, 5)];

  // "B 110 · T 55 · W 200 g", only the macros that are there.
  function macroLine(src) {
    const parts = S.MACROS.filter(({ key }) => src && src[key] != null).map(({ key, short }) => `${short} ${U.fmtInt(src[key])}`);
    return parts.length ? `${parts.join(' · ')} g` : '';
  }

  const macroAvgs = (m) => ({ protein: m.protein && m.protein.avg, fat: m.fat && m.fat.avg, carbs: m.carbs && m.carbs.avg });
  const macroGoals = (s) => ({ protein: s.proteinTarget, fat: s.fatTarget, carbs: s.carbsTarget });

  function entrySummary(e) {
    const parts = [];
    if (typeof e.weight === 'number') parts.push(`${U.fmtWeight(e.weight)} kg`);
    if (typeof e.kcal === 'number') parts.push(`${U.fmtInt(e.kcal)} kcal`);
    if (S.isTraining(e)) parts.push(e.training);
    if (!parts.length && S.hasMacros(e)) parts.push(macroLine(e));
    if (!parts.length && e.mood) parts.push(`samopoczucie ${MOODS[e.mood].label.toLowerCase()}`);
    if (!parts.length && typeof e.sleep === 'number') parts.push(`sen ${U.fmtHours(e.sleep)} h`);
    if (!parts.length) parts.push('notatka');
    return parts.join(', ');
  }

  // Everything logged for a day, for the heatmap caption.
  function dayDetails(e) {
    const parts = [S.isTraining(e) ? e.training : 'odpoczynek'];
    if (typeof e.weight === 'number') parts.push(`${U.fmtWeight(e.weight)} kg`);
    if (typeof e.kcal === 'number') parts.push(`${U.fmtInt(e.kcal)} kcal`);
    if (S.hasMacros(e)) parts.push(macroLine(e));
    if (e.mood) parts.push(`samopoczucie ${MOODS[e.mood].emoji} ${MOODS[e.mood].label.toLowerCase()}`);
    if (typeof e.sleep === 'number') parts.push(`sen ${U.fmtHours(e.sleep)} h`);
    if (typeof e.sleepScore === 'number') parts.push(`ocena snu ${e.sleepScore}/100`);
    return parts.join(', ');
  }

  // ---------- dashboard ----------

  function render(vm, anim) {
    document.body.classList.remove('is-loading');
    ui.renderedText = store.serialize(store.state.data);
    renderChrome(vm);
    renderStage(vm, anim);
    renderTodayHead(vm);
    renderWeek(vm);
    renderCharts(vm);
    renderWeeks(vm);
    renderHeatmap(vm);
    renderInsights(vm);
    renderBadges(vm);
    renderLog(vm);
    renderSaveStates();
  }

  function renderChrome(vm) {
    const n = vm.streak.current;
    const streak = $('#streak');
    streak.hidden = n < 2;
    streak.textContent = `🔥 ${n} ${n === 1 ? 'dzień' : 'dni'}`;
    streak.title = `Dni z wpisem bez przerwy. Rekord: ${vm.streak.best}.`;
    const writable = store.canWrite();
    $('#today').hidden = !writable;
    $('#fab').hidden = !writable;
    renderBanner();
  }

  function renderBanner() {
    const st = store.state;
    let text = '';
    let label = '';
    let action = null;
    let kind = 'info';
    if (st.mode === 'demo') {
      text = 'Przykładowe dane. Zmiany nie zostaną zapisane.';
      label = 'Zamknij podgląd';
      action = () => { location.href = location.pathname; };
    } else if (st.mode === 'github' && (st.error || st.sync.status === 'error')) {
      const err = st.error || st.sync.error;
      kind = 'error';
      text = `Wpisy są zapisane tutaj, ale nie idą na GitHuba. ${err ? err.message : ''}`;
      label = 'Ustawienia';
      action = openSettings;
    } else if (!store.canWrite()) {
      text = 'Tylko podgląd. Dodaj token w ustawieniach, żeby zapisywać.';
      label = 'Ustawienia';
      action = openSettings;
    }
    const banner = $('#banner');
    banner.hidden = !text;
    banner.className = `banner is-${kind}`;
    $('#banner-text').textContent = text;
    const btn = $('#banner-action');
    btn.textContent = label;
    btn.hidden = !action;
    btn.onclick = action;
  }

  function renderStage(vm, anim) {
    const s = vm.settings;
    $('#hello').textContent = `Hej, ${s.name || 'Wercia'}.`;
    $('#today-line').textContent = `${capitalize(WEEKDAYS_LONG[U.weekdayIndex(vm.today)])}, ${U.fmtLong(vm.today, false)}.`;

    DF.barbell.render($('#barbell'), vm.pl, anim);
    $('#barbell-caption').textContent = barbellCaption(vm);

    const showReadout = vm.prog.trend != null && !!vm.latest;
    $('#readout').hidden = !showReadout;
    if (showReadout) {
      $('#trend-weight').innerHTML = `${esc(U.fmt1(vm.prog.trend))}<span class="unit">kg</span>`;
      $('#trend-sub').textContent =
        `średnia z 7 dni, ostatni pomiar ${U.fmtWeight(vm.latest.weight)} kg (${U.fmtRelative(vm.latest.date, vm.today)})`;
      $('#facts').innerHTML = facts(vm)
        .map(([dt, dd, sub]) => `<div><dt>${esc(dt)}</dt><dd>${esc(dd)}</dd><dd class="sub">${esc(sub)}</dd></div>`)
        .join('');
    }
    $('#coach').textContent = vm.coach;
  }

  function barbellCaption(vm) {
    const { pl, prog } = vm;
    const first = Math.abs(pl.per - 1) < 1e-9
      ? 'Każdy zrzucony kilogram to talerz na sztandze.'
      : `Każde zrzucone ${U.fmt1(pl.per)} kg to talerz na sztandze.`;
    if (prog.trend == null) return first;
    if (pl.full >= pl.count) return `${first} Wszystkie talerze założone.`;
    const toNext = Math.max(0.1, (pl.full + 1) * pl.per - Math.max(0, prog.lost));
    return `${first} Założone ${pl.full} z ${pl.count}, następny za ${U.fmt1(toNext)} kg.`;
  }

  function facts(vm) {
    const s = vm.settings;
    const out = [
      ['Zrzucone', `${U.fmt1(Math.max(0, vm.prog.lost))} kg`, `od ${U.fmtWeight(s.startWeight)} kg`],
      ['Zostało', `${U.fmt1(vm.prog.left)} kg`, `do ${U.fmtWeight(s.targetWeight)} kg`]
    ];
    const d = vm.planDiff;
    const planText = Math.abs(d) < 0.1 ? 'równo z planem' : d < 0 ? `${U.fmt1(-d)} kg przed planem` : `${U.fmt1(d)} kg za planem`;
    const planDay = vm.latest.date === vm.today ? 'dziś' : U.fmtShort(vm.latest.date);
    out.push(['Plan', planText, `plan na ${planDay}: ${U.fmt1(vm.plan)} kg`]);

    let eta = 'jeszcze nie wiadomo';
    let etaSub = 'potrzeba pomiarów z 3 tygodni';
    if (vm.prog.trend <= s.targetWeight) {
      eta = 'cel zdobyty';
      etaSub = `średnia poniżej ${U.fmtWeight(s.targetWeight)} kg`;
    } else if (vm.eta) {
      eta = U.fmtLong(vm.eta);
      etaSub = vm.eta > s.targetDate
        ? `${U.fmtWeight(s.targetWeight)} kg, po terminie ${U.fmtLong(s.targetDate)}`
        : `${U.fmtWeight(s.targetWeight)} kg przy obecnym tempie`;
    } else if (vm.slopeDay != null) {
      etaSub = 'średnia z 3 tygodni nie spada';
    }
    out.push(['Prognoza', eta, etaSub]);
    return out;
  }

  function renderTodayHead(vm) {
    $('#today-date').textContent = `${WEEKDAYS_LONG[U.weekdayIndex(vm.today)]}, ${U.fmtLong(vm.today, false)}`;
  }

  function renderWeek(vm) {
    const s = vm.settings;
    const done = vm.week.trainings;
    const slotsCount = Math.max(s.weeklyTrainings, done.length);
    const slots = Array.from({ length: slotsCount }, (_, i) => {
      const e = done[i];
      return e
        ? `<i class="slot t-${trainingColor(e.training, s)}" title="${esc(`${U.fmtDay(e.date)}: ${e.training}`)}"></i>`
        : '<i class="slot is-open"></i>';
    }).join('');
    const left = s.weeklyTrainings - done.length;
    const trainSub = s.weeklyTrainings === 0 ? 'bez celu tygodniowego' : left > 0 ? `jeszcze ${left}` : 'komplet w tym tygodniu';

    const k = vm.kcal;
    const kcalState = k ? S.kcalState(k.avg, s.kcalTarget) : null;
    const kcalValue = k ? `${U.fmtInt(k.avg)}<small>kcal</small>` : '–';
    const kcalSub = k ? `średnia 7 dni, w celu ${k.ok} z ${k.logged} ${k.logged === 1 ? 'dnia' : 'dni'}` : 'brak kalorii z 7 dni';

    const mc = vm.macros;
    const protein = mc && mc.protein;
    const proteinValue = protein ? `${U.fmtInt(protein.avg)}<small>g</small>` : '–';
    const proteinLow = !!(protein && s.proteinTarget && protein.count >= 4 && protein.avg < s.proteinTarget * 0.85);
    const rest = mc ? macroLine({ fat: mc.fat && mc.fat.avg, carbs: mc.carbs && mc.carbs.avg }) : '';
    const proteinSub = !mc
      ? 'brak makro z 7 dni'
      : [s.proteinTarget ? `cel ${U.fmtInt(s.proteinTarget)} g` : 'średnia 7 dni', rest].filter(Boolean).join(', ');

    const perWeek = vm.slopeDay != null ? vm.slopeDay * 7 : null;
    const planDays = Math.max(1, U.diffDays(s.startDate, s.targetDate));
    const planWeek = ((s.targetWeight - s.startWeight) / planDays) * 7;
    const paceValue = perWeek != null ? `${U.signed(perWeek)}<small>kg/tydz.</small>` : '–';
    const paceSub = perWeek != null ? `ostatnie 3 tygodnie, plan ${U.signed(planWeek, U.fmt2)}` : 'za mało pomiarów';

    const m = vm.mood;
    const moodValue = m ? `<span class="emoji" aria-hidden="true">${moodOf(m.avg).emoji}</span>${U.fmt1(m.avg)}` : '–';
    const moodRow = U.dayRange(U.addDays(vm.today, -6), vm.today).map((key) => {
      const e = vm.byDate.get(key);
      return e && e.mood
        ? `<span title="${esc(`${U.fmtDay(key)}: ${MOODS[e.mood].label}`)}">${MOODS[e.mood].emoji}</span>`
        : `<i class="gap" title="${esc(`${U.fmtDay(key)}: brak oceny`)}"></i>`;
    }).join('');

    const sl = vm.sleep;
    const sleepValue = sl && sl.hours != null ? `${U.fmt1(sl.hours)}<small>h</small>` : '–';
    const sleepSub = !sl ? 'brak snu z 7 dni' : sl.score != null ? `średnia 7 dni, ocena ${U.fmtInt(sl.score)}/100` : 'średnia 7 dni';

    $('#week').innerHTML = `
      <div class="stat">
        <p class="stat-label">Treningi w tym tygodniu</p>
        <p class="stat-value">${done.length}<small>/${s.weeklyTrainings}</small></p>
        <div class="slots" aria-hidden="true">${slots}</div>
        <p class="stat-sub">${esc(trainSub)}</p>
      </div>
      <div class="stat">
        <p class="stat-label">Kalorie</p>
        <p class="stat-value${kcalState === 'over' ? ' is-over' : ''}">${kcalValue}</p>
        <p class="stat-sub">${esc(kcalSub)}</p>
      </div>
      <div class="stat">
        <p class="stat-label">Białko</p>
        <p class="stat-value${proteinLow ? ' is-over' : ''}">${proteinValue}</p>
        <p class="stat-sub">${esc(proteinSub)}</p>
      </div>
      <div class="stat">
        <p class="stat-label">Tempo</p>
        <p class="stat-value">${paceValue}</p>
        <p class="stat-sub">${esc(paceSub)}</p>
      </div>
      <div class="stat">
        <p class="stat-label">Samopoczucie</p>
        <p class="stat-value">${moodValue}</p>
        <p class="mood-row" role="img" aria-label="Samopoczucie z ostatnich 7 dni">${moodRow}</p>
      </div>
      <div class="stat">
        <p class="stat-label">Sen</p>
        <p class="stat-value">${sleepValue}</p>
        <p class="stat-sub">${esc(sleepSub)}</p>
      </div>`;
  }

  function renderCharts(vm) {
    if (!vm || !DF.charts.setup()) return;
    $$('#range button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.range === String(ui.range))));
    DF.charts.weight($('#chart-weight'), vm, ui.range);
    DF.charts.kcal($('#chart-kcal'), vm, ui.range);
    DF.charts.macro($('#chart-macro'), vm, ui.range);
    const goals = macroLine(macroGoals(vm.settings));
    $('#macro-note').textContent = goals ? `cel: ${goals}` : '';
    DF.charts.sleep($('#chart-sleep'), vm, ui.range);
    DF.charts.sleepScore($('#chart-sleep-score'), vm, ui.range);
  }

  function weekDelta(delta) {
    if (delta == null) return '';
    const d = Math.round(delta * 10) / 10;
    const title = 'Zmiana średniej wobec poprzedniego tygodnia z pomiarami';
    if (d === 0) return ` <em class="delta" title="${esc(title)}">bez zmian</em>`;
    return ` <em class="delta is-${d < 0 ? 'down' : 'up'}" title="${esc(title)}">${d < 0 ? '▼' : '▲'} ${U.fmt1(Math.abs(d))}</em>`;
  }

  function weekDay(d, vm) {
    const e = d.entry;
    const cls = ['wk-day'];
    if (d.key === vm.today) cls.push('is-today');
    if (d.future) cls.push('is-future');
    else if (!e) cls.push('is-empty');
    const what = e ? entrySummary(e) : d.future ? 'jeszcze przed nami' : 'brak wpisu';
    const label = `${U.fmtDay(d.key)}: ${what}`;
    const weight = e && typeof e.weight === 'number' ? U.fmtWeight(e.weight) : '';
    const marks = e
      ? (S.isTraining(e) ? `<i class="dot t-${trainingColor(e.training, vm.settings)}"></i>` : '') +
        (e.mood ? `<span class="emoji">${MOODS[e.mood].emoji}</span>` : '')
      : '';
    const tag = d.future ? 'div' : 'button';
    const attrs = tag === 'button' ? ` type="button" data-date="${d.key}"` : '';
    return `<${tag} class="${cls.join(' ')}"${attrs} title="${esc(label)}" aria-label="${esc(label)}">` +
      `<span class="wk-num">${U.fromKey(d.key).getDate()}</span>` +
      `<span class="wk-kg">${weight}</span>` +
      `<span class="wk-mark">${marks}</span>` +
      `</${tag}>`;
  }

  function weekCard(w, vm) {
    const s = vm.settings;
    const current = w.start === U.weekStart(vm.today);
    const avg = w.weight ? `${U.fmt1(w.weight.avg)}<small>kg</small>${weekDelta(w.delta)}` : '<span class="none">–</span>';
    const sub = w.weight ? `średnia z ${w.weight.count} ${U.plural(w.weight.count, 'pomiaru', 'pomiarów', 'pomiarów')}` : 'bez pomiarów wagi';
    const kcal = w.kcal
      ? `<span class="kcal-${S.kcalState(w.kcal.avg, s.kcalTarget)}">${U.fmtInt(w.kcal.avg)}<small> kcal/dzień</small></span>`
      : '<span class="none">–</span>';
    const trainings = `${w.trainings.length}${s.weeklyTrainings > 0 ? `<small>/${s.weeklyTrainings}</small>` : ''}`;
    const mood = w.mood ? `<span class="emoji">${moodOf(w.mood.avg).emoji}</span> ${U.fmt1(w.mood.avg)}` : '<span class="none">–</span>';
    const sleepParts = [];
    if (w.sleep) sleepParts.push(`${U.fmt1(w.sleep.avg)}<small> h</small>`);
    if (w.sleepScore) sleepParts.push(`${U.fmtInt(w.sleepScore.avg)}<small>/100</small>`);
    const sleep = sleepParts.length ? sleepParts.join(', ') : '<span class="none">–</span>';
    const macros = w.macros ? esc(macroLine(macroAvgs(w.macros))) : '<span class="none">–</span>';
    return `<article class="wk${current ? ' is-current' : ''}">` +
      '<div class="wk-top">' +
        `<h3 class="wk-range">${U.fmtRange(w.start, w.end)}${current ? '<span class="wk-tag">ten tydzień</span>' : ''}</h3>` +
        `<p class="wk-avg">${avg}</p>` +
        `<p class="wk-sub">${esc(sub)}</p>` +
      '</div>' +
      `<div class="wk-days">${w.days.map((d) => weekDay(d, vm)).join('')}</div>` +
      '<dl class="wk-facts">' +
        `<div><dt>Kalorie</dt><dd>${kcal}</dd></div>` +
        `<div><dt>Makro</dt><dd title="Białko, tłuszcze, węgle: średnia na dzień">${macros}</dd></div>` +
        `<div><dt>Treningi</dt><dd>${trainings}</dd></div>` +
        `<div><dt>Samopoczucie</dt><dd>${mood}</dd></div>` +
        `<div><dt>Sen</dt><dd>${sleep}</dd></div>` +
        `<div><dt>Wpisy</dt><dd>${w.logged}<small>/7</small></dd></div>` +
      '</dl>' +
      '</article>';
  }

  function renderWeeks(vm) {
    const all = S.weeks(vm.entries, vm.today);
    const rows = all.slice().reverse();
    $('#weeks').hidden = !all.length;
    $('#weeks-list').innerHTML = rows.slice(0, ui.weekLimit).map((w) => weekCard(w, vm)).join('');
    $('#btn-weeks-more').hidden = rows.length <= ui.weekLimit;
    $('#weeks-note').textContent = `${all.length} ${U.plural(all.length, 'tydzień', 'tygodnie', 'tygodni')} od pierwszego wpisu`;
  }

  function moodAlpha(mood) {
    return mood ? [0, 0.35, 0.5, 0.68, 0.84, 1][mood] : 0.9;
  }

  function renderHeatmap(vm) {
    const s = vm.settings;
    const firstMonday = U.addDays(U.weekStart(vm.today), -7 * (HEAT_WEEKS - 1));
    const lastDay = U.addDays(U.weekStart(vm.today), 6);
    const cells = [];
    const starts = [];
    let trainings = 0;
    for (let w = 0; w < HEAT_WEEKS; w++) {
      for (let d = 0; d < 7; d++) {
        const key = U.addDays(firstMonday, w * 7 + d);
        if (U.fromKey(key).getDate() === 1) starts.push([w, key]);
        const e = vm.byDate.get(key);
        let cls = 'hm-cell';
        let style = `grid-column:${w + 2};grid-row:${d + 2}`;
        if (key > vm.today) {
          cls += ' is-future';
        } else if (e && S.isTraining(e)) {
          cls += ` t-${trainingColor(e.training, s)}`;
          style += `;--a:${moodAlpha(e.mood)}`;
          trainings++;
        } else {
          cls += e ? ' is-rest' : ' is-empty';
        }
        if (key === vm.today) cls += ' is-today';
        cells.push(`<span class="${cls}" style="${style}" data-key="${key}"></span>`);
      }
    }
    if (!starts.length || starts[0][0] >= 3) starts.unshift([0, firstMonday]);
    const months = starts
      .filter(([w]) => w <= HEAT_WEEKS - 3)
      .map(([w, key]) => `<span class="hm-month" style="grid-column:${w + 2}">${U.monthShort(key)}</span>`);
    const weekdays = [[2, 'pn'], [4, 'śr'], [6, 'pt']].map(([row, t]) => `<span class="hm-wd" style="grid-row:${row}">${t}</span>`);
    const heat = $('#heatmap');
    heat.innerHTML = months.join('') + weekdays.join('') + cells.join('');
    heat.setAttribute('aria-label', `Treningi od ${U.fmtShort(firstMonday)} do ${U.fmtShort(lastDay)}: ${trainings}.`);

    const total = vm.entries.filter(S.isTraining).length;
    $('#train-count').textContent = `${total} ${U.plural(total, 'trening', 'treningi', 'treningów')} od startu`;
    $('#heat-caption').textContent = 'Mocniejszy kolor to lepsze samopoczucie. Stuknij dzień, żeby zobaczyć szczegóły.';
    $('#heat-legend').innerHTML = s.trainings
      .map((t) => `<span class="lg"><i class="sw sw-sq t-${trainingColor(t, s)}"></i>${esc(t)}</span>`)
      .concat('<span class="lg"><i class="sw sw-sq is-rest"></i>odpoczynek</span>')
      .join('');
  }

  const INSIGHT_WORDS = {
    mood: { fmt: (v) => U.fmt1(v), unit: '', subject: 'samopoczucie jest średnio', more: 'wyższe', less: 'niższe', flat: 'Samopoczucie podobne w obu przypadkach.' },
    kcal: { fmt: (v) => U.fmtInt(v), unit: ' kcal', subject: 'jesz średnio', more: 'więcej', less: 'mniej', flat: 'Kalorie podobne w obu przypadkach.' },
    hours: { fmt: (v) => U.fmt1(v), unit: ' h', subject: 'śpisz średnio', more: 'dłużej', less: 'krócej', flat: 'Sen podobny w obu przypadkach.' }
  };

  function insightValue(kind, v) {
    const w = INSIGHT_WORDS[kind];
    const emoji = kind === 'mood' ? `<span class="emoji" aria-hidden="true">${moodOf(v).emoji}</span>` : '';
    return `${emoji}${esc(w.fmt(v))}<small>${w.unit}</small>`;
  }

  function insightItem(it) {
    const w = INSIGHT_WORDS[it.kind];
    const days = (n) => `${n} ${U.plural(n, 'dzień', 'dni', 'dni')}`;
    if (!it.ready) {
      const need = [[it.labelA, it.a.n], [it.labelB, it.b.n]]
        .filter(([, n]) => n < S.INSIGHT_MIN)
        .map(([label, n]) => `${label}: ${n} z ${S.INSIGHT_MIN}`);
      return `<li class="insight is-pending"><h3>${esc(it.title)}</h3><p>Za mało danych (${esc(need.join(', '))}).</p></li>`;
    }
    const text = it.strong
      ? `${capitalize(it.labelA)} ${w.subject} o ${w.fmt(Math.abs(it.diff))}${w.unit} ${it.diff > 0 ? w.more : w.less} niż ${it.labelB}.`
      : w.flat;
    const row = (label, g) => `<div><dt>${esc(label)}</dt><dd>${insightValue(it.kind, g.avg)}</dd><dd class="n">${esc(days(g.n))}</dd></div>`;
    return `<li class="insight${it.strong ? ' is-strong' : ''}"><h3>${esc(it.title)}</h3><p>${esc(text)}</p>` +
      `<dl>${row(it.labelA, it.a)}${row(it.labelB, it.b)}</dl></li>`;
  }

  function renderInsights(vm) {
    // Strong findings first, then the rest that have data, then the ones still waiting.
    const rank = (it) => (it.strong ? 0 : it.ready ? 1 : 2);
    const list = vm.insights.slice().sort((a, b) => rank(a) - rank(b));
    $('#insights').innerHTML = list.map(insightItem).join('');
    $('#insights-caption').textContent = list.some((it) => it.ready)
      ? 'Średnie z Twoich wpisów, nie dowód przyczyny. Im więcej dni, tym pewniejszy wynik.'
      : `Każde porównanie potrzebuje co najmniej ${S.INSIGHT_MIN} dni w obu grupach. Sen z danego dnia to noc przed nim.`;
  }

  function renderBadges(vm) {
    const on = vm.badges.filter((b) => b.unlocked).length;
    $('#badges-count').textContent = `${on} z ${vm.badges.length}`;
    $('#badges').innerHTML = vm.badges.map((b) => `
      <li>
        <button type="button" class="badge b-${b.color} ${b.unlocked ? 'is-on' : 'is-off'}" data-id="${b.id}"
          aria-label="${esc(`${b.title}. ${b.desc}. ${b.unlocked ? 'Zdobyta' : 'Do zdobycia'}.`)}">
          <span class="badge-heart" aria-hidden="true"><svg viewBox="0 0 24 22"><use href="#i-heart"/></svg><span class="badge-mark">${esc(b.mark)}</span></span>
          <span class="badge-title" aria-hidden="true">${esc(b.title)}</span>
        </button>
      </li>`).join('');
    $('#badge-caption').textContent = 'Stuknij odznakę, żeby zobaczyć, za co jest.';
  }

  function renderLog(vm) {
    const s = vm.settings;
    const all = S.sorted(vm.entries);
    const prevWeight = new Map();
    let last = null;
    all.forEach((e) => {
      if (typeof e.weight === 'number') {
        prevWeight.set(e.date, last);
        last = e.weight;
      }
    });
    const rows = all.reverse();
    let html = '';
    let month = '';
    rows.slice(0, ui.logLimit).forEach((e) => {
      const m = U.monthTitle(e.date);
      if (m !== month) {
        html += `${month ? '</ul>' : ''}<h3 class="log-month">${m}</h3><ul class="log-list">`;
        month = m;
      }
      html += `<li>${logRow(e, prevWeight.get(e.date), s, vm.today)}</li>`;
    });
    if (month) html += '</ul>';
    $('#logbook').hidden = !rows.length;
    $('#log').innerHTML = html;
    $('#btn-more').hidden = rows.length <= ui.logLimit;
    $('#log-count').textContent = `${rows.length} ${U.plural(rows.length, 'wpis', 'wpisy', 'wpisów')}`;
  }

  function logRow(e, prev, s, today) {
    const none = '<span class="none">–</span>';
    let weight = none;
    if (typeof e.weight === 'number') {
      weight = `${U.fmtWeight(e.weight)}<small> kg</small>`;
      const diff = prev != null ? Math.round((e.weight - prev) * 100) / 100 : 0;
      if (diff < 0) weight += ` <em class="delta is-down" title="Mniej niż w poprzednim pomiarze">▼ ${U.fmtWeight(-diff)}</em>`;
      else if (diff > 0) weight += ` <em class="delta is-up" title="Więcej niż w poprzednim pomiarze">▲ ${U.fmtWeight(diff)}</em>`;
    }
    const macros = S.hasMacros(e) ? `<small class="log-macro" title="Białko, tłuszcze, węgle">${esc(macroLine(e))}</small>` : '';
    const kcal = (typeof e.kcal === 'number'
      ? `<span class="kcal-${S.kcalState(e.kcal, s.kcalTarget)}">${U.fmtInt(e.kcal)}<small> kcal</small></span>`
      : macros ? '' : none) + macros;
    const training = S.isTraining(e)
      ? `<i class="dot t-${trainingColor(e.training, s)}"></i>${esc(e.training)}`
      : `<span class="none">${e.date === today ? '–' : 'odpoczynek'}</span>`;
    const mood = e.mood ? `<span title="${MOODS[e.mood].label}">${MOODS[e.mood].emoji}</span>` : '';
    const sleepParts = [];
    if (typeof e.sleep === 'number') sleepParts.push(`sen ${U.fmtHours(e.sleep)} h`);
    if (typeof e.sleepScore === 'number') sleepParts.push(`${e.sleepScore}/100`);
    const extra = (sleepParts.length ? `<span class="log-sleep">${sleepParts.join(', ')}</span>` : '') +
      (e.note ? `<span class="log-note">${esc(e.note)}</span>` : '');
    return `<button type="button" class="log-row${e.date === today ? ' is-today' : ''}" data-date="${e.date}" title="Edytuj wpis">` +
      `<span class="log-day"><b>${U.fromKey(e.date).getDate()}</b><small>${U.WEEKDAYS[U.weekdayIndex(e.date)]}</small></span>` +
      `<span class="log-weight">${weight}</span>` +
      `<span class="log-kcal">${kcal}</span>` +
      `<span class="log-train">${training}</span>` +
      `<span class="log-mood">${mood}</span>` +
      (extra ? `<span class="log-extra">${extra}</span>` : '') +
      '</button>';
  }

  // ---------- updates and celebrations ----------

  function snapshot(vm) {
    return { full: vm.pl.full, count: vm.pl.count, badges: vm.badges.filter((b) => b.unlocked).map((b) => b.id) };
  }

  function readSeen() {
    try { return JSON.parse(localStorage.getItem(SEEN_KEY) || 'null'); } catch (_) { return null; }
  }

  function writeSeen(snap) {
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(snap)); } catch (_) { /* ignore */ }
  }

  // kind: 'init' (page load or right after the first-visit form), 'save' (after her change), 'reload'
  function update(kind, info = {}) {
    clearTimeout(ui.updateTimer);
    ui.dashboardStale = false;
    if (store.needsSetup()) return; // nothing to show before the first-visit form is filled
    const vm = compute();
    ui.vm = vm;
    const before = kind === 'init' ? readSeen() : ui.snap;
    const after = snapshot(vm);
    const grew = !!before && before.count === after.count && after.full > before.full;
    const fresh = kind === 'init';
    render(vm, { animateFrom: fresh ? 0 : grew ? before.full : null, delay: grew && !fresh ? 350 : 0 });
    if (before && store.state.mode !== 'demo') {
      celebrate(before, after, vm, info, fresh ? 150 + after.full * 110 + 650 : 350 + 700);
    }
    ui.snap = after;
    if (store.state.mode !== 'demo') writeSeen(after);
  }

  function celebrate(before, after, vm, info, delay) {
    const news = [];
    if (before.count === after.count && after.full > before.full) {
      const n = after.full - before.full;
      news.push(`${n === 1 ? 'Nowy talerz' : `${n} ${U.plural(n, 'nowy talerz', 'nowe talerze', 'nowych talerzy')}`} na sztandze. ${U.fmt1(vm.prog.lost)} kg w dół.`);
    }
    vm.badges.filter((b) => b.unlocked && !before.badges.includes(b.id)).forEach((b) => news.push(`Nowa odznaka: ${b.title}.`));
    if (info.weightDate && vm.latest && vm.latest.date === info.weightDate && S.isNewLow(vm.entries, vm.today)) {
      news.push('Najniższa waga od startu.');
    }
    if (!news.length) return;
    setTimeout(() => DF.confetti.burst(barbellOrigin()), delay);
    news.forEach((text, i) => setTimeout(() => toast(text), delay + i * 400));
  }

  function barbellOrigin() {
    const r = $('#barbell').getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height * 0.45 };
  }

  // After a change: redraw the dashboard a moment later, or when the open sheet closes (toasts
  // and confetti would otherwise sit under the sheet).
  function scheduleUpdate() {
    if (entrySheet.open || settingsSheet.open) {
      ui.dashboardStale = true;
      return;
    }
    clearTimeout(ui.updateTimer);
    ui.updateTimer = setTimeout(() => {
      const info = { weightDate: ui.lastWeightDate };
      ui.lastWeightDate = null;
      update('save', info);
    }, 450);
  }

  function onStoreChange(kind) {
    if (kind === 'change') {
      ui.savedThisVisit = true;
      renderSaveStates(true);
      renderBanner();
      scheduleUpdate();
      return;
    }
    if (kind === 'sync') {
      renderSaveStates();
      renderBanner();
      // The send may have brought edits made elsewhere; show them.
      if (store.serialize(store.state.data) !== ui.renderedText && !document.body.classList.contains('is-onboarding')) {
        if (todayForm) todayForm.refresh();
        if (sheetForm && entrySheet.open) sheetForm.refresh();
        scheduleUpdate();
      }
      return;
    }
    // 'load': connected, disconnected, reset, or pulled fresh data
    if (store.needsSetup()) {
      if (document.body.classList.contains('is-onboarding')) return; // keep what she's typing
      closeSheet(settingsSheet);
      closeSheet(entrySheet);
      showOnboarding();
      return;
    }
    if (document.body.classList.contains('is-onboarding')) {
      showApp('init');
      return;
    }
    if (todayForm) todayForm.load(U.todayKey());
    if (sheetForm && entrySheet.open) sheetForm.refresh();
    update('reload');
  }

  // ---------- save state pills ----------

  function saveState() {
    const st = store.state;
    const time = st.savedAt ? new Date(st.savedAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : '';
    if (st.mode === 'demo') return ['is-saved', 'Podgląd, nic się nie zapisuje'];
    if (!st.storageOk) return ['is-error', 'Przeglądarka nie pozwala zapisać danych'];
    if (!ui.savedThisVisit) return ['', 'Zapisuje się samo'];
    if (st.mode === 'github') {
      if (st.sync.status === 'pending' || st.sync.status === 'syncing') return ['is-syncing', 'Zapisano, wysyłam…'];
      if (st.sync.status === 'offline') return ['is-offline', 'Zapisano, wyślę po powrocie internetu'];
      if (st.sync.status === 'error') return ['is-error', 'Zapisano tutaj, nie wysłano'];
      return ['is-saved', `Zapisano i wysłane ${time}`];
    }
    return ['is-saved', `Zapisano ${time}`];
  }

  function renderSaveStates(pop) {
    const [cls, text] = saveState();
    ['#today-state', '#sheet-state'].forEach((sel) => {
      const el = $(sel);
      if (!el) return;
      el.className = `save-state ${cls}`;
      el.innerHTML = `${cls === 'is-saved' ? HEART : ''}<span>${esc(text)}</span>`;
      el.title = cls === 'is-error' ? 'Otwórz ustawienia' : '';
      if (pop && cls) {
        void el.offsetWidth; // restart the animation
        el.classList.add('pop');
      }
    });
  }

  // ---------- entry form (today card and sheet): saves itself ----------

  const L = store.LIMITS;
  const range = ([lo, hi]) => `${U.fmtInt(lo)} do ${U.fmtInt(hi)}`;
  const hundredths = (v) => Math.round(v * 100) / 100;
  const RULES = {
    weight: { limits: L.weight, round: hundredths, msg: `Waga: liczba od ${range(L.weight)}, np. 62,4.` },
    kcal: { limits: L.kcal, round: Math.round, msg: 'Kalorie: liczba, np. 1650.' },
    sleep: { limits: L.sleep, round: hundredths, msg: `Sen: godziny od ${range(L.sleep)}, np. 7,5.` },
    sleepScore: { limits: L.sleepScore, round: Math.round, msg: `Ocena snu: liczba od ${range(L.sleepScore)}.` }
  };
  S.MACROS.forEach(({ key, label }) => {
    RULES[key] = { limits: L.macro, round: Math.round, msg: `${label}: gramy od ${range(L.macro)}, np. 110.` };
  });
  const MACRO_KEYS = S.MACROS.map((m) => m.key);
  const TEXT_FIELDS = ['weight', 'kcal', ...MACRO_KEYS, 'sleep', 'sleepScore', 'note'];
  const blank = (v) => v === undefined || v === null || v === '';
  const same = (a, b) => (blank(a) ? undefined : a) === (blank(b) ? undefined : b);

  function formMarkup(p) {
    const moods = MOODS.slice(1).map((m, i) =>
      `<button type="button" class="mood" data-mood="${i + 1}" aria-pressed="false"><span class="emoji" aria-hidden="true">${m.emoji}</span><span>${m.label}</span></button>`).join('');
    const input = (field, mode, placeholder, extra = '') =>
      `<input id="${p}-${field}" data-field="${field}" inputmode="${mode}" autocomplete="off" enterkeyhint="done"${placeholder ? ` placeholder="${placeholder}"` : ''}${extra}>`;
    return `
      <div class="ef-grid">
        <div class="field f-weight">
          <label for="${p}-weight">Waga</label>
          <div class="stepper">
            <button type="button" class="step" data-step="-0.1" aria-label="Odejmij 0,1 kg"><svg aria-hidden="true"><use href="#i-minus"/></svg></button>
            <div class="with-unit">${input('weight', 'decimal', '')}<span class="unit">kg</span></div>
            <button type="button" class="step" data-step="0.1" aria-label="Dodaj 0,1 kg"><svg aria-hidden="true"><use href="#i-plus"/></svg></button>
          </div>
          <p class="field-error" data-error="weight" hidden></p>
        </div>
        <div class="field f-kcal">
          <label for="${p}-kcal">Kalorie</label>
          <div class="with-unit">${input('kcal', 'numeric', 'np. 1650')}<span class="unit">kcal</span></div>
          <p class="hint" data-hint="kcal"></p>
          <p class="field-error" data-error="kcal" hidden></p>
        </div>
        <div class="field f-sleep">
          <label for="${p}-sleep">Sen</label>
          <div class="sleep-row">
            <div class="with-unit">${input('sleep', 'decimal', '7,5')}<span class="unit">h</span></div>
            <div class="with-unit">${input('sleepScore', 'numeric', 'ocena', ' aria-label="Ocena snu od 0 do 100"')}<span class="unit">/100</span></div>
          </div>
          <p class="field-error" data-error="sleep" hidden></p>
          <p class="field-error" data-error="sleepScore" hidden></p>
        </div>
        <fieldset class="field f-macro">
          <legend>Makro <small>opcjonalnie</small></legend>
          <div class="macro-row">${S.MACROS.map(({ key, label }) => `
            <div class="field">
              <label class="sub-label" for="${p}-${key}">${label}</label>
              <div class="with-unit">${input(key, 'numeric', '')}<span class="unit">g</span></div>
            </div>`).join('')}
          </div>
          <p class="hint" data-hint="macro"></p>
          ${S.MACROS.map(({ key }) => `<p class="field-error" data-error="${key}" hidden></p>`).join('')}
        </fieldset>
      </div>
      <fieldset class="field f-training"><legend>Trening <small>stuknij jeszcze raz, żeby odznaczyć</small></legend><div class="chips" data-chips></div></fieldset>
      <fieldset class="field f-mood"><legend>Samopoczucie</legend><div class="moods" data-moods>${moods}</div></fieldset>
      <div class="field f-note">
        <label for="${p}-note">Notatka</label>
        <textarea id="${p}-note" data-field="note" rows="2" maxlength="280" placeholder="Opcjonalnie, np. rekord w hip thruście"></textarea>
      </div>`;
  }

  function createForm(host, prefix) {
    host.innerHTML = formMarkup(prefix);
    const timers = new Map();
    let date = null;
    const q = (field) => $(`[data-field="${field}"]`, host);

    function setError(field, text) {
      const el = $(`[data-error="${field}"]`, host);
      if (!el) return;
      el.hidden = !text;
      el.textContent = text || '';
    }

    function format(field, v) {
      if (v === undefined || v === null) return '';
      if (field === 'weight') return U.weightInput(v);
      if (field === 'sleep') return U.fmtHours(v);
      return String(v);
    }

    function weightPlaceholder() {
      const before = S.weightEntries(store.state.data.entries).filter((e) => e.date <= date);
      const ref = before.length ? before[before.length - 1] : S.latestWeight(store.state.data.entries);
      const w = ref ? ref.weight : store.state.data.settings.startWeight;
      return w != null ? U.weightInput(w) : 'np. 62,4';
    }

    function kcalHint() {
      const target = store.state.data.settings.kcalTarget;
      const hint = $('[data-hint="kcal"]', host);
      const k = U.parseNumber(q('kcal').value);
      hint.className = 'hint';
      if (!target) { hint.textContent = ''; return; }
      if (k == null || k < 0) { hint.textContent = `Cel: ${U.fmtInt(target)} kcal`; return; }
      const state = S.kcalState(k, target);
      const diff = Math.round(k - target);
      hint.textContent = state === 'ok'
        ? `W celu (${U.signed(diff, U.fmtInt)} kcal)`
        : state === 'over' ? `${U.fmtInt(diff)} kcal ponad cel` : `${U.fmtInt(-diff)} kcal poniżej celu`;
      hint.classList.add(`is-${state}`);
    }

    // Calories implied by the typed macros, and how far they are from the typed calories.
    function macroHint() {
      const hint = $('[data-hint="macro"]', host);
      const typed = {};
      MACRO_KEYS.forEach((key) => { typed[key] = U.parseNumber(q(key).value); });
      const fromMacros = S.macroKcal(typed);
      const goal = macroLine(macroGoals(store.state.data.settings));
      hint.className = 'hint';
      if (fromMacros == null) {
        hint.textContent = goal ? `Cel: ${goal}` : 'Z trzech wartości policzę kalorie.';
        return;
      }
      const kcal = U.parseNumber(q('kcal').value);
      const off = kcal != null && kcal > 0 ? Math.abs(fromMacros - kcal) / kcal : 0;
      hint.textContent = `Z makro wychodzi ${U.fmtInt(fromMacros)} kcal` +
        (off > 0.1 ? `, a w kaloriach jest ${U.fmtInt(kcal)}. Sprawdź, czy wszystko się zgadza.` : kcal == null ? '. Puste pole kalorii uzupełni się samo.' : '.');
      if (off > 0.1) hint.classList.add('is-over');
    }

    function buildChips(current) {
      const s = store.state.data.settings;
      const names = s.trainings.slice();
      if (current && !names.includes(current)) names.push(current);
      $('[data-chips]', host).innerHTML = names
        .map((t) => `<button type="button" class="chip" data-training="${esc(t)}" aria-pressed="false"><i class="dot t-${trainingColor(t, s)}"></i>${esc(t)}</button>`)
        .join('');
    }

    function pressChoices(e) {
      $$('[data-training]', host).forEach((b) => b.setAttribute('aria-pressed', String(!!e && !!e.training && b.dataset.training === e.training)));
      $$('[data-mood]', host).forEach((b) => b.setAttribute('aria-pressed', String(!!e && Number(b.dataset.mood) === e.mood)));
    }

    // Fill from stored data; `soft` leaves alone whatever she is typing right now.
    function fill(soft) {
      const e = entryFor(date);
      TEXT_FIELDS.forEach((field) => {
        const input = q(field);
        if (soft && (document.activeElement === input || timers.has(field))) return;
        input.value = format(field, e ? e[field] : undefined);
        setError(field, null);
      });
      q('weight').placeholder = weightPlaceholder();
      buildChips(e && e.training);
      pressChoices(e);
      kcalHint();
      macroHint();
    }

    function commit(field, showErrors) {
      clearTimeout(timers.get(field));
      timers.delete(field);
      if (!date) return;
      const raw = q(field).value.trim();
      let value;
      if (field === 'note') {
        value = raw ? raw.slice(0, 280) : undefined;
      } else if (raw) {
        const n = U.parseNumber(raw);
        const rule = RULES[field];
        if (n == null || n < rule.limits[0] || n > rule.limits[1]) {
          if (showErrors) setError(field, rule.msg);
          return;
        }
        value = rule.round(n);
      }
      setError(field, null);
      const current = entryFor(date);
      if (same(value, current ? current[field] : undefined)) return;
      if (field === 'weight' && value !== undefined) ui.lastWeightDate = date;
      if (value === undefined) {
        store.setEntry(date, {}, [field]);
        return;
      }
      const set = { [field]: value };
      // The third macro fills in empty calories, unless she is typing them right now.
      const kcalInput = q('kcal');
      if (MACRO_KEYS.includes(field) && !kcalInput.value.trim() && !timers.has('kcal') && !(current && current.kcal != null)) {
        const fromMacros = S.macroKcal(Object.assign({}, current, set));
        if (fromMacros != null) {
          set.kcal = Math.round(fromMacros);
          if (document.activeElement !== kcalInput) kcalInput.value = String(set.kcal);
          kcalHint();
          macroHint();
        }
      }
      store.setEntry(date, set);
    }

    function later(field, ms) {
      clearTimeout(timers.get(field));
      timers.set(field, setTimeout(() => commit(field, false), ms));
    }

    host.addEventListener('input', (ev) => {
      const field = ev.target.dataset && ev.target.dataset.field;
      if (!field) return;
      if (field === 'kcal') kcalHint();
      if (field === 'kcal' || MACRO_KEYS.includes(field)) macroHint();
      later(field, 800);
    });
    host.addEventListener('focusout', (ev) => {
      const field = ev.target.dataset && ev.target.dataset.field;
      if (field) commit(field, true);
    });
    host.addEventListener('keydown', (ev) => {
      const field = ev.target.dataset && ev.target.dataset.field;
      if (ev.key === 'Enter' && field && field !== 'note') {
        ev.preventDefault();
        commit(field, true);
      }
    });
    host.addEventListener('click', (ev) => {
      const step = ev.target.closest('.step');
      if (step) {
        const input = q('weight');
        const cur = U.parseNumber(input.value);
        const base = cur != null ? cur : U.parseNumber(input.placeholder);
        if (base == null) return;
        input.value = U.weightInput(Math.round((base + (cur != null ? Number(step.dataset.step) : 0)) * 100) / 100);
        later('weight', 700);
        return;
      }
      const chip = ev.target.closest('[data-training]');
      if (chip && date) {
        const name = chip.dataset.training;
        const current = entryFor(date);
        const on = chip.getAttribute('aria-pressed') !== 'true';
        $$('[data-training]', host).forEach((b) => b.setAttribute('aria-pressed', String(on && b === chip)));
        if (on && name) store.setEntry(date, { training: name });
        else if (current && current.training) store.setEntry(date, {}, ['training']);
        return;
      }
      const mood = ev.target.closest('[data-mood]');
      if (mood && date) {
        const on = mood.getAttribute('aria-pressed') !== 'true';
        $$('[data-mood]', host).forEach((b) => b.setAttribute('aria-pressed', String(on && b === mood)));
        if (on) store.setEntry(date, { mood: Number(mood.dataset.mood) });
        else store.setEntry(date, {}, ['mood']);
      }
    });

    return {
      get date() { return date; },
      load(d) {
        timers.forEach((t) => clearTimeout(t));
        timers.clear();
        date = d;
        fill(false);
      },
      refresh() { if (date) fill(true); },
      flush() { [...timers.keys()].forEach((field) => commit(field, false)); },
      cancel() { timers.forEach((t) => clearTimeout(t)); timers.clear(); },
      focusWeight() { q('weight').focus(); }
    };
  }

  // ---------- sheet for other days ----------

  function openEntry(date) {
    if (!store.canWrite()) {
      toast('Tylko podgląd. Dodaj token w ustawieniach, żeby zapisywać.');
      return;
    }
    const d = date || U.addDays(U.todayKey(), -1);
    const input = $('#s-date');
    input.max = U.todayKey();
    input.value = d;
    loadSheetDay(d);
    showSheet(entrySheet);
  }

  function loadSheetDay(d) {
    sheetForm.load(d);
    $('#entry-title').textContent = d === U.todayKey() ? 'Dziś' : capitalize(U.fmtRelative(d, U.todayKey()));
    $$('.day-chip').forEach((b) => b.setAttribute('aria-pressed', String(d === U.addDays(U.todayKey(), Number(b.dataset.offset)))));
    $('#btn-delete').hidden = !entryFor(d);
    disarmDelete();
  }

  function disarmDelete() {
    clearTimeout(ui.deleteTimer);
    ui.deleteArmed = false;
    const btn = $('#btn-delete');
    btn.textContent = 'Usuń wpis';
    btn.classList.remove('is-armed');
  }

  function onDelete() {
    const btn = $('#btn-delete');
    if (!ui.deleteArmed) {
      ui.deleteArmed = true;
      btn.textContent = 'Na pewno usunąć?';
      btn.classList.add('is-armed');
      ui.deleteTimer = setTimeout(disarmDelete, 4000);
      return;
    }
    disarmDelete();
    const date = sheetForm.date;
    sheetForm.cancel(); // typing that hadn't saved yet must not bring the entry back
    store.deleteEntry(date);
    closeSheet(entrySheet);
    toast('Wpis usunięty');
  }

  // ---------- toasts and sheets ----------

  function toast(text, isError) {
    const box = $('#toasts');
    const el = document.createElement('div');
    el.className = `toast${isError ? ' is-error' : ''}`;
    const p = document.createElement('p');
    p.textContent = text;
    el.append(p);
    box.append(el);
    while (box.children.length > 4) box.firstElementChild.remove();
    setTimeout(() => {
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 300);
    }, isError ? 7000 : 4500);
  }

  function showSheet(dialog) {
    if (!dialog.open) dialog.showModal();
  }

  function closeSheet(dialog) {
    if (dialog.open) dialog.close();
  }

  function onSheetClosed() {
    if (sheetForm) sheetForm.flush();
    disarmDelete();
    if (todayForm) todayForm.refresh();
    if (ui.dashboardStale) scheduleUpdate();
  }

  function showMsg(sel, text, isError) {
    const el = $(sel);
    el.hidden = false;
    el.textContent = text;
    el.classList.toggle('is-error', !!isError);
  }

  const hideMsg = (sel) => { $(sel).hidden = true; };

  // ---------- first visit ----------

  function showOnboarding() {
    if (!$('#onboarding')) document.body.prepend($('#onboarding-tpl').content.cloneNode(true));
    document.body.classList.remove('is-loading');
    document.body.classList.add('is-onboarding');
    $('#app').hidden = true;
    $('#topbar').hidden = true;
    $('#banner').hidden = true;
    const s = store.state.data.settings;
    $('#ob-name').value = s.name || 'Wercia';
    $('#ob-weekly').value = String(s.weeklyTrainings != null ? s.weeklyTrainings : 3);
    ui.obTrainings = (s.trainings && s.trainings.length ? s.trainings : store.DEFAULT_TRAININGS).slice();
    ui.obDateTouched = false;
    renderObTrainings();
    obHints();
    bindOnboarding();
    window.scrollTo(0, 0);
  }

  function renderObTrainings() {
    $('#ob-trainings').innerHTML = ui.obTrainings.map((t, i) =>
      `<button type="button" class="chip" data-remove="${i}" aria-label="${esc(`Usuń ${t}`)}"><i class="dot t-${TRAINING_COLORS[i] || 'blush'}"></i>${esc(t)}<span class="x" aria-hidden="true">×</span></button>`).join('');
  }

  // Suggest a date at 0.5 kg a week until she picks one herself; flag very low calories.
  function obHints() {
    const w = U.parseNumber($('#ob-weight').value);
    const t = U.parseNumber($('#ob-target').value);
    const dateHint = $('#ob-date-hint');
    if (w != null && t != null && t < w) {
      const weeks = Math.max(1, Math.ceil((w - t) / 0.5));
      if (!ui.obDateTouched) $('#ob-date').value = U.addDays(U.todayKey(), weeks * 7);
      dateHint.textContent = `Przy 0,5 kg na tydzień to ok. ${weeks} ${U.plural(weeks, 'tydzień', 'tygodnie', 'tygodni')}.`;
    } else {
      dateHint.textContent = 'Podpowiem datę, gdy wpiszesz obie wagi.';
    }
    const k = U.parseNumber($('#ob-kcal').value);
    const kHint = $('#ob-kcal-hint');
    kHint.className = 'hint';
    if (k != null && k >= 800 && k < 1200) {
      kHint.textContent = 'Poniżej 1200 kcal trudno o siłę na treningach i regenerację. Jeśli to plan od dietetyka, zostaw.';
      kHint.classList.add('is-over');
    } else {
      kHint.textContent = '';
    }
  }

  function readOnboarding() {
    return {
      name: $('#ob-name').value.trim() || 'Wercia',
      weight: U.parseNumber($('#ob-weight').value),
      targetWeight: U.parseNumber($('#ob-target').value),
      targetDate: $('#ob-date').value,
      kcalTarget: U.parseNumber($('#ob-kcal').value),
      weeklyTrainings: U.parseNumber($('#ob-weekly').value),
      trainings: ui.obTrainings.slice()
    };
  }

  const inRange = (n, [lo, hi]) => n != null && n >= lo && n <= hi;

  function validateOnboarding(v) {
    if (!inRange(v.weight, L.weight)) return ['ob-weight', 'Wpisz dzisiejszą wagę, np. 63,4.'];
    if (!inRange(v.targetWeight, L.weight)) return ['ob-target', 'Wpisz wagę docelową, np. 58.'];
    if (v.targetWeight >= v.weight) return ['ob-target', 'Waga docelowa musi być niższa niż dzisiejsza.'];
    if (!U.isValidKey(v.targetDate) || v.targetDate <= U.todayKey()) return ['ob-date', 'Wybierz datę w przyszłości.'];
    if (!inRange(v.kcalTarget, L.kcalTarget)) return ['ob-kcal', `Kalorie: liczba od ${range(L.kcalTarget)}, np. 1750.`];
    if (!inRange(v.weeklyTrainings, L.weeklyTrainings)) return ['ob-weekly', `Treningi w tygodniu: od ${range(L.weeklyTrainings)}.`];
    if (!v.trainings.length) return ['ob-new-training', 'Dodaj przynajmniej jeden rodzaj treningu.'];
    return null;
  }

  function addObTraining() {
    const input = $('#ob-new-training');
    const name = input.value.trim().slice(0, 24);
    if (!name) return;
    if (!ui.obTrainings.includes(name) && ui.obTrainings.length < 8) ui.obTrainings.push(name);
    input.value = '';
    renderObTrainings();
  }

  function bindOnboarding() {
    const form = $('#ob-form');
    if (form.dataset.bound) return;
    form.dataset.bound = '1';
    ['#ob-weight', '#ob-target', '#ob-kcal'].forEach((sel) => $(sel).addEventListener('input', obHints));
    $('#ob-date').addEventListener('input', () => { ui.obDateTouched = true; });
    $$('[data-count]', form).forEach((b) => b.addEventListener('click', () => {
      const cur = U.parseNumber($('#ob-weekly').value);
      $('#ob-weekly').value = String(U.clamp((cur == null ? 3 : Math.round(cur)) + Number(b.dataset.count), 0, 14));
    }));
    $('#ob-trainings').addEventListener('click', (ev) => {
      const chip = ev.target.closest('[data-remove]');
      if (!chip) return;
      ui.obTrainings.splice(Number(chip.dataset.remove), 1);
      renderObTrainings();
    });
    $('#ob-add').addEventListener('click', addObTraining);
    $('#ob-new-training').addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        addObTraining();
      }
    });
    $('#ob-import').addEventListener('click', () => $('#import-file').click());
    $('#ob-sync').addEventListener('click', openSettings);
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const v = readOnboarding();
      const problem = validateOnboarding(v);
      const err = $('#ob-error');
      if (problem) {
        err.hidden = false;
        err.textContent = problem[1];
        $(`#${problem[0]}`).focus();
        return;
      }
      err.hidden = true;
      v.weight = Math.round(v.weight * 100) / 100;
      v.targetWeight = Math.round(v.targetWeight * 100) / 100;
      v.kcalTarget = Math.round(v.kcalTarget);
      v.weeklyTrainings = Math.round(v.weeklyTrainings);
      store.setup(v);
      // onStoreChange('change') runs first; the dashboard takes over from here.
      finishOnboarding('Start zapisany. Od teraz wpisujesz dzień, reszta liczy się sama.');
    });
  }

  function finishOnboarding(message) {
    const ob = $('#onboarding');
    if (ob) ob.remove();
    showApp('init');
    window.scrollTo(0, 0);
    setTimeout(() => DF.confetti.burst(barbellOrigin()), 500);
    if (message) setTimeout(() => toast(message), 600);
  }

  function showApp(kind) {
    const ob = $('#onboarding');
    if (ob) ob.remove();
    document.body.classList.remove('is-loading', 'is-onboarding');
    $('#app').hidden = false;
    $('#topbar').hidden = false;
    ui.today = U.todayKey();
    todayForm.load(ui.today);
    update(kind);
  }

  // ---------- settings ----------

  function fillGoals() {
    const s = store.state.data.settings;
    $('#g-name').value = s.name || '';
    $('#g-startDate').value = s.startDate || '';
    $('#g-startWeight').value = s.startWeight != null ? U.weightInput(s.startWeight) : '';
    $('#g-targetDate').value = s.targetDate || '';
    $('#g-targetWeight').value = s.targetWeight != null ? U.weightInput(s.targetWeight) : '';
    $('#g-kcal').value = s.kcalTarget != null ? String(s.kcalTarget) : '';
    MACRO_KEYS.forEach((key) => { $(`#g-${key}`).value = s[`${key}Target`] != null ? String(s[`${key}Target`]) : ''; });
    goalsMacroHint();
    $('#g-weekly').value = String(s.weeklyTrainings);
    $('#g-trainings').value = s.trainings.join(', ');
  }

  function renderSyncSection() {
    const cfg = store.getConfig();
    const token = store.getToken();
    const st = store.state;
    $('#y-owner').value = cfg ? cfg.owner : '';
    $('#y-repo').value = cfg ? cfg.repo : '';
    $('#y-branch').value = cfg ? cfg.branch : '';
    $('#y-path').value = cfg ? cfg.path : '';
    $('#y-token').value = '';
    $('#y-token').placeholder = token ? 'Token zapisany. Wklej nowy, żeby go zmienić.' : 'github_pat_…';
    $('#btn-disconnect').hidden = st.mode !== 'github';
    let text = 'Wyłączona. Wszystko zapisuje się w tej przeglądarce.';
    if (st.mode === 'github' && cfg) {
      const where = `${cfg.owner}/${cfg.repo}, plik ${cfg.path}`;
      const err = st.error || (st.sync.status === 'error' ? st.sync.error : null);
      text = err ? `Połączono z ${where}, ale jest problem: ${err.message}` : `Włączona: ${where}.`;
      const n = store.pendingCount();
      if (n) text += ` Czeka na wysłanie: ${n} ${U.plural(n, 'zmiana', 'zmiany', 'zmian')}.`;
    }
    $('#sync-status').textContent = text;
  }

  function openSettings() {
    const setUp = !store.needsSetup();
    $('#goals-group').hidden = !setUp || store.state.mode === 'demo';
    $('#backup-group').hidden = !setUp;
    $('#reset-group').hidden = !setUp || store.state.mode === 'demo';
    if (setUp) fillGoals();
    $('#backup-hint').textContent = store.state.mode === 'github'
      ? 'Plik na GitHubie jest kopią samą w sobie. Dodatkowy plik możesz pobrać kiedy chcesz.'
      : 'Dane są tylko w tej przeglądarce. Co jakiś czas pobierz kopię, a przy zmianie telefonu wczytaj ją na nowym.';
    ['#goals-msg', '#backup-msg', '#sync-msg'].forEach(hideMsg);
    $('#import-confirm').hidden = true;
    disarmReset();
    renderSyncSection();
    showSheet(settingsSheet);
  }

  // Grams → calories check for the macro targets, so they can be matched to the calorie target.
  function goalsMacroHint() {
    const g = {};
    MACRO_KEYS.forEach((key) => { g[key] = U.parseNumber($(`#g-${key}`).value); });
    const kcal = S.macroKcal(g);
    const target = U.parseNumber($('#g-kcal').value);
    $('#g-macro-hint').textContent = kcal == null
      ? 'Puste pole znaczy bez celu. Makro i tak będzie na wykresie.'
      : `Razem ${U.fmtInt(kcal)} kcal${target ? ` przy celu ${U.fmtInt(target)} kcal (${U.signed(kcal - target, U.fmtInt)}).` : '.'}`;
  }

  function validateGoals(g) {
    if (!U.isValidKey(g.startDate) || !U.isValidKey(g.targetDate)) return 'Uzupełnij datę startu i termin celu.';
    if (g.targetDate <= g.startDate) return 'Termin celu musi być po dacie startu.';
    if (!inRange(g.startWeight, L.weight) || !inRange(g.targetWeight, L.weight)) return `Wagi muszą być liczbami od ${range(L.weight)} kg.`;
    if (g.targetWeight >= g.startWeight) return 'Waga docelowa musi być niższa niż waga na starcie.';
    if (!inRange(g.kcalTarget, L.kcalTarget)) return `Kalorie dziennie: liczba od ${range(L.kcalTarget)}.`;
    for (const { key, label } of S.MACROS) {
      const v = g[`${key}Target`];
      if (v === undefined) return `${label}: wpisz liczbę gramów albo zostaw puste.`;
      if (v !== null && !inRange(v, L.macroTarget)) return `${label}: liczba gramów od ${range(L.macroTarget)}.`;
    }
    if (!inRange(g.weeklyTrainings, L.weeklyTrainings)) return `Treningi w tygodniu: od ${range(L.weeklyTrainings)}.`;
    if (!g.trainings.length) return 'Podaj przynajmniej jeden rodzaj treningu.';
    if (g.trainings.length > 8) return 'Maksymalnie 8 rodzajów treningu.';
    return null;
  }

  function onSaveGoals(ev) {
    ev.preventDefault();
    const g = {
      name: $('#g-name').value.trim() || 'Wercia',
      startDate: $('#g-startDate').value,
      startWeight: U.parseNumber($('#g-startWeight').value),
      targetDate: $('#g-targetDate').value,
      targetWeight: U.parseNumber($('#g-targetWeight').value),
      kcalTarget: U.parseNumber($('#g-kcal').value),
      weeklyTrainings: U.parseNumber($('#g-weekly').value),
      trainings: [...new Set($('#g-trainings').value.split(',').map((t) => t.trim().slice(0, 24)).filter(Boolean))]
    };
    // null = cleared field (the target is removed), undefined = not a number.
    MACRO_KEYS.forEach((key) => {
      const raw = $(`#g-${key}`).value.trim();
      const n = U.parseNumber(raw);
      g[`${key}Target`] = !raw ? null : n == null ? undefined : Math.round(n);
    });
    const error = validateGoals(g);
    if (error) {
      showMsg('#goals-msg', error, true);
      return;
    }
    g.kcalTarget = Math.round(g.kcalTarget);
    g.weeklyTrainings = Math.round(g.weeklyTrainings);
    store.saveSettings(g);
    todayForm.refresh();
    const low = g.kcalTarget < 1200 ? ' Poniżej 1200 kcal trudno o siłę na treningach i regenerację.' : '';
    showMsg('#goals-msg', `Cele zapisane.${low}`);
  }

  function parseRepo(owner, repo) {
    const joined = repo.includes('/') ? repo : owner.includes('/') ? owner : '';
    const m = /(?:github\.com\/)?([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?(?:[/?#].*)?$/.exec(joined);
    return m ? { owner: m[1], repo: m[2] } : { owner, repo };
  }

  async function onConnect(ev) {
    ev.preventDefault();
    const { owner, repo } = parseRepo($('#y-owner').value.trim(), $('#y-repo').value.trim());
    const token = $('#y-token').value.trim();
    if (!owner || !repo) {
      showMsg('#sync-msg', 'Podaj właściciela i nazwę repozytorium.', true);
      return;
    }
    if (!token && !store.getToken()) {
      showMsg('#sync-msg', 'Wklej token GitHuba.', true);
      return;
    }
    const btn = $('#btn-connect');
    btn.disabled = true;
    btn.textContent = 'Łączę…';
    const res = await store.connect({ owner, repo, branch: $('#y-branch').value, path: $('#y-path').value }, token);
    btn.disabled = false;
    btn.textContent = 'Połącz';
    renderSyncSection();
    if (res.error) {
      showMsg('#sync-msg', res.error.message, true);
      return;
    }
    const n = store.state.data.entries.length;
    showMsg('#sync-msg', `Połączono. W dzienniku ${U.plural(n, 'jest', 'są', 'jest')} ${n} ${U.plural(n, 'wpis', 'wpisy', 'wpisów')}.`);
    if (!store.needsSetup()) {
      $('#goals-group').hidden = false;
      $('#backup-group').hidden = false;
      $('#reset-group').hidden = false;
      fillGoals();
    }
  }

  function onDisconnect() {
    store.disconnect();
    renderSyncSection();
    showMsg('#sync-msg', 'Rozłączono. Wpisy dalej zapisują się w tej przeglądarce.');
  }

  function exportFile() {
    const blob = new Blob([store.exportText()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `dziennik-wercii-${U.todayKey()}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    showMsg('#backup-msg', 'Kopia pobrana.');
  }

  async function onImportFile(ev) {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    const text = await file.text();
    let data;
    try {
      data = store.parse(text, 'Plik');
      if (!store.isSetUp(data.settings) && !data.entries.length) throw new store.StoreError('parse', 'W pliku nie ma ani celów, ani wpisów.');
    } catch (err) {
      if (document.body.classList.contains('is-onboarding')) {
        const box = $('#ob-error');
        box.hidden = false;
        box.textContent = `Nie da się wczytać kopii. ${err.message}`;
      } else {
        showMsg('#backup-msg', `Nie da się wczytać kopii. ${err.message}`, true);
      }
      return;
    }
    if (document.body.classList.contains('is-onboarding')) {
      store.importText(text);
      if (!store.needsSetup()) finishOnboarding('Kopia wczytana.');
      return;
    }
    ui.importText = text;
    const n = data.entries.length;
    $('#import-summary').textContent =
      `W pliku: ${n} ${U.plural(n, 'wpis', 'wpisy', 'wpisów')}${data.settings.targetWeight != null ? `, cel ${U.fmtWeight(data.settings.targetWeight)} kg` : ''}. Obecne dane zostaną zastąpione.`;
    $('#import-confirm').hidden = false;
  }

  function onImportConfirm() {
    if (!ui.importText) return;
    store.importText(ui.importText);
    ui.importText = null;
    $('#import-confirm').hidden = true;
    todayForm.load(U.todayKey());
    fillGoals();
    showMsg('#backup-msg', 'Kopia wczytana.');
  }

  function disarmReset() {
    clearTimeout(ui.resetTimer);
    ui.resetArmed = false;
    const btn = $('#btn-reset');
    btn.textContent = 'Usuń dane z tej przeglądarki';
    btn.classList.remove('is-armed');
  }

  function onReset() {
    const btn = $('#btn-reset');
    if (!ui.resetArmed) {
      ui.resetArmed = true;
      btn.textContent = 'Na pewno? Tego nie da się cofnąć';
      btn.classList.add('is-armed');
      ui.resetTimer = setTimeout(disarmReset, 5000);
      return;
    }
    disarmReset();
    ui.savedThisVisit = false;
    ui.snap = null;
    store.resetAll(); // emits 'load' -> first-visit form
  }

  // ---------- events ----------

  function bind() {
    todayForm = createForm($('#today-form'), 't');
    sheetForm = createForm($('#sheet-form'), 's');

    $('#btn-settings').addEventListener('click', openSettings);
    $('#btn-other-day').addEventListener('click', () => openEntry());
    $('#fab').addEventListener('click', () => openEntry(U.todayKey()));
    $('#today-state').addEventListener('click', () => { if (store.state.sync.status === 'error') openSettings(); });
    $('#btn-more').addEventListener('click', () => { ui.logLimit += 30; renderLog(ui.vm); });
    $('#btn-weeks-more').addEventListener('click', () => { ui.weekLimit += 8; renderWeeks(ui.vm); });

    $('#range').addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-range]');
      if (!b) return;
      ui.range = b.dataset.range === 'all' ? 'all' : Number(b.dataset.range);
      try { localStorage.setItem(RANGE_KEY, JSON.stringify(ui.range)); } catch (_) { /* ignore */ }
      renderCharts(ui.vm);
    });

    const openDay = (ev) => {
      const el = ev.target.closest('[data-date]');
      if (!el) return;
      if (el.dataset.date === U.todayKey() && store.canWrite()) {
        $('#today').scrollIntoView({ behavior: 'smooth', block: 'start' });
        todayForm.focusWeight();
      } else {
        openEntry(el.dataset.date);
      }
    };
    $('#log').addEventListener('click', openDay);
    $('#weeks-list').addEventListener('click', openDay);

    $('#heatmap').addEventListener('click', (ev) => {
      const cell = ev.target.closest('.hm-cell');
      if (!cell || cell.classList.contains('is-future')) return;
      const key = cell.dataset.key;
      const e = ui.vm.byDate.get(key);
      let text = `${U.fmtDay(key)}: brak wpisu.`;
      if (e) text = `${U.fmtDay(key)}: ${dayDetails(e)}.`;
      $('#heat-caption').textContent = text;
      $$('#heatmap .is-picked').forEach((c) => c.classList.remove('is-picked'));
      cell.classList.add('is-picked');
    });

    $('#badges').addEventListener('click', (ev) => {
      const btn = ev.target.closest('.badge');
      if (!btn) return;
      const b = ui.vm.badges.find((x) => x.id === btn.dataset.id);
      $('#badge-caption').textContent = `${b.title}: ${b.desc.charAt(0).toLowerCase()}${b.desc.slice(1)}. ${b.unlocked ? 'Zdobyta.' : 'Jeszcze do zdobycia.'}`;
    });

    // sheet for other days
    $('#s-date').addEventListener('change', () => {
      const d = $('#s-date').value;
      if (!U.isValidKey(d) || d > U.todayKey()) return;
      sheetForm.flush();
      loadSheetDay(d);
    });
    $$('.day-chip').forEach((b) => b.addEventListener('click', () => {
      const d = U.addDays(U.todayKey(), Number(b.dataset.offset));
      sheetForm.flush();
      $('#s-date').value = d;
      loadSheetDay(d);
    }));
    $('#btn-delete').addEventListener('click', onDelete);

    // settings
    $('#goals-form').addEventListener('submit', onSaveGoals);
    ['#g-protein', '#g-fat', '#g-carbs', '#g-kcal'].forEach((sel) => $(sel).addEventListener('input', goalsMacroHint));
    $('#sync-form').addEventListener('submit', onConnect);
    $('#btn-disconnect').addEventListener('click', onDisconnect);
    $('#btn-export').addEventListener('click', exportFile);
    $('#btn-import').addEventListener('click', () => $('#import-file').click());
    $('#import-file').addEventListener('change', onImportFile);
    $('#btn-import-yes').addEventListener('click', onImportConfirm);
    $('#btn-import-no').addEventListener('click', () => { ui.importText = null; $('#import-confirm').hidden = true; });
    $('#btn-reset').addEventListener('click', onReset);

    [entrySheet, settingsSheet].forEach((dialog) => {
      $$('[data-close]', dialog).forEach((b) => b.addEventListener('click', () => closeSheet(dialog)));
      dialog.addEventListener('click', (ev) => { if (ev.target === dialog) closeSheet(dialog); });
      dialog.addEventListener('close', onSheetClosed);
    });

    // Back to the tab: a new day, or data sent from another device.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || document.body.classList.contains('is-onboarding')) return;
      if (ui.today && ui.today !== U.todayKey()) {
        ui.today = U.todayKey();
        todayForm.load(ui.today);
        update('reload');
      }
      if (store.state.mode === 'github' && !entrySheet.open && Date.now() - store.state.loadedAt > 20000) store.refresh();
    });
  }

  async function loadFonts() {
    if (!document.fonts || !document.fonts.load) return;
    const faces = ['400 60px "Titan One"', '700 16px "Nunito"', '800 16px "Nunito"', '900 16px "Nunito"'];
    await Promise.race([
      Promise.all(faces.map((f) => document.fonts.load(f))).catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 1500))
    ]);
  }

  async function init() {
    bind();
    try {
      const saved = JSON.parse(localStorage.getItem(RANGE_KEY) || 'null');
      if (saved === 30 || saved === 90 || saved === 'all') ui.range = saved;
    } catch (_) { /* ignore */ }
    if (new URLSearchParams(location.search).has('demo')) store.enterDemo();
    await Promise.all([store.load(), loadFonts()]);
    store.onChange(onStoreChange);
    if (store.needsSetup()) showOnboarding();
    else showApp('init');
  }

  DF.app = { update, compute, openEntry, openSettings };
  init();
})(window.DF = window.DF || {});
