// play.js: the phone. Shows whatever the board says this player should see,
// and sends back answers, fake answers, drawings, and wagers.
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const app = $("#app");
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const letter = (i) => String.fromCharCode(65 + i);
  const qs = new URLSearchParams(location.search);
  const modPin = qs.get("mod");
  // In local test mode every tab is its own phone, so identity lives in sessionStorage.
  const area = () => (RN_NET.mode() === "local" ? sessionStorage : localStorage);
  const store = {
    get(k) { try { return area().getItem(k); } catch (e) { return null; } },
    set(k, v) { try { area().setItem(k, v); } catch (e) {} }
  };

  let pid = store.get("rn-pid");
  if (!pid) { pid = "p-" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36); store.set("rn-pid", pid); }
  let room = (qs.get("room") || "").toUpperCase().replace(/[^A-Z]/g, "");
  let name = store.get("rn-name") || "";
  let client = null, view = null, sig = "", gotView = false;
  let tEnd = 0, tTotal = 0, helloTimer = null;
  let picked = null; // optimistic lock for the current key

  // ---------- connection ----------
  function connect(code) {
    if (client) client.close();
    room = code; gotView = false; view = null; sig = "";
    store.set("rn-room", room);
    if (!modPin) history.replaceState(null, "", "?" + new URLSearchParams(Object.assign({ room }, qs.get("net") ? { net: qs.get("net") } : {})).toString());
    showMessage("Connecting to room " + room + "…", "");
    client = RN_NET.client(room, {
      onStatus(st) {
        const c = $("#conn");
        if (st === "connected") {
          c.classList.add("hidden");
          const hello = () => { if (modPin) client.send({ t: "mod", pin: modPin }); else client.send({ t: "join", pid, name }); };
          hello();
          // If the board's reply goes missing, ask again until a screen arrives.
          clearInterval(helloTimer);
          helloTimer = setInterval(() => { if (gotView) clearInterval(helloTimer); else hello(); }, 2500);
        } else if (st === "lost") {
          if (gotView) { c.textContent = "Reconnecting…"; c.classList.remove("hidden"); }
        } else if (st === "noroom" && !gotView) {
          showJoin("No game is open with code " + room + ". Check the code on the screen.");
        }
      },
      onMessage(m) {
        if (!m || !m.v) return;
        gotView = true;
        if (m.v === "modbad") return showMessage("That moderator code didn't work.", "Scan the code on the board's setup screen again.");
        render(m);
      }
    });
  }

  // ---------- join ----------
  function showJoin(err) {
    $("#top").classList.add("hidden"); $("#tbar").classList.add("hidden");
    sig = "join";
    app.innerHTML = `<div class="h">Review Night</div>
      <label class="f" for="jc">Room code</label><input id="jc" type="text" inputmode="text" autocapitalize="characters" autocomplete="off" maxlength="4" value="${esc(room)}">
      <label class="f" for="jn">Your name</label><input id="jn" type="text" autocomplete="given-name" maxlength="16" value="${esc(name)}">
      <div class="err">${esc(err || "")}</div>
      <button id="jb" class="primary" style="width:100%;margin-top:1em;padding:1em">Join</button>`;
    const go = () => {
      const c = $("#jc").value.toUpperCase().replace(/[^A-Z]/g, ""), n = $("#jn").value.trim();
      if (c.length !== 4) return showJoin("Enter the 4-letter code from the screen.");
      if (!n) return showJoin("Enter your name so the class knows who you are.");
      name = n; store.set("rn-name", name);
      connect(c);
    };
    $("#jb").onclick = go;
    $("#jn").onkeydown = (e) => { if (e.key === "Enter") go(); };
    (room ? $("#jn") : $("#jc")).focus();
  }
  function showMessage(h, sub) {
    sig = "msg:" + h;
    app.innerHTML = `<div class="h">${esc(h)}</div><div class="sub">${esc(sub || "")}</div>`;
  }

  // ---------- rendering ----------
  function header(m) {
    const t = $("#top");
    if (m.v === "mod") { t.classList.remove("hidden"); t.innerHTML = `<span class="nm">Moderator, room ${esc(room)}</span>`; return; }
    if (!m.me) { t.classList.add("hidden"); return; }
    t.classList.remove("hidden");
    t.innerHTML = `<span class="dot" style="background:${m.me.color}"></span><span class="nm">${esc(m.me.name)}${m.me.role === "audience" ? ' <span class="muted">(audience)</span>' : ""}</span><span class="rk">${ordinal(m.me.rank)} of ${m.me.of}</span><span class="sc">${m.me.score}</span>`;
  }
  function ordinal(n) { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

  function render(m) {
    const prevKey = view && view.key;
    view = m;
    if (m.key !== prevKey) picked = null;
    header(m);
    if (m.total) { tEnd = Date.now() + m.left; tTotal = m.total; $("#tbar").classList.remove("hidden"); }
    else { tEnd = 0; $("#tbar").classList.add("hidden"); }

    const sticky = ["write", "draw", "wager"].includes(m.v);
    const s = sticky ? m.key + ":" + m.v : JSON.stringify(Object.assign({}, m, { me: 0, left: 0, total: 0 }));
    if (s === sig) { if (sticky) patch(m); return; }
    sig = s;
    const fn = views[m.v] || views.wait;
    fn(m);
  }

  const views = {
    wait(m) { app.innerHTML = `<div class="h">${esc(m.msg || "Watch the screen.")}</div><div class="sub">${esc(m.sub || "")}</div>`; },
    removed() {
      $("#top").classList.add("hidden");
      app.innerHTML = `<div class="h">You've been removed from this game.</div><div class="sub">Talk to your teacher if this was a mistake.</div>`;
    },
    end(m) { app.innerHTML = `<div class="result"><div class="ok y">${esc(m.msg)}</div><div class="sub" style="margin-top:1em">Final score: ${m.me.score}</div></div>`; },
    choose(m) {
      const lock = m.picked != null ? m.picked : picked;
      app.innerHTML = `<div class="p">${esc(m.prompt)}</div>${m.sub ? `<div class="sub">${esc(m.sub)}</div>` : ""}
        <div class="choices ${lock != null ? "locked" : ""}">${m.choices.map((c, i) => `<button data-i="${i}" class="${lock === i ? "on" : ""}"><span class="k">${letter(i)}</span><span>${esc(c)}</span></button>`).join("")}</div>
        ${lock != null ? `<div class="sent">Locked in.</div>` : ""}`;
      app.querySelectorAll(".choices button").forEach((b) => b.onclick = () => {
        if ((m.picked != null) || picked != null) return;
        picked = Number(b.dataset.i);
        client.send({ t: "ans", key: m.key, v: picked });
        sig = ""; render(Object.assign({}, m, { picked }));
      });
    },
    fav(m) {
      app.innerHTML = `<div class="p">Got it. Which drawing is your favorite?</div><div class="sub">Your favorite earns its artist a bonus.</div>
        <div class="choices">${Array.from({ length: m.nfav }, (_, i) => `<button data-i="${i}"><span class="k">${letter(i)}</span><span>Drawing ${letter(i)}</span></button>`).join("")}
        <button data-i="-1" class="ghost"><span>Skip</span></button></div>`;
      app.querySelectorAll(".choices button").forEach((b) => b.onclick = () => {
        client.send({ t: "fav", key: m.key, v: Number(b.dataset.i) });
        app.innerHTML = `<div class="h">Thanks.</div><div class="sub">Watch the screen.</div>`;
      });
    },
    write(m) {
      app.innerHTML = `<div class="sub">Write a fake answer that sounds real.</div><div class="p">${esc(m.prompt)}</div>
        <input id="wi" type="text" maxlength="${m.max}" autocomplete="off" placeholder="Your fake answer">
        <button id="wb" class="primary" style="width:100%;margin-top:.8em;padding:.9em">Send fake answer</button>
        <div id="wst"></div>`;
      const send = () => { const v = $("#wi").value.trim(); if (!v) return; client.send({ t: "text", key: m.key, v }); $("#wst").innerHTML = `<div class="muted">Sending…</div>`; };
      $("#wb").onclick = send;
      $("#wi").onkeydown = (e) => { if (e.key === "Enter") send(); };
      if (m.sent) $("#wi").value = m.sent;
      patch(m);
    },
    draw(m) {
      app.innerHTML = `<div class="sub">Draw this story. No words or letters.</div><div class="p">${esc(m.story)}</div>
        <canvas id="pad" class="pad" width="640" height="640"></canvas>
        <div class="tools" id="tools"></div>
        <button id="db" class="primary" style="width:100%;padding:.9em">Send drawing</button>
        <div id="dst"></div>`;
      pad.attach($("#pad"), $("#tools"), m.key);
      $("#db").onclick = () => {
        const img = pad.exportImage();
        if (!img) { $("#dst").innerHTML = `<div class="err">Draw something first.</div>`; return; }
        client.send({ t: "img", key: m.key, v: img });
        $("#dst").innerHTML = `<div class="muted">Sending…</div>`;
      };
      patch(m);
    },
    wager(m) {
      const start = m.wager != null ? m.wager : 0;
      app.innerHTML = `<div class="sub">Final question</div><div class="h">${esc(m.category)}</div>
        <div class="sub">Wager up to ${m.max}. A right answer adds it, a wrong answer subtracts it.</div>
        <div class="wager" id="wv">${start}</div>
        <input id="wr" type="range" min="0" max="${m.max}" step="10" value="${start}" aria-label="Wager amount">
        <div class="quick"><button data-f="0">Nothing</button><button data-f="0.5">Half</button><button data-f="1">All of it</button></div>
        <button id="wl" class="primary" style="width:100%;padding:.9em">Lock in wager</button><div id="wst"></div>`;
      const r = $("#wr"), show = () => ($("#wv").textContent = r.value);
      r.oninput = show;
      app.querySelectorAll(".quick button").forEach((b) => b.onclick = () => { r.value = Math.round(m.max * Number(b.dataset.f) / 10) * 10; if (b.dataset.f === "1") r.value = m.max; show(); });
      $("#wl").onclick = () => { client.send({ t: "wager", key: m.key, v: Number(r.value) }); $("#wst").innerHTML = `<div class="muted">Sending…</div>`; };
      patch(m);
    },
    result(m) {
      const g = m.gain || 0;
      const ok = m.ok === true ? `<div class="ok y">Correct</div>` : m.ok === false ? `<div class="ok n">Not this time</div>` : `<div class="ok">${esc(m.msg || "")}</div>`;
      app.innerHTML = `<div class="result">${ok}<div class="gain ${g < 0 ? "neg" : ""}" style="margin-top:.3em">${g > 0 ? "+" : ""}${g}</div>
        ${m.answer && m.ok !== true ? `<div class="sub" style="margin-top:1em">Answer: <b style="color:var(--paper)">${esc(m.answer)}</b></div>` : ""}
        ${m.note ? `<div class="sub">${esc(m.note)}</div>` : ""}</div>`;
    },
    mod(m) {
      const subs = m.subs.map((s) => `<div class="sub-row ${s.hidden ? "off" : ""}">${s.img ? `<img src="${s.img}" alt="">` : ""}<div class="t"><b>${esc(s.name)}</b> <span class="muted">set ${s.set}</span><br>${esc(s.text)}</div>
        <button data-c="${s.hidden ? "show" : "hide"}" data-p="${esc(s.pid)}">${s.hidden ? "Show" : "Hide"}</button></div>`).join("");
      const ps = m.players.map((p) => `<div class="sub-row"><div class="t"><b>${esc(p.name)}</b> <span class="muted">${p.score}${p.role === "audience" ? ", audience" : ""}${p.on ? "" : ", offline"}</span></div>
        <button class="ghost" data-c="remove" data-p="${esc(p.pid)}">Remove</button></div>`).join("");
      app.innerHTML = `<div class="mod"><div class="sub">${esc(m.where)}</div>
        <div class="acts">${m.label ? `<button class="primary" data-c="next">${esc(m.label)}</button>` : ""}
          ${m.timed ? `<button data-c="add">+15 sec</button>` : ""}${m.canSkip ? `<button class="ghost" data-c="skip">Skip round</button>` : ""}</div>
        ${m.subs.length ? `<h3>Submissions</h3>${subs}` : ""}
        <h3>Players (${m.players.length})</h3>${ps || `<div class="muted">No one has joined yet.</div>`}</div>`;
      app.querySelectorAll("button[data-c]").forEach((b) => b.onclick = () => {
        const c = b.dataset.c;
        if (c === "remove" && !confirmInline(b)) return;
        if (c === "skip" && !confirmInline(b)) return;
        client.send({ t: "modcmd", pin: modPin, c, pid: b.dataset.p });
      });
    }
  };
  // Two-tap confirm for risky moderator buttons, since browser dialogs can be blocked.
  function confirmInline(b) {
    if (b.dataset.armed) return true;
    b.dataset.armed = "1"; const t = b.textContent; b.textContent = "Tap again";
    setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = t; } }, 2500);
    return false;
  }
  function patch(m) {
    if (m.v === "write") {
      const st = $("#wst"); if (!st) return;
      st.innerHTML = m.error ? `<div class="err">${esc(m.error)}</div>` : m.sent ? `<div class="sent">Sent: “${esc(m.sent)}”. You can change it until time runs out.</div>` : "";
    } else if (m.v === "draw") {
      const st = $("#dst"); if (!st) return;
      st.innerHTML = m.error ? `<div class="err">${esc(m.error)}</div>` : m.sent ? `<div class="sent">Drawing sent. You can keep drawing and send again until time runs out.</div>` : "";
    } else if (m.v === "wager") {
      const st = $("#wst"); if (!st) return;
      st.innerHTML = m.wager != null ? `<div class="sent">Wager locked at ${m.wager}. You can change it until time runs out.</div>` : "";
    }
  }

  // ---------- drawing pad ----------
  const pad = (function () {
    const COLORS = ["#1B1B1B", "#D7263D", "#1E6FD9", "#2E9E4F", "#8B5A2B", "#F2B705"];
    let cv, ctx, strokes = [], cur = null, color = COLORS[0], size = 8, key = null;
    function redraw() {
      ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      for (const s of strokes) {
        ctx.strokeStyle = s.c; ctx.lineWidth = s.w; ctx.beginPath();
        s.p.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        if (s.p.length === 1) ctx.lineTo(s.p[0][0] + 0.1, s.p[0][1]);
        ctx.stroke();
      }
    }
    function pos(e) { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; }
    function tools(el) {
      el.innerHTML = COLORS.map((c) => `<button class="sw ${c === color && size !== 40 ? "on" : ""}" data-c="${c}" style="background:${c}" aria-label="Color"></button>`).join("") +
        `<button class="t" data-s="1">${size === 8 ? "Thick" : "Thin"}</button><button class="t" data-e="1">Eraser</button><button class="t" data-u="1">Undo</button><button class="t" data-x="1">Clear</button>`;
      el.querySelectorAll("button").forEach((b) => b.onclick = () => {
        if (b.dataset.c) { color = b.dataset.c; if (size === 40) size = 8; }
        else if (b.dataset.s) size = size === 8 ? 18 : 8;
        else if (b.dataset.e) { color = "#FFFFFF"; size = 40; }
        else if (b.dataset.u) { strokes.pop(); redraw(); }
        else if (b.dataset.x) { if (b.dataset.armed) { strokes = []; redraw(); } else { b.dataset.armed = 1; b.textContent = "Tap to clear"; return; } }
        tools(el);
      });
    }
    return {
      attach(canvas, toolEl, k) {
        cv = canvas; ctx = cv.getContext("2d");
        if (k !== key) { strokes = []; key = k; }
        redraw(); tools(toolEl);
        cv.onpointerdown = (e) => { e.preventDefault(); cv.setPointerCapture(e.pointerId); cur = { c: color, w: size, p: [pos(e)] }; strokes.push(cur); redraw(); };
        cv.onpointermove = (e) => {
          if (!cur) return; e.preventDefault();
          const a = cur.p[cur.p.length - 1], b = pos(e); cur.p.push(b);
          ctx.strokeStyle = cur.c; ctx.lineWidth = cur.w; ctx.lineCap = "round";
          ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        };
        cv.onpointerup = cv.onpointercancel = () => { cur = null; };
      },
      exportImage() {
        if (!strokes.length) return "";
        const out = document.createElement("canvas"); out.width = 320; out.height = 320;
        const o = out.getContext("2d"); o.drawImage(cv, 0, 0, 320, 320);
        let url = out.toDataURL("image/png");
        if (url.length > 300000) url = out.toDataURL("image/jpeg", 0.7);
        return url;
      }
    };
  })();

  // ---------- timer bar ----------
  setInterval(() => {
    const b = $("#tbar"); if (!tEnd) return;
    const left = Math.max(0, tEnd - Date.now());
    b.querySelector("i").style.width = (100 * left / tTotal) + "%";
    b.classList.toggle("low", left < 5000);
  }, 200);

  window.RN_PHONE = { view: () => view };

  // ---------- boot ----------
  if (modPin && room) connect(room);
  else if (room && name && store.get("rn-room") === room) connect(room);
  else showJoin("");
})();
