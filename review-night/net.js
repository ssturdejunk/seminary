// net.js: the connection between the board (host) and phones (clients).
// "firebase" mode relays every message through a Firebase Realtime Database,
// so it works on any network, including cellular.
// "peer" mode uses PeerJS direct connections, which often fail on cellular.
// "local" mode uses a BroadcastChannel so tabs in one browser can test the game.
(function () {
  const PREFIX = "srn-review-";
  const PING_MS = 4000, STALE_MS = 13000;
  const cfg = window.RN_CONFIG || {};

  function mode() {
    return new URLSearchParams(location.search).get("net") || cfg.net || "peer";
  }
  function rid() { return Math.random().toString(36).slice(2, 10); }
  const enc = (m) => JSON.stringify(m);
  const dec = (s) => { try { return JSON.parse(s); } catch (e) { return null; } };
  function fbDb() {
    if (typeof firebase === "undefined") throw new Error("firebase-missing");
    const c = cfg.firebase || {};
    if (!c.databaseURL || /PASTE|YOUR/i.test(c.databaseURL)) throw new Error("firebase-config");
    if (!firebase.apps.length) firebase.initializeApp(c);
    return firebase.database();
  }
  const fbStamp = () => (firebase.database.ServerValue ? firebase.database.ServerValue.TIMESTAMP : Date.now());

  // ---------- Host ----------
  // h: { onConnect(id), onDisconnect(id), onMessage(id, msg), onStatus(status, detail) }
  function host(code, h) {
    const links = new Map(); // id -> { send, close, last }
    function touch(id) { const l = links.get(id); if (l) l.last = Date.now(); }
    function add(id, send, close) {
      links.set(id, { send, close, last: Date.now() });
      h.onConnect(id);
    }
    function drop(id) {
      const l = links.get(id);
      if (!l) return;
      links.delete(id);
      try { l.close(); } catch (e) {}
      h.onDisconnect(id);
    }
    function recv(id, msg) {
      touch(id);
      if (msg && msg.__ping) { const l = links.get(id); if (l) l.send({ __pong: 1 }); return; }
      if (msg && msg.__bye) { drop(id); return; }
      h.onMessage(id, msg);
    }
    if (mode() !== "firebase") setInterval(() => {
      const now = Date.now();
      for (const [id, l] of links) if (now - l.last > STALE_MS) drop(id);
    }, 3000);

    let api = {
      send(id, msg) { const l = links.get(id); if (l) try { l.send(msg); } catch (e) {} },
      broadcast(msg) { for (const l of links.values()) try { l.send(msg); } catch (e) {} },
      ids() { return [...links.keys()]; },
      drop
    };

    if (mode() === "firebase") {
      let db;
      try { db = fbDb(); } catch (e) { setTimeout(() => h.onStatus("error", e.message), 0); return api; }
      const room = db.ref("rooms/" + code);
      // Clear leftovers from an earlier game with this code.
      room.child("up").remove(); room.child("down").remove();
      const ensure = (id) => {
        if (!links.has(id)) add(id, (msg) => room.child("down/" + id).set(enc(msg)), () => room.child("down/" + id).remove());
      };
      room.child("clients").on("child_added", (s) => ensure(s.key));
      room.child("clients").on("child_removed", (s) => drop(s.key));
      room.child("up").on("child_added", (s) => {
        const v = s.val(); s.ref.remove();
        if (!v || !v.from) return;
        const msg = dec(v.msg); if (!msg) return;
        ensure(v.from); recv(v.from, msg);
      });
      db.ref(".info/connected").on("value", (s) => {
        if (s.val()) {
          room.child("host").onDisconnect().remove();
          room.child("host").set({ on: true, at: fbStamp() });
          h.onStatus("online");
        } else h.onStatus("reconnecting");
      });
      return api;
    }

    if (mode() === "local") {
      const ch = new BroadcastChannel("rn-" + code);
      ch.onmessage = (e) => {
        const m = e.data;
        if (!m || m.to !== "host") return;
        if (!links.has(m.from)) {
          if (m.msg && m.msg.__bye) return;
          add(m.from, (msg) => ch.postMessage({ to: m.from, msg }), () => {});
        }
        recv(m.from, m.msg);
      };
      setTimeout(() => h.onStatus("online"), 0);
      return api;
    }

    let peer, stopped = false;
    function start(attempt) {
      peer = new Peer(PREFIX + code, cfg.peerOptions || {});
      peer.on("open", () => h.onStatus("online"));
      peer.on("connection", (conn) => {
        // Messages can arrive before PeerJS marks the connection open, so
        // replies wait in a queue until it is ready instead of being dropped.
        const queue = [];
        const flush = () => { while (conn.open && queue.length) { try { conn.send(queue.shift()); } catch (e) {} } };
        const send = (msg) => { if (conn.open && !queue.length) conn.send(msg); else { queue.push(msg); if (queue.length > 50) queue.shift(); } };
        if (links.has(conn.peer)) drop(conn.peer);
        add(conn.peer, send, () => conn.close());
        conn.on("open", flush);
        conn.on("data", (d) => { flush(); recv(conn.peer, d); });
        conn.on("close", () => drop(conn.peer));
        conn.on("error", () => {});
      });
      peer.on("disconnected", () => {
        if (stopped) return;
        h.onStatus("reconnecting");
        setTimeout(() => { try { if (!peer.destroyed) peer.reconnect(); } catch (e) {} }, 1500);
      });
      peer.on("error", (err) => {
        const t = err && err.type;
        if (t === "peer-unavailable") return;
        h.onStatus("error", t);
        if (t === "unavailable-id" || t === "network" || t === "server-error" ||
            t === "socket-error" || t === "socket-closed") {
          try { peer.destroy(); } catch (e) {}
          if (attempt < 20) setTimeout(() => start(attempt + 1), 3000);
        }
      });
    }
    if (typeof Peer === "undefined") {
      setTimeout(() => h.onStatus("error", "peerjs-missing"), 0);
    } else start(0);
    return api;
  }

  // ---------- Client (phone) ----------
  // h: { onMessage(msg), onStatus(status) } status: connecting | connected | lost | noroom
  function client(code, h) {
    let last = Date.now(), connected = false, closed = false;
    let sendRaw = () => {}, reconnect = () => {};

    function setConnected(v) {
      if (v === connected) return;
      connected = v;
      h.onStatus(v ? "connected" : "lost");
    }
    function recv(msg) {
      last = Date.now();
      if (!connected) setConnected(true);
      if (msg && msg.__pong) return;
      h.onMessage(msg);
    }
    if (mode() !== "firebase") setInterval(() => {
      if (closed) return;
      sendRaw({ __ping: 1 });
      if (Date.now() - last > STALE_MS) { setConnected(false); last = Date.now(); reconnect(); }
    }, PING_MS);
    document.addEventListener("visibilitychange", () => {
      if (mode() !== "firebase" && document.visibilityState === "visible" && Date.now() - last > PING_MS * 2) reconnect();
    });

    h.onStatus("connecting");
    if (mode() === "firebase") {
      let db;
      try { db = fbDb(); } catch (e) { setTimeout(() => h.onStatus("lost"), 0); return { send() {}, isConnected: () => false, close() {} }; }
      const me = "c-" + rid();
      const room = db.ref("rooms/" + code), pres = room.child("clients/" + me);
      db.ref(".info/connected").on("value", (s) => {
        if (s.val()) { pres.onDisconnect().remove(); pres.set(true); setConnected(true); }
        else setConnected(false);
      });
      room.child("down/" + me).on("value", (s) => { const v = s.val(); if (v) { const m = dec(v); if (m) recv(m); } });
      room.child("host").on("value", (s) => { if (!s.exists()) h.onStatus("noroom"); });
      sendRaw = (msg) => { room.child("up").push({ from: me, msg: enc(msg) }); };
      window.addEventListener("pagehide", () => pres.remove());
      return {
        send: (msg) => sendRaw(msg),
        isConnected: () => connected,
        close: () => { closed = true; room.child("down/" + me).off(); room.child("host").off(); pres.remove(); }
      };
    }
    if (mode() === "local") {
      const me = "c-" + rid();
      const ch = new BroadcastChannel("rn-" + code);
      ch.onmessage = (e) => { if (e.data && e.data.to === me) recv(e.data.msg); };
      sendRaw = (msg) => ch.postMessage({ to: "host", from: me, msg });
      reconnect = () => sendRaw({ __ping: 1 });
      window.addEventListener("pagehide", () => sendRaw({ __bye: 1 }));
      sendRaw({ __ping: 1 });
    } else {
      let peer = null, conn = null;
      const open = () => {
        if (closed) return;
        try { if (conn) conn.close(); } catch (e) {}
        if (!peer || peer.destroyed) {
          peer = new Peer(cfg.peerOptions || {});
          peer.on("open", connectToHost);
          peer.on("disconnected", () => { try { peer.reconnect(); } catch (e) {} });
          peer.on("error", (err) => {
            if (err && err.type === "peer-unavailable") h.onStatus("noroom");
            setTimeout(open, 3000);
          });
        } else if (peer.disconnected) {
          try { peer.reconnect(); } catch (e) { peer.destroy(); }
          setTimeout(open, 1500);
        } else connectToHost();
      };
      function connectToHost() {
        conn = peer.connect(PREFIX + code, { reliable: true });
        const c = conn;
        c.on("open", () => { if (c === conn) { last = Date.now(); setConnected(true); h.onOpen && h.onOpen(); } });
        c.on("data", (d) => { if (c === conn) recv(d); });
        c.on("close", () => { if (c === conn) setConnected(false); });
      }
      sendRaw = (msg) => { if (conn && conn.open) try { conn.send(msg); } catch (e) {} };
      reconnect = open;
      window.addEventListener("pagehide", () => sendRaw({ __bye: 1 }));
      if (typeof Peer === "undefined") h.onStatus("lost"); else open();
    }
    return {
      send: (msg) => sendRaw(msg),
      isConnected: () => connected,
      close: () => { closed = true; sendRaw({ __bye: 1 }); }
    };
  }

  window.RN_NET = { host, client, mode };
})();
