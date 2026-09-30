/*
 * In-browser fake Xtream provider for the interactive mockup.
 * Replaces fetch() for player_api.php and feeds the <video> an animated
 * canvas instead of a real stream. Loaded before xtream.js / app.js.
 */
(function () {
  'use strict';

  var SERVER = 'http://demo.example:8080';

  // ---------- deterministic pseudo-random
  var seed = 7;
  function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
  function pick(a) { return a[Math.floor(rnd() * a.length)]; }

  function svgUri(svg) { return 'data:image/svg+xml,' + encodeURIComponent(svg); }

  function wrap(title, max) {
    var words = title.split(' ');
    var lines = [''];
    words.forEach(function (w) {
      var cur = lines[lines.length - 1];
      if ((cur + ' ' + w).trim().length > max && cur) lines.push(w); else lines[lines.length - 1] = (cur + ' ' + w).trim();
    });
    return lines.slice(0, 4);
  }

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  function poster(title, hue, year) {
    var lines = wrap(title.toUpperCase(), 11);
    var y0 = 120 - lines.length * 13;
    var text = lines.map(function (l, i) {
      return '<text x="80" y="' + (y0 + i * 27) + '" text-anchor="middle" font-family="Arial Black,Arial" font-weight="900" font-size="20" fill="#fff">' + esc(l) + '</text>';
    }).join('');
    return svgUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 240"><defs><linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1">' +
      '<stop offset="0" stop-color="hsl(' + hue + ',55%,42%)"/><stop offset="1" stop-color="hsl(' + ((hue + 40) % 360) + ',60%,14%)"/></linearGradient></defs>' +
      '<rect width="160" height="240" fill="url(#g)"/><circle cx="130" cy="30" r="60" fill="#fff" opacity="0.07"/>' + text +
      '<text x="80" y="200" text-anchor="middle" font-family="Arial" font-size="13" fill="#fff" opacity="0.7">' + year + '</text></svg>');
  }

  function logo(name, hue) {
    var abbr = name.split(/\s+/).map(function (w) { return w.charAt(0); }).join('').slice(0, 3).toUpperCase();
    return svgUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120"><rect x="30" y="10" width="140" height="100" rx="20" fill="hsl(' + hue + ',65%,45%)"/>' +
      '<text x="100" y="76" text-anchor="middle" font-family="Arial Black,Arial" font-weight="900" font-size="40" fill="#fff">' + esc(abbr) + '</text></svg>');
  }

  // ---------- live (labels the way real providers write them)
  var liveCats = ['US | News', 'UK | Sports', 'EN | Kids', 'EN | Music', 'CA | English', 'Documentary',
    'FR | Généraliste', 'ES | Deportes', 'DE | Unterhaltung', 'AR | News', 'IN | Hindi'];
  var liveNames = [
    ['Metro News 24', 'World Report', 'Business Daily', 'Weather Now'],
    ['Sports Arena 1', 'Sports Arena 2', 'Goal TV', 'Motor Channel'],
    ['Toon Town', 'Little Explorers', 'Cartoon Planet'],
    ['Hit Radio TV', 'Jazz Lounge', 'Rock Stage'],
    ['Maple One', 'Northern Lights TV'],
    ['Nature World', 'History Vault', 'Space & Beyond', 'Offline Test Channel'],
    ['Info Continu', 'Télé Centre', 'Ciné Plus Nuit'],
    ['Deportes Uno', 'Fútbol Total', 'Canal Liga'],
    ['Kanal Eins', 'Unterhaltung Plus'],
    ['Al Akhbar 24', 'Al Qamar TV'],
    ['Desi Beats', 'Bollywood Hits', 'Zee Masala']
  ];
  var programs = ['Morning Briefing', 'Live Match: Harbor FC vs Northside', 'The Great Bake-Off', 'Late Night Talk', 'Wildlife Diaries',
    'Market Watch', 'Classic Movie: The Long Road', 'Cartoon Marathon', 'Top 40 Countdown', 'Deep Space Stories', 'Evening News', 'Post-Game Analysis'];
  var live = [];
  var num = 1;
  liveCats.forEach(function (c, ci) {
    liveNames[ci].forEach(function (n) {
      live.push({ num: num, name: n, stream_type: 'live', stream_id: 1000 + num, stream_icon: logo(n, (ci * 33 + num * 13) % 360),
        category_id: String(ci + 1), epg_channel_id: 'ch' + num });
      num++;
    });
  });
  live.push({ num: 90, name: 'EN | Odyssey Movie Channel 24/7', stream_type: 'live', stream_id: 1090, stream_icon: logo('Odyssey Movie', 210), category_id: '6' });

  // ---------- movies
  var adj = ['Silent', 'Midnight', 'Broken', 'Golden', 'Last', 'Hidden', 'Crimson', 'Frozen', 'Electric', 'Lost', 'Iron', 'Paper', 'Wild', 'Distant', 'Velvet'];
  var noun = ['Harbor', 'Protocol', 'Kingdom', 'Signal', 'Summer', 'Horizon', 'Garden', 'Frontier', 'Engine', 'Promise', 'Echo', 'Station', 'River', 'Crown', 'Letter'];
  // [category name, how many titles, title language for generated names]
  var vodCatDefs = [
    ['EN | New Releases 2026', 22, 'en'], ['EN | Action', 18, 'en'], ['EN | Comedy', 16, 'en'], ['EN | Drama', 16, 'en'],
    ['EN | Sci-Fi & Fantasy', 14, 'en'], ['EN | Family & Kids', 12, 'en'], ['4K | UHD Movies', 12, 'en'], ['NETFLIX Movies', 14, 'en'],
    ['EN | Cinema (CAM)', 6, 'en'], ['FR | Films Nouveautés', 10, 'fr'], ['ES | Películas', 10, 'es'], ['DE | Filme', 8, 'de'],
    ['IT | Film', 8, 'it'], ['AR | Arabic Movies', 8, 'ar'], ['HINDI MOVIES', 10, 'hi'], ['TR | Filmler', 8, 'tr']
  ];
  var foreign = {
    fr: ['Le Dernier Été', 'La Nuit Blanche', 'Les Ombres', 'Le Voyage', 'La Promesse', 'Le Silence', 'Les Rivières', 'La Couronne'],
    es: ['El Último Verano', 'La Noche', 'Las Sombras', 'El Viaje', 'La Promesa', 'El Silencio', 'El Río', 'La Corona'],
    de: ['Der letzte Sommer', 'Die Nacht', 'Schatten', 'Die Reise', 'Das Versprechen', 'Stille'],
    it: ['L\'ultima estate', 'La notte', 'Le ombre', 'Il viaggio', 'La promessa', 'Il silenzio'],
    ar: ['Al Qamar', 'Layali', 'Al Tareeq', 'Sahra', 'Bab Al Hara', 'Al Hob'],
    hi: ['Dil Se Dosti', 'Raat Ka Raaz', 'Safar', 'Pyaar Ka Vaada', 'Khamoshi', 'Rang Barse', 'Dhadkan Returns'],
    tr: ['Son Yaz', 'Gece', 'Gölgeler', 'Yolculuk', 'Söz', 'Sessizlik']
  };
  var prefix = { fr: 'FR - ', es: 'ES - ', de: 'DE - ', it: 'IT - ', ar: 'AR - ', hi: '', tr: 'TR - ' };
  var vodCats = vodCatDefs.map(function (d, i) { return { category_id: String(100 + i), category_name: d[0], parent_id: 0 }; });
  var vod = [];
  var titles = {};
  var sid = 5000;
  function addMovie(name, catId, extra) {
    sid++;
    var year = extra && extra.year || 1995 + Math.floor(rnd() * 31);
    var m = { num: sid - 5000, name: name, stream_type: 'movie', stream_id: sid, stream_icon: poster(extra && extra.poster || name.replace(/^[A-Z]{2} - /, ''), extra && extra.hue != null ? extra.hue : Math.floor(rnd() * 360), year),
      rating: (5 + rnd() * 4).toFixed(1), added: String(1750000000 + sid * 3600), category_id: catId, container_extension: 'mkv' };
    if (extra) Object.keys(extra).forEach(function (k) { if (k !== 'year' && k !== 'poster' && k !== 'hue') m[k] = extra[k]; });
    vod.push(m);
    return m;
  }
  vodCatDefs.forEach(function (d, ci) {
    for (var k = 0; k < d[1]; k++) {
      var t;
      if (d[2] === 'en') {
        do { t = (rnd() < 0.5 ? 'The ' : '') + pick(adj) + ' ' + pick(noun) + (rnd() < 0.12 ? ' ' + (2 + Math.floor(rnd() * 2)) : ''); } while (titles[t]);
        titles[t] = true;
        var y = 1995 + Math.floor(rnd() * 31);
        var q = d[0].indexOf('4K') === 0 ? ' 4K' : d[0].indexOf('CAM') > 0 ? ' [HDCAM]' : '';
        addMovie('EN - ' + t + ' (' + y + ')' + q, String(100 + ci), { year: y, poster: t });
      } else {
        var base = foreign[d[2]][k % foreign[d[2]].length] + (k >= foreign[d[2]].length ? ' ' + (Math.floor(k / foreign[d[2]].length) + 1) : '');
        addMovie(prefix[d[2]] + base, String(100 + ci), { poster: base });
      }
    }
  });
  // Titles most players lose
  addMovie('EN - The Silent Harbor Returns (2025)', '999', { poster: 'The Silent Harbor Returns' });   // category not listed
  addMovie('EN - Paper Garden (2023)', null, { poster: 'Paper Garden' });                           // no category
  addMovie('Amélie Returns (2024)', '107', { poster: 'Amélie Returns', hue: 330 });

  // "The Odyssey" the way providers really list it: several copies, languages and qualities
  var ody = { year: 2026, poster: 'The Odyssey', hue: 205 };
  addMovie('EN - The Odyssey (2026)', '100', ody);
  addMovie('The Odyssey (2026) 4K', '106', ody);
  addMovie('The.Odyssey.2026.1080p.HDCAM', '108', ody);
  addMovie('Odyssey, The (2026)', '107', ody);
  addMovie('FR - L’Odyssée (2026)', '109', { year: 2026, poster: 'L\'Odyssée', hue: 205, o_name: 'The Odyssey' });
  addMovie('ES - La Odisea (2026)', '110', { year: 2026, poster: 'La Odisea', hue: 205, o_name: 'The Odyssey' });
  // Only returned when its category is requested on its own
  var hiddenVod = [
    { num: 900, name: '|EN| THE ODYSSEY (2026) [MULTI-SUB]', stream_type: 'movie', stream_id: 9000, stream_icon: poster('The Odyssey', 205, 2026), rating: '8.4', category_id: '100', container_extension: 'mkv', added: String(1759000000) },
    { num: 901, name: 'EN - Velvet Frontier: Director\'s Cut (2025)', stream_type: 'movie', stream_id: 9001, stream_icon: poster('Velvet Frontier', 40, 2025), rating: '7.2', category_id: '100', container_extension: 'mkv' },
    { num: 902, name: 'EN - Echo Station (2025)', stream_type: 'movie', stream_id: 9002, stream_icon: poster('Echo Station', 90, 2025), rating: '6.8', category_id: '101', container_extension: 'mkv' }
  ];
  // A few titles sit in two categories
  vod.forEach(function (m, i) { if (i % 17 === 5 && m.category_id) m.category_ids = [Number(m.category_id), 106]; });

  // ---------- series
  var seriesCatDefs = ['EN | Drama Series', 'EN | Comedy Series', 'EN | Crime & Thriller', 'UK | Reality', 'Anime', 'FR | Séries', 'ES | Series', 'TR | Diziler', 'AR | Series'];
  var seriesCats = seriesCatDefs.map(function (n, i) { return { category_id: String(200 + i), category_name: n }; });
  var showsEn = ['Northside', 'Blue Harbor', 'The Firm', 'Kitchen Wars', 'Ghost Signal', 'Small Town', 'Deadline', 'Starfall', 'Night Shift',
    'The Heist Crew', 'Island Life', 'Code Black', 'Paper Hearts', 'Mountain Rescue', 'Neon District', 'Second Chances', 'The Academy', 'Galaxy Patrol'];
  var showsOther = [['FR - Les Voisins', 205], ['FR - Brigade Nord', 205], ['ES - La Casa Azul', 206], ['ES - Barrio Sur', 206],
    ['TR - Kara Sevda Yeni', 207], ['TR - Yalı Çapkını', 207], ['AR - Bab Al Hara 12', 208]];
  var series = [];
  showsEn.forEach(function (n, k) {
    var year = 2010 + (k % 15);
    series.push({ num: series.length + 1, name: 'EN - ' + n, series_id: 7000 + series.length, cover: poster(n, (k * 47) % 360, year),
      category_id: k === 8 ? '404' : String(200 + (k % 5)), plot: n + ' follows a group of unlikely allies whose lives collide over one unforgettable season.',
      genre: ['Drama', 'Comedy', 'Crime', 'Reality', 'Anime'][k % 5], rating: (6 + (k % 4) * 0.7).toFixed(1), releaseDate: String(year) });
  });
  showsOther.forEach(function (s) {
    var n = s[0];
    series.push({ num: series.length + 1, name: n, series_id: 7000 + series.length, cover: poster(n.slice(5), (series.length * 47) % 360, 2024),
      category_id: String(s[1]), plot: 'A popular drama series.', genre: 'Drama', rating: '7.0', releaseDate: '2024' });
  });
  series.push({ num: series.length + 1, name: 'The Odyssey (1997) Miniseries', series_id: 7000 + series.length, cover: poster('The Odyssey', 30, 1997),
    category_id: '200', plot: 'Odysseus spends ten years trying to return home after the Trojan War.', genre: 'Adventure', rating: '6.9', releaseDate: '1997' });

  var names = {};
  live.forEach(function (c) { names['live/' + c.stream_id] = c.name; });
  vod.concat(hiddenVod).forEach(function (m) { names['movie/' + m.stream_id] = m.name; });

  function seriesInfo(id) {
    var s = series.filter(function (x) { return String(x.series_id) === String(id); })[0];
    if (!s) return { episodes: {} };
    var eps = {};
    var seasons = 1 + (Number(id) % 3);
    for (var sn = 1; sn <= seasons; sn++) {
      eps[sn] = [];
      var count = 6 + ((Number(id) + sn) % 5);
      for (var e = 1; e <= count; e++) {
        var eid = String(Number(id) * 1000 + sn * 50 + e);
        var title = e === 1 && sn === 1 ? 'Pilot' : pick(['The Return', 'Fault Lines', 'Crossroads', 'Open Water', 'Blackout', 'Homecoming', 'The Offer', 'Loose Ends', 'Aftermath', 'Turning Point']);
        names['series/' + eid] = s.name + ' · S' + sn + 'E' + e;
        eps[sn].push({ id: eid, episode_num: e, season: sn, title: title, container_extension: 'mkv', info: { duration: '00:4' + (e % 10) + ':00' } });
      }
    }
    return { info: { name: s.name, plot: s.plot, genre: s.genre, rating: s.rating, releaseDate: s.releaseDate, cover: s.cover }, seasons: [], episodes: eps };
  }

  function b64(s) { return btoa(unescape(encodeURIComponent(s))); }

  function api(q) {
    if (!q.get('username') || !q.get('password')) return { user_info: { auth: 0 } };
    var cat = q.get('category_id');
    function byCat(list) {
      if (!cat) return list;
      return list.filter(function (x) { return String(x.category_id) === cat || (x.category_ids || []).map(String).indexOf(cat) >= 0; });
    }
    switch (q.get('action')) {
      case null:
        return {
          user_info: { auth: 1, status: 'Active', exp_date: String(Math.floor(Date.now() / 1000) + 27 * 86400), is_trial: '0', active_cons: '1',
            max_connections: '2', allowed_output_formats: ['m3u8', 'ts'] },
          server_info: { url: 'demo.example', port: '8080', timezone: 'America/New_York', time_now: new Date().toISOString().slice(0, 19).replace('T', ' ') }
        };
      case 'get_live_categories': return liveCats.map(function (n, i) { return { category_id: String(i + 1), category_name: n }; });
      case 'get_live_streams': return byCat(live);
      case 'get_vod_categories': return vodCats;
      case 'get_vod_streams': return cat ? byCat(vod.concat(hiddenVod)) : vod;
      case 'get_series_categories': return seriesCats;
      case 'get_series': return byCat(series);
      case 'get_series_info': return seriesInfo(q.get('series_id'));
      case 'get_short_epg': {
        var id = Number(q.get('stream_id'));
        var now = Math.floor(Date.now() / 1000);
        var slot = 1800;
        var start = now - (now % slot);
        return { epg_listings: [0, 1].map(function (k) {
          return { title: b64(programs[(id + k + Math.floor(start / slot)) % programs.length]), description: b64(''),
            start_timestamp: String(start + k * slot), stop_timestamp: String(start + (k + 1) * slot) };
        }) };
      }
      default: return [];
    }
  }

  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (url) {
    url = String(url);
    if (url.indexOf('/player_api.php') < 0) return realFetch(url);
    var q = new URL(url).searchParams;
    var action = q.get('action') || '';
    var delay = /get_(vod|series)$|get_vod_streams|get_series$/.test(action) ? 700 : 250;
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve(new Response(JSON.stringify(api(q)), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }, delay);
    });
  };

  // Start logged in so the mockup opens on real content.
  try {
    if (!localStorage.getItem('iptv.creds')) {
      localStorage.setItem('iptv.creds', JSON.stringify({ server: SERVER, username: 'demo', password: 'demo' }));
    }
  } catch (e) { /* storage blocked: the login screen accepts any username/password */ }

  // ---------- fake playback: an animated canvas stands in for the stream
  document.addEventListener('DOMContentLoaded', function () {
    var video = document.getElementById('video');
    if (!video || !HTMLCanvasElement.prototype.captureStream) return;
    var canvas = document.createElement('canvas');
    canvas.width = 960; canvas.height = 540;
    var ctx = canvas.getContext('2d');
    var stream = null;
    var label = '';
    var kind = '';
    var timer = null;
    var t0 = 0;

    function draw() {
      var t = (Date.now() - t0) / 1000;
      var hue = (t * 12) % 360;
      var g = ctx.createLinearGradient(0, 0, 960, 540);
      g.addColorStop(0, 'hsl(' + hue + ',50%,22%)');
      g.addColorStop(1, 'hsl(' + ((hue + 70) % 360) + ',55%,10%)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 960, 540);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      for (var i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.arc(480 + Math.cos(t / 2 + i) * 300, 270 + Math.sin(t / 3 + i * 2) * 160, 60 + i * 12, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.font = 'bold 44px Arial';
      ctx.fillText(label, 480, 250);
      ctx.font = '24px Arial';
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillText((kind === 'live' ? '● LIVE  ' : '') + 'Sample video — the real stream plays here', 480, 300);
    }

    var nativeRemove = video.removeAttribute.bind(video);
    Object.defineProperty(video, 'src', {
      configurable: true,
      get: function () { return video.getAttribute('data-src') || ''; },
      set: function (url) {
        video.setAttribute('data-src', url);
        var m = /\/(live|movie|series)\/[^/]+\/[^/]+\/(\d+)\./.exec(url);
        var key = m ? m[1] + '/' + m[2] : '';
        if (!m || !names[key] || /Offline/.test(names[key])) {
          // Simulate a dead stream so the error handling can be seen
          video.srcObject = null;
          video.setAttribute('src', 'data:video/mp4;base64,AAAA');
          return;
        }
        nativeRemove('src');
        label = names[key];
        kind = m[1];
        t0 = Date.now();
        if (!stream) stream = canvas.captureStream(24);
        clearInterval(timer);
        draw();
        timer = setInterval(draw, 1000 / 24);
        video.muted = true;
        video.srcObject = stream;
      }
    });
    video.removeAttribute = function (name) {
      if (name === 'src') { clearInterval(timer); video.srcObject = null; }
      return nativeRemove(name);
    };
  });
})();
