// Fake Xtream Codes server for testing the app in a desktop browser.
// Serves ../app at http://localhost:8787/ and a mock API at /player_api.php.
//
//   node dev/mock-server.js
//   open http://localhost:8787/   (server: http://localhost:8787, user: test, pass: test)
//
// The data deliberately includes the things that make other players "lose" titles:
//   - movies whose category_id doesn't exist in the category list
//   - movies with no category at all
//   - movies listed in several categories (category_ids)
//   - movies that only show up when a category is requested on its own
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8787);
const APP_DIR = path.join(__dirname, '..', 'app');
const USER = 'test';
const PASS = 'test';

const liveCats = [1, 2, 3].map((i) => ({ category_id: String(i), category_name: ['News', 'Sports', 'Kids'][i - 1], parent_id: 0 }));
const live = [];
for (let i = 1; i <= 45; i++) {
  live.push({ num: i, name: `Channel ${i}`, stream_type: 'live', stream_id: 1000 + i, stream_icon: '', epg_channel_id: `ch${i}`, category_id: String(((i - 1) % 3) + 1) });
}

const vodCats = [];
for (let i = 1; i <= 25; i++) vodCats.push({ category_id: String(100 + i), category_name: `Movies ${String.fromCharCode(64 + i)}`, parent_id: 0 });
const vod = [];
for (let i = 1; i <= 1200; i++) {
  const m = { num: i, name: `Movie ${i}${i === 7 ? ' Pokémon' : ''}`, stream_type: 'movie', stream_id: 5000 + i, stream_icon: '', rating: String((i % 10) / 2), added: String(1700000000 + i * 1000), category_id: String(100 + (i % 25) + 1), container_extension: 'mp4' };
  if (i % 100 === 0) m.category_id = '999';          // category not in list
  if (i % 150 === 0) m.category_id = null;            // no category
  if (i % 40 === 0) m.category_ids = [101, 102];      // several categories
  vod.push(m);
}
// Only returned when their category is requested directly
const hiddenVod = [1, 2, 3].map((i) => ({ num: 9000 + i, name: `Hidden Movie ${i}`, stream_type: 'movie', stream_id: 9000 + i, category_id: '105', container_extension: 'mkv' }));

const seriesCats = [{ category_id: '200', category_name: 'Drama' }, { category_id: '201', category_name: 'Comedy' }];
const series = [];
for (let i = 1; i <= 60; i++) series.push({ num: i, name: `Show ${i}`, series_id: 7000 + i, cover: '', category_id: i % 7 === 0 ? '404' : String(200 + (i % 2)), plot: `Plot of show ${i}`, genre: 'Drama', rating: '7' });

function seriesInfo(id) {
  const s = series.find((x) => String(x.series_id) === String(id));
  if (!s) return { episodes: {} };
  const episodes = {};
  for (let season = 1; season <= 2; season++) {
    episodes[season] = [];
    for (let e = 1; e <= 12; e++) {
      episodes[season].push({ id: String(id * 100 + season * 20 + e), episode_num: e, season, title: `${s.name} S${season}E${e}`, container_extension: 'mp4', info: { duration: '00:42:00' } });
    }
  }
  return { info: { name: s.name, plot: s.plot, genre: s.genre, rating: s.rating, cover: '' }, seasons: [], episodes };
}

function b64(s) { return Buffer.from(s, 'utf8').toString('base64'); }

function api(q) {
  if (q.get('username') !== USER || q.get('password') !== PASS) return { user_info: { auth: 0 } };
  const cat = q.get('category_id');
  const byCat = (list) => (cat ? list.filter((x) => String(x.category_id) === cat || (x.category_ids || []).map(String).includes(cat)) : list);
  switch (q.get('action')) {
    case null:
      return {
        user_info: { auth: 1, status: 'Active', exp_date: String(Math.floor(Date.now() / 1000) + 30 * 86400), is_trial: '0', active_cons: '0', max_connections: '1', allowed_output_formats: ['m3u8', 'ts'] },
        server_info: { url: 'localhost', port: String(PORT), timezone: 'UTC', time_now: new Date().toISOString() }
      };
    case 'get_live_categories': return liveCats;
    case 'get_live_streams': return byCat(live);
    case 'get_vod_categories': return vodCats;
    case 'get_vod_streams': return cat ? byCat(vod.concat(hiddenVod)) : vod;
    case 'get_series_categories': return seriesCats;
    case 'get_series': return byCat(series);
    case 'get_series_info': return seriesInfo(q.get('series_id'));
    case 'get_short_epg': {
      const now = Math.floor(Date.now() / 1000);
      return { epg_listings: [
        { title: b64('Evening News'), description: b64('Headlines'), start_timestamp: String(now - 600), stop_timestamp: String(now + 1200) },
        { title: b64('Late Show'), description: b64(''), start_timestamp: String(now + 1200), stop_timestamp: String(now + 4800) }
      ] };
    }
    default: return [];
  }
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (url.pathname === '/player_api.php') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(api(url.searchParams)));
    return;
  }
  const file = path.join(APP_DIR, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
  if (!file.startsWith(APP_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Mock Xtream server + app on http://localhost:${PORT}`));
