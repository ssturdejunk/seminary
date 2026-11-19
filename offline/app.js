// Review Night, offline edition. Runs from this one file with no internet.
// Students answer on dry erase boards; the host taps who got it right and the
// game keeps score. Everything is saved in this browser as you go.
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const AU = window.RN_AUDIO, VO = window.RN_VOICE;
  VO.preferLocal = true;
  const SAVE_KEY = "rn-offline-state-v1", DATA_KEY = "rn-offline-data-v1", META_KEY = "rn-offline-data-name", SEEN_KEY = "rn-seen-v1";
  const TIMED = { tq: "trivia", fw: "fibWrite", fv: "fibGuess", dd: "drawDraw", dg: "drawGuess", xw: "finalWager", xq: "finalQuestion" };
  const FIB_WRITE_SECS = 45; // writing a fake on a board is quicker than typing on a phone
  const WELCOME = ["Write your answers on your dry erase board.", "Hold your board up when the host says.", "Points get bigger every round, and the finale lets you wager."];
  const RULES = {
    trivia: ["A question and choices appear. Write the letter of your answer on your board.", "When the clock ends, hold your board up.", "A correct answer scores."],
    fib: ["The clue appears with a blank. Everyone writes a believable fake ending on their board.", "The host reads some fakes aloud. Then write the letter of the ending you think is real.", "Pick the real one and score. Fool a classmate with your fake and score every time."],
    draw: ["Your set gets a secret story. Draw it on your board, with no words or letters.", "Hold your boards up when told. Everyone else writes the number of the story they think it is.", "Guess right and score. Your set scores when classmates guess your story."],
    final: ["Write your wager on your board, anywhere from nothing up to your whole score. The host records it.", "Then answer the question on your board. The choices are close, so read carefully.", "Right: you win your wager. Wrong: you lose it."]
  };

  // ---------- helpers ----------
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/^(a|an|the) /, "");
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
  const letter = (i) => String.fromCharCode(65 + i);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  // ---------- content: a pack plus any extras ----------
  const EXTRAS_KEY = "rn-offline-extras-v1";
  const validate = (d) => RN_PACK.validate(d);
  let D = null, BASE = null, dataName = "built in", usingLoaded = false, siteExtras = [], userExtras = [];
  try { const d = JSON.parse(store.get(DATA_KEY) || "null"); if (d) { validate(d); BASE = d; dataName = store.get(META_KEY) || "loaded file"; usingLoaded = true; } } catch (e) { BASE = null; }
  if (!BASE) { BASE = JSON.parse($("#clues").textContent); validate(BASE); }
  try { const x = JSON.parse($("#extras").textContent || "null"); if (x) { RN_PACK.validateExtras(x); siteExtras = [{ name: x.name || "Extras", data: x }]; } } catch (e) { siteExtras = []; }
  try { userExtras = JSON.parse(store.get(EXTRAS_KEY) || "[]") || []; } catch (e) { userExtras = []; }
  function rebuildD() { D = RN_PACK.merge(BASE, siteExtras.concat(userExtras).map((x) => x.data)); VO.setPronunciations(D.pronounce); }
  rebuildD();
  const pts = () => D.settings.points || {};
  const timerSecs = (name) => (name === "fibWrite" ? FIB_WRITE_SECS : (D.settings.timers || {})[name] || 30);

  // ---------- state ----------
  let S = null, T = { total: 0, deadline: 0, running: false, ended: false }, lastKey = -1;
  function freshState(keep) {
    const players = (keep || []).map((p) => ({ id: p.id, name: p.name, present: true, pts: D.rounds.map(() => 0) }));
    const nid = players.reduce((m, p) => Math.max(m, parseInt(p.id.slice(1), 10) || 0), 0) + 1;
    return { phase: "setup", key: 0, r: -1, i: 0, rounds: null, players, nid, mark: {}, fakes: [], opts: [], fooled: {}, sets: [], storyOrder: [], wagers: {}, fav: "", undo: [], peek: {}, fcNote: "",
      cfg: { triviaCount: 12, fibClues: 5, setSize: 4, autoTimer: true } };
  }
  try { const s = JSON.parse(store.get(SAVE_KEY) || "null"); if (s && Array.isArray(s.players) && s.cfg) S = s; } catch (e) { S = null; }
  if (!S) S = freshState();
  const save = () => store.set(SAVE_KEY, JSON.stringify(S));
  const player = (id) => S.players.find((p) => p.id === id);
  const present = () => S.players.filter((p) => p.present);
  const total = (p) => p.pts.reduce((a, b) => a + (b || 0), 0);
  const ranked = () => S.players.filter((p) => p.present || total(p) !== 0).sort((a, b) => total(b) - total(a) || a.name.localeCompare(b.name));
  const round = () => (S.rounds && S.r >= 0 ? S.rounds[S.r] : null);
  const mult = () => (round() && round().mult) || 1;
  function ensurePts() { S.players.forEach((p) => { while (p.pts.length < D.rounds.length) p.pts.push(0); }); }
  function addPlayer(name) {
    name = String(name || "").replace(/\s+/g, " ").trim().slice(0, 24);
    if (!name || S.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) return false;
    S.players.push({ id: "p" + S.nid++, name, present: true, pts: D.rounds.map(() => 0) });
    return true;
  }
  function award(d, label) {
    const ri = Math.max(0, S.r), clean = {};
    for (const id in d) { const p = player(id); if (!p || !d[id]) continue; ensurePts(); p.pts[ri] = (p.pts[ri] || 0) + d[id]; clean[id] = d[id]; }
    if (Object.keys(clean).length) { S.undo.push({ label, r: ri, d: clean }); if (S.undo.length > 80) S.undo.shift(); }
  }
  function undo() {
    const u = S.undo.pop(); if (!u) return;
    for (const id in u.d) { const p = player(id); if (p) p.pts[u.r] -= u.d[id]; }
  }

  // ---------- question bank: each game draws a fresh deck ----------
  let seen = {};
  try { seen = JSON.parse(store.get(SEEN_KEY) || "{}") || {}; } catch (e) { seen = {}; }
  const markSeen = (id) => { seen[id] = (seen[id] || 0) + 1; store.set(SEEN_KEY, JSON.stringify(seen)); };
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
    const c = S.cfg;
    return D.rounds.map((r) => {
      const x = JSON.parse(JSON.stringify(r));
      if (r.type === "trivia") x.questions = pick(r.questions, Math.min(c.triviaCount, r.questions.length), (q) => q.q).map(reshuffle);
      else if (r.type === "fib") x.clues = pick(r.clues, Math.min(c.fibClues, r.clues.length), (q) => q.prompt);
      else if (r.type === "draw") x.stories = pick(r.stories, Math.min(r.count || 7, r.stories.length), (q) => q.story);
      else if (r.type === "final") { const f = reshuffle(pick(r.finals || [r], 1, (q) => q.q)[0]); x.q = f.q; x.choices = f.choices; x.answer = f.answer; x.note = f.note; }
      return x;
    });
  }
  function roundPoints(r) {
    const P = pts(), m = r.mult || 1;
    if (r.type === "trivia") return ["Correct answer: " + (P.triviaCorrect || 100) * m];
    if (r.type === "fib") return ["Pick the real ending: " + (P.fibTruth || 100) * m, "Each classmate your fake fools: " + (P.fibFooled || 50) * m];
    if (r.type === "draw") return ["Guess the right story: " + (P.drawCorrect || 100) * m, "Your drawing: up to " + (P.drawArtistMax || 100) * m + ", based on how many guess it", "Class favorite drawing: " + (P.drawFavorite || 50) * m + " bonus"];
    return ["Wager up to your score (up to " + (P.finalMaxWagerFloor || 500) + " if you're lower)", "Right: win your wager. Wrong: lose it"];
  }
  const multWords = (m) => (m === 2 ? "Double points." : m === 3 ? "Triple points." : m > 1 ? "Points times " + m + "." : "");
  const introText = (r) => (r.type === "trivia" ? S.cfg.triviaCount + " questions on what we've studied this year." : r.intro || "");
  const maxWager = (p) => Math.max(total(p), pts().finalMaxWagerFloor || 500);

  // ---------- sets (Sketch It) ----------
  function buildSets(itemCount) {
    const ids = shuffle(present().map((p) => p.id)), n = ids.length, size = S.cfg.setSize || 4;
    let k = Math.max(1, Math.ceil(n / size));
    if (n >= 2) k = Math.max(2, k);
    k = Math.min(k, itemCount, Math.max(n, 1));
    S.sets = n ? Array.from({ length: k }, (_, i) => ({ members: [], item: i })) : [];
    ids.forEach((id, i) => S.sets[i % k].members.push(id));
  }
  const inSet = (id) => !!(S.sets[S.i] && S.sets[S.i].members.includes(id));

  // ---------- sound and voice ----------
  const sfx = (n) => AU.fx(n);
  VO.onDuck = (on) => AU.duck(on);
  VO.onVoices = () => { const d = $("#menuDlg"); if (d && d.open) fillMenu(); };
  function syncMusic() {
    const ph = S.phase;
    let m = "off";
    if (T.running) m = ph === "xw" || ph === "xq" ? "final" : "play";
    else if (ph === "setup") m = "organ";
    else if (ph === "scores" || ph === "end") m = "calm";
    AU.music(m);
  }
  function spokenText() {
    const r = round(), ph = S.phase, choiceLine = (cs) => cs.map((c, i) => letter(i) + ", " + c + ".").join(" ");
    switch (ph) {
      case "rules": return (S.r === 0 ? "Welcome to " + D.title + ". " : "") + "Round " + (S.r + 1) + ". " + r.title + ". " + multWords(r.mult || 1) + " " + introText(r) + " " + RULES[r.type].join(" ");
      case "tq": { const q = r.questions[S.i]; return q.q + " " + choiceLine(q.choices); }
      case "tr": { const q = r.questions[S.i]; return "The answer is " + letter(q.answer) + ", " + q.choices[q.answer] + "."; }
      case "fw": return r.clues[S.i].prompt + " Write a believable fake ending on your board.";
      case "fv": return r.clues[S.i].prompt + " " + choiceLine(S.opts.map((o) => o.text)) + " Write the letter of the real ending.";
      case "fr": { const c = r.clues[S.i]; return "The real answer: " + c.answer + ". " + (c.ref || ""); }
      case "dd": return "Draw your story. No words or letters.";
      case "dg": return "Set " + (S.i + 1) + ", hold up your boards. Everyone else, write the number of the story.";
      case "dr": return "It was: " + r.stories[S.sets[S.i].item].story + ".";
      case "xw": return "Final question: " + r.title + ". Write your wager on your board.";
      case "xq": return r.q + " " + choiceLine(r.choices);
      case "xr": return "The answer is " + letter(r.answer) + ", " + r.choices[r.answer] + ".";
      case "scores": { const t = ranked().slice(0, 3); if (!t.length) return ""; let x = "In first place, " + t[0].name + ", with " + total(t[0]) + " points."; if (t[1]) x += " Then " + t[1].name + (t[2] ? ", and " + t[2].name : "") + "."; return x; }
      case "end": { const t = ranked()[0]; return t ? "Well played. The winner is " + t.name + " with " + total(t) + " points." : "Well played."; }
    }
    return "";
  }

  // ---------- timer ----------
  function resetTimer() { T = { total: 0, deadline: 0, running: false, ended: false }; }
  function startTimer(secs) {
    VO.cancel();
    T = { total: secs * 1000, deadline: Date.now() + secs * 1000, running: true, ended: false };
    syncMusic(); renderControls(); tick();
  }
  function endTimer() {
    if (!T.running) return;
    T.running = false; T.ended = true; sfx("reveal"); syncMusic(); render();
  }
  function tick() {
    const bar = $("#river"), fill = bar.querySelector("i"), clock = $("#clock");
    if (!T.running) { fill.style.width = T.ended ? "0" : "0"; clock.textContent = ""; bar.classList.remove("low"); clock.classList.remove("low"); lastSec = -1; return; }
    const left = Math.max(0, T.deadline - Date.now()), s = Math.ceil(left / 1000);
    fill.style.width = (100 * left / T.total) + "%";
    clock.textContent = s; bar.classList.toggle("low", s <= 5); clock.classList.toggle("low", s <= 5);
    AU.intensity(0.2 + 0.8 * Math.pow(1 - left / T.total, 1.4));
    if (s <= 5 && s > 0 && s !== lastSec) sfx("tick");
    lastSec = s;
    if (left <= 0) endTimer();
  }
  let lastSec = -1;
  setInterval(tick, 200);

  // ---------- phases ----------
  function go(phase) {
    VO.cancel(); resetTimer();
    const r = round(), rev = ["tr", "fr", "dr", "xr"].includes(phase);
    S.phase = phase; S.key++; S.mark = {};
    if (phase === "tq") markSeen(r.questions[S.i].q);
    if (phase === "fw") { S.fakes = [{ text: "", author: "" }, { text: "", author: "" }]; S.opts = []; S.fooled = {}; S.fcNote = ""; markSeen(r.clues[S.i].prompt); }
    if (phase === "dr") S.fav = "";
    if (phase !== "tq" || true) { if (!rev) sfx("whoosh"); else sfx("reveal"); }
    if (phase === "end") setTimeout(() => sfx("end"), 150);
    save(); render(); syncMusic();
    const k = S.key, text = spokenText(), name = TIMED[phase];
    setTimeout(() => {
      if (S.key !== k) return;
      if (name) {
        const secs = timerSecs(name), start = () => { if (S.key === k && !T.running && !T.ended) startTimer(secs); };
        if (VO.enabled() && text) VO.speak(text, start); else if (S.cfg.autoTimer) setTimeout(start, 500);
      } else if (VO.enabled() && text) VO.speak(text, null);
    }, phase === "rules" || phase === "end" ? 600 : 250);
  }
  function begin() {
    ensurePts();
    if (present().length < 1) return;
    S.rounds = buildDeck(); S.r = 0; S.undo = [];
    S.players.forEach((p) => (p.pts = D.rounds.map(() => 0)));
    go("rules");
  }
  function beginRound() {
    const r = round(); S.i = 0;
    if (r.type === "trivia") return go("tq");
    if (r.type === "fib") return go("fw");
    if (r.type === "draw") {
      buildSets(r.stories.length); S.storyOrder = shuffle(r.stories.map((_, i) => i)); S.peek = {};
      S.sets.forEach((s) => markSeen(r.stories[s.item].story));
      if (!S.sets.length) return go("scores");
      return go("da");
    }
    S.wagers = {}; markSeen(r.q); go("xw");
  }
  function buildFibOpts() {
    const c = round().clues[S.i], opts = [{ text: c.answer, truth: true }], truth = [c.answer].concat(c.alt || []);
    S.fcNote = "";
    S.fakes.forEach((f, k) => {
      const t = String(f.text || "").trim().slice(0, 80); if (!t) return;
      if (truth.some((x) => similar(t, x))) { S.fcNote += "Fake " + (k + 1) + " is too close to the real answer, so it was left out. "; return; }
      if (opts.some((o) => similar(t, o.text))) return;
      opts.push({ text: t, truth: false, author: f.author || "", fk: k });
    });
    const house = shuffle(c.house || []);
    while (opts.length < 4 && house.length) { const h = house.pop(); if (!opts.some((o) => norm(o.text) === norm(h))) opts.push({ text: h, truth: false, house: true }); }
    S.opts = shuffle(opts);
  }
  function computeAward() {
    const P = pts(), m = mult(), ph = S.phase, d = {}, add = (id, n) => { d[id] = (d[id] || 0) + n; };
    const marked = present().filter((p) => S.mark[p.id]);
    if (ph === "tr") marked.forEach((p) => add(p.id, (P.triviaCorrect || 100) * m));
    else if (ph === "fr") {
      marked.forEach((p) => add(p.id, (P.fibTruth || 100) * m));
      S.opts.forEach((o) => { if (!o.truth && o.author && player(o.author)) { const n = S.fooled[o.fk] || 0; if (n) add(o.author, n * (P.fibFooled || 50) * m); } });
    } else if (ph === "dr") {
      const set = S.sets[S.i], eligible = present().filter((p) => !set.members.includes(p.id)), right = marked.filter((p) => !set.members.includes(p.id));
      right.forEach((p) => add(p.id, (P.drawCorrect || 100) * m));
      if (eligible.length) set.members.forEach((id) => add(id, Math.round((P.drawArtistMax || 100) * m * right.length / eligible.length)));
      if (S.fav && set.members.includes(S.fav)) add(S.fav, (P.drawFavorite || 50) * m);
    } else if (ph === "xr") {
      present().forEach((p) => { const w = S.wagers[p.id] || 0; if (w) add(p.id, S.mark[p.id] ? w : -w); });
    }
    return d;
  }
  function finishReveal() {
    const r = round(), ph = S.phase;
    const label = r.title + (ph === "tr" ? ", question " + (S.i + 1) : ph === "fr" ? ", clue " + (S.i + 1) : ph === "dr" ? ", set " + (S.i + 1) : ", final");
    award(computeAward(), label);
    if (ph === "tr") { if (S.i + 1 < r.questions.length) { S.i++; go("tq"); } else go("scores"); }
    else if (ph === "fr") { if (S.i + 1 < r.clues.length) { S.i++; go("fw"); } else go("scores"); }
    else if (ph === "dr") { if (S.i + 1 < S.sets.length) { S.i++; go("dg"); } else go("scores"); }
    else go("end");
  }
  function primary() {
    const ph = S.phase;
    if (TIMED[ph]) { if (T.running) return endTimer(); if (!T.ended) { VO.cancel(); return startTimer(timerSecs(TIMED[ph])); } }
    switch (ph) {
      case "setup": return begin();
      case "rules": return beginRound();
      case "tq": return go("tr");
      case "fw": return go("fc");
      case "fc": buildFibOpts(); return go("fv");
      case "fv": return go("fr");
      case "da": return go("dd");
      case "dd": S.i = 0; return go("dg");
      case "dg": return go("dr");
      case "xw": return go("xq");
      case "xq": return go("xr");
      case "tr": case "fr": case "dr": case "xr": return finishReveal();
      case "scores": S.r++; if (S.r >= D.rounds.length) return go("end"); return go("rules");
    }
  }
  function skipRound() {
    const r = round(); if (!r) return;
    if (r.type === "final") return go("end");
    go("scores");
  }
  function primaryLabel() {
    const ph = S.phase, r = round(), n = Object.keys(S.mark).filter((id) => S.mark[id]).length;
    const writing = ["fw", "dd", "xw"].includes(ph);
    if (TIMED[ph]) { if (T.running) return writing ? "Pens down now" : "Boards up now"; if (!T.ended) return "Start timer"; }
    switch (ph) {
      case "setup": return "Start the game";
      case "rules": return "Begin round";
      case "tq": return "Reveal answer";
      case "fw": return "Collect fakes";
      case "fc": return "Show the choices";
      case "fv": return "Reveal";
      case "da": return "Start drawing";
      case "dd": return "Start guessing";
      case "dg": return "Reveal";
      case "xw": return "Show the question";
      case "xq": return "Reveal answer";
      case "tr": return (S.i + 1 < r.questions.length ? "Next question" : "Show standings") + (n ? " · award " + n : "");
      case "fr": return (S.i + 1 < r.clues.length ? "Next clue" : "Show standings") + (n ? " · award " + n : "");
      case "dr": return (S.i + 1 < S.sets.length ? "Next set" : "Show standings") + (n ? " · award " + n : "");
      case "xr": return "Final standings";
      case "scores": return S.r + 1 < D.rounds.length ? "Next round" : "Finish";
    }
    return "";
  }

  // ---------- rendering ----------
  function whereText() {
    const r = round(), ph = S.phase;
    if (ph === "setup") return "Setup";
    if (ph === "end") return "Final scores";
    if (ph === "scores") return "Standings";
    if (!r) return "";
    let t = r.title + ((r.mult || 1) > 1 ? " · ×" + r.mult + " points" : "");
    if (ph === "tq" || ph === "tr") t += ", question " + (S.i + 1) + " of " + r.questions.length;
    if (["fw", "fc", "fv", "fr"].includes(ph)) t += ", clue " + (S.i + 1) + " of " + r.clues.length;
    if (["dg", "dr"].includes(ph)) t += ", set " + (S.i + 1) + " of " + S.sets.length;
    return t;
  }
  const bannerHTML = () => (T.ended ? `<div class="banner">${["fw", "dd", "xw"].includes(S.phase) ? "Pens down!" : "Boards up!"}</div>` : "");
  function tilesHTML(choices, answer, extra) {
    const rev = answer != null;
    return `<div class="tiles ${choices.length > 4 ? "many" : ""}">${choices.map((c, i) => `<div class="tile rise ${rev ? (i === answer ? "right" : "dim") : ""}"><span class="k">${letter(i)}</span><span class="txt">${esc(c)}${extra && extra[i] ? `<span class="by">${esc(extra[i])}</span>` : ""}</span></div>`).join("")}</div>`;
  }
  function markHTML(exclude) {
    const ex = new Set(exclude || []), ps = present();
    if (!ps.length) return `<div class="count">No students are marked present. Open Class to add or restore them.</div>`;
    const n = ps.filter((p) => S.mark[p.id] && !ex.has(p.id)).length;
    return `<div class="mk-head"><span><b>Tap everyone who was right</b> <span class="muted">(${n} marked)</span></span><span><button class="ghost" data-act="markall">All right</button><button class="ghost" data-act="markclear">Clear</button></span></div>
      <div class="mk-grid">${ps.map((p) => `<button class="mk ${S.mark[p.id] && !ex.has(p.id) ? "on" : ""} ${ex.has(p.id) ? "off" : ""}" data-act="mark" data-id="${p.id}" ${ex.has(p.id) ? "disabled" : ""}>${esc(p.name)}<span class="ck">✓</span></button>`).join("")}</div>`;
  }
  function leaderHTML(list, cols) {
    const rows = list.map((p, i) => `<div class="row"><span class="rank">${i + 1}</span><span class="nm">${esc(p.name)}</span><span class="pts">${total(p)}</span></div>`);
    return cols ? `<div class="leader two">${rows.join("")}</div>` : `<div class="leader">${rows.join("")}</div>`;
  }
  function stageHTML() {
    const r = round(), ph = S.phase;
    switch (ph) {
      case "setup": return setupHTML();
      case "rules": {
        const m = r.mult || 1;
        const chips = D.rounds.map((x, i) => `<span class="rchip ${i === S.r ? "on" : i < S.r ? "done" : ""}">${i + 1}</span>`).join("");
        return `<div class="intro"><div class="intro-top rise"><span class="muted">${S.r === 0 ? "Welcome to " + esc(D.title) + ". " : ""}Round ${S.r + 1} of ${D.rounds.length}</span><span class="rchips">${chips}</span></div>
          <div class="intro-title rise"><span class="big">${esc(r.title)}</span>${m > 1 ? `<span class="mult">×${m} points</span>` : ""}</div>
          <p class="lead rise">${esc(introText(r))}</p>
          <div class="cols"><div class="card rise"><h3>How it works</h3><ol>${RULES[r.type].map((x) => `<li>${esc(x)}</li>`).join("")}</ol></div>
          <div class="card rise"><h3>Points${m > 1 ? ` (×${m} this round)` : ""}</h3><ul>${roundPoints(r).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div></div>
          <div class="count rise">${WELCOME.map(esc).join(" · ")}</div></div>`;
      }
      case "tq": case "tr": {
        const q = r.questions[S.i], rev = ph === "tr";
        return bannerHTML() + `<div class="prompt rise">${esc(q.q)}</div>` + tilesHTML(q.choices, rev ? q.answer : null) +
          (rev ? (q.note ? `<div class="note rise">${esc(q.note)}</div>` : "") + markHTML() : `<div class="count">${T.running ? "Write your letter on your board." : T.ended ? "Hold your boards up." : "Get ready…"}</div>`);
      }
      case "fw": return bannerHTML() + `<div class="prompt rise">${esc(r.clues[S.i].prompt)}</div><p class="lead rise">Everyone: write a believable fake ending on your board.</p>`;
      case "fc": {
        const c = r.clues[S.i];
        const rows = S.fakes.map((f, k) => `<div class="fk rise"><input type="text" class="fk-text" data-k="${k}" maxlength="80" placeholder="Student fake ${k + 1} (leave blank to skip)" value="${esc(f.text)}"><select class="fk-author" data-k="${k}"><option value="">Who wrote it?</option>${present().map((p) => `<option value="${p.id}" ${f.author === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>`).join("");
        return `<div class="prompt rise">${esc(c.prompt)}</div><p class="lead rise">Read a few boards and type up to two fakes here. The real answer is not shown. Blank fakes are replaced with house fakes.</p>${rows}`;
      }
      case "fv": case "fr": {
        const rev = ph === "fr", c = r.clues[S.i];
        const extra = S.opts.map((o) => (rev ? (o.truth ? "The real answer" : o.house ? "A house fake" : "Fake by " + (player(o.author) ? player(o.author).name : "a student")) : ""));
        let h = bannerHTML() + (S.fcNote ? `<div class="warn">${esc(S.fcNote)}</div>` : "") + `<div class="prompt rise">${esc(c.prompt)}</div>` + tilesHTML(S.opts.map((o) => o.text), rev ? S.opts.findIndex((o) => o.truth) : null, extra);
        if (!rev) return h + `<div class="count">${T.ended ? "Hold your boards up." : "Write the letter of the real ending on your board."}</div>`;
        const st = S.opts.filter((o) => !o.truth && o.author && player(o.author));
        h += `<div class="note"><b>${esc(c.ref || "")}</b></div>`;
        if (st.length) h += `<div class="card"><h3>How many classmates picked each student fake?</h3>${st.map((o) => `<div class="stepper"><button class="ghost" data-act="fool-" data-k="${o.fk}">−</button><b>${S.fooled[o.fk] || 0}</b><button class="ghost" data-act="fool+" data-k="${o.fk}">+</button> <span>${esc(player(o.author).name)}: “${esc(o.text)}”</span></div><br>`).join("")}</div>`;
        return h + markHTML();
      }
      case "da": {
        const st = r.stories;
        const cards = S.sets.map((s, i) => `<div class="setcard rise"><h3>Set ${i + 1}</h3><div>${s.members.map((id) => esc(player(id) ? player(id).name : "")).join(", ")}</div>
          <div class="story ${S.peek[i] ? "" : "hide"}">${S.peek[i] ? esc(st[s.item].story) : "Story hidden"}</div><button class="ghost" data-act="peek" data-i="${i}">${S.peek[i] ? "Hide story" : "Show story"}</button></div>`).join("");
        return `<div class="big rise">Sketch It: sets</div><p class="lead rise">Give each set its secret story. Print cards to hand out, or show one story at a time and hide it again. The projector shows whatever is on this screen.</p>
          <div class="btnrow"><button class="ghost" data-act="printcards">Print story cards</button><button class="ghost" data-act="reshuffle">Reshuffle sets</button></div><div class="setgrid">${cards}</div>`;
      }
      case "dd": return bannerHTML() + `<div class="big rise">Draw your story</div><p class="lead rise">No words or letters. Everyone in a set draws the same story.</p><div class="setgrid">${S.sets.map((s, i) => `<div class="setcard"><h3>Set ${i + 1}</h3>${s.members.map((id) => esc(player(id) ? player(id).name : "")).join(", ")}</div>`).join("")}</div>`;
      case "dg": case "dr": {
        const set = S.sets[S.i], rev = ph === "dr", right = r.stories[set.item];
        const list = S.storyOrder.map((si, pos) => `<div class="${rev && si === set.item ? "right" : rev ? "muted" : ""}"><span class="n">${pos + 1}</span>${esc(r.stories[si].story)}</div>`).join("");
        let h = bannerHTML() + `<div class="prompt rise" style="margin-bottom:.2em">${rev ? esc(right.story) + ` <span class="muted" style="font-weight:400">${esc(right.ref || "")}</span>` : "Set " + (S.i + 1) + ": hold up your boards"}</div>
          <p class="lead rise">${esc(set.members.map((id) => (player(id) ? player(id).name : "")).join(", "))}</p>
          ${rev ? "" : `<div class="count">Everyone else: write the number of the story you think it is.</div>`}<div class="storylist">${list}</div>`;
        if (rev) {
          h += `<div class="mk-head"><span><b>Class favorite drawing</b> <select data-act-change="fav"><option value="">None</option>${set.members.map((id) => `<option value="${id}" ${S.fav === id ? "selected" : ""}>${esc(player(id) ? player(id).name : "")}</option>`).join("")}</select></span></div>` + markHTML(set.members);
        }
        return h;
      }
      case "xw": {
        const rows = present().map((p) => `<tr><td>${esc(p.name)}</td><td class="num">${total(p)}</td><td class="num">${maxWager(p)}</td><td><input type="number" min="0" max="${maxWager(p)}" step="10" data-w="${p.id}" value="${S.wagers[p.id] || 0}"></td></tr>`).join("");
        return bannerHTML() + `<div class="muted rise">Final question</div><div class="big rise">${esc(r.title)}</div><p class="lead rise">Write your wager on your board. The host enters each wager below, then shows the question.</p>
          <div class="card"><table class="t"><tr><th>Student</th><th style="text-align:right">Score</th><th style="text-align:right">Max wager</th><th>Wager</th></tr>${rows}</table></div>`;
      }
      case "xq": case "xr": {
        const rev = ph === "xr";
        let h = bannerHTML() + `<div class="prompt rise">${esc(r.q)}</div>` + tilesHTML(r.choices, rev ? r.answer : null);
        if (!rev) return h + `<div class="count">${T.ended ? "Hold your boards up." : "Write the letter of your answer on your board."}</div>`;
        if (r.note) h += `<div class="note">${esc(r.note)}</div>`;
        const prev = present().filter((p) => S.wagers[p.id]).map((p) => `<span class="chip"><span class="${S.mark[p.id] ? "gain" : "loss"}">${S.mark[p.id] ? "+" : "−"}${S.wagers[p.id]}</span> ${esc(p.name)}</span>`).join("");
        return h + markHTML() + (prev ? `<div class="card"><h3>Wagers</h3><div class="chips">${prev}</div></div>` : "");
      }
      case "scores": return `<div class="big rise">Standings</div>` + `<div class="rise">${leaderHTML(ranked(), ranked().length > 10)}</div>`;
      case "end": {
        const rk = ranked(), top = rk.slice(0, 3), hgt = [8, 5.5, 4], ord = [1, 0, 2];
        return `<div class="big rise" style="text-align:center">Well played</div><div class="podium rise">${ord.filter((i) => top[i]).map((i) => `<div class="p"><div class="nm">${esc(top[i].name)}</div><div class="muted">${total(top[i])}</div><div class="blk" style="height:${hgt[i]}em;background:${["#F4B942", "#9DB4C0", "#C98A55"][i]}">${i + 1}</div></div>`).join("")}</div>
          ${leaderHTML(rk, true)}<div class="btnrow"><button class="primary" data-act="csv">Download scores (CSV)</button><button class="ghost" data-act="backup">Save backup file</button><button class="ghost" data-act="printscores">Print scores</button></div>`;
      }
    }
    return "";
  }
  function setupHTML() {
    const c = S.cfg;
    return `<div class="setup"><div class="big rise">Review Night <span class="badge">offline</span></div>
      <p class="lead rise">Backup version. Students answer on dry erase boards; you tap who got each one right and the game keeps score. No internet needed.</p>
      <div class="card rise"><h3>Class</h3>${classPanel()}</div>
      <div class="card rise"><h3>Game length</h3><div class="cfg">
        <label>Quick Quiz questions<input type="number" id="cfgTrivia" min="3" max="40" value="${c.triviaCount}"></label>
        <label>Fake Out clues<input type="number" id="cfgFib" min="2" max="12" value="${c.fibClues}"></label>
        <label>Students per Sketch It set<input type="number" id="cfgSet" min="2" max="8" value="${c.setSize}"></label>
        <label class="chk"><input type="checkbox" id="cfgAuto" ${c.autoTimer ? "checked" : ""}> Start timers automatically</label></div>
        <div class="count">A game with 20 students runs about 35 to 40 minutes at these settings. This is my estimate, so time a practice round.</div></div>
      <div class="card rise"><h3>Content</h3>${contentSummary()}<div class="count">Open the More menu to load a different content file.</div></div></div>`;
  }
  function classPanel() {
    const setup = S.phase === "setup";
    if (setup) {
      return `<label>Add students (one name per line)<textarea id="addNames" placeholder="Ann&#10;Ben&#10;Cal"></textarea></label><div class="btnrow"><button class="primary" data-act="addnames">Add</button></div>
        ${S.players.length ? `<div class="chips">${S.players.map((p) => `<span class="chip ${p.present ? "" : "off"}"><button data-act="togglepresent" data-id="${p.id}" title="Tap to mark absent or here">${esc(p.name)}</button><button class="chipx" data-act="rm" data-id="${p.id}" aria-label="Remove ${esc(p.name)}">${S.confirmRm === p.id ? "Sure?" : "×"}</button></span>`).join("")}</div>
        <div class="count">${present().length} here. Tap a name to mark that student absent or here. Tap × to remove. You can add late arrivals during the game from Class.</div>` : `<div class="muted">No students yet. Add names above.</div>`}`;
    }
    const rows = S.players.map((p) => `<tr><td><input type="checkbox" data-act-change="present" data-id="${p.id}" ${p.present ? "checked" : ""} aria-label="Present"></td><td>${esc(p.name)}</td>
      ${setup ? "" : `<td class="num">${total(p)}</td>`}<td>${setup ? "" : `<button class="ghost" data-act="adj" data-id="${p.id}" data-d="-100">−100</button> <button class="ghost" data-act="adj" data-id="${p.id}" data-d="100">+100</button> `}
      <button class="ghost" data-act="rm" data-id="${p.id}">${S.confirmRm === p.id ? "Sure?" : "Remove"}</button></td></tr>`).join("");
    const last = S.undo[S.undo.length - 1];
    return `${S.players.length ? `<table class="t"><tr><th>Here</th><th>Name</th>${setup ? "" : `<th style="text-align:right">Points</th>`}<th></th></tr>${rows}</table>` : `<div class="muted">No students yet. Add names below.</div>`}
      <label>Add students (one name per line)<textarea id="addNames" placeholder="Ann&#10;Ben&#10;Cal"></textarea></label>
      <div class="btnrow"><button class="primary" data-act="addnames">Add</button>${S.phase !== "setup" ? `<button class="ghost" data-act="undo" ${last ? "" : "disabled"}>Undo last award${last ? ": " + esc(last.label) : ""}</button>` : ""}</div>
      <div class="count">Untick Here for absent students. Students added after the game starts begin with 0 points and join the next question.</div>`;
  }
  function renderControls() {
    const c = $("#controls"), ph = S.phase, last = S.undo[S.undo.length - 1], r = round();
    const lbl = primaryLabel();
    c.innerHTML = (ph !== "setup" ? `<button class="ghost" data-act="class">Class</button>` : "") +
      `<button class="ghost" data-act="sound">${AU.muted() ? "Sound off" : AU.blocked() ? "Tap for sound" : "Sound on"}</button>` +
      (VO.supported ? `<button class="ghost" data-act="voice">${VO.enabled() ? "Voice on" : "Voice off"}</button>` : "") +
      `<button class="ghost" data-act="menu">More</button>` +
      (last && ph !== "setup" && ["tq", "fw", "fv", "dg", "da", "dd", "xw", "xq", "rules", "scores"].includes(ph) ? `<button class="ghost" data-act="undo">Undo</button>` : "") +
      (r && !["scores", "end"].includes(ph) ? `<button class="ghost" data-act="skip">Skip round</button>` : "") +
      (T.running ? `<button class="ghost" data-act="add15">+15s</button>` : "") +
      (lbl ? `<button class="primary" data-act="next" ${ph === "setup" && !present().length ? "disabled" : ""}>${esc(lbl)}</button>` : "");
  }
  function render() {
    const st = $("#stage"), fresh = S.key !== lastKey; lastKey = S.key;
    st.classList.toggle("fresh", fresh);
    $("#title").textContent = D.title;
    $("#where").textContent = whereText();
    st.innerHTML = stageHTML();
    renderControls();
    const cd = $("#classDlg"); if (cd.open) $("#classBody").innerHTML = classPanel();
    save();
  }

  // ---------- actions ----------
  function act(a, el) {
    switch (a) {
      case "next": return primary();
      case "skip": return confirmAsk("Skip the rest of this round?", skipRound);
      case "add15": if (T.running) { T.deadline += 15000; T.total += 15000; } return;
      case "mark": S.mark[el.dataset.id] = !S.mark[el.dataset.id]; return render();
      case "markall": present().forEach((p) => { if (!(S.phase === "dr" && inSet(p.id))) S.mark[p.id] = true; }); return render();
      case "markclear": S.mark = {}; return render();
      case "fool+": S.fooled[el.dataset.k] = (S.fooled[el.dataset.k] || 0) + 1; return render();
      case "fool-": S.fooled[el.dataset.k] = Math.max(0, (S.fooled[el.dataset.k] || 0) - 1); return render();
      case "togglepresent": { const p = player(el.dataset.id); if (p) p.present = !p.present; return render(); }
      case "peek": S.peek[el.dataset.i] = !S.peek[el.dataset.i]; return render();
      case "reshuffle": buildSets(round().stories.length); S.peek = {}; return render();
      case "printcards": return printCards();
      case "printscores": return printScores();
      case "class": $("#classBody").innerHTML = classPanel(); return $("#classDlg").showModal();
      case "menu": fillMenu(); return $("#menuDlg").showModal();
      case "sound": if (AU.blocked() && !AU.muted()) AU.unlock(); else AU.setMuted(!AU.muted()); return setTimeout(renderControls, 250);
      case "voice": VO.setEnabled(!VO.enabled()); return renderControls();
      case "addnames": { const ta = $("#addNames"); let n = 0; (ta ? ta.value : "").split(/\r?\n|,/).forEach((x) => { if (addPlayer(x)) n++; }); if (ta) ta.value = ""; ensurePts(); return render(); }
      case "adj": { const d = {}; d[el.dataset.id] = parseInt(el.dataset.d, 10); award(d, "Manual adjustment"); return render(); }
      case "rm": if (S.confirmRm === el.dataset.id) { S.players = S.players.filter((p) => p.id !== el.dataset.id); S.confirmRm = null; delete S.mark[el.dataset.id]; } else S.confirmRm = el.dataset.id; return render();
      case "undo": undo(); return render();
      case "csv": return download("review-night-scores-" + dateStamp() + ".csv", csvText(), "text/csv;charset=utf-8");
      case "backup": return download("review-night-backup-" + dateStamp() + ".json", JSON.stringify({ app: "review-night-offline", savedAt: new Date().toISOString(), state: S, clues: BASE }), "application/json");
      case "newgame": return confirmAsk("Start a new game? Scores are cleared. The class list stays.", () => { const keep = S.players; S = freshState(keep); VO.cancel(); resetTimer(); store.del(SAVE_KEY); $("#menuDlg").close(); render(); syncMusic(); });
      case "resetseen": seen = {}; store.del(SEEN_KEY); { const m = $("#seenMsg"); if (m) m.textContent = "Cleared. The next game can draw any question."; } return;
      case "builtin": store.del(DATA_KEY); store.del(META_KEY); store.del(EXTRAS_KEY); return location.reload();
      case "rmextras": userExtras = []; store.set(EXTRAS_KEY, "[]"); rebuildD(); S.rounds = null; save(); fillMenu(); return render();
      case "closemenu": return $("#menuDlg").close();
      case "closeclass": return $("#classDlg").close();
      case "voicetest": return VO.speak("Which scripture says, I will go and do? A, 1 Nephi 3:7. B, John 3:16.", null, true);
    }
  }
  let askYes = null;
  function confirmAsk(text, yes) { $("#confirmText").textContent = text; askYes = yes; $("#confirm").showModal(); }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (b && !b.disabled) act(b.dataset.act, b);
    if (e.target.id === "confirmYes") { $("#confirm").close(); if (askYes) askYes(); }
    if (e.target.id === "confirmNo") $("#confirm").close();
  });
  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.actChange === "present") { const p = player(t.dataset.id); if (p) { p.present = t.checked; save(); render(); } }
    else if (t.dataset.actChange === "fav") { S.fav = t.value; save(); }
    else if (t.classList.contains("fk-author")) { S.fakes[+t.dataset.k].author = t.value; save(); }
    else if (t.dataset.w) { const p = player(t.dataset.w); let v = Math.floor(Number(t.value)) || 0; v = Math.max(0, Math.min(v, maxWager(p))); t.value = v; S.wagers[p.id] = v; save(); }
    else if (t.id === "cfgTrivia") S.cfg.triviaCount = Math.max(3, Math.min(40, parseInt(t.value, 10) || 12));
    else if (t.id === "cfgFib") S.cfg.fibClues = Math.max(2, Math.min(12, parseInt(t.value, 10) || 5));
    else if (t.id === "cfgSet") S.cfg.setSize = Math.max(2, Math.min(8, parseInt(t.value, 10) || 4));
    else if (t.id === "cfgAuto") S.cfg.autoTimer = t.checked;
    else if (t.id === "clueFile") loadClueFile(t.files[0]);
    else if (t.id === "backupFile") loadBackup(t.files[0]);
    else if (t.id === "vSel") VO.setVoice(t.value);
    else if (t.id === "vOn") { VO.setEnabled(t.checked); renderControls(); }
    if (t.id && t.id.startsWith("cfg")) save();
  });
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t.classList.contains("fk-text")) { S.fakes[+t.dataset.k].text = t.value; save(); }
    else if (t.id === "vRate") VO.setRate(t.value);
  });
  document.addEventListener("keydown", (e) => {
    const tag = e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || document.querySelector("dialog[open]")) return;
    if (e.key === " " || e.key === "ArrowRight") { e.preventDefault(); if (primaryLabel()) primary(); }   // always moves the game on, even if a button has focus
    else if (e.key === "Enter" && tag !== "BUTTON") { e.preventDefault(); if (primaryLabel()) primary(); }
    else if (e.key.toLowerCase() === "m") act("sound");
    else if (e.key.toLowerCase() === "v" && VO.supported) act("voice");
  });
  document.addEventListener("keyup", (e) => {
    const tag = e.target.tagName;
    if (e.key === " " && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT" && !document.querySelector("dialog[open]")) e.preventDefault();
  });
  document.querySelectorAll("dialog").forEach((d) => d.addEventListener("close", () => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); }));
  const unlockOnce = () => { if (AU.blocked()) { AU.unlock(); setTimeout(renderControls, 300); } };
  window.addEventListener("pointerdown", unlockOnce, true);
  window.addEventListener("keydown", unlockOnce, true);

  // ---------- menu: voice, clue file, export, backups ----------
  function fillMenu() {
    const vs = VO.voices().slice().sort((a, b) => (b.local ? 1 : 0) - (a.local ? 1 : 0)), cur = VO.chosen() || VO.voiceName(), anyLocal = vs.some((v) => v.local);
    $("#menuBody").innerHTML = `<h3>Voice</h3>${VO.supported ? `<label class="chk"><input type="checkbox" id="vOn" ${VO.enabled() ? "checked" : ""}> Read questions aloud</label>
        <label>Voice<select id="vSel">${vs.map((v) => `<option value="${esc(v.name)}" ${v.name === cur ? "selected" : ""}>${esc(v.name)} (${esc(v.lang)})${v.local ? " · works offline" : " · needs internet"}</option>`).join("")}</select></label>
        ${anyLocal || !vs.length ? "" : `<div class="warn">No voices stored on this computer were found. Voices that need internet may not speak offline, so turn Voice off if it is silent.</div>`}
        <label>Speed<input type="range" id="vRate" min="0.7" max="1.3" step="0.05" value="${VO.rate()}"></label><div><button class="ghost" data-act="voicetest">Test voice</button></div>` : `<p class="muted">This browser can't read aloud.</p>`}
      <hr><h3>Scores and backups</h3><div class="btnrow"><button class="ghost" data-act="csv">Download scores (CSV)</button><button class="ghost" data-act="backup">Save backup file</button><button class="ghost" data-act="printscores">Print scores</button></div>
      <label>Restore a backup file<input type="file" id="backupFile" accept=".json,application/json"></label>
      <hr><h3>Content</h3>${contentSummary()}
      <label>Load a content file<input type="file" id="clueFile" accept=".json,application/json"></label><div class="muted">A full pack replaces the content. An extras file adds to it.</div><div id="clueErr" class="warn"></div>
      <div class="btnrow"><button class="ghost" data-act="builtin">Back to the built-in content</button>${userExtras.length ? `<button class="ghost" data-act="rmextras">Remove my extras</button>` : ""}<button class="ghost" data-act="resetseen">Reset question history</button> <span id="seenMsg" class="muted"></span></div>
      <hr><div class="btnrow"><button class="ghost" data-act="newgame">New game (keep class list)</button></div>`;
  }
  function contentSummary() {
    const sm = RN_PACK.summary(D), all = siteExtras.concat(userExtras);
    return `<div>Using: <b>${esc(D.title)}</b>${D.course ? " · " + esc(D.course) : ""} <span class="muted">(${esc(dataName)})</span></div><div class="muted">${sm.lines.map(esc).join(" · ")}</div>
      ${all.length ? `<div class="muted">Extras: ${all.map((x) => esc(x.name)).join(", ")}</div>` : ""}
      ${sm.warnings.length ? `<div class="warn" style="font-size:.85em">${sm.warnings.slice(0, 5).map(esc).join("<br>")}${sm.warnings.length > 5 ? "<br>…and " + (sm.warnings.length - 5) + " more." : ""}</div>` : ""}`;
  }
  function loadClueFile(f) {
    if (!f) return;
    f.text().then((t) => {
      const d = JSON.parse(t);
      if (RN_PACK.isExtras(d)) { RN_PACK.validateExtras(d); userExtras.push({ name: d.name || f.name, data: d }); store.set(EXTRAS_KEY, JSON.stringify(userExtras)); }
      else { validate(d); BASE = d; dataName = f.name; usingLoaded = true; store.set(DATA_KEY, t); store.set(META_KEY, f.name); }
      rebuildD(); ensurePts(); S.rounds = null;
      if (S.phase !== "setup") { S = freshState(S.players); }
      save(); $("#menuDlg").close(); render();
    }).catch((e) => { $("#clueErr").textContent = "That file could not be used: " + e.message; });
  }
  function loadBackup(f) {
    if (!f) return;
    f.text().then((t) => { const o = JSON.parse(t); if (!o || !o.state || !Array.isArray(o.state.players)) throw new Error("not a Review Night backup."); if (o.clues) { validate(o.clues); BASE = o.clues; dataName = "from backup"; usingLoaded = true; store.set(DATA_KEY, JSON.stringify(o.clues)); store.set(META_KEY, dataName); rebuildD(); } S = o.state; VO.cancel(); resetTimer(); save(); $("#menuDlg").close(); render(); syncMusic(); })
      .catch((e) => { $("#clueErr").textContent = "That backup could not be used: " + e.message; });
  }
  const dateStamp = () => new Date().toISOString().slice(0, 10);
  function csvText() {
    const q = (x) => '"' + String(x).replace(/"/g, '""') + '"';
    const head = ["Name", "Present"].concat(D.rounds.map((r) => r.title)).concat(["Total"]);
    const rows = S.players.map((p) => [p.name, p.present ? "yes" : "no"].concat(D.rounds.map((_, i) => p.pts[i] || 0)).concat([total(p)]));
    return "\ufeff" + [head].concat(rows).map((r) => r.map(q).join(",")).join("\r\n") + "\r\n";
  }
  function download(name, text, mime) {
    const a = document.createElement("a"), url = URL.createObjectURL(new Blob([text], { type: mime }));
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
  }
  function printNow(html) {
    $("#printArea").innerHTML = html; document.body.classList.add("printing");
    const done = () => { document.body.classList.remove("printing"); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done); try { window.print(); } catch (e) { done(); }
  }
  function printCards() {
    const r = round(); if (!r) return;
    printNow(S.sets.map((s, i) => `<div class="pcard"><h2>Set ${i + 1}</h2><div class="who">${s.members.map((id) => esc(player(id) ? player(id).name : "")).join(", ")}</div><div class="st">${esc(r.stories[s.item].story)}</div></div>`).join(""));
  }
  function printScores() {
    const head = "<tr><th>Name</th>" + D.rounds.map((r) => `<th>${esc(r.title)}</th>`).join("") + "<th>Total</th></tr>";
    printNow(`<h2>${esc(D.title)}</h2><table class="ptab">${head}${S.players.map((p) => `<tr><td>${esc(p.name)}${p.present ? "" : " (absent)"}</td>${D.rounds.map((_, i) => `<td>${p.pts[i] || 0}</td>`).join("")}<td><b>${total(p)}</b></td></tr>`).join("")}</table>`);
  }

  // ---------- boot ----------
  ensurePts();
  render(); syncMusic();
  window.RN_OFFLINE = { state: () => S, primary, timer: () => T, data: () => D };
})();

