(function (global) {
  'use strict';
  var CP = global.CP;

  function $(id) { return document.getElementById(id); }

  function copyList(list) {
    return list.map(function (p) {
      return { piece: p.piece, flip: p.flip, rot: p.rot, r: p.r, c: p.c };
    });
  }

  function Game(options) {
    this.opts = options || {};
    this.board = $('board');
    this.tray = $('tray');
    this.timerEl = $('timer');
    this.movesEl = $('moves');
    this.progressEl = $('progress');
    this.tagEl = $('challengeTag');
    this.titleEl = $('challengeTitle');
    this.toastEl = $('toast');
    this.answerBar = $('answerBar');
    this.answerText = $('answerText');
    this.answerNextBtn = $('answerNext');
    this.answerResetBtn = $('answerReset');
    this.undoBtn = $('btnUndo');
    this.redoBtn = $('btnRedo');
    this.rotateBtn = $('btnRotate');
    this.flipBtn = $('btnFlip');
    this.resetBtn = $('btnReset');
    this.hintBtn = $('btnHint');
    this.answerBtn = $('btnAnswer');
    this.answerLabel = $('answerLabel');

    this.data = CP.Storage.load();
    this.stats = this.data.stats || CP.Storage.defaultStats();

    var today = CP.todayTarget();
    this.target = { m: today.m, d: today.d, w: today.w };
    this.playDayKey = today.key;

    this.placements = [];
    this.pieceStates = [];
    for (var i = 0; i < 10; i++) this.pieceStates.push({ flip: 0, rot: 0 });

    this.selected = null;
    this.moves = 0;
    this.hints = 0;
    this.revealed = false;
    this.revealCounted = false;
    this.won = false;
    this.answerMode = false;
    this.answers = [];
    this.answerKeys = {};
    this.answerIdx = 0;
    this.answerFromScratch = false;
    this.hint = null;
    this.hintSolution = null;
    this.hintedPieces = {};
    this.lastWinInfo = null;

    this.timer = { running: false, elapsed: 0, last: 0 };
    this.undoStack = [];
    this.redoStack = [];

    this.drag = null;
    this.ghost = null;
    this.preview = null;
    this.suppressClickUntil = 0;
    this.toastTimer = null;
    this.pieceLayerEls = {};
    this.piecesLayer = null;
    this.prevPieceSet = {};

    this.rebuildBlocked();
    this.buildBoard();
    this.buildTray();
    this.bindEvents();
    this.restoreOrStart();
    this.checkDayRollover(false);
    this.renderAll();
    this.save();

    var self = this;
    this.timerId = setInterval(function () { self.tick(); }, 1000);
  }

  Game.prototype = {
    // ---------- 基础数据 ----------
    rebuildBlocked: function () {
      this.blocked = new Uint8Array(56);
      this.wallMask = new Uint8Array(56);
      for (var i = 0; i < CP.WALLS.length; i++) {
        var wi = CP.idx(CP.WALLS[i][0], CP.WALLS[i][1]);
        this.blocked[wi] = 1;
        this.wallMask[wi] = 1;
      }
      var monthCell = CP.MONTH_CELLS[this.target.m];
      var dayCell = CP.DAY_CELLS[this.target.d];
      var weekCell = CP.WEEK_CELLS[this.target.w];
      var mi = CP.idx(monthCell.r, monthCell.c);
      var di = CP.idx(dayCell.r, dayCell.c);
      var wi2 = CP.idx(weekCell.r, weekCell.c);
      this.blocked[mi] = 1;
      this.blocked[di] = 1;
      this.blocked[wi2] = 1;

      this.targetInfo = {};
      this.targetInfo[mi] = { kind: 'month', sub: '月', main: String(this.target.m) };
      this.targetInfo[di] = { kind: 'day', sub: '日', main: String(this.target.d) };
      this.targetInfo[wi2] = { kind: 'week', sub: '星期', main: weekCell.label };
    },

    targetCells: function () {
      return CP.targetCells(this.target.m, this.target.d, this.target.w);
    },

    isValidTarget: function (t) {
      return !!t &&
        Number.isInteger(t.m) && t.m >= 1 && t.m <= 12 &&
        Number.isInteger(t.d) && t.d >= 1 && t.d <= 31 &&
        Number.isInteger(t.w) && t.w >= 0 && t.w <= 6;
    },

    isTodayChallenge: function () {
      var now = new Date();
      return this.target.m === now.getMonth() + 1 &&
        this.target.d === now.getDate() &&
        this.target.w === now.getDay();
    },

    // 跨天时 若当前停在某一天的今日挑战 自动切换到新的今天
    checkDayRollover: function (notify) {
      var today = CP.todayTarget();
      if (this.target.m === today.m && this.target.d === today.d && this.target.w === today.w) return false;
      var oldDay = CP.dateFromKey(this.playDayKey);
      if (!oldDay || !CP.isSameTarget(this.target, CP.targetForDate(oldDay))) return false;
      this.startNew(today);
      if (notify !== false) this.toast('新的一天 已切换到 ' + today.m + '月' + today.d + '日');
      return true;
    },

    cellsOfPlacement: function (pl) {
      if (pl.mask) return pl.mask;
      var def = CP.PIECE_DEFS[pl.piece];
      var cells = CP.transformCells(def.cells, pl.flip, pl.rot);
      var out = [];
      for (var i = 0; i < cells.length; i++) {
        out.push(CP.idx(pl.r + cells[i][0], pl.c + cells[i][1]));
      }
      return out;
    },

    colorOf: function (piece) {
      return CP.PIECE_DEFS[piece] ? CP.PIECE_DEFS[piece].color : '#999';
    },

    // ---------- 初始化与恢复 ----------
    restoreOrStart: function () {
      var cur = this.data.current;
      var today = CP.todayTarget();
      if (cur && this.isValidTarget(cur.target)) {
        if (cur.won && cur.playDay && cur.playDay !== today.key) {
          this.startNew(today, { skipSave: true });
          return;
        }
        this.restore(cur);
        return;
      }
      this.startNew(today, { skipSave: true });
    },

    restore: function (cur) {
      this.target = { m: cur.target.m, d: cur.target.d, w: cur.target.w };
      this.playDayKey = cur.playDay || CP.dateKey(new Date());
      this.rebuildBlocked();

      var savedStates = Array.isArray(cur.pieceStates) ? cur.pieceStates : [];
      this.pieceStates = [];
      for (var i = 0; i < 10; i++) {
        var st = savedStates[i] || {};
        this.pieceStates.push({
          flip: st.flip ? 1 : 0,
          rot: ((Number(st.rot) || 0) % 4 + 4) % 4
        });
      }

      var occupied = new Uint8Array(56);
      var used = new Uint8Array(10);
      var valid = [];
      var self = this;
      var list = Array.isArray(cur.placements) ? cur.placements : [];
      list.forEach(function (pl) {
        if (!pl || !Number.isInteger(pl.piece) || pl.piece < 0 || pl.piece > 9) return;
        if (used[pl.piece]) return;
        if (pl.flip !== 0 && pl.flip !== 1) return;
        if (!Number.isInteger(pl.rot) || pl.rot < 0 || pl.rot > 3) return;
        if (!Number.isInteger(pl.r) || !Number.isInteger(pl.c)) return;
        var cells = CP.transformCells(CP.PIECE_DEFS[pl.piece].cells, pl.flip, pl.rot);
        var mask = [];
        for (var k = 0; k < cells.length; k++) {
          var r = pl.r + cells[k][0];
          var c = pl.c + cells[k][1];
          if (r < 0 || r >= CP.H || c < 0 || c >= CP.W) return;
          var idx = CP.idx(r, c);
          if (self.blocked[idx] || occupied[idx]) return;
          mask.push(idx);
        }
        for (var m = 0; m < mask.length; m++) occupied[mask[m]] = 1;
        used[pl.piece] = 1;
        valid.push({ piece: pl.piece, flip: pl.flip, rot: pl.rot, r: pl.r, c: pl.c });
      });

      this.placements = valid;
      this.moves = Math.max(valid.length, Number(cur.moves) || 0);
      this.hints = Math.max(0, Number(cur.hints) || 0);
      this.revealed = !!cur.revealed;
      this.revealCounted = this.revealed;
      this.won = !!cur.won && valid.length === 10;
      this.answerMode = false;
      this.answers = [];
      this.answerKeys = {};
      this.answerIdx = 0;
      this.answerFromScratch = false;
      this.hint = null;
      this.hintSolution = null;
      this.hintedPieces = {};
      this.selected = null;
      this.undoStack = [];
      this.redoStack = [];

      var elapsed = Number(cur.elapsed);
      this.timer = { running: false, elapsed: isFinite(elapsed) ? Math.max(0, elapsed) : 0, last: 0 };
      if (!this.won && (valid.length > 0 || cur.started)) this.startTimer();

      this.buildBoard();
    },

    startNew: function (target, opts) {
      opts = opts || {};
      this.target = { m: target.m, d: target.d, w: target.w };
      this.playDayKey = CP.dateKey(new Date());
      this.placements = [];
      this.pieceStates = [];
      for (var i = 0; i < 10; i++) this.pieceStates.push({ flip: 0, rot: 0 });
      this.selected = null;
      this.moves = 0;
      this.hints = 0;
      this.revealed = false;
      this.revealCounted = false;
      this.won = false;
      this.answerMode = false;
      this.answers = [];
      this.answerKeys = {};
      this.answerIdx = 0;
      this.answerFromScratch = false;
      this.hint = null;
      this.hintSolution = null;
      this.hintedPieces = {};
      this.lastWinInfo = null;
      this.undoStack = [];
      this.redoStack = [];
      this.timer = { running: false, elapsed: 0, last: 0 };
      this.endDrag();
      this.rebuildBlocked();
      this.buildBoard();
      if (!opts.skipSave) {
        this.renderAll();
        this.save();
      }
    },

    // ---------- DOM ----------
    buildBoard: function () {
      this.board.innerHTML = '';
      this.cellEls = new Array(56);
      var frag = document.createDocumentFragment();
      for (var r = 0; r < CP.H; r++) {
        for (var c = 0; c < CP.W; c++) {
          var idx = CP.idx(r, c);
          var el = document.createElement('div');
          el.className = 'cell';
          el.style.gridRow = String(r + 1);
          el.style.gridColumn = String(c + 1);
          el.dataset.idx = String(idx);
          el.dataset.r = String(r);
          el.dataset.c = String(c);
          el.style.setProperty('--i', String(r + c));

          if (this.wallMask[idx]) {
            el.classList.add('wall');
            el.setAttribute('aria-hidden', 'true');
          } else if (this.targetInfo[idx]) {
            var info = this.targetInfo[idx];
            el.classList.add('target', info.kind);
            if (this.isTodayChallenge()) el.classList.add('today-cell');
            var sub = document.createElement('span');
            sub.className = 'cell-sub';
            sub.textContent = info.sub;
            var main = document.createElement('span');
            main.className = 'cell-main';
            main.textContent = info.main;
            el.appendChild(sub);
            el.appendChild(main);
            el.setAttribute('aria-label', info.sub === '星期' ? '星期' + info.main : info.sub + info.main);
          } else {
            el.classList.add('empty');
            el.setAttribute('aria-hidden', 'true');
          }
          this.cellEls[idx] = el;
          frag.appendChild(el);
        }
      }
      this.board.appendChild(frag);

      var layer = document.createElement('div');
      layer.className = 'piece-layer';
      layer.setAttribute('aria-hidden', 'true');
      this.board.appendChild(layer);
      this.piecesLayer = layer;
      this.pieceLayerEls = {};
      this.prevPieceSet = {};
    },

    // 把一块拼图画成完整剪影：相邻格互相补缝，只在真正的轮廓上做圆角
    shapeLayer: function (piece, flip, rot, r, c, opts) {
      opts = opts || {};
      var def = CP.PIECE_DEFS[piece];
      var cells = CP.transformCells(def.cells, flip, rot);
      var map = {};
      var maxR = 0, maxC = 0;
      for (var i = 0; i < cells.length; i++) {
        map[cells[i][0] + ',' + cells[i][1]] = 1;
        if (cells[i][0] > maxR) maxR = cells[i][0];
        if (cells[i][1] > maxC) maxC = cells[i][1];
      }
      var w = maxC + 1, h = maxR + 1;

      var layer = document.createElement('div');
      layer.className = 'piece' + (opts.className ? ' ' + opts.className : '');
      layer.style.width = 'calc(var(--cell) * ' + w + ' + var(--gap) * ' + (w - 1) + ')';
      layer.style.height = 'calc(var(--cell) * ' + h + ' + var(--gap) * ' + (h - 1) + ')';
      layer.style.left = 'calc(var(--cell) * ' + c + ' + var(--gap) * ' + c + ')';
      layer.style.top = 'calc(var(--cell) * ' + r + ' + var(--gap) * ' + r + ')';
      layer.style.setProperty('--piece-color', def.color);

      for (var k = 0; k < cells.length; k++) {
        var lr = cells[k][0], lc = cells[k][1];
        var up = map[(lr - 1) + ',' + lc];
        var down = map[(lr + 1) + ',' + lc];
        var left = map[lr + ',' + (lc - 1)];
        var right = map[lr + ',' + (lc + 1)];

        var sub = document.createElement('span');
        sub.className = 'piece-cell';
        sub.style.left = 'calc(var(--cell) * ' + lc + ' + var(--gap) * ' + lc + ')';
        sub.style.top = 'calc(var(--cell) * ' + lr + ' + var(--gap) * ' + lr + ')';
        sub.style.width = right ? 'calc(var(--cell) + var(--gap))' : 'var(--cell)';
        sub.style.height = down ? 'calc(var(--cell) + var(--gap))' : 'var(--cell)';
        sub.style.borderRadius = [
          (!up && !left) ? 'var(--piece-r)' : '0',
          (!up && !right) ? 'var(--piece-r)' : '0',
          (!down && !right) ? 'var(--piece-r)' : '0',
          (!down && !left) ? 'var(--piece-r)' : '0'
        ].join(' ');
        sub.style.background = opts.color || def.color;

        if (!opts.flat) {
          var shadow = [];
          if (!up) shadow.push('inset 0 1px 0 rgba(255,255,255,.34)');
          if (!left) shadow.push('inset 1px 0 0 rgba(255,255,255,.16)');
          if (!down) shadow.push('inset 0 -2px 0 rgba(0,0,0,.12)');
          if (!right) shadow.push('inset -1px 0 0 rgba(0,0,0,.06)');
          if (shadow.length) sub.style.boxShadow = shadow.join(', ');
        }
        layer.appendChild(sub);
      }
      return layer;
    },

    buildTray: function () {
      this.tray.innerHTML = '';
      this.pieceEls = [];
      for (var i = 0; i < 10; i++) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tray-piece';
        btn.dataset.piece = String(i);
        btn.style.setProperty('--ti', String(i));
        var mini = document.createElement('span');
        mini.className = 'mini';
        var num = document.createElement('span');
        num.className = 'tray-num';
        num.textContent = String(i + 1);
        btn.appendChild(mini);
        btn.appendChild(num);
        this.tray.appendChild(btn);
        this.pieceEls.push(btn);
      }
    },

    bindEvents: function () {
      var self = this;

      this.tray.addEventListener('pointerdown', function (e) { self.onTrayPointerDown(e); });
      this.tray.addEventListener('click', function (e) {
        if (e.detail !== 0) return;
        var btn = e.target.closest && e.target.closest('.tray-piece');
        if (!btn) return;
        var piece = Number(btn.dataset.piece);
        if (self.isPiecePlaced(piece)) self.removePiece(piece);
        else self.selectPiece(piece);
      });

      global.addEventListener('pointermove', function (e) { self.onPointerMove(e); }, { passive: false });
      global.addEventListener('pointerup', function (e) { self.onPointerUp(e); });
      global.addEventListener('pointercancel', function (e) { self.onPointerCancel(e); });

      this.board.addEventListener('click', function (e) { self.onBoardClick(e); });
      this.board.addEventListener('pointermove', function (e) { self.onBoardPointerMove(e); });
      this.board.addEventListener('pointerleave', function () { self.clearPreview(); });

      this.undoBtn.addEventListener('click', function () { self.undo(); });
      this.redoBtn.addEventListener('click', function () { self.redo(); });
      this.rotateBtn.addEventListener('click', function () { self.rotateSelected(); });
      this.flipBtn.addEventListener('click', function () { self.flipSelected(); });
      this.resetBtn.addEventListener('click', function () { self.reset(); });
      this.hintBtn.addEventListener('click', function () { self.useHint(); });
      this.answerBtn.addEventListener('click', function () { self.showAnswer(); });
      this.answerNextBtn.addEventListener('click', function () { self.nextAnswer(); });
      this.answerResetBtn.addEventListener('click', function () { self.reset(); });

      document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
          self.stopTimer();
          self.save();
        } else {
          self.checkDayRollover();
          if (!self.won && !self.answerMode && (self.placements.length || self.timer.elapsed > 0)) {
            self.startTimer();
          }
        }
      });
      global.addEventListener('beforeunload', function () { self.save(); });

      // 长时间挂在后台或一直开着时 每分钟检查是否跨天
      setInterval(function () { self.checkDayRollover(); }, 60000);

      var backToday = $('btnBackToday');
      if (backToday) {
        backToday.addEventListener('click', function () {
          var today = CP.todayTarget();
          if (self.isTodayChallenge() && !self.won) {
            self.toast('已经是今天的题目');
            return;
          }
          self.startNew(today);
          self.toast('已回到今天 ' + today.m + '月' + today.d + '日');
        });
      }
    },

    // ---------- 渲染 ----------
    renderAll: function () {
      this.renderChallenge();
      this.renderBoardState();
      this.renderTray();
      this.renderMetrics();
      this.renderAnswerBar();
      this.renderControls();
    },

    renderChallenge: function () {
      var week = CP.WEEK_CELLS[this.target.w];
      var title = this.target.m + '月' + this.target.d + '日 星期' + week.label;
      if (this.titleEl.textContent !== title) {
        this.titleEl.textContent = title;
        this.titleEl.classList.remove('swap');
        void this.titleEl.offsetWidth;
        this.titleEl.classList.add('swap');
      }
      var daily = this.isTodayChallenge();
      var tag = this.won ? (daily ? '今日已完成' : '已完成') : (daily ? '今日挑战' : '自由模式');
      if (this.tagEl.textContent !== tag) {
        this.tagEl.textContent = tag;
        this.tagEl.classList.remove('pop');
        void this.tagEl.offsetWidth;
        this.tagEl.classList.add('pop');
      }
      this.tagEl.classList.toggle('done', this.won);
      this.tagEl.classList.toggle('free', !daily && !this.won);
      var backToday = $('btnBackToday');
      if (backToday) backToday.hidden = daily;
    },

    renderBoardState: function () {
      var i;
      for (i = 0; i < 56; i++) {
        var el = this.cellEls[i];
        el.classList.remove('preview-valid', 'preview-invalid');
        el.style.removeProperty('--piece-color');
      }

      if (!this.piecesLayer) return;
      this.piecesLayer.innerHTML = '';
      this.pieceLayerEls = {};

      this.placedByIndex = new Int8Array(56);
      this.placedByIndex.fill(-1);

      var shown = this.answerMode ? (this.answers[this.answerIdx] || []) : this.placements;
      var prevSet = this.prevPieceSet || {};
      this.shownPieceSet = {};

      for (i = 0; i < shown.length; i++) {
        var pl = shown[i];
        var layer = this.shapeLayer(pl.piece, pl.flip, pl.rot, pl.r, pl.c, {
          className: this.answerMode ? 'answer-piece' : ''
        });
        if (this.answerMode) {
          layer.classList.add('reveal-piece');
          layer.style.animationDelay = (i * 34) + 'ms';
        } else if (!prevSet[pl.piece]) {
          layer.classList.add('enter');
          layer.style.animationDelay = (120 + i * 26) + 'ms';
        }
        this.piecesLayer.appendChild(layer);
        this.pieceLayerEls[pl.piece] = layer;
        this.shownPieceSet[pl.piece] = true;
      }
      this.prevPieceSet = this.shownPieceSet;

      for (i = 0; i < this.placements.length; i++) {
        var p = this.placements[i];
        var pCells = this.cellsOfPlacement(p);
        for (var j = 0; j < pCells.length; j++) this.placedByIndex[pCells[j]] = p.piece;
      }

      if (!this.answerMode && this.hint) {
        var hintLayer = this.shapeLayer(this.hint.piece, this.hint.flip, this.hint.rot, this.hint.r, this.hint.c, {
          className: 'hint-piece',
          flat: true,
          color: this.colorOf(this.hint.piece)
        });
        this.piecesLayer.appendChild(hintLayer);
      }

      if (!this.answerMode && this.preview && this.preview.cells) {
        for (i = 0; i < this.preview.cells.length; i++) {
          var pc = this.cellEls[this.preview.cells[i]];
          if (pc) pc.classList.add(this.preview.valid ? 'preview-valid' : 'preview-invalid');
        }
      }

      this.board.classList.toggle('locked', this.won || this.answerMode);
    },

    renderTray: function () {
      for (var i = 0; i < 10; i++) {
        var btn = this.pieceEls[i];
        var placed = !!this.shownPieceSet[i];
        var selected = !placed && this.selected === i && !this.answerMode && !this.won;
        btn.classList.toggle('placed', placed);
        btn.classList.toggle('selected', selected);
        btn.classList.toggle('hinting', !placed && !!(this.hint && this.hint.piece === i));
        btn.setAttribute('aria-label', CP.PIECE_DEFS[i].name + '拼块' + (placed ? ' 已放置' : ''));
        this.buildMini(btn, i);
      }
    },

    buildMini: function (btn, piece) {
      var mini = btn.querySelector('.mini');
      var state = this.pieceStates[piece];
      var cells = CP.transformCells(CP.PIECE_DEFS[piece].cells, state.flip, state.rot);
      var map = {};
      var maxR = 0, maxC = 0;
      for (var i = 0; i < cells.length; i++) {
        map[cells[i][0] + ',' + cells[i][1]] = 1;
        if (cells[i][0] > maxR) maxR = cells[i][0];
        if (cells[i][1] > maxC) maxC = cells[i][1];
      }
      var w = maxC + 1, h = maxR + 1;
      mini.innerHTML = '';
      mini.style.width = 'calc(var(--mini) * ' + w + ' + ' + ((w - 1) * 2) + 'px)';
      mini.style.height = 'calc(var(--mini) * ' + h + ' + ' + ((h - 1) * 2) + 'px)';
      for (var k = 0; k < cells.length; k++) {
        var lr = cells[k][0], lc = cells[k][1];
        var up = map[(lr - 1) + ',' + lc];
        var down = map[(lr + 1) + ',' + lc];
        var left = map[lr + ',' + (lc - 1)];
        var right = map[lr + ',' + (lc + 1)];

        var dot = document.createElement('span');
        dot.className = 'mini-cell';
        dot.style.left = 'calc(var(--mini) * ' + lc + ' + ' + (lc * 2) + 'px)';
        dot.style.top = 'calc(var(--mini) * ' + lr + ' + ' + (lr * 2) + 'px)';
        dot.style.width = right ? 'calc(var(--mini) + 2px)' : 'var(--mini)';
        dot.style.height = down ? 'calc(var(--mini) + 2px)' : 'var(--mini)';
        dot.style.borderRadius = [
          (!up && !left) ? 'var(--mini-r)' : '0',
          (!up && !right) ? 'var(--mini-r)' : '0',
          (!down && !right) ? 'var(--mini-r)' : '0',
          (!down && !left) ? 'var(--mini-r)' : '0'
        ].join(' ');
        dot.style.backgroundColor = CP.PIECE_DEFS[piece].color;
        mini.appendChild(dot);
      }
    },

    setMetric: function (el, value) {
      if (!el || el.textContent === value) return;
      el.textContent = value;
      el.classList.remove('bump');
      void el.offsetWidth;
      el.classList.add('bump');
    },

    renderMetrics: function () {
      this.timerEl.textContent = CP.Storage.formatDuration(this.getElapsed());
      this.setMetric(this.movesEl, String(this.moves));
      this.setMetric(this.progressEl, (this.answerMode ? 10 : this.placements.length) + '/10');
    },

    renderAnswerBar: function () {
      this.answerBar.hidden = !this.answerMode;
      if (!this.answerMode) return;
      var prefix = this.answerFromScratch
        ? '当前摆法无解 已展示初始布局的答案'
        : '答案模式 本局不计入连胜';
      this.answerText.textContent = prefix + ' 第 ' + (this.answerIdx + 1) + '/' + this.answers.length + ' 种';
    },

    renderControls: function () {
      var locked = this.won || this.answerMode;
      this.undoBtn.disabled = locked || this.undoStack.length === 0;
      this.redoBtn.disabled = locked || this.redoStack.length === 0;
      this.rotateBtn.disabled = locked || this.selected === null;
      this.flipBtn.disabled = locked || this.selected === null;
      this.hintBtn.disabled = locked;
      this.answerBtn.disabled = locked;
      if (this.answerLabel) this.answerLabel.textContent = this.answerMode ? '答案中' : '看答案';
    },

    // ---------- 计时 ----------
    startTimer: function () {
      if (this.won || this.answerMode) return;
      if (!this.timer.running) {
        this.timer.running = true;
        this.timer.last = Date.now();
      }
    },

    stopTimer: function () {
      if (this.timer.running) {
        this.timer.elapsed += Date.now() - this.timer.last;
        this.timer.running = false;
        this.timer.last = 0;
      }
    },

    getElapsed: function () {
      return this.timer.elapsed + (this.timer.running ? Date.now() - this.timer.last : 0);
    },

    tick: function () {
      if (!this.timer.running) return;
      var now = Date.now();
      this.timer.elapsed += now - this.timer.last;
      this.timer.last = now;
      this.timerEl.textContent = CP.Storage.formatDuration(this.timer.elapsed);
    },

    // ---------- 历史 ----------
    snapshot: function () {
      return {
        placements: copyList(this.placements),
        pieceStates: this.pieceStates.map(function (s) { return { flip: s.flip, rot: s.rot }; })
      };
    },

    pushHistory: function () {
      this.undoStack.push(this.snapshot());
      if (this.undoStack.length > 100) this.undoStack.shift();
      this.redoStack = [];
      this.hint = null;
      this.hintSolution = null;
      this.hintedPieces = {};
    },

    applySnapshot: function (snap) {
      this.placements = copyList(snap.placements);
      this.pieceStates = snap.pieceStates.map(function (s) { return { flip: s.flip, rot: s.rot }; });
      this.selected = null;
      this.hint = null;
      this.hintSolution = null;
      this.hintedPieces = {};
      this.preview = null;
    },

    undo: function () {
      if (this.won || this.answerMode || !this.undoStack.length) return;
      this.redoStack.push(this.snapshot());
      this.applySnapshot(this.undoStack.pop());
      this.renderAll();
      this.save();
    },

    redo: function () {
      if (this.won || this.answerMode || !this.redoStack.length) return;
      this.undoStack.push(this.snapshot());
      this.applySnapshot(this.redoStack.pop());
      this.renderAll();
      this.save();
    },

    // ---------- 放置 ----------
    rowsOfPiece: function (piece, flip, rot) {
      return CP.transformCells(CP.PIECE_DEFS[piece].cells, flip, rot);
    },

    validCells: function (piece, flip, rot, r, c, ignorePiece) {
      var cells = CP.transformCells(CP.PIECE_DEFS[piece].cells, flip, rot);
      var mask = [];
      for (var i = 0; i < cells.length; i++) {
        var rr = r + cells[i][0];
        var cc = c + cells[i][1];
        if (rr < 0 || rr >= CP.H || cc < 0 || cc >= CP.W) return null;
        var idx = CP.idx(rr, cc);
        if (this.blocked[idx]) return null;
        var occ = this.placedByIndex[idx];
        if (occ >= 0 && occ !== ignorePiece) return null;
        mask.push(idx);
      }
      return mask;
    },

    isPiecePlaced: function (piece) {
      for (var i = 0; i < this.placements.length; i++) {
        if (this.placements[i].piece === piece) return true;
      }
      return false;
    },

    trayPieceRect: function (piece) {
      var btn = this.pieceEls && this.pieceEls[piece];
      var mini = btn && btn.querySelector('.mini');
      if (!mini) return null;
      var rect = mini.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      return rect;
    },

    placePiece: function (piece, flip, rot, r, c, opts) {
      opts = opts || {};
      if (this.won || this.answerMode) return false;
      var mask = this.validCells(piece, flip, rot, r, c, null);
      if (!mask) return false;
      if (this.isPiecePlaced(piece)) return false;

      var fromRect = opts.fromRect || this.trayPieceRect(piece);

      this.pushHistory();
      this.placements.push({ piece: piece, flip: flip, rot: rot, r: r, c: c });
      this.moves++;
      this.selected = null;
      this.startTimer();
      this.renderAll();
      this.animatePieceMorph(piece, fromRect, opts.duration);
      this.save();

      if (navigator.vibrate) {
        try { navigator.vibrate(12); } catch (e) { /* ignore */ }
      }
      if (this.placements.length === 10) this.win();
      return true;
    },

    animatePieceMorph: function (piece, fromRect, duration) {
      var layer = this.pieceLayerEls[piece];
      if (!layer) return;
      layer.classList.remove('enter');
      layer.style.animationDelay = '0ms';
      if (!fromRect || !layer.animate) return;
      var target = layer.getBoundingClientRect();
      if (!target.width || !target.height) return;
      var scale = Math.max(0.2, Math.min(1.45, fromRect.width / target.width));
      var dx = fromRect.left - target.left;
      var dy = fromRect.top - target.top;
      layer.style.transformOrigin = '0 0';
      layer.animate([
        {
          transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + scale + ')',
          opacity: 0.45,
          offset: 0
        },
        { transform: 'translate(0,0) scale(1.05)', opacity: 1, offset: 0.72 },
        { transform: 'translate(0,0) scale(1)', opacity: 1, offset: 1 }
      ], {
        duration: duration || 420,
        easing: 'cubic-bezier(.22,.9,.24,1)'
      });
    },

    findTapAnchor: function (piece, targetIdx) {
      var state = this.pieceStates[piece];
      var cells = CP.transformCells(CP.PIECE_DEFS[piece].cells, state.flip, state.rot);
      var tr = Math.floor(targetIdx / CP.W);
      var tc = targetIdx % CP.W;
      var candidates = [];
      for (var i = 0; i < cells.length; i++) {
        var r = tr - cells[i][0];
        var c = tc - cells[i][1];
        if (this.validCells(piece, state.flip, state.rot, r, c, piece)) {
          candidates.push({ r: r, c: c, dist: Math.abs(r - tr) + Math.abs(c - tc) });
        }
      }
      if (!candidates.length) return null;
      candidates.sort(function (a, b) { return a.dist - b.dist; });
      return candidates[0];
    },

    removePiece: function (piece) {
      if (this.won || this.answerMode) return;
      if (!this.isPiecePlaced(piece)) return;
      var old = this.pieceLayerEls[piece];
      var outLayer = old ? old.cloneNode(true) : null;
      this.pushHistory();
      this.placements = this.placements.filter(function (p) { return p.piece !== piece; });
      this.selected = piece;
      this.renderAll();
      if (outLayer && outLayer.animate && this.piecesLayer) {
        outLayer.classList.remove('enter', 'answer-piece', 'reveal-piece', 'hint-piece');
        outLayer.classList.add('out');
        outLayer.style.animationDelay = '0ms';
        this.piecesLayer.appendChild(outLayer);
        var anim = outLayer.animate([
          { opacity: 1, transform: 'scale(1)' },
          { opacity: 0, transform: 'scale(0.86)' }
        ], { duration: 200, easing: 'cubic-bezier(.4,0,.7,1)' });
        anim.onfinish = function () {
          if (outLayer.parentNode) outLayer.parentNode.removeChild(outLayer);
        };
      }
      this.save();
    },

    selectPiece: function (piece) {
      if (this.won || this.answerMode) return;
      this.selected = piece;
      this.renderTray();
      this.renderControls();
      this.showTransformHint();
    },

    // 首次选中拼块时 演示一次 旋转 与 翻转 的作用
    showTransformHint: function () {
      var group = document.querySelector('.dock-transform');
      if (!group) return;
      var seen = false;
      try { seen = window.localStorage.getItem('cp-transform-hint') === '1'; } catch (e) { return; }
      if (seen) return;
      try { window.localStorage.setItem('cp-transform-hint', '1'); } catch (e) { /* 忽略 */ }
      group.classList.add('hint');
      this.toast('点 旋转 转方向 点 翻转 变镜像');
      setTimeout(function () { group.classList.remove('hint'); }, 1900);
    },

    rotateSelected: function () {
      if (this.won || this.answerMode || this.selected === null) return;
      this.pieceStates[this.selected].rot = (this.pieceStates[this.selected].rot + 1) % 4;
      this.renderTray();
      this.save();
    },

    flipSelected: function () {
      if (this.won || this.answerMode || this.selected === null) return;
      this.pieceStates[this.selected].flip = this.pieceStates[this.selected].flip ? 0 : 1;
      this.renderTray();
      this.save();
    },

    // ---------- 拖拽 ----------
    onTrayPointerDown: function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      if (this.won || this.answerMode) return;
      var btn = e.target.closest && e.target.closest('.tray-piece');
      if (!btn) return;
      var piece = Number(btn.dataset.piece);
      if (this.isPiecePlaced(piece)) {
        this.removePiece(piece);
        return;
      }
      this.selectPiece(piece);
      this.drag = {
        piece: piece,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
        anchor: null,
        valid: false,
        metrics: null,
        bw: 1,
        bh: 1
      };
    },

    onPointerMove: function (e) {
      var d = this.drag;
      if (!d || e.pointerId !== d.pointerId) return;
      if (!d.moved) {
        var dist = Math.hypot(e.clientX - d.startX, e.clientY - d.startY);
        if (dist < 7) return;
        d.moved = true;
        this.beginGhost();
      }
      this.updateGhost(e);
      if (e.cancelable) e.preventDefault();
    },

    onPointerUp: function (e) {
      var d = this.drag;
      if (!d || e.pointerId !== d.pointerId) return;
      if (!d.moved) {
        this.endDrag();
        return;
      }
      var piece = d.piece;
      var anchor = d.anchor;
      var valid = d.valid;
      var state = this.pieceStates[piece];
      var ghostRect = (this.ghost && this.ghost.classList.contains('show'))
        ? this.ghost.getBoundingClientRect()
        : null;
      this.endDrag();
      // 拖拽松手后浏览器可能再补一次 click，短暂屏蔽以免误放置
      this.suppressClickUntil = Date.now() + 250;
      if (valid && anchor) {
        this.placePiece(piece, state.flip, state.rot, anchor.r, anchor.c, {
          fromRect: ghostRect,
          duration: 260
        });
      } else {
        this.toast('这里放不下 换个位置试试');
        this.shakeBoard();
      }
    },

    onPointerCancel: function (e) {
      var d = this.drag;
      if (d && e.pointerId === d.pointerId) this.endDrag();
    },

    measureBoard: function () {
      var rect = this.cellEls[0].getBoundingClientRect();
      var gap = parseFloat(getComputedStyle(this.board).gap) || 3;
      return {
        originX: rect.left,
        originY: rect.top,
        cellW: rect.width,
        cellH: rect.height,
        gap: gap,
        pitchX: rect.width + gap,
        pitchY: rect.height + gap
      };
    },

    beginGhost: function () {
      if (!this.ghost) {
        this.ghost = document.createElement('div');
        this.ghost.className = 'drag-ghost';
        document.body.appendChild(this.ghost);
      }
      var d = this.drag;
      var state = this.pieceStates[d.piece];
      var cells = CP.transformCells(CP.PIECE_DEFS[d.piece].cells, state.flip, state.rot);
      var map = {};
      var maxR = 0, maxC = 0;
      for (var i = 0; i < cells.length; i++) {
        map[cells[i][0] + ',' + cells[i][1]] = 1;
        if (cells[i][0] > maxR) maxR = cells[i][0];
        if (cells[i][1] > maxC) maxC = cells[i][1];
      }
      var m = this.measureBoard();
      d.metrics = m;
      d.bw = maxC + 1;
      d.bh = maxR + 1;

      var radius = Math.max(4, Math.min(10, Math.round(m.cellW * 0.17)));
      var color = CP.PIECE_DEFS[d.piece].color;

      this.ghost.innerHTML = '';
      this.ghost.style.width = (d.bw * m.cellW + (d.bw - 1) * m.gap) + 'px';
      this.ghost.style.height = (d.bh * m.cellH + (d.bh - 1) * m.gap) + 'px';

      for (var k = 0; k < cells.length; k++) {
        var lr = cells[k][0], lc = cells[k][1];
        var up = map[(lr - 1) + ',' + lc];
        var down = map[(lr + 1) + ',' + lc];
        var left = map[lr + ',' + (lc - 1)];
        var right = map[lr + ',' + (lc + 1)];

        var dot = document.createElement('span');
        dot.className = 'ghost-cell';
        dot.style.left = (lc * (m.cellW + m.gap)) + 'px';
        dot.style.top = (lr * (m.cellH + m.gap)) + 'px';
        dot.style.width = (right ? m.cellW + m.gap : m.cellW) + 'px';
        dot.style.height = (down ? m.cellH + m.gap : m.cellH) + 'px';
        dot.style.borderRadius = [
          (!up && !left) ? radius + 'px' : '0',
          (!up && !right) ? radius + 'px' : '0',
          (!down && !right) ? radius + 'px' : '0',
          (!down && !left) ? radius + 'px' : '0'
        ].join(' ');
        dot.style.backgroundColor = color;
        var shadow = [];
        if (!up) shadow.push('inset 0 1px 0 rgba(255,255,255,.34)');
        if (!left) shadow.push('inset 1px 0 0 rgba(255,255,255,.16)');
        if (!down) shadow.push('inset 0 -2px 0 rgba(0,0,0,.12)');
        if (!right) shadow.push('inset -1px 0 0 rgba(0,0,0,.06)');
        if (shadow.length) dot.style.boxShadow = shadow.join(', ');
        this.ghost.appendChild(dot);
      }
      this.ghost.classList.add('show');
    },

    updateGhost: function (e) {
      var d = this.drag;
      if (!d || !d.metrics) return;
      var m = d.metrics;
      var state = this.pieceStates[d.piece];
      var ghostW = d.bw * m.cellW + (d.bw - 1) * m.gap;
      var ghostH = d.bh * m.cellH + (d.bh - 1) * m.gap;
      var lift = e.pointerType === 'touch' ? 52 : 0;
      var anchorC = Math.round((e.clientX - m.originX - ghostW / 2) / m.pitchX);
      var anchorR = Math.round((e.clientY - lift - m.originY - ghostH / 2) / m.pitchY);
      if (Math.abs(anchorR) > 20 || Math.abs(anchorC) > 20) {
        // 拖离棋盘太远时不展示吸附
      }
      d.anchor = { r: anchorR, c: anchorC };
      var mask = this.validCells(d.piece, state.flip, state.rot, anchorR, anchorC, null);
      d.valid = !!mask;
      this.ghost.style.transform = 'translate3d(' +
        (m.originX + anchorC * m.pitchX) + 'px,' +
        (m.originY + anchorR * m.pitchY) + 'px,0)';
      this.ghost.classList.toggle('valid', d.valid);
      this.ghost.classList.toggle('invalid', !d.valid);
      this.setPreview(mask, d.valid);
    },

    endDrag: function () {
      this.drag = null;
      if (this.ghost) {
        this.ghost.classList.remove('show', 'valid', 'invalid');
        this.ghost.innerHTML = '';
      }
      this.clearPreview();
    },

    setPreview: function (mask, valid) {
      this.clearPreview();
      if (!mask) return;
      this.preview = { cells: mask.slice(), valid: !!valid };
      for (var i = 0; i < mask.length; i++) {
        var el = this.cellEls[mask[i]];
        if (el) el.classList.add(valid ? 'preview-valid' : 'preview-invalid');
      }
    },

    clearPreview: function () {
      if (!this.cellEls) return;
      for (var i = 0; i < 56; i++) {
        this.cellEls[i].classList.remove('preview-valid', 'preview-invalid');
      }
      this.preview = null;
    },

    onBoardClick: function (e) {
      if (this.won || this.answerMode) return;
      if (Date.now() < this.suppressClickUntil) return;
      var cell = e.target.closest && e.target.closest('.cell');
      if (!cell) return;
      var idx = Number(cell.dataset.idx);
      if (this.blocked[idx]) return;

      var occ = this.placedByIndex[idx];
      if (occ >= 0) {
        this.removePiece(occ);
        return;
      }
      if (this.selected === null) {
        this.toast('先在下方选一块拼块');
        this.shakeBoard();
        return;
      }
      var anchor = this.findTapAnchor(this.selected, idx);
      if (!anchor) {
        this.toast('这个位置放不下 换个格子');
        this.shakeBoard();
        return;
      }
      var state = this.pieceStates[this.selected];
      this.placePiece(this.selected, state.flip, state.rot, anchor.r, anchor.c);
    },

    onBoardPointerMove: function (e) {
      if (e.pointerType !== 'mouse') return;
      if (this.drag || this.won || this.answerMode || this.selected === null) return;
      var cell = e.target.closest && e.target.closest('.cell');
      if (!cell) return;
      var idx = Number(cell.dataset.idx);
      if (this.blocked[idx]) { this.clearPreview(); return; }
      if (this.placedByIndex[idx] >= 0) { this.clearPreview(); return; }
      var anchor = this.findTapAnchor(this.selected, idx);
      if (!anchor) { this.clearPreview(); return; }
      var state = this.pieceStates[this.selected];
      var mask = this.validCells(this.selected, state.flip, state.rot, anchor.r, anchor.c, this.selected);
      this.setPreview(mask, true);
    },

    // ---------- 提示与答案 ----------
    useHint: function () {
      if (this.won || this.answerMode) return;
      var placed = {};
      for (var i = 0; i < this.placements.length; i++) placed[this.placements[i].piece] = true;

      var sol = this.hintSolution;
      var chosen = null;
      if (sol) {
        for (var j = 0; j < sol.length; j++) {
          if (!placed[sol[j].piece] && !this.hintedPieces[sol[j].piece]) { chosen = sol[j]; break; }
        }
      }

      if (!chosen) {
        var res = CP.Solver.generate(this.targetCells(), copyList(this.placements), {
          maxSolutions: 1,
          timeLimit: 1200,
          shuffle: false
        });
        if (!res.solutions.length) {
          if (res.timedOut) this.toast('搜索超时 再点一次提示试试');
          else {
            this.toast('当前摆法走不通 撤销一步再试');
            this.flashUndo();
          }
          return;
        }
        sol = res.solutions[0];
        this.hintSolution = sol;
        this.hintedPieces = {};
        for (var k = 0; k < sol.length; k++) {
          if (!placed[sol[k].piece]) { chosen = sol[k]; break; }
        }
      }

      if (!chosen) {
        this.toast('这一局已经全部摆好了');
        return;
      }

      this.hintedPieces[chosen.piece] = true;
      this.selected = chosen.piece;
      this.pieceStates[chosen.piece] = { flip: chosen.flip, rot: chosen.rot };
      this.hint = {
        piece: chosen.piece,
        flip: chosen.flip,
        rot: chosen.rot,
        r: chosen.r,
        c: chosen.c,
        cells: chosen.mask.slice(),
        color: this.colorOf(chosen.piece)
      };
      this.hints++;
      this.toast('提示 ' + CP.PIECE_DEFS[chosen.piece].name + '拼块已选中 放到高亮位置');
      this.renderAll();
      this.save();
    },

    flashUndo: function () {
      var btn = this.undoBtn;
      btn.classList.remove('flash');
      void btn.offsetWidth;
      btn.classList.add('flash');
      setTimeout(function () { btn.classList.remove('flash'); }, 1200);
    },

    showAnswer: function () {
      if (this.won || this.answerMode) return;
      var target = this.targetCells();
      var fixed = copyList(this.placements);
      var res = CP.Solver.generate(target, fixed, { maxSolutions: 10, timeLimit: 1600, shuffle: true });
      var fromScratch = false;
      if (!res.solutions.length) {
        res = CP.Solver.generate(target, [], { maxSolutions: 10, timeLimit: 1600, shuffle: true });
        fromScratch = true;
      }
      if (!res.solutions.length) {
        this.toast('暂时没有找到解法 请重置后再试');
        return;
      }

      this.answerMode = true;
      this.answerFromScratch = fromScratch;
      this.answerIdx = 0;
      this.answers = [];
      this.answerKeys = {};
      var self = this;
      res.solutions.forEach(function (s) { self.addAnswer(s); });
      this.stopTimer();
      this.selected = null;
      this.hint = null;
      this.hintSolution = null;
      this.hintedPieces = {};
      this.clearPreview();
      this.revealed = true;
      if (!this.revealCounted) {
        this.stats.viewed = (this.stats.viewed || 0) + 1;
        this.revealCounted = true;
      }
      this.renderAll();
      this.save();
    },

    addAnswer: function (solution) {
      var key = CP.Solver.solutionKey(solution);
      if (this.answerKeys[key]) return false;
      this.answerKeys[key] = true;
      this.answers.push(solution);
      return true;
    },

    nextAnswer: function () {
      if (!this.answerMode) return;
      if (this.answerIdx + 1 < this.answers.length) {
        this.answerIdx++;
        this.renderAll();
        return;
      }
      var target = this.targetCells();
      var fixed = this.answerFromScratch ? [] : copyList(this.placements);
      var res = CP.Solver.generate(target, fixed, { maxSolutions: 20, timeLimit: 1200, shuffle: true });
      var added = 0;
      var self = this;
      res.solutions.forEach(function (s) { if (self.addAnswer(s)) added++; });
      if (added > 0) {
        this.answerIdx = this.answers.length - added;
        this.renderAll();
      } else {
        this.toast(res.timedOut ? '搜索超时 再点一次试试' : '没有更多不同的解法了');
      }
    },

    // ---------- 结算 ----------
    win: function () {
      if (this.won) return;
      this.won = true;
      this.stopTimer();
      var ms = this.getElapsed();
      var info = {
        ms: ms,
        moves: this.moves,
        hints: this.hints,
        isDaily: this.isTodayChallenge(),
        counted: false,
        streak: 0,
        isRecord: false,
        target: { m: this.target.m, d: this.target.d, w: this.target.w },
        revealed: this.revealed
      };

      if (!this.revealed) {
        var key = CP.dateKey(new Date());
        var prevBest = this.stats.bestMs;
        CP.Storage.recordWin(this.stats, key, {
          ms: ms,
          moves: this.moves,
          hints: this.hints,
          daily: info.isDaily,
          ts: Date.now()
        }, info.isDaily);
        info.counted = true;
        info.isRecord = prevBest == null || ms < prevBest;
        info.streak = CP.Storage.computeStreak(this.stats.dailyDays, key);
      } else {
        info.streak = CP.Storage.computeStreak(this.stats.dailyDays, CP.dateKey(new Date()));
      }

      this.lastWinInfo = info;
      this.selected = null;
      this.hint = null;
      this.hintSolution = null;
      this.hintedPieces = {};
      this.undoStack = [];
      this.redoStack = [];
      this.renderAll();
      this.save();

      if (typeof this.opts.onWin === 'function') this.opts.onWin(info);
    },

    // ---------- 重置与存档 ----------
    reset: function () {
      if (this.answerMode || this.won) {
        this.startNew(this.target);
        this.toast('已重新开始');
        return;
      }
      var had = this.placements.length > 0;
      if (had) this.pushHistory();
      this.placements = [];
      this.pieceStates = this.pieceStates.map(function () { return { flip: 0, rot: 0 }; });
      this.selected = null;
      this.hint = null;
      this.hintSolution = null;
      this.hintedPieces = {};
      this.moves = 0;
      this.hints = 0;
      this.revealed = false;
      this.revealCounted = false;
      this.timer = { running: false, elapsed: 0, last: 0 };
      this.renderAll();
      this.save();
      this.toast(had ? '已重置 可以撤销' : '已经是最初状态');
    },

    save: function () {
      if (!this.target) return;
      this.data.stats = this.stats;
      this.data.current = {
        target: { m: this.target.m, d: this.target.d, w: this.target.w },
        playDay: this.playDayKey,
        placements: copyList(this.placements),
        pieceStates: this.pieceStates.map(function (s) { return { flip: s.flip, rot: s.rot }; }),
        moves: this.moves,
        hints: this.hints,
        revealed: this.revealed,
        won: this.won,
        elapsed: this.getElapsed(),
        started: this.placements.length > 0 || this.timer.elapsed > 0
      };
      CP.Storage.save(this.data);
    },

    // ---------- 小工具 ----------
    toast: function (msg) {
      if (!this.toastEl) return;
      this.toastEl.textContent = msg;
      this.toastEl.classList.add('show');
      clearTimeout(this.toastTimer);
      var self = this;
      this.toastTimer = setTimeout(function () {
        self.toastEl.classList.remove('show');
      }, 2300);
    },

    shakeBoard: function () {
      this.board.classList.remove('shake');
      void this.board.offsetWidth;
      this.board.classList.add('shake');
      var self = this;
      setTimeout(function () { self.board.classList.remove('shake'); }, 520);
    }
  };

  global.Game = Game;
})(window);
