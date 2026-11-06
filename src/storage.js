(function (global) {
  'use strict';
  var CP = global.CP;
  var KEY = 'calendarPuzzle.v1';
  var memoryFallback = null;

  function defaultStats() {
    return {
      wins: 0,
      dailyWins: 0,
      viewed: 0,
      bestMs: null,
      days: {},
      dailyDays: {}
    };
  }

  function defaultData() {
    return {
      version: 1,
      current: null,
      stats: defaultStats(),
      settings: {}
    };
  }

  function load() {
    var raw;
    try {
      raw = global.localStorage.getItem(KEY);
    } catch (e) {
      raw = null;
    }
    if (!raw && memoryFallback) raw = memoryFallback;
    if (!raw) return defaultData();
    try {
      var data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return defaultData();
      return {
        version: data.version || 1,
        current: data.current || null,
        stats: Object.assign(defaultStats(), data.stats || {}),
        settings: data.settings || {}
      };
    } catch (e) {
      return defaultData();
    }
  }

  function save(data) {
    var payload = JSON.stringify(data);
    memoryFallback = payload;
    try {
      global.localStorage.setItem(KEY, payload);
      return true;
    } catch (e) {
      return false;
    }
  }

  function parseKey(key) {
    var parts = key.split('-');
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  function addDays(date, n) {
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() + n);
    return d;
  }

  function computeStreak(dailyDays, todayKey) {
    var cursor = parseKey(todayKey);
    if (!dailyDays[todayKey]) cursor = addDays(cursor, -1);
    var streak = 0;
    while (dailyDays[CP.dateKey(cursor)]) {
      streak++;
      cursor = addDays(cursor, -1);
    }
    return streak;
  }

  // 返回 true 表示这是当天第一次完成。
  function recordWin(stats, key, entry, isDaily) {
    var isNew = !stats.days[key];
    if (isNew) {
      stats.days[key] = entry;
      stats.wins = (stats.wins || 0) + 1;
    }
    if (isDaily && !stats.dailyDays[key]) {
      stats.dailyDays[key] = entry;
      stats.dailyWins = (stats.dailyWins || 0) + 1;
    }
    if (stats.bestMs == null || entry.ms < stats.bestMs) stats.bestMs = entry.ms;
    return isNew;
  }

  function formatDuration(ms) {
    if (ms == null || isNaN(ms)) return '—';
    var total = Math.max(0, Math.round(ms / 1000));
    var h = Math.floor(total / 3600);
    var m = Math.floor((total - h * 3600) / 60);
    var s = total % 60;
    if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  CP.Storage = {
    load: load,
    save: save,
    defaultStats: defaultStats,
    computeStreak: computeStreak,
    recordWin: recordWin,
    formatDuration: formatDuration,
    dateKey: CP.dateKey,
    addDays: addDays
  };
})(window);
