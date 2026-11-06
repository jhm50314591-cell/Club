const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000, MAX = 60, LIM = 9.4, STAGE_Z = -6.3;
const EMOJI = ['👋', '🔥', '❤️', '🎉'], TRACKS = 4;
const page = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));

const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/' || u === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(page);
  } else if (u === '/healthz') res.end('ok');
  else { res.writeHead(404); res.end('not found'); }
});

const wss = new WebSocketServer({ server, maxPayload: 2048 });
const players = new Map();
let nextId = 1, dj = null;

const clamp = (v, a, b) => Math.max(a, Math.min(b, +v || 0));
const txt = (s, n) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const bcast = (o, except) => { for (const p of players.values()) if (p !== except) send(p.ws, o); };
const pub = p => ({ id: p.id, name: p.name, color: p.color, x: p.x, z: p.z, ry: p.ry });

wss.on('connection', ws => {
  let me = null, count = 0;
  ws.alive = true;
  ws.on('pong', () => (ws.alive = true));
  const timer = setInterval(() => (count = 0), 1000);

  ws.on('message', raw => {
    if (++count > 40) return;                       // 초당 메시지 제한
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;

    if (!me) {                                      // 첫 메시지는 반드시 join
      if (m.t !== 'join' || players.size >= MAX) return;
      me = { ws, id: nextId++, name: txt(m.name, 8) || '손님', color: clamp(m.color, 0, 0xffffff) | 0,
             x: clamp(m.x, -LIM, LIM), z: clamp(m.z, STAGE_Z, LIM), ry: 0 };
      players.set(me.id, me);
      send(ws, { t: 'init', id: me.id, now: Date.now(),
                 players: [...players.values()].filter(p => p !== me).map(pub), dj });
      bcast({ t: 'join', p: pub(me) }, me);
      return;
    }

    switch (m.t) {
      case 'move':
        me.x = clamp(m.x, -LIM, LIM); me.z = clamp(m.z, STAGE_Z, LIM); me.ry = clamp(m.ry, -7, 7);
        bcast({ t: 'move', id: me.id, x: me.x, z: me.z, ry: me.ry }, me); break;
      case 'chat': { const t = txt(m.text, 80); if (t) bcast({ t: 'chat', id: me.id, text: t }, me); break; }
      case 'react': if (EMOJI.includes(m.e)) bcast({ t: 'react', id: me.id, e: m.e }, me); break;
      case 'dm': {                                  // 1:1 — 받는 사람에게만 전달
        const to = players.get(+m.to), t = txt(m.text, 80);
        if (to && t && to !== me) send(to.ws, { t: 'dm', from: me.id, text: t });
        break; }
      case 'dj':
        if (m.stop) { dj = null; bcast({ t: 'dj', stop: 1, by: me.name, now: Date.now() }); }
        else if (Number.isInteger(m.track) && m.track >= 0 && m.track < TRACKS) {
          dj = { track: m.track, start: Date.now(), by: me.name };
          bcast({ t: 'dj', ...dj, now: Date.now() });
        }
        break;
    }
  });

  ws.on('close', () => {
    clearInterval(timer);
    if (me) { players.delete(me.id); bcast({ t: 'leave', id: me.id }); }
  });
});

setInterval(() => {                                 // 끊긴 연결 정리
  for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; ws.ping(); }
}, 30000);

server.listen(PORT, () => console.log('열림: http://localhost:' + PORT));
