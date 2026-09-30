// Builds a single self-contained HTML mockup of the TV app with fake data.
//   node dev/mockup/build.js [output.html]
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const index = read('app/index.html');
const stage = index.match(/ {2}<div id="stage">[\s\S]*?\n {2}<\/div>\n(?=\n {2}<script)/);
if (!stage) throw new Error('could not find #stage in app/index.html');

// The app styles html/body for a full-screen TV; scope that rule to the mock TV frame instead.
const css = read('app/style.css').replace('html, body {', '.tv {').replace('* { box-sizing: border-box; }', '.tv * { box-sizing: border-box; }');
if (!css.includes('.tv {')) throw new Error('style.css layout changed; update build.js');

const scripts = ['dev/mockup/mock-browser.js', 'app/js/xtream.js', 'app/js/app.js'].map((p) => {
  const src = read(p);
  if (/<\/script/i.test(src)) throw new Error(p + ' contains </script');
  return '<script>\n' + src + '\n</script>';
}).join('\n');

const html = read('dev/mockup/shell.html')
  .replace('{{APP_CSS}}', () => css)
  .replace('{{STAGE}}', () => stage[0])
  .replace('{{SCRIPTS}}', () => scripts);

const out = process.argv[2] || path.join(root, 'dist', 'mockup.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log('wrote ' + out + ' (' + Math.round(html.length / 1024) + ' KB)');
