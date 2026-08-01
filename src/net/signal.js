/**
 * Signalling.
 *
 * WebRTC connects two devices directly, but they cannot find each other on
 * their own: before any data flows, each side has to hand the other its
 * session description and its candidate addresses. That exchange needs a
 * middleman — and the middleman is the only thing in this game that talks to
 * anyone else's computer.
 *
 * The middleman here is ntfy, a free publish/subscribe service that needs no
 * account and no key. A room code is simply a topic name on it: enter 483920
 * and both devices meet on `anksur-483920-join`. Once the peer connection is
 * up, ntfy is out of the picture entirely — the game's own traffic never goes
 * near it.
 *
 * Two things make it hold up in practice:
 *
 *   * every message goes to two independent servers and both are listened to,
 *     so one being blocked or down does not sink the room. Duplicates are
 *     dropped by id;
 *   * anything over ntfy's message limit is split into numbered pieces and
 *     put back together at the far end, because a session description with a
 *     lot of candidates in it does not fit in one.
 */

const MIRRORS = ['https://ntfy.sh', 'https://ntfy.envs.net'];

/** ntfy caps a message at 4 KB; leave room for the envelope around it. */
const CHUNK = 2400;

let counter = 0;

/** Publishes one object to `topic` on every mirror. */
export async function sigSend(topic, obj) {
  const body = JSON.stringify(obj);
  const key = `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const parts = [];
  for (let i = 0; i < body.length; i += CHUNK) parts.push(body.slice(i, i + CHUNK));

  const results = [];
  for (let i = 0; i < parts.length; i++) {
    const frame = JSON.stringify({ k: key, i, n: parts.length, d: parts[i] });
    for (const host of MIRRORS) {
      results.push(
        fetch(`${host}/${encodeURIComponent(topic)}`, {
          method: 'POST',
          body: frame,
          headers: { Priority: 'high' }
        }).catch(() => null)
      );
    }
  }
  const settled = await Promise.all(results);
  // one mirror answering is enough to call it sent
  return settled.some((r) => r && r.ok);
}

/**
 * Subscribes to `topic` on every mirror.
 * @param {string} topic
 * @param {(obj:any)=>void} onMessage
 * @returns {{close:()=>void, alive:()=>number}} handle
 */
export function sigOpen(topic, onMessage) {
  const sources = [];
  const seen = new Set();
  const pending = new Map();
  let open = 0;

  const take = (raw) => {
    let frame;
    try { frame = JSON.parse(raw); } catch { return; }
    if (!frame || typeof frame.k !== 'string') return;

    // one piece of a split message: hold it until the rest turn up
    let slot = pending.get(frame.k);
    if (!slot) {
      slot = { parts: new Array(frame.n).fill(null), left: frame.n };
      pending.set(frame.k, slot);
      // a half-delivered message must not sit in memory for ever
      setTimeout(() => pending.delete(frame.k), 90000);
    }
    if (slot.parts[frame.i] !== null) return;      // the other mirror got here first
    slot.parts[frame.i] = frame.d;
    slot.left--;
    if (slot.left > 0) return;
    pending.delete(frame.k);

    let obj;
    try { obj = JSON.parse(slot.parts.join('')); } catch { return; }
    onMessage(obj);
  };

  for (const host of MIRRORS) {
    let es;
    try {
      es = new EventSource(`${host}/${encodeURIComponent(topic)}/sse`);
    } catch { continue; }
    es.onopen = () => { open++; };
    es.onerror = () => { /* the other mirror carries on */ };
    es.onmessage = (e) => {
      let env;
      try { env = JSON.parse(e.data); } catch { return; }
      if (env.event !== 'message' || typeof env.message !== 'string') return;
      if (env.id) {
        if (seen.has(env.id)) return;
        seen.add(env.id);
      }
      take(env.message);
    };
    sources.push(es);
  }

  return {
    close() { for (const es of sources) { try { es.close(); } catch { /* zaten kapalı */ } } },
    alive: () => open
  };
}

/** True when this build can reach the outside world at all. */
export function sigAvailable() {
  return typeof EventSource === 'function' && typeof fetch === 'function';
}
