require('dotenv').config();

const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const os = require('os');

const HAPTIC_CHANNELS = new Set(['lb', 'lt', 'rb', 'rt']);
const EVENT_HISTORY_LIMIT = 200;
const LOGS_DIR = path.join(__dirname, 'logs');

function sessionLogFilename() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}.log`;
}

function formatEventLogLine(event) {
  const now = new Date().toISOString().split('T')[1].replace('Z', '');
  const text = event.message || `${event.userId || 'system'} ${event.type}`;
  return `[${now}] ${text}`;
}

let sessionLogStream = null;

function initSessionLog() {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  const logPath = path.join(LOGS_DIR, sessionLogFilename());
  sessionLogStream = fs.createWriteStream(logPath, { flags: 'a' });
  writeSessionSystemLog(`--- session started (${logPath}) ---`);
  console.log(`📝 Session log: ${logPath}`);
}

function writeSessionLog(line, roomKey) {
  if (!sessionLogStream) return;
  const room = roomKey ? `[room:${roomKey}] ` : '[room:global] ';
  sessionLogStream.write(`${room}${line}\n`);
}

function writeSessionSystemLog(line) {
  if (!sessionLogStream) return;
  sessionLogStream.write(`${line}\n`);
}

const app = express();

const httpServer = http.createServer(app);
let httpsServer = null;

try {
  if (fs.existsSync('server-key.pem') && fs.existsSync('server-cert.pem')) {
    const options = {
      key: fs.readFileSync('server-key.pem'),
      cert: fs.readFileSync('server-cert.pem')
    };
    httpsServer = https.createServer(options, app);
    console.log('✅ HTTPS server created with local certificates');
  } else {
    console.log('⚠️  No certificates found, HTTPS server not available');
  }
} catch (error) {
  console.log('⚠️  Error creating HTTPS server:', error.message);
}

const httpWss = new WebSocket.Server({ server: httpServer });
let httpsWss = null;
if (httpsServer) {
  httpsWss = new WebSocket.Server({ server: httpsServer });
}

function setupHeartbeat(wss) {
  setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN && ws.id && ws.id.startsWith('browser-')) {
        if (ws.isAlive === false) {
          console.log('Browser client did not respond to ping, terminating connection:', ws.id);
          ws.terminate();
          return;
        }
        ws.isAlive = false;
        ws.ping();
      }
    });
  }, 30000);
}

setupHeartbeat(httpWss);
if (httpsWss) {
  setupHeartbeat(httpsWss);
}

const devices = {};
let deviceCounter = 0;
const browserStates = {};
const browserNicknames = {};
const eventHistories = {};

function displayName(userId) {
  return browserNicknames[userId] || userId;
}

function normalizeNickname(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length > 32) return null;
  if (!/^[a-zA-Z0-9 _-]+$/.test(trimmed)) return null;
  return trimmed;
}

function browserUserPayload(userId) {
  return {
    id: userId,
    nickname: browserNicknames[userId] || null,
    status: browserStates[userId] || {
      leftConnected: false,
      rightConnected: false,
      leftPressed: false,
      rightPressed: false,
      ready: false
    }
  };
}

function broadcastNicknameEvent(roomKey) {
  broadcastToBrowsersInRoom(roomKey, {
    type: 'event-log',
    event: getEventHistory(roomKey)[getEventHistory(roomKey).length - 1]
  });
}

function roomKeyFromPath(pathname) {
  const p = (pathname || '/').split('?')[0];
  const m = p.match(/^\/r\/([^/]+)\/?$/);
  if (!m) return '';
  const id = m[1];
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) return '';
  return id;
}

function parseRoomKeyFromReqUrl(url) {
  return roomKeyFromPath(url || '/');
}

function getEventHistory(roomKey) {
  const k = roomKey || '';
  if (!eventHistories[k]) eventHistories[k] = [];
  return eventHistories[k];
}

function appendEventLog(roomKey, event) {
  const list = getEventHistory(roomKey);
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    ...event
  };
  list.push(entry);
  if (list.length > EVENT_HISTORY_LIMIT) {
    list.splice(0, list.length - EVENT_HISTORY_LIMIT);
  }
  writeSessionLog(formatEventLogLine(entry), roomKey);
}

function getBrowserSocketsInRoom(roomKey) {
  const rk = roomKey || '';
  return Object.entries(devices).filter(
    ([id, sock]) => id.startsWith('browser-') && sock && sock.roomKey === rk
  );
}

function getConnectedBrowserIdsInRoom(roomKey) {
  return getBrowserSocketsInRoom(roomKey).map(([id]) => id);
}

function broadcastToBrowsersInRoom(roomKey, payload, exceptId = null) {
  getBrowserSocketsInRoom(roomKey).forEach(([id, socket]) => {
    if (exceptId && id === exceptId) return;
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload));
    }
  });
}

function broadcastEspHapticInRoom(roomKey, channel) {
  const rk = roomKey || '';
  Object.entries(devices).forEach(([id, sock]) => {
    if (!id.startsWith('esp-')) return;
    if (sock.roomKey !== rk) return;
    if (sock.readyState === WebSocket.OPEN) {
      sock.send(channel);
    }
  });
}

function normalizeHapticChannel(message) {
  if (message.type === 'haptic' && typeof message.channel === 'string') {
    const ch = message.channel.toLowerCase();
    if (HAPTIC_CHANNELS.has(ch)) return ch;
    return null;
  }
  if (message.type === 'joycon-trigger') {
    const btn = message.button === 'ZR' ? 'ZR' : 'ZL';
    return btn === 'ZR' ? 'rt' : 'lt';
  }
  return null;
}

function fanOutHaptic(roomKey, userId, channel, exceptUserId = null) {
  const hapticPayload = { type: 'haptic', userId, channel };
  broadcastToBrowsersInRoom(roomKey, hapticPayload, exceptUserId);
  broadcastEspHapticInRoom(roomKey, channel);
  appendEventLog(roomKey, {
    type: 'trigger',
    userId,
    message: `${displayName(userId)} sent ${channel}`
  });
  broadcastToBrowsersInRoom(roomKey, {
    type: 'event-log',
    event: getEventHistory(roomKey)[getEventHistory(roomKey).length - 1]
  });
}

function broadcastPresenceUpdate(roomKey) {
  broadcastToBrowsersInRoom(roomKey, {
    type: 'presence-update',
    users: getConnectedBrowserIdsInRoom(roomKey).map((id) => browserUserPayload(id))
  });
}

function readHtmlTemplate(filename) {
  return fs.readFileSync(path.join(__dirname, 'public', filename), 'utf8');
}

function injectDashboardVars(html, roomKey) {
  const wsRoomPath = roomKey ? `/r/${roomKey}` : '/';
  const joyconHref = roomKey ? `/r/${roomKey}/joycon` : '/joycon';
  const nrfHref = roomKey ? `/r/${roomKey}` : '/';
  return html
    .replace(/\{\{WS_ROOM_PATH\}\}/g, wsRoomPath)
    .replace(/\{\{JOYCON_HREF\}\}/g, joyconHref)
    .replace(/\{\{NRF_HREF\}\}/g, nrfHref);
}

function servePage(res, filename, roomKey) {
  let html = readHtmlTemplate(filename);
  html = injectDashboardVars(html, roomKey);
  res.send(html);
}

app.get('/', (req, res) => {
  console.log('🌐 Serving dashboard (global room)');
  servePage(res, 'index.html', '');
});

// Avoid serving raw `public/index.html` via static (unreplaced room/navigation placeholders).
app.get('/index.html', (req, res) => servePage(res, 'index.html', ''));

app.get('/r/:roomId/joycon', (req, res) => {
  const rk = roomKeyFromPath(`/r/${req.params.roomId}`);
  if (!rk) return res.status(400).send('Invalid room');
  servePage(res, 'joycon.html', rk);
});

app.get(['/r/:roomId/gui', '/r/:roomId/test'], (req, res) => {
  const rk = roomKeyFromPath(`/r/${req.params.roomId}`);
  if (!rk) return res.status(400).send('Invalid room');
  res.redirect(302, `/r/${rk}/joycon`);
});

app.get(['/gui', '/gui.html', '/test', '/test.html'], (req, res) => res.redirect(302, '/joycon'));
app.get(['/joycon', '/joycon.html'], (req, res) => servePage(res, 'joycon.html', ''));

app.get('/r/:roomId', (req, res) => {
  const rk = roomKeyFromPath(`/r/${req.params.roomId}`);
  if (!rk) return res.status(400).send('Invalid room id');
  servePage(res, 'index.html', rk);
});

app.get('/r/:roomId/nrf', (req, res) => {
  const rk = roomKeyFromPath(`/r/${req.params.roomId}`);
  if (!rk) return res.status(400).send('Invalid room');
  res.redirect(302, `/r/${rk}`);
});

app.get(['/nrf', '/nrf.html'], (req, res) => res.redirect(302, '/'));

app.get('/api/devices', (req, res) => {
  const roomQ = typeof req.query.room === 'string' ? req.query.room : '';
  let list = Object.keys(devices).filter((id) => id.startsWith('esp-'));
  if (roomQ) {
    list = list.filter((id) => devices[id] && devices[id].roomKey === roomQ);
  }
  res.json(list);
});

app.get('/api/esp32-classes', (req, res) => {
  const classes = new Set();
  Object.keys(devices).forEach((id) => {
    if (id.startsWith('esp-')) {
      const match = id.match(/^esp-(\d+)-/);
      if (match) classes.add(match[1]);
    }
  });
  res.json(Array.from(classes).sort());
});

app.get('/api/browsers', (req, res) => {
  const roomQ = typeof req.query.room === 'string' ? req.query.room : '';
  let list = Object.keys(devices).filter((id) => id.startsWith('browser-'));
  if (roomQ) {
    list = list.filter((id) => devices[id] && devices[id].roomKey === roomQ);
  }
  res.json(list);
});

app.use(express.static(path.join(__dirname, 'public')));

function handleWebSocketConnection(ws, req) {
  const rawUrl = req && req.url ? req.url : '/';
  ws.roomKey = parseRoomKeyFromReqUrl(rawUrl);
  console.log('🔌 New WebSocket connection, roomKey:', JSON.stringify(ws.roomKey || 'global'));

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', function incoming(message) {
    const msg = message.toString();
    console.log('Received message:', msg);

    if (msg === 'REGISTER') {
      const targetClass = '000';
      const instanceId = String(deviceCounter++).padStart(3, '0');
      const id = `esp-${targetClass}-${instanceId}`;
      devices[id] = ws;
      ws.id = id;
      console.log(`✅ Assigned ESP32 ID: ${id} (room: ${ws.roomKey || 'global'})`);
      ws.send(`ASSIGNED_ID ${id}`);
    } else if (msg.startsWith('REGISTER ')) {
      const id = msg.split(' ')[1];
      devices[id] = ws;
      ws.id = id;
      console.log(`Registered with provided ID: ${id} (room: ${ws.roomKey || 'global'})`);

      if (id.startsWith('browser-')) {
        browserStates[id] = browserStates[id] || {
          leftConnected: false,
          rightConnected: false,
          leftPressed: false,
          rightPressed: false,
          ready: false
        };
        const rk = ws.roomKey || '';
        ws.send(
          JSON.stringify({
            type: 'initial-state',
            selfId: id,
            roomKey: rk,
            users: getConnectedBrowserIdsInRoom(rk).map((userId) => browserUserPayload(userId)),
            events: getEventHistory(rk)
          })
        );
        appendEventLog(rk, {
          type: 'presence',
          userId: id,
          message: `${displayName(id)} joined dashboard`
        });
        broadcastPresenceUpdate(rk);
        broadcastToBrowsersInRoom(rk, {
          type: 'event-log',
          event: getEventHistory(rk)[getEventHistory(rk).length - 1]
        });
      }
    } else if (msg.startsWith('CMD ')) {
      const parts = msg.split(' ');
      const target = parts[1];
      const command = parts.slice(2).join(' ');
      const device = devices[target];
      if (device) {
        device.send(command);
      }
    } else {
      try {
        const parsed = JSON.parse(msg);

        switch (parsed.type) {
          case 'joycon-status': {
            if (ws.id && ws.id.startsWith('browser-')) {
              const nextState = {
                leftConnected: !!parsed.leftConnected,
                rightConnected: !!parsed.rightConnected,
                leftPressed: !!parsed.leftPressed,
                rightPressed: !!parsed.rightPressed
              };
              nextState.ready = nextState.leftConnected && nextState.rightConnected;
              browserStates[ws.id] = nextState;
              broadcastPresenceUpdate(ws.roomKey || '');
            }
            break;
          }

          case 'set-nickname': {
            if (!ws.id || !ws.id.startsWith('browser-')) break;
            const nickname = normalizeNickname(parsed.nickname);
            if (nickname === null) break;
            const rk = ws.roomKey || '';
            const prev = browserNicknames[ws.id];
            if (!nickname) {
              if (!prev) break;
              delete browserNicknames[ws.id];
            } else {
              if (prev === nickname) break;
              browserNicknames[ws.id] = nickname;
              appendEventLog(rk, {
                type: 'nickname',
                userId: ws.id,
                message: `${ws.id} set nickname to ${nickname}`
              });
              broadcastNicknameEvent(rk);
            }
            broadcastPresenceUpdate(rk);
            break;
          }

          case 'haptic':
          case 'joycon-trigger': {
            if (!ws.id || !ws.id.startsWith('browser-')) break;
            const channel = normalizeHapticChannel(parsed);
            if (!channel) break;
            fanOutHaptic(ws.roomKey || '', ws.id, channel, ws.id);
            break;
          }

          default:
            break;
        }
      } catch (_e) {
        // not JSON
      }
    }
  });

  ws.on('error', (error) => {
    console.log('❌ WebSocket error for:', ws.id, error.message);
  });

  ws.on('close', () => {
    console.log('🔌 WebSocket connection closed for:', ws.id);
    const rk = ws.roomKey || '';

    if (ws.id && ws.id.startsWith('browser-')) {
      appendEventLog(rk, {
        type: 'presence',
        userId: ws.id,
        message: `${displayName(ws.id)} left dashboard`
      });
      delete browserStates[ws.id];
      delete browserNicknames[ws.id];
      broadcastToBrowsersInRoom(rk, {
        type: 'event-log',
        event: getEventHistory(rk)[getEventHistory(rk).length - 1]
      }, ws.id);
      broadcastPresenceUpdate(rk);
    }

    if (ws.id) delete devices[ws.id];
  });
}

httpWss.on('connection', handleWebSocketConnection);
if (httpsWss) {
  httpsWss.on('connection', handleWebSocketConnection);
}

const HTTP_PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3001;
const HOST = process.env.HOST || '127.0.0.1';

function logServerUrls(protocol, port) {
  console.log(`Listening on ${HOST}:${port}`);
  if (HOST === '127.0.0.1' || HOST === '0.0.0.0' || HOST === '::' || HOST === 'localhost' || HOST === '::1') {
    console.log(`Local: ${protocol}://localhost:${port}`);
  }
  if (HOST === '0.0.0.0' || HOST === '::') {
    const addresses = new Set(Object.values(os.networkInterfaces()).flat()
      .filter((address) => address && address.family === 'IPv4' && !address.internal)
      .map((address) => address.address));
    for (const address of addresses) {
      console.log(`LAN:   ${protocol}://${address}:${port}`);
    }
  } else if (HOST !== '127.0.0.1' && HOST !== 'localhost' && HOST !== '::1') {
    const urlHost = HOST.includes(':') ? `[${HOST}]` : HOST;
    console.log(`Demo:  ${protocol}://${urlHost}:${port}`);
  }
}

initSessionLog();

httpServer.listen(HTTP_PORT, HOST, () => logServerUrls('http', HTTP_PORT));

if (httpsServer) {
  httpsServer.listen(HTTPS_PORT, HOST, () => logServerUrls('https', HTTPS_PORT));
} else {
  console.log('HTTPS unavailable: add server-key.pem and server-cert.pem to enable it.');
}
