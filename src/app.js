(function () {
  'use strict';
  var CP = window.CP;

  function $(id) { return document.getElementById(id); }

  var game = null;
  var dateSel = CP.normalizeTarget(CP.todayTarget());
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
  // 年 月 日都可选，星期一律按所选年月日现算
  function currentYear() { return new Date().getFullYear(); }

  function buildDateChips() {
    var monthGrid = $('monthGrid');
    var dayGrid = $('dayGrid');

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

    monthGrid.addEventListener('click', function (e) {
      var chip = e.target.closest('.chip');
      if (!chip) return;
      dateSel.m = Number(chip.dataset.value);
      dateSel = CP.normalizeTarget(dateSel);
      updateDateUI();
    });
    dayGrid.addEventListener('click', function (e) {
      var chip = e.target.closest('.chip');
      if (!chip || chip.disabled) return;
      dateSel.d = Number(chip.dataset.value);
      dateSel = CP.normalizeTarget(dateSel);
      updateDateUI();
    });
  }

  function updateDateUI() {
    dateSel = CP.normalizeTarget(dateSel) || CP.todayTarget();
    var maxDay = CP.daysInMonth(dateSel.m, dateSel.y);

    var yearInput = $('yearInput');
    if (yearInput && document.activeElement !== yearInput) yearInput.value = String(dateSel.y);

    var monthChips = $('monthGrid').querySelectorAll('.chip');
    for (var i = 0; i < monthChips.length; i++) {
      monthChips[i].classList.toggle('on', Number(monthChips[i].dataset.value) === dateSel.m);
    }

    var dayChips = $('dayGrid').querySelectorAll('.chip');
    for (var j = 0; j < dayChips.length; j++) {
      var v = Number(dayChips[j].dataset.value);
      var disabled = v > maxDay;
      dayChips[j].disabled = disabled;
      dayChips[j].classList.toggle('disabled', disabled);
      dayChips[j].classList.toggle('on', v === dateSel.d);
    }

    $('datePreview').textContent = dateSel.y + '年' + dateSel.m + '月' + dateSel.d + '日 ' + weekName(dateSel.w);
    var warning = $('dateWarning');
    var hasProgress = game && (game.placements.length > 0 || game.answerMode);
    warning.hidden = !hasProgress;
  }

  function setYear(y) {
    var next = Math.round(Number(y));
    if (!isFinite(next)) return;
    next = Math.max(1, Math.min(9999, next));
    dateSel = CP.normalizeTarget({ y: next, m: dateSel.m, d: dateSel.d });
    updateDateUI();
  }

  function bindYearControls() {
    var input = $('yearInput');
    if (!input) return;
    $('yearPrev').addEventListener('click', function () { setYear(dateSel.y - 1); });
    $('yearNext').addEventListener('click', function () { setYear(dateSel.y + 1); });
    input.addEventListener('change', function () { setYear(input.value); });
    input.addEventListener('blur', function () { input.value = String(dateSel.y); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        setYear(input.value);
        input.blur();
      }
    });
  }

  function openDateModal() {
    dateSel = CP.normalizeTarget({ y: game.target.y, m: game.target.m, d: game.target.d }) || CP.todayTarget();
    updateDateUI();
    openModal($('dateModal'));
  }

  function applyDate() {
    var target = CP.normalizeTarget({ y: dateSel.y, m: dateSel.m, d: dateSel.d });
    if (!target) return;
    var same = CP.isSameTarget(target, game.target) && !game.won && !game.answerMode;
    closeModal($('dateModal'));
    if (same) {
      game.toast('已经是这一局了');
      return;
    }
    game.startNew(target, { flash: true });
    var yPrefix = target.y === currentYear() ? '' : target.y + '年';
    game.toast('已开始 ' + yPrefix + target.m + '月' + target.d + '日 ' + weekName(target.w));
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

    $('statStreak').textContent = String(streak);
    $('statWins').textContent = String(wins);
    $('statBest').textContent = CP.Storage.formatDuration(stats.bestMs);
    $('statAvg').textContent = CP.Storage.formatDuration(avg);

    var chip = $('statToday');
    var todayEntry = stats.days[todayKey];
    if (todayEntry && todayEntry.daily) {
      chip.textContent = '今日已完成';
      chip.className = 'stat-chip done';
    } else if (todayEntry) {
      chip.textContent = '今日自由完成';
      chip.className = 'stat-chip free';
    } else {
      chip.textContent = '今日待完成';
      chip.className = 'stat-chip';
    }

    $('footDaily').textContent = String(Object.keys(stats.dailyDays).length);
    $('footViewed').textContent = String(stats.viewed || 0);

    renderHeatmap(stats, todayKey);
  }

  function renderHeatmap(stats, todayKey) {
    var heatmap = $('heatmap');
    var detail = $('heatDetail');
    heatmap.innerHTML = '';
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    // 8 列（每周一列）× 7 行，起点为 7 周前的周日
    var start = CP.Storage.addDays(today, -(today.getDay() + 49));

    for (var i = 0; i < 56; i++) {
      var day = CP.Storage.addDays(start, i);
      var key = CP.dateKey(day);
      var entry = stats.days[key];
      var dateText = (day.getMonth() + 1) + '月' + day.getDate() + '日';
      var info;
      var cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'heat-cell';
      cell.style.setProperty('--i', String(i));

      if (entry) {
        cell.classList.add(entry.daily ? 'daily' : 'free');
        info = dateText + (entry.daily ? ' 每日挑战完成 ' : ' 自由日期完成 ') +
          CP.Storage.formatDuration(entry.ms);
      } else if (day.getTime() > today.getTime()) {
        cell.classList.add('future');
        info = dateText + ' 未开始';
      } else {
        info = dateText + ' 未完成';
      }
      if (key === todayKey) cell.classList.add('today');

      cell.title = info;
      cell.setAttribute('aria-label', info);
      cell.dataset.info = info;
      cell.addEventListener('click', function () {
        detail.textContent = this.dataset.info;
        if (detail.animate) {
          detail.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
        }
      });
      heatmap.appendChild(cell);
    }

    detail.textContent = todayEntryText(stats.days[todayKey], today);
  }

  function todayEntryText(entry, today) {
    var dateText = (today.getMonth() + 1) + '月' + today.getDate() + '日';
    if (!entry) return dateText + ' 未完成';
    return dateText + (entry.daily ? ' 每日挑战完成 ' : ' 自由日期完成 ') +
      CP.Storage.formatDuration(entry.ms);
  }

  function openStats() {
    renderStats();
    openModal($('statsModal'));
  }

  // ---------- 胜利 ----------
  function showWin(info) {
    var week = CP.WEEK_CELLS[info.target.w];
    var yPrefix = info.target.y === currentYear() ? '' : info.target.y + '年';
    $('winSub').textContent = yPrefix + info.target.m + '月' + info.target.d + '日 星期' + week.label;
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
    // 恭喜卡片不自动关闭 焦点直接落在确认按钮上 回车即可关闭
    setTimeout(function () {
      $('winConfirm').focus({ preventScroll: true });
    }, 60);
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

  // 安装包内是 file:// 环境 没有安装入口 也不该弹安装引导
  function isLocalFile() {
    return window.location.protocol === 'file:';
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
    var tipTitle = $('installTipTitle');
    var tipSub = $('installTipSub');
    var tipGo = $('installTipGo');
    var tipDown = $('installTipDown');
    var tipClose = $('installTipClose');
    var tipTimer = null;

    // 不支持 beforeinstallprompt 的浏览器 改用菜单引导 + 安装包下载
    function setTipMode(mode) {
      if (!tip) return;
      if (mode === 'fallback') {
        tipTitle.textContent = '在浏览器菜单里 添加到桌面';
        tipSub.textContent = '找不到入口就下载安装包';
        if (tipGo) tipGo.hidden = true;
        if (tipDown) tipDown.hidden = false;
      } else {
        tipTitle.textContent = '装到桌面 离线也能玩';
        tipSub.textContent = '独立全屏 没有地址栏';
        if (tipGo) tipGo.hidden = false;
        if (tipDown) tipDown.hidden = true;
      }
    }

    function hideTip(remember) {
      if (!tip) return;
      if (remember) rememberTipHidden();
      tip.classList.remove('show');
      document.body.classList.remove('tip-open');
      clearTimeout(tipTimer);
      tipTimer = setTimeout(function () { tip.hidden = true; }, 380);
    }

    function revealTip() {
      if (!tip || isLocalFile() || isStandalone() || tipWasHidden()) return;
      if (!window.matchMedia('(max-width: 900px)').matches) return;
      clearTimeout(tipTimer);
      tip.hidden = false;
      document.body.classList.add('tip-open');
      requestAnimationFrame(function () { tip.classList.add('show'); });
    }

    function showInstallTip() {
      if (!deferredPrompt) return;
      setTipMode('install');
      revealTip();
    }

    function showFallbackTip() {
      if (deferredPrompt || isStandalone() || tipWasHidden()) return;
      if (!window.matchMedia('(max-width: 900px)').matches) return;
      if (!/Android|iPhone|iPad|iPod|Mobile/i.test(window.navigator.userAgent)) return;
      setTipMode('fallback');
      revealTip();
    }

    function runPrompt() {
      var prompt = deferredPrompt;
      if (!prompt) return;
      deferredPrompt = null;
      hideTip(true);
      try {
        prompt.prompt();
      } catch (e) {
        if (game) game.toast('安装失败 可以从浏览器菜单手动添加');
        openHelp();
        return;
      }
      var choice = prompt.userChoice;
      if (!choice || !choice.then) return;
      choice.then(function (result) {
        if (result && result.outcome === 'accepted') {
          btn.hidden = true;
          if (game) game.toast('安装完成 之后离线也能打开');
        }
      });
    }

    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredPrompt = e;
      btn.hidden = false;
      if (tip && !tip.hidden) {
        setTipMode('install');
        return;
      }
      setTimeout(showInstallTip, 900);
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
    if (tipDown) tipDown.addEventListener('click', function () { hideTip(true); });

    window.addEventListener('appinstalled', function () {
      btn.hidden = true;
      hideTip(true);
      if (game) game.toast('已安装到设备');
    });

    // Chromium 会提前触发安装事件 等一会还没有就用兜底引导
    setTimeout(showFallbackTip, 1800);
  }

  function openHelp() {
    openModal($('helpModal'));
  }

  // ---------- 启动 ----------
  function boot() {
    game = new window.Game({ onWin: showWin });
    window.game = game;

    buildDateChips();
    bindYearControls();

    $('btnDate').addEventListener('click', openDateModal);
    $('btnStats').addEventListener('click', openStats);
    $('btnHelp').addEventListener('click', openHelp);

    $('btnApplyDate').addEventListener('click', applyDate);
    $('btnToday').addEventListener('click', function () {
      dateSel = CP.normalizeTarget(CP.todayTarget());
      updateDateUI();
    });
    $('btnRandom').addEventListener('click', function () {
      var m = Math.floor(Math.random() * 12) + 1;
      var d = Math.floor(Math.random() * CP.daysInMonth(m, dateSel.y)) + 1;
      dateSel = CP.normalizeTarget({ y: dateSel.y, m: m, d: d });
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
    $('winConfirm').addEventListener('click', function () {
      closeModal($('winModal'));
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
        if (e.target !== e.currentTarget) return;
        // 恭喜卡片保持停留 误触背景不关闭 必须点击确认按钮
        if (e.currentTarget.id === 'winModal') return;
        closeModal(e.currentTarget);
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
        // 恭喜卡片需主动点击确认 不响应 Esc
        if (open && open.id !== 'winModal') closeModal(open);
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
      // 已有旧版本接管时 新 Service Worker 生效后自动刷新一次
      // 避免本次加载继续运行旧缓存里的脚本 刷新一次即可拿到同一版本的全部资源
      var hadController = !!navigator.serviceWorker.controller;
      var swReloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (!hadController || swReloading) return;
        swReloading = true;
        location.reload();
      });
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
