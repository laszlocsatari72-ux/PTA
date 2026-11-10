/*
 * P_T_A – játékmotor (szabályok + gépi játékos) – az engine.py JavaScript-változata.
 * A felülettől független; az app.js és a coach.js használja.
 */
var PTA = (typeof PTA !== 'undefined') ? PTA : {};

(function (P) {
  'use strict';

  var COLORS = ['red', 'blue', 'yellow', 'green'];          // ülésrend = körsorrend
  var COLOR_HU = { red: 'piros', blue: 'kék', yellow: 'sárga', green: 'zöld' };
  var TEAM_OF = { red: 'red+yellow', yellow: 'red+yellow', blue: 'blue+green', green: 'blue+green' };
  var TEAM_HU = { 'red+yellow': 'Piros–Sárga csapat', 'blue+green': 'Kék–Zöld csapat' };

  // ---------------- Szabály-paraméterek ----------------
  var PRICE_STEPS = [0, 1000, 1500, 2000, 3000];
  var PRICE_START_INDEX = 2;
  var TRUCK_CAPACITY = 4;
  var SLOT_CAPACITY = { L: 4, S: 2 };
  var WAREHOUSE_TRUCKS = { L: 2, S: 1 };
  var OWN_BONUS = 1000;
  var DAMAGED_COST_OWN = 2000;
  var DAMAGED_COST_OTHER = 3000;
  var TREND_FIELDS = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12];
  var DAMAGED = 'X';
  var PLACE_BONUS_SOLO = [8000, 4000, 2000, 0];
  var PLACE_BONUS_TEAM = [8000, 0];

  function hu(c) { return COLOR_HU[c] || c; }

  function eur(v) {
    var neg = v < 0, s = String(Math.abs(v));
    s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return (neg ? '-' : '') + s + ' €';
  }

  function rollProb(s) { return (6 - Math.abs(s - 7)) / 36.0; }

  function capitalize(s) {      // a Python str.capitalize() megfelelője
    return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
  }

  function RuleError(msg) {
    var e = new Error(msg);
    e.name = 'RuleError';
    e.isRule = true;
    return e;
  }

  // ---------------- véletlenszám (mulberry32, menthető állapot) ----------------
  function RNG(seed) {
    if (seed === undefined || seed === null) seed = Math.floor(Math.random() * 4294967296);
    this.state = seed >>> 0;
  }
  RNG.prototype.random = function () {
    var t = (this.state = (this.state + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  RNG.prototype.randint = function (a, b) { return a + Math.floor(this.random() * (b - a + 1)); };
  RNG.prototype.choice = function (seq) { return seq[Math.floor(this.random() * seq.length)]; };
  RNG.prototype.shuffle = function (arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(this.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
  };

  // ---------------- játékos ----------------
  function Player(color, name, kind) {
    this.color = color;
    this.name = String(name || '').trim() || capitalize(COLOR_HU[color]);
    this.kind = kind;            // 'human' vagy 'ai'
    this.pos = null;
    this.cargo = [];
    this.lastWh = null;
    this.visit = null;           // {wh, loaded, locked}
  }
  Player.prototype.label = function () {
    if (this.name.toLowerCase() === hu(this.color)) return this.name;
    return this.name + ' (' + hu(this.color) + ')';
  };

  function emptyTrend() {
    var t = {};
    TREND_FIELDS.forEach(function (f) { t[f] = null; });
    return t;
  }

  // ---------------- játék ----------------
  function Game(players, opts) {
    opts = opts || {};
    if (opts._blank) return;
    var target = opts.target === undefined ? 35000 : opts.target;
    var teams = !!opts.teams;
    this.rng = new RNG(opts.seed);
    var order;
    if (opts.shuffleTiles) {
      order = P.DEFAULT_TILE_ORDER.slice();
      this.rng.shuffle(order);
      var self = this;
      order = order.map(function (t) { return t + (self.rng.random() < 0.5 ? '*' : ''); });
    } else {
      try { order = P.normalizeOrder(opts.tileOrder); } catch (e) { throw RuleError(e.message); }
    }
    this._setBoard(order);

    var seat = {};
    COLORS.forEach(function (c, i) { seat[c] = i; });
    players = players.slice().sort(function (a, b) { return seat[a.color] - seat[b.color]; });
    var colors = players.map(function (p) { return p.color; });
    if (players.length < 2) throw RuleError('Legalább 2 játékos kell.');
    if (colors.some(function (c, i) { return colors.indexOf(c) !== i; })) throw RuleError('Egy színt csak egy játékos választhat.');
    if (teams && players.length !== 4) throw RuleError('Páros játékhoz 4 játékos kell.');
    this.players = players.map(function (p) { return new Player(p.color, p.name, p.kind || 'human'); });
    this.target = parseInt(target, 10);
    this.teams = teams;

    this.profit = {};
    this.profitSeq = {};
    this.seq = 0;
    this.prices = {};
    var prices = this.prices;
    COLORS.forEach(function (c) { prices[c] = PRICE_START_INDEX; });
    this.trend = emptyTrend();
    this.slots = {}; this.slotOrder = {}; this.damagedIn = {};
    this.log = [];
    this.version = 0;
    this.dice = null;
    this.ap = 0;
    this.joker = null;
    this.pendingField = null;
    this.finisher = null;
    this.result = null;
    this.lastPath = null;
    this.turnNo = 1;
    this._setupGoods();
    this.players.forEach(function (p) {
      var start = 'W_' + p.color + '_S';
      p.pos = start;
      p.lastWh = start;
      p.visit = { wh: start, loaded: false, locked: true };
    });
    this._rollOff();
    var n = this.players.length;
    this.cur = ((this.starter - 1) % n + n) % n;   // a kezdőtől jobbra ülő rakja fel a trendjelölőket
    this.phase = 'trend_setup';
    this._log(this.players[this.cur].label() + ' helyezi fel a TRENDLINE jelölőket.');
  }

  Game.prototype._setBoard = function (order) {
    this.board = P.buildBoard(order);
    this.adj = this.board.adj;          // rendezett listák
    this.wh = this.board.warehouses;
  };

  // ---------------- segédfüggvények ----------------
  Game.prototype._log = function (msg) { this.log.push(msg); };
  Game.prototype._touch = function () { this.version += 1; };
  Game.prototype.account = function (p) { return this.teams ? TEAM_OF[p.color] : p.color; };
  Game.prototype.profitOf = function (acct) { return this.profit[acct] || 0; };
  Game.prototype.price = function (color) { return PRICE_STEPS[this.prices[color]]; };
  Game.prototype.goodValue = function (good, playerColor, whColor) {
    return this.price(good) + ((good === playerColor && playerColor === whColor) ? OWN_BONUS : 0);
  };
  Game.prototype._addProfit = function (p, amount) {
    var acct = this.account(p);
    this.profit[acct] = this.profitOf(acct) + amount;
    this.seq += 1;
    this.profitSeq[acct] = this.seq;
  };
  Game.prototype.trucksIn = function (wid) {
    return this.players.filter(function (q) { return q.pos === wid; }).length;
  };
  Game.prototype.canEnter = function (p, wid) {
    return wid !== p.pos && wid !== p.lastWh && this.trucksIn(wid) < WAREHOUSE_TRUCKS[this.wh[wid].size];
  };
  Game.prototype.cargoValue = function (p) {
    if (p.cargo.indexOf(DAMAGED) >= 0) return 0;
    var g = this;
    return p.cargo.reduce(function (s, it) { return s + g.price(it); }, 0);
  };
  Game.prototype.playerIndex = function (p) { return this.players.indexOf(p); };

  // ---------------- előkészítés ----------------
  Game.prototype._setupGoods = function () {
    var g = this, bag = {};
    COLORS.forEach(function (c) { bag[c] = 11; });
    function takeRandom() {
      var pool = [];
      COLORS.forEach(function (c) { for (var i = 0; i < bag[c]; i++) pool.push(c); });
      var c = g.rng.choice(pool);
      bag[c] -= 1;
      return c;
    }
    var wids = Object.keys(g.wh);
    wids.forEach(function (wid) {
      var order = COLORS.slice();
      g.rng.shuffle(order);
      g.slotOrder[wid] = order;
      g.slots[wid] = {};
      COLORS.forEach(function (c) { g.slots[wid][c] = []; });
      g.damagedIn[wid] = [];
    });
    wids.forEach(function (wid) {
      if (g.wh[wid].size !== 'L') return;
      var goods = [];
      COLORS.forEach(function (c) { goods.push(c, c); });
      g.rng.shuffle(goods);
      COLORS.forEach(function (c) {
        for (var i = 0; i < 2; i++) {
          var gd = goods.pop();
          bag[gd] -= 1;
          g.slots[wid][c].push(gd);
        }
      });
    });
    wids.forEach(function (wid) { g.slots[wid][g.wh[wid].color].push(takeRandom()); });
    g.players.forEach(function (p) { p.cargo = [DAMAGED, takeRandom()]; });
  };

  Game.prototype._rollOff = function () {
    var g = this;
    var cands = g.players.map(function (_, i) { return i; });
    for (;;) {
      var rolls = {};
      cands.forEach(function (i) { rolls[i] = g.rng.randint(1, 6) + g.rng.randint(1, 6); });
      g._log('Kezdő dobás: ' + cands.map(function (i) { return g.players[i].name + ' ' + rolls[i]; }).join(', '));
      var best = Math.max.apply(null, cands.map(function (i) { return rolls[i]; }));
      cands = cands.filter(function (i) { return rolls[i] === best; });
      if (cands.length === 1) {
        g.starter = cands[0];
        g._log('Kezdő játékos: ' + g.players[g.starter].label() + '.');
        return;
      }
    }
  };

  Game.prototype.randomTrend = function () {
    var fields = TREND_FIELDS.slice();
    this.rng.shuffle(fields);
    var markers = [];
    COLORS.forEach(function (c) { markers.push([c, 1], [c, -1]); });
    this.rng.shuffle(markers);
    var out = emptyTrend();
    for (var i = 0; i < Math.min(fields.length, markers.length); i++) out[fields[i]] = markers[i];
    return out;
  };

  // ---------------- mozgás ----------------
  /** Az aktuális akciópontokkal elérhető célok: {res: {cél: költség}, prev: előd-térkép}. */
  Game.prototype.reach = function (pi) {
    var g = this, p = g.players[pi];
    if (g.phase !== 'act' || g.ap <= 0) return { res: {}, prev: {} };
    var occ = {};
    g.players.forEach(function (q) { if (q !== p && !g.wh[q.pos]) occ[q.pos] = true; });
    var start = p.pos, dist = {}, prev = {}, res = {};
    dist[start] = 0;
    var dq = [start], head = 0;
    while (head < dq.length) {
      var u = dq[head++];
      if (dist[u] >= g.ap) continue;
      var nb = g.adj[u];
      for (var i = 0; i < nb.length; i++) {
        var v = nb[i];
        if (v in dist) continue;
        if (g.wh[v]) {
          if (g.canEnter(p, v)) { dist[v] = dist[u] + 1; prev[v] = u; res[v] = dist[v]; }
          continue;
        }
        dist[v] = dist[u] + 1;
        prev[v] = u;
        dq.push(v);
        if (!occ[v]) res[v] = dist[v];      // át lehet haladni rajta, de megállni nem
      }
    }
    return { res: res, prev: prev };
  };

  /** Távolság mindenhová (foglaltság és akciópont nélkül) – a gépi játékosnak. */
  Game.prototype.bfsFull = function (start) {
    var g = this, dist = {}, prev = {};
    dist[start] = 0;
    var dq = [start], head = 0;
    while (head < dq.length) {
      var u = dq[head++];
      if (g.wh[u] && u !== start) continue;
      var nb = g.adj[u];
      for (var i = 0; i < nb.length; i++) {
        var v = nb[i];
        if (!(v in dist)) { dist[v] = dist[u] + 1; prev[v] = u; dq.push(v); }
      }
    }
    return { dist: dist, prev: prev };
  };

  // ---------------- akciók ----------------
  var HANDLERS = {
    'trend_setup/trend_setup': '_trendSetup',
    'trend_setup/trend_random': '_trendRandom',
    'roll/roll': '_roll',
    'trend_place/trend_place': '_trendPlace',
    'joker/joker_price': '_jokerPrice',
    'joker/joker_trend_move': '_jokerTrendMove',
    'joker/joker_trend_flip': '_jokerTrendFlip',
    'joker/joker_done': '_jokerDone',
    'act/move': '_move',
    'act/unload': '_unload',
    'act/load': '_load',
    'act/end_turn': '_endTurn',
  };

  Game.prototype.act = function (pi, a) {
    if (this.phase === 'over') throw RuleError('A játék véget ért.');
    if (pi !== this.cur) throw RuleError('Nem te következel.');
    var h = HANDLERS[this.phase + '/' + a.type];
    if (!h) throw RuleError('Ez a lépés most nem lehetséges.');
    this[h](this.players[pi], a);
    this._touch();
  };

  function toInt(v, dflt) {
    var n = parseInt(v, 10);
    return isNaN(n) ? (dflt === undefined ? NaN : dflt) : n;
  }
  function inFields(f) { return TREND_FIELDS.indexOf(f) >= 0; }

  Game.prototype._trendSetup = function (p, a) {
    var nw = emptyTrend(), used = {}, count = 0;
    var assign = a.assign || {};
    Object.keys(assign).forEach(function (k) {
      var f = toInt(k), v = assign[k];
      if (!inFields(f)) throw RuleError('A JOKER (7-es) mezőre nem tehető jelölő.');
      if (!v) return;
      var c = v[0], d = toInt(v[1]);
      if (COLORS.indexOf(c) < 0 || (d !== 1 && d !== -1)) throw RuleError('Érvénytelen jelölő.');
      var key = c + d;
      if (used[key]) throw RuleError('A ' + hu(c) + ' ' + (d > 0 ? 'pozitív' : 'negatív') + ' jelölő kétszer szerepel.');
      used[key] = true; count++;
      nw[f] = [c, d];
    });
    if (count !== 8) throw RuleError('Mind a 8 jelölőt fel kell tenni: színenként egy pozitív és egy negatív (2 mező marad üresen).');
    this._finishSetup(p, nw);
  };
  Game.prototype._trendRandom = function (p) { this._finishSetup(p, this.randomTrend()); };
  Game.prototype._finishSetup = function (p, trend) {
    this.trend = trend;
    this._log(p.name + ' felrakta a trendjelölőket.');
    this.cur = this.starter;
    this.phase = 'roll';
  };

  Game.prototype._roll = function (p) {
    var d1 = this.rng.randint(1, 6), d2 = this.rng.randint(1, 6);
    this.dice = [d1, d2];
    this.ap = Math.max(d1, d2);
    var s = d1 + d2;
    this.lastPath = null;
    var msg = p.name + ' dobása: ' + d1 + '+' + d2 + '=' + s + ', akcióérték: ' + this.ap + '.';
    if (s === 7) {
      this._log(msg + ' JOKER!');
      this.joker = { price: false, trend: false };
      this.phase = 'joker';
    } else if (this.trend[s] === null) {
      this._log(msg + ' A ' + s + '-es mező üres – jelölőt kell rátenni.');
      this.pendingField = s;
      this.phase = 'trend_place';
    } else {
      this._log(msg);
      this._applyTrend(s);
      this.phase = 'act';
    }
  };

  Game.prototype._applyTrend = function (s) {
    var c = this.trend[s][0], d = this.trend[s][1];
    var ni = this.prices[c] + d;
    if (ni < 0 || ni >= PRICE_STEPS.length) {
      this.trend[s] = [c, -d];
      this._log('A ' + hu(c) + ' ár a határon van – a ' + s + '-es trendjelölő megfordult.');
    } else {
      this.prices[c] = ni;
      this._log('A ' + hu(c) + ' áru értéke ' + (d > 0 ? 'nőtt' : 'csökkent') + ': ' + eur(this.price(c)) + '.');
    }
  };

  Game.prototype._trendPlace = function (p, a) {
    var f = toInt(a.from), d = toInt(a.dir);
    if (!inFields(f) || this.trend[f] === null) throw RuleError('Azon a mezőn nincs jelölő.');
    if (d !== 1 && d !== -1) throw RuleError('Érvénytelen irány.');
    var c = this.trend[f][0];
    this.trend[f] = null;
    this.trend[this.pendingField] = [c, d];
    this._log(p.name + ' a ' + f + '-es mezőről a ' + this.pendingField + '-es mezőre tette a ' + hu(c) +
      ' jelölőt (' + (d > 0 ? 'pozitív' : 'negatív') + ' irányban).');
    this.pendingField = null;
    this.phase = 'act';
  };

  Game.prototype._jokerPrice = function (p, a) {
    if (this.joker.price) throw RuleError('A profitjelölőt már mozgattad.');
    var c = a.color, d = toInt(a.dir);
    if (COLORS.indexOf(c) < 0 || (d !== 1 && d !== -1)) throw RuleError('Érvénytelen választás.');
    var ni = this.prices[c] + d;
    if (!(ni >= 0 && ni < PRICE_STEPS.length)) throw RuleError('A profitjelölő már a szélén áll.');
    this.prices[c] = ni;
    this.joker.price = true;
    this._log('JOKER: ' + p.name + ' a ' + hu(c) + ' árat ' + eur(this.price(c)) + '-ra állította.');
  };

  Game.prototype._jokerTrendMove = function (p, a) {
    if (this.joker.trend) throw RuleError('Trendjelölővel már léptél.');
    var f = toInt(a.from), t = toInt(a.to), d = toInt(a.dir);
    if (!inFields(f) || this.trend[f] === null) throw RuleError('Azon a mezőn nincs jelölő.');
    if (!inFields(t) || this.trend[t] !== null) throw RuleError('Csak szabad mezőre (nem a 7-esre) helyezhető át.');
    if (d !== 1 && d !== -1) throw RuleError('Érvénytelen irány.');
    var c = this.trend[f][0];
    this.trend[f] = null;
    this.trend[t] = [c, d];
    this.joker.trend = true;
    this._log('JOKER: ' + p.name + ' a ' + hu(c) + ' jelölőt a ' + f + '-es mezőről a ' + t + '-esre tette.');
  };

  Game.prototype._jokerTrendFlip = function (p, a) {
    if (this.joker.trend) throw RuleError('Trendjelölővel már léptél.');
    var f = toInt(a.field);
    if (!inFields(f) || this.trend[f] === null) throw RuleError('Azon a mezőn nincs jelölő.');
    var c = this.trend[f][0], d = this.trend[f][1];
    this.trend[f] = [c, -d];
    this.joker.trend = true;
    this._log('JOKER: ' + p.name + ' megfordította a ' + f + '-es mező ' + hu(c) + ' jelölőjét.');
  };

  Game.prototype._jokerDone = function () { this.joker = null; this.phase = 'act'; };

  Game.prototype._move = function (p, a) {
    var to = a.to, pi = this.players.indexOf(p);
    var r = this.reach(pi);
    if (!(to in r.res)) throw RuleError('Oda most nem tudsz eljutni.');
    var path = [to];
    while (path[path.length - 1] !== p.pos) path.push(r.prev[path[path.length - 1]]);
    path.reverse();
    this.ap -= r.res[to];
    p.pos = to;
    p.visit = null;
    this.lastPath = { color: p.color, path: path };
    if (this.wh[to]) {
      p.visit = { wh: to, loaded: false, locked: false };
      p.lastWh = to;
      var w = this.wh[to];
      this._log(p.name + ' beérkezett a ' + hu(w.color) + ' ' + (w.size === 'L' ? 'nagy' : 'kis') + 'raktárba.');
    }
  };

  Game.prototype._visit = function (p) {
    var v = p.visit;
    if (!v) throw RuleError('Rakodni csak raktárban lehet.');
    if (v.locked) throw RuleError('Az első körben el kell indulnod a kisraktárból – itt most nem rakodhatsz.');
    if (this.ap < 1) throw RuleError('Nincs több akciópontod.');
    return v;
  };

  Game.prototype._unload = function (p, a) {
    var v = this._visit(p);
    if (v.loaded) throw RuleError('Ebben a raktárban már felrakodtál – ide már nem rakodhatsz le.');
    var idx = toInt(a.index, -1);
    if (!(idx >= 0 && idx < p.cargo.length)) throw RuleError('Nincs ilyen áru a kamionon.');
    var wid = v.wh, w = this.wh[wid], item = p.cargo[idx];
    if (item === DAMAGED) {
      var cost = w.color === p.color ? DAMAGED_COST_OWN : DAMAGED_COST_OTHER;
      if (this.profitOf(this.account(p)) < cost) throw RuleError('A sérült áru lerakása ' + eur(cost) + ' – ehhez nincs elég profitod.');
      p.cargo.splice(idx, 1);
      this.damagedIn[wid].push(p.color);
      this._addProfit(p, -cost);
      this._log(p.name + ' lerakta a sérült árut (' + eur(-cost) + ').');
    } else {
      var slot = this.slots[wid][p.color];
      if (slot.length >= SLOT_CAPACITY[w.size]) throw RuleError('A saját színű tárhelyed ebben a raktárban megtelt.');
      p.cargo.splice(idx, 1);
      slot.push(item);
      var income = this.goodValue(item, p.color, w.color);
      this._addProfit(p, income);
      var extra = income > this.price(item) ? ' (+1000 € bónusz)' : '';
      this._log(p.name + ' lerakott egy ' + hu(item) + ' árut: +' + eur(income) + extra + '.');
    }
    this.ap -= 1;
  };

  Game.prototype._load = function (p, a) {
    var v = this._visit(p);
    var sc = a.slot, idx = toInt(a.index, -1);
    if (COLORS.indexOf(sc) < 0) throw RuleError('Nincs ilyen tárhely.');
    if (sc === p.color) throw RuleError('A saját színeddel egyező tárhelyről nem rakodhatsz fel.');
    if (p.cargo.length >= TRUCK_CAPACITY) throw RuleError('A kamionod tele van.');
    var slot = this.slots[v.wh][sc];
    if (!(idx >= 0 && idx < slot.length)) throw RuleError('Nincs ilyen áru a tárhelyen.');
    var gd = slot.splice(idx, 1)[0];
    p.cargo.push(gd);
    v.loaded = true;
    this.ap -= 1;
    this._log(p.name + ' felrakott egy ' + hu(gd) + ' árut.');
  };

  Game.prototype._endTurn = function (p) {
    var acct = this.account(p);
    if (this.finisher === null && this.profitOf(acct) >= this.target) {
      this.finisher = this.cur;
      this._log(p.label() + ' elérte a célprofitot! Mindenki más még egyszer léphet.');
    }
    var n = this.players.length;
    this.cur = (this.cur + 1) % n;
    this.dice = null;
    this.ap = 0;
    this.joker = null;
    this.pendingField = null;
    if (this.finisher !== null && this.cur === this.finisher) { this._finish(); return; }
    this.phase = 'roll';
    if (this.cur === this.starter) this.turnNo += 1;
  };

  Game.prototype._finish = function () {
    var g = this;
    g.phase = 'over';
    var entries = {}, order = [];
    g.players.forEach(function (p) {
      var acct = g.account(p);
      if (!entries[acct]) {
        entries[acct] = { account: acct, label: g.teams ? TEAM_HU[acct] : p.label(), color: p.color,
          profit: g.profitOf(acct), cargo_value: 0, seq: g.profitSeq[acct] || 1e9 };
        order.push(acct);
      }
      entries[acct].cargo_value += g.cargoValue(p);
    });
    var ranking = order.map(function (k) { return entries[k]; });
    ranking = ranking.map(function (e, i) { return [e, i]; }).sort(function (x, y) {
      var a = x[0], b = y[0];
      return (b.profit - a.profit) || (b.cargo_value - a.cargo_value) || (a.seq - b.seq) || (x[1] - y[1]);
    }).map(function (x) { return x[0]; });
    var bonus = g.teams ? PLACE_BONUS_TEAM : PLACE_BONUS_SOLO;
    ranking.forEach(function (e, i) {
      e.place = i + 1;
      e.bonus = i < bonus.length ? bonus[i] : 0;
      delete e.seq;
    });
    g.result = ranking;
    g._log('Vége a játéknak! Győztes: ' + ranking[0].label + ' – ' + eur(ranking[0].profit) + '.');
  };

  // ---------------- mentés / betöltés / másolás ----------------
  var STATE_KEYS = ['target', 'teams', 'profit', 'profitSeq', 'seq', 'prices', 'trend', 'slots', 'slotOrder',
    'damagedIn', 'log', 'version', 'dice', 'ap', 'joker', 'pendingField', 'finisher', 'result', 'lastPath',
    'turnNo', 'cur', 'phase', 'starter'];

  Game.prototype.toJSON = function () {
    var g = this, o = { tileOrder: g.board.tile_order, rng: g.rng.state };
    STATE_KEYS.forEach(function (k) { o[k] = g[k]; });
    o.players = g.players.map(function (p) {
      return { color: p.color, name: p.name, kind: p.kind, pos: p.pos, cargo: p.cargo, lastWh: p.lastWh, visit: p.visit };
    });
    return JSON.parse(JSON.stringify(o));
  };

  Game.fromJSON = function (o) {
    o = JSON.parse(JSON.stringify(o));
    var g = new Game(null, { _blank: true });
    g._setBoard(o.tileOrder);
    g.rng = new RNG(0);
    g.rng.state = o.rng >>> 0;
    STATE_KEYS.forEach(function (k) { g[k] = o[k]; });
    var t = emptyTrend();
    TREND_FIELDS.forEach(function (f) { t[f] = o.trend[f] || null; });
    g.trend = t;
    g.players = o.players.map(function (d) {
      var p = new Player(d.color, d.name, d.kind);
      p.pos = d.pos; p.cargo = d.cargo; p.lastWh = d.lastWh; p.visit = d.visit;
      return p;
    });
    return g;
  };

  /** Gyors másolat elemzéshez: közös tábla, saját véletlenszám (0-s maggal), üres napló. */
  Game.prototype.clone = function () {
    var g = this, h = Object.create(Game.prototype);
    Object.keys(g).forEach(function (k) { h[k] = g[k]; });
    h.players = g.players.map(function (p) {
      var q = Object.create(Player.prototype);
      Object.keys(p).forEach(function (k) { q[k] = p[k]; });
      q.cargo = p.cargo.slice();
      q.visit = p.visit ? { wh: p.visit.wh, loaded: p.visit.loaded, locked: p.visit.locked } : null;
      return q;
    });
    h.profit = Object.assign({}, g.profit);
    h.profitSeq = Object.assign({}, g.profitSeq);
    h.prices = Object.assign({}, g.prices);
    h.trend = Object.assign({}, g.trend);
    h.slots = {};
    Object.keys(g.slots).forEach(function (w) {
      h.slots[w] = {};
      Object.keys(g.slots[w]).forEach(function (c) { h.slots[w][c] = g.slots[w][c].slice(); });
    });
    h.damagedIn = {};
    Object.keys(g.damagedIn).forEach(function (w) { h.damagedIn[w] = g.damagedIn[w].slice(); });
    h.joker = g.joker ? Object.assign({}, g.joker) : null;
    h.log = [];
    h.result = null;
    h.rng = new RNG(0);
    return h;
  };

  // =================== Gépi játékos ===================
  function aiValues(g, p) {
    var v = {};
    COLORS.forEach(function (c) { v[c] = 0.0; });
    p.cargo.forEach(function (it) { if (it !== DAMAGED) v[it] += 1; });
    v[p.color] += 0.5;
    return v;
  }

  function trendItems(g) {      // [mező, jelölő] párok, mezőszám szerint
    return TREND_FIELDS.map(function (f) { return [f, g.trend[f]]; });
  }

  /** Python max((érték, szín)) megfelelője */
  function maxPair(cands) {
    var best = null;
    cands.forEach(function (c) {
      if (best === null || c[0] > best[0] || (c[0] === best[0] && c[1] > best[1])) best = c;
    });
    return best;
  }

  function aiTrendPlace(g, p) {
    var s = g.pendingField, v = aiValues(g, p), best = null;
    trendItems(g).forEach(function (fm) {
      var f = fm[0], m = fm[1];
      if (!m) return;
      var c = m[0], df = m[1];
      [1, -1].forEach(function (d) {
        var score = rollProb(s) * d * v[c] - rollProb(f) * df * v[c] + g.rng.random() * 1e-3;
        if (best === null || score > best[0]) best = [score, f, d];
      });
    });
    return { type: 'trend_place', from: best[1], dir: best[2] };
  }

  function aiJoker(g, p) {
    var v = aiValues(g, p);
    if (!g.joker.price) {
      var cands = COLORS.filter(function (c) { return v[c] >= 1 && g.prices[c] < PRICE_STEPS.length - 1; })
        .map(function (c) { return [v[c], c]; });
      if (cands.length) return { type: 'joker_price', color: maxPair(cands)[1], dir: 1 };
    }
    if (!g.joker.trend) {
      var best = [0.01, null];
      var items = trendItems(g);
      var empty = items.filter(function (fm) { return fm[1] === null; }).map(function (fm) { return fm[0]; });
      items.forEach(function (fm) {
        var f = fm[0], m = fm[1];
        if (!m) return;
        var c = m[0], d = m[1];
        var score = -2 * d * rollProb(f) * v[c];
        if (score > best[0]) best = [score, { type: 'joker_trend_flip', field: f }];
        empty.forEach(function (t) {
          [1, -1].forEach(function (dd) {
            var sc = rollProb(t) * dd * v[c] - rollProb(f) * d * v[c];
            if (sc > best[0]) best = [sc, { type: 'joker_trend_move', from: f, to: t, dir: dd }];
          });
        });
      });
      if (best[1]) return best[1];
    }
    return { type: 'joker_done' };
  }

  function sumArr(a) { return a.reduce(function (s, x) { return s + x; }, 0); }
  function desc(a, b) { return b - a; }

  function aiTarget(g, p) {
    var me = p.color, dist = g.bfsFull(p.pos).dist, best = null;
    Object.keys(g.wh).forEach(function (wid) {
      var w = g.wh[wid];
      if (wid === p.pos || wid === p.lastWh || !(wid in dist)) return;
      var free = SLOT_CAPACITY[w.size] - g.slots[wid][me].length;
      var normals = p.cargo.filter(function (it) { return it !== DAMAGED; })
        .map(function (it) { return g.goodValue(it, me, w.color); }).sort(desc);
      var unload = normals.slice(0, Math.max(0, free));
      var score = sumArr(unload);
      var space = TRUCK_CAPACITY - p.cargo.length + unload.length;
      var avail = [];
      COLORS.forEach(function (sc) {
        if (sc === me) return;
        g.slots[wid][sc].forEach(function (gd) { avail.push(g.price(gd) + (gd === me ? 500 : 0)); });
      });
      avail.sort(desc);
      score += 0.6 * sumArr(avail.slice(0, Math.max(0, space)));
      score -= dist[wid] * 350;
      if (g.trucksIn(wid) >= WAREHOUSE_TRUCKS[w.size]) score -= 1500;
      score += g.rng.random() * 50;
      if (best === null || score > best[0]) best = [score, wid];
    });
    return best ? best[1] : null;
  }

  function aiAction(g, pi) {
    var p = g.players[pi], me = p.color, end = { type: 'end_turn' };
    if (g.ap <= 0) return end;
    var v = p.visit, best, i;
    if (v && !v.locked) {
      var wid = v.wh, w = g.wh[wid];
      if (!v.loaded) {
        if (g.slots[wid][me].length < SLOT_CAPACITY[w.size]) {
          best = null;
          for (i = 0; i < p.cargo.length; i++) {
            var it = p.cargo[i];
            if (it === DAMAGED) continue;
            var val = g.goodValue(it, me, w.color);
            if (best === null || val > best[0]) best = [val, i];
          }
          if (best && (best[0] >= 1000 || p.cargo.length >= TRUCK_CAPACITY)) return { type: 'unload', index: best[1] };
        }
        if (p.cargo.indexOf(DAMAGED) >= 0) {
          var cost = w.color === me ? DAMAGED_COST_OWN : DAMAGED_COST_OTHER;
          var prof = g.profitOf(g.account(p));
          if (prof >= cost + 3000 && (w.color === me || prof >= 15000)) return { type: 'unload', index: p.cargo.indexOf(DAMAGED) };
        }
      }
      if (p.cargo.length < TRUCK_CAPACITY) {
        best = null;
        COLORS.forEach(function (sc) {
          if (sc === me) return;
          g.slots[wid][sc].forEach(function (gd, j) {
            var val2 = g.price(gd) + (gd === me ? 800 : 0);
            if (best === null || val2 > best[0]) best = [val2, sc, j];
          });
        });
        if (best && (best[0] >= 1000 || p.cargo.length <= 1)) return { type: 'load', slot: best[1], index: best[2] };
      }
    }
    var target = aiTarget(g, p);
    if (target === null) return end;
    var res = g.reach(pi).res;
    if (target in res) return { type: 'move', to: target };
    var prev = g.bfsFull(p.pos).prev;
    var path = [target];
    while (path[path.length - 1] !== p.pos) path.push(prev[path[path.length - 1]]);
    path.reverse();
    for (i = path.length - 2; i >= 1; i--) {
      if (path[i] in res) return { type: 'move', to: path[i] };
    }
    return end;
  }

  /** A soron lévő gépi játékos EGY lépése. */
  function aiStep(g) {
    var pi = g.cur, p = g.players[pi];
    try {
      if (g.phase === 'trend_setup') g.act(pi, { type: 'trend_random' });
      else if (g.phase === 'roll') g.act(pi, { type: 'roll' });
      else if (g.phase === 'trend_place') g.act(pi, aiTrendPlace(g, p));
      else if (g.phase === 'joker') g.act(pi, aiJoker(g, p));
      else if (g.phase === 'act') g.act(pi, aiAction(g, pi));
    } catch (e) {
      if (!e.isRule) throw e;
      aiFallback(g, pi);
    }
  }

  function aiFallback(g, pi) {
    if (g.phase === 'act') g.act(pi, { type: 'end_turn' });
    else if (g.phase === 'joker') g.act(pi, { type: 'joker_done' });
    else if (g.phase === 'trend_place') {
      var f = TREND_FIELDS.filter(function (x) { return g.trend[x]; })[0];
      g.act(pi, { type: 'trend_place', from: f, dir: 1 });
    }
  }

  P.COLORS = COLORS; P.COLOR_HU = COLOR_HU; P.TEAM_OF = TEAM_OF; P.TEAM_HU = TEAM_HU;
  P.PRICE_STEPS = PRICE_STEPS; P.PRICE_START_INDEX = PRICE_START_INDEX; P.TRUCK_CAPACITY = TRUCK_CAPACITY;
  P.SLOT_CAPACITY = SLOT_CAPACITY; P.WAREHOUSE_TRUCKS = WAREHOUSE_TRUCKS; P.OWN_BONUS = OWN_BONUS;
  P.DAMAGED_COST_OWN = DAMAGED_COST_OWN; P.DAMAGED_COST_OTHER = DAMAGED_COST_OTHER;
  P.TREND_FIELDS = TREND_FIELDS; P.DAMAGED = DAMAGED; P.PLACE_BONUS_SOLO = PLACE_BONUS_SOLO; P.PLACE_BONUS_TEAM = PLACE_BONUS_TEAM;
  P.hu = hu; P.eur = eur; P.rollProb = rollProb; P.capitalize = capitalize; P.RuleError = RuleError;
  P.RNG = RNG; P.Player = Player; P.Game = Game;
  P.aiTrendPlace = aiTrendPlace; P.aiJoker = aiJoker; P.aiTarget = aiTarget; P.aiAction = aiAction;
  P.aiStep = aiStep; P.aiFallback = aiFallback; P.maxPair = maxPair; P.trendItems = trendItems;
})(PTA);
