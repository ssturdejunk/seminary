// host.js: the board. Holds the whole game state, scores everything,
// and sends each phone exactly what it should show.
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const cfg = window.RN_CONFIG || {};
  const SAVE_KEY = "rn-host-state-v1";
  const DATA_KEY = "rn-host-data-v1";
  const COLORS = ["#F4B942", "#63D2A6", "#FF7A66", "#7FB2FF", "#C79BFF", "#FF9BD2", "#9BE15D", "#4FD1D9", "#FFB27A", "#B8C4FF"];
  const SET_PHASES = ["fw", "fready", "fg", "fr", "dw", "dready", "dg", "dr", "xw", "xq", "xr", "end"];
  const TIMED = { tq: "trivia", fw: "fibWrite", fg: "fibGuess", dw: "drawDraw", dg: "drawGuess", xw: "finalWager", xq: "finalQuestion" };

  let D = null;            // clue data
  let S = null;            // game state (saved to localStorage)
  let net = null;
  const links = new Map(); // connection id -> { pid } or { mod: true }
  let lastKey = -1, autoTimer = null, lastTick = -1;

  // ---------- helpers ----------
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/^(a|an|the) /, "");
  const letter = (i) => String.fromCharCode(65 + i);
  // True when a fake shares most of its meaningful words with the real answer.
  const STOP = new Set("a an the of and to in on unto for his her my thy thine thee your you is are was be as at by with that this it or they shall will shalt he she we i them him who which not no so but if then".split(" "));
  function similar(a, b) {
    const x = norm(a), y = norm(b);
    if (!x || !y) return false;
    if (x === y) return true;
    const tx = new Set(x.split(" ").filter((w) => !STOP.has(w))), ty = new Set(y.split(" ").filter((w) => !STOP.has(w)));
    const m = Math.min(tx.size, ty.size);
    if (!m) return false;
    let shared = 0; tx.forEach((w) => { if (ty.has(w)) shared++; });
    return shared / m >= 0.6;
  }
  const round = () => (S && S.rounds && S.r >= 0 ? S.rounds[S.r] : null);
  const mult = () => (round() && round().mult) || 1;

  // ---------- question bank: each game draws a fresh deck ----------
  // The clue file holds banks. At the start of a game the board draws `count` items
  // per round, preferring ones this laptop has shown least, and reshuffles the choices.
  const SEEN_KEY = "rn-seen-v1";
  let seen = {};
  try { seen = JSON.parse(localStorage.getItem(SEEN_KEY) || "{}") || {}; } catch (e) { seen = {}; }
  const saveSeen = () => { try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch (e) {} };
  const markSeen = (id) => { seen[id] = (seen[id] || 0) + 1; saveSeen(); };
  function pick(pool, n, idOf) {
    const rows = pool.map((it) => ({ it, c: seen[idOf(it)] || 0, r: Math.random() }));
    rows.sort((a, b) => a.c - b.c || a.r - b.r);
    return shuffle(rows.slice(0, Math.min(n, rows.length)).map((x) => x.it));
  }
  function reshuffle(q) {
    if (q.fixed) return q;
    const idx = shuffle(q.choices.map((_, i) => i));
    return Object.assign({}, q, { choices: idx.map((i) => q.choices[i]), answer: idx.indexOf(q.answer) });
  }
  function buildDeck() {
    return D.rounds.map((r) => {
      const c = JSON.parse(JSON.stringify(r)), n = (len, def) => Math.min(r.count || def || len, len);
      if (r.type === "trivia") c.questions = pick(r.questions, n(r.questions.length), (q) => q.q).map(reshuffle);
      else if (r.type === "fib") c.clues = pick(r.clues, n(r.clues.length, 8), (x) => x.prompt);
      else if (r.type === "draw") c.stories = pick(r.stories, n(r.stories.length, 7), (x) => x.story);
      else if (r.type === "final") {
        const f = reshuffle(pick(r.finals || [r], 1, (x) => x.q)[0]);
        c.q = f.q; c.choices = f.choices; c.answer = f.answer; c.note = f.note;
      }
      return c;
    });
  }
  const ensureDeck = () => { if (!S.rounds) S.rounds = buildDeck(); };
  function roundPoints(r) {
    const P = pts(), m = r.mult || 1;
    if (r.type === "trivia") return ["Correct answer: " + (P.triviaCorrect || 100) * m, "Speed bonus: up to " + (P.triviaSpeedBonus || 0) * m + " more"];
    if (r.type === "fib") return ["Pick the real ending: " + (P.fibTruth || 100) * m, "Each classmate your fake fools: " + (P.fibFooled || 50) * m];
    if (r.type === "draw") return ["Guess the right story: " + (P.drawCorrect || 100) * m, "Your drawing: up to " + (P.drawArtistMax || 100) * m + ", based on how many guess it", "Class favorite drawing: " + (P.drawFavorite || 50) * m + " bonus"];
    return ["Wager up to your score (up to " + (P.finalMaxWagerFloor || 500) + " if you're lower)", "Right: win your wager. Wrong: lose it", "Audience: " + (P.finalAudienceCorrect || 100) + " for a right answer"];
  }
  const multWords = (m) => (m === 2 ? "Double points." : m === 3 ? "Triple points." : m > 1 ? "Points times " + m + "." : "");
  const set = () => D.settings || {};
  const pts = () => (set().points || {});
  const timerSecs = (name) => ((set().timers || {})[name] || 30);

  function makeCode() {
    const L = "BCDFGHJKMNPQRSTVWXZ";
    let c = ""; for (let i = 0; i < 4; i++) c += L[Math.floor(Math.random() * L.length)];
    return c;
  }
  function playUrl() {
    let u = cfg.playUrl || new URL("play.html", location.href).href;
    u = u.split("?")[0];
    const q = new URLSearchParams({ room: S.code });
    if (RN_NET.mode() === "local") q.set("net", "local");
    return u + "?" + q.toString();
  }
  function modUrl() {
    const u = new URL(playUrl());
    u.searchParams.set("mod", S.pin);
    return u.href;
  }
  function qr(text, cell) {
    try { const q = qrcode(0, "M"); q.addData(text); q.make(); return q.createSvgTag({ cellSize: cell || 4, margin: 2, scalable: true }); }
    catch (e) { return ""; }
  }
  function shortUrl() { return playUrl().replace(/^https?:\/\//, "").split("?")[0]; }

  // ---------- sound (see audio.js) ----------
  const AU = window.RN_AUDIO;
  const sfx = { join: () => AU.fx("join"), tick: () => AU.fx("tick"), reveal: () => AU.fx("reveal"), start: () => AU.fx("start"), whoosh: () => AU.fx("whoosh") };
  function syncMusic() {
    const ph = S.phase;
    AU.music(TIMED[ph] ? (ph === "xw" || ph === "xq" ? "final" : "play")
      : ph === "lobby" ? "organ" : ph === "scores" || ph === "end" ? "calm" : "off");
  }
  const VO = window.RN_VOICE;
  VO.onDuck = (on) => AU.duck(on);
  VO.onVoices = () => { if (S && S.phase === "setup") render(); }; // the voice list can arrive after the page loads
  const HOLD_PHASES = ["tq", "fg", "xq"]; // timer waits until the question has been read
  const choiceLine = (cs) => cs.map((c, i) => letter(i) + ", " + c + ".").join(" ");
  function spokenText() {
    const r = round(), ph = S.phase;
    switch (ph) {
      case "intro": return (S.r === 0 ? "Welcome to " + D.title + ". " : "") + "Round " + (S.r + 1) + ". " + r.title + ". " + multWords(r.mult || 1) + " " + (r.intro || "") + " " + (r.rules || []).join(" ");
      case "tq": { const q = r.questions[S.i]; return q.q + " " + choiceLine(q.choices); }
      case "tr": { const q = r.questions[S.i]; return "The answer is " + letter(q.answer) + ", " + q.choices[q.answer] + "."; }
      case "fw": return "Write a convincing fake. Your clue is on your phone.";
      case "fg": return r.clues[S.sets[S.i].item].prompt + " " + choiceLine(S.opts.map((o) => o.text));
      case "fr": { const c = r.clues[S.sets[S.i].item]; return "The real answer: " + c.answer + ". " + (c.ref || ""); }
      case "dw": return "Draw your story. Everyone in your set draws the same one.";
      case "dg": return "Which story is this?";
      case "dr": return "It was: " + r.stories[S.sets[S.i].item].story + ".";
      case "xw": return "Final question: " + r.title + ". Place your wager.";
      case "xq": return r.q + " " + choiceLine(r.choices);
      case "xr": return "The answer is " + letter(r.answer) + ", " + r.choices[r.answer] + ".";
      case "scores": {
        const t = ranked().slice(0, 3); if (!t.length) return "";
        let x = "In first place, " + t[0].name + ", with " + t[0].score + " points.";
        if (t[1]) x += " Then " + t[1].name + (t[2] ? ", and " + t[2].name : "") + ".";
        return x;
      }
      case "end": { const t = ranked()[0]; return t ? "Well played. The winner is " + t.name + " with " + t.score + " points." : "Well played."; }
    }
    return "";
  }
  function releaseHold() {
    if (!S.hold) return;
    S.hold = false;
    if (S.total) S.deadline = Date.now() + S.total;
    update(true);
  }
  function speakPhase() {
    const k = S.key, text = spokenText();
    if (!VO.speak(text, () => { if (S.key === k) releaseHold(); })) releaseHold();
  }
  const voiceLabel = () => (VO.enabled() ? "Voice on" : "Voice off");
  function toggleVoice() {
    VO.setEnabled(!VO.enabled());
    if (!VO.enabled()) releaseHold();
    renderControls();
  }
  const soundLabel = () => (AU.muted() ? "Sound off" : AU.blocked() ? "Tap for sound" : "Sound on");
  function toggleSound() {
    if (AU.blocked() && !AU.muted()) AU.unlock(); else AU.setMuted(!AU.muted());
    setTimeout(renderControls, 250);
  }

  // ---------- players ----------
  const people = () => S.order.map((id) => S.players[id]).filter((p) => p && !S.removed[p.pid]);
  const online = () => people().filter((p) => p.connected);
  const ranked = () => people().slice().sort((a, b) => b.score - a.score || a.joined - b.joined);
  function rankOf(pid) {
    const r = ranked(); const p = S.players[pid];
    return 1 + r.filter((x) => x.score > p.score).length;
  }
  function addScore(pid, n, gains) {
    if (!n) return;
    S.players[pid].score += n;
    gains[pid] = (gains[pid] || 0) + n;
  }
  function uniqueName(name, pid) {
    const max = set().nameMax || 16;
    let base = String(name || "").replace(/\s+/g, " ").trim().slice(0, max) || "Player";
    let n = base, i = 2;
    const taken = (x) => people().some((p) => p.pid !== pid && p.name.toLowerCase() === x.toLowerCase());
    while (taken(n)) n = base.slice(0, max - 2) + " " + i++;
    return n;
  }
  function promoteAudience() { people().forEach((p) => { if (p.role === "audience") p.role = "player"; }); }

  function buildSets(itemCount) {
    people().forEach((p) => (p.set = -1));
    const ps = shuffle(online().filter((p) => p.role === "player"));
    const n = ps.length, size = set().setSize || 4;
    let k = Math.max(1, Math.ceil(n / size));
    if (n >= 2) k = Math.max(2, k);
    k = Math.min(k, itemCount, Math.max(n, 1));
    S.sets = n ? Array.from({ length: k }, (_, i) => ({ members: [], item: i })) : [];
    ps.forEach((p, i) => { S.sets[i % k].members.push(p.pid); p.set = i % k; });
    S.subs = {};
  }

  // ---------- state machine ----------
  function newGame() {
    S = {
      code: makeCode(), pin: String(1000 + Math.floor(Math.random() * 9000)),
      phase: "setup", key: 0, r: -1, i: 0,
      players: {}, order: [], removed: {},
      sets: [], subs: {}, ans: {}, opts: [], res: null, wagers: {}, drawings: [], storyOrder: [],
      deadline: 0, total: 0, hold: false, rounds: null, created: Date.now()
    };
  }
  function save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) {}
  }
  function go(phase) {
    const reveal = ["tr", "fr", "dr", "xr"].includes(phase);
    S.phase = phase; S.key++;
    if (!reveal) { S.ans = {}; S.res = null; }
    if (phase === "tq") markSeen(round().questions[S.i].q);
    const t = TIMED[phase];
    S.hold = false;
    if (t) { S.total = timerSecs(t) * 1000; S.deadline = Date.now() + S.total; } else { S.deadline = 0; S.total = 0; }
    VO.cancel();
    if (HOLD_PHASES.includes(phase) && VO.enabled()) { S.hold = true; S.deadline = 0; }
    clearTimeout(autoTimer);
    if (!reveal) sfx.whoosh();
    if (phase === "intro") setTimeout(sfx.start, 280);
    if (phase === "end") setTimeout(() => AU.fx("end"), 150);
    update(true);
    if (VO.enabled()) setTimeout(() => { if (S.phase === phase) speakPhase(); }, phase === "intro" || phase === "end" ? 700 : 250);
  }
  function update(all) {
    save(); render();
    if (all) pushAll(); else pushMods();
  }

  function next() {
    clearTimeout(autoTimer);
    const r = round();
    switch (S.phase) {
      case "setup": if (D) go("lobby"); break;
      case "lobby": case "scores": nextRound(); break;
      case "intro": beginRound(); break;
      case "tq": revealTrivia(); break;
      case "tr": if (++S.i < r.questions.length) go("tq"); else go("scores"); break;
      case "fw": go("fready"); break;
      case "fready": S.i = 0; startFibGuess(); break;
      case "fg": revealFib(); break;
      case "fr": S.i++; startFibGuess(); break;
      case "dw": go("dready"); break;
      case "dready": S.i = 0; startDrawGuess(); break;
      case "dg": revealDraw(); break;
      case "dr": S.i++; startDrawGuess(); break;
      case "xw": go("xq"); break;
      case "xq": revealFinal(); break;
      case "xr": go("end"); break;
    }
  }
  function nextRound() {
    ensureDeck();
    S.r++; S.i = 0;
    if (S.r >= D.rounds.length) go("end"); else go("intro");
  }
  function beginRound() {
    const r = round();
    S.i = 0;
    if (r.type === "trivia") return go("tq");
    if (r.type === "final") { promoteAudience(); S.wagers = {}; markSeen(r.q); return go("xw"); }
    promoteAudience();
    const items = r.type === "fib" ? r.clues : r.stories;
    buildSets(items.length);
    S.sets.forEach((s) => markSeen(r.type === "fib" ? r.clues[s.item].prompt : r.stories[s.item].story));
    if (r.type === "draw") S.storyOrder = shuffle(r.stories.map((_, i) => i));
    if (!S.sets.length) return go("scores");
    go(r.type === "fib" ? "fw" : "dw");
  }
  function skipRound() {
    if (["intro", "tq", "tr", "fw", "fready", "fg", "fr", "dw", "dready", "dg", "dr", "xw", "xq"].includes(S.phase)) {
      if (round() && round().type === "final") go("end"); else go("scores");
    }
  }
  function addTime() {
    if (S.deadline) { S.deadline += 15000; S.total += 15000; update(true); }
  }

  // Who still owes an answer in this phase?
  function expected() {
    const on = online();
    switch (S.phase) {
      case "tq": case "xq": return on;
      case "xw": return on.filter((p) => p.role === "player");
      case "fw": case "dw": return on.filter((p) => p.role === "player" && p.set >= 0);
      case "fg": case "dg": return on.filter((p) => !inCurrentSet(p.pid));
    }
    return [];
  }
  function answered(p) {
    if (S.phase === "fw" || S.phase === "dw") return !!S.subs[p.pid];
    if (S.phase === "xw") return S.wagers[p.pid] != null;
    const a = S.ans[p.pid];
    if (!a) return false;
    if (S.phase === "dg" && S.drawings.length > 1) return a.fav !== undefined;
    return true;
  }
  function checkAllIn() {
    const ex = expected();
    if (ex.length && ex.every(answered)) {
      const k = S.key;
      clearTimeout(autoTimer);
      autoTimer = setTimeout(() => { if (S.key === k) next(); }, 900);
    }
  }
  const inCurrentSet = (pid) => {
    const s = S.sets[S.i]; return !!(s && s.members.includes(pid) && (S.phase[0] === "f" || S.phase[0] === "d"));
  };

  // ---------- trivia ----------
  function revealTrivia() {
    const q = round().questions[S.i], P = pts(), gains = {}, counts = q.choices.map(() => 0);
    for (const pid in S.ans) {
      const a = S.ans[pid]; if (!S.players[pid] || S.removed[pid]) continue;
      counts[a.v] = (counts[a.v] || 0) + 1;
      if (a.v === q.answer) addScore(pid, mult() * ((P.triviaCorrect || 100) + Math.round((P.triviaSpeedBonus || 0) * Math.max(0, a.left) / S.total)), gains);
    }
    S.res = { counts, gains, right: Object.keys(S.ans).filter((pid) => S.ans[pid].v === q.answer) , picks: S.ans };
    sfx.reveal();
    go("tr");
  }

  // ---------- fake out (fib) ----------
  function startFibGuess() {
    const r = round();
    while (S.i < S.sets.length) {
      const s = S.sets[S.i], c = r.clues[s.item];
      const truthAll = [c.answer].concat(c.alt || []);
      const opts = [{ text: c.answer, truth: true, authors: [] }];
      const byKey = {};
      s.members.forEach((pid) => {
        const sub = S.subs[pid];
        if (!sub || sub.hidden || !sub.text || S.removed[pid]) return;
        const k = norm(sub.text);
        if (!k || truthAll.some((t) => similar(sub.text, t))) return;
        if (byKey[k]) byKey[k].authors.push(pid);
        else { byKey[k] = { text: sub.text, truth: false, authors: [pid] }; opts.push(byKey[k]); }
      });
      const house = shuffle(c.house || []);
      while (opts.length < 3 && house.length) {
        const h = house.pop();
        if (!opts.some((o) => norm(o.text) === norm(h))) opts.push({ text: h, truth: false, authors: [], house: true });
      }
      S.opts = shuffle(opts);
      return go("fg");
    }
    go("scores");
  }
  function revealFib() {
    const P = pts(), gains = {}, picks = S.opts.map(() => []);
    for (const pid in S.ans) {
      if (!S.players[pid] || S.removed[pid] || inCurrentSet(pid)) continue;
      const o = S.opts[S.ans[pid].v]; if (!o) continue;
      picks[S.ans[pid].v].push(pid);
      if (o.truth) addScore(pid, (P.fibTruth || 100) * mult(), gains);
      else o.authors.forEach((a) => addScore(a, (P.fibFooled || 50) * mult(), gains));
    }
    S.res = { picks, gains };
    sfx.reveal();
    go("fr");
  }

  // ---------- sketch it (draw) ----------
  function startDrawGuess() {
    while (S.i < S.sets.length) {
      const s = S.sets[S.i];
      const ds = s.members.filter((pid) => S.subs[pid] && S.subs[pid].img && !S.subs[pid].hidden && !S.removed[pid])
        .map((pid) => ({ pid, img: S.subs[pid].img }));
      if (ds.length) { S.drawings = ds; return go("dg"); }
      S.i++;
    }
    go("scores");
  }
  function revealDraw() {
    const P = pts(), gains = {}, s = S.sets[S.i], right = s.item;
    const counts = {}, favs = S.drawings.map(() => 0);
    let guessers = 0, correct = 0;
    for (const pid in S.ans) {
      if (!S.players[pid] || S.removed[pid] || inCurrentSet(pid)) continue;
      const a = S.ans[pid]; guessers++;
      counts[a.v] = (counts[a.v] || 0) + 1;
      if (a.v === right) { correct++; addScore(pid, (P.drawCorrect || 100) * mult(), gains); }
      if (a.fav >= 0 && a.fav < favs.length) favs[a.fav]++;
    }
    if (guessers) S.drawings.forEach((d) => addScore(d.pid, Math.round((P.drawArtistMax || 100) * mult() * correct / guessers), gains));
    const top = Math.max(0, ...favs);
    const favIdx = top > 0 ? favs.map((n, i) => (n === top ? i : -1)).filter((i) => i >= 0) : [];
    favIdx.forEach((i) => addScore(S.drawings[i].pid, (P.drawFavorite || 50) * mult(), gains));
    S.res = { counts, gains, guessers, correct, favIdx, favs };
    sfx.reveal();
    go("dr");
  }

  // ---------- final ----------
  const maxWager = (p) => Math.max(p.score, pts().finalMaxWagerFloor || 500);
  function revealFinal() {
    const r = round(), P = pts(), gains = {}, counts = r.choices.map(() => 0);
    people().forEach((p) => {
      const a = S.ans[p.pid];
      if (a) counts[a.v]++;
      const ok = a && a.v === r.answer;
      if (p.role === "player") {
        const w = S.wagers[p.pid] || 0;
        if (w) { p.score += ok ? w : -w; gains[p.pid] = ok ? w : -w; }
      } else if (ok) addScore(p.pid, P.finalAudienceCorrect || 100, gains);
    });
    S.res = { counts, gains };
    sfx.reveal();
    go("xr");
  }

  // ---------- network ----------
  function startNet() {
    net = RN_NET.host(S.code, {
      onConnect() {},
      onDisconnect(id) {
        const l = links.get(id); links.delete(id);
        if (l && l.pid && S.players[l.pid] && ![...links.values()].some((x) => x.pid === l.pid)) {
          S.players[l.pid].connected = false; update(false); checkAllIn();
        }
      },
      onMessage: onMsg,
      onStatus(st, detail) {
        const el = $("#status");
        const words = { online: "Connected. Phones can join.", reconnecting: "Reconnecting to the connection server…", error: "Connection problem: " + (detail || "unknown") + ". Retrying." };
        el.textContent = (RN_NET.mode() === "local" ? "Local test mode. " : RN_NET.mode() === "peer" ? "PeerJS mode. " : "") + (words[st] || st);
        el.classList.toggle("bad", st !== "online");
        if (detail === "peerjs-missing") el.textContent = "PeerJS did not load. Check that lib/peerjs.min.js is next to this page.";
        if (detail === "firebase-missing") el.textContent = "Firebase did not load. Check that the lib folder has both firebase files.";
        if (detail === "firebase-config") el.textContent = "Phones can't join yet: paste your Firebase settings into config.js.";
        const cn = $("#connNote"); if (cn) { cn.textContent = el.textContent; cn.classList.toggle("warn", st !== "online"); }
      }
    });
  }
  function onMsg(id, m) {
    if (!m || typeof m !== "object") return;
    if (m.t === "mod") {
      if (String(m.pin) === S.pin) { links.set(id, { mod: true }); net.send(id, modView()); }
      else net.send(id, { v: "modbad" });
      return;
    }
    if (m.t === "modcmd") return modCmd(id, m);
    if (m.t === "join") return join(id, m);
    const l = links.get(id); if (!l || !l.pid) return;
    const p = S.players[l.pid]; if (!p || S.removed[p.pid]) return;
    if (m.key !== S.key) { sendView(p.pid); return; }
    handleAnswer(p, m);
  }
  function join(id, m) {
    const pid = String(m.pid || "").slice(0, 40);
    if (!pid) return;
    if (S.removed[pid]) { net.send(id, { v: "removed" }); return; }
    links.set(id, { pid });
    let p = S.players[pid];
    if (!p) {
      p = S.players[pid] = {
        pid, name: uniqueName(m.name, pid), score: 0, set: -1, joined: Date.now(),
        role: SET_PHASES.includes(S.phase) ? "audience" : "player",
        color: COLORS[S.order.length % COLORS.length], connected: true
      };
      S.order.push(pid);
      S.lastJoin = pid;
      sfx.join();
    } else if (m.name && m.name !== p.name && S.phase === "lobby") {
      p.name = uniqueName(m.name, pid);
    }
    p.connected = true;
    update(false);
    sendView(pid);
  }
  function handleAnswer(p, m) {
    if (S.hold) return sendView(p.pid);
    const ph = S.phase, now = Date.now();
    const left = S.deadline ? S.deadline - now : 0;
    if (S.deadline && left < -1500) return;
    if (ph === "tq" || ph === "xq" || ph === "fg" || ph === "dg") {
      if (m.t === "ans") {
        if (S.ans[p.pid]) return sendView(p.pid);
        if ((ph === "fg" || ph === "dg") && inCurrentSet(p.pid)) return;
        const n = ph === "tq" ? round().questions[S.i].choices.length : ph === "xq" ? round().choices.length : ph === "fg" ? S.opts.length : round().stories.length;
        const v = Number(m.v); if (!(v >= 0 && v < n)) return;
        S.ans[p.pid] = { v: ph === "dg" ? S.storyOrder[v] : v, left };
        if (ph === "dg" && S.drawings.length <= 1) S.ans[p.pid].fav = -1;
      } else if (m.t === "fav" && ph === "dg" && S.ans[p.pid] && S.ans[p.pid].fav === undefined) {
        const f = Number(m.v);
        S.ans[p.pid].fav = f >= 0 && f < S.drawings.length ? f : -1;
      } else return;
    } else if (ph === "fw" && m.t === "text") {
      if (p.set < 0) return;
      const text = String(m.v || "").replace(/\s+/g, " ").trim().slice(0, set().answerMax || 40);
      const c = round().clues[S.sets[p.set].item];
      const truth = [c.answer].concat(c.alt || []);
      if (!norm(text)) return sendView(p.pid, "Type a fake answer first.");
      if (truth.some((t) => similar(text, t))) return sendView(p.pid, "That's the real answer, or too close to it. Write something that sounds right but isn't.");
      S.subs[p.pid] = { text, set: p.set, hidden: false };
    } else if (ph === "dw" && m.t === "img") {
      if (p.set < 0) return;
      const img = String(m.v || "");
      if (!img.startsWith("data:image/") || img.length > 400000) return sendView(p.pid, "That drawing didn't come through. Try sending it again.");
      S.subs[p.pid] = { img, set: p.set, hidden: false };
    } else if (ph === "xw" && m.t === "wager") {
      if (p.role !== "player") return;
      const w = Math.floor(Number(m.v));
      if (!(w >= 0)) return;
      S.wagers[p.pid] = Math.min(w, maxWager(p));
    } else return;
    update(false);
    sendView(p.pid);
    checkAllIn();
  }

  // ---------- what each phone sees ----------
  function me(pid) {
    const p = S.players[pid];
    return { name: p.name, score: p.score, rank: rankOf(pid), of: people().length, role: p.role, color: p.color };
  }
  function timing() { return S.deadline ? { left: Math.max(0, S.deadline - Date.now()), total: S.total } : {}; }
  function resultFor(pid, extra) {
    const g = S.res && S.res.gains ? S.res.gains[pid] || 0 : 0;
    return Object.assign({ v: "result", gain: g }, extra);
  }
  function viewFor(pid, error) {
    const p = S.players[pid];
    if (S.removed[pid]) return { v: "removed" };
    const r = round(), ph = S.phase, a = S.ans[pid];
    const base = { key: S.key, me: me(pid), title: D ? D.title : "" };
    const wait = (msg, sub) => Object.assign(base, { v: "wait", msg, sub: sub || "" }, timing());
    const audSub = p.role === "audience" ? "You're in the audience until the next round starts. You can still earn points by answering." : "";
    if (S.hold && HOLD_PHASES.includes(ph) && !(ph === "fg" && inCurrentSet(pid))) return wait("Listen to the question.", "Answers open as soon as it has been read.");
    switch (ph) {
      case "setup": case "lobby": return wait("You're in.", "Watch the screen. The game starts soon.");
      case "intro": return wait(r.title, ((r.mult || 1) > 1 ? "Points are ×" + r.mult + " this round. " : "") + (r.intro || ""));
      case "scores": return wait(rankLine(pid), "Next round coming up.");
      case "end": return Object.assign(base, { v: "end", msg: rankLine(pid, true) });
      case "tq": { const q = r.questions[S.i]; return Object.assign(base, { v: "choose", prompt: q.q, choices: q.choices, picked: a ? a.v : null }, timing()); }
      case "tr": { const q = r.questions[S.i]; const ok = a ? a.v === q.answer : null; return resultFor(pid, Object.assign(base, { ok, answer: q.choices[q.answer], note: q.note || "" })); }
      case "fw": {
        if (p.set < 0) return wait("Sets are writing fake answers.", audSub || "Get ready to spot the real ones.");
        const c = r.clues[S.sets[p.set].item], sub = S.subs[pid];
        return Object.assign(base, { v: "write", prompt: c.prompt, sent: sub ? sub.text : "", error: error || "", max: set().answerMax || 40 }, timing());
      }
      case "fready": return wait("Fake answers are in.", "Look at the screen.");
      case "fg": {
        if (inCurrentSet(pid)) return wait("Your set wrote fakes for this one.", "Sit tight and watch who you fool.");
        const c = r.clues[S.sets[S.i].item];
        return Object.assign(base, { v: "choose", prompt: c.prompt, choices: S.opts.map((o) => o.text), picked: a ? a.v : null, sub: audSub }, timing());
      }
      case "fr": {
        if (inCurrentSet(pid)) return resultFor(pid, Object.assign(base, { ok: null, msg: (S.res.gains[pid] ? "You fooled classmates." : "Nobody fell for your fake this time.") }));
        const o = a ? S.opts[a.v] : null;
        return resultFor(pid, Object.assign(base, { ok: o ? !!o.truth : null, answer: r.clues[S.sets[S.i].item].answer }));
      }
      case "dw": {
        if (p.set < 0) return wait("Sets are drawing.", audSub || "Get ready to guess the stories.");
        const st = r.stories[S.sets[p.set].item], sub = S.subs[pid];
        return Object.assign(base, { v: "draw", story: st.story, sent: !!sub, error: error || "" }, timing());
      }
      case "dready": return wait("Drawings are in.", "Look at the screen.");
      case "dg": {
        if (inCurrentSet(pid)) return wait("These are your set's drawings.", "You score for every classmate who guesses right.");
        const choices = S.storyOrder.map((i) => r.stories[i].story);
        const picked = a ? S.storyOrder.indexOf(a.v) : null;
        const favStep = a && a.fav === undefined && S.drawings.length > 1;
        return Object.assign(base, { v: favStep ? "fav" : "choose", prompt: "Which story is this?", choices, picked, map: S.storyOrder, nfav: S.drawings.length, sub: audSub }, timing());
      }
      case "dr": {
        const st = r.stories[S.sets[S.i].item];
        if (inCurrentSet(pid)) return resultFor(pid, Object.assign(base, { ok: null, msg: S.res.correct + " of " + S.res.guessers + " guessed your story." }));
        return resultFor(pid, Object.assign(base, { ok: a ? a.v === S.sets[S.i].item : null, answer: st.story }));
      }
      case "xw": {
        if (p.role !== "player") return wait("Players are placing wagers.", "You can answer the final question for points.");
        return Object.assign(base, { v: "wager", max: maxWager(p), wager: S.wagers[pid], category: r.title }, timing());
      }
      case "xq": return Object.assign(base, { v: "choose", prompt: r.q, choices: r.choices, picked: a ? a.v : null }, timing());
      case "xr": return resultFor(pid, Object.assign(base, { ok: a ? a.v === r.answer : false, answer: r.choices[r.answer], note: r.note || "" }));
    }
    return wait("Watch the screen.");
  }
  function ordinal(n) { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function rankLine(pid, final) {
    const rk = rankOf(pid), of = people().length;
    return (final ? "You finished " : "You're in ") + ordinal(rk) + " of " + of + ".";
  }
  function sendView(pid, error) {
    for (const [id, l] of links) if (l.pid === pid) net.send(id, viewFor(pid, error));
    pushMods();
  }
  function pushAll() {
    for (const [id, l] of links) {
      if (l.mod) net.send(id, modView());
      else if (l.pid && S.players[l.pid]) net.send(id, viewFor(l.pid));
    }
  }
  function pushMods() { for (const [id, l] of links) if (l.mod) net.send(id, modView()); }

  // ---------- moderator (teacher's phone) ----------
  function modView() {
    const subs = [];
    if (["fw", "fready", "fg", "dw", "dready", "dg"].includes(S.phase)) {
      for (const pid in S.subs) {
        const s = S.subs[pid], p = S.players[pid]; if (!p || S.removed[pid]) continue;
        subs.push({ pid, name: p.name, set: s.set + 1, text: s.text || "", img: s.img || "", hidden: !!s.hidden });
      }
      subs.sort((a, b) => a.set - b.set);
    }
    return {
      v: "mod", phase: S.phase, label: nextLabel(), timed: !!S.deadline, canSkip: !!round() && !["scores", "end"].includes(S.phase),
      where: whereText(), subs,
      players: ranked().map((p) => ({ pid: p.pid, name: p.name, score: p.score, role: p.role, on: p.connected }))
    };
  }
  function modCmd(id, m) {
    const l = links.get(id); if (!l || !l.mod || String(m.pin) !== S.pin) return;
    if (m.c === "next") next();
    else if (m.c === "add") addTime();
    else if (m.c === "skip") skipRound();
    else if ((m.c === "hide" || m.c === "show") && S.subs[m.pid]) { S.subs[m.pid].hidden = m.c === "hide"; update(false); }
    else if (m.c === "remove" && S.players[m.pid]) {
      S.removed[m.pid] = true;
      for (const [cid, x] of links) if (x.pid === m.pid) net.send(cid, { v: "removed" });
      update(true); checkAllIn();
    }
    pushMods();
  }

  // ---------- board rendering ----------
  function whereText() {
    const r = round();
    if (S.phase === "setup") return "Setup";
    if (S.phase === "lobby") return "Lobby";
    if (S.phase === "end") return "Final scores";
    if (!r) return "";
    let t = r.title + ((r.mult || 1) > 1 ? " · ×" + r.mult + " points" : "");
    if (S.phase === "tq" || S.phase === "tr") t += ", question " + (S.i + 1) + " of " + r.questions.length;
    if (["fg", "fr", "dg", "dr"].includes(S.phase)) t += ", set " + (S.i + 1) + " of " + S.sets.length;
    return t;
  }
  function nextLabel() {
    const r = round(), more = (n) => S.i + 1 < n;
    switch (S.phase) {
      case "setup": return "Open the lobby";
      case "lobby": return "Start the game";
      case "intro": return "Begin round";
      case "tq": return "Reveal answer";
      case "tr": return more(r.questions.length) ? "Next question" : "Show scores";
      case "fw": return "Close writing";
      case "fready": case "dready": return "Start guessing";
      case "fg": case "dg": return "Reveal";
      case "fr": return more(S.sets.length) ? "Next clue" : "Show scores";
      case "dw": return "Close drawing";
      case "dr": return more(S.sets.length) ? "Next set" : "Show scores";
      case "xw": return "Show the question";
      case "xq": return "Reveal answer";
      case "xr": return "Final standings";
      case "scores": return S.r + 1 < D.rounds.length ? "Next round" : "Finish";
    }
    return "";
  }
  const pname = (pid) => (S.players[pid] ? S.players[pid].name : "");
  const dot = (pid) => `<span class="dot" style="background:${S.players[pid].color}"></span>`;
  function leaderHTML(n, gains) {
    return ranked().slice(0, n).map((p) =>
      `<div class="row">${dot(p.pid)}<span class="nm">${esc(p.name)}</span>${gains && gains[p.pid] ? `<span class="gain">${gains[p.pid] > 0 ? "+" : ""}${gains[p.pid]}</span>` : ""}<span class="pts">${p.score}</span></div>`).join("") || `<div class="muted">No players yet.</div>`;
  }
  function answeredLine() {
    const ex = expected(); if (!ex.length) return "";
    const n = ex.filter(answered).length;
    return `<div class="count">${n} of ${ex.length} answered</div>`;
  }
  function setsHTML(kind) {
    return `<div class="sets">${S.sets.map((s, i) => `<div class="set rise"><h3>Set ${i + 1}</h3>${s.members.map((pid) =>
      `<div class="m ${S.subs[pid] ? "done" : ""}"><span>${esc(pname(pid))}</span><span>${S.subs[pid] ? "✓" : ""}</span></div>`).join("")}</div>`).join("")}</div>`;
  }

  function render() {
    const st = $("#stage"), r = round(), ph = S.phase;
    syncMusic();
    const fresh = S.key !== lastKey; lastKey = S.key;
    st.classList.toggle("fresh", fresh);
    $("#where").textContent = D ? D.title : "Review Night";
    $("#whereSub").textContent = whereText();
    renderJoin();
    let h = "";
    if (ph === "setup") h = setupHTML();
    else if (ph === "lobby") {
      const ps = people();
      h = `<div class="lobby"><div class="qrbig rise">${qr(playUrl(), 8)}</div><div class="rise">
        <div class="muted">Scan or go to</div><div style="font-size:1.4em;font-weight:700">${esc(shortUrl())}</div>
        <div class="muted" style="margin-top:.6em">Room code</div><div class="code">${S.code}</div>
        <div class="chips">${ps.map((p) => `<span class="chip ${p.pid === S.lastJoin ? "fresh-chip" : ""}" style="background:${p.color}">${esc(p.name)}</span>`).join("")}</div>
        <div class="count">${ps.length} joined</div></div></div>`;
    } else if (ph === "intro") {
      const m = r.mult || 1;
      const chips = D.rounds.map((x, i) => `<span class="rchip ${i === S.r ? "on" : i < S.r ? "done" : ""}" title="${esc(x.title)}">${i + 1}</span>`).join("");
      h = `<div class="intro">
        <div class="intro-top rise"><span class="muted">${S.r === 0 ? "Welcome to " + esc(D.title) + ". " : ""}Round ${S.r + 1} of ${D.rounds.length}</span><span class="rchips">${chips}</span></div>
        <div class="intro-title rise"><span class="big">${esc(r.title)}</span>${m > 1 ? `<span class="mult">×${m} points</span>` : ""}</div>
        <p class="lead rise">${esc(r.intro || "")}</p>
        <div class="intro-cols">
          <div class="card rise"><h3>How it works</h3><ol>${(r.rules || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ol></div>
          <div class="card rise"><h3>Points${m > 1 ? ` (×${m} this round)` : ""}</h3><ul>${roundPoints(r).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
        </div>
        <div class="intro-foot rise muted">${(D.welcome || []).map(esc).join(" · ")}</div></div>`;
    } else if (ph === "tq" || ph === "tr" || ph === "xq" || ph === "xr") {
      const q = ph[0] === "t" ? r.questions[S.i] : { q: r.q, choices: r.choices, answer: r.answer, note: r.note };
      const rev = ph.endsWith("r");
      const tiles = q.choices.map((c, i) => `<div class="tile rise ${rev ? (i === q.answer ? "right" : "dim") : ""}"><span class="k">${letter(i)}</span><span class="txt">${esc(c)}</span>${rev ? `<span class="n">${S.res.counts[i] || 0}</span>` : ""}</div>`).join("");
      const main = `<div class="prompt rise">${esc(q.q)}</div><div class="tiles ${q.choices.length > 4 ? "many" : ""}">${tiles}</div>${rev && q.note ? `<div class="note rise">${esc(q.note)}</div>` : answeredLine()}`;
      h = rev ? `<div class="split"><div>${main}</div><div class="board-list rise"><h3>${ph === "xr" ? "Standings" : "Top 5"}</h3>${leaderHTML(ph === "xr" ? 8 : 5, S.res.gains)}</div></div>` : main;
    } else if (ph === "fw" || ph === "dw") {
      h = `<div class="big rise">${ph === "fw" ? "Write a convincing fake" : "Draw your story"}</div><p class="rise muted" style="font-size:1.2em">${ph === "fw" ? "Check your phone for your set's clue." : "Check your phone for your set's story. Everyone in a set draws the same one."}</p>${setsHTML()}`;
    } else if (ph === "fready" || ph === "dready") {
      const n = Object.keys(S.subs).length, hid = Object.values(S.subs).filter((s) => s.hidden).length;
      h = `<div class="big rise">${ph === "fready" ? "The fakes are in" : "The drawings are in"}</div><p class="rise" style="font-size:1.3em">${n} received${hid ? `, ${hid} hidden by the host` : ""}. Guessing starts when the host is ready.</p>`;
    } else if (ph === "fg" || ph === "fr") {
      const c = r.clues[S.sets[S.i].item], rev = ph === "fr";
      const tiles = S.opts.map((o, i) => {
        let by = "";
        if (rev) by = o.truth ? "The real answer" : o.house ? "A house fake" : "Fake by " + o.authors.map((a) => esc(pname(a))).join(", ");
        const n = rev ? S.res.picks[i].length : 0;
        return `<div class="tile rise ${rev ? (o.truth ? "right" : "") : ""}"><span class="k">${letter(i)}</span><span class="txt">${esc(o.text)}${rev ? `<span class="by">${by}${!o.truth && n ? `, fooled ${n}` : ""}</span>` : ""}</span>${rev ? `<span class="n">${n}</span>` : ""}</div>`;
      }).join("");
      const main = `<div class="prompt rise">${esc(c.prompt)}</div><div class="tiles">${tiles}</div>${rev ? `<div class="note rise"><b>${esc(c.ref || "")}</b></div>` : `<div class="count">Set ${S.i + 1} wrote the fakes: ${S.sets[S.i].members.map((x) => esc(pname(x))).join(", ")}</div>${answeredLine()}`}`;
      h = rev ? `<div class="split"><div>${main}</div><div class="board-list rise"><h3>Top 5</h3>${leaderHTML(5, S.res.gains)}</div></div>` : main;
    } else if (ph === "dg" || ph === "dr") {
      const st0 = r.stories[S.sets[S.i].item], rev = ph === "dr";
      const draws = S.drawings.map((d, i) => `<div class="drawing rise ${rev && S.res.favIdx.includes(i) ? "fav" : ""}"><img alt="Drawing ${letter(i)}" src="${d.img}"><span class="lbl">${letter(i)}</span>${rev && S.res.favIdx.includes(i) ? `<span class="star" aria-label="Class favorite">★</span>` : ""}${rev ? `<div class="artist">${esc(pname(d.pid))}</div>` : ""}</div>`).join("");
      const list = S.storyOrder.map((si) => `<div class="${rev && si === S.sets[S.i].item ? "right" : rev ? "muted" : ""}">${esc(r.stories[si].story)}${rev ? ` (${S.res.counts[si] || 0})` : ""}</div>`).join("");
      h = `<div class="prompt rise" style="margin-bottom:.5em">${rev ? esc(st0.story) + ` <span class="muted" style="font-weight:400">${esc(st0.ref || "")}</span>` : "Which story is this?"}</div>
        <div class="drawings" style="grid-template-columns:repeat(${Math.max(S.drawings.length, 3)},1fr)">${draws}</div>
        ${rev ? `<div class="count">${S.res.correct} of ${S.res.guessers} guessed right${S.res.favIdx.length ? ". The star marks the class favorite." : "."}</div>` : `<div class="storylist">${list}</div>${answeredLine()}`}`;
    } else if (ph === "xw") {
      h = `<div class="rise muted" style="font-size:1.2em">Final question</div><div class="big rise" style="color:var(--saffron);font-size:5em">${esc(r.title)}</div><p class="rise" style="font-size:1.3em">Place your wager on your phone. You can bet up to your score, or up to ${pts().finalMaxWagerFloor || 500} if your score is lower.</p>${answeredLine()}`;
    } else if (ph === "scores") {
      h = `<div class="big rise" style="margin-bottom:.4em">Standings</div><div class="leader rise">${ranked().slice(0, 5).map((p, i) => `<div class="row"><span class="rank">${i + 1}</span>${dot(p.pid)}<span class="nm">${esc(p.name)}</span><span class="pts">${p.score}</span></div>`).join("")}</div><div class="count">Everyone else can see their rank on their phone.</div>`;
    } else if (ph === "end") {
      const r3 = ranked().slice(0, 3), hgt = [8, 5.5, 4], ord = [1, 0, 2];
      h = `<div class="big rise" style="text-align:center">Well played</div><div class="podium rise" style="justify-content:center">${ord.filter((i) => r3[i]).map((i) => `<div class="p"><div class="nm">${esc(r3[i].name)}</div><div class="muted">${r3[i].score}</div><div class="blk" style="height:${hgt[i]}em;background:${r3[i].color}">${i + 1}</div></div>`).join("")}</div>`;
    }
    document.body.classList.toggle("quiet", !["setup", "lobby"].includes(ph));
    st.innerHTML = h;
    renderControls();
    bindSetup();
    tick(true);
  }
  function renderJoin() {
    const jb = $("#joinbox");
    if (S.phase === "lobby" || S.phase === "end") { jb.innerHTML = ""; return; }
    jb.innerHTML = `<div><div class="url">Join at ${esc(shortUrl())}</div><div class="code">${S.code}</div></div><div class="qr">${qr(playUrl(), 3)}</div>`;
  }
  function renderControls() {
    const c = $("#controls");
    const lbl = nextLabel();
    const sm = document.body.classList.contains("compact"); // shorter labels on a phone
    c.innerHTML = `<button id="cSnd" class="ghost">${soundLabel()}</button>${VO.supported ? `<button id="cVoice" class="ghost">${voiceLabel()}</button>` : ""}<button id="cTools" class="ghost">${sm ? "Tools" : "Host tools"}</button>` +
      (round() && !["scores", "end"].includes(S.phase) ? `<button id="cSkip" class="ghost">${sm ? "Skip" : "Skip round"}</button>` : "") +
      (S.deadline ? `<button id="cAdd" class="ghost">${sm ? "+15s" : "+15 sec"}</button>` : "") +
      (lbl ? `<button id="cNext" class="primary" ${S.phase === "setup" && !D ? "disabled" : ""}>${lbl}</button>` : "");
    $("#cSnd").onclick = toggleSound;
    if ($("#cVoice")) $("#cVoice").onclick = toggleVoice;
    $("#cTools").onclick = openTools;
    if ($("#cSkip")) $("#cSkip").onclick = () => ask("Skip the rest of this round?", skipRound);
    if ($("#cAdd")) $("#cAdd").onclick = addTime;
    if ($("#cNext")) $("#cNext").onclick = next;
  }
  function tick(force) {
    const rv = $("#river"), fill = rv.querySelector("i"), secs = rv.querySelector(".secs");
    if (!S || !S.deadline) { AU.intensity(0.2); fill.style.width = "0"; secs.textContent = ""; rv.classList.remove("low"); return; }
    const left = Math.max(0, S.deadline - Date.now());
    fill.style.width = (100 * left / S.total) + "%";
    AU.intensity(0.2 + 0.8 * Math.pow(1 - left / S.total, 1.4));
    const s = Math.ceil(left / 1000);
    secs.textContent = s;
    rv.classList.toggle("low", s <= 5);
    if (!force && s <= 5 && s > 0 && s !== lastTick) sfx.tick();
    lastTick = s;
    if (left <= 0 && !force) { S.deadline = 0; next(); }
  }

  // ---------- setup, tools, dialogs ----------
  function setupHTML() {
    const saved = savedGame();
    const fileWarn = location.protocol === "file:" && !cfg.playUrl && RN_NET.mode() !== "local";
    return `<div class="setup">
      <div class="big rise" style="color:var(--saffron)">Review Night</div>
      <div class="setup-grid">
        <div class="card rise"><b>Phones</b><div id="connNote" class="muted">${esc($("#status").textContent)}</div>
          <div class="muted" style="margin-top:.5em">Students can join now with the room code and QR at the top right. Press Open the lobby when you are ready.</div></div>
        <div class="card rise"><div class="modqr"><div>${qr(modUrl(), 4)}</div><div><b>Moderate from your phone.</b> Scan this to hide fakes or drawings, remove players, and move the game forward. Code: <b>${S.pin}</b></div></div></div>
      </div>
      <div class="card rise"><b>Read questions aloud</b>${voiceSettingsHTML("vs")}</div>
      <div class="card rise"><b>Clues:</b> ${D ? `${esc(D.title)}, ${D.rounds.length} rounds` : `<span class="warn">No clue file loaded.</span>`}
        <label class="muted" style="margin-left:1em">Load a different clue file <input type="file" id="fileIn" accept=".json,application/json"></label><div id="fileErr" class="warn"></div></div>
      ${fileWarn ? `<div class="card rise warn">This board is running from a file, so phones need the online address. Set playUrl in config.js.</div>` : ""}
      ${saved ? `<div class="rise" style="margin-top:.8em"><button class="ghost" id="resume">Resume the game in room ${esc(saved.code)}</button></div>` : ""}
      </div>`;
  }
  function bindSetup() {
    if (S.phase !== "setup") return;
    const fi = $("#fileIn");
    if (fi) fi.onchange = () => {
      const f = fi.files[0]; if (!f) return;
      f.text().then((t) => { const d = JSON.parse(t); validate(d); D = d; try { localStorage.setItem(DATA_KEY, t); } catch (e) {} render(); })
        .catch((e) => { $("#fileErr").textContent = "That file could not be used: " + e.message; });
    };
    bindVoiceSettings("vs");
    const rs = $("#resume"); if (rs) rs.onclick = resume;
  }
  function savedGame() {
    try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || "null"); return s && s.phase !== "setup" && s.phase !== "end" && s.code !== S.code ? s : null; } catch (e) { return null; }
  }
  function resume() {
    const s = savedGame(); if (!s) return;
    try { const d = JSON.parse(localStorage.getItem(DATA_KEY) || "null"); if (d) D = d; } catch (e) {}
    S = s;
    if (S.hold) { S.hold = false; if (S.total) S.deadline = Date.now() + S.total; }
    Object.values(S.players).forEach((p) => (p.connected = false));
    links.clear();
    if (S.deadline) { S.deadline = Date.now() + Math.max(10000, S.total / 2); }
    restartNet();
    lastKey = -1; update(true);
  }
  function restartNet() { startNet(); }
  function validate(d) {
    if (!d || !Array.isArray(d.rounds) || !d.rounds.length) throw new Error("it has no rounds.");
    d.settings = d.settings || {};
    d.rounds.forEach((r, i) => {
      const n = "Round " + (i + 1);
      if (r.count != null && !(r.count >= 1)) throw new Error(n + " has a bad count.");
      if (r.type === "trivia") { if (!r.questions || !r.questions.length) throw new Error(n + " has no questions."); r.questions.forEach((q, j) => { if (!q.choices || q.answer == null || !q.choices[q.answer]) throw new Error(n + ", question " + (j + 1) + " needs choices and a valid answer number (counting from 0)."); }); }
      else if (r.type === "fib") { if (!r.clues || !r.clues.length) throw new Error(n + " has no clues."); r.clues.forEach((c, j) => { if (!c.prompt || !c.answer) throw new Error(n + ", clue " + (j + 1) + " needs a prompt and an answer."); }); }
      else if (r.type === "draw") { if (!r.stories || r.stories.length < 2) throw new Error(n + " needs at least 2 stories."); }
      else if (r.type === "final") { (r.finals || [r]).forEach((f, j) => { if (!f.q || !f.choices || f.answer == null || !f.choices[f.answer]) throw new Error(n + ", final question " + (j + 1) + " needs a question, choices, and a valid answer number."); }); }
      else throw new Error(n + " has an unknown type: " + r.type);
    });
  }
  let showAllVoices = false;
  function voiceSettingsHTML(px) {
    if (!VO.supported) return `<p class="muted">This browser can't read aloud. Try Chrome or Edge.</p>`;
    const vs = VO.voices(showAllVoices), cur = VO.chosen() || VO.voiceName(), total = VO.voiceCount();
    return `<div class="voicerow"><label class="chk"><input type="checkbox" id="${px}On" ${VO.enabled() ? "checked" : ""}> On</label>
      <select id="${px}Sel" aria-label="Voice">${vs.length ? vs.map((v) => `<option value="${esc(v.name)}" ${v.name === cur ? "selected" : ""}>${esc(v.label)}${/^en-US/i.test(v.lang) ? "" : " (" + esc(v.lang) + ")"}</option>`).join("") : `<option>No English voices found yet</option>`}</select>
      <label class="chk">Speed <input type="range" id="${px}Rate" min="0.7" max="1.3" step="0.05" value="${VO.rate()}"></label>
      <button id="${px}Test" class="ghost">Test</button>
      ${total > 8 ? `<button id="${px}More" class="ghost">${showAllVoices ? "Show fewer" : "Show all " + total}</button>` : ""}</div>`;
  }
  function bindVoiceSettings(px) {
    const on = $("#" + px + "On"); if (!on) return;
    on.onchange = () => { VO.setEnabled(on.checked); if (!on.checked) releaseHold(); renderControls(); };
    $("#" + px + "Sel").onchange = (e) => VO.setVoice(e.target.value);
    $("#" + px + "Rate").oninput = (e) => VO.setRate(e.target.value);
    const more = $("#" + px + "More");
    if (more) more.onclick = () => { showAllVoices = !showAllVoices; if (px === "vs") render(); else fillTools(); };
    $("#" + px + "Test").onclick = () => VO.speak("Which scripture says, they were of one heart and one mind? A, Moses 1:39. B, Moses 7:18.", null, true);
  }
  function openTools() { fillTools(); $("#tools").showModal(); }
  function fillTools() {
    const stats = D ? D.rounds.map((r) => r.title + ": " + (r.questions || r.clues || r.stories || r.finals || [1]).length).join(", ") : "";
    $("#toolsBody").innerHTML = voiceSettingsHTML("vt") + `<div class="voiceset"><div class="muted">Question banks: ${esc(stats)}</div><div><button id="resetSeen" class="ghost">Reset question history</button> <span id="resetMsg" class="muted"></span></div></div>` + `<div class="setup"><div class="modqr" style="display:flex;gap:1em;align-items:center"><div>${qr(modUrl(), 4)}</div><div>Moderator code <b>${S.pin}</b><br><span class="muted">Room ${S.code}</span></div></div></div>`;
    bindVoiceSettings("vt");
    $("#resetSeen").onclick = () => { seen = {}; try { localStorage.removeItem(SEEN_KEY); } catch (e) {} $("#resetMsg").textContent = "Cleared. The next game can draw any question."; };
  }
  let askYes = null;
  function ask(text, yes) { $("#confirmText").textContent = text; askYes = yes; $("#confirm").showModal(); }
  $("#confirmNo").onclick = () => $("#confirm").close();
  $("#confirmYes").onclick = () => { $("#confirm").close(); if (askYes) askYes(); };
  $("#toolsClose").onclick = () => $("#tools").close();
  $("#toolsReset").onclick = () => { $("#tools").close(); ask("End this game and start a new one? Scores will be lost.", () => { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} location.reload(); }); };
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || document.querySelector("dialog[open]")) return;
    if (e.key.toLowerCase() === "m") { toggleSound(); return; }
    if (e.key.toLowerCase() === "v" && VO.supported) { toggleVoice(); return; }
    if (e.key === "ArrowRight" || e.key.toLowerCase() === "n") { e.preventDefault(); if (S.phase !== "setup" || D) next(); }
  });

  // Browsers keep audio off until the page has been clicked or a key pressed.
  const unlockOnce = () => { if (AU.blocked()) { AU.unlock(); setTimeout(renderControls, 300); } };
  window.addEventListener("pointerdown", unlockOnce, true);
  window.addEventListener("keydown", unlockOnce, true);

  // Phone layout: used for narrow or short screens. Add ?compact=1 or ?compact=0 to the address to force it.
  const compactQuery = window.matchMedia("(max-width: 900px), (max-height: 520px)");
  function applyLayout() {
    const f = new URLSearchParams(location.search).get("compact");
    const on = f === "1" ? true : f === "0" ? false : compactQuery.matches;
    document.body.classList.toggle("compact", on);
    document.documentElement.classList.toggle("compact", on);
    if (S) renderControls();
  }
  if (compactQuery.addEventListener) compactQuery.addEventListener("change", applyLayout); else if (compactQuery.addListener) compactQuery.addListener(applyLayout);

  // Keep the screen awake while the board is open (phones dim and sleep otherwise).
  let wakeLock = null;
  async function keepAwake() {
    try { if (navigator.wakeLock && document.visibilityState === "visible") wakeLock = await navigator.wakeLock.request("screen"); } catch (e) {}
  }
  document.addEventListener("visibilitychange", keepAwake);

  // ---------- boot ----------
  async function boot() {
    applyLayout(); keepAwake();
    newGame();
    const url = new URLSearchParams(location.search).get("data") || cfg.dataUrl;
    if (url) {
      try { const res = await fetch(url, { cache: "no-store" }); const d = await res.json(); validate(d); D = d; }
      catch (e) { try { const d = JSON.parse(localStorage.getItem(DATA_KEY) || "null"); if (d) { validate(d); D = d; } } catch (e2) {} }
    }
    startNet();
    render();
    setInterval(() => { if (S) tick(false); }, 200);
    window.RN_HOST = { state: () => S, next };
  }
  boot();
})();
