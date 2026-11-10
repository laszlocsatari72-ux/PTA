/*
 * P_T_A – érintőképernyős felület (Android WebView-ban és böngészőben is fut).
 * Két mód: „Játék” (2–4 játékos, ember vagy gép, egy eszközön felváltva)
 *          „Oktató” (egy játékos 1–3 gép ellen; tipp, értékelés, a gépi lépések magyarázata).
 * A játék állása minden lépés után mentődik (localStorage), így az app bezárása után is folytatható.
 */
(function (P) {
  'use strict';
  var C = P.coach, COLORS = P.COLORS, eur = P.eur;

  var HEX = { red: '#e53935', blue: '#1f5fd1', yellow: '#f5c400', green: '#2e9e44' };
  var DARK = { red: '#8e1f1c', blue: '#123a80', yellow: '#9a7b00', green: '#1b6129' };
  var LIGHT = { red: '#5a2626', blue: '#24345c', yellow: '#5a4d1c', green: '#22492a' };
  var HU = { red: 'Piros', blue: 'Kék', yellow: 'Sárga', green: 'Zöld' };
  var HUL = P.COLOR_HU;
  var ACCENT = '#ffc928', TIP = '#5cff8a';
  var DELAY_GAME = { slow: 1400, normal: 800, fast: 300 };
  var DELAY_TUTOR = { slow: 2200, normal: 1200 };
  var STEP_MS = 85;
  var EVAL_STYLE = { good: ['JÓ LÉPÉS', '#2e9e44'], ok: ['ELFOGADHATÓ', '#d4a017'], bad: ['JOBB IS LEHETETT VOLNA', '#e53935'] };
  var TILE_INFO = 'A: piros nagy + zöld kis · B: sárga nagy + kék kis · C: sárga kis + zöld nagy · D: piros kis + kék nagy raktár';

  // ---------------- állapot ----------------
  var DEFAULT_SET = {
    kind: { red: 'human', blue: 'ai', yellow: 'off', green: 'off' },
    names: { red: '', blue: '', yellow: '', green: '' },
    target: 35000, teams: false, layout: 'default', custom: ['A', 'B', 'C', 'D'], customRot: [false, false, false, false],
    speed: 'normal',
    tName: '', tColor: 'red', nAi: 2, tSpeed: 'step', tipMode: 'always',
  };
  var S = {
    screen: 'menu', mode: 'tutor', set: JSON.parse(JSON.stringify(DEFAULT_SET)),
    gm: null, game: null, cfg: null, round: 1, totals: {}, labels: {}, counted: false,
    stats: { good: 0, ok: 0, bad: 0 }, tlog: [], seenLog: 0, lastEval: null, aiMsgs: [], aiMsgsPlayer: null,
    setupAssign: null, selField: null, selTarget: null, anim: null, animTimer: null, aiTimer: null,
    hintKey: null, hint: null, tipShown: false, reach: {}, menuErr: '', modal: null, resultClosed: false,
  };
  var CMDS = [];
  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function cmd(fn) { CMDS.push(fn); return CMDS.length - 1; }
  function btn(label, fn, o) {
    o = o || {};
    var cls = [o.primary ? 'primary' : '', o.sel ? 'sel' : '', o.rec ? 'rec' : '', o.cls || ''].join(' ').trim();
    return '<button' + (cls ? ' class="' + cls + '"' : '') + (o.disabled ? ' disabled' : '') +
      (o.style ? ' style="' + o.style + '"' : '') + ' data-c="' + cmd(fn) + '">' + label + '</button>';
  }
  function dot(c) { return '<span class="dot" style="background:' + HEX[c] + '"></span>'; }
  function goodIc(g) {
    if (g === P.DAMAGED) return '<span class="good-ic dmg"></span>';
    return '<span class="good-ic" style="background:' + HEX[g] + '"></span>';
  }
  function tri(c, up) { return '<span class="tri ' + (up ? 'up' : 'down') + '" style="color:' + HEX[c] + '"></span>'; }
  function capFirst(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // ---------------- mentés ----------------
  function store(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* nincs tárhely */ } }
  function load(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function saveSettings() { store('pta_settings', { set: S.set, mode: S.mode }); }
  function saveGame() {
    if (!S.game) return;
    store('pta_save', {
      v: 1, gm: S.gm, game: S.game.toJSON(), cfg: S.cfg, round: S.round, totals: S.totals, labels: S.labels,
      counted: S.counted, stats: S.stats, tlog: S.tlog.slice(-80), seenLog: S.seenLog, lastEval: S.lastEval,
      aiMsgs: S.aiMsgs, aiMsgsPlayer: S.aiMsgsPlayer, resultClosed: S.resultClosed,
    });
  }
  function restore() {
    var st = load('pta_settings');
    if (st && st.set) {
      Object.keys(DEFAULT_SET).forEach(function (k) { if (st.set[k] !== undefined) S.set[k] = st.set[k]; });
      if (st.mode) S.mode = st.mode;
    }
    var sv = load('pta_save');
    if (sv && sv.v === 1 && sv.game) {
      try {
        S.game = P.Game.fromJSON(sv.game);
        ['gm', 'cfg', 'round', 'totals', 'labels', 'counted', 'stats', 'tlog', 'seenLog', 'lastEval', 'aiMsgs',
          'aiMsgsPlayer', 'resultClosed'].forEach(function (k) { if (sv[k] !== undefined) S[k] = sv[k]; });
      } catch (e) { S.game = null; }
    }
  }

  // ---------------- méretezés ----------------
  function layout() {
    var w = window.innerWidth, h = window.innerHeight;
    var portrait = h > w * 1.05;
    var compact = !portrait && (h < 560 || w < 900);
    document.body.classList.toggle('compact', compact || (portrait && w < 560));
    document.body.classList.toggle('portrait', portrait);
    var base = portrait ? Math.min(w / 40, 17) : Math.min(w / 82, h / 46);
    base = Math.max(10.5, Math.min(17, base));
    document.documentElement.style.fontSize = base.toFixed(2) + 'px';
    var side = compact ? Math.min(w * 0.42, base * 19.5) : Math.min(w * 0.32, base * 25);
    document.documentElement.style.setProperty('--side', Math.round(side) + 'px');
    return { compact: compact, portrait: portrait };
  }
  function sideCoach() {
    var b = document.body.classList;
    return b.contains('compact') || b.contains('portrait');
  }

  // ======================================================================
  //  MENÜ
  // ======================================================================
  function previewSvg(order) {
    var B;
    try { B = P.buildBoard(order); } catch (e) { return ''; }
    return '<svg class="preview" viewBox="0 0 1004 580">' + staticSvg(B) + '</svg>';
  }
  function curOrder() {
    var s = S.set;
    return s.custom.map(function (t, i) { return t + (s.customRot[i] ? '*' : ''); });
  }
  function setV(k, v) { S.set[k] = v; saveSettings(); render(); }

  function layoutRows() {
    var s = S.set, h = '';
    h += '<div class="lab">Belső pályaelemek</div><div class="ctl">' +
      btn('Alap', function () { setV('layout', 'default'); }, { sel: s.layout === 'default' }) +
      btn('Véletlen', function () { setV('layout', 'random'); }, { sel: s.layout === 'random' }) +
      btn('Egyéni', function () { setV('layout', 'custom'); }, { sel: s.layout === 'custom' }) + '</div>';
    if (s.layout === 'custom') {
      h += '<div class="full"><div class="tiles">';
      ['Bal fent', 'Jobb fent', 'Bal lent', 'Jobb lent'].forEach(function (slot, i) {
        h += '<div class="tl"><div class="small muted">' + slot + '</div><div class="row">' +
          btn(s.custom[i] + ' elem', function () { cycleTile(i); }) +
          btn('180°', function () { s.customRot[i] = !s.customRot[i]; saveSettings(); render(); }, { sel: s.customRot[i] }) +
          '</div></div>';
      });
      h += '</div><div class="note">' + TILE_INFO + '</div>' + previewSvg(curOrder()) + '</div>';
    } else if (s.layout === 'default') {
      h += '<div class="full">' + previewSvg(null) + '</div>';
    } else {
      h += '<div class="full note">A 4 belső pályaelem véletlen sorrendben, véletlenszerűen elforgatva kerül a táblára.</div>';
    }
    return h;
  }
  function cycleTile(i) {
    var s = S.set, nxt = 'ABCD'[('ABCD'.indexOf(s.custom[i]) + 1) % 4], j = s.custom.indexOf(nxt);
    var t = s.custom[i]; s.custom[i] = s.custom[j]; s.custom[j] = t;
    var r = s.customRot[i]; s.customRot[i] = s.customRot[j]; s.customRot[j] = r;
    saveSettings(); render();
  }

  function renderMenu() {
    var s = S.set, h = '<div class="menu-wrap">';
    h += '<div class="title">P_T_A</div><div class="subtitle">logisztikai társasjáték</div>';
    h += '<div class="tabs">' +
      btn('Oktató – egy játékos a gép ellen', function () { S.mode = 'tutor'; S.menuErr = ''; saveSettings(); render(); }, { sel: S.mode === 'tutor' }) +
      btn('Játék – 2–4 játékos', function () { S.mode = 'game'; S.menuErr = ''; saveSettings(); render(); }, { sel: S.mode === 'game' }) +
      '</div><div class="card">';
    if (S.mode === 'game') {
      h += '<h3>JÁTÉKOSOK</h3>';
      COLORS.forEach(function (c) {
        h += '<div class="prow"><div class="pname">' + dot(c) + ' ' + HU[c] + '</div>';
        [['human', 'Ember'], ['ai', 'Gép'], ['off', 'Nem játszik']].forEach(function (kv) {
          h += btn(kv[1], function () { setKind(c, kv[0]); }, { sel: s.kind[c] === kv[0] });
        });
        h += s.kind[c] !== 'off'
          ? '<input type="text" maxlength="20" placeholder="Név (nem kötelező)" data-in="name:' + c + '" value="' + esc(s.names[c]) + '">'
          : '<div></div>';
        h += '</div>';
      });
      h += '<h3 style="margin-top:.7rem">BEÁLLÍTÁSOK</h3><div class="form">';
      h += targetRow();
      h += '<div class="lab">Páros játék (Piros–Sárga, Kék–Zöld)</div><div class="ctl">' +
        btn('Ki', function () { setV('teams', false); }, { sel: !s.teams }) +
        btn('Be', function () { setTeams(); }, { sel: s.teams }) + '</div>';
      h += '<div class="lab">Gépi játékos sebessége</div><div class="ctl">' +
        btn('lassú', function () { setV('speed', 'slow'); }, { sel: s.speed === 'slow' }) +
        btn('normál', function () { setV('speed', 'normal'); }, { sel: s.speed === 'normal' }) +
        btn('gyors', function () { setV('speed', 'fast'); }, { sel: s.speed === 'fast' }) + '</div>';
      h += layoutRows();
      h += '</div><div class="note">Körsorrend: piros → kék → sárga → zöld. Legalább 2 játékos kell. Páros játékhoz mind a 4 szín kell. ' +
        'Több emberi játékos egy eszközön, felváltva játszik.</div>';
    } else {
      h += '<div class="form">';
      h += '<div class="lab">Neved</div><div class="ctl"><input type="text" maxlength="20" placeholder="Név (nem kötelező)" data-in="tName" value="' +
        esc(s.tName) + '"></div>';
      h += '<div class="lab">A színed</div><div class="ctl">';
      COLORS.forEach(function (c) { h += btn(dot(c) + ' ' + HU[c], function () { setV('tColor', c); }, { sel: s.tColor === c }); });
      h += '</div><div class="lab">Gépi ellenfelek száma</div><div class="ctl">';
      [1, 2, 3].forEach(function (n) { h += btn(String(n), function () { setV('nAi', n); }, { sel: s.nAi === n }); });
      h += '</div>' + targetRow();
      h += '<div class="lab">Gépi lépések</div><div class="ctl">' +
        btn('Lépésenként', function () { setV('tSpeed', 'step'); }, { sel: s.tSpeed === 'step' }) +
        btn('Lassan', function () { setV('tSpeed', 'slow'); }, { sel: s.tSpeed === 'slow' }) +
        btn('Normál', function () { setV('tSpeed', 'normal'); }, { sel: s.tSpeed === 'normal' }) + '</div>';
      h += '<div class="lab">Tipp megjelenítése</div><div class="ctl">' +
        btn('Mindig', function () { setV('tipMode', 'always'); }, { sel: s.tipMode === 'always' }) +
        btn('Csak kérésre', function () { setV('tipMode', 'ask'); }, { sel: s.tipMode === 'ask' }) + '</div>';
      h += layoutRows();
      h += '</div><div class="note">„Lépésenként”: a gépi ellenfelek csak gombnyomásra lépnek, így minden magyarázatot el tudsz olvasni. ' +
        '„Csak kérésre”: előbb próbáld meg magad, a tippet a Tipp gombbal kérheted.</div>';
    }
    h += '</div><div class="menu-btns">';
    var running = S.game && S.game.phase !== 'over';
    if (running) {
      h += btn('Vissza a játékhoz' + (S.gm === 'tutor' ? ' (oktató)' : ''), resumeGame);
      h += btn('Új játék indítása', startGame, { primary: true });
    } else {
      h += btn('Játék indítása', startGame, { primary: true });
    }
    if (window.AndroidApp && window.AndroidApp.exit) h += btn('Kilépés', function () { window.AndroidApp.exit(); });
    h += '</div>';
    if (S.menuErr) h += '<div class="err">' + esc(S.menuErr) + '</div>';
    h += '<div class="note" style="text-align:center;margin-top:1rem">A játék állása automatikusan mentődik.</div></div>';
    $('menu').innerHTML = h;
  }
  function targetRow() {
    var s = S.set;
    return '<div class="lab">Célprofit</div><div class="ctl">' +
      btn('35 000 €', function () { setV('target', 35000); }, { sel: s.target === 35000 }) +
      btn('50 000 €', function () { setV('target', 50000); }, { sel: s.target === 50000 }) + '</div>';
  }
  function setKind(c, v) {
    S.set.kind[c] = v;
    if (v === 'off') S.set.teams = false;
    saveSettings(); render();
  }
  function setTeams() {
    var s = S.set;
    s.teams = true;
    COLORS.forEach(function (c) { if (s.kind[c] === 'off') s.kind[c] = 'ai'; });
    saveSettings(); render();
  }

  // ---------------- indítás ----------------
  function startGame() {
    var s = S.set, players, order = s.layout === 'custom' ? curOrder() : null, cfg;
    if (S.mode === 'game') {
      players = COLORS.filter(function (c) { return s.kind[c] !== 'off'; }).map(function (c) {
        return { color: c, kind: s.kind[c], name: String(s.names[c] || '').trim().slice(0, 20) };
      });
      cfg = { players: players, target: s.target, teams: s.teams, shuffleTiles: s.layout === 'random', tileOrder: order };
    } else {
      var others = COLORS.filter(function (c) { return c !== s.tColor; }).slice(0, s.nAi);
      players = [{ color: s.tColor, kind: 'human', name: String(s.tName || '').trim().slice(0, 20) }]
        .concat(others.map(function (c) { return { color: c, kind: 'ai', name: '' }; }));
      cfg = { players: players, target: s.target, teams: false, shuffleTiles: s.layout === 'random', tileOrder: order };
    }
    var g;
    try { g = new P.Game(cfg.players, cfg); } catch (e) {
      if (!e.isRule) throw e;
      S.menuErr = e.message; render(); return;
    }
    S.menuErr = '';
    S.gm = S.mode;
    S.cfg = cfg;
    S.round = 1; S.totals = {}; S.labels = {};
    S.stats = { good: 0, ok: 0, bad: 0 };
    setGame(g);
  }
  function nextRound() {
    var names = {};
    S.game.players.forEach(function (p) { names[p.color] = p.name; });
    var cfg = JSON.parse(JSON.stringify(S.cfg));
    cfg.players.forEach(function (p) { if (names[p.color]) p.name = names[p.color]; });
    S.round += 1;
    S.modal = null;
    setGame(new P.Game(cfg.players, cfg));
  }
  function setGame(g) {
    S.game = g;
    S.counted = false;
    S.anim = null;
    S.selField = S.selTarget = null;
    S.setupAssign = null;
    S.resultClosed = false;
    S.tlog = [['Új játék. Minden lépésed előtt tippet kapsz, utána értékelést; a gépi ellenfelek minden lépésüket megindokolják.', 'ai']];
    S.seenLog = 0;
    S.lastEval = null;
    S.aiMsgs = []; S.aiMsgsPlayer = null;
    S.hintKey = null; S.tipShown = false;
    S.screen = 'game';
    S.modal = null;
    staticBoard();
    saveGame();
    render();
    scheduleAi();
  }
  function resumeGame() {
    S.screen = 'game';
    staticBoard();
    render();
    scheduleAi();
  }
  function toMenu() {
    stopAi();
    S.screen = 'menu';
    S.modal = null;
    render();
  }

  // ======================================================================
  //  JÁTÉKMENET
  // ======================================================================
  function tutor() { return S.gm === 'tutor'; }
  function canAct() {
    var g = S.game;
    return S.screen === 'game' && g && g.phase !== 'over' && g.players[g.cur].kind === 'human';
  }
  function aiTurn() {
    var g = S.game;
    return S.screen === 'game' && g && g.phase !== 'over' && g.players[g.cur].kind === 'ai';
  }
  function syncLog() {
    var g = S.game;
    for (var i = S.seenLog; i < g.log.length; i++) S.tlog.push([g.log[i], 'log']);
    S.seenLog = g.log.length;
    if (S.tlog.length > 80) S.tlog = S.tlog.slice(-80);
  }
  function getHint() {
    var g = S.game;
    if (!tutor() || !canAct()) return null;
    var key = g.version + '/' + g.phase + '/' + g.cur;
    if (key !== S.hintKey) {
      S.hintKey = key;
      try { S.hint = C.bestChoice(g); } catch (e) { console.error('Tipp hiba:', e); S.hint = null; }
      S.tipShown = S.set.tipMode === 'always';
    }
    return S.hint;
  }
  function tipVisible() { return S.set.tipMode === 'always' || S.tipShown; }
  function showTip() { if (canAct()) { getHint(); S.tipShown = true; render(); } }
  function applyHint() {
    var h = getHint();
    if (!h) return;
    if (S.game.phase === 'trend_setup' && h.assign) {
      S.setupAssign = {};
      P.TREND_FIELDS.forEach(function (f) { S.setupAssign[f] = h.assign[f] ? h.assign[f].slice() : null; });
      render();
    } else if (h.action) {
      send(JSON.parse(JSON.stringify(h.action)));
    }
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add('hidden'); }, 2800);
  }

  function send(a) {
    var g = S.game;
    if (S.anim || !canAct()) return;
    var pi = g.cur, isT = tutor();
    var before = isT ? g.clone() : null;
    var hint = isT ? getHint() : null;
    try { g.act(pi, a); } catch (e) {
      if (e.isRule) { toast(e.message); return; }
      throw e;
    }
    if (isT) {
      syncLog();
      var ev = null;
      try { ev = C.evaluate(before, pi, a, g, hint); } catch (e2) { console.error('Értékelés hiba:', e2); }
      if (ev) {
        S.lastEval = ev;
        S.stats[ev[0]] += 1;
        S.tlog.push([ev[1], ev[0]]);
      }
    }
    afterAction(a.type === 'move');
  }

  function afterAction(moved) {
    var g = S.game;
    S.selField = S.selTarget = null;
    if (g.phase !== 'trend_setup') S.setupAssign = null;
    if (g.phase === 'over' && !S.counted) {
      g.result.forEach(function (e) {
        S.totals[e.account] = (S.totals[e.account] || 0) + e.profit + e.bonus;
        S.labels[e.account] = e.label;
      });
      S.counted = true;
      S.resultClosed = false;
    }
    if (tutor()) syncLog();
    saveGame();
    if (moved && g.lastPath && g.lastPath.path.length > 2) {
      S.anim = { color: g.lastPath.color, path: g.lastPath.path, i: 0 };
      render();
      S.animTimer = setInterval(animStep, STEP_MS);
      return;
    }
    render();
    scheduleAi();
  }

  function animStep() {
    var a = S.anim;
    if (!a || S.screen !== 'game') { clearInterval(S.animTimer); S.anim = null; return; }
    a.i += 1;
    if (a.i >= a.path.length - 1) {
      clearInterval(S.animTimer);
      S.anim = null;
      render();
      scheduleAi();
      return;
    }
    renderBoard();
  }

  function stopAi() { if (S.aiTimer) { clearTimeout(S.aiTimer); S.aiTimer = null; } }
  function scheduleAi() {
    stopAi();
    if (!aiTurn() || S.anim || (S.modal && S.modal.type !== 'result')) return;
    var d;
    if (tutor()) {
      if (S.set.tSpeed === 'step') return;
      d = DELAY_TUTOR[S.set.tSpeed] || 1200;
    } else {
      d = DELAY_GAME[S.set.speed] || 800;
    }
    S.aiTimer = setTimeout(aiTick, d);
  }

  function aiTick() {
    S.aiTimer = null;
    var g = S.game;
    if (!aiTurn() || S.anim) return;
    var pi = g.cur, lp = g.lastPath;
    if (tutor()) {
      if (S.aiMsgsPlayer !== pi) { S.aiMsgs = []; S.aiMsgsPlayer = pi; }
      var before = g.clone(), a = null;
      try {
        a = C.aiDecide(g);
        g.act(pi, a);
      } catch (e) {
        console.error('Gépi döntés hiba:', e);
        a = null;
        try { P.aiStep(g); } catch (e2) { console.error('Gépi játékos hiba:', e2); }
      }
      syncLog();
      if (a) {
        var ex = null;
        try { ex = C.explain(before, pi, a, g); } catch (e3) { console.error('Magyarázat hiba:', e3); }
        if (ex) { S.tlog.push([ex, 'ai']); S.aiMsgs.push(ex); }
      }
    } else {
      try { P.aiStep(g); } catch (e4) { console.error('Gépi játékos hiba:', e4); }
    }
    afterAction(g.lastPath !== null && g.lastPath !== lp);
  }

  // ---------- trendline ----------
  function uiRandomTrend() { return P.Game.prototype.randomTrend.call({ rng: new P.RNG() }); }
  var TREND_OPTS = [null];
  COLORS.forEach(function (c) { TREND_OPTS.push([c, 1], [c, -1]); });
  function sameM(a, b) { return (!a && !b) || (a && b && a[0] === b[0] && a[1] === b[1]); }

  function trendClick(f) {
    var g = S.game;
    if (S.anim || !canAct()) return;
    if (g.phase === 'trend_setup') {
      S.modal = { type: 'pick', field: f };
    } else if (g.phase === 'trend_place') {
      if (g.trend[f]) S.selField = f;
    } else if (g.phase === 'joker' && !g.joker.trend) {
      if (g.trend[f]) { S.selField = f; S.selTarget = null; } else if (S.selField !== null) S.selTarget = f;
    }
    render();
  }
  function finishSetup() {
    var assign = {};
    P.TREND_FIELDS.forEach(function (f) { var m = S.setupAssign[f]; assign[String(f)] = m ? m.slice() : null; });
    send({ type: 'trend_setup', assign: assign });
  }

  // ---------- érintés a táblán ----------
  function boardTap(ev) {
    var g = S.game;
    if (S.screen !== 'game' || S.modal || S.anim || !canAct() || g.phase !== 'act') return;
    var keys = Object.keys(S.reach);
    if (!keys.length) return;
    var svg = $('board'), pt = svg.createSVGPoint();
    pt.x = ev.clientX; pt.y = ev.clientY;
    var m = svg.getScreenCTM();
    if (!m) return;
    var b = pt.matrixTransform(m.inverse());
    var W = g.board.warehouses, i, to;
    for (i = 0; i < keys.length; i++) {
      to = keys[i];
      if (!W[to]) continue;
      var w = W[to];
      if (b.x >= w.x - 18 && b.x <= w.x + w.w + 18 && b.y >= w.y - 18 && b.y <= w.y + w.h + 18) {
        send({ type: 'move', to: to }); return;
      }
    }
    var best = null, bd = 38 * 38;
    for (i = 0; i < keys.length; i++) {
      to = keys[i];
      if (W[to]) continue;
      var n = g.board.nodes[to], d = (n[0] - b.x) * (n[0] - b.x) + (n[1] - b.y) * (n[1] - b.y);
      if (d < bd) { best = to; bd = d; }
    }
    if (best) send({ type: 'move', to: best });
  }

  // ======================================================================
  //  TÁBLA (SVG)
  // ======================================================================
  function r1(v) { return Math.round(v * 10) / 10; }
  function rect(x, y, w, h, fill, extra) {
    return '<rect x="' + r1(x) + '" y="' + r1(y) + '" width="' + r1(w) + '" height="' + r1(h) + '" fill="' + fill + '"' + (extra || '') + '/>';
  }
  function circ(x, y, r, fill, extra) {
    return '<circle cx="' + r1(x) + '" cy="' + r1(y) + '" r="' + r + '" fill="' + fill + '"' + (extra || '') + '/>';
  }
  function txt(x, y, t, size, fill, extra) {
    return '<text x="' + r1(x) + '" y="' + r1(y) + '" font-size="' + size + '" fill="' + fill +
      '" font-family="sans-serif" ' + (extra || '') + '>' + esc(t) + '</text>';
  }

  function staticSvg(B) {
    var s = [];
    s.push(rect(0, 0, B.view[0], B.view[1], '#262a31'));
    B.tiles.forEach(function (t) { s.push(rect(t.x, t.y, t.w, t.h, '#2f8f3e', ' stroke="#257133" stroke-width="3"')); });
    B.roads.forEach(function (pl) {
      var pts = pl.map(function (p) { return r1(p[0]) + ',' + r1(p[1]); });
      if (pts.length === 1) pts.push(pts[0]);
      s.push('<polyline points="' + pts.join(' ') + '" fill="none" stroke="#8f959e" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>');
    });
    B.barriers.forEach(function (b) {
      var w = b.vertical ? 5 : 24, h = b.vertical ? 24 : 5;
      s.push(rect(b.x - w / 2, b.y - h / 2, w, h, '#f5c400', ' stroke="#111"'));
    });
    Object.keys(B.warehouses).forEach(function (wid) {
      var w = B.warehouses[wid];
      s.push(rect(w.x - 4, w.y - 4, w.w + 8, w.h + 8, HEX[w.color]));
      s.push(rect(w.x, w.y, w.w, w.h, '#30343c'));
    });
    Object.keys(B.dots).forEach(function (nid) {
      var n = B.nodes[nid];
      s.push(circ(n[0], n[1], 5, B.dots[nid] === 'y' ? '#ffd23a' : '#fff', ' stroke="#333"'));
    });
    return s.join('');
  }
  function staticBoard() {
    var B = S.game.board;
    $('board').setAttribute('viewBox', '0 0 ' + B.view[0] + ' ' + B.view[1]);
    $('bStatic').innerHTML = staticSvg(B);
  }

  function truckSvg(x, y, color, cargo, active) {
    var x0 = x - 31, y0 = y - 13, s = [];
    if (active) s.push(rect(x0 - 5, y0 - 5, 72, 36, 'none', ' stroke="#fff" stroke-width="3"'));
    s.push(rect(x0, y0, 62, 26, HEX[color], ' stroke="#111" stroke-width="1.5"'));
    s.push(rect(x0 + 48, y0 + 3, 11, 20, DARK[color]));
    for (var i = 0; i < P.TRUCK_CAPACITY; i++) {
      var cx = x0 + 4 + i * 11, it = i < cargo.length ? cargo[i] : null;
      if (it === null) s.push(rect(cx, y0 + 8, 9, 10, DARK[color]));
      else if (it === P.DAMAGED) {
        s.push(rect(cx, y0 + 8, 9, 10, '#555', ' stroke="#111"'));
        s.push('<path d="M' + r1(cx + 1.5) + ' ' + r1(y0 + 9.5) + 'L' + r1(cx + 7.5) + ' ' + r1(y0 + 16.5) + 'M' + r1(cx + 7.5) + ' ' +
          r1(y0 + 9.5) + 'L' + r1(cx + 1.5) + ' ' + r1(y0 + 16.5) + '" stroke="#fff" stroke-width="1.4"/>');
      } else s.push(rect(cx, y0 + 8, 9, 10, HEX[it], ' stroke="#111"'));
    }
    return s.join('');
  }

  function renderBoard() {
    var g = S.game, B = g.board, W = B.warehouses, s = [];
    // tárhelyek és áruk
    Object.keys(W).forEach(function (wid) {
      var w = W[wid], cap = P.SLOT_CAPACITY[w.size];
      g.slotOrder[wid].forEach(function (c, k) {
        var pad = 6, park = 30, sw = (w.w - pad * 3) / 2, sh = (w.h - park - pad * 3) / 2;
        var sx = w.x + pad + (k % 2) * (sw + pad), sy = w.y + pad + Math.floor(k / 2) * (sh + pad);
        s.push(rect(sx, sy, sw, sh, LIGHT[c], ' stroke="' + HEX[c] + '" stroke-width="2.5"'));
        var cell = Math.min((sw - 4) / cap - 3, sh - 10, 17), total = cap * (cell + 3) - 3;
        g.slots[wid][c].forEach(function (gd, i) {
          s.push(rect(sx + (sw - total) / 2 + i * (cell + 3), sy + (sh - cell) / 2, cell, cell, HEX[gd], ' stroke="#000"'));
        });
      });
      var dmg = g.damagedIn[wid].length;
      if (dmg) s.push(txt(w.x + w.w - 4, w.y + w.h - 8, 'sérült: ' + dmg, 11, '#bbb', 'text-anchor="end"'));
    });
    // az utolsó út nyoma
    if (g.lastPath && g.lastPath.path.length > 1 && !S.anim) {
      g.lastPath.path.slice(1, -1).forEach(function (n) {
        var p = B.nodes[n];
        s.push(circ(p[0], p[1], 4, HEX[g.lastPath.color]));
      });
    }
    // elérhető célok
    Object.keys(S.reach).forEach(function (to) {
      var cost = S.reach[to], cx, cy;
      if (W[to]) {
        var w = W[to];
        s.push(rect(w.x - 10, w.y - 10, w.w + 20, w.h + 20, 'none', ' stroke="' + ACCENT + '" stroke-width="4"'));
        cx = w.x + w.w; cy = w.y;
      } else { cx = B.nodes[to][0]; cy = B.nodes[to][1]; }
      s.push(circ(cx, cy, 16, ACCENT, ' stroke="#111" stroke-width="1.5"'));
      s.push(txt(cx, cy + 6, String(cost), 17, '#111', 'text-anchor="middle" font-weight="bold"'));
    });
    // kamionok
    var inWh = {};
    g.players.forEach(function (p, i) {
      var x, y;
      if (S.anim && p.color === S.anim.color) {
        var n = B.nodes[S.anim.path[S.anim.i]];
        s.push(truckSvg(n[0], n[1], p.color, p.cargo, true));
        return;
      }
      if (W[p.pos]) {
        var w = W[p.pos], k = inWh[p.pos] = (inWh[p.pos] || 0) + 1;
        x = w.size === 'S' ? w.x + w.w / 2 : w.x + w.w * (k === 1 ? 0.27 : 0.73);
        y = w.y + w.h - 15;
      } else { x = B.nodes[p.pos][0]; y = B.nodes[p.pos][1]; }
      s.push(truckSvg(x, y, p.color, p.cargo, i === g.cur && g.phase !== 'over'));
    });
    // tipp-jelölés
    var h = tutor() ? getHint() : null;
    if (h && tipVisible() && !S.anim && g.phase !== 'over' && h.target) {
      var to = h.target, lx, ly;
      if (W[to]) {
        var ww = W[to];
        s.push(rect(ww.x - 18, ww.y - 18, ww.w + 36, ww.h + 36, 'none', ' stroke="' + TIP + '" stroke-width="5"'));
        lx = ww.x - 18; ly = ww.y - 22;
      } else {
        var nn = B.nodes[to];
        s.push(circ(nn[0], nn[1], 25, 'none', ' stroke="' + TIP + '" stroke-width="5"'));
        lx = nn[0] + 15; ly = nn[1] - 30;
      }
      s.push(txt(lx, ly, 'TIPP', 20, TIP, 'font-weight="bold" stroke="#111" stroke-width="3" paint-order="stroke"'));
    }
    $('bDyn').innerHTML = s.join('');
  }

  // ======================================================================
  //  PANELEK
  // ======================================================================
  function renderMarkets() {
    var g = S.game, h = '<div class="prices"><div class="hd">PROFIT (ÁRUK ÉRTÉKE)</div>';
    COLORS.forEach(function (c) {
      h += '<div class="cd">' + dot(c) + '</div>';
      P.PRICE_STEPS.forEach(function (v, k) {
        var on = g.prices[c] === k;
        h += '<div class="pc' + (on ? ' on ' + c : '') + '"' + (on ? ' style="background:' + HEX[c] + '"' : '') + '>' +
          String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + '</div>';
      });
    });
    h += '</div><div class="trendbox"><div class="hd">TRENDLINE</div><div class="trend">';
    var trend = (g.phase === 'trend_setup' && S.setupAssign) ? S.setupAssign : g.trend;
    var dsum = g.dice ? g.dice[0] + g.dice[1] : null;
    var clickable = canAct() && !S.anim && (g.phase === 'trend_setup' || g.phase === 'trend_place' || (g.phase === 'joker' && !g.joker.trend));
    for (var f = 2; f <= 12; f++) {
      var cls = 'tc' + (f === 7 ? ' joker' : '') + (f === dsum ? ' dice' : '') + (f === S.selField ? ' selF' : '') +
        (f === S.selTarget ? ' selT' : '') + (clickable && f !== 7 ? ' click' : '');
      var inner = '<div>' + f + '</div><div class="mk">';
      if (f === 7) inner += 'JOKER';
      else if (trend[f]) inner += tri(trend[f][0], trend[f][1] > 0);
      inner += '</div>';
      if (clickable && f !== 7) {
        h += '<div class="' + cls + '" data-c="' + cmd((function (ff) { return function () { trendClick(ff); }; })(f)) + '">' + inner + '</div>';
      } else h += '<div class="' + cls + '">' + inner + '</div>';
    }
    h += '</div></div>';
    $('markets').innerHTML = h;
  }

  function renderTopbar() {
    var g = S.game, info = S.round + '. forduló · cél: ' + eur(g.target) + (g.teams ? ' · páros' : '') +
      (tutor() ? '<br>oktató mód' : '');
    $('topbar').innerHTML = '<span class="logo">P_T_A</span><span class="info">' + info + '</span>' + btn('Menü', toMenu);
  }

  function dieSvg(v) {
    var pos = { 1: [[.5, .5]], 2: [[.25, .25], [.75, .75]], 3: [[.25, .25], [.5, .5], [.75, .75]],
      4: [[.25, .25], [.75, .25], [.25, .75], [.75, .75]], 5: [[.25, .25], [.75, .25], [.5, .5], [.25, .75], [.75, .75]],
      6: [[.25, .22], [.75, .22], [.25, .5], [.75, .5], [.25, .78], [.75, .78]] }[v];
    return '<svg viewBox="0 0 100 100"><rect x="3" y="3" width="94" height="94" rx="16" fill="#f4f4f4" stroke="#111" stroke-width="3"/>' +
      pos.map(function (p) { return '<circle cx="' + p[0] * 100 + '" cy="' + p[1] * 100 + '" r="9" fill="#111"/>'; }).join('') + '</svg>';
  }

  function renderTurn() {
    var g = S.game, h;
    if (g.phase === 'over') {
      h = '<div class="acc" style="font-size:1.2rem">A játék véget ért</div>';
    } else {
      var p = g.players[g.cur];
      h = '<div class="turnrow"><span class="muted">' + g.turnNo + '. kör · soron:</span>' + dot(p.color) +
        '<span class="nm">' + esc(p.name) + (p.kind === 'ai' ? ' (gép)' : '') + '</span></div>';
      if (g.dice) {
        h += '<div class="dice">' + dieSvg(g.dice[0]) + dieSvg(g.dice[1]) + '<span>= ' + (g.dice[0] + g.dice[1]) + '</span>' +
          (g.phase === 'act' ? '<span class="ap">Akciópont: ' + g.ap + '</span>' : '') + '</div>';
      } else h += '<div class="muted" style="margin-top:.3rem">Dobásra vár…</div>';
    }
    $('turn').innerHTML = h;
  }

  function renderActions() {
    var g = S.game, p = g.players[g.cur], h = '';
    if (g.phase === 'over') {
      h = '<p>Az eredmények a felugró ablakban láthatók.</p>' + btn('Eredmények', function () { S.resultClosed = false; render(); }, { primary: true, cls: 'wide' });
    } else if (p.kind === 'ai') {
      if (tutor()) {
        h = '<div class="head ai">' + esc(p.name) + ' (gép) következik</div>';
        if (S.set.tSpeed === 'step') {
          h += btn('Következő gépi lépés', aiTick, { primary: true, cls: 'big', disabled: !!S.anim }) +
            '<p>A gép magyarázata az oktató panelen és a naplóban olvasható.</p>';
        } else h += '<p>A gép magától lép; a magyarázatokat az oktató panelen és a naplóban olvashatod.</p>' +
          btn('Ne várjak – lépjen most', aiTick, { cls: 'wide', disabled: !!S.anim });
      } else h = '<div class="head ai">' + esc(p.name) + ' (gép) lép…</div>';
    } else if (g.phase === 'trend_setup') {
      if (!S.setupAssign) S.setupAssign = uiRandomTrend();
      var n = P.TREND_FIELDS.filter(function (f) { return S.setupAssign[f]; }).length;
      h = '<div class="head">' + esc(p.name) + ', rakd fel a trendjelölőket!</div>' +
        '<p>Koppints a Trendline egy mezőjére, és válaszd ki, melyik jelölő kerüljön oda. Színenként egy felfelé és egy lefelé ' +
        'mutató jelölő kell; 2 mező üres marad.</p><p style="color:' + (n === 8 ? 'var(--text)' : '#ff8a80') + ';font-weight:700">Felrakva: ' + n + '/8</p>' +
        '<div class="row">' + btn('Véletlen kiosztás', function () { S.setupAssign = uiRandomTrend(); render(); }) +
        btn('Kész', finishSetup, { primary: true, disabled: n !== 8 }) + '</div>';
    } else if (g.phase === 'roll') {
      h = '<div class="head">' + esc(p.name) + ', te dobsz!</div>' + btn('Dobás', function () { send({ type: 'roll' }); }, { primary: true, cls: 'big' });
    } else if (g.phase === 'trend_place') {
      var f = g.pendingField;
      h = '<div class="head">' + capFirst(P.az(f)) + ' ' + P.nes(f) + ' mező üres</div>';
      if (S.selField === null) {
        h += '<p>Koppints a Trendline-on egy jelölőre: azt teszed át ide, tetszőleges irányban. Az ár ebben a körben nem változik.</p>';
      } else {
        var m = g.trend[S.selField], sf = S.selField;
        h += '<p style="color:var(--text)">Kiválasztva: ' + sf + '. mező (' + HUL[m[0]] + '). Milyen irányban kerüljön ' + P.az(f) + ' ' + P.nes(f) + ' mezőre?</p>' +
          '<div class="row">' + btn(tri(m[0], true) + ' pozitív', function () { send({ type: 'trend_place', from: sf, dir: 1 }); }) +
          btn(tri(m[0], false) + ' negatív', function () { send({ type: 'trend_place', from: sf, dir: -1 }); }) + '</div>';
      }
    } else if (g.phase === 'joker') {
      h = renderJoker();
    } else if (g.phase === 'act') {
      h = '<div class="head">' + esc(p.name) + ': akciópont ' + g.ap + '</div>' +
        '<p class="help">Haladás: koppints a táblán egy sárga körre vagy kiemelt raktárra (a szám a költség). Sorrend raktáranként: ' +
        'haladás → lerakodás → felrakodás → haladás.</p>' +
        btn(g.ap ? 'Kör vége (' + g.ap + ' pont kimarad)' : 'Kör vége', function () { send({ type: 'end_turn' }); }, { primary: true, cls: 'wide' });
    }
    $('actions').innerHTML = h;
  }

  function renderJoker() {
    var g = S.game, h = '<div class="head">JOKER (7) – mindkettő választható</div>';
    h += '<p style="color:var(--text)">1. Profitjelölő: ' + (g.joker.price ? 'kész' : 'egy színt egyet léptethetsz') + '</p>';
    if (!g.joker.price) {
      h += '<div class="jk">';
      COLORS.forEach(function (c) {
        h += '<div>' + dot(c) + ' ' + HU[c] + ' <span class="muted small">' + eur(g.price(c)) + '</span></div>' +
          btn('▲', function () { send({ type: 'joker_price', color: c, dir: 1 }); }, { disabled: g.prices[c] >= P.PRICE_STEPS.length - 1 }) +
          btn('▼', function () { send({ type: 'joker_price', color: c, dir: -1 }); }, { disabled: g.prices[c] <= 0 });
      });
      h += '</div>';
    }
    var t2;
    if (g.joker.trend) t2 = 'kész';
    else if (S.selField === null) t2 = 'koppints egy jelölőre a Trendline-on';
    else if (S.selTarget === null) t2 = S.selField + '. mező kiválasztva – megfordíthatod, vagy koppints egy üres mezőre az áthelyezéshez';
    else t2 = 'áthelyezés ' + P.az(S.selField) + ' ' + S.selField + '. mezőről ' + P.az(S.selTarget) + ' ' + S.selTarget + '. mezőre – milyen irányban?';
    h += '<p style="color:var(--text)">2. Trendjelölő: ' + t2 + '</p><div class="row">';
    if (!g.joker.trend && S.selField !== null) {
      var sf = S.selField, st = S.selTarget, col = g.trend[sf][0];
      if (st === null) h += btn('Megfordít', function () { send({ type: 'joker_trend_flip', field: sf }); });
      else {
        h += btn(tri(col, true), function () { send({ type: 'joker_trend_move', from: sf, to: st, dir: 1 }); }) +
          btn(tri(col, false), function () { send({ type: 'joker_trend_move', from: sf, to: st, dir: -1 }); });
      }
    }
    h += btn('Tovább a lépéshez', function () { send({ type: 'joker_done' }); }, { primary: true }) + '</div>';
    return h;
  }

  function whName(wid) {
    var w = S.game.board.warehouses[wid];
    return HU[w.color] + ' ' + (w.size === 'L' ? 'nagyraktár' : 'kisraktár');
  }

  function renderWarehouse() {
    var g = S.game, p = g.players[g.cur], el = $('whPanel');
    var show = canAct() && g.phase === 'act' && p.visit && !p.visit.locked && !S.anim;
    el.classList.toggle('hidden', !show);
    if (!show) return;
    var wid = p.visit.wh, w = g.board.warehouses[wid], cap = P.SLOT_CAPACITY[w.size], own = g.slots[wid][p.color];
    var hn = tutor() ? getHint() : null, rec = (hn && tipVisible()) ? hn.action : null;
    var h = '<div class="acc" style="font-size:1.05rem">' + whName(wid) + '</div>';
    h += '<div class="wh-sec">' + (p.visit.loaded ? 'LERAKODÁS – itt már felrakodtál, ide nem rakhatsz le'
      : 'LERAKODÁS a ' + HUL[p.color] + ' tárhelyre (' + own.length + '/' + cap + ')') + '</div><div class="wh-goods">';
    p.cargo.forEach(function (gd, i) {
      var en = !p.visit.loaded && g.ap >= 1, lab;
      if (gd === P.DAMAGED) {
        var cost = w.color === p.color ? P.DAMAGED_COST_OWN : P.DAMAGED_COST_OTHER;
        lab = '−' + eur(cost);
        en = en && g.profitOf(g.account(p)) >= cost;
      } else {
        lab = '+' + eur(g.goodValue(gd, p.color, w.color));
        en = en && own.length < cap;
      }
      var isRec = rec && C.sameAction(rec, { type: 'unload', index: i });
      h += btn(goodIc(gd) + ' ' + lab, function () { send({ type: 'unload', index: i }); }, { disabled: !en, rec: isRec, sel: isRec });
    });
    if (!p.cargo.length) h += '<span class="muted">A kamion üres.</span>';
    h += '</div><div class="wh-sec">FELRAKODÁS (kamion: ' + p.cargo.length + '/' + P.TRUCK_CAPACITY + ')</div>';
    g.slotOrder[wid].forEach(function (sc) {
      if (sc === p.color) return;
      var goods = g.slots[wid][sc];
      h += '<div class="wh-row"><span class="sl">' + dot(sc) + ' ' + HU[sc] + '</span><div class="wh-goods">';
      goods.forEach(function (gd, k) {
        var isRec = rec && C.sameAction(rec, { type: 'load', slot: sc, index: k });
        h += btn(goodIc(gd) + ' ' + eur(g.price(gd)), function () { send({ type: 'load', slot: sc, index: k }); },
          { disabled: !(g.ap >= 1 && p.cargo.length < P.TRUCK_CAPACITY), rec: isRec, sel: isRec });
      });
      if (!goods.length) h += '<span class="muted">üres</span>';
      h += '</div></div>';
    });
    el.innerHTML = h;
  }

  function renderPlayers() {
    var g = S.game, W = g.board.warehouses, h = '<h3>JÁTÉKOSOK</h3><div class="plist">';
    g.players.forEach(function (p, i) {
      h += '<div class="pl' + (i === g.cur && g.phase !== 'over' ? ' cur' : '') + '">' + dot(p.color) +
        '<div class="who"><b>' + esc(p.name) + (p.kind === 'ai' ? ' (gép)' : '') + '</b><span>' + (W[p.pos] ? whName(p.pos) : 'úton') + '</span></div>' +
        '<div class="cg">' + p.cargo.map(goodIc).join('') + '</div><div class="pr">' + eur(g.profitOf(g.account(p))) + '</div></div>';
    });
    $('players').innerHTML = h + '</div>';
  }

  function renderLog() {
    var g = S.game, h = '<h3>' + (tutor() ? 'NAPLÓ ÉS ELEMZÉS' : 'NAPLÓ') + '</h3><div class="log" id="logBox">';
    if (tutor()) {
      var rows = S.tlog.slice(-50);
      rows.forEach(function (r, i) {
        var cls = r[1] === 'log' ? (i === rows.length - 1 ? 'last' : '') : r[1];
        h += '<div class="' + cls + '">' + esc(r[0]) + '</div>';
      });
    } else {
      var lg = g.log.slice(-40);
      lg.forEach(function (l, i) { h += '<div' + (i === lg.length - 1 ? ' class="last"' : '') + '>' + esc(l) + '</div>'; });
    }
    $('logPanel').innerHTML = h + '</div>';
    var b = $('logBox');
    b.scrollTop = b.scrollHeight;
  }

  function renderCoach() {
    var main = $('coach'), side = $('coachSide');
    if (!tutor()) { main.classList.add('hidden'); side.classList.add('hidden'); return; }
    var useSide = sideCoach();
    main.classList.toggle('hidden', useSide);
    side.classList.toggle('hidden', !useSide);
    var g = S.game, p = g.players[g.cur], st = S.stats, L = '', R = '';
    if (g.phase === 'over') {
      L = '<div class="ch" style="color:var(--accent)">VÉGE A JÁTÉKNAK</div><div class="ctext">A lépéseid értékelése: ' +
        st.good + ' jó, ' + st.ok + ' elfogadható, ' + st.bad + ' rossz.</div>';
    } else if (canAct()) {
      var hint = getHint();
      L = '<div class="ch tip">TIPP A KÖVETKEZŐ LÉPÉSHEZ</div>';
      if (hint && tipVisible()) {
        L += '<div class="ctext">' + esc(hint.text) + '</div>';
        var canApply = !!hint.action || (g.phase === 'trend_setup' && hint.assign);
        if (canApply) L += '<div class="cbtns">' + btn('Javaslat végrehajtása', applyHint, { cls: 'tipbtn', disabled: !!S.anim }) + '</div>';
      } else if (hint) {
        L += '<div class="ctext muted">Gondold végig, mit lépnél! Ha segítség kell, kérj tippet.</div><div class="cbtns">' +
          btn('Tipp', showTip, { primary: true }) + '</div>';
      }
    } else {
      L = '<div class="ch ai">' + esc(p.name.toUpperCase()) + ' (GÉP) LÉPÉSEI – MIÉRT?</div><div class="ctext">';
      var msgs = S.aiMsgsPlayer === g.cur ? S.aiMsgs.slice(-3) : [];
      if (!msgs.length) {
        msgs = [p.name + ' következik. ' + (S.set.tSpeed === 'step' ? 'Nyomd meg a „Következő gépi lépés” gombot.' : 'Figyeld a magyarázatokat.')];
      }
      L += msgs.map(function (m) { return '<p>' + esc(m) + '</p>'; }).join('') + '</div>';
    }
    R = '<div class="ch mut">A LEGUTÓBBI LÉPÉSED<span class="stats">' + st.good + ' jó · ' + st.ok + ' elfogadható · ' + st.bad + ' rossz</span></div>';
    if (S.lastEval) {
      var es = EVAL_STYLE[S.lastEval[0]];
      R += '<span class="badge ' + S.lastEval[0] + '" style="background:' + es[1] + '">' + es[0] + '</span><div class="ctext">' + esc(S.lastEval[1]) + '</div>';
    } else R += '<div class="ctext muted">Itt jelenik meg, mennyire volt jó a lépésed, és mit lehetett volna jobban.</div>';
    var html = '<div class="cl">' + L + '</div><div class="cr">' + R + '</div>';
    (useSide ? side : main).innerHTML = html;
    (useSide ? main : side).innerHTML = '';
  }

  // ---------------- felugró ablakok ----------------
  function renderModal() {
    var el = $('modal'), g = S.game, h = '';
    var m = S.modal;
    if (!m && S.screen === 'game' && g && g.phase === 'over' && !S.resultClosed) m = { type: 'result' };
    if (!m) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    if (m.type === 'pick') {
      var f = m.field, cur = S.setupAssign[f], used = [];
      P.TREND_FIELDS.forEach(function (k) { if (k !== f && S.setupAssign[k]) used.push(S.setupAssign[k]); });
      h = '<div class="dlg"><h2>' + capFirst(P.az(f)) + ' ' + P.nes(f) + ' mező jelölője</h2><div class="pick">';
      TREND_OPTS.forEach(function (o) {
        var taken = o && used.some(function (u) { return sameM(u, o); });
        var lab = o ? tri(o[0], o[1] > 0) + ' ' + HU[o[0]] + (o[1] > 0 ? ' fel' : ' le') : 'üres';
        h += btn(lab, function () { S.setupAssign[f] = o ? o.slice() : null; S.modal = null; render(); },
          { disabled: taken, sel: sameM(cur, o) });
      });
      h += '</div><div class="menu-btns">' + btn('Mégse', function () { S.modal = null; render(); }) + '</div></div>';
    } else if (m.type === 'result') {
      h = '<div class="dlg"><h2>A játék véget ért!</h2><table><tr><th>#</th><th>Játékos</th><th class="num">Profit</th><th class="num">Kamionon</th></tr>';
      g.result.forEach(function (e, i) {
        h += '<tr><td><b>' + e.place + '.</b></td><td' + (i === 0 ? ' style="font-weight:700"' : '') + '>' + dot(e.color) + ' ' + esc(e.label) +
          '</td><td class="num"><b>' + eur(e.profit) + '</b></td><td class="num muted">' + eur(e.cargo_value) + '</td></tr>';
      });
      h += '</table><div class="small muted" style="font-weight:700">ÖSSZESÍTÉS (' + S.round + ' forduló, helyezési bónuszokkal)</div><table>';
      Object.keys(S.totals).sort(function (a, b) { return S.totals[b] - S.totals[a]; }).forEach(function (k, i) {
        h += '<tr><td>' + (i + 1) + '. ' + esc(S.labels[k]) + '</td><td class="num"><b>' + eur(S.totals[k]) + '</b></td></tr>';
      });
      h += '</table>';
      if (tutor()) {
        h += '<div style="color:#7ddc8f;font-weight:700;margin-bottom:.5rem">A lépéseid: ' + S.stats.good + ' jó, ' + S.stats.ok +
          ' elfogadható, ' + S.stats.bad + ' rossz.</div>';
      }
      h += '<div class="menu-btns">' + btn('Következő forduló', nextRound, { primary: true }) +
        btn('Tábla megtekintése', function () { S.resultClosed = true; saveGame(); render(); }) + btn('Menü', toMenu) + '</div></div>';
    }
    el.innerHTML = h;
    el.classList.remove('hidden');
  }

  // ======================================================================
  //  RAJZOLÁS
  // ======================================================================
  function render() {
    CMDS = [];
    layout();
    $('menu').classList.toggle('hidden', S.screen !== 'menu');
    $('game').classList.toggle('hidden', S.screen !== 'game');
    if (S.screen === 'menu') {
      renderMenu();
    } else {
      var g = S.game;
      if (tutor()) syncLog();
      S.reach = (canAct() && g.phase === 'act' && !S.anim) ? g.reach(g.cur).res : {};
      if (g.phase === 'trend_setup' && canAct() && !S.setupAssign) S.setupAssign = uiRandomTrend();
      renderMarkets();
      renderBoard();
      renderTopbar();
      renderTurn();
      renderActions();
      renderWarehouse();
      renderCoach();
      renderPlayers();
      renderLog();
    }
    renderModal();
  }

  // ---------------- események ----------------
  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-c]') : null;
    if (!el || el.disabled) return;
    var fn = CMDS[+el.getAttribute('data-c')];
    if (fn) { e.preventDefault(); fn(); }
  });
  document.addEventListener('input', function (e) {
    var k = e.target.getAttribute && e.target.getAttribute('data-in');
    if (!k) return;
    if (k.indexOf('name:') === 0) S.set.names[k.slice(5)] = e.target.value;
    else S.set[k] = e.target.value;
    saveSettings();
  });
  document.addEventListener('keydown', function (e) {           // billentyűzet (pl. Chromebook, böngésző)
    if (e.target.tagName === 'INPUT') return;
    if (e.key === ' ' && S.screen === 'game' && !S.modal && !S.anim && S.game) {
      e.preventDefault();
      if (aiTurn() && tutor()) aiTick();
      else if (canAct() && S.game.phase === 'roll') send({ type: 'roll' });
    } else if ((e.key === 't' || e.key === 'T') && tutor()) showTip();
    else if (e.key === 'Escape') window.onAndroidBack();
  });
  window.addEventListener('resize', function () { render(); });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { stopAi(); saveGame(); } else if (S.screen === 'game') scheduleAi();
  });

  /** Az Android „vissza” gombja: true = a játék kezelte. */
  window.onAndroidBack = function () {
    if (S.modal) { S.modal = null; render(); scheduleAi(); return true; }
    if (S.screen === 'game') { toMenu(); return true; }
    return false;
  };

  // játék közben ne aludjon el a kijelző (böngészőben / iPhone-on; Androidon a Java-indító intézi)
  var wakeLock = null;
  function keepAwake() {
    var want = S.screen === 'game' && !document.hidden;
    try {
      if (want && !wakeLock && navigator.wakeLock && navigator.wakeLock.request) {
        wakeLock = 'kérés';
        navigator.wakeLock.request('screen').then(function (l) {
          wakeLock = l;
          l.addEventListener('release', function () { wakeLock = null; });
        }, function () { wakeLock = null; });
      } else if (!want && wakeLock && wakeLock.release) {
        wakeLock.release();
        wakeLock = null;
      }
    } catch (e) { wakeLock = null; }
  }
  document.addEventListener('click', keepAwake);
  document.addEventListener('visibilitychange', keepAwake);

  window.addEventListener('load', function () {
    $('board').addEventListener('click', boardTap);
    restore();
    render();
  });

  P.app = { S: S, render: render, send: send, aiTick: aiTick };   // teszteléshez
})(PTA);
