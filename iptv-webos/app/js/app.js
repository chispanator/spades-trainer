/*
 * IPTV Player for LG webOS — screens, remote-control navigation, playback.
 * Plain ES2015 for old webOS Chromium (no async/await, ?., ??, object spread).
 */
(function () {
  'use strict';

  var KEY = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13,
    BACK: 461, ESC: 27, BACKSPACE: 8,
    PLAY: 415, PAUSE: 19, PLAY_PAUSE: 179, STOP: 413, FF: 417, RW: 412,
    CH_UP: 33, CH_DOWN: 34, RED: 403, F: 70
  };

  var SECTIONS = ['live', 'vod', 'series', 'info'];
  var SECTION_LABEL = { live: 'channels', vod: 'movies', series: 'series' };

  // Card geometry (layout px at 1920x1080)
  var CARD = {
    live: { w: 260, h: 170, gap: 20 },
    vod: { w: 160, h: 240, gap: 20 },
    series: { w: 160, h: 240, gap: 20 }
  };
  var CAT_ROW_H = 64;
  var EP_ROW_H = 84;

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function pad2(n) { return ('0' + n).slice(-2); }

  function fmtClock(ms) {
    var d = new Date(ms);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function fmtDuration(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    return (h ? h + ':' + pad2(m) : m) + ':' + pad2(s);
  }

  var store = {
    get: function (k, def) {
      try {
        var v = localStorage.getItem('iptv.' + k);
        return v == null ? def : JSON.parse(v);
      } catch (e) { return def; }
    },
    set: function (k, v) {
      try { localStorage.setItem('iptv.' + k, JSON.stringify(v)); } catch (e) { /* quota / private */ }
    },
    remove: function (k) {
      try { localStorage.removeItem('iptv.' + k); } catch (e) { /* ignore */ }
    }
  };

  var state = {
    screen: 'login',
    api: null,
    account: null,
    section: 'live',
    catalogs: {},
    raw: {},
    scans: {},
    zone: 'tabs',
    tabFocus: 0,
    catFocus: {},
    catTop: 0,
    catList: [],
    gridFocus: 0,
    gridTop: 0,
    view: [],
    query: '',
    infoFocus: 0,
    loading: false,
    loadToken: 0,
    loginFocus: 0,
    series: null,
    player: null,
    prevScreen: 'browse',
    favs: store.get('favs', { live: {}, vod: {}, series: {} }),
    settings: store.get('settings', { liveExt: 'm3u8' })
  };

  // ------------------------------------------------------------------ utils

  function fitStage() {
    var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    $('stage').style.transform = 'scale(' + s + ')';
  }

  function showScreen(name) {
    ['login', 'browse', 'series', 'player'].forEach(function (n) {
      $(n).classList.toggle('active', n === name);
    });
    state.screen = name;
  }

  var toastTimer = null;
  function toast(msg, ms) {
    var el = $('toast');
    el.textContent = msg;
    el.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('visible'); }, ms || 3000);
  }

  function showLoading(text) {
    state.loading = true;
    $('loading-text').textContent = text || 'Loading…';
    $('loading').classList.add('visible');
    return ++state.loadToken;
  }

  function setLoadingText(text) { $('loading-text').textContent = text; }

  function hideLoading() {
    state.loading = false;
    $('loading').classList.remove('visible');
  }

  function itemImage(item) {
    return item.stream_icon || item.cover || item.movie_image || '';
  }

  // ------------------------------------------------------------------ login

  var LOGIN_FIELDS = ['in-server', 'in-user', 'in-pass', 'btn-login'];

  function renderLoginFocus() {
    LOGIN_FIELDS.forEach(function (id, i) {
      $(id).classList.toggle('focused', i === state.loginFocus);
    });
    var el = $(LOGIN_FIELDS[state.loginFocus]);
    if (el.tagName === 'INPUT') el.focus(); else if (document.activeElement) document.activeElement.blur();
  }

  function openLogin(error) {
    var creds = store.get('creds', null);
    if (creds) {
      $('in-server').value = creds.server || '';
      $('in-user').value = creds.username || '';
      $('in-pass').value = creds.password || '';
    }
    $('login-error').textContent = error || '';
    showScreen('login');
    state.loginFocus = creds ? 3 : 0;
    renderLoginFocus();
  }

  function doLogin(creds) {
    if (!creds.server || !creds.username || !creds.password) {
      $('login-error').textContent = 'Please fill in all three fields.';
      return;
    }
    var api = new Xtream(creds);
    var token = showLoading('Connecting to ' + api.server + '…');
    api.login().then(function (data) {
      if (token !== state.loadToken) return;
      hideLoading();
      store.set('creds', { server: api.server, username: creds.username, password: creds.password });
      state.api = api;
      state.account = data;
      state.catalogs = {};
      state.raw = {};
      state.scans = {};
      showScreen('browse');
      selectSection(store.get('lastSection', 'live'), true);
    }, function (err) {
      if (token !== state.loadToken) return;
      hideLoading();
      openLogin(loginErrorText(err, api.server));
    });
  }

  function loginErrorText(err, server) {
    var msg = err && err.message ? err.message : String(err);
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
      msg = 'Could not reach ' + server + '. Check the URL (including :port) and that the TV is online.';
    }
    return msg;
  }

  function loginKey(code) {
    var el = $(LOGIN_FIELDS[state.loginFocus]);
    if (code === KEY.UP && state.loginFocus > 0) { state.loginFocus--; renderLoginFocus(); return true; }
    if (code === KEY.DOWN && state.loginFocus < LOGIN_FIELDS.length - 1) { state.loginFocus++; renderLoginFocus(); return true; }
    if (code === KEY.ENTER) {
      if (el.tagName === 'INPUT') {
        state.loginFocus++;
        renderLoginFocus();
      } else {
        submitLogin();
      }
      return true;
    }
    return false;
  }

  function submitLogin() {
    doLogin({
      server: $('in-server').value,
      username: $('in-user').value.trim(),
      password: $('in-pass').value.trim()
    });
  }

  // ------------------------------------------------------------------ catalog loading

  function fetchPerCategory(section, cats, onProgress) {
    var api = state.api;
    var queue = cats.slice();
    var total = queue.length;
    var done = 0;
    var failed = 0;
    var all = [];
    function worker() {
      if (!queue.length) return Promise.resolve();
      var cat = queue.shift();
      return api.items(section, cat.category_id).then(function (items) {
        all = all.concat(items);
      }, function () {
        failed++;
      }).then(function () {
        done++;
        if (onProgress) onProgress(done, total);
        return worker();
      });
    }
    var workers = [];
    for (var i = 0; i < 4; i++) workers.push(worker());
    return Promise.all(workers).then(function () {
      return { items: all, failed: failed, total: total };
    });
  }

  function ensureCatalog(section) {
    if (state.catalogs[section]) return Promise.resolve(state.catalogs[section]);
    var api = state.api;
    var label = SECTION_LABEL[section];
    var token = showLoading('Loading ' + label + '…');
    var cats;
    return api.categories(section).then(function (c) {
      cats = c;
      if (token !== state.loadToken) throw new Error('cancelled');
      setLoadingText('Loading all ' + label + ' (' + cats.length + ' categories)…');
      return api.items(section).catch(function () {
        // Full list too big / timed out on this server: fall back to one request per category.
        return fetchPerCategory(section, cats, function (d, t) {
          if (token === state.loadToken) setLoadingText('Loading ' + label + ': category ' + d + ' of ' + t + '…');
        }).then(function (res) { return res.items; });
      });
    }).then(function (items) {
      if (token !== state.loadToken) throw new Error('cancelled');
      state.raw[section] = { cats: cats, items: items };
      state.catalogs[section] = Xtream.buildCatalog(section, cats, items);
      hideLoading();
      return state.catalogs[section];
    }, function (err) {
      if (token === state.loadToken) hideLoading();
      throw err;
    });
  }

  function deepScan(section) {
    return ensureCatalog(section).then(function (catalog) {
      var raw = state.raw[section];
      var before = catalog.stats.unique;
      var token = showLoading('Deep scan: checking every category…');
      return fetchPerCategory(section, raw.cats, function (d, t) {
        if (token === state.loadToken) setLoadingText('Deep scan ' + SECTION_LABEL[section] + ': category ' + d + ' of ' + t + '…');
      }).then(function (res) {
        if (token !== state.loadToken) return;
        hideLoading();
        // Only add titles we don't already have, so the stats still describe the full list.
        var idKey = Xtream.ACTIONS[section].idKey;
        var have = {};
        raw.items.forEach(function (it) { if (it) have[String(it[idKey])] = true; });
        raw.items = raw.items.concat(res.items.filter(function (it) {
          if (!it || have[String(it[idKey])]) return false;
          have[String(it[idKey])] = true;
          return true;
        }));
        state.catalogs[section] = Xtream.buildCatalog(section, raw.cats, raw.items);
        var extra = state.catalogs[section].stats.unique - before;
        state.scans[section] = { categories: res.total, failed: res.failed, extra: extra, at: Date.now() };
        toast(extra > 0
          ? 'Deep scan found ' + extra + ' extra ' + SECTION_LABEL[section] + ' — now included.'
          : 'Deep scan: nothing extra, the full list was already complete.', 5000);
      });
    });
  }

  // ------------------------------------------------------------------ browse: tabs & categories

  function selectSection(section, focusContent) {
    if (SECTIONS.indexOf(section) < 0) section = 'live';
    state.section = section;
    state.tabFocus = SECTIONS.indexOf(section);
    store.set('lastSection', section);
    state.query = '';
    $('search').value = '';
    renderTabs();

    var isInfo = section === 'info';
    $('info').classList.toggle('visible', isInfo);
    $('grid').style.display = isInfo ? 'none' : '';
    $('detail').style.display = isInfo ? 'none' : '';
    $('search').classList.remove('visible');

    if (isInfo) {
      $('cats').innerHTML = '';
      $('content-title').textContent = 'Account & diagnostics';
      state.infoFocus = 0;
      if (focusContent) state.zone = 'info';
      renderTabs();
      renderInfo();
      return;
    }

    state.catList = [];
    state.view = [];
    $('cats').innerHTML = '';
    $('grid').innerHTML = '';
    $('detail').innerHTML = '';
    $('content-title').textContent = '';
    ensureCatalog(section).then(function () {
      if (state.section !== section) return;
      buildCatList();
      if (focusContent) state.zone = 'cats';
      renderTabs();
      applyCategory();
    }, function (err) {
      state.zone = 'tabs';
      renderTabs();
      if (err && err.message === 'cancelled') return;
      $('grid').innerHTML = '<div class="empty">Could not load ' + SECTION_LABEL[section] + ': ' +
        esc(err && err.message) + '<br>Press OK on the tab to retry.</div>';
    });
  }

  function renderTabs() {
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('current', tabs[i].getAttribute('data-section') === state.section);
      tabs[i].classList.toggle('focused', state.zone === 'tabs' && i === state.tabFocus);
    }
  }

  function buildCatList() {
    var section = state.section;
    var catalog = state.catalogs[section];
    var favCount = catalog.items.filter(function (it) { return state.favs[section][it._key]; }).length;
    var list = [{ id: '__search', name: 'Search', count: '' }];
    if (favCount) list.push({ id: '__fav', name: '★ Favorites', count: favCount });
    catalog.categories.forEach(function (c) {
      list.push({ id: c.id, name: c.name, count: c.items.length, cat: c });
    });
    state.catList = list;
    // Default to "All" rather than Search on first open
    var f = state.catFocus[section];
    // The query is cleared on section change, so reopening on an empty Search is pointless
    if (f == null || f >= list.length || (list[f].id === '__search' && !state.query.trim())) f = indexOfCat('__all');
    state.catFocus[section] = f;
  }

  function indexOfCat(id) {
    for (var i = 0; i < state.catList.length; i++) if (state.catList[i].id === id) return i;
    return 0;
  }

  function currentCat() {
    return state.catList[state.catFocus[state.section]] || state.catList[0];
  }

  function renderCats() {
    var el = $('cats');
    var list = state.catList;
    var visible = Math.floor((el.clientHeight - 40) / CAT_ROW_H) || 12;
    var f = state.catFocus[state.section];
    if (f < state.catTop) state.catTop = f;
    if (f >= state.catTop + visible) state.catTop = f - visible + 1;
    if (state.catTop > Math.max(0, list.length - visible)) state.catTop = Math.max(0, list.length - visible);
    var html = '';
    for (var i = state.catTop; i < Math.min(list.length, state.catTop + visible); i++) {
      var c = list[i];
      var cls = 'cat' + (i === f ? ' current' : '') + (i === f && state.zone === 'cats' ? ' focused' : '');
      html += '<div class="' + cls + '" data-cat="' + i + '"><span class="name">' + esc(c.name) +
        '</span><span class="count">' + esc(c.count) + '</span></div>';
    }
    el.innerHTML = html;
  }

  function itemsForCat(cat) {
    var section = state.section;
    var catalog = state.catalogs[section];
    if (cat.id === '__search') {
      var q = Xtream.foldText(state.query.trim());
      if (!q) return [];
      var words = q.split(/\s+/);
      return catalog.items.filter(function (it) {
        for (var i = 0; i < words.length; i++) if (it._search.indexOf(words[i]) < 0) return false;
        return true;
      });
    }
    if (cat.id === '__fav') {
      return catalog.items.filter(function (it) { return state.favs[section][it._key]; });
    }
    return cat.cat.items;
  }

  function applyCategory() {
    var cat = currentCat();
    state.view = itemsForCat(cat);
    state.gridFocus = 0;
    state.gridTop = 0;
    var isSearch = cat.id === '__search';
    $('search').classList.toggle('visible', isSearch);
    var title = cat.name;
    if (isSearch) {
      title = state.query.trim() ? 'Search · ' + state.view.length + ' results' : 'Search ' +
        state.catalogs[state.section].items.length + ' ' + SECTION_LABEL[state.section];
    } else {
      title += ' · ' + state.view.length + ' ' + SECTION_LABEL[state.section];
    }
    $('content-title').textContent = title;
    renderCats();
    renderGrid();
    updateDetail();
  }

  // ------------------------------------------------------------------ browse: grid

  function gridGeom() {
    var g = CARD[state.section] || CARD.vod;
    var el = $('grid');
    var cols = Math.max(1, Math.floor((el.clientWidth + g.gap) / (g.w + g.gap)));
    var rows = Math.max(1, Math.floor((el.clientHeight + g.gap) / (g.h + g.gap)));
    return { w: g.w, h: g.h, gap: g.gap, cols: cols, rows: rows };
  }

  function renderGrid() {
    var el = $('grid');
    var view = state.view;
    if (!view.length) {
      var cat = currentCat();
      var msg = cat && cat.id === '__search'
        ? (state.query.trim() ? 'No matches for “' + esc(state.query) + '”.' : 'Press OK on the search box above and type a title.')
        : 'Nothing here.';
      el.innerHTML = '<div class="empty">' + msg + '</div>';
      return;
    }
    var geo = gridGeom();
    var imgH = state.section === 'live' ? geo.h - 44 : geo.h;
    var html = '';
    var start = state.gridTop * geo.cols;
    var end = Math.min(view.length, (state.gridTop + geo.rows) * geo.cols);
    for (var i = start; i < end; i++) {
      var it = view[i];
      var r = Math.floor(i / geo.cols) - state.gridTop;
      var c = i % geo.cols;
      var focused = state.zone === 'grid' && i === state.gridFocus;
      var img = itemImage(it);
      var initial = esc(it._name.replace(/^[^A-Za-z0-9]+/, '').charAt(0).toUpperCase() || '?');
      html += '<div class="card ' + state.section + (focused ? ' focused' : '') + '" data-idx="' + i + '" style="left:' +
        (c * (geo.w + geo.gap)) + 'px;top:' + (r * (geo.h + geo.gap)) + 'px;width:' + geo.w + 'px;height:' + geo.h + 'px">' +
        '<div class="ph" style="height:' + imgH + 'px">' + initial + '</div>' +
        (img ? '<img src="' + esc(img) + '" style="height:' + imgH + 'px" onerror="this.parentNode.removeChild(this)">' : '') +
        '<div class="label">' + (state.section === 'live' && it.num ? esc(it.num) + ' · ' : '') + esc(it._name) + '</div>' +
        (state.favs[state.section][it._key] ? '<div class="fav">★</div>' : '') +
        '</div>';
    }
    el.innerHTML = html;
  }

  function scrollGridTo(f) {
    var geo = gridGeom();
    var n = state.view.length;
    if (!n) return;
    f = Math.max(0, Math.min(n - 1, f));
    state.gridFocus = f;
    var row = Math.floor(f / geo.cols);
    if (row < state.gridTop) state.gridTop = row;
    if (row >= state.gridTop + geo.rows) state.gridTop = row - geo.rows + 1;
    renderGrid();
    updateDetail();
  }

  var epgTimer = null;
  var epgToken = 0;
  function updateDetail() {
    var el = $('detail');
    var it = state.view[state.gridFocus];
    clearTimeout(epgTimer);
    if (!it) { el.innerHTML = ''; return; }
    var parts = [];
    if (it.rating && it.rating !== '0') parts.push('★ ' + esc(it.rating));
    if (it.genre) parts.push(esc(it.genre));
    if (it.releaseDate || it.release_date) parts.push(esc(it.releaseDate || it.release_date));
    if (it.added) parts.push('Added ' + new Date(Number(it.added) * 1000).toLocaleDateString());
    parts.push((state.gridFocus + 1) + ' of ' + state.view.length);
    var hint = 'Red button / F: favorite';
    el.innerHTML = '<b>' + esc(it._name) + '</b><br>' + parts.join(' · ') + ' · <span class="muted">' + hint + '</span>';

    if (state.section === 'live') {
      var token = ++epgToken;
      epgTimer = setTimeout(function () {
        state.api.shortEpg(it.stream_id, 2).then(function (list) {
          if (token !== epgToken || !list.length) return;
          el.innerHTML = '<b>' + esc(it._name) + '</b><br>' + epgLine(list);
        }, function () { /* EPG is optional */ });
      }, 600);
    }
  }

  function epgLine(list) {
    var now = list[0];
    var next = list[1];
    var s = 'Now: ' + esc(now.title) + ' (' + fmtClock(now.start) + '–' + fmtClock(now.end) + ')';
    if (next) s += ' · Next: ' + esc(next.title) + ' (' + fmtClock(next.start) + ')';
    return s;
  }

  function toggleFavorite() {
    var it = state.view[state.gridFocus];
    if (!it) return;
    var favs = state.favs[state.section];
    if (favs[it._key]) delete favs[it._key]; else favs[it._key] = true;
    store.set('favs', state.favs);
    toast(favs[it._key] ? 'Added to favorites' : 'Removed from favorites');
    var catId = currentCat().id;
    buildCatList();
    state.catFocus[state.section] = indexOfCat(catId);
    if (catId === '__fav') {
      var f = state.gridFocus;
      applyCategory();
      if (state.view.length) scrollGridTo(Math.min(f, state.view.length - 1)); else state.zone = 'cats';
      renderCats();
    } else {
      renderCats();
      renderGrid();
    }
  }

  function openItem(idx) {
    var it = state.view[idx];
    if (!it) return;
    if (state.section === 'live') playLive(state.view, idx);
    else if (state.section === 'vod') playVod({ kind: 'vod', title: it._name, url: state.api.movieUrl(it), resumeKey: 'm' + it._key });
    else if (state.section === 'series') openSeries(it);
  }

  // ------------------------------------------------------------------ browse: info / diagnostics

  var INFO_ACTIONS = [
    { id: 'scan-vod', label: 'Deep scan Movies' },
    { id: 'scan-series', label: 'Deep scan Series' },
    { id: 'scan-live', label: 'Deep scan Live' },
    { id: 'format', label: 'Live format' },
    { id: 'logout', label: 'Log out' }
  ];

  function renderInfo() {
    var acc = state.account || {};
    var u = acc.user_info || {};
    var s = acc.server_info || {};
    var rows = [
      ['Server', esc(state.api ? state.api.server : '')],
      ['Status', esc(u.status || '?') + (String(u.is_trial) === '1' ? ' (trial)' : '')],
      ['Expires', u.exp_date ? new Date(Number(u.exp_date) * 1000).toLocaleString() : 'never / unknown'],
      ['Connections', esc(u.active_cons || 0) + ' active of ' + esc(u.max_connections || '?') + ' allowed'],
      ['Formats', esc(Xtream.toArray(u.allowed_output_formats).join(', ') || '?')],
      ['Server time', esc(s.time_now || '') + ' ' + esc(s.timezone || '')]
    ];
    var html = '<div class="cols"><div><h2>Account</h2><table>' +
      rows.map(function (r) { return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>'; }).join('') + '</table></div>';

    html += '<div><h2>What the server returned</h2><table><tr><td></td><td>Live</td><td>Movies</td><td>Series</td></tr>';
    var metrics = [
      ['unique', 'Unique titles'],
      ['returned', 'Rows returned'],
      ['duplicates', 'Duplicate rows'],
      ['categories', 'Categories'],
      ['emptyCategories', 'Empty categories'],
      ['uncategorized', 'Uncategorized titles'],
      ['multiCategory', 'In 2+ categories']
    ];
    metrics.forEach(function (m) {
      html += '<tr><td>' + m[1] + '</td>';
      ['live', 'vod', 'series'].forEach(function (sec) {
        var c = state.catalogs[sec];
        html += '<td>' + (c ? c.stats[m[0]] : '—') + '</td>';
      });
      html += '</tr>';
    });
    html += '<tr><td>Deep scan</td>';
    ['live', 'vod', 'series'].forEach(function (sec) {
      var sc = state.scans[sec];
      html += '<td>' + (sc ? (sc.extra > 0 ? '+' + sc.extra + ' found' : 'complete') + (sc.failed ? ', ' + sc.failed + ' failed' : '') : '—') + '</td>';
    });
    html += '</tr></table></div></div>';

    html += '<div class="actions">';
    INFO_ACTIONS.forEach(function (a, i) {
      var label = a.id === 'format' ? 'Live format: ' + state.settings.liveExt.toUpperCase() : a.label;
      html += '<div class="action' + (state.zone === 'info' && i === state.infoFocus ? ' focused' : '') + '" data-action="' + i + '">' + label + '</div>';
    });
    html += '</div>';
    html += '<p class="note">“—” means that tab hasn’t been opened yet. Uncategorized titles are ones whose category the server ' +
      'doesn’t list — many players hide them; here they get their own “Uncategorized” group. Deep scan asks for every category ' +
      'one by one and adds anything missing from the full list.</p>';
    $('info').innerHTML = html;
  }

  function runInfoAction(i) {
    var a = INFO_ACTIONS[i];
    if (!a) return;
    if (a.id.indexOf('scan-') === 0) {
      deepScan(a.id.slice(5)).then(renderInfo, function (err) {
        if (err && err.message === 'cancelled') return;
        toast('Scan failed: ' + (err && err.message), 5000);
        renderInfo();
      });
    } else if (a.id === 'format') {
      state.settings.liveExt = state.settings.liveExt === 'm3u8' ? 'ts' : 'm3u8';
      store.set('settings', state.settings);
      renderInfo();
    } else if (a.id === 'logout') {
      store.remove('creds');
      state.api = null;
      state.catalogs = {};
      state.raw = {};
      $('in-pass').value = '';
      openLogin('');
      state.loginFocus = 0;
      renderLoginFocus();
    }
  }

  // ------------------------------------------------------------------ browse: keys

  function setZone(z) {
    state.zone = z;
    if (z === 'search') {
      $('search').classList.add('focused');
      $('search').focus();
    } else {
      $('search').classList.remove('focused');
      if (document.activeElement === $('search')) $('search').blur();
    }
    renderTabs();
    if (state.section === 'info') { renderInfo(); return; }
    if (state.catList.length && state.catalogs[state.section]) {
      renderCats();
      renderGrid();
    }
  }

  function browseKey(code) {
    var z = state.zone;
    var geo;

    if (z === 'tabs') {
      if (code === KEY.LEFT && state.tabFocus > 0) { state.tabFocus--; renderTabs(); }
      else if (code === KEY.RIGHT && state.tabFocus < SECTIONS.length - 1) { state.tabFocus++; renderTabs(); }
      else if (code === KEY.ENTER || code === KEY.DOWN) {
        var sec = SECTIONS[state.tabFocus];
        if (sec !== state.section || !state.catalogs[sec]) selectSection(sec, true);
        else setZone(sec === 'info' ? 'info' : 'cats');
      } else if (code === KEY.BACK) { exitApp(); }
      else return false;
      return true;
    }

    if (z === 'cats') {
      var f = state.catFocus[state.section];
      if (code === KEY.UP) {
        if (f > 0) { state.catFocus[state.section] = f - 1; state.query = ''; $('search').value = ''; applyCategory(); }
        else setZone('tabs');
      } else if (code === KEY.DOWN) {
        if (f < state.catList.length - 1) { state.catFocus[state.section] = f + 1; state.query = ''; $('search').value = ''; applyCategory(); }
      } else if (code === KEY.CH_UP || code === KEY.CH_DOWN) {
        var jump = code === KEY.CH_DOWN ? 10 : -10;
        state.catFocus[state.section] = Math.max(0, Math.min(state.catList.length - 1, f + jump));
        applyCategory();
      } else if (code === KEY.RIGHT || code === KEY.ENTER) {
        if (currentCat().id === '__search') setZone('search');
        else if (state.view.length) setZone('grid');
      } else if (code === KEY.BACK) { setZone('tabs'); }
      else return false;
      return true;
    }

    if (z === 'search') {
      if (code === KEY.UP) setZone('tabs');
      else if ((code === KEY.DOWN || code === KEY.ENTER) && state.view.length) setZone('grid');
      else if (code === KEY.BACK || code === KEY.ESC) setZone('cats');
      else return false; // let the input handle typing / caret keys
      return true;
    }

    if (z === 'grid') {
      geo = gridGeom();
      var g = state.gridFocus;
      var n = state.view.length;
      if (code === KEY.LEFT) {
        if (g % geo.cols === 0) setZone('cats'); else scrollGridTo(g - 1);
      } else if (code === KEY.RIGHT) {
        if ((g + 1) % geo.cols !== 0 && g + 1 < n) scrollGridTo(g + 1);
      } else if (code === KEY.UP) {
        if (g - geo.cols >= 0) scrollGridTo(g - geo.cols);
        else setZone(currentCat().id === '__search' ? 'search' : 'tabs');
      } else if (code === KEY.DOWN) {
        if (g + geo.cols < n) scrollGridTo(g + geo.cols);
        else if (Math.floor(g / geo.cols) < Math.floor((n - 1) / geo.cols)) scrollGridTo(n - 1);
      } else if (code === KEY.CH_DOWN) {
        scrollGridTo(g + geo.cols * geo.rows);
      } else if (code === KEY.CH_UP) {
        scrollGridTo(g - geo.cols * geo.rows);
      } else if (code === KEY.ENTER) {
        openItem(g);
      } else if (code === KEY.RED || code === KEY.F) {
        toggleFavorite();
      } else if (code === KEY.BACK) {
        setZone('cats');
      } else return false;
      return true;
    }

    if (z === 'info') {
      if (code === KEY.LEFT && state.infoFocus > 0) { state.infoFocus--; renderInfo(); }
      else if (code === KEY.RIGHT && state.infoFocus < INFO_ACTIONS.length - 1) { state.infoFocus++; renderInfo(); }
      else if (code === KEY.UP || code === KEY.BACK) setZone('tabs');
      else if (code === KEY.ENTER) runInfoAction(state.infoFocus);
      else return false;
      return true;
    }
    return false;
  }

  function exitApp() {
    try { window.close(); } catch (e) { /* not allowed in desktop browsers */ }
  }

  // ------------------------------------------------------------------ series

  function openSeries(item) {
    var token = showLoading('Loading episodes…');
    state.api.seriesInfo(item.series_id).then(function (data) {
      if (token !== state.loadToken) return;
      hideLoading();
      var seasons = groupSeasons(data || {});
      var info = (data && data.info) || {};
      state.series = { item: item, seasons: seasons, seasonIdx: 0, epIdx: 0, epTop: 0, zone: seasons.length ? 'episodes' : 'seasons' };
      var cover = info.cover || item.cover || '';
      $('series-cover').style.visibility = cover ? '' : 'hidden';
      $('series-cover').src = cover;
      $('series-title').textContent = info.name || item._name;
      $('series-meta').textContent = [info.genre || item.genre, info.releaseDate || item.releaseDate, info.rating || item.rating ? '★ ' + (info.rating || item.rating) : '']
        .filter(Boolean).join(' · ');
      $('series-plot').textContent = info.plot || item.plot || '';
      state.prevScreen = 'browse';
      showScreen('series');
      renderSeries();
    }, function (err) {
      if (token !== state.loadToken) return;
      hideLoading();
      toast('Could not load series: ' + (err && err.message), 5000);
    });
  }

  function groupSeasons(data) {
    var bySeason = {};
    var eps = data.episodes;
    if (Array.isArray(eps)) {
      // Some panels send an array of arrays / flat array instead of {season: [...]}
      eps.forEach(function (x) {
        Xtream.toArray(Array.isArray(x) ? x : [x]).forEach(function (ep) {
          var s = String(ep.season || 1);
          (bySeason[s] = bySeason[s] || []).push(ep);
        });
      });
    } else if (eps && typeof eps === 'object') {
      Object.keys(eps).forEach(function (s) { bySeason[s] = Xtream.toArray(eps[s]); });
    }
    var names = {};
    Xtream.toArray(data.seasons).forEach(function (s) {
      if (s && s.season_number != null && s.name) names[String(s.season_number)] = s.name;
    });
    return Object.keys(bySeason).sort(function (a, b) { return Number(a) - Number(b); }).map(function (s) {
      var list = bySeason[s].slice().sort(function (a, b) { return Number(a.episode_num) - Number(b.episode_num); });
      return { num: s, name: names[s] || 'Season ' + s, eps: list };
    });
  }

  function renderSeries() {
    var sr = state.series;
    var html = '';
    sr.seasons.forEach(function (s, i) {
      var cls = 'cat' + (i === sr.seasonIdx ? ' current' : '') + (i === sr.seasonIdx && sr.zone === 'seasons' ? ' focused' : '');
      html += '<div class="' + cls + '" data-season="' + i + '"><span class="name">' + esc(s.name) + '</span><span class="count">' + s.eps.length + '</span></div>';
    });
    $('seasons').innerHTML = html;

    var season = sr.seasons[sr.seasonIdx];
    var el = $('episodes');
    if (!season) {
      el.innerHTML = '<div class="empty muted">The server returned no episodes for this series.</div>';
      return;
    }
    var visible = Math.floor((el.clientHeight - 40) / EP_ROW_H) || 6;
    if (sr.epIdx < sr.epTop) sr.epTop = sr.epIdx;
    if (sr.epIdx >= sr.epTop + visible) sr.epTop = sr.epIdx - visible + 1;
    html = '';
    for (var i = sr.epTop; i < Math.min(season.eps.length, sr.epTop + visible); i++) {
      var ep = season.eps[i];
      var dur = ep.info && (ep.info.duration || (ep.info.duration_secs ? fmtDuration(ep.info.duration_secs) : ''));
      var watched = store.get('pos.e' + ep.id, null);
      html += '<div class="ep' + (sr.zone === 'episodes' && i === sr.epIdx ? ' focused' : '') + '" data-ep="' + i + '">' +
        '<span class="num">E' + esc(ep.episode_num || i + 1) + '</span><span class="name">' + esc(ep.title || 'Episode ' + (i + 1)) + '</span>' +
        (watched ? '<span class="dur">▶ ' + fmtDuration(watched) + '</span>' : '') +
        (dur ? '<span class="dur">' + esc(dur) + '</span>' : '') + '</div>';
    }
    el.innerHTML = html;
  }

  function playEpisode(idx) {
    var sr = state.series;
    var season = sr.seasons[sr.seasonIdx];
    var ep = season && season.eps[idx];
    if (!ep) return;
    sr.epIdx = idx;
    playVod({
      kind: 'episode',
      title: sr.item._name,
      subtitle: season.name + ' · E' + (ep.episode_num || idx + 1) + ' · ' + (ep.title || ''),
      url: state.api.episodeUrl(ep),
      resumeKey: 'e' + ep.id,
      prevScreen: 'series'
    });
  }

  function seriesKey(code) {
    var sr = state.series;
    var season = sr.seasons[sr.seasonIdx];
    if (sr.zone === 'seasons') {
      if (code === KEY.UP && sr.seasonIdx > 0) { sr.seasonIdx--; sr.epIdx = 0; sr.epTop = 0; }
      else if (code === KEY.DOWN && sr.seasonIdx < sr.seasons.length - 1) { sr.seasonIdx++; sr.epIdx = 0; sr.epTop = 0; }
      else if ((code === KEY.RIGHT || code === KEY.ENTER) && season && season.eps.length) sr.zone = 'episodes';
      else if (code === KEY.BACK) { showScreen('browse'); return true; }
      else return false;
    } else {
      if (code === KEY.UP && sr.epIdx > 0) sr.epIdx--;
      else if (code === KEY.DOWN && season && sr.epIdx < season.eps.length - 1) sr.epIdx++;
      else if (code === KEY.LEFT) sr.zone = 'seasons';
      else if (code === KEY.ENTER) { playEpisode(sr.epIdx); return true; }
      else if (code === KEY.BACK) { showScreen('browse'); return true; }
      else return false;
    }
    renderSeries();
    return true;
  }

  // ------------------------------------------------------------------ player

  var video = null;
  var osdTimer = null;
  var stallTimer = null;
  var saveTimer = null;

  function showOsd(ms) {
    $('osd').classList.remove('hidden');
    clearTimeout(osdTimer);
    osdTimer = setTimeout(function () {
      if (state.player && !video.paused) $('osd').classList.add('hidden');
    }, ms || 4000);
  }

  function playerMsg(text) {
    var el = $('player-msg');
    el.textContent = text || '';
    el.classList.toggle('visible', !!text);
  }

  function startSource(url) {
    clearTimeout(stallTimer);
    playerMsg('Loading…');
    video.src = url;
    video.load();
    var p = video.play();
    if (p && p.catch) p.catch(function () { /* autoplay promise; errors come via 'error' */ });
    stallTimer = setTimeout(function () {
      if (state.player && video.readyState < 3) playerMsg('Still loading… the stream may be offline. Press Back to leave.');
    }, 20000);
  }

  function playLive(list, idx) {
    var it = list[idx];
    if (!it) return;
    if (state.screen !== 'player') state.prevScreen = state.screen;
    state.player = { kind: 'live', list: list, index: idx, ext: state.settings.liveExt, triedAlt: false };
    showScreen('player');
    $('osd-title').textContent = (it.num ? it.num + ' · ' : '') + it._name;
    $('osd-sub').textContent = '';
    $('osd-progress').classList.remove('visible');
    $('osd-time').textContent = '';
    $('osd-hint').textContent = '▲▼ / CH± change channel · OK info · Back to exit';
    showOsd(5000);
    startSource(state.api.liveUrl(it, state.player.ext));
    var token = ++epgToken;
    state.api.shortEpg(it.stream_id, 2).then(function (epg) {
      if (token !== epgToken || !epg.length) return;
      $('osd-sub').innerHTML = epgLine(epg);
    }, function () { /* optional */ });
  }

  function playVod(opts) {
    if (state.screen !== 'player') state.prevScreen = opts.prevScreen || state.screen;
    state.player = { kind: opts.kind, resumeKey: opts.resumeKey, resumed: false };
    showScreen('player');
    $('osd-title').textContent = opts.title;
    $('osd-sub').textContent = opts.subtitle || '';
    $('osd-progress').classList.add('visible');
    $('osd-bar').style.width = '0';
    $('osd-time').textContent = '';
    $('osd-hint').textContent = '◀▶ 10s · ▲▼ 1 min · OK pause · Back to exit' + (opts.kind === 'episode' ? ' · CH± episode' : '');
    showOsd(5000);
    startSource(opts.url);
  }

  function savePosition() {
    var p = state.player;
    if (!p || !p.resumeKey || !video.duration || !isFinite(video.duration)) return;
    var t = video.currentTime;
    if (t > 30 && t < video.duration - 60) store.set('pos.' + p.resumeKey, Math.floor(t));
    else store.remove('pos.' + p.resumeKey);
  }

  function closePlayer() {
    savePosition();
    clearTimeout(stallTimer);
    clearTimeout(osdTimer);
    state.player = null;
    video.pause();
    video.removeAttribute('src');
    video.load();
    playerMsg('');
    showScreen(state.prevScreen || 'browse');
    if (state.screen === 'series') renderSeries();
  }

  function onVideoError() {
    var p = state.player;
    if (!p) return;
    clearTimeout(stallTimer);
    if (p.kind === 'live' && !p.triedAlt) {
      // Try the other container before giving up (m3u8 <-> ts)
      p.triedAlt = true;
      p.ext = p.ext === 'm3u8' ? 'ts' : 'm3u8';
      startSource(state.api.liveUrl(p.list[p.index], p.ext));
      return;
    }
    var codes = { 1: 'aborted', 2: 'network error', 3: 'decode error (unsupported codec?)', 4: 'format not supported / stream offline' };
    var e = video.error;
    playerMsg('Can’t play this: ' + (e ? codes[e.code] || 'error ' + e.code : 'unknown error') + '. Press Back.');
  }

  function updateProgress() {
    var p = state.player;
    if (!p || p.kind === 'live') return;
    var d = video.duration;
    if (d && isFinite(d)) {
      $('osd-bar').style.width = (100 * video.currentTime / d) + '%';
      $('osd-time').textContent = fmtDuration(video.currentTime) + ' / ' + fmtDuration(d);
    }
  }

  function seek(delta) {
    if (!video.duration || !isFinite(video.duration)) return;
    video.currentTime = Math.max(0, Math.min(video.duration - 1, video.currentTime + delta));
    updateProgress();
    showOsd();
  }

  function togglePause() {
    if (video.paused) { video.play(); showOsd(); } else { video.pause(); $('osd').classList.remove('hidden'); clearTimeout(osdTimer); }
  }

  function nextEpisode(dir) {
    var sr = state.series;
    var season = sr && sr.seasons[sr.seasonIdx];
    if (!season) return false;
    var i = sr.epIdx + dir;
    if (i < 0 || i >= season.eps.length) return false;
    savePosition();
    playEpisode(i);
    return true;
  }

  function playerKey(code) {
    var p = state.player;
    if (!p) return false;
    if (code === KEY.BACK || code === KEY.STOP || code === KEY.ESC) { closePlayer(); return true; }

    if (p.kind === 'live') {
      var n = p.list.length;
      if (code === KEY.UP || code === KEY.CH_UP) playLive(p.list, (p.index + 1) % n);
      else if (code === KEY.DOWN || code === KEY.CH_DOWN) playLive(p.list, (p.index - 1 + n) % n);
      else if (code === KEY.ENTER || code === KEY.LEFT || code === KEY.RIGHT) showOsd();
      else return false;
      return true;
    }

    if (code === KEY.LEFT || code === KEY.RW) seek(-10);
    else if (code === KEY.RIGHT || code === KEY.FF) seek(10);
    else if (code === KEY.UP) seek(60);
    else if (code === KEY.DOWN) seek(-60);
    else if (code === KEY.ENTER || code === KEY.PLAY_PAUSE) togglePause();
    else if (code === KEY.PLAY) { video.play(); showOsd(); }
    else if (code === KEY.PAUSE) togglePause();
    else if (p.kind === 'episode' && (code === KEY.CH_UP || code === KEY.CH_DOWN)) nextEpisode(code === KEY.CH_UP ? 1 : -1);
    else return false;
    return true;
  }

  function initVideo() {
    video = $('video');
    video.addEventListener('error', onVideoError);
    video.addEventListener('waiting', function () { if (state.player) playerMsg('Buffering…'); });
    video.addEventListener('playing', function () { clearTimeout(stallTimer); playerMsg(''); });
    video.addEventListener('timeupdate', updateProgress);
    video.addEventListener('loadedmetadata', function () {
      var p = state.player;
      if (!p || !p.resumeKey || p.resumed) return;
      p.resumed = true;
      var pos = store.get('pos.' + p.resumeKey, null);
      if (pos && isFinite(video.duration) && pos < video.duration - 60) {
        video.currentTime = pos;
        toast('Resumed at ' + fmtDuration(pos) + ' — press ◀ to rewind');
      }
    });
    video.addEventListener('ended', function () {
      var p = state.player;
      if (!p) return;
      if (p.resumeKey) store.remove('pos.' + p.resumeKey);
      if (p.kind === 'episode' && nextEpisode(1)) return;
      if (p.kind !== 'live') closePlayer();
    });
    saveTimer = setInterval(function () { if (state.player && !video.paused) savePosition(); }, 10000);
  }

  // ------------------------------------------------------------------ input wiring

  function onKeyDown(e) {
    var code = e.keyCode;
    var inInput = document.activeElement && document.activeElement.tagName === 'INPUT';
    // Desktop testing: Escape / Backspace act as the remote's Back button.
    if (code === KEY.ESC || (code === KEY.BACKSPACE && !inInput)) code = KEY.BACK;
    if (code === KEY.F && inInput) return;

    if (state.loading) {
      if (code === KEY.BACK) { state.loadToken++; hideLoading(); e.preventDefault(); }
      return;
    }

    var handled = false;
    if (state.screen === 'login') handled = loginKey(code);
    else if (state.screen === 'browse') handled = browseKey(code);
    else if (state.screen === 'series') handled = seriesKey(code);
    else if (state.screen === 'player') handled = playerKey(code);
    if (handled) e.preventDefault();
  }

  function closest(el, attr) {
    while (el && el !== document) {
      if (el.getAttribute && el.getAttribute(attr) != null) return el;
      el = el.parentNode;
    }
    return null;
  }

  // Magic Remote pointer / mouse support
  function onClick(e) {
    if (state.loading) return;
    var t;
    if (state.screen === 'login') {
      if (e.target.id === 'btn-login') submitLogin();
      var i = LOGIN_FIELDS.indexOf(e.target.id);
      if (i >= 0) { state.loginFocus = i; renderLoginFocus(); }
      return;
    }
    if (state.screen === 'browse') {
      if ((t = closest(e.target, 'data-section'))) {
        state.tabFocus = SECTIONS.indexOf(t.getAttribute('data-section'));
        selectSection(t.getAttribute('data-section'), true);
      } else if ((t = closest(e.target, 'data-cat'))) {
        state.catFocus[state.section] = Number(t.getAttribute('data-cat'));
       
        state.zone = currentCat().id === '__search' ? 'search' : 'cats';
        applyCategory();
        setZone(state.zone);
      } else if ((t = closest(e.target, 'data-idx'))) {
        state.gridFocus = Number(t.getAttribute('data-idx'));
        setZone('grid');
        openItem(state.gridFocus);
      } else if ((t = closest(e.target, 'data-action'))) {
        state.infoFocus = Number(t.getAttribute('data-action'));
        state.zone = 'info';
        runInfoAction(state.infoFocus);
      } else if (e.target.id === 'search') {
        setZone('search');
      }
      return;
    }
    if (state.screen === 'series') {
      var sr = state.series;
      if ((t = closest(e.target, 'data-season'))) {
        sr.seasonIdx = Number(t.getAttribute('data-season')); sr.epIdx = 0; sr.epTop = 0; sr.zone = 'seasons';
        renderSeries();
      } else if ((t = closest(e.target, 'data-ep'))) {
        sr.zone = 'episodes';
        playEpisode(Number(t.getAttribute('data-ep')));
      }
      return;
    }
    if (state.screen === 'player') {
      if (state.player && state.player.kind !== 'live') togglePause(); else showOsd();
    }
  }

  function onWheel(e) {
    if (state.screen !== 'browse' || state.loading) return;
    var dir = e.deltaY > 0 ? 1 : -1;
    if ($('grid').contains(e.target)) {
      var geo = gridGeom();
      state.zone = 'grid';
      scrollGridTo(state.gridFocus + dir * geo.cols);
      renderTabs();
      renderCats();
    } else if ($('cats').contains(e.target)) {
      var f = state.catFocus[state.section] + dir;
      if (f >= 0 && f < state.catList.length) {
        state.catFocus[state.section] = f;
       
        state.zone = 'cats';
        applyCategory();
      }
    }
  }

  var searchTimer = null;
  function onSearchInput() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      state.query = $('search').value;
      var zone = state.zone;
      applyCategory();
      state.zone = zone;
    }, 300);
  }

  function onVisibility() {
    var hidden = document.hidden || document.webkitHidden;
    if (hidden && state.player && video && !video.paused) {
      savePosition();
      video.pause();
    }
  }

  function tickClock() {
    $('clock').textContent = fmtClock(Date.now());
  }

  function init() {
    fitStage();
    window.addEventListener('resize', fitStage);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('click', onClick);
    document.addEventListener('wheel', onWheel);
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('webkitvisibilitychange', onVisibility);
    $('search').addEventListener('input', onSearchInput);
    initVideo();
    tickClock();
    setInterval(tickClock, 30000);

    var creds = store.get('creds', null);
    if (creds) doLogin(creds); else openLogin('');
  }

  // Exposed for the dev test harness only.
  window.__iptv = { state: state };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
