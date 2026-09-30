/*
 * Xtream Codes API client + catalog builder.
 *
 * Written for old webOS Chromium (webOS 4 = Chrome 53): no async/await,
 * no optional chaining, no object spread, no Object.values/entries.
 */
(function (global) {
  'use strict';

  var REQUEST_TIMEOUT_MS = 90000; // big VOD lists can take a while

  function normalizeServer(input) {
    var s = String(input || '').trim();
    if (!s) return '';
    if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
    // People often paste a full playlist/API URL; keep just scheme://host[:port][/prefix]
    s = s.replace(/\/(player_api\.php|get\.php|xmltv\.php|panel_api\.php)(\?.*)?$/i, '');
    s = s.replace(/\/+$/, '');
    return s;
  }

  // Some panels return {} or an object keyed by id instead of an array.
  function toArray(x) {
    if (Array.isArray(x)) return x;
    if (x && typeof x === 'object') {
      return Object.keys(x).map(function (k) { return x[k]; });
    }
    return [];
  }

  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error('Request timed out')); }, ms);
      promise.then(
        function (v) { clearTimeout(t); resolve(v); },
        function (e) { clearTimeout(t); reject(e); }
      );
    });
  }

  function decodeBase64Utf8(s) {
    if (!s) return '';
    try {
      return decodeURIComponent(escape(atob(s)));
    } catch (e) {
      return s; // not base64 on this panel
    }
  }

  function Xtream(creds) {
    this.server = normalizeServer(creds.server);
    this.username = creds.username;
    this.password = creds.password;
  }

  Xtream.normalizeServer = normalizeServer;
  Xtream.toArray = toArray;

  Xtream.prototype.apiUrl = function (action, params) {
    var q = 'username=' + encodeURIComponent(this.username) +
      '&password=' + encodeURIComponent(this.password);
    if (action) q += '&action=' + encodeURIComponent(action);
    if (params) {
      Object.keys(params).forEach(function (k) {
        q += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
      });
    }
    return this.server + '/player_api.php?' + q;
  };

  Xtream.prototype.call = function (action, params) {
    return withTimeout(fetch(this.apiUrl(action, params)), REQUEST_TIMEOUT_MS)
      .then(function (res) {
        if (!res.ok) throw new Error('Server returned HTTP ' + res.status);
        return res.text();
      })
      .then(function (text) {
        if (!text) return [];
        try {
          return JSON.parse(text);
        } catch (e) {
          throw new Error('Server sent invalid JSON (' + text.length + ' bytes)');
        }
      });
  };

  Xtream.prototype.login = function () {
    return this.call(null).then(function (data) {
      if (!data || !data.user_info) throw new Error('Unexpected login response');
      if (String(data.user_info.auth) !== '1') throw new Error('Login rejected (check username/password)');
      return data;
    });
  };

  // section: 'live' | 'vod' | 'series'
  var ACTIONS = {
    live: { cats: 'get_live_categories', items: 'get_live_streams', idKey: 'stream_id' },
    vod: { cats: 'get_vod_categories', items: 'get_vod_streams', idKey: 'stream_id' },
    series: { cats: 'get_series_categories', items: 'get_series', idKey: 'series_id' }
  };
  Xtream.ACTIONS = ACTIONS;

  Xtream.prototype.categories = function (section) {
    return this.call(ACTIONS[section].cats).then(toArray);
  };

  // Fetch the whole list in one request (no category_id). Many third-party
  // players instead fetch per category and silently drop anything whose
  // category is missing or hidden — that is a common cause of "missing" titles.
  Xtream.prototype.items = function (section, categoryId) {
    var params = categoryId != null ? { category_id: categoryId } : null;
    return this.call(ACTIONS[section].items, params).then(toArray);
  };

  Xtream.prototype.seriesInfo = function (seriesId) {
    return this.call('get_series_info', { series_id: seriesId });
  };

  Xtream.prototype.shortEpg = function (streamId, limit) {
    return this.call('get_short_epg', { stream_id: streamId, limit: limit || 2 })
      .then(function (data) {
        return toArray(data && data.epg_listings).map(function (e) {
          var start = e.start_timestamp ? Number(e.start_timestamp) * 1000 : Date.parse(String(e.start).replace(' ', 'T'));
          var end = e.stop_timestamp ? Number(e.stop_timestamp) * 1000 : Date.parse(String(e.end).replace(' ', 'T'));
          return {
            title: decodeBase64Utf8(e.title),
            description: decodeBase64Utf8(e.description),
            start: start,
            end: end
          };
        });
      });
  };

  Xtream.prototype.liveUrl = function (item, ext) {
    return this.server + '/live/' + encodeURIComponent(this.username) + '/' +
      encodeURIComponent(this.password) + '/' + item.stream_id + '.' + (ext || 'm3u8');
  };

  Xtream.prototype.movieUrl = function (item) {
    return this.server + '/movie/' + encodeURIComponent(this.username) + '/' +
      encodeURIComponent(this.password) + '/' + item.stream_id + '.' + (item.container_extension || 'mp4');
  };

  Xtream.prototype.episodeUrl = function (ep) {
    return this.server + '/series/' + encodeURIComponent(this.username) + '/' +
      encodeURIComponent(this.password) + '/' + ep.id + '.' + (ep.container_extension || 'mp4');
  };

  /*
   * Build a browsable catalog. Every item returned by the server ends up
   * somewhere visible:
   *   - "All" holds every unique item
   *   - items listing several categories (category_ids) appear in each
   *   - items whose category is unknown/missing go to "Uncategorized"
   */
  function buildCatalog(section, rawCategories, rawItems) {
    var idKey = ACTIONS[section].idKey;
    var seen = {};
    var items = [];
    var duplicates = 0;
    rawItems.forEach(function (it) {
      if (!it) return;
      var id = it[idKey];
      var key = id != null ? String(id) : 'noid:' + items.length;
      if (seen[key]) { duplicates++; return; }
      seen[key] = true;
      it._key = key;
      it._name = String(it.name || it.title || 'Untitled');
      it._search = foldText(it._name);
      items.push(it);
    });

    var cats = [];
    var byId = {};
    toArray(rawCategories).forEach(function (c) {
      var cid = String(c.category_id);
      if (byId[cid]) return;
      var cat = { id: cid, name: String(c.category_name || 'Category ' + cid), items: [] };
      byId[cid] = cat;
      cats.push(cat);
    });

    var uncategorized = [];
    var multi = 0;
    items.forEach(function (it) {
      var ids = [];
      toArray(it.category_ids).forEach(function (c) { ids.push(String(c)); });
      if (it.category_id != null && it.category_id !== '') ids.push(String(it.category_id));
      var placed = 0;
      var used = {};
      ids.forEach(function (cid) {
        if (used[cid] || !byId[cid]) return;
        used[cid] = true;
        byId[cid].items.push(it);
        placed++;
      });
      if (placed > 1) multi++;
      if (!placed) uncategorized.push(it);
    });

    var list = [{ id: '__all', name: 'All', items: items, special: true }];
    cats.forEach(function (c) { if (c.items.length) list.push(c); });
    if (uncategorized.length) {
      list.push({ id: '__none', name: 'Uncategorized', items: uncategorized, special: true });
    }

    return {
      section: section,
      items: items,
      categories: list,
      byKey: seen,
      stats: {
        returned: rawItems.length,
        unique: items.length,
        duplicates: duplicates,
        categories: cats.length,
        emptyCategories: cats.filter(function (c) { return !c.items.length; }).length,
        uncategorized: uncategorized.length,
        multiCategory: multi
      },
      rawCategories: toArray(rawCategories)
    };
  }

  // Lowercase + strip accents so "Pokemon" finds "Pokémon".
  function foldText(s) {
    s = String(s).toLowerCase();
    if (s.normalize) s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return s;
  }

  Xtream.buildCatalog = buildCatalog;
  Xtream.foldText = foldText;

  global.Xtream = Xtream;
})(window);
