// Mini serveur statique local (aucune dépendance) + ouverture du navigateur.
// Nécessaire car l'AudioWorklet et le Web MIDI exigent http://localhost (pas file://).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = Number(process.env.PORT) || 8765;
const ROOT = __dirname;
const URL_ = `http://localhost:${PORT}/`;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function openBrowser() {
  if (process.argv.includes('--no-open')) return;
  const candidates = [
    path.join(process.env['ProgramFiles'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['LOCALAPPDATA'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env['ProgramFiles'] || '', 'Microsoft/Edge/Application/msedge.exe'),
  ];
  const exe = candidates.find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } });
  if (process.platform !== 'win32') exec(`${process.platform === 'darwin' ? 'open' : 'xdg-open'} ${URL_}`);
  else if (exe) exec(`start "" "${exe}" --app=${URL_}`);
  else exec(`start "" ${URL_}`);
}

const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, URL_).pathname); } catch { res.writeHead(400); return res.end(); }
  if (p === '/') p = '/index.html';
  const file = path.resolve(ROOT, '.' + p);
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Serveur déjà lancé sur ${URL_} — ouverture du navigateur.`);
    openBrowser();
    setTimeout(() => process.exit(0), 500);
  } else { console.error(err); process.exit(1); }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`MiniSynth : ${URL_}`);
  console.log('Laisse cette fenêtre ouverte pendant que tu joues. Ferme-la pour arrêter.');
  openBrowser();
});
