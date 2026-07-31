/**
 * How the two players reach each other.
 *
 * A browser cannot accept incoming connections, so a page opened straight
 * off the disk has no way to be found by another device — there has to be
 * something in the middle. Two backends cover the cases that matter:
 *
 *   WebSocket       the page was served by server.mjs, so it can talk back
 *                   to whoever served it. This is the real LAN case.
 *   BroadcastChannel two tabs in the same browser. No setup at all, and
 *                   genuinely useful for splitscreen on one machine.
 *
 * Both speak the same little message protocol, so the game above does not
 * care which one it got.
 */

const isServed = typeof location !== 'undefined' && /^https?:$/.test(location.protocol);

export function transportKind() {
  return isServed ? 'ws' : 'local';
}

export function transportHint() {
  return isServed
    ? `Sunucu: ${location.host}`
    : 'Dosyadan açıldı — aynı tarayıcıdaki ikinci sekmeyle oynanır';
}

/** Common surface: connect(), send(obj), close(), plus the three callbacks. */
class Base {
  constructor() {
    this.onOpen = () => {};
    this.onMessage = () => {};
    this.onClose = () => {};
    this.id = 0;
  }
}

class WsTransport extends Base {
  constructor(room, name) {
    super();
    this.room = room;
    this.name = name;
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${proto}//${location.host}`);
    this.ws.onopen = () => {
      this.ws.send(JSON.stringify({ t: 'join', room: this.room, name: this.name }));
    };
    this.ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.t === 'welcome') {
        this.id = msg.id;
        this.onOpen(msg);
        return;
      }
      this.onMessage(msg);
    };
    this.ws.onclose = () => this.onClose();
    this.ws.onerror = () => this.onClose();
  }

  send(obj) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  close() { this.ws?.close(); }
}

/**
 * Same-browser transport. Every tab is a peer; there is no server, so the
 * tabs announce themselves and each keeps its own list.
 */
class LocalTransport extends Base {
  constructor(room, name) {
    super();
    this.room = room;
    this.name = name;
    this.id = Math.floor(Math.random() * 1e9);
    this.seen = new Set();
  }

  connect() {
    this.ch = new BroadcastChannel(`ankara-coop-${this.room}`);
    this.ch.onmessage = (e) => {
      const msg = e.data;
      if (!msg || msg.id === this.id) return;

      if (msg.t === 'hello') {
        // answer so the newcomer learns about us too
        if (!this.seen.has(msg.id)) {
          this.seen.add(msg.id);
          this.onMessage({ t: 'joined', id: msg.id, name: msg.name });
        }
        this.ch.postMessage({ t: 'here', id: this.id, name: this.name });
        return;
      }
      if (msg.t === 'here') {
        if (this.seen.has(msg.id)) return;
        this.seen.add(msg.id);
        this.onMessage({ t: 'joined', id: msg.id, name: msg.name });
        return;
      }
      if (msg.t === 'left') this.seen.delete(msg.id);
      this.onMessage(msg);
    };

    // a tab closing should not leave a ghost car parked in the road
    this._bye = () => this.ch?.postMessage({ t: 'left', id: this.id });
    window.addEventListener('pagehide', this._bye);

    this.ch.postMessage({ t: 'hello', id: this.id, name: this.name });
    this.onOpen({ id: this.id, peers: [] });
  }

  send(obj) {
    this.ch?.postMessage({ ...obj, id: this.id });
  }

  close() {
    this._bye?.();
    window.removeEventListener('pagehide', this._bye);
    this.ch?.close();
    this.ch = null;
  }
}

export function createTransport(room, name) {
  return isServed ? new WsTransport(room, name) : new LocalTransport(room, name);
}
