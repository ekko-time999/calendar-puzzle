(function (global) {
  'use strict';
  var CP = global.CP || (global.CP = {});

  CP.W = 7;
  CP.H = 8;
  CP.CELLS = CP.W * CP.H;

  // 标准 10 块日历拼图，共 47 格。坐标为归一化后的格点 [row, col]。
  CP.PIECE_DEFS = [
    { name: '红', color: '#ef6f6c', cells: [[0,0],[1,0],[2,0],[1,1],[1,2]] },
    { name: '橙', color: '#f79d65', cells: [[0,0],[0,1],[1,1],[2,1],[2,2]] },
    { name: '黄', color: '#f4c95d', cells: [[0,0],[1,0],[2,0],[2,1],[2,2]] },
    { name: '草绿', color: '#a7c957', cells: [[0,0],[0,2],[1,0],[1,1],[1,2]] },
    { name: '深绿', color: '#43aa8b', cells: [[0,0],[0,1],[1,0],[1,1],[1,2]] },
    { name: '青', color: '#4cc9f0', cells: [[0,0],[1,0],[1,1],[1,2]] },
    { name: '蓝', color: '#4361ee', cells: [[0,0],[0,1],[1,1],[1,2]] },
    { name: '紫', color: '#9b5de5', cells: [[0,0],[0,1],[1,1],[1,2],[1,3]] },
    { name: '粉', color: '#f15bb5', cells: [[0,0],[1,0],[1,1],[1,2],[1,3]] },
    { name: '棕', color: '#b08968', cells: [[0,0],[0,1],[0,2],[0,3]] }
  ];

  CP.WALLS = [[0,6],[1,6],[7,0],[7,1],[7,2],[7,3]];

  // 星期格：索引 0 = Sunday，与 Date.getDay() 一致。
  CP.WEEK_CELLS = [
    { label: '日', r: 6, c: 3 },
    { label: '一', r: 6, c: 4 },
    { label: '二', r: 6, c: 5 },
    { label: '三', r: 6, c: 6 },
    { label: '四', r: 7, c: 4 },
    { label: '五', r: 7, c: 5 },
    { label: '六', r: 7, c: 6 }
  ];

  CP.MONTH_CELLS = [];
  for (var m = 1; m <= 12; m++) {
    CP.MONTH_CELLS[m] = {
      r: Math.floor((m - 1) / 6),
      c: (m - 1) % 6
    };
  }

  CP.DAY_CELLS = [];
  for (var d = 1; d <= 31; d++) {
    CP.DAY_CELLS[d] = {
      r: Math.floor((d - 1) / 7) + 2,
      c: (d - 1) % 7
    };
  }

  CP.idx = function (r, c) { return r * CP.W + c; };
  CP.rowOf = function (i) { return Math.floor(i / CP.W); };
  CP.colOf = function (i) { return i % CP.W; };

  // 每个非墙格固定属于 月份 / 日期 / 星期 之一，位置与含义恒定
  CP.CELL_META = [];
  (function () {
    function put(idx, kind, value, label) {
      CP.CELL_META[idx] = {
        kind: kind,
        value: value,
        label: label,
        aria: (kind === 'month' ? '月份 ' : kind === 'day' ? '日期 ' : '星期 ') + label,
        title: '点击切换到 ' + label
      };
    }
    for (var m = 1; m <= 12; m++) {
      var mc = CP.MONTH_CELLS[m];
      put(CP.idx(mc.r, mc.c), 'month', m, m + '月');
    }
    for (var d = 1; d <= 31; d++) {
      var dc = CP.DAY_CELLS[d];
      put(CP.idx(dc.r, dc.c), 'day', d, d + '日');
    }
    for (var w = 0; w < 7; w++) {
      var wc = CP.WEEK_CELLS[w];
      put(CP.idx(wc.r, wc.c), 'week', w, '周' + wc.label);
    }
  })();

  CP.normalizeCells = function (cells) {
    var minR = Infinity, minC = Infinity;
    for (var i = 0; i < cells.length; i++) {
      if (cells[i][0] < minR) minR = cells[i][0];
      if (cells[i][1] < minC) minC = cells[i][1];
    }
    var out = cells.map(function (p) { return [p[0] - minR, p[1] - minC]; });
    out.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    return out;
  };

  // 翻面（左右镜像）后可再顺时针旋转 rot 次，最后归一化。
  CP.transformCells = function (baseCells, flip, rot) {
    var out = baseCells.map(function (p) { return [p[0], flip ? -p[1] : p[1]]; });
    for (var i = 0; i < (rot || 0); i++) {
      out = out.map(function (p) { return [p[1], -p[0]]; });
    }
    return CP.normalizeCells(out);
  };

  CP.cellsKey = function (cells) {
    var parts = [];
    for (var i = 0; i < cells.length; i++) parts.push(cells[i][0] + ',' + cells[i][1]);
    return parts.sort().join(';');
  };

  CP.targetCells = function (m, d, w) {
    var mc = CP.MONTH_CELLS[m];
    var dc = CP.DAY_CELLS[d];
    var wc = CP.WEEK_CELLS[w];
    if (!mc || !dc || !wc) return null;
    return [
      CP.idx(mc.r, mc.c),
      CP.idx(dc.r, dc.c),
      CP.idx(wc.r, wc.c)
    ];
  };

  CP.dateKey = function (date) {
    var y = date.getFullYear();
    var mm = String(date.getMonth() + 1).padStart(2, '0');
    var dd = String(date.getDate()).padStart(2, '0');
    return y + '-' + mm + '-' + dd;
  };

  CP.dateFromKey = function (key) {
    var parts = String(key || '').split('-');
    if (parts.length !== 3) return null;
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return isNaN(d.getTime()) ? null : d;
  };

  CP.targetForDate = function (date) {
    return {
      m: date.getMonth() + 1,
      d: date.getDate(),
      w: date.getDay(),
      key: CP.dateKey(date)
    };
  };

  CP.todayTarget = function () {
    return CP.targetForDate(new Date());
  };

  // 某年某月共有多少天，闰年的 2 月会自动得到 29 天
  CP.daysInMonth = function (m, y) {
    return new Date(y || new Date().getFullYear(), m, 0).getDate();
  };

  // 星期完全由年月日算出，与 Date.getDay() 一致：0 = 周日
  CP.weekdayOf = function (m, d, y) {
    return new Date(y || new Date().getFullYear(), m - 1, d).getDay();
  };

  // 统一目标日期：收敛非法日期并自动补上星期，不依赖任何写死的对照表
  CP.normalizeTarget = function (t, y) {
    if (!t) return null;
    var year = y || new Date().getFullYear();
    var m = Math.round(Number(t.m));
    var d = Math.round(Number(t.d));
    if (!isFinite(m) || !isFinite(d)) return null;
    m = Math.min(12, Math.max(1, m));
    d = Math.min(CP.daysInMonth(m, year), Math.max(1, d));
    return { m: m, d: d, w: CP.weekdayOf(m, d, year) };
  };

  CP.isSameTarget = function (a, b) {
    return !!a && !!b && a.m === b.m && a.d === b.d && a.w === b.w;
  };
})(window);
