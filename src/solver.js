(function (global) {
  'use strict';
  var CP = global.CP;
  var W = CP.W, H = CP.H, N = CP.CELLS;

  function shapeKey(cells) {
    var parts = [];
    for (var i = 0; i < cells.length; i++) parts.push(cells[i][0] + ',' + cells[i][1]);
    parts.sort();
    return parts.join(';');
  }

  // 每块拼图去重后的所有朝向（含翻面），供求解器使用。
  var ORIENTS = CP.PIECE_DEFS.map(function (def) {
    var seen = {};
    var list = [];
    for (var flip = 0; flip < 2; flip++) {
      for (var rot = 0; rot < 4; rot++) {
        var cells = CP.transformCells(def.cells, flip, rot);
        var k = shapeKey(cells);
        if (!seen[k]) {
          seen[k] = true;
          list.push({ cells: cells, flip: flip, rot: rot });
        }
      }
    }
    return list;
  });

  function shuffleArray(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /**
   * 求解 / 枚举解法。
   * targetCells: 月、日、星期三个目标格的下标。
   * fixed: 已放置的拼块 [{piece, flip, rot, r, c}]，求解时会保留这些拼块。
   * options: { maxSolutions, timeLimit, shuffle }
   */
  function generate(targetCells, fixed, options) {
    options = options || {};
    var maxSolutions = options.maxSolutions || 1;
    var timeLimit = options.timeLimit || 800;
    var shuffle = !!options.shuffle;

    fixed = fixed || [];

    var covered = new Uint8Array(N);
    var used = new Uint8Array(10);
    var chosen = [];
    var coveredCount = 0;

    for (var i = 0; i < CP.WALLS.length; i++) {
      var wi = CP.idx(CP.WALLS[i][0], CP.WALLS[i][1]);
      if (!covered[wi]) { covered[wi] = 1; coveredCount++; }
    }
    for (var t = 0; t < targetCells.length; t++) {
      if (!covered[targetCells[t]]) { covered[targetCells[t]] = 1; coveredCount++; }
    }

    for (var f = 0; f < fixed.length; f++) {
      var fp = fixed[f];
      var fdef = CP.PIECE_DEFS[fp.piece];
      if (!fdef || used[fp.piece]) return { solutions: [], invalidFixed: true, nodes: 0 };
      var fcells = CP.transformCells(fdef.cells, fp.flip, fp.rot);
      var fmask = [];
      for (var fc = 0; fc < fcells.length; fc++) {
        var fr = fp.r + fcells[fc][0];
        var fcc = fp.c + fcells[fc][1];
        if (fr < 0 || fr >= H || fcc < 0 || fcc >= W) {
          return { solutions: [], invalidFixed: true, nodes: 0 };
        }
        var fi = fr * W + fcc;
        if (covered[fi]) return { solutions: [], invalidFixed: true, nodes: 0 };
        fmask.push(fi);
      }
      for (var mk = 0; mk < fmask.length; mk++) { covered[fmask[mk]] = 1; coveredCount++; }
      used[fp.piece] = 1;
      chosen.push({
        piece: fp.piece, flip: fp.flip, rot: fp.rot, r: fp.r, c: fp.c,
        cells: fcells, mask: fmask, fixed: true
      });
    }

    var remainingArea = 0;
    for (var p = 0; p < 10; p++) {
      if (!used[p]) remainingArea += CP.PIECE_DEFS[p].cells.length;
    }
    if (remainingArea !== N - coveredCount) {
      return { solutions: [], mismatch: true, nodes: 0 };
    }

    // 为每个格子建立可用的所有摆放。
    var placements = new Array(N);
    for (var q = 0; q < N; q++) placements[q] = [];

    for (var pi = 0; pi < 10; pi++) {
      if (used[pi]) continue;
      var ors = ORIENTS[pi];
      for (var oi = 0; oi < ors.length; oi++) {
        var cells = ors[oi].cells;
        var maxR = 0, maxC = 0;
        for (var ci = 0; ci < cells.length; ci++) {
          if (cells[ci][0] > maxR) maxR = cells[ci][0];
          if (cells[ci][1] > maxC) maxC = cells[ci][1];
        }
        for (var r = 0; r + maxR < H; r++) {
          for (var c = 0; c + maxC < W; c++) {
            var ok = true;
            var mask = [];
            for (var k = 0; k < cells.length; k++) {
              var idx = (r + cells[k][0]) * W + (c + cells[k][1]);
              if (covered[idx]) { ok = false; break; }
              mask.push(idx);
            }
            if (!ok) continue;
            var pl = {
              piece: pi, flip: ors[oi].flip, rot: ors[oi].rot,
              r: r, c: c, cells: cells, mask: mask
            };
            for (var mi = 0; mi < mask.length; mi++) placements[mask[mi]].push(pl);
          }
        }
      }
    }

    if (shuffle) {
      for (var s = 0; s < N; s++) shuffleArray(placements[s]);
    }

    var solutions = [];
    var nodes = 0;
    var timedOut = false;
    var deadline = Date.now() + timeLimit;

    function pickCell() {
      var bestCount = Infinity;
      var bestCells = [];
      for (var i = 0; i < N; i++) {
        if (covered[i]) continue;
        var cnt = 0;
        var list = placements[i];
        for (var j = 0; j < list.length; j++) {
          if (used[list[j].piece]) continue;
          var mask = list[j].mask;
          var fits = true;
          for (var k = 0; k < mask.length; k++) {
            if (covered[mask[k]]) { fits = false; break; }
          }
          if (fits) cnt++;
        }
        if (cnt < bestCount) {
          bestCount = cnt;
          bestCells = [i];
        } else if (cnt === bestCount) {
          bestCells.push(i);
        }
      }
      if (!bestCells.length) return { cell: -1, count: 0 };
      if (bestCount === 0) return { cell: bestCells[0], count: 0 };
      var chosenCell = shuffle
        ? bestCells[Math.floor(Math.random() * bestCells.length)]
        : bestCells[0];
      return { cell: chosenCell, count: bestCount };
    }

    // 剩余空格若被墙/目标/已放拼块切成过小的连通块，直接剪枝。
    function componentsOk() {
      var minArea = Infinity;
      for (var p = 0; p < 10; p++) {
        if (!used[p]) {
          var a = CP.PIECE_DEFS[p].cells.length;
          if (a < minArea) minArea = a;
        }
      }
      if (minArea === Infinity) return true;

      var seen = new Uint8Array(N);
      for (var start = 0; start < N; start++) {
        if (covered[start] || seen[start]) continue;
        var queue = [start];
        var head = 0;
        var size = 0;
        seen[start] = 1;
        while (head < queue.length) {
          var cur = queue[head++];
          size++;
          var r = Math.floor(cur / W);
          var c = cur % W;
          var nb;
          if (r > 0) {
            nb = cur - W;
            if (!covered[nb] && !seen[nb]) { seen[nb] = 1; queue.push(nb); }
          }
          if (r < H - 1) {
            nb = cur + W;
            if (!covered[nb] && !seen[nb]) { seen[nb] = 1; queue.push(nb); }
          }
          if (c > 0) {
            nb = cur - 1;
            if (!covered[nb] && !seen[nb]) { seen[nb] = 1; queue.push(nb); }
          }
          if (c < W - 1) {
            nb = cur + 1;
            if (!covered[nb] && !seen[nb]) { seen[nb] = 1; queue.push(nb); }
          }
        }
        if (size < minArea) return false;
      }
      return true;
    }

    function dfs() {
      nodes++;
      if ((nodes & 63) === 0 && Date.now() > deadline) {
        timedOut = true;
        return;
      }

      var pick = pickCell();
      if (pick.cell === -1) {
        solutions.push(chosen.slice());
        return;
      }
      if (pick.count === 0) return;
      if (!componentsOk()) return;

      var list = placements[pick.cell];
      for (var i = 0; i < list.length; i++) {
        if (solutions.length >= maxSolutions || timedOut) return;
        var pl = list[i];
        if (used[pl.piece]) continue;
        var mask = pl.mask;
        var fits = true;
        for (var k = 0; k < mask.length; k++) {
          if (covered[mask[k]]) { fits = false; break; }
        }
        if (!fits) continue;

        used[pl.piece] = 1;
        for (var m1 = 0; m1 < mask.length; m1++) covered[mask[m1]] = 1;
        chosen.push(pl);

        dfs();

        chosen.pop();
        for (var m2 = 0; m2 < mask.length; m2++) covered[mask[m2]] = 0;
        used[pl.piece] = 0;
      }
    }

    dfs();

    return {
      solutions: solutions,
      nodes: nodes,
      timedOut: timedOut,
      exhausted: !timedOut && solutions.length < maxSolutions
    };
  }

  function solutionKey(solution) {
    var parts = solution.map(function (pl) {
      var cells = pl.mask.slice().sort(function (a, b) { return a - b; });
      return pl.piece + ':' + cells.join('.');
    });
    parts.sort();
    return parts.join('|');
  }

  CP.Solver = {
    orientations: ORIENTS,
    generate: generate,
    solutionKey: solutionKey
  };
})(window);
