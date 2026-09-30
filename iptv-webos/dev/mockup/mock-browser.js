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

  // ---------- live
  var liveCats = ['News', 'Sports', 'Movies', 'Kids', 'Music', 'Documentary'];
  var liveNames = {
    News: ['Metro News 24', 'World Report', 'Business Daily', 'Weather Now', 'City Hall Live', 'Global Headlines'],
    Sports: ['Sports Arena 1', 'Sports Arena 2', 'Goal TV', 'Fight Night', 'Motor Channel', 'Golf Plus', 'Tennis Center'],
    Movies: ['Cinema One', 'Action Max', 'Classic Screen', 'Thriller Zone', 'Romance Reel', 'Comedy Central Park'],
    Kids: ['Toon Town', 'Little Explorers', 'Cartoon Planet', 'Junior Science'],
    Music: ['Hit Radio TV', 'Jazz Lounge', 'Rock Stage', 'Latin Beats'],
    Documentary: ['Nature World', 'History Vault', 'Space & Beyond', 'Food Journeys', 'Offline Test Channel']
  };
  var programs = ['Morning Briefing', 'Live Match: Harbor FC vs Northside', 'The Great Bake-Off', 'Late Night Talk', 'Wildlife Diaries',
    'Market Watch', 'Classic Movie: The Long Road', 'Cartoon Marathon', 'Top 40 Countdown', 'Deep Space Stories', 'Evening News', 'Post-Game Analysis'];
  var live = [];
  var num = 1;
  liveCats.forEach(function (c, ci) {
    liveNames[c].forEach(function (n) {
      live.push({ num: num, name: n, stream_type: 'live', stream_id: 1000 + num, stream_icon: logo(n, (ci * 60 + num * 13) % 360),
        category_id: String(ci + 1), epg_channel_id: 'ch' + num });
      num++;
    });
  });

  // ---------- movies
  var adj = ['Silent', 'Midnight', 'Broken', 'Golden', 'Last', 'Hidden', 'Crimson', 'Frozen', 'Electric', 'Lost', 'Iron', 'Paper', 'Wild', 'Distant', 'Velvet'];
  var noun = ['Harbor', 'Protocol', 'Kingdom', 'Signal', 'Summer', 'Horizon', 'Garden', 'Frontier', 'Engine', 'Promise', 'Echo', 'Station', 'River', 'Crown', 'Letter'];
  var vodCatNames = ['New Releases', 'Action', 'Comedy', 'Drama', 'Sci-Fi', 'Family', 'Horror', 'Documentary', '4K UHD'];
  var vodCats = vodCatNames.map(function (n, i) { return { category_id: String(100 + i), category_name: n, parent_id: 0 }; });
  var vod = [];
  var titles = {};
  for (var i = 1; i <= 180; i++) {
    var t;
    do { t = (rnd() < 0.5 ? 'The ' : '') + pick(adj) + ' ' + pick(noun) + (rnd() < 0.15 ? ' ' + (2 + Math.floor(rnd() * 2)) : ''); } while (titles[t]);
    titles[t] = true;
    var year = 1995 + Math.floor(rnd() * 31);
    var m = { num: i, name: t + ' (' + year + ')', stream_type: 'movie', stream_id: 5000 + i, stream_icon: poster(t, Math.floor(rnd() * 360), year),
      rating: (5 + rnd() * 4).toFixed(1), added: String(1750000000 + i * 86400), category_id: String(100 + (i % vodCatNames.length)),
      container_extension: 'mkv' };
    if (i % 23 === 0) m.category_id = '999';        // category the server doesn't list
    if (i % 31 === 0) m.category_id = null;         // no category
    if (i % 12 === 0) m.category_ids = [100, 100 + (i % vodCatNames.length)];
    vod.push(m);
  }
  vod.push({ num: 181, name: 'Amélie Returns (2024)', stream_type: 'movie', stream_id: 5181, stream_icon: poster('Amélie Returns', 330, 2024), rating: '7.9', category_id: '102', container_extension: 'mp4' });
  // Only returned when their category is requested on its own
  var hiddenVod = ['Velvet Frontier: Director\'s Cut', 'Paper Crown', 'Echo Station', 'The Iron Letter', 'Wild River Rising'].map(function (n, k) {
    return { num: 900 + k, name: n + ' (2025)', stream_type: 'movie', stream_id: 9000 + k, stream_icon: poster(n, 40 + k * 50, 2025), rating: '7.2', category_id: '100', container_extension: 'mkv' };
  });

  // ---------- series
  var seriesCatNames = ['Drama', 'Comedy', 'Crime', 'Reality', 'Anime'];
  var seriesCats = seriesCatNames.map(function (n, i) { return { category_id: String(200 + i), category_name: n }; });
  var showA = ['Northside', 'Blue Harbor', 'The Firm', 'Kitchen Wars', 'Ghost Signal', 'Small Town', 'Deadline', 'Starfall', 'Night Shift', 'Family Ties Revisited',
    'The Heist Crew', 'Island Life', 'Code Black', 'Paper Hearts', 'Mountain Rescue', 'Neon District', 'Second Chances', 'The Academy', 'Wild Cards', 'Silver Lining',
    'Hidden Depths', 'Road Trip', 'Crown Court', 'Galaxy Patrol', 'Home Makeover'];
  var series = showA.map(function (n, k) {
    var year = 2010 + (k % 15);
    return { num: k + 1, name: n, series_id: 7000 + k, cover: poster(n, (k * 47) % 360, year), category_id: k % 9 === 4 ? '404' : String(200 + (k % seriesCatNames.length)),
      plot: n + ' follows a group of unlikely allies whose lives collide over one unforgettable season.', genre: seriesCatNames[k % seriesCatNames.length], rating: (6 + (k % 4) * 0.7).toFixed(1), releaseDate: String(year) };
  });

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
