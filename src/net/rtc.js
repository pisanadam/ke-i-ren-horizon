import { sigSend, sigOpen } from './signal.js';

/**
 * Peer-to-peer co-op.
 *
 * There is no game server. Two phones open the same single HTML file, one of
 * them puts a six-digit code on screen, the other types it in, and from then
 * on the cars, the positions and the chatter travel straight between the two
 * devices over a WebRTC data channel. Nothing about the game goes through
 * anybody else's machine.
 *
 * The one thing that cannot be done peer-to-peer is the introduction — see
 * signal.js for how the code turns into a meeting point. Roles there are
 * fixed: **the guest offers and the host answers**, which also settles who
 * creates the data channel, since in WebRTC that has to be the offering side.
 *
 * Topology is a star. Guests talk only to the host; the host repeats what it
 * hears to everybody else. Two guests never open a connection to each other,
 * which keeps the number of connections linear and the signalling simple.
 */

const RTC_CONFIG = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:global.stun.twilio.com:3478' }
  ]
};

const PREFIX = 'anksur';
const OFFER_TRIES = 12;
const OFFER_EVERY = 2000;

const rid = () => Math.floor(Math.random() * 1e9) + 1;

/** Waits for ICE gathering to finish, for the copy-and-paste fallback. */
export function waitIce(pc, timeout = 3000) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = () => { if (pc.iceGatheringState === 'complete') done(); };
    pc.addEventListener('icegatheringstatechange', check);
    setTimeout(done, timeout);
  });
}

const pack = (obj) => btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
const unpack = (text) => JSON.parse(decodeURIComponent(escape(atob(text.trim()))));

export { pack as packSdp, unpack as unpackSdp };

/**
 * Same surface as the other transports: connect(), send(obj), close(), and
 * the three callbacks. `id` on an incoming message is who sent it.
 */
export class RtcTransport {
  /**
   * @param {string} room six-digit code
   * @param {string} name display name
   * @param {boolean} isHost true to answer offers, false to make one
   * @param {{send:Function, open:Function}} [signal] swappable so the
   *   handshake can be exercised without a live signalling service
   */
  constructor(room, name, isHost, signal) {
    this.room = String(room);
    this.name = name;
    this.isHost = !!isHost;
    this.sigSend = signal?.send ?? sigSend;
    this.sigOpen = signal?.open ?? sigOpen;
    this.id = rid();
    this.conns = new Map();       // peerId -> { pc, ch, name }
    this.onOpen = () => {};
    this.onMessage = () => {};
    this.onClose = () => {};
    this.onStatus = () => {};
    this._sigs = [];
    this._timers = [];
    this._closed = false;
  }

  get topic() { return `${PREFIX}-${this.room}`; }

  connect() {
    if (this.isHost) this._host();
    else this._guest();
  }

  // ------------------------------------------------------------------ host
  _host() {
    this.onStatus('oda açık — kodu arkadaşına ver');
    // The host is reachable the moment the room is listening; guests can
    // trickle in later without anything else having to happen.
    this.onOpen({ id: this.id, peers: [] });

    this._sigs.push(this.sigOpen(`${this.topic}-join`, async (msg) => {
      if (this._closed || msg.t !== 'offer' || !msg.from) return;
      const peerId = msg.from;

      // The guest re-offers until it hears back. If it is repeating because
      // our answer went missing, sending the same answer again is exactly
      // what it needs — dropping the repeat leaves the room stuck for good.
      const known = this.conns.get(peerId);
      if (known) {
        if (known.answer && known.ch?.readyState !== 'open') {
          this.sigSend(`${this.topic}-ans-${peerId}`, {
            t: 'answer', from: this.id, name: this.name, sdp: known.answer
          });
        }
        return;
      }

      const conn = this._makePeer(peerId, false);
      conn.name = msg.name;
      try {
        await conn.pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
        const answer = await conn.pc.createAnswer();
        await conn.pc.setLocalDescription(answer);
        conn.answer = answer.sdp;
        await this.sigSend(`${this.topic}-ans-${peerId}`, {
          t: 'answer', from: this.id, name: this.name, sdp: answer.sdp
        });
      } catch {
        this._drop(peerId);
        return;
      }

      this._trickle(conn, `${this.topic}-h2-${peerId}`);
      this._sigs.push(this.sigOpen(`${this.topic}-g2-${peerId}`, (m) => this._takeIce(conn, m)));
    }));
  }

  /**
   * Publishes this side's candidates, and keeps republishing the whole set
   * until the connection is up.
   *
   * Trickling each candidate once is fine over a reliable channel, but the
   * signalling here is a public notification service and a lost candidate has
   * no second chance. Re-sending the accumulated list costs one small message
   * every couple of seconds and turns a lost packet into a delay rather than
   * a failed room.
   */
  _trickle(conn, topic) {
    conn.cands = [];
    let sends = 0;
    const publish = () => {
      if (this._closed || !conn.cands.length) return;
      this.sigSend(topic, { t: 'ice', cs: conn.cands });
    };
    conn.pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      conn.cands.push(e.candidate.toJSON());
      publish();
    };
    const again = () => {
      if (this._closed || sends++ >= 6) return;
      if (conn.pc.connectionState === 'connected') return;
      publish();
      this._timers.push(setTimeout(again, 1800));
    };
    this._timers.push(setTimeout(again, 1800));
  }

  _takeIce(conn, msg) {
    if (msg.t !== 'ice') return;
    conn.seenIce = conn.seenIce || new Set();
    for (const c of msg.cs || (msg.c ? [msg.c] : [])) {
      const key = `${c.candidate}|${c.sdpMid}`;
      if (conn.seenIce.has(key)) continue;
      conn.seenIce.add(key);
      conn.pc.addIceCandidate(c).catch(() => {});
    }
  }

  // ----------------------------------------------------------------- guest
  _guest() {
    this.onStatus('odaya bağlanılıyor…');
    const hostId = 0;              // one host, so it needs no real id yet
    const conn = this._makePeer(hostId, true);

    this._sigs.push(this.sigOpen(`${this.topic}-ans-${this.id}`, async (msg) => {
      if (this._closed || msg.t !== 'answer' || conn.pc.currentRemoteDescription) return;
      conn.name = msg.name;
      // the host's real id, so its car is filed under the right key
      this._rename(hostId, msg.from ?? hostId);
      try {
        await conn.pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
      } catch { /* eski cevap */ }
    }));
    this._sigs.push(this.sigOpen(`${this.topic}-h2-${this.id}`, (m) => this._takeIce(conn, m)));
    this._trickle(conn, `${this.topic}-g2-${this.id}`);

    (async () => {
      const offer = await conn.pc.createOffer();
      await conn.pc.setLocalDescription(offer);
      // Kept up because the host may not have opened the room yet, and
      // because a publish can be lost. It stops as soon as anyone answers.
      let tries = 0;
      const push = () => {
        if (this._closed || tries++ >= OFFER_TRIES || this.conns.get(hostId)?.ch?.readyState === 'open') return;
        if (conn.pc.currentRemoteDescription) return;
        this.sigSend(`${this.topic}-join`, {
          t: 'offer', from: this.id, name: this.name, sdp: conn.pc.localDescription.sdp
        });
        this._timers.push(setTimeout(push, OFFER_EVERY));
      };
      push();
    })().catch(() => this.onStatus('bağlantı kurulamadı'));
  }

  // ----------------------------------------------------------------- peers
  _makePeer(peerId, mkChannel) {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    const conn = { pc, ch: null, name: '' };
    this.conns.set(peerId, conn);

    if (mkChannel) {
      // WebRTC rule: the side that offers opens the channel
      conn.ch = pc.createDataChannel('ank', { ordered: false, maxRetransmits: 0 });
      this._bind(peerId, conn.ch);
    } else {
      pc.ondatachannel = (e) => { conn.ch = e.channel; this._bind(peerId, e.channel); };
    }

    // `disconnected` is not fatal — a phone switching from wifi to mobile data
    // passes through it and comes back. Only a state it cannot return from
    // should take the peer off the road.
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this._drop(peerId);
    };
    return conn;
  }

  _rename(oldId, newId) {
    if (oldId === newId || !this.conns.has(oldId)) return;
    const conn = this.conns.get(oldId);
    this.conns.delete(oldId);
    this.conns.set(newId, conn);
    conn.ch && (conn.ch._peer = newId);
  }

  _bind(peerId, ch) {
    ch._peer = peerId;
    ch.onopen = () => {
      const who = ch._peer ?? peerId;
      if (this.isHost) {
        // Tell the newcomer who is already here. Announcing *them* waits for
        // their `hello`, which is both when the name is known and the only
        // place it happens, so nobody hears about the same arrival twice.
        for (const [id, c] of this.conns) {
          if (id === who || c.ch?.readyState !== 'open') continue;
          this._raw(who, { t: 'joined', id, name: c.name });
        }
        this._raw(who, { t: 'joined', id: this.id, name: this.name });
        this.onStatus(`bağlı · ${this.conns.size + 1} oyuncu`);
      } else {
        this.onStatus('bağlandı');
        this.onOpen({ id: this.id, peers: [] });
        this._raw(who, { t: 'hello', id: this.id, name: this.name });
      }
    };

    ch.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      const who = ch._peer ?? peerId;

      if (this.isHost) {
        if (msg.t === 'hello') {
          const conn = this.conns.get(who);
          if (conn) conn.name = msg.name;
          this.onMessage({ t: 'joined', id: who, name: msg.name });
          this._broadcast({ t: 'joined', id: who, name: msg.name }, who);
          return;
        }
        // Star topology: everything a guest says is repeated to the others,
        // stamped with who actually said it.
        const tagged = { ...msg, id: who };
        this._broadcast(tagged, who);
        this.onMessage(tagged);
        return;
      }
      this.onMessage(msg);
    };

    ch.onclose = () => this._drop(ch._peer ?? peerId);
  }

  _drop(peerId) {
    const conn = this.conns.get(peerId);
    if (!conn) return;
    this.conns.delete(peerId);
    try { conn.pc.close(); } catch { /* zaten kapalı */ }
    if (this.isHost) {
      this._broadcast({ t: 'left', id: peerId });
      this.onMessage({ t: 'left', id: peerId });
      this.onStatus(`bağlı · ${this.conns.size + 1} oyuncu`);
    } else if (!this._closed) {
      this.onStatus('ev sahibiyle bağlantı koptu');
      this.onClose();
    }
  }

  _raw(peerId, obj) {
    const ch = this.conns.get(peerId)?.ch;
    if (ch?.readyState === 'open') {
      try { ch.send(JSON.stringify(obj)); } catch { /* tampon dolu */ }
    }
  }

  _broadcast(obj, except) {
    for (const [id] of this.conns) {
      if (id !== except) this._raw(id, obj);
    }
  }

  send(obj) {
    if (this.isHost) this._broadcast({ ...obj, id: this.id });
    else this._broadcast(obj);
  }

  close() {
    this._closed = true;
    for (const t of this._timers) clearTimeout(t);
    this._timers = [];
    for (const s of this._sigs) s.close();
    this._sigs = [];
    for (const [, c] of this.conns) {
      try { c.pc.close(); } catch { /* zaten kapalı */ }
    }
    this.conns.clear();
  }

  // ------------------------------------------------- copy-and-paste rescue
  /**
   * When the signalling service is blocked — school and office networks do
   * this — the same two descriptions can simply be sent to each other by
   * hand. There is no trickle here: gathering has to finish first so every
   * candidate is inside the one block of text.
   */
  async manualOffer() {
    const conn = this._makePeer(0, true);
    conn.pc.onicecandidate = null;
    const offer = await conn.pc.createOffer();
    await conn.pc.setLocalDescription(offer);
    await waitIce(conn.pc);
    this._manual = conn;
    return pack({ n: this.name, i: this.id, s: conn.pc.localDescription.sdp, t: 'o' });
  }

  async manualAccept(text) {
    const got = unpack(text);
    if (got.t === 'o') {
      // we are the host: answer the offer that was pasted in
      const peerId = got.i || rid();
      const conn = this._makePeer(peerId, false);
      conn.name = got.n;
      conn.pc.onicecandidate = null;
      await conn.pc.setRemoteDescription({ type: 'offer', sdp: got.s });
      const answer = await conn.pc.createAnswer();
      await conn.pc.setLocalDescription(answer);
      await waitIce(conn.pc);
      this.isHost = true;
      this.onOpen({ id: this.id, peers: [] });
      return pack({ n: this.name, i: this.id, s: conn.pc.localDescription.sdp, t: 'a' });
    }
    // we are the guest: finish the connection we already offered
    const conn = this._manual;
    if (!conn) throw new Error('önce kendi kodunu üret');
    conn.name = got.n;
    this._rename(0, got.i || 0);
    await conn.pc.setRemoteDescription({ type: 'answer', sdp: got.s });
    return null;
  }
}
