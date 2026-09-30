/* Dziennik formy Wercii: the barbell. Every kilogram of the goal is one plate. Earned plates are
   loaded on both sleeves, the next one fills up from the bottom, the rest are dashed outlines. */
(function (DF) {
  'use strict';

  const U = DF.utils;

  const W = 720;
  const H = 176;
  const CY = 88;
  const GAP = 3;
  const LEFT_COLLAR = 236;
  const RIGHT_COLLAR = 484;
  const PLATES = [
    { h: 150, w: 26, c: 'pink' },
    { h: 150, w: 22, c: 'black' },
    { h: 150, w: 18, c: 'red' },
    { h: 150, w: 15, c: 'blue' },
    { h: 124, w: 13, c: 'white' },
    { h: 104, w: 11, c: 'pink' },
    { h: 88, w: 9, c: 'red' },
    { h: 76, w: 8, c: 'blue' },
    { h: 66, w: 7, c: 'black' },
    { h: 58, w: 6, c: 'white' }
  ];

  const r1 = (n) => Math.round(n * 10) / 10;

  // Heart centred on (cx, cy), `size` wide.
  function heart(cx, cy, size, cls) {
    const s = size / 20;
    return `<path class="${cls}" transform="translate(${r1(cx - 12 * s)} ${r1(cy - 12 * s)}) scale(${r1(s * 100) / 100})" ` +
      'd="M12 21.4 10.6 20.1C5.4 15.4 2 12.3 2 8.5 2 5.4 4.4 3 7.5 3c1.7 0 3.4.8 4.5 2.1C13.1 3.8 14.8 3 16.5 3 19.6 3 22 5.4 22 8.5c0 3.8-3.4 6.9-8.6 11.6z"/>';
  }

  function plate(p, x, side, kind, fill, order) {
    const y = CY - p.h / 2;
    const box = `x="${x}" y="${y}" width="${p.w}" height="${p.h}" rx="4"`;
    const anim = order >= 0 ? ` style="--i:${order}"` : '';
    if (kind === 'ghost') return `<rect class="ghost" ${box}/>`;
    if (kind === 'partial') {
      const fh = r1(p.h * fill);
      return `<rect class="ghost" ${box}/>` +
        `<rect class="level p-${p.c}${order >= 0 ? ' grow' : ''}"${anim} x="${x}" y="${r1(y + p.h - fh)}" width="${p.w}" height="${fh}" rx="3"/>`;
    }
    const edgeX = side === 'l' ? x + 2.5 : x + p.w - 4.5;
    const mark = p.w >= 13 ? heart(x + p.w / 2, CY, p.w * 0.62, `mark on-${p.c}`) : '';
    return `<g class="plate${order >= 0 ? ` slide-${side}` : ''}"${anim}>` +
      `<rect class="face p-${p.c}" ${box}/>` +
      `<rect class="edge" x="${edgeX}" y="${y + 7}" width="2" height="${p.h - 14}" rx="1"/>` +
      mark +
      '</g>';
  }

  // Collar with studs: the barbell gets its claws.
  function collar(x) {
    const studs = [x + 1, x + 7.5].map((sx) =>
      `<path class="stud" d="M${sx} ${CY - 23}l2.75 -7 2.75 7z"/><path class="stud" d="M${sx} ${CY + 23}l2.75 7 2.75 -7z"/>`).join('');
    return `<rect class="collar" x="${x}" y="${CY - 23}" width="14" height="46" rx="3"/>${studs}`;
  }

  function markup(pl, opts = {}) {
    const from = opts.animateFrom == null ? Infinity : opts.animateFrom;
    const count = Math.min(pl.count, PLATES.length);
    let nextLeft = LEFT_COLLAR - GAP;
    let nextRight = RIGHT_COLLAR + GAP;
    let order = 0;
    const plates = [];
    for (let i = 0; i < count; i++) {
      const p = PLATES[i];
      const kind = i < pl.full ? 'earned' : i === pl.full && pl.partial > 0.02 ? 'partial' : 'ghost';
      const lx = nextLeft - p.w;
      nextLeft = lx - GAP;
      const rx = nextRight;
      nextRight = rx + p.w + GAP;
      const o = kind !== 'ghost' && i >= from ? order++ : -1;
      plates.push(plate(p, lx, 'l', kind, pl.partial, o), plate(p, rx, 'r', kind, pl.partial, o));
    }

    const kg = Math.abs(pl.per - 1) < 1e-9 ? '1 kg' : `${U.fmt1(pl.per)} kg`;
    const label = `Sztanga: ${pl.full} z ${pl.count} ${pl.count === 1 ? 'talerza' : 'talerzy'}. Jeden talerz to ${kg} w dół.`;
    const base = opts.delay ? ` style="--base:${opts.delay}ms"` : '';

    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${U.escapeHtml(label)}"${base} xmlns="http://www.w3.org/2000/svg">` +
      '<defs>' +
        '<linearGradient id="wb-chrome" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="#FFFFFF"/><stop offset=".45" stop-color="#E9D5DF"/>' +
          '<stop offset=".6" stop-color="#B99AAB"/><stop offset="1" stop-color="#F5E6EE"/>' +
        '</linearGradient>' +
        '<linearGradient id="wb-shaft" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="#FFC4E1"/><stop offset=".5" stop-color="#FF5CAD"/><stop offset="1" stop-color="#FFA3CF"/>' +
        '</linearGradient>' +
      '</defs>' +
      `<rect class="floor" x="0" y="${CY + 75}" width="${W}" height="2"/>` +
      `<rect x="14" y="${CY - 11}" width="222" height="22" rx="3" fill="url(#wb-chrome)"/>` +
      `<rect x="484" y="${CY - 11}" width="222" height="22" rx="3" fill="url(#wb-chrome)"/>` +
      `<rect x="8" y="${CY - 14}" width="8" height="28" rx="2" fill="url(#wb-chrome)"/>` +
      `<rect x="704" y="${CY - 14}" width="8" height="28" rx="2" fill="url(#wb-chrome)"/>` +
      `<rect x="250" y="${CY - 6}" width="220" height="12" rx="2" fill="url(#wb-shaft)"/>` +
      heart(360, CY, 18, 'bar-heart') +
      collar(236) + collar(470) +
      plates.join('') +
      '</svg>';
  }

  function render(el, pl, opts) {
    el.innerHTML = markup(pl, opts);
  }

  DF.barbell = { render, markup, heart, PLATES };
})(window.DF = window.DF || {});
