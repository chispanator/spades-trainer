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

  var SECTIONS = ['home', 'live', 'vod', 'series', 'search', 'info'];
  var SECTION_LABEL = { live: 'channels', vod: 'movies', series: 'series', search: 'lists' };

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

  // "7:30 PM" today, "Tue 7:30 PM" otherwise (guide times)
  function fmtWhen(ms) {
    var d = new Date(ms);
    var h = d.getHours();
    var t = (h % 12 || 12) + ':' + pad2(d.getMinutes()) + (h < 12 ? ' AM' : ' PM');
    if (d.toDateString() === new Date().toDateString()) return t;
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] + ' ' + t;
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
    searchResults: [],
    guide: { status: 'idle', list: [], channels: {} },
    home: { row: 0, cols: [] },
    langPick: null,
    infoFocus: 0,
    loading: false,
    loadToken: 0,
    loginFocus: 0,
    series: null,
    player: null,
    prevScreen: 'browse',
    favs: store.get('favs', { live: {}, vod: {}, series: {} }),
    prefs: store.get('prefs', { lang: {} }),
    settings: store.get('settings', { liveExt: 'm3u8' })
  };

  // ------------------------------------------------------------------ utils

  function fitStage() {
    // On the TV the parent is <body>; in the browser mockup it's the TV frame.
    var host = $('stage').parentNode;
    var w = host === document.body ? window.innerWidth : host.clientWidth;
    var h = host === document.body ? window.innerHeight : host.clientHeight;
    var s = Math.min(w / 1920, h / 1080);
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
      selectSection('home', true);
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

  var CONTENT_SECTIONS = ['vod', 'series', 'live'];
  var STALE_MS = 6 * 3600 * 1000; // TVs leave apps suspended for days; reload lists after this

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

  // Tag every title with its language(s), quality and a cleaned-up name for search.
  function annotate(catalog) {
    catalog.items.forEach(function (it) {
      it._section = catalog.section;
      it._langs = {};
      it._lang = null;
      it._cats = [];
      it._quality = Lang.quality(it._name);
      it._clean = Lang.cleanTitle(it._name);
    });
    var counts = {};
    catalog.categories.forEach(function (c) {
      if (c.special) return;
      c.lang = Lang.detectCategory(c.name);
      var q = Lang.quality(c.name);
      c.items.forEach(function (it) {
        it._cats.push(c.name);
        if (c.lang) {
          it._langs[c.lang] = true;
          if (it._lang == null) it._lang = c.lang;
        }
        if (!it._quality && q) it._quality = q;
      });
    });
    catalog.items.forEach(function (it) {
      var t = Lang.detectTitle(it._name);
      if (t) {
        it._langs[t] = true;
        if (it._lang == null) it._lang = t;
      }
      if (it._lang == null) it._lang = '';
      var keys = Object.keys(it._langs);
      if (!keys.length) keys = [''];
      keys.forEach(function (k) { counts[k] = (counts[k] || 0) + 1; });
    });
    catalog.langCounts = counts;
  }

  function setCatalog(section, cats, items) {
    var catalog = Xtream.buildCatalog(section, cats, items);
    annotate(catalog);
    catalog.loadedAt = Date.now();
    state.catalogs[section] = catalog;
    return catalog;
  }

  function ensureCatalog(section) {
    var existing = state.catalogs[section];
    if (existing && Date.now() - existing.loadedAt < STALE_MS) return Promise.resolve(existing);
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
      delete state.scans[section];
      setCatalog(section, cats, items);
      hideLoading();
      return state.catalogs[section];
    }, function (err) {
      if (token === state.loadToken) hideLoading();
      throw err;
    });
  }

  // Load movies, series and live one after another; a failure in one doesn't stop the others.
  function ensureAll() {
    var errors = [];
    var chain = Promise.resolve();
    CONTENT_SECTIONS.forEach(function (sec) {
      chain = chain.then(function () {
        return ensureCatalog(sec).catch(function (err) {
          if (err && err.message === 'cancelled') throw err;
          errors.push(SECTION_LABEL[sec] + ': ' + (err && err.message));
        });
      });
    });
    return chain.then(function () {
      if (errors.length) toast('Could not load ' + errors.join('; '), 6000);
    });
  }

  function reloadAll() {
    state.catalogs = {};
    state.raw = {};
    state.scans = {};
    return ensureAll();
  }

  function deepScan(section) {
    return ensureCatalog(section).then(function (catalog) {
      var raw = state.raw[section];
      var before = catalog.stats.unique;
      var token = showLoading('Deep scan: checking every category…');
      return fetchPerCategory(section, raw.cats, function (d, t) {
        if (token === state.loadToken) setLoadingText('Deep scan ' + SECTION_LABEL[section] + ': category ' + d + ' of ' + t + '…');
      }).then(function (res) {
        if (token !== state.loadToken) throw new Error('cancelled');
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
        var extra = setCatalog(section, raw.cats, raw.items).stats.unique - before;
        state.scans[section] = { categories: res.total, failed: res.failed, extra: extra, at: Date.now() };
        return extra;
      });
    });
  }

  function deepScanAll() {
    var found = {};
    return deepScan('vod').then(function (n) {
      found.vod = n;
      return deepScan('series');
    }).then(function (n) {
      found.series = n;
      var total = found.vod + found.series;
      toast(total > 0
        ? 'Deep scan found ' + found.vod + ' hidden movies and ' + found.series + ' hidden series. They’re included now.'
        : 'Deep scan finished: the server isn’t hiding anything.', 6000);
    });
  }

  // ------------------------------------------------------------------ languages

  function prefLang(section) {
    var sel = state.prefs.lang[section];
    var catalog = state.catalogs[section];
    if (sel) return sel;
    // Prefer English (unlabeled content usually is too); fall back to everything
    if (catalog && (catalog.langCounts.en || catalog.langCounts[''])) return 'en';
    return 'all';
  }

  function langMatch(it, sel) {
    if (sel === 'all') return true;
    if (it._langs[sel]) return true;
    return sel === 'en' && !Object.keys(it._langs).length;
  }

  function langLabel(sel) {
    return sel === 'all' ? 'All languages' : sel === 'en' ? 'English' : Lang.name(sel);
  }

  function openLangPicker() {
    var section = state.section;
    var catalog = state.catalogs[section];
    var counts = catalog.langCounts;
    var opts = [
      { code: 'en', name: 'English + unlabeled', count: (counts.en || 0) + (counts[''] || 0) },
      { code: 'all', name: 'All languages', count: catalog.items.length }
    ];
    Object.keys(counts).filter(function (k) { return k && k !== 'en'; })
      .sort(function (a, b) { return counts[b] - counts[a]; })
      .forEach(function (k) { opts.push({ code: k, name: Lang.name(k), count: counts[k] }); });
    var cur = prefLang(section);
    var f = 0;
    opts.forEach(function (o, i) { if (o.code === cur) f = i; });
    state.langPick = { options: opts, focus: f, top: 0 };
    state.zone = 'cats';
    $('content-title').textContent = 'Choose a language';
    renderCats();
  }

  function chooseLang(code) {
    state.prefs.lang[state.section] = code;
    store.set('prefs', state.prefs);
    state.langPick = null;
    buildCatList(true);
    applyCategory();
    toast('Showing ' + langLabel(code));
  }

  // ------------------------------------------------------------------ browse: tabs & categories

  function selectSection(section, focusContent) {
    if (SECTIONS.indexOf(section) < 0) section = 'live';
    state.section = section;
    state.tabFocus = SECTIONS.indexOf(section);
    state.langPick = null;
    store.set('lastSection', section);
    renderTabs();

    var isInfo = section === 'info';
    var isSearch = section === 'search';
    var isHome = section === 'home';
    $('browse-body').classList.toggle('home-mode', isHome);
    if (isHome) {
      state.home.row = 0;
      state.home.cols = [];
      state.zone = focusContent && homeRows().length ? 'home' : 'tabs';
      renderTabs();
      renderHome();
      return;
    }
    $('info').classList.toggle('visible', isInfo);
    $('grid').style.display = isInfo ? 'none' : '';
    $('detail').style.display = isInfo ? 'none' : '';
    $('search').classList.toggle('visible', isSearch);

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
    var load = isSearch ? ensureAll() : ensureCatalog(section);
    load.then(function () {
      if (state.section !== section) return;
      if (isSearch) { runSearch(); loadGuide(); }
      buildCatList();
      applyCategory();
      if (focusContent) setZone(isSearch ? 'search' : 'cats'); else renderTabs();
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

  var LANG_RANK = function (c) { return c.lang === 'en' ? 0 : !c.lang ? 1 : 2; };

  function buildCatList(resetFocus) {
    var section = state.section;
    var prevId = state.catList.length ? (currentCat() || {}).id : null;
    var list;

    if (section === 'search') {
      var res = state.searchResults;
      var count = function (sec) { return res.filter(function (it) { return it._section === sec; }).length; };
      list = [
        { id: '__res_all', name: 'All results', count: res.length, items: res },
        { id: '__res_vod', name: 'Movies', count: count('vod'), sec: 'vod' },
        { id: '__res_series', name: 'Series', count: count('series'), sec: 'series' },
        { id: '__res_live', name: 'Live TV', count: count('live'), sec: 'live' },
        { id: '__res_epg', name: 'On TV now & later', count: res.filter(function (it) { return it._epg; }).length,
          items: res.filter(function (it) { return it._epg; }) },
        { id: '__reload', name: '↻ Reload all lists', count: '', action: true },
        { id: '__deep', name: 'Deep scan for hidden titles', count: '', action: true }
      ];
      list.forEach(function (c) {
        if (c.sec) c.items = res.filter(function (it) { return it._section === c.sec; });
      });
    } else {
      var catalog = state.catalogs[section];
      var sel = prefLang(section);
      var filterItems = function (items) { return items.filter(function (it) { return langMatch(it, sel); }); };
      list = [{ id: '__lang', name: 'Language: ' + langLabel(sel), count: '▸', action: true }];
      var favs = catalog.items.filter(function (it) { return state.favs[section][it._key]; });
      if (favs.length) list.push({ id: '__fav', name: '★ Favorites', count: favs.length, items: favs });
      var cats = [];
      var tail = [];
      catalog.categories.forEach(function (c) {
        var items;
        if (c.special) items = filterItems(c.items);            // All / Uncategorized
        else if (sel === 'all') items = c.items;
        else if (c.lang) items = c.lang === sel ? c.items : [];  // labeled: whole category or nothing
        else items = filterItems(c.items);                        // unlabeled: filter its titles
        if (!items.length) return;
        var entry = { id: c.id, name: c.name, count: items.length, items: items, lang: c.lang };
        if (c.id === '__all') list.push(entry);
        else if (c.id === '__none') tail.push(entry);
        else cats.push(entry);
      });
      if (sel === 'all') {
        // English first, then unlabeled, then other languages grouped together
        cats = cats.map(function (c, i) { return { c: c, i: i }; }).sort(function (a, b) {
          var ra = LANG_RANK(a.c);
          var rb = LANG_RANK(b.c);
          if (ra !== rb) return ra - rb;
          if (ra === 2 && a.c.lang !== b.c.lang) return Lang.name(a.c.lang) < Lang.name(b.c.lang) ? -1 : 1;
          return a.i - b.i;
        }).map(function (x) { return x.c; });
      }
      list = list.concat(cats, tail);
    }

    state.catList = list;
    var f = resetFocus ? -1 : indexOfCat(prevId);
    if (f < 0) f = state.catFocus[section];
    if (resetFocus || f == null || f >= list.length || list[f].action) {
      f = indexOfCat(section === 'search' ? '__res_all' : '__all');
      if (f < 0) f = Math.min(1, list.length - 1);
    }
    state.catFocus[section] = f;
  }

  function indexOfCat(id) {
    for (var i = 0; i < state.catList.length; i++) if (state.catList[i].id === id) return i;
    return -1;
  }

  function currentCat() {
    return state.catList[state.catFocus[state.section]] || state.catList[0];
  }

  function renderCats() {
    var el = $('cats');
    var visible = Math.floor((el.clientHeight - 40) / CAT_ROW_H) || 12;
    var html = '';
    var i;
    if (state.langPick) {
      var lp = state.langPick;
      if (lp.focus < lp.top) lp.top = lp.focus;
      if (lp.focus >= lp.top + visible) lp.top = lp.focus - visible + 1;
      for (i = lp.top; i < Math.min(lp.options.length, lp.top + visible); i++) {
        var o = lp.options[i];
        html += '<div class="cat' + (i === lp.focus ? ' current focused' : '') + '" data-lang="' + i + '"><span class="name">' +
          esc(o.name) + '</span><span class="count">' + o.count + '</span></div>';
      }
      el.innerHTML = html;
      return;
    }
    var list = state.catList;
    var f = state.catFocus[state.section];
    if (f < state.catTop) state.catTop = f;
    if (f >= state.catTop + visible) state.catTop = f - visible + 1;
    if (state.catTop > Math.max(0, list.length - visible)) state.catTop = Math.max(0, list.length - visible);
    for (i = state.catTop; i < Math.min(list.length, state.catTop + visible); i++) {
      var c = list[i];
      var cls = 'cat' + (c.action ? ' action' : '') + (i === f ? ' current' : '') + (i === f && state.zone === 'cats' ? ' focused' : '');
      html += '<div class="' + cls + '" data-cat="' + i + '"><span class="name">' + esc(c.name) +
        '</span><span class="count">' + esc(c.count) + '</span></div>';
    }
    el.innerHTML = html;
  }

  function applyCategory() {
    var cat = currentCat();
    if (!cat) return;
    if (cat.action) {
      // Action rows (language, reload, deep scan) run on OK; keep showing the current grid
      renderCats();
      return;
    }
    state.view = cat.items || [];
    state.gridFocus = 0;
    state.gridTop = 0;
    var title;
    if (state.section === 'search') {
      var q = state.query.trim();
      title = q ? cat.name + ' for “' + q + '” · ' + state.view.length : 'Search movies, series, live TV and the TV guide';
    } else {
      title = cat.name + ' · ' + state.view.length + ' ' + SECTION_LABEL[state.section] +
        (cat.id === '__all' || cat.id === '__none' ? ' · ' + langLabel(prefLang(state.section)) : '');
    }
    $('content-title').textContent = title;
    renderCats();
    renderGrid();
    updateDetail();
  }

  function runCatAction(cat) {
    if (cat.id === '__lang') openLangPicker();
    else if (cat.id === '__reload') {
      reloadAll().then(afterSearchDataChange, ignoreCancel);
    } else if (cat.id === '__deep') {
      deepScanAll().then(afterSearchDataChange, function (err) {
        if (err && err.message === 'cancelled') return;
        toast('Deep scan failed: ' + (err && err.message), 5000);
      });
    }
  }

  function ignoreCancel(err) {
    if (!err || err.message !== 'cancelled') toast('Failed: ' + (err && err.message), 5000);
  }

  function afterSearchDataChange() {
    if (state.section !== 'search') return;
    runSearch();
    buildCatList();
    state.catFocus.search = indexOfCat('__res_all');
    applyCategory();
    setZone(state.view.length ? 'grid' : 'cats');
  }

  // ------------------------------------------------------------------ search (all sections)

  var STOPWORDS = { the: 1, a: 1, an: 1, of: 1, and: 1, la: 1, le: 1, el: 1 };
  // Words that describe *how* something airs rather than *what* it is; nice to match, not required
  var SOFT_WORDS = { game: 1, games: 1, match: 1, live: 1, vs: 1, v: 1, versus: 1, at: 1, tonight: 1, today: 1,
    stream: 1, channel: 1, tv: 1, watch: 1, event: 1, events: 1, sports: 1, sport: 1 };
  // Sport words and the shorthand providers put in channel names and guide titles
  var SPORT_SYNONYMS = {
    football: ['football', 'ncaaf', 'cfb', 'nfl', 'gridiron'],
    college: ['college', 'ncaa', 'ncaaf', 'ncaab', 'cfb', 'cbb'],
    basketball: ['basketball', 'ncaab', 'cbb', 'nba', 'wnba'],
    baseball: ['baseball', 'mlb'],
    hockey: ['hockey', 'nhl'],
    soccer: ['soccer', 'football', 'mls', 'epl', 'premier', 'laliga', 'uefa', 'fifa'],
    fight: ['fight', 'ufc', 'boxing', 'ppv', 'mma'],
    boxing: ['boxing', 'ppv', 'fight'],
    racing: ['racing', 'nascar', 'f1', 'formula', 'indycar', 'motogp'],
    golf: ['golf', 'pga', 'lpga'],
    tennis: ['tennis', 'atp', 'wta', 'open'],
    wrestling: ['wrestling', 'wwe', 'aew']
  };
  var QUALITY_RANK = { '4K': 0, FHD: 1, HD: 2, '': 3, SD: 4, CAM: 5 };

  function searchWords(text) {
    var words = Xtream.foldText(text).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
    var strong = words.filter(function (w) { return !STOPWORDS[w]; });
    return strong.length ? strong : words;
  }

  // Build a matcher: every "hard" word must start a word in the text; sport / soft
  // words only raise the rank, unless they're all the query has.
  function makeMatcher(query) {
    var words = searchWords(query);
    var hard = [];
    var soft = [];
    words.forEach(function (w) {
      if (SPORT_SYNONYMS[w]) soft.push(SPORT_SYNONYMS[w]);
      else if (SOFT_WORDS[w]) soft.push([w]);
      else hard.push(w);
    });
    if (!hard.length) { hard = soft; soft = []; } else hard = hard.map(function (w) { return [w]; });
    var has = function (text, alts) {
      for (var i = 0; i < alts.length; i++) if (text.indexOf(' ' + alts[i]) >= 0) return true;
      return false;
    };
    return {
      sporty: words.some(function (w) { return SPORT_SYNONYMS[w]; }),
      // -1 = no match, otherwise how many optional words were missed (0 = perfect)
      test: function (text) {
        for (var i = 0; i < hard.length; i++) if (!has(text, hard[i])) return -1;
        var missed = 0;
        for (var j = 0; j < soft.length; j++) if (!has(text, soft[j])) missed++;
        return missed;
      }
    };
  }

  function runSearch() {
    var q = state.query.trim();
    if (!q) { state.searchResults = []; return; }
    var matcher = makeMatcher(q);
    var qClean = Lang.cleanTitle(q).replace(/^(the|a|an) /, '');
    var results = [];
    var now = Date.now();

    CONTENT_SECTIONS.forEach(function (sec) {
      var catalog = state.catalogs[sec];
      if (!catalog) return;
      catalog.items.forEach(function (it) {
        var missed = matcher.test(it._search);
        if (missed < 0) return;
        var clean = it._clean.replace(/^(the|a|an) /, '');
        it._missed = missed;
        it._score = clean === qClean ? 0 : clean.indexOf(qClean) === 0 ? 1 : 2;
        // For a game search, a channel named after the game beats a show that airs later
        if (matcher.sporty && sec === 'live') it._score = 0.25;
        results.push(it);
      });
    });

    // Programme guide: find channels airing a matching show now or in the next 24 hours
    var g = state.guide;
    if (g.status === 'ready') {
      var seen = {};
      g.list.forEach(function (prog) {
        var missed = matcher.test(prog._search);
        if (missed < 0) return;
        (g.channels[prog.channel] || []).forEach(function (ch) {
          var k = ch._key + '@' + prog.start;
          if (seen[k]) return;
          seen[k] = true;
          var hit = Object.create(ch); // same channel, plus what's on
          hit._epg = prog;
          hit._missed = missed;
          hit._score = prog.start <= now ? -1 : 0.5;
          results.push(hit);
        });
      });
    }

    var sel = prefLang('vod');
    var sectionRank = matcher.sporty ? { live: 0, vod: 1, series: 2 } : { vod: 0, series: 1, live: 2 };
    results.sort(function (a, b) {
      if (a._missed !== b._missed) return a._missed - b._missed;
      if (a._score !== b._score) return a._score - b._score;
      if (a._epg && b._epg && a._epg.start !== b._epg.start) return a._epg.start - b._epg.start;
      var la = langMatch(a, sel) ? 0 : 1;
      var lb = langMatch(b, sel) ? 0 : 1;
      if (la !== lb) return la - lb;
      if (a._section !== b._section) return sectionRank[a._section] - sectionRank[b._section];
      var qa = QUALITY_RANK[a._quality] || 0;
      var qb = QUALITY_RANK[b._quality] || 0;
      if (qa !== qb) return qa - qb;
      return Number(b.added || 0) - Number(a.added || 0);
    });
    state.searchResults = results.slice(0, 600);
  }

  // ------------------------------------------------------------------ programme guide (for live-event search)

  var GUIDE_TTL = 3 * 3600 * 1000;

  function loadGuide() {
    var g = state.guide;
    if (g.status === 'loading' || (g.status === 'ready' && Date.now() - g.at < GUIDE_TTL)) return;
    var live = state.catalogs.live;
    if (!live || !state.api) return;
    var channels = {};
    live.items.forEach(function (it) {
      var id = String(it.epg_channel_id || '').toLowerCase();
      if (!id) return;
      (channels[id] = channels[id] || []).push(it);
    });
    if (!Object.keys(channels).length) { g.status = 'none'; return; }
    g.status = 'loading';
    g.bytes = 0;
    var now = Date.now();
    var api = state.api;
    api.guide(channels, now, now + 24 * 3600 * 1000, function (bytes) { g.bytes = bytes; }).then(function (list) {
      if (api !== state.api) return;
      list.forEach(function (p) {
        p._search = ' ' + Xtream.foldText(p.title + ' ' + p.sub).replace(/[^a-z0-9]+/g, ' ') + ' ';
      });
      g.list = list;
      g.channels = channels;
      g.status = 'ready';
      g.at = Date.now();
      if (state.section === 'search' && state.screen === 'browse') refreshSearchView();
    }, function (err) {
      g.status = 'error';
      g.error = err && err.message;
      if (state.section === 'search') refreshSearchView();
    });
  }

  function guideStatusText() {
    var g = state.guide;
    if (g.status === 'ready') return 'TV guide: ' + g.list.length + ' upcoming programs';
    if (g.status === 'loading') return 'TV guide loading' + (g.bytes ? ' (' + Math.round(g.bytes / 1048576) + ' MB)' : '') + '…';
    if (g.status === 'error') return 'TV guide unavailable (' + g.error + ')';
    if (g.status === 'none') return 'This provider has no TV guide';
    return '';
  }

  function refreshSearchView() {
    var zone = state.zone;
    runSearch();
    buildCatList();
    applyCategory();
    if (zone !== state.zone) setZone(zone);
  }

  function searchedCounts() {
    return CONTENT_SECTIONS.map(function (sec) {
      var c = state.catalogs[sec];
      return (c ? c.items.length : 0) + ' ' + SECTION_LABEL[sec];
    }).join(', ');
  }

  // ------------------------------------------------------------------ browse: grid

  function allLive() {
    for (var i = 0; i < state.view.length; i++) if (state.view[i]._section !== 'live') return false;
    return state.view.length > 0;
  }

  function gridGeom() {
    // Search results that are all channels (e.g. a game search) get wide channel tiles
    var g = CARD[state.section === 'search' && allLive() ? 'live' : state.section] || CARD.vod;
    var el = $('grid');
    var cols = Math.max(1, Math.floor((el.clientWidth + g.gap) / (g.w + g.gap)));
    var rows = Math.max(1, Math.floor((el.clientHeight + g.gap) / (g.h + g.gap)));
    return { w: g.w, h: g.h, gap: g.gap, cols: cols, rows: rows };
  }

  function badges(it) {
    var b = '';
    if (it._epg) {
      b += it._epg.start <= Date.now() ? '<span class="badge onnow">ON NOW</span>' : '<span class="badge kind">' + fmtWhen(it._epg.start) + '</span>';
    } else if (state.section === 'search' && it._section !== 'vod') {
      b += '<span class="badge kind">' + (it._section === 'live' ? 'LIVE' : 'SERIES') + '</span>';
    }
    // In a section the English view is the norm, so only flag other languages there
    if (it._lang && (state.section === 'search' || it._lang !== 'en')) b += '<span class="badge">' + esc(it._lang.toUpperCase()) + '</span>';
    if (it._quality) b += '<span class="badge' + (it._quality === 'CAM' ? ' cam' : '') + '">' + esc(it._quality) + '</span>';
    return b ? '<div class="badges">' + b + '</div>' : '';
  }

  function renderGrid() {
    var el = $('grid');
    var view = state.view;
    if (!view.length) {
      var msg = 'Nothing here.';
      if (state.section === 'search') {
        var q = state.query.trim();
        msg = q
          ? 'No matches for “' + esc(q) + '” in ' + searchedCounts() + '.<br><br>' +
            'Try one distinctive word (e.g. “odyssey”), or pick <b>Reload all lists</b> or <b>Deep scan for hidden titles</b> on the left.'
          : 'Type a title, show or game in the box above, like “the odyssey” or “notre dame football”. Searches ' +
            searchedCounts() + ' in every language.';
        msg += '<br><br><span class="muted">' + esc(guideStatusText()) + '</span>';
      }
      el.innerHTML = '<div class="empty">' + msg + '</div>';
      return;
    }
    var geo = gridGeom();
    var imgH = geo.h === CARD.live.h ? geo.h - 44 : geo.h;
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
      html += '<div class="card ' + it._section + (focused ? ' focused' : '') + '" data-idx="' + i + '" style="left:' +
        (c * (geo.w + geo.gap)) + 'px;top:' + (r * (geo.h + geo.gap)) + 'px;width:' + geo.w + 'px;height:' + geo.h + 'px">' +
        '<div class="ph" style="height:' + imgH + 'px">' + initial + '</div>' +
        (img ? '<img src="' + esc(img) + '" style="height:' + imgH + 'px" onerror="this.parentNode.removeChild(this)">' : '') +
        badges(it) +
        '<div class="label">' + (it._epg ? esc(it._epg.title) : (it._section === 'live' && it.num ? esc(it.num) + ' · ' : '') + esc(it._name)) + '</div>' +
        (state.favs[it._section][it._key] ? '<div class="fav">★</div>' : '') +
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
    if (it._epg) {
      var on = it._epg.start <= Date.now();
      el.innerHTML = '<b>' + esc(it._epg.title) + (it._epg.sub ? ' · ' + esc(it._epg.sub) : '') + '</b><br>' +
        (on ? 'On now' : fmtWhen(it._epg.start)) + ' (' + fmtClock(it._epg.start) + '–' + fmtClock(it._epg.stop) + ') on ' +
        esc(it._name) + ' · ' + (state.gridFocus + 1) + ' of ' + state.view.length + ' · <span class="muted">OK to tune in</span>';
      return;
    }
    if (state.section === 'search') parts.push({ vod: 'Movie', series: 'Series', live: 'Live channel' }[it._section]);
    if (it._lang) parts.push(esc(Lang.name(it._lang)));
    if (it._quality) parts.push(esc(it._quality));
    if (it.rating && it.rating !== '0') parts.push('★ ' + esc(it.rating));
    if (it.added) parts.push('Added ' + new Date(Number(it.added) * 1000).toLocaleDateString());
    if (it._cats.length) parts.push('In ' + esc(it._cats.slice(0, 2).join(', ')) + (it._cats.length > 2 ? ' +' + (it._cats.length - 2) : ''));
    parts.push((state.gridFocus + 1) + ' of ' + state.view.length);
    el.innerHTML = '<b>' + esc(it._name) + '</b><br>' + parts.join(' · ') + ' · <span class="muted">Red / F: favorite</span>';

    if (it._section === 'live') {
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
    var favs = state.favs[it._section];
    if (favs[it._key]) delete favs[it._key]; else favs[it._key] = true;
    store.set('favs', state.favs);
    toast(favs[it._key] ? 'Added to favorites' : 'Removed from favorites');
    if (state.section === 'search') { renderGrid(); return; }
    var wasFav = currentCat().id === '__fav';
    var f = state.gridFocus;
    buildCatList();
    if (wasFav) {
      applyCategory();
      if (state.view.length) scrollGridTo(Math.min(f, state.view.length - 1)); else setZone('cats');
    } else {
      renderCats();
      renderGrid();
    }
  }

  function openItem(idx) {
    var it = state.view[idx];
    if (!it) return;
    if (it._section === 'live') {
      var lives = state.view.filter(function (x) { return x._section === 'live'; });
      playLive(lives, lives.indexOf(it));
    } else if (it._section === 'vod') {
      playVod({ kind: 'vod', title: it._name, url: state.api.movieUrl(it), resumeKey: 'm' + it._key,
        history: { key: 'm' + it._key, kind: 'vod', name: it._name, stream_id: it.stream_id, ext: it.container_extension, image: itemImage(it) } });
    } else if (it._section === 'series') {
      openSeries(it);
    }
  }

  // ------------------------------------------------------------------ browse: info / diagnostics

  var INFO_ACTIONS = [
    { id: 'reload', label: 'Reload all lists' },
    { id: 'scan', label: 'Deep scan Movies + Series' },
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
      ['categories', 'Categories'],
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
    html += '<tr><td>English + unlabeled</td>';
    ['live', 'vod', 'series'].forEach(function (sec) {
      var c = state.catalogs[sec];
      html += '<td>' + (c ? (c.langCounts.en || 0) + (c.langCounts[''] || 0) : '—') + '</td>';
    });
    html += '</tr><tr><td>Languages found</td>';
    ['live', 'vod', 'series'].forEach(function (sec) {
      var c = state.catalogs[sec];
      html += '<td>' + (c ? Object.keys(c.langCounts).filter(Boolean).length : '—') + '</td>';
    });
    html += '</tr><tr><td>Deep scan</td>';
    ['live', 'vod', 'series'].forEach(function (sec) {
      var sc = state.scans[sec];
      html += '<td>' + (sc ? (sc.extra > 0 ? '+' + sc.extra + ' found' : 'complete') + (sc.failed ? ', ' + sc.failed + ' failed' : '') : '—') + '</td>';
    });
    html += '</tr><tr><td>Lists loaded</td>';
    ['live', 'vod', 'series'].forEach(function (sec) {
      var c = state.catalogs[sec];
      html += '<td>' + (c ? fmtClock(c.loadedAt) : '—') + '</td>';
    });
    html += '</tr></table></div></div>';

    html += '<div class="actions">';
    INFO_ACTIONS.forEach(function (a, i) {
      var label = a.id === 'format' ? 'Live format: ' + state.settings.liveExt.toUpperCase() : a.label;
      html += '<div class="action' + (state.zone === 'info' && i === state.infoFocus ? ' focused' : '') + '" data-action="' + i + '">' + label + '</div>';
    });
    html += '</div>';
    html += '<p class="note">“—” means that list hasn’t been loaded yet. Uncategorized titles are ones whose category the server ' +
      'doesn’t list; many players hide them. Deep scan asks for every category one by one and adds anything missing from the ' +
      'full list. Lists reload automatically when they’re more than 6 hours old.</p>';
    $('info').innerHTML = html;
  }

  function runInfoAction(i) {
    var a = INFO_ACTIONS[i];
    if (!a) return;
    var done = function () { renderInfo(); };
    if (a.id === 'reload') {
      reloadAll().then(function () { toast('All lists reloaded'); done(); }, function (err) { ignoreCancel(err); done(); });
    } else if (a.id === 'scan') {
      deepScanAll().then(done, function (err) { ignoreCancel(err); done(); });
    } else if (a.id === 'scan-live') {
      deepScan('live').then(function (n) {
        toast(n > 0 ? 'Deep scan found ' + n + ' hidden channels.' : 'Deep scan finished: no hidden channels.', 5000);
        done();
      }, function (err) { ignoreCancel(err); done(); });
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
    if (state.section === 'home') { renderHome(); return; }
    if (state.catList.length) {
      renderCats();
      renderGrid();
    }
  }

  function moveCat(f) {
    state.catFocus[state.section] = Math.max(0, Math.min(state.catList.length - 1, f));
    applyCategory();
  }

  function browseKey(code) {
    var z = state.zone;
    var isSearch = state.section === 'search';
    var geo;

    if (z === 'tabs') {
      if (code === KEY.LEFT && state.tabFocus > 0) { state.tabFocus--; renderTabs(); }
      else if (code === KEY.RIGHT && state.tabFocus < SECTIONS.length - 1) { state.tabFocus++; renderTabs(); }
      else if (code === KEY.ENTER || code === KEY.DOWN) {
        var sec = SECTIONS[state.tabFocus];
        var stale = state.catalogs[sec] && Date.now() - state.catalogs[sec].loadedAt > STALE_MS;
        if (sec === 'home') selectSection('home', true);
        else if (sec !== state.section || (sec !== 'info' && !state.catList.length) || stale) selectSection(sec, true);
        else setZone(sec === 'info' ? 'info' : sec === 'search' ? 'search' : 'cats');
      } else if (code === KEY.BACK) { exitApp(); }
      else return false;
      return true;
    }

    if (z === 'cats' && state.langPick) {
      var lp = state.langPick;
      if (code === KEY.UP && lp.focus > 0) lp.focus--;
      else if (code === KEY.DOWN && lp.focus < lp.options.length - 1) lp.focus++;
      else if (code === KEY.ENTER || code === KEY.RIGHT) { chooseLang(lp.options[lp.focus].code); return true; }
      else if (code === KEY.BACK || code === KEY.LEFT) { state.langPick = null; applyCategory(); return true; }
      else if (code !== KEY.UP && code !== KEY.DOWN) return false;
      renderCats();
      return true;
    }

    if (z === 'cats') {
      var f = state.catFocus[state.section];
      if (code === KEY.UP) {
        if (f > 0) moveCat(f - 1);
        else setZone(isSearch ? 'search' : 'tabs');
      } else if (code === KEY.DOWN) {
        if (f < state.catList.length - 1) moveCat(f + 1);
      } else if (code === KEY.CH_UP || code === KEY.CH_DOWN) {
        moveCat(f + (code === KEY.CH_DOWN ? 10 : -10));
      } else if (code === KEY.RIGHT || code === KEY.ENTER) {
        var cat = currentCat();
        if (cat.action) runCatAction(cat);
        else if (state.view.length) setZone('grid');
        else if (isSearch) setZone('search');
      } else if (code === KEY.BACK) { setZone(isSearch ? 'search' : 'tabs'); }
      else return false;
      return true;
    }

    if (z === 'search') {
      if (code === KEY.UP) setZone('tabs');
      else if (code === KEY.DOWN || code === KEY.ENTER) setZone(state.view.length ? 'grid' : 'cats');
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
        else setZone(isSearch ? 'search' : 'tabs');
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

    if (z === 'home') return homeKey(code);

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

  // ------------------------------------------------------------------ watch history

  var HISTORY_MAX = 60;

  function historyList() { return store.get('history', []); }

  function historySave(list) { store.set('history', list.slice(0, HISTORY_MAX)); }

  function historyPut(entry) {
    var list = historyList().filter(function (e) {
      if (e.key === entry.key) return false;
      // One Continue Watching card per show
      return !(entry.kind === 'episode' && e.kind === 'episode' && String(e.series_id) === String(entry.series_id));
    });
    entry.at = Date.now();
    list.unshift(entry);
    historySave(list);
  }

  function historyUpdate(key, fields) {
    var list = historyList();
    for (var i = 0; i < list.length; i++) {
      if (list[i].key !== key) continue;
      Object.keys(fields).forEach(function (k) { list[i][k] = fields[k]; });
      list[i].at = Date.now();
      historySave(list);
      return;
    }
  }

  function historyRemove(key) {
    historySave(historyList().filter(function (e) { return e.key !== key; }));
  }

  // Started (30 s+) but not finished, or the next episode of a show you're watching
  function continueWatching() {
    return historyList().filter(function (e) { return e.kind !== 'live' && !e.done && (e.next || e.pos >= 30); });
  }

  function recentChannels() {
    return historyList().filter(function (e) { return e.kind === 'live'; }).slice(0, 20);
  }

  function channelFromHistory(e) {
    return { stream_id: e.stream_id, num: e.num, _name: e.name, _key: String(e.stream_id), stream_icon: e.image,
      epg_channel_id: e.epg, _section: 'live', _langs: {}, _cats: [] };
  }

  // After an episode ends (or reaches the credits), queue the next one as "Up next"
  function queueNextEpisode() {
    var sr = state.series;
    var season = sr && sr.seasons[sr.seasonIdx];
    if (!season) return;
    var nextIdx = sr.epIdx + 1;
    var seasonIdx = sr.seasonIdx;
    if (nextIdx >= season.eps.length) {
      if (seasonIdx + 1 >= sr.seasons.length) return;
      seasonIdx++;
      nextIdx = 0;
    }
    var s = sr.seasons[seasonIdx];
    historyPut(episodeHistory(sr, s, s.eps[nextIdx], nextIdx, { next: true, pos: 0 }));
  }

  function episodeHistory(sr, season, ep, idx, extra) {
    var e = {
      key: 'e' + ep.id, kind: 'episode', name: sr.item._name, series_id: sr.item.series_id, episode_id: ep.id,
      season: season.num, ep: ep.episode_num || idx + 1, title: ep.title || '', ext: ep.container_extension,
      image: sr.cover || (ep.info && ep.info.movie_image) || '', pos: 0, dur: 0
    };
    if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
    return e;
  }

  function playHistory(e) {
    if (e.kind === 'live') {
      var list = recentChannels().map(channelFromHistory);
      var idx = 0;
      list.forEach(function (c, i) { if (c._key === String(e.stream_id)) idx = i; });
      playLive(list, idx);
    } else if (e.kind === 'vod') {
      playVod({
        kind: 'vod', title: e.name, url: state.api.movieUrl({ stream_id: e.stream_id, container_extension: e.ext }),
        resumeKey: 'm' + e.stream_id, history: e, prevScreen: 'browse'
      });
    } else if (e.kind === 'episode') {
      // Load the show so the next episode can follow automatically
      var token = showLoading('Loading ' + e.name + '…');
      state.api.seriesInfo(e.series_id).then(function (data) {
        if (token !== state.loadToken) return;
        hideLoading();
        var seasons = groupSeasons(data || {});
        var info = (data && data.info) || {};
        for (var si = 0; si < seasons.length; si++) {
          for (var ei = 0; ei < seasons[si].eps.length; ei++) {
            if (String(seasons[si].eps[ei].id) === String(e.episode_id)) {
              state.series = { item: { _name: e.name, series_id: e.series_id }, cover: info.cover || e.image, seasons: seasons,
                seasonIdx: si, epIdx: ei, epTop: 0, zone: 'episodes' };
              playEpisode(ei, 'browse');
              return;
            }
          }
        }
        toast('That episode is no longer on the server.', 5000);
      }, function (err) {
        if (token !== state.loadToken) return;
        hideLoading();
        toast('Could not load ' + e.name + ': ' + (err && err.message), 5000);
      });
    }
  }

  // ------------------------------------------------------------------ home

  var HOME_CARD = { poster: { w: 200, h: 300, gap: 24 }, live: { w: 260, h: 170, gap: 24 } };

  function homeRows() {
    var rows = [];
    var cw = continueWatching();
    if (cw.length) rows.push({ id: 'cw', title: 'Continue watching', items: cw, card: 'poster' });
    var ch = recentChannels();
    if (ch.length) rows.push({ id: 'recent', title: 'Recent channels', items: ch, card: 'live' });
    return rows;
  }

  function homeCardHtml(e, r, c, focused, g) {
    var sub = '';
    var pct = 0;
    if (e.kind === 'episode') {
      sub = (e.next ? 'Up next · ' : '') + 'S' + e.season + ' E' + e.ep + (e.title ? ' · ' + e.title : '');
    } else if (e.kind === 'vod' && e.dur) {
      sub = Math.max(1, Math.round((e.dur - e.pos) / 60)) + ' min left';
    }
    if (e.dur && e.pos) pct = Math.min(100, 100 * e.pos / e.dur);
    var imgH = e.kind === 'live' ? g.h - 44 : g.h;
    var initial = esc(String(e.name).replace(/^[^A-Za-z0-9]+/, '').charAt(0).toUpperCase() || '?');
    return '<div class="card ' + (e.kind === 'live' ? 'live' : 'vod') + (focused ? ' focused' : '') + '" data-home="' + r + ':' + c + '" style="left:' +
      (c * (g.w + g.gap)) + 'px;top:0;width:' + g.w + 'px;height:' + g.h + 'px">' +
      '<div class="ph" style="height:' + imgH + 'px">' + initial + '</div>' +
      (e.image ? '<img src="' + esc(e.image) + '" style="height:' + imgH + 'px" onerror="this.parentNode.removeChild(this)">' : '') +
      '<div class="label">' + (e.kind === 'live' && e.num ? esc(e.num) + ' · ' : '') + esc(e.name) +
      (sub ? '<div class="sub">' + esc(sub) + '</div>' : '') + '</div>' +
      (pct ? '<div class="progress"><div style="width:' + pct.toFixed(1) + '%"></div></div>' : '') +
      '</div>';
  }

  function renderHome() {
    var el = $('home');
    var rows = homeRows();
    var h = state.home;
    if (!rows.length) {
      el.innerHTML = '<div class="home-empty"><h2>Welcome back</h2><p>Movies and episodes you start will appear here under ' +
        '<b>Continue watching</b>, so you can pick up where you left off. Channels you watch show up under <b>Recent channels</b>.</p>' +
        '<p class="muted">Use ◀ ▶ on the tabs above to browse Live TV, Movies, Series or Search.</p></div>';
      return;
    }
    if (h.row >= rows.length) h.row = rows.length - 1;
    var width = el.clientWidth - 100;
    var html = '';
    rows.forEach(function (row, r) {
      var g = HOME_CARD[row.card];
      var col = Math.min(h.cols[r] || 0, row.items.length - 1);
      h.cols[r] = col;
      var visible = Math.max(1, Math.floor((width + g.gap) / (g.w + g.gap)));
      var offset = Math.max(0, col - visible + 1) * (g.w + g.gap);
      html += '<section class="hrow"><h2>' + esc(row.title) + ' <span class="muted">' + row.items.length + '</span></h2>' +
        '<div class="strip" style="height:' + g.h + 'px"><div class="strip-inner" style="transform:translateX(' + (-offset) + 'px)">';
      row.items.forEach(function (e, c) {
        html += homeCardHtml(e, r, c, state.zone === 'home' && r === h.row && c === col, g);
      });
      html += '</div></div></section>';
    });
    var focus = rows[h.row] && rows[h.row].items[h.cols[h.row]];
    if (focus && state.zone === 'home') {
      html += '<div class="home-hint muted">OK to ' + (focus.kind === 'live' ? 'watch' : focus.next ? 'play the next episode' : 'resume') +
        ' · Red / F: remove from this row</div>';
    }
    el.innerHTML = html;
  }

  function homeKey(code) {
    var rows = homeRows();
    var h = state.home;
    if (!rows.length) {
      if (code === KEY.UP || code === KEY.BACK) { setZone('tabs'); return true; }
      return false;
    }
    var row = rows[h.row];
    var col = h.cols[h.row] || 0;
    if (code === KEY.LEFT && col > 0) h.cols[h.row] = col - 1;
    else if (code === KEY.RIGHT && col < row.items.length - 1) h.cols[h.row] = col + 1;
    else if (code === KEY.UP) { if (h.row > 0) h.row--; else { setZone('tabs'); return true; } }
    else if (code === KEY.DOWN && h.row < rows.length - 1) h.row++;
    else if (code === KEY.ENTER) { playHistory(row.items[col]); return true; }
    else if (code === KEY.RED || code === KEY.F) {
      historyRemove(row.items[col].key);
      toast('Removed from ' + row.title);
      if (!homeRows().length) { renderHome(); setZone('tabs'); return true; }
    } else if (code === KEY.BACK) { setZone('tabs'); return true; }
    else if (code !== KEY.LEFT && code !== KEY.RIGHT && code !== KEY.DOWN) return false;
    renderHome();
    return true;
  }

  // ------------------------------------------------------------------ series

  function openSeries(item) {
    var token = showLoading('Loading episodes…');
    state.api.seriesInfo(item.series_id).then(function (data) {
      if (token !== state.loadToken) return;
      hideLoading();
      var seasons = groupSeasons(data || {});
      var info = (data && data.info) || {};
      var cover = info.cover || item.cover || '';
      state.series = { item: item, cover: cover, seasons: seasons, seasonIdx: 0, epIdx: 0, epTop: 0, zone: seasons.length ? 'episodes' : 'seasons' };
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

  function playEpisode(idx, prevScreen) {
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
      prevScreen: prevScreen || 'series',
      history: episodeHistory(sr, season, ep, idx)
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
    historyPut({ key: 'l' + it.stream_id, kind: 'live', name: it._name, num: it.num, stream_id: it.stream_id,
      image: it.stream_icon || '', epg: it.epg_channel_id || '' });
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
    state.player = { kind: opts.kind, resumeKey: opts.resumeKey, resumed: false, historyKey: opts.history ? opts.history.key : null };
    if (opts.history) {
      var prev = historyList().filter(function (e) { return e.key === opts.history.key; })[0];
      var entry = {};
      Object.keys(opts.history).forEach(function (k) { entry[k] = opts.history[k]; });
      entry.next = false;
      entry.done = false;
      entry.pos = prev ? prev.pos : 0;
      entry.dur = prev ? prev.dur : 0;
      historyPut(entry);
    }
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
    var d = video.duration;
    var finished = t >= d - 60 || t / d > 0.95;
    if (t > 30 && !finished) store.set('pos.' + p.resumeKey, Math.floor(t));
    else store.remove('pos.' + p.resumeKey);
    if (p.historyKey) {
      historyUpdate(p.historyKey, { pos: Math.floor(t), dur: Math.floor(d), done: finished });
      if (finished && p.kind === 'episode' && !p.queuedNext) { p.queuedNext = true; queueNextEpisode(); }
    }
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
    if (state.screen === 'browse' && state.section === 'home') renderHome();
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
    playEpisode(i, state.prevScreen);
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
      if (p.historyKey) historyUpdate(p.historyKey, { done: true });
      if (p.kind === 'episode' && !p.queuedNext) { p.queuedNext = true; queueNextEpisode(); }
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
      } else if ((t = closest(e.target, 'data-home'))) {
        var rc = t.getAttribute('data-home').split(':');
        state.home.row = Number(rc[0]);
        state.home.cols[state.home.row] = Number(rc[1]);
        setZone('home');
        var hr = homeRows()[state.home.row];
        if (hr) playHistory(hr.items[Number(rc[1])]);
      } else if ((t = closest(e.target, 'data-lang'))) {
        if (state.langPick) chooseLang(state.langPick.options[Number(t.getAttribute('data-lang'))].code);
      } else if ((t = closest(e.target, 'data-cat'))) {
        state.catFocus[state.section] = Number(t.getAttribute('data-cat'));
        state.zone = 'cats';
        applyCategory();
        setZone('cats');
        if (currentCat().action) runCatAction(currentCat());
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
    } else if ($('cats').contains(e.target) && !state.langPick) {
      var f = state.catFocus[state.section] + dir;
      if (f >= 0 && f < state.catList.length) {
        state.zone = 'cats';
        moveCat(f);
      }
    }
  }

  var searchTimer = null;
  function onSearchInput() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      state.query = $('search').value;
      if (state.section !== 'search') return;
      runSearch();
      buildCatList();
      state.catFocus.search = indexOfCat('__res_all');
      applyCategory();
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
