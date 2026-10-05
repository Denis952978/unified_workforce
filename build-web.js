// Assembles the web app from web/ into public/ (served by the server at /).
const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..'); const out = path.join(root, 'public');
fs.mkdirSync(path.join(out, 'vendor'), { recursive: true });
const shell = fs.readFileSync(path.join(root, 'web', 'shell.html'), 'utf8');
const cut = shell.lastIndexOf('<script>'); if (cut < 0) throw new Error('web/shell.html must end with <script>');
fs.writeFileSync(path.join(out, 'index.html'), shell.slice(0, cut) + '<script src="/app.js"></script>\n</body>\n</html>\n');
const srcDir = path.join(root, 'web', 'src');
const js = fs.readdirSync(srcDir).filter(f => f.endsWith('.js')).sort().map(f => `/* ---- ${f} ---- */\n` + fs.readFileSync(path.join(srcDir, f), 'utf8')).join('\n');
fs.writeFileSync(path.join(out, 'app.js'), js);
for (const [pkg, file] of [['jspdf', 'dist/jspdf.umd.min.js'], ['jspdf-autotable', 'dist/jspdf.plugin.autotable.min.js']]) {
  const from = path.join(root, 'node_modules', pkg, file); if (!fs.existsSync(from)) throw new Error(`Missing ${from}; run npm install`);
  fs.copyFileSync(from, path.join(out, 'vendor', path.basename(file)));
}
console.log(`web app built: public/index.html, public/app.js (${Math.round(js.length / 1024)} KB), public/vendor/`);
