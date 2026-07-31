/**
 * Ankara Sürüş — LAN co-op sunucusu.
 *
 *   node server.mjs
 *
 * Serves the game and relays messages between the players on your network.
 * Everybody opens the address it prints and types the same six-digit code.
 *
 * No dependencies: the WebSocket handshake and framing are implemented here
 * directly, because a game that is otherwise a single self-contained file
 * should not need an npm install to play together.
 */

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PORT = Number(process.env.PORT) || 7777;
const HERE = dirname(fileURLToPath(import.meta.url));
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** roomCode -> Set<socket> */
const rooms = new Map();
let nextId = 1;

// ---------------------------------------------------------------- websocket

function accept(key) {
  return createHash('sha1').update(key + GUID).digest('base64');
}

/** Encodes one text frame. Server frames are never masked. */
function frame(text) {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x81;                    // FIN + text
  return Buffer.concat([header, payload]);
}

/**
 * Pulls whole frames out of a rolling buffer. Only text and close matter
 * here; the game never sends anything large enough to need continuation.
 */
function drain(state, onText, onClose) {
  for (;;) {
    const buf = state.buf;
    if (buf.length < 2) return;
    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let len = buf[1] & 0x7f;
    let off = 2;
    if (len === 126) {
      if (buf.length < off + 2) return;
      len = buf.readUInt16BE(off);
      off += 2;
    } else if (len === 127) {
      if (buf.length < off + 8) return;
      len = Number(buf.readBigUInt64BE(off));
      off += 8;
    }
    let mask = null;
    if (masked) {
      if (buf.length < off + 4) return;
      mask = buf.subarray(off, off + 4);
      off += 4;
    }
    if (buf.length < off + len) return;

    const payload = Buffer.from(buf.subarray(off, off + len));
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    state.buf = buf.subarray(off + len);

    if (opcode === 0x8) { onClose(); return; }
    if (opcode === 0x1) onText(payload.toString('utf8'));
    // 0x9 ping / 0xA pong are ignored; browsers handle keepalive themselves
  }
}

// ------------------------------------------------------------------- server

const server = createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  const file = url === '/' || url === '/index.html' ? 'index.html' : url.replace(/^\/+/, '');
  // only ever serve the game itself
  if (!/^[\w.-]+$/.test(file)) { res.writeHead(404).end(); return; }
  try {
    const body = await readFile(join(HERE, file));
    const type = file.endsWith('.html') ? 'text/html; charset=utf-8'
      : file.endsWith('.js') ? 'text/javascript'
        : file.endsWith('.css') ? 'text/css' : 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('yok');
  }
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept(key)}\r\n\r\n`
  );
  socket.setNoDelay(true);

  const state = { buf: Buffer.alloc(0) };
  const peer = { socket, id: nextId++, room: null, name: '' };

  const leave = () => {
    if (!peer.room) return;
    const set = rooms.get(peer.room);
    if (set) {
      set.delete(peer);
      for (const other of set) {
        try { other.socket.write(frame(JSON.stringify({ t: 'left', id: peer.id }))); } catch { /* gitti */ }
      }
      if (!set.size) rooms.delete(peer.room);
      console.log(`  · ${peer.name || peer.id} ${peer.room} odasından ayrıldı (${set.size} kişi kaldı)`);
    }
    peer.room = null;
  };

  socket.on('data', (chunk) => {
    state.buf = Buffer.concat([state.buf, chunk]);
    drain(state, (text) => {
      let msg;
      try { msg = JSON.parse(text); } catch { return; }

      if (msg.t === 'join') {
        const code = String(msg.room || '').replace(/\D/g, '').slice(0, 6);
        if (code.length !== 6) return;
        leave();
        peer.room = code;
        peer.name = String(msg.name || '').slice(0, 24);
        if (!rooms.has(code)) rooms.set(code, new Set());
        const set = rooms.get(code);
        // tell the newcomer who is already here, and the room about them
        socket.write(frame(JSON.stringify({
          t: 'welcome', id: peer.id,
          peers: [...set].map((o) => ({ id: o.id, name: o.name }))
        })));
        for (const other of set) {
          try {
            other.socket.write(frame(JSON.stringify({ t: 'joined', id: peer.id, name: peer.name })));
          } catch { /* gitti */ }
        }
        set.add(peer);
        console.log(`  · ${peer.name || peer.id} ${code} odasına katıldı (${set.size} kişi)`);
        return;
      }

      // everything else is relayed to the rest of the room, stamped with who
      if (!peer.room) return;
      const set = rooms.get(peer.room);
      if (!set) return;
      msg.id = peer.id;
      const out = frame(JSON.stringify(msg));
      for (const other of set) {
        if (other === peer) continue;
        try { other.socket.write(out); } catch { /* gitti */ }
      }
    }, () => socket.end());
  });

  socket.on('close', leave);
  socket.on('error', leave);
});

// ------------------------------------------------------------------ address

function lanAddresses() {
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list || []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      out.push(net.address);
    }
  }
  return out;
}

server.listen(PORT, () => {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const addrs = lanAddresses();
  console.log('\n  Ankara Sürüş — co-op sunucusu açık\n');
  if (addrs.length) {
    for (const a of addrs) console.log(`    http://${a}:${PORT}`);
  } else {
    console.log(`    http://localhost:${PORT}   (ağ arayüzü bulunamadı)`);
  }
  console.log(`\n  Aynı ağdaki herkes bu adresi açsın, oyun içinden "CO-OP" deyip`);
  console.log(`  aynı 6 haneli kodu girsin. Örnek kod: ${code}\n`);
});
