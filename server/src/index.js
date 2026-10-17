// Buddy multiplayer rooms: one Durable Object per invite code, in a Cloudflare data center near the players. The host's
// game still runs the lobby and the race; a room only passes messages between the host and up to three friends
// (WebSocket hibernation: an idle room costs nothing).
//   host:   wss://…/room/CODE?role=h          sends { to: friendId, m } or { m } (everyone)
//   friend: wss://…/room/CODE?role=g&id=ID    sends { m }  → the host receives { f: ID, m }
export default {
  async fetch(req, env) {
    const url = new URL(req.url), m = url.pathname.match(/^\/room\/([A-Za-z0-9]{4,8})$/);
    if (!m) return new Response('Buddy rooms are up', { headers: { 'access-control-allow-origin': '*' } });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    return env.ROOMS.get(env.ROOMS.idFromName(m[1].toUpperCase())).fetch(req);
  },
};

export class Room {
  constructor(state) { this.state = state; }
  async fetch(req) {
    const url = new URL(req.url), role = url.searchParams.get('role') === 'h' ? 'h' : 'g';
    const id = (url.searchParams.get('id') || crypto.randomUUID()).replace(/[^\w-]/g, '').slice(0, 16);
    if (role === 'g' && this.state.getWebSockets('g').length >= 7) return new Response('Room is full', { status: 429 });
    const [client, server] = Object.values(new WebSocketPair());
    if (role === 'h') for (const old of this.state.getWebSockets('h')) try { old.close(4000, 'Another host joined'); } catch {}
    this.state.acceptWebSocket(server, [role, 'id:' + id]);
    server.serializeAttachment({ role, id });
    return new Response(null, { status: 101, webSocket: client });
  }
  host() { return this.state.getWebSockets('h')[0]; }
  webSocketMessage(ws, data) {
    const me = ws.deserializeAttachment();
    let msg; try { msg = JSON.parse(data); } catch { return; }
    if (msg.t === 'time') return ws.send(JSON.stringify({ t: 'time', c: msg.c, s: Date.now() })); // a clock to sync to
    if (me.role === 'g') {
      const h = this.host();
      if (h) h.send(JSON.stringify({ f: me.id, m: msg.m }));
    } else {
      const out = JSON.stringify({ m: msg.m });
      for (const g of msg.to ? this.state.getWebSockets('id:' + msg.to) : this.state.getWebSockets('g')) try { g.send(out); } catch {}
    }
  }
  webSocketClose(ws) {
    const me = ws.deserializeAttachment();
    if (me.role === 'g') { const h = this.host(); if (h) try { h.send(JSON.stringify({ f: me.id, m: { t: 'bye' } })); } catch {} }
    else for (const g of this.state.getWebSockets('g')) try { g.send(JSON.stringify({ m: { t: 'bye' } })); } catch {}
  }
  webSocketError(ws) { this.webSocketClose(ws); }
}
