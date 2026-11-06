(function () {
  'use strict';
  var CP = window.CP;

  function $(id) { return document.getElementById(id); }

  var game = null;
  var dateSel = { m: 1, d: 1, w: 0 };
  var lastFocus = null;
  var deferredPrompt = null;

  function weekName(w) { return '星期' + CP.WEEK_CELLS[w].label; }

  function openModal(modal) {
    lastFocus = document.activeElement;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    var closeBtn = modal.querySelector('.modal-close');
    if (closeBtn) {
      setTimeout(function () { closeBtn.focus({ preventScroll: true }); }, 60);
    }
  }

  function closeModal(modal) {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    if (!document.querySelector('.modal.open')) {
      document.body.classList.remove('modal-open');
    }
    if (lastFocus && lastFocus.focus) {
      try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }
  }

  function closeAllModals() {
    var modals = document.querySelectorAll('.modal.open');
    for (var i = 0; i < modals.length; i++) {
      modals[i].classList.remove('open');
      modals[i].setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('modal-open');
  }

  // ---------- 日期选择 ----------
  function buildDateChips() {
    var monthGrid = $('monthGrid');
    var dayGrid = $('dayGrid');
    var weekGrid = $('weekGrid');

    for (var m = 1; m <= 12; m++) {
      var mBtn = document.createElement('button');
      mBtn.type = 'button';
      mBtn.className = 'chip';
      mBtn.dataset.value = String(m);
      mBtn.textContent = String(m);
      monthGrid.appendChild(mBtn);
    }
    for (var d = 1; d <= 31; d++) {
      var dBtn = document.createElement('button');
      dBtn.type = 'button';
      dBtn.className = 'chip';
      dBtn.dataset.value = String(d);
      dBtn.textContent = String(d);
      dayGrid.appendChild(dBtn);
    }
    for (var w = 0; w < 7; w++) {
      var wBtn = document.createElement('button');
      wBtn.type = 'button';
      wBtn.className = 'chip';
      wBtn.dataset.value = String(w);
      wBtn.textContent = CP.WEEK_CELLS[w].label;
      weekGrid.appendChild(wBtn);
    }

    monthGrid.addEventListener('click', function (e) {
      var chip = e.target.closest('.chip');
      if (!chip) return;
      dateSel.m = Number(chip.dataset.value);
      updateDateUI();
    });
    dayGrid.addEventListener('click', function (e) {
      var chip = e.target.closest('.chip');
      if (!chip) return;
      dateSel.d = Number(chip.dataset.value);
      updateDateUI();
    });
    weekGrid.addEventListener('click', function (e) {
      var chip = e.target.closest('.chip');
      if (!chip) return;
      dateSel.w = Number(chip.dataset.value);
      updateDateUI();
    });
  }

  function updateDateUI() {
    var groups = [
      { grid: $('monthGrid'), value: dateSel.m },
      { grid: $('dayGrid'), value: dateSel.d },
      { grid: $('weekGrid'), value: dateSel.w }
    ];
    groups.forEach(function (g) {
      var chips = g.grid.querySelectorAll('.chip');
      for (var i = 0; i < chips.length; i++) {
        chips[i].classList.toggle('on', Number(chips[i].dataset.value) === g.value);
      }
    });
    $('datePreview').textContent = dateSel.m + '月' + dateSel.d + '日 ' + weekName(dateSel.w);
    var warning = $('dateWarning');
    var hasProgress = game && (game.placements.length > 0 || game.answerMode);
    warning.hidden = !hasProgress;
  }

  function openDateModal() {
    dateSel = { m: game.target.m, d: game.target.d, w: game.target.w };
    updateDateUI();
    openModal($('dateModal'));
  }

  function applyDate() {
    var target = { m: dateSel.m, d: dateSel.d, w: dateSel.w };
    var same = CP.isSameTarget(target, game.target) && !game.won && !game.answerMode;
    closeModal($('dateModal'));
    if (same) {
      game.toast('已经是这一局了');
      return;
    }
    game.startNew(target);
    game.toast('已开始 ' + target.m + '月' + target.d + '日 ' + weekName(target.w));
  }

  // ---------- 统计 ----------
  function renderStats() {
    var stats = game.stats;
    var todayKey = CP.dateKey(new Date());
    var streak = CP.Storage.computeStreak(stats.dailyDays, todayKey);
    var keys = Object.keys(stats.days);
    var wins = keys.length;
    var totalMs = 0;
    for (var i = 0; i < keys.length; i++) totalMs += Number(stats.days[keys[i]].ms) || 0;
    var avg = wins ? totalMs / wins : null;

    var grid = $('statsGrid');
    grid.innerHTML = '';
    var cards = [
      { label: '连续每日挑战', value: String(streak), unit: '天' },
      { label: '完成局数', value: String(wins), unit: '局' },
      { label: '最佳时间', value: CP.Storage.formatDuration(stats.bestMs), unit: '' },
      { label: '平均时间', value: CP.Storage.formatDuration(avg), unit: '' }
    ];
    cards.forEach(function (card, index) {
      var el = document.createElement('div');
      el.className = 'stat-card';
      el.style.setProperty('--i', String(index));
      var span = document.createElement('span');
      span.textContent = card.label;
      var strong = document.createElement('strong');
      strong.textContent = card.value;
      el.appendChild(span);
      el.appendChild(strong);
      if (card.unit) {
        var em = document.createElement('em');
        em.textContent = card.unit;
        el.appendChild(em);
      }
      grid.appendChild(el);
    });

    var dailyCount = Object.keys(stats.dailyDays).length;
    $('statsFoot').textContent = '每日挑战完成 ' + dailyCount + ' 天 查看答案 ' + (stats.viewed || 0) + ' 次';

    renderHeatmap(stats, todayKey);
  }

  function renderHeatmap(stats, todayKey) {
    var heatmap = $('heatmap');
    heatmap.innerHTML = '';
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var start = CP.Storage.addDays(today, -(today.getDay() + 49));

    for (var i = 0; i < 56; i++) {
      var day = CP.Storage.addDays(start, i);
      var key = CP.dateKey(day);
      var entry = stats.days[key];
      var cell = document.createElement('div');
      cell.className = 'heat-cell';
      cell.style.setProperty('--i', String(i));
      cell.textContent = String(day.getDate());
      if (entry) {
        cell.classList.add('solved');
        if (!entry.daily) cell.classList.add('free');
        cell.title = key + ' 完成 ' + CP.Storage.formatDuration(entry.ms);
      } else {
        cell.title = key + ' 未完成';
      }
      if (key === todayKey) cell.classList.add('today');
      if (day.getTime() > today.getTime()) cell.classList.add('future');
      heatmap.appendChild(cell);
    }
  }

  function openStats() {
    renderStats();
    openModal($('statsModal'));
  }

  // ---------- 胜利 ----------
  function showWin(info) {
    var week = CP.WEEK_CELLS[info.target.w];
    $('winSub').textContent = info.target.m + '月' + info.target.d + '日 星期' + week.label;
    $('winTime').textContent = CP.Storage.formatDuration(info.ms);
    $('winMoves').textContent = String(info.moves);
    $('winHints').textContent = String(info.hints);

    var note = '';
    if (!info.counted) {
      note = '本局查看过答案 不计入完成与连胜';
    } else if (info.isDaily) {
      note = '今日挑战完成 连续 ' + info.streak + ' 天';
      if (info.isRecord) note += ' 新纪录';
    } else {
      note = '自由日期完成 不计入每日连胜';
    }
    $('winNote').textContent = note;

    buildConfetti();
    openModal($('winModal'));
  }

  function buildConfetti() {
    var box = $('confetti');
    box.innerHTML = '';
    var colors = CP.PIECE_DEFS.map(function (p) { return p.color; });
    for (var i = 0; i < 26; i++) {
      var piece = document.createElement('i');
      piece.style.left = (Math.random() * 100) + '%';
      piece.style.background = colors[i % colors.length];
      piece.style.width = (5 + Math.random() * 5) + 'px';
      piece.style.height = (9 + Math.random() * 8) + 'px';
      piece.style.animationDuration = (1.5 + Math.random() * 0.9) + 's';
      piece.style.animationDelay = (Math.random() * 0.5) + 's';
      box.appendChild(piece);
    }
  }

  // ---------- 安装 ----------
  var INSTALL_TIP_KEY = 'cp-install-tip-hidden';

  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true;
  }

  function tipWasHidden() {
    try { return window.localStorage.getItem(INSTALL_TIP_KEY) === '1'; } catch (e) { return false; }
  }

  function rememberTipHidden() {
    try { window.localStorage.setItem(INSTALL_TIP_KEY, '1'); } catch (e) { /* 隐私模式下忽略 */ }
  }

  function initInstall() {
    var btn = $('btnInstall');
    var tip = $('installTip');
    var tipGo = $('installTipGo');
    var tipClose = $('installTipClose');
    var tipTimer = null;

    function hideTip(remember) {
      if (!tip) return;
      if (remember) rememberTipHidden();
      tip.classList.remove('show');
      document.body.classList.remove('tip-open');
      clearTimeout(tipTimer);
      tipTimer = setTimeout(function () { tip.hidden = true; }, 380);
    }

    function showTip() {
      if (!deferredPrompt || !tip || isStandalone() || tipWasHidden()) return;
      // 电脑端已有顶栏安装入口 只在手机端弹出
      if (!window.matchMedia('(max-width: 900px)').matches) return;
      clearTimeout(tipTimer);
      tip.hidden = false;
      document.body.classList.add('tip-open');
      requestAnimationFrame(function () { tip.classList.add('show'); });
    }

    function runPrompt() {
      var prompt = deferredPrompt;
      if (!prompt) return;
      deferredPrompt = null;
      prompt.prompt();
      var choice = prompt.userChoice;
      if (!choice || !choice.then) return;
      choice.then(function (result) {
        btn.hidden = true;
        hideTip(true);
        if (result && result.outcome === 'accepted' && game) {
          game.toast('安装完成 之后离线也能打开');
        }
      });
    }

    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredPrompt = e;
      btn.hidden = false;
      setTimeout(showTip, 900);
    });

    btn.addEventListener('click', function () {
      if (!deferredPrompt) {
        openHelp();
        return;
      }
      runPrompt();
    });

    if (tipGo) tipGo.addEventListener('click', runPrompt);
    if (tipClose) tipClose.addEventListener('click', function () { hideTip(true); });

    window.addEventListener('appinstalled', function () {
      btn.hidden = true;
      hideTip(true);
      if (game) game.toast('已安装到设备');
    });
  }

  function openHelp() {
    openModal($('helpModal'));
  }

  // ---------- 启动 ----------
  function boot() {
    game = new window.Game({ onWin: showWin });
    window.game = game;

    buildDateChips();

    $('btnDate').addEventListener('click', openDateModal);
    $('btnStats').addEventListener('click', openStats);
    $('btnHelp').addEventListener('click', openHelp);

    $('btnApplyDate').addEventListener('click', applyDate);
    $('btnToday').addEventListener('click', function () {
      var today = CP.todayTarget();
      dateSel = { m: today.m, d: today.d, w: today.w };
      updateDateUI();
    });
    $('btnRandom').addEventListener('click', function () {
      dateSel = {
        m: Math.floor(Math.random() * 12) + 1,
        d: Math.floor(Math.random() * 31) + 1,
        w: Math.floor(Math.random() * 7)
      };
      updateDateUI();
    });

    $('winReplay').addEventListener('click', function () {
      closeModal($('winModal'));
      game.reset();
    });
    $('winDate').addEventListener('click', function () {
      closeModal($('winModal'));
      openDateModal();
    });
    $('winStats').addEventListener('click', function () {
      closeModal($('winModal'));
      openStats();
    });

    var closeButtons = document.querySelectorAll('[data-close]');
    for (var i = 0; i < closeButtons.length; i++) {
      closeButtons[i].addEventListener('click', function (e) {
        var modal = e.target.closest('.modal');
        if (modal) closeModal(modal);
      });
    }

    var modals = document.querySelectorAll('.modal');
    for (var j = 0; j < modals.length; j++) {
      modals[j].addEventListener('click', function (e) {
        if (e.target === e.currentTarget) closeModal(e.currentTarget);
      });
    }

    var modalCards = document.querySelectorAll('.modal-card');
    for (var c = 0; c < modalCards.length; c++) {
      var kids = modalCards[c].children;
      for (var d = 0; d < kids.length; d++) {
        if (kids[d].classList.contains('confetti') || kids[d].classList.contains('win-check')) continue;
        kids[d].style.setProperty('--d', (50 + d * 42) + 'ms');
      }
    }

    document.addEventListener('keydown', function (e) {
      var open = document.querySelector('.modal.open');
      if (e.key === 'Escape') {
        if (open) closeModal(open);
        return;
      }
      if (open) return;
      var key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) game.redo();
        else game.undo();
        return;
      }
      if (key === 'r') { game.rotateSelected(); return; }
      if (key === 'f') { game.flipSelected(); return; }
      if (e.key === '?') { openHelp(); }
    });

    initInstall();

    if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () {
          /* 离线缓存不可用时仍可正常游玩 */
        });
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
