/*
 * P_T_A – oktató modul (a coach.py JavaScript-változata):
 *   bestChoice(g)                    – javasolt lépés + indoklás,
 *   aiDecide(g)                      – a gépi játékos döntése (a tanáccsal azonos logikával),
 *   evaluate(before, pi, a, after, hint) – az emberi lépés értékelése: [szint, szöveg] vagy null,
 *   explain(before, pi, a, after)    – egy gépi lépés magyarázata.
 */
var PTA = (typeof PTA !== 'undefined') ? PTA : {};

(function (P) {
  'use strict';
  var COLORS = P.COLORS, PRICE_STEPS = P.PRICE_STEPS, TRUCK_CAPACITY = P.TRUCK_CAPACITY,
    SLOT_CAPACITY = P.SLOT_CAPACITY, WAREHOUSE_TRUCKS = P.WAREHOUSE_TRUCKS,
    DAMAGED_COST_OWN = P.DAMAGED_COST_OWN, DAMAGED_COST_OTHER = P.DAMAGED_COST_OTHER,
    TREND_FIELDS = P.TREND_FIELDS, DAMAGED = P.DAMAGED, rollProb = P.rollProb, hu = P.hu, eur = P.eur,
    cap = P.capitalize;

  var FIELD_ORDER = [6, 8, 5, 9, 4, 10, 3, 11, 2, 12];

  // ---------------- segédek ----------------
  function clone(g) { return g.clone(); }

  function whName(g, wid) {
    var w = g.wh[wid];
    return 'a ' + hu(w.color) + ' ' + (w.size === 'L' ? 'nagyraktár' : 'kisraktár');
  }

  var SUFFIX = { 2: 'es', 3: 'as', 4: 'es', 5: 'ös', 6: 'os', 7: 'es', 8: 'as', 9: 'es', 10: 'es', 11: 'es', 12: 'es' };
  function nes(n) { return n + '-' + (SUFFIX[n] || 'es'); }
  function az(n) { return (n === 1 || n === 5) ? 'az' : 'a'; }
  function pct(s) { return Math.round(rollProb(s) * 100) + '%'; }

  function interest(g, p) {
    var v = {};
    COLORS.forEach(function (c) { v[c] = 0.0; });
    p.cargo.forEach(function (it) { if (it !== DAMAGED) v[it] += 1.0; });
    v[p.color] += 0.4;
    return v;
  }

  function trendValue(g, p, trend) {
    var it = interest(g, p), s = 0;
    TREND_FIELDS.forEach(function (f) {
      var m = trend[f];
      if (m) s += rollProb(f) * m[1] * it[m[0]] * 1000;
    });
    return s;
  }

  function sum(a) { return a.reduce(function (s, x) { return s + x; }, 0); }
  function desc(a, b) { return b - a; }

  function targetScore(g, p, wid, dist) {
    var w = g.wh[wid];
    var free = SLOT_CAPACITY[w.size] - g.slots[wid][p.color].length;
    var normals = p.cargo.filter(function (it) { return it !== DAMAGED; })
      .map(function (it) { return g.goodValue(it, p.color, w.color); }).sort(desc);
    var unload = normals.slice(0, Math.max(0, free));
    var space = TRUCK_CAPACITY - p.cargo.length + unload.length;
    var avail = [];
    COLORS.forEach(function (sc) {
      if (sc === p.color) return;
      g.slots[wid][sc].forEach(function (gd) { avail.push(g.price(gd) + (gd === p.color ? 500 : 0)); });
    });
    avail.sort(desc);
    var score = sum(unload) + 0.6 * sum(avail.slice(0, Math.max(0, space))) - dist * 350;
    if (g.trucksIn(wid) >= WAREHOUSE_TRUCKS[w.size]) score -= 1500;
    return score;
  }

  function cmpStr(a, b) { return a < b ? -1 : (a > b ? 1 : 0); }

  /** Mit lehet egy raktárban tenni `budget` akcióponttal. */
  function visitPlan(g, p, wid, budget, loaded) {
    var w = g.wh[wid], steps = [], cargo = p.cargo.slice();
    if (budget <= 0) return steps;
    if (!loaded) {
      var free = SLOT_CAPACITY[w.size] - g.slots[wid][p.color].length;
      var normals = cargo.filter(function (it) { return it !== DAMAGED; })
        .map(function (it) { return [g.goodValue(it, p.color, w.color), it]; })
        .sort(function (a, b) { return (b[0] - a[0]) || cmpStr(b[1], a[1]); });
      for (var i = 0; i < normals.length; i++) {
        var v = normals[i][0], it = normals[i][1];
        if (budget <= 0 || free <= 0) break;
        if (v < 1000 && cargo.length < TRUCK_CAPACITY) continue;
        steps.push(['unload', it, v]);
        budget -= 1; free -= 1;
        cargo.splice(cargo.indexOf(it), 1);
      }
    }
    var space = TRUCK_CAPACITY - cargo.length;
    var avail = [];
    COLORS.forEach(function (sc) {
      if (sc === p.color) return;
      g.slots[wid][sc].forEach(function (gd) { avail.push([g.price(gd), gd, sc]); });
    });
    avail.sort(function (a, b) { return (b[0] - a[0]) || cmpStr(b[1], a[1]) || cmpStr(b[2], a[2]); });
    for (var j = 0; j < avail.length; j++) {
      if (budget <= 0 || space <= 0) break;
      if (avail[j][0] < 1000) continue;
      steps.push(['load', avail[j][1], avail[j][0], avail[j][2]]);
      budget -= 1; space -= 1;
    }
    return steps;
  }

  function planText(steps, you) {
    if (you === undefined) you = true;
    var unl = steps.filter(function (s) { return s[0] === 'unload'; });
    var lod = steps.filter(function (s) { return s[0] === 'load'; });
    var parts = [];
    if (unl.length) {
      parts.push((you ? 'lerakhatsz' : 'lerakhat') + ' ' + unl.length + ' árut (' +
        unl.map(function (s) { return hu(s[1]); }).join(', ') + ': +' + eur(sum(unl.map(function (s) { return s[2]; }))) + ')');
    }
    if (lod.length) {
      parts.push((you ? 'felvehetsz' : 'felvehet') + ' ' + lod.length + ' árut (' +
        lod.map(function (s) { return hu(s[1]) + ' ' + eur(s[2]); }).join(', ') + ')');
    }
    return parts.join(' és ');
  }

  /** A gépi logika szerinti következő célraktár és távolsága: [wid, dist] vagy [null, null]. */
  function aiTarget(g, pi) {
    var h = clone(g), p = h.players[pi];
    var wid = P.aiTarget(h, p);
    if (!wid) return [null, null];
    var dist = h.bfsFull(p.pos).dist;
    return [wid, (wid in dist) ? dist[wid] : null];
  }

  function colorsByInterest(g, p) {
    var it = interest(g, p);
    return COLORS.slice().sort(function (a, b) { return -it[a] - -it[b]; });
  }

  function suggestSetup(g, p) {
    var order = colorsByInterest(g, p), assign = {};
    TREND_FIELDS.forEach(function (f) { assign[f] = null; });
    order.forEach(function (c, i) { if (i < 4) assign[FIELD_ORDER[i]] = [c, 1]; });
    var neg = [2, 12, 3, 11];
    order.forEach(function (c, i) { if (i < 4) assign[neg[i]] = [c, -1]; });
    return assign;
  }

  // ---------------- lépések leírása és indoklása ----------------
  function describe(g, pi, a, you) {
    if (you === undefined) you = true;
    var p = g.players[pi], t = a.type, m;
    if (t === 'end_turn') return you ? 'fejezd be a kört' : 'befejezi a kört';
    if (t === 'move') {
      var to = a.to, res = g.reach(pi).res;
      var cost = (to in res) ? res[to] : '?';
      if (g.wh[to]) return you ? 'menj ' + whName(g, to) + 'ba (' + cost + ' pont)' : whName(g, to) + 'ba megy (' + cost + ' pont)';
      var h = clone(g);
      h.act(pi, a);
      var wid = aiTarget(h, pi)[0];
      var side = wid ? ', ' + whName(g, wid) + ' felé' : '';
      return (you ? 'lépj a kijelölt pöttyre (' : 'a kijelölt pöttyre lép (') + cost + ' pont)' + side;
    }
    if (t === 'unload') {
      var it = p.cargo[a.index], w = g.wh[p.visit.wh];
      if (it === DAMAGED) {
        var c2 = w.color === p.color ? DAMAGED_COST_OWN : DAMAGED_COST_OTHER;
        return (you ? 'rakd le a sérült árut (−' : 'lerakja a sérült árut (−') + eur(c2) + ')';
      }
      var v = g.goodValue(it, p.color, w.color);
      return (you ? 'rakd le a ' + hu(it) + ' árut (+' : 'lerak egy ' + hu(it) + ' árut (+') + eur(v) + ')';
    }
    if (t === 'load') {
      var gd = g.slots[p.visit.wh][a.slot][a.index];
      if (you) return 'vedd fel a ' + hu(gd) + ' árut a ' + hu(a.slot) + ' tárhelyről (' + eur(g.price(gd)) + ')';
      return 'felvesz egy ' + hu(gd) + ' árut (' + eur(g.price(gd)) + ')';
    }
    if (t === 'trend_place') {
      m = g.trend[a.from];
      return (you ? 'tedd ' : '') + az(a.from) + ' ' + a.from + '. mező ' + hu(m[0]) + ' jelölőjét ' +
        az(g.pendingField) + ' ' + g.pendingField + '. mezőre ' + (you ? '' : 'teszi ') +
        (a.dir > 0 ? 'felfelé mutatva (drágulás)' : 'lefelé mutatva (olcsóbbodás)');
    }
    if (t === 'joker_price') {
      var dirw = a.dir > 0 ? 'felfelé' : 'lefelé';
      return you ? 'léptesd ' + dirw + ' a ' + hu(a.color) + ' árat' : dirw + ' lépteti a ' + hu(a.color) + ' árat';
    }
    if (t === 'joker_trend_flip') {
      m = g.trend[a.field];
      return (you ? 'fordítsd meg ' : 'megfordítja ') + az(a.field) + ' ' + a.field + '. mező ' + hu(m[0]) + ' jelölőjét';
    }
    if (t === 'joker_trend_move') {
      m = g.trend[a.from];
      return (you ? 'tedd át ' : 'áthelyezi ') + az(a.from) + ' ' + a.from + '. mező ' + hu(m[0]) + ' jelölőjét ' +
        az(a.to) + ' ' + a.to + '. mezőre, ' + (a.dir > 0 ? 'felfelé mutatva' : 'lefelé mutatva');
    }
    if (t === 'joker_done') return you ? 'lépj tovább' : 'továbblép';
    if (t === 'trend_setup') return you ? 'rakd fel a jelölőket' : 'felrakja a jelölőket';
    if (t === 'roll') return you ? 'dobj' : 'dob';
    return t;
  }

  function why(g, pi, a, you) {
    if (you === undefined) you = true;
    var p = g.players[pi], t = a.type, txt;
    if (t === 'move') {
      var to = a.to, res = g.reach(pi).res;
      if (g.wh[to]) {
        txt = planText(visitPlan(g, p, to, g.ap - ((to in res) ? res[to] : 0)), you);
        if (txt) return 'Ott ' + txt + '.';
        return you ? 'Onnan a következő körben jobb helyről indulhatsz tovább.' : '';
      }
      var h = clone(g);
      h.act(pi, a);
      var td = aiTarget(h, pi), wid = td[0], d = td[1];
      if (wid) {
        txt = planText(visitPlan(h, h.players[pi], wid, 4), you);
        return 'A legjobb raktár most még nem érhető el; ' + whName(g, wid) + ' onnan ' + d + ' lépés' +
          (txt ? ', ott ' + txt : '') + '.';
      }
      return '';
    }
    if (t === 'unload') {
      var it = p.cargo[a.index];
      if (it === DAMAGED) return 'Felszabadul egy hely a kamionon.';
      var w = g.wh[p.visit.wh];
      if (g.goodValue(it, p.color, w.color) > g.price(it)) txt = 'Saját színű áru a saját színű raktárba: +1 000 € bónusz jár érte.';
      else txt = 'A lerakott áru azonnal profit.';
      if (you) txt += ' Raktárban mindig előbb rakodj le, utána fel – felrakodás után itt már nem rakhatsz le.';
      return txt;
    }
    if (t === 'load') {
      var gd = g.slots[p.visit.wh][a.slot][a.index];
      txt = 'Ez a legdrágább felvehető áru; a következő raktárban a saját tárhely' + (you ? 're' : 'ére') + ' rakva pénzt hoz.';
      if (gd === p.color) txt += ' Saját színű áru: a ' + hu(p.color) + ' raktárak egyikébe víve +1 000 € bónuszt is hoz.';
      return txt;
    }
    if (t === 'end_turn') {
      if (g.ap > 0) return 'A maradék ' + g.ap + ' ponttal most nincs hasznos lépés.';
      return 'Elfogytak az akciópontok.';
    }
    if (t === 'trend_place' || t === 'joker_trend_move' || t === 'joker_trend_flip' || t === 'joker_price') {
      var c;
      if (t === 'joker_price') c = a.color;
      else c = g.trend[a.from !== undefined ? a.from : a.field][0];
      var n = Math.floor(interest(g, p)[c]);
      if (n) txt = 'A ' + hu(c) + ' áruból ' + n + ' db van a kamionon, ezért a drágulása jó' + (you ? '' : ' neki') + '.';
      else if (c === p.color) txt = 'A ' + hu(c) + ' a saját szín' + (you ? 'ed' : 'e') + ': a saját színű áruk bónusszal hoznak pénzt.';
      else txt = 'A ' + hu(c) + ' áru ára most nem érinti a rakományt.';
      if (t === 'trend_place' || t === 'joker_trend_move') {
        var old = g.trend[a.from];
        if (old[1] < 0 && interest(g, p)[old[0]] >= 1) {
          txt += ' Ráadásul így ' + ((a.from === 1 || a.from === 5) ? 'az ' : 'a ') + nes(a.from) +
            ' dobás már nem rontja a ' + hu(old[0]) + ' árat.';
        }
      }
      return txt;
    }
    return '';
  }

  // ---------------- döntés ----------------
  function bestChoice(g) {
    var pi = g.cur, p = g.players[pi], ph = g.phase, a, txt;
    if (ph === 'over') return null;
    if (ph === 'trend_setup') {
      var order = colorsByInterest(g, p);
      txt = 'Javaslat: a számodra fontos színek (' + order.slice(0, 2).map(hu).join(', ') + ') felfelé mutató jelölői a ' +
        'leggyakoribb összegekre (6, 8, 5, 9) kerüljenek, a lefelé mutatók a legritkábbakra (2, 12, 3, 11). Így ezek az ' +
        'áruk gyakran drágulnak és ritkán olcsóbbodnak. (A 6-os és a 8-as esélye 14%, a 2-es és a 12-es csak 3%.)';
      return { action: null, assign: suggestSetup(g, p), text: txt, target: null };
    }
    if (ph === 'roll') return { action: { type: 'roll' }, text: rollTip(g, p), target: null };
    if (ph === 'trend_place') {
      var r = trendPlaceChoice(g, pi);
      a = r[0];
      txt = 'Javaslat: ' + cap(describe(g, pi, a)) + '. ' + why(g, pi, a) + ' (' + cap(az(g.pendingField)) + ' ' +
        nes(g.pendingField) + ' összeg esélye ' + pct(g.pendingField) + '.)';
      return { action: a, text: txt, target: null, score: r[1] };
    }
    if (ph === 'joker') {
      var j = jokerChoice(g, pi);
      return { action: j[0], text: j[1], target: null };
    }
    if (ph === 'act') {
      a = P.aiAction(clone(g), pi);
      var target = a.type === 'move' ? a.to : null;
      txt = ('Javaslat: ' + cap(describe(g, pi, a)) + '. ' + why(g, pi, a)).trim();
      return { action: a, text: txt, target: target };
    }
    return null;
  }

  function aiDecide(g) {
    var pi = g.cur, p = g.players[pi];
    if (g.phase === 'trend_setup') {
      var s = suggestSetup(g, p), assign = {};
      TREND_FIELDS.forEach(function (f) { assign[String(f)] = s[f] ? s[f].slice() : null; });
      return { type: 'trend_setup', assign: assign };
    }
    if (g.phase === 'roll') return { type: 'roll' };
    if (g.phase === 'act') return P.aiAction(g, pi);
    return bestChoice(g).action;
  }

  function copyTrend(t) {
    var o = {};
    TREND_FIELDS.forEach(function (f) { o[f] = t[f]; });
    return o;
  }

  function trendPlaceChoice(g, pi) {
    var p = g.players[pi], base = trendValue(g, p, g.trend), best = null;
    TREND_FIELDS.forEach(function (f) {
      var m = g.trend[f];
      if (!m) return;
      [1, -1].forEach(function (d) {
        var tr = copyTrend(g.trend);
        tr[f] = null;
        tr[g.pendingField] = [m[0], d];
        var sc = trendValue(g, p, tr) - base;
        if (best === null || sc > best[0]) best = [sc, { type: 'trend_place', from: f, dir: d }];
      });
    });
    return [best[1], best[0]];
  }

  function jokerChoice(g, pi) {
    var p = g.players[pi], it = interest(g, p), a;
    if (!g.joker.price) {
      var cands = COLORS.filter(function (c) { return it[c] >= 1 && g.prices[c] < PRICE_STEPS.length - 1; })
        .map(function (c) { return [it[c], c]; });
      if (cands.length) {
        var c = P.maxPair(cands)[1];
        a = { type: 'joker_price', color: c, dir: 1 };
        var gain = PRICE_STEPS[g.prices[c] + 1] - PRICE_STEPS[g.prices[c]];
        return [a, 'Javaslat (JOKER): léptesd felfelé a ' + hu(c) + ' árat (+' + eur(gain) + ' áruként). A kamionodon ' +
          Math.floor(it[c]) + ' ' + hu(c) + ' áru van, így a rakományod azonnal többet ér.'];
      }
    }
    if (!g.joker.trend) {
      var base = trendValue(g, p, g.trend), best = [150.0, null];
      var empty = TREND_FIELDS.filter(function (f) { return g.trend[f] === null; });
      TREND_FIELDS.forEach(function (f) {
        var m = g.trend[f];
        if (!m) return;
        var tr = copyTrend(g.trend);
        tr[f] = [m[0], -m[1]];
        var sc = trendValue(g, p, tr) - base;
        if (sc > best[0]) best = [sc, { type: 'joker_trend_flip', field: f }];
        empty.forEach(function (t) {
          [1, -1].forEach(function (d) {
            var tr2 = copyTrend(g.trend);
            tr2[f] = null;
            tr2[t] = [m[0], d];
            var sc2 = trendValue(g, p, tr2) - base;
            if (sc2 > best[0]) best = [sc2, { type: 'joker_trend_move', from: f, to: t, dir: d }];
          });
        });
      });
      if (best[1]) {
        a = best[1];
        return [a, 'Javaslat (JOKER): ' + describe(g, pi, a) + '. ' + why(g, pi, a)];
      }
    }
    return [{ type: 'joker_done' }, 'Javaslat: lépj tovább – a JOKER-rel most nincs több hasznos változtatás.'];
  }

  function rollTip(g, p) {
    var it = interest(g, p), rows = [];
    TREND_FIELDS.forEach(function (f) {
      var m = g.trend[f];
      if (m && it[m[0]] >= 1) rows.push([rollProb(f) * it[m[0]], f, m]);
    });
    rows.sort(function (a, b) { return (b[0] - a[0]) || (b[1] - a[1]); });
    var txt = 'Dobj! Az akcióérték a nagyobbik kocka. A 7-es (JOKER) esélye 17%, ' +
      'a 6-os és a 8-as 14%, a 2-es és a 12-es csak 3%.';
    if (!p.cargo.some(function (c) { return c !== DAMAGED; })) {
      return txt + ' A kamionod üres, így most az árváltozások nem érintenek közvetlenül.';
    }
    var parts = rows.slice(0, 3).map(function (r) {
      var f = r[1], m = r[2];
      return nes(f) + ' (' + pct(f) + '): a ' + hu(m[0]) + ' ár ' + (m[1] > 0 ? 'nő' : 'csökken') + ' – ' +
        (m[1] > 0 ? 'jó neked' : 'rossz neked');
    });
    if (parts.length) txt += ' Rád nézve fontos: ' + parts.join('; ') + '.';
    return txt;
  }

  // ---------------- értékelés és magyarázat ----------------
  function moveQuality(before, pi, a, rec) {
    var p = before.players[pi], to = a.to;
    var h = clone(before);
    h.act(pi, a);
    var q = h.players[pi];
    if (rec.type === 'move' && before.wh[rec.to]) {
      var rw = rec.to;
      if (before.wh[to]) {
        var sRec = targetScore(before, p, rw, 0), sNew = targetScore(before, p, to, 0);
        if (sNew >= sRec - 300) {
          return ['good', 'Jó választás: ' + whName(before, to) + ' ugyanolyan jó, mint a javasolt ' + whName(before, rw).slice(2) + '.'];
        }
        var wn = whName(before, to);
        return ['ok', wn.charAt(0).toUpperCase() + wn.slice(1) + ' is jó, de ' + whName(before, rw) + ' jobb lett volna: ott ' +
          (planText(visitPlan(before, p, rw, before.ap)) || 'több lehetőség van') + '.'];
      }
      var res = h.reach(pi).res;
      if (rw in res) return ['good', 'Rendben, innen még ebben a körben eléred ' + whName(before, rw) + 't.'];
      return ['bad', 'Így ebben a körben már nem éred el ' + whName(before, rw) + 't, pedig ott ' +
        (planText(visitPlan(before, p, rw, before.ap)) || 'jó lehetőségek vannak') + '.'];
    }
    var td = aiTarget(before, pi), wid = td[0], d0 = td[1];
    if (before.wh[to]) return ['good', 'Raktárba értél – nézd meg, mit rakhatsz le és fel.'];
    if (wid && d0 !== null) {
      var d1 = h.bfsFull(q.pos).dist;
      var r0 = before.reach(pi).res;
      var cost = (to in r0) ? r0[to] : 0;
      var dw = (wid in d1) ? d1[wid] : 99;
      if (dw <= d0 - cost) return ['good', 'Jó irány: a legrövidebb úton közeledsz ' + whName(before, wid) + 'hoz.'];
      if (dw < d0) return ['ok', 'Közeledsz ' + whName(before, wid) + 'hoz, de rövidebb úton is mehettél volna.'];
      return ['bad', 'Ezzel nem kerültél közelebb ' + whName(before, wid) + 'hoz, ahová most érdemes menni.'];
    }
    return ['ok', 'Rendben.'];
  }

  function canon(v) {
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === 'object') {
      var o = {};
      Object.keys(v).sort().forEach(function (k) { o[k] = canon(v[k]); });
      return o;
    }
    return v;
  }
  function sameAction(a, b) { return JSON.stringify(canon(a)) === JSON.stringify(canon(b)); }

  function evaluate(before, pi, a, after, hint) {
    var t = a.type, p = before.players[pi];
    if (t === 'roll') return null;
    if (t === 'trend_setup') {
      var tr = {};
      TREND_FIELDS.forEach(function (f) { tr[f] = null; });
      Object.keys(a.assign).forEach(function (k) { var m = a.assign[k]; tr[parseInt(k, 10)] = m ? [m[0], parseInt(m[1], 10)] : null; });
      var chosen = trendValue(before, p, tr), best = trendValue(before, p, suggestSetup(before, p));
      if (chosen >= best - 150) return ['good', 'Jó kiosztás: a számodra fontos áruk a gyakori összegeken drágulnak.'];
      return ['ok', 'Elfogadható kiosztás. Jobb, ha a nálad lévő színek felfelé mutató jelölői a 6-os és 8-as ' +
        'mezőn vannak, a lefelé mutatók pedig a 2-es és 12-es mezőn.'];
    }
    if (!hint || !hint.action) return null;
    var rec = hint.action;
    if (sameAction(a, rec)) return ['good', 'Jó lépés! Pontosan ezt javasoltam.'];
    var recDesc = describe(before, pi, rec);

    if (before.phase === 'trend_place') {
      var base = trendValue(before, p, before.trend);
      var loss = (hint.score || 0) - (trendValue(before, p, after.trend) - base);
      if (loss <= 60) return ['good', 'Jó választás, ugyanolyan jó, mint a javaslatom.'];
      return ['ok', 'Elfogadható. Jobb lett volna: ' + recDesc + '. ' + why(before, pi, rec)];
    }
    if (before.phase === 'joker') {
      if (t === 'joker_done') return ['ok', 'Továbbléptél. A JOKER-rel még ezt tehetted volna: ' + recDesc + '.'];
      if (t === 'joker_price') {
        var it = interest(before, p);
        if (a.dir > 0 && it[a.color] >= 1) return ['good', 'Jó: olyan áru drágult, ami nálad van.'];
        if (a.dir < 0 && it[a.color] >= 1) return ['bad', 'Ezzel a saját rakományod ér kevesebbet! Jobb lett volna: ' + recDesc + '.'];
        return ['ok', 'Ennek az árunak a változása most nem érint. Jobb lett volna: ' + recDesc + '.'];
      }
      var delta = trendValue(before, p, after.trend) - trendValue(before, p, before.trend);
      if (delta > 0) return ['good', 'Jó: a jelölők most kedvezőbben állnak neked.'];
      return ['ok', 'Ez nem javított a helyzeteden. Jobb lett volna: ' + recDesc + '.'];
    }

    if (t === 'end_turn') {
      if (before.ap > 0 && rec.type !== 'end_turn') {
        return ['bad', 'Maradt még ' + before.ap + ' akciópontod, és lett volna hasznos lépés: ' + recDesc + '.'];
      }
      return ['good', 'Rendben.'];
    }
    if (t === 'load') {
      if (rec.type === 'unload') {
        return ['bad', 'Vigyázz: felrakodás után ebben a raktárban már nem rakhatsz le! Előbb ezt kellett volna: ' + recDesc + '.'];
      }
      var gd = before.slots[p.visit.wh][a.slot][a.index];
      if (rec.type === 'load') {
        var rg = before.slots[p.visit.wh][rec.slot][rec.index];
        if (before.price(gd) >= before.price(rg)) return ['good', 'Jó: ez is a legdrágább felvehető áruk egyike.'];
        return ['ok', 'A ' + hu(rg) + ' áru drágább lett volna (' + eur(before.price(gd)) + ' helyett ' + eur(before.price(rg)) + ').'];
      }
      if (before.price(gd) < 1000) return ['bad', 'Ez az áru most semmit sem ér – nem érdemes rá akciópontot költeni.'];
      return ['ok', 'Elfogadható. A javaslatom ez volt: ' + recDesc + '.'];
    }
    if (t === 'unload') {
      var item = p.cargo[a.index];
      if (item === DAMAGED) {
        return ['ok', 'A sérült áru lerakása pénzbe kerül, de helyet szabadít fel. Saját színű raktárban a legolcsóbb (2 000 €).'];
      }
      var w = before.wh[p.visit.wh];
      var v = before.goodValue(item, p.color, w.color);
      if (rec.type === 'unload' && rec.index < p.cargo.length) {
        var ri = p.cargo[rec.index];
        var rv = ri !== DAMAGED ? before.goodValue(ri, p.color, w.color) : 0;
        if (v >= rv) return ['good', 'Jó lépés: +' + eur(v) + '.'];
        return ['ok', 'Jó, de előbb a ' + hu(ri) + ' árut érdemes lerakni (+' + eur(v) + ' helyett +' + eur(rv) + ').'];
      }
      if (v < 1000) return ['ok', 'Ez az áru most olcsó (' + eur(v) + '); érdemes lehet megvárni, amíg drágul.'];
      return ['good', 'Jó: a lerakott áru azonnal profit (+' + eur(v) + ').'];
    }
    if (t === 'move') {
      if ((rec.type === 'unload' || rec.type === 'load') && p.visit) {
        return ['bad', 'Elhagytad a raktárat, pedig itt még ezt tehetted volna: ' + recDesc + '.'];
      }
      if (rec.type !== 'move') return ['ok', 'Rendben. A javaslatom ez volt: ' + recDesc + '.'];
      return moveQuality(before, pi, a, rec);
    }
    return null;
  }

  function explain(before, pi, a) {
    var p = before.players[pi], t = a.type;
    if (t === 'roll' || t === 'joker_done') return null;
    if (t === 'trend_setup') {
      var order = colorsByInterest(before, p);
      return p.name + ' felrakta a trendjelölőket: a neki fontos színek (' + order.slice(0, 2).map(hu).join(', ') +
        ') felfelé mutatva a gyakori összegekre kerültek, a lefelé mutatók a ritkákra.';
    }
    if (t === 'end_turn') {
      if (before.ap > 0) return p.name + ' befejezi a kört; a maradék ' + before.ap + ' pontjával nem talált hasznos lépést.';
      return null;
    }
    var txt = p.name + ' ' + describe(before, pi, a, false) + '.';
    var w = why(before, pi, a, false);
    if (w) txt += ' ' + w;
    return txt;
  }

  P.coach = {
    clone: clone, whName: whName, nes: nes, az: az, pct: pct, interest: interest, trendValue: trendValue,
    targetScore: targetScore, visitPlan: visitPlan, planText: planText, aiTarget: aiTarget,
    suggestSetup: suggestSetup, describe: describe, why: why, bestChoice: bestChoice, aiDecide: aiDecide,
    trendPlaceChoice: trendPlaceChoice, jokerChoice: jokerChoice, rollTip: rollTip,
    evaluate: evaluate, explain: explain, sameAction: sameAction,
  };
  P.nes = nes; P.az = az;
})(PTA);
