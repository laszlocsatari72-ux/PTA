/*
 * P_T_A – a játéktábla felépítése (a board.py JavaScript-változata).
 * A tábla gráf: csomópontok a pöttyök és a raktárak; a pötty nélküli elágazásokon át egy lépés.
 * A 4 belső pályaelem tetszőleges sorrendben, 180°-kal elforgatva is elhelyezhető.
 */
var PTA = (typeof PTA !== 'undefined') ? PTA : {};

(function (P) {
  'use strict';
  var D = P.BOARD_DATA;

  function round1(v) { return Math.round(v * 10) / 10; }
  function V(x, y) { return [round1((x - D.ORIGIN[0]) * D.SCALE), round1((y - D.ORIGIN[1]) * D.SCALE)]; }

  /** ['A', 'B*', ...] – a betű az elem, a * a 180°-os elforgatás. Hibás megadásnál hibát dob. */
  function normalizeOrder(tileOrder) {
    var order = (tileOrder || D.DEFAULT_TILE_ORDER).map(function (t) { return String(t).trim().toUpperCase(); });
    var letters = order.map(function (t) { return t.replace(/\*+$/, ''); }).sort().join('');
    var bad = order.some(function (t) { return t.length > 2 || (t.length === 2 && t[1] !== '*'); });
    if (order.length !== 4 || letters !== 'ABCD' || bad) {
      throw new Error('Mind a 4 pályaelemet (A, B, C, D) pontosan egyszer kell elhelyezni.');
    }
    return order;
  }

  function buildBoard(tileOrder) {
    var order = normalizeOrder(tileOrder);
    var pos = {}, kind = {}, dotColor = {}, polylines = [], links = [], warehouses = {}, tiles = [];

    function addLine(seq) {
      var pts = [], prev = null;
      seq.forEach(function (p) {
        if (typeof p === 'string') {
          pts.push(pos[p]);
          if (prev !== null) links.push([prev, p]);
          prev = p;
        } else {
          pts.push([p[0], p[1]]);
        }
      });
      polylines.push(pts);
    }

    D.SLOT_ORDER.forEach(function (slot, si) {
      var code = order[si];
      var key = code[0], rot = code.slice(-1) === '*';
      var t = D.TILES[key];
      var sx = D.SLOTS[slot][0], sy = D.SLOTS[slot][1];
      var ox = t.origin[0], oy = t.origin[1];

      function mv(p) {
        var lx = p[0] - ox, ly = p[1] - oy;
        if (rot) { lx = D.TILE_W - lx; ly = D.TILE_H - ly; }
        return [sx + lx, sy + ly];
      }
      function name(p) {
        if (typeof p === 'string') {
          if (D.PORTS[p]) return slot + '.' + (rot ? D.ROT_PORT[p] : p);
          return p;
        }
        return mv(p);
      }

      tiles.push({ key: key, rot: rot, slot: slot, x: sx, y: sy });
      Object.keys(D.PORTS).forEach(function (pn) {
        var nm = slot + '.' + pn;
        pos[nm] = [sx + D.PORTS[pn][0], sy + D.PORTS[pn][1]];
        kind[nm] = 'junction';
      });
      Object.keys(t.dots).forEach(function (n) { pos[n] = mv(t.dots[n]); kind[n] = 'dot'; dotColor[n] = 'w'; });
      Object.keys(t.junctions).forEach(function (n) { pos[n] = mv(t.junctions[n]); kind[n] = 'junction'; });
      t.roads.forEach(function (r) { addLine(r.map(name)); });
      t.warehouses.forEach(function (w) {
        var wid = 'W_' + w.color + '_' + w.size;
        var x = w.rect[0], y = w.rect[1], ww = w.rect[2], hh = w.rect[3];
        var tl = mv(rot ? [x + ww, y + hh] : [x, y]);
        pos[wid] = [tl[0] + ww / 2, tl[1] + hh / 2];
        kind[wid] = 'wh';
        warehouses[wid] = { id: wid, color: w.color, size: w.size, rect: [tl[0], tl[1], ww, hh] };
        w.entrances.forEach(function (e) {
          var start = name(e[0]);
          var pts = [pos[start]].concat(e.slice(1).map(mv));
          polylines.push(pts);
          links.push([start, wid]);
        });
      });
    });

    Object.keys(D.BOARD_DOTS).forEach(function (n) { pos[n] = D.BOARD_DOTS[n]; kind[n] = 'dot'; dotColor[n] = 'y'; });
    Object.keys(D.BOARD_JUNCTIONS).forEach(function (n) { pos[n] = D.BOARD_JUNCTIONS[n]; kind[n] = 'junction'; });
    var usedPorts = {};
    D.BOARD_ROADS.forEach(function (r) {
      r.forEach(function (p) { if (typeof p === 'string' && p.indexOf('.') >= 0) usedPorts[p] = true; });
      addLine(r);
    });

    // lezárt csatlakozási pontok: sorompó
    var barriers = [];
    D.SLOT_ORDER.forEach(function (slot) {
      Object.keys(D.PORTS).forEach(function (pn) {
        var nm = slot + '.' + pn;
        if (usedPorts[nm]) return;
        var x = pos[nm][0], y = pos[nm][1];
        var ddx = pn === 'L' ? -10 : (pn === 'R' ? 10 : 0);
        var ddy = pn[0] === 'T' ? -10 : (pn[0] === 'B' ? 10 : 0);
        polylines.push([[x, y], [x + ddx, y + ddy]]);
        barriers.push({ x: x + ddx, y: y + ddy, vertical: pn === 'L' || pn === 'R' });
      });
    });

    // gráf: csak a pöttyök és a raktárak a csomópontok
    var nb = {};
    links.forEach(function (l) {
      (nb[l[0]] = nb[l[0]] || {})[l[1]] = true;
      (nb[l[1]] = nb[l[1]] || {})[l[0]] = true;
    });
    var adj = {};
    Object.keys(kind).forEach(function (n) {
      if (kind[n] === 'junction') return;
      var found = {}, seen = {}, stack = [n];
      seen[n] = true;
      while (stack.length) {
        var u = stack.pop();
        Object.keys(nb[u] || {}).forEach(function (v) {
          if (seen[v]) return;
          seen[v] = true;
          if (kind[v] === 'junction') stack.push(v);
          else if (!(kind[n] === 'wh' && kind[v] === 'wh')) found[v] = true;
        });
      }
      adj[n] = found;
    });
    Object.keys(adj).forEach(function (n) {
      Object.keys(adj[n]).forEach(function (m) { (adj[m] = adj[m] || {})[n] = true; });
    });

    var nodes = {};
    Object.keys(kind).forEach(function (n) { if (kind[n] !== 'junction') nodes[n] = V(pos[n][0], pos[n][1]); });
    var W = {};
    Object.keys(warehouses).forEach(function (wid) {
      var w = warehouses[wid], r = w.rect, v = V(r[0], r[1]);
      W[wid] = { id: wid, color: w.color, size: w.size, x: v[0], y: v[1],
        w: round1(r[2] * D.SCALE), h: round1(r[3] * D.SCALE),
        entrances: Object.keys(adj[wid]).sort(), cx: nodes[wid][0], cy: nodes[wid][1] };
    });
    var adjOut = {};
    Object.keys(adj).forEach(function (k) { adjOut[k] = Object.keys(adj[k]).sort(); });
    var dots = {};
    Object.keys(nodes).forEach(function (n) { if (dotColor[n]) dots[n] = dotColor[n]; });
    return {
      nodes: nodes,
      adj: adjOut,
      warehouses: W,
      dots: dots,
      roads: polylines.map(function (pl) { return pl.map(function (p) { return V(p[0], p[1]); }); }),
      barriers: barriers.map(function (b) { var v = V(b.x, b.y); return { x: v[0], y: v[1], vertical: b.vertical }; }),
      tiles: tiles.map(function (t) {
        var v = V(t.x, t.y);
        return { key: t.key, rot: t.rot, slot: t.slot, x: v[0], y: v[1],
          w: round1(D.TILE_W * D.SCALE), h: round1(D.TILE_H * D.SCALE) };
      }),
      tile_order: order,
      view: D.VIEW.slice(),
    };
  }

  P.normalizeOrder = normalizeOrder;
  P.buildBoard = buildBoard;
  P.DEFAULT_TILE_ORDER = D.DEFAULT_TILE_ORDER;
})(PTA);
