// host.js: the board. Holds the whole game state, scores everything,
// and sends each phone exactly what it should show.
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const cfg = window.RN_CONFIG || {};
  const SAVE_KEY = "rn-host-state-v1";
  const DATA_KEY = "rn-host-data-v1";
  const COLORS = ["#F4B942", "#63D2A6", "#FF7A66", "#7FB2FF", "#C79BFF", "#FF9BD2", "#9BE15D", "#4FD1D9", "#FFB27A", "#B8C4FF"];
  const SET_PHASES = ["fw", "fready", "fg", "fr", "dw", "dready", "dg", "dr", "aw", "aready", "ag", "ar", "xw", "xq", "xr", "end"];
  // Timer name per phase. True or False uses "tf" in the tq phase (see timerFor).
  const TIMED = { tq: "trivia", oq: "order", fw: "fibWrite", fg: "fibGuess", dw: "drawDraw", dg: "drawGuess", aw: "applyWrite", ag: "applyVote", xw: "finalWager", xq: "finalQuestion" };
  const DEFAULT_TIMERS = { trivia: 30, tf: 12, order: 45, fibWrite: 90, fibGuess: 40, drawDraw: 120, drawGuess: 40, applyWrite: 75, applyVote: 30, finalWager: 40, finalQuestion: 50 };
  const DEFAULT_COUNT = { trivia: 10, tf: 10, order: 5, fib: 8, draw: 7, apply: 6 };
  const PLAN_KEY = "rn-plan-v1";

  const EXTRAS_KEY = "rn-host-extras-v1";
  let D = null;            // the content the game uses: BASE plus any extras
  let BASE = null;         // the main content pack
  let siteExtras = [];     // extras files named in config.js
  let userExtras = [];     // extras files loaded on the setup screen
  let usingLoaded = false; // true when BASE came from a file loaded here, not the site
  const loadUserExtras = () => { try { userExtras = JSON.parse(localStorage.getItem(EXTRAS_KEY) || "[]") || []; } catch (e) { userExtras = []; } };
  const saveExtras = () => { try { localStorage.setItem(EXTRAS_KEY, JSON.stringify(userExtras)); } catch (e) {} };
  function rebuildD() {
    if (!BASE) return;
    D = RN_PACK.merge(BASE, siteExtras.concat(userExtras).map((x) => x.data));
    if (window.RN_VOICE) RN_VOICE.setPronunciations(D.pronounce);
  }
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
  // ---------- tonight's rounds: which rounds, in what order, and the final wager ----------
  // The host picks rounds on the setup screen. Multipliers follow the position (settings.multipliers,
  // default 1, 2, 3; the last value repeats). The final wager comes after the last round's standings.
  const planKey = () => [D.title, D.course || "", D.rounds.map((r) => r.type + ":" + (r.title || "")).join(",")].join("|");
  const playableIdx = () => D.rounds.map((r, i) => i).filter((i) => RN_PACK.PLAYABLE.includes(D.rounds[i].type));
  function getPlan() {
    const all = playableIdx(), def = { order: all, wager: set().finalWager !== false, vote: set().vote !== false };
    let saved = null;
    try { saved = (JSON.parse(localStorage.getItem(PLAN_KEY) || "{}") || {})[planKey()]; } catch (e) {}
    if (!saved || !Array.isArray(saved.order)) return def;
    const order = saved.order.filter((i, k, a) => all.includes(i) && a.indexOf(i) === k);
    return { order: order.length ? order : all, wager: saved.wager !== false, vote: saved.vote == null ? def.vote : saved.vote !== false };
  }
  function savePlan(plan) {
    try { const all = JSON.parse(localStorage.getItem(PLAN_KEY) || "{}") || {}; all[planKey()] = plan; localStorage.setItem(PLAN_KEY, JSON.stringify(all)); } catch (e) {}
  }
  function multFor(pos) { const m = set().multipliers || [1, 2, 3]; return Number(m[Math.min(pos, m.length - 1)]) || 1; }
  const roundTitle = (r) => r.title || (RN_PACK.DEFAULTS[r.type] || {}).title || r.type;
  const tfQuestion = (x) => ({ q: x.s, choices: ["True", "False"], answer: x.a ? 0 : 1, note: x.note || "", fixed: true, tf: true });
  function orderPuzzle(x) {
    const ids = x.items.map((_, i) => i);
    let shown = shuffle(ids), tries = 0;
    while (shown.every((v, i) => v === i) && tries++ < 10) shown = shuffle(ids);
    return Object.assign({}, x, { shown });
  }
  // ---------- students vote on the games ----------
  // The host's ticked rounds are the ballot. Each student picks up to settings.votePicks (3).
  // At the start, the top settings.maxRounds (5) are played, least popular first, favorite last.
  // Games nobody picked are left out. With no votes at all, the host's order is used.
  const votePicks = () => set().votePicks || 3;
  const votingOn = () => { if (!D || !S || !S.code) return false; const p = getPlan(); return p.vote && p.order.length >= 2; };
  function voteTally() {
    const menu = getPlan().order, n = {};
    menu.forEach((i) => (n[i] = 0));
    for (const pid in S.votes || {}) {
      if (!S.players[pid] || S.removed[pid]) continue;
      S.votes[pid].forEach((i) => { if (i in n) n[i]++; });
    }
    return menu.map((i) => ({ i, n: n[i] }));
  }
  function votedOrder(plan) {
    const t = voteTally();
    if (!t.some((x) => x.n > 0)) return plan.order;
    const ranked = shuffle(t.filter((x) => x.n > 0)).sort((a, b) => b.n - a.n).slice(0, set().maxRounds || 5);
    S.voteResult = ranked.map((x) => ({ title: roundTitle(D.rounds[x.i]), n: x.n }));
    return ranked.reverse().map((x) => x.i);
  }
  const GAME_BLURB = { trivia: "Multiple-choice questions", tf: "Fast true or false", order: "Put things in the right order", fib: "Write fakes, find the real answer", draw: "Draw it, guess it", apply: "Apply a scripture, vote on answers" };
  function buildDeck() {
    const plan = getPlan();
    if (plan.vote && plan.order.length >= 2) plan.order = votedOrder(plan);
    const deck = plan.order.map((ri, pos) => {
      const r = D.rounds[ri], def = RN_PACK.DEFAULTS[r.type] || {};
      const c = JSON.parse(JSON.stringify(r));
      c.title = roundTitle(r); c.intro = r.intro != null ? r.intro : def.intro || ""; c.rules = r.rules || def.rules || [];
      c.mult = multFor(pos);
      // The last round draws one extra item to use as the final wager question.
      const extra = plan.wager && pos === plan.order.length - 1 ? 1 : 0;
      const n = (len) => Math.min((r.count || DEFAULT_COUNT[r.type] || len) + extra, len);
      const take = (list) => { if (extra && list.length >= 2) c._wager = list.pop(); return list; };
      if (r.type === "trivia") c.questions = take(pick(r.questions, n(r.questions.length), (q) => q.q).map(reshuffle));
      else if (r.type === "tf") c.questions = take(pick(r.statements, n(r.statements.length), (x) => x.s).map(tfQuestion));
      else if (r.type === "order") c.puzzles = take(pick(r.puzzles, n(r.puzzles.length), (x) => x.prompt).map(orderPuzzle));
      else if (r.type === "fib") c.clues = take(pick(r.clues, n(r.clues.length), (x) => x.prompt));
      else if (r.type === "draw") c.stories = pick(r.stories, Math.min(r.count || DEFAULT_COUNT.draw, r.stories.length), (x) => x.story);
      else if (r.type === "apply") c.prompts = pick(r.prompts, Math.min(r.count || DEFAULT_COUNT.apply, r.prompts.length), (x) => x.prompt);
      return c;
    });
    const last = deck[deck.length - 1];
    S.wagerQ = plan.wager && last ? wagerFrom(last, deck) : null;
    deck.forEach((c) => delete c._wager);
    S.wagerDone = false;
    return deck;
  }
  // The final wager question: one more item from the last round when that round has right answers,
  // otherwise a question from the pack's finals bank, then a Quick Quiz or True or False item.
  function wagerFrom(c, deck) {
    const w = c._wager, src = c.title;
    if (w && c.type === "trivia") return Object.assign({ kind: "choice", src }, w);
    if (w && c.type === "tf") return Object.assign({ kind: "choice", src }, w);
    if (w && c.type === "order") return Object.assign({ kind: "order", src }, w);
    if (w && c.type === "fib" && (w.house || []).length) {
      const ch = shuffle([w.answer].concat(shuffle(w.house).slice(0, 4)));
      return { kind: "choice", src, q: w.prompt, choices: ch, answer: ch.indexOf(w.answer), note: w.ref || "" };
    }
    const used = new Set();
    deck.forEach((x) => (x.questions || []).forEach((q) => used.add(q.q)));
    const fin = D.rounds.find((r) => r.type === "final");
    if (fin) { const f = reshuffle(pick(fin.finals || [fin], 1, (x) => x.q)[0]); return { kind: "choice", src: fin.title || "Final question", q: f.q, choices: f.choices, answer: f.answer, note: f.note || "" }; }
    for (const r of D.rounds) {
      if (r.type === "trivia") { const q = r.questions.filter((x) => !used.has(x.q)); if (q.length) return Object.assign({ kind: "choice", src: roundTitle(r) }, reshuffle(pick(q, 1, (x) => x.q)[0])); }
      if (r.type === "tf") { const q = r.statements.filter((x) => !used.has(x.s)); if (q.length) return Object.assign({ kind: "choice", src: roundTitle(r) }, tfQuestion(pick(q, 1, (x) => x.s)[0])); }
    }
    return null;
  }
  const ensureDeck = () => { if (!S.rounds) S.rounds = buildDeck(); };
  const isLast = (r) => !!(S && S.rounds && S.rounds[S.rounds.length - 1] === r);
  function roundPoints(r) {
    const P = pts(), m = r.mult || 1;
    let out;
    if (r.type === "trivia") out = ["Correct answer: " + (P.triviaCorrect || 100) * m, "Speed bonus: up to " + (P.triviaSpeedBonus || 0) * m + " more"];
    else if (r.type === "tf") out = ["Correct answer: " + (P.tfCorrect || 50) * m, "Speed bonus: up to " + (P.tfSpeedBonus || 0) * m + " more"];
    else if (r.type === "order") out = ["Each item in the right place: " + (P.orderPerItem || 25) * m, "Perfect order bonus: " + (P.orderPerfect || 50) * m];
    else if (r.type === "fib") out = ["Pick the real ending: " + (P.fibTruth || 100) * m, "Each classmate your fake fools: " + (P.fibFooled || 50) * m];
    else if (r.type === "draw") out = ["Guess the right story: " + (P.drawCorrect || 100) * m, "Your drawing: up to " + (P.drawArtistMax || 100) * m + ", based on how many guess it", "Class favorite drawing: " + (P.drawFavorite || 50) * m + " bonus"];
    else if (r.type === "apply") out = ["Each vote for your answer: " + (P.applyVote || 50) * m, "Top answer in your set: " + (P.applyWin || 100) * m + " bonus"];
    else out = [];
    if (isLast(r) && S.wagerQ) out.push("Then the final wager: bet up to your score (or " + (P.finalMaxWagerFloor || 500) + " if you're lower) on one last question");
    return out;
  }
  const multWords = (m) => (m === 2 ? "Double points." : m === 3 ? "Triple points." : m > 1 ? "Points times " + m + "." : "");
  const set = () => D.settings || {};
  const pts = () => (set().points || {});
  const timerSecs = (name) => ((set().timers || {})[name] || DEFAULT_TIMERS[name] || 30);
  const timerFor = (phase) => (phase === "tq" && round() && round().type === "tf" ? "tf" : TIMED[phase]);

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
  const HOLD_PHASES = ["tq", "oq", "fg", "ag", "xq"]; // timer waits until the question has been read
  const choiceLine = (cs) => cs.map((c, i) => letter(i) + ", " + c + ".").join(" ");
  function spokenText() {
    const r = round(), ph = S.phase;
    switch (ph) {
      case "intro": return (S.r === 0 ? "Welcome to " + D.title + ". " : "") + "Round " + (S.r + 1) + ". " + r.title + ". " + multWords(r.mult || 1) + " " + (r.intro || "") + " " + (r.rules || []).join(" ") + (isLast(r) && S.wagerQ ? " After this round comes the final wager." : "");
      case "tq": return askText(r.questions[S.i]);
      case "tr": return answerText(r.questions[S.i]);
      case "oq": { const z = r.puzzles[S.i]; return z.prompt + " " + z.shown.map((i) => z.items[i]).join(". ") + "."; }
      case "or": return "The right order: " + r.puzzles[S.i].items.join(", ") + ".";
      case "aw": return "Read your situation on your phone and write how the scripture helps.";
      case "ag": { const z = r.prompts[S.sets[S.i].item]; return z.prompt + " " + choiceLine(S.opts.map((o) => o.text)); }
      case "ar": { const w = S.res.win.map((i) => S.opts[i].text); return w.length ? "The class favorite: " + w.join(". And ") + "." : "No votes this time."; }
      case "fw": return "Write a convincing fake. Your clue is on your phone.";
      case "fg": return r.clues[S.sets[S.i].item].prompt + " " + choiceLine(S.opts.map((o) => o.text));
      case "fr": { const c = r.clues[S.sets[S.i].item]; return "The real answer: " + c.answer + ". " + (c.ref || ""); }
      case "dw": return "Draw your story. Everyone in your set draws the same one.";
      case "dg": return "Which story is this?";
      case "dr": return "It was: " + r.stories[S.sets[S.i].item].story + ".";
      case "xw": return "Final wager. One more question from " + S.wagerQ.src + ". Place your wager.";
      case "xq": { const w = S.wagerQ; return w.kind === "order" ? w.prompt + " " + w.shown.map((i) => w.items[i]).join(". ") + "." : askText(w); }
      case "xr": { const w = S.wagerQ; return w.kind === "order" ? "The right order: " + w.items.join(", ") + "." : answerText(w); }
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
  function askText(q) { return q.tf ? "True or false. " + q.q : q.q + " " + choiceLine(q.choices); }
  function answerText(q) { return q.tf ? "That's " + q.choices[q.answer].toLowerCase() + "." : "The answer is " + letter(q.answer) + ", " + q.choices[q.answer] + "."; }
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
      deadline: 0, total: 0, hold: false, rounds: null, wagerQ: null, wagerDone: false, votes: {}, voteResult: null, created: Date.now()
    };
  }
  function save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) {}
  }
  function go(phase) {
    const reveal = ["tr", "or", "fr", "dr", "ar", "xr"].includes(phase);
    S.phase = phase; S.key++;
    if (!reveal) { S.ans = {}; S.res = null; }
    if (phase === "tq") markSeen(round().questions[S.i].q);
    if (phase === "oq") markSeen(round().puzzles[S.i].prompt);
    if (phase === "xq") markSeen(S.wagerQ.q || S.wagerQ.prompt);
    const t = timerFor(phase);
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
      case "oq": revealOrder(); break;
      case "or": if (++S.i < r.puzzles.length) go("oq"); else go("scores"); break;
      case "aw": go("aready"); break;
      case "aready": S.i = 0; startApplyVote(); break;
      case "ag": revealApply(); break;
      case "ar": S.i++; startApplyVote(); break;
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
  const wagerPending = () => !!(S.wagerQ && !S.wagerDone);
  function nextRound() {
    ensureDeck();
    if (S.r + 1 >= S.rounds.length) { if (wagerPending()) return startWager(); return go("end"); }
    S.r++; S.i = 0;
    go("intro");
  }
  function startWager() {
    promoteAudience(); S.wagers = {}; S.wagerDone = true;
    go("xw");
  }
  function beginRound() {
    const r = round();
    S.i = 0;
    promoteAudience();
    if (r.type === "trivia" || r.type === "tf") return go("tq");
    if (r.type === "order") return go("oq");
    const items = r.type === "fib" ? r.clues : r.type === "apply" ? r.prompts : r.stories;
    const idOf = (it) => it.prompt || it.story;
    buildSets(items.length);
    S.sets.forEach((s) => markSeen(idOf(items[s.item])));
    if (r.type === "draw") S.storyOrder = shuffle(r.stories.map((_, i) => i));
    if (!S.sets.length) return go("scores");
    go(r.type === "fib" ? "fw" : r.type === "apply" ? "aw" : "dw");
  }
  function skipRound() {
    if (S.phase === "xw" || S.phase === "xq") return go("end");
    if (["intro", "tq", "tr", "oq", "or", "fw", "fready", "fg", "fr", "dw", "dready", "dg", "dr", "aw", "aready", "ag", "ar"].includes(S.phase)) go("scores");
  }
  function addTime() {
    if (S.deadline) { S.deadline += 15000; S.total += 15000; update(true); }
  }

  // Who still owes an answer in this phase?
  function expected() {
    const on = online();
    switch (S.phase) {
      case "tq": case "oq": case "xq": return on;
      case "xw": return on.filter((p) => p.role === "player");
      case "fw": case "dw": case "aw": return on.filter((p) => p.role === "player" && p.set >= 0);
      case "fg": case "dg": case "ag": return on.filter((p) => !inCurrentSet(p.pid));
    }
    return [];
  }
  function answered(p) {
    if (S.phase === "fw" || S.phase === "dw" || S.phase === "aw") return !!S.subs[p.pid];
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
    const s = S.sets[S.i]; return !!(s && s.members.includes(pid) && "fda".includes(S.phase[0]));
  };

  // ---------- trivia ----------
  function revealTrivia() {
    const q = round().questions[S.i], P = pts(), gains = {}, counts = q.choices.map(() => 0);
    for (const pid in S.ans) {
      const a = S.ans[pid]; if (!S.players[pid] || S.removed[pid]) continue;
      counts[a.v] = (counts[a.v] || 0) + 1;
      const base = q.tf ? (P.tfCorrect || 50) : (P.triviaCorrect || 100), bonus = q.tf ? (P.tfSpeedBonus || 0) : (P.triviaSpeedBonus || 0);
      if (a.v === q.answer) addScore(pid, mult() * (base + (S.total ? Math.round(bonus * Math.max(0, a.left) / S.total) : 0)), gains);
    }
    S.res = { counts, gains, right: Object.keys(S.ans).filter((pid) => S.ans[pid].v === q.answer) , picks: S.ans };
    sfx.reveal();
    go("tr");
  }

  // ---------- put it in order ----------
  // An answer is the list of item numbers in the order the player chose; item k belongs in place k.
  const rightCount = (order) => order.filter((it, pos) => it === pos).length;
  function revealOrder() {
    const z = round().puzzles[S.i], P = pts(), gains = {}, n = z.items.length, posRight = z.items.map(() => 0);
    let perfect = 0, answered = 0;
    for (const pid in S.ans) {
      if (!S.players[pid] || S.removed[pid]) continue;
      const o = S.ans[pid].order, k = rightCount(o);
      answered++; o.forEach((it, pos) => { if (it === pos) posRight[pos]++; });
      if (k === n) perfect++;
      addScore(pid, mult() * ((P.orderPerItem || 25) * k + (k === n ? (P.orderPerfect || 50) : 0)), gains);
    }
    S.res = { gains, posRight, perfect, answered };
    sfx.reveal();
    go("or");
  }

  // ---------- apply it ----------
  function startApplyVote() {
    while (S.i < S.sets.length) {
      const s = S.sets[S.i];
      const opts = s.members.filter((pid) => S.subs[pid] && S.subs[pid].text && !S.subs[pid].hidden && !S.removed[pid])
        .map((pid) => ({ text: S.subs[pid].text, authors: [pid] }));
      if (opts.length >= 2) { S.opts = shuffle(opts); return go("ag"); }
      S.i++; // a set needs at least two answers to vote on
    }
    go("scores");
  }
  function revealApply() {
    const P = pts(), gains = {}, votes = S.opts.map(() => []);
    for (const pid in S.ans) {
      if (!S.players[pid] || S.removed[pid] || inCurrentSet(pid)) continue;
      const v = S.ans[pid].v; if (!S.opts[v]) continue;
      votes[v].push(pid);
      S.opts[v].authors.forEach((a) => addScore(a, (P.applyVote || 50) * mult(), gains));
    }
    const top = Math.max(0, ...votes.map((x) => x.length));
    const win = top > 0 ? votes.map((x, i) => (x.length === top ? i : -1)).filter((i) => i >= 0) : [];
    win.forEach((i) => S.opts[i].authors.forEach((a) => addScore(a, (P.applyWin || 100) * mult(), gains)));
    S.res = { gains, votes: votes.map((x) => x.length), win };
    sfx.reveal();
    go("ar");
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
  const wagerRight = (a) => !!a && (S.wagerQ.kind === "order" ? rightCount(a.order) === S.wagerQ.items.length : a.v === S.wagerQ.answer);
  function revealFinal() {
    const w = S.wagerQ, P = pts(), gains = {}, counts = (w.choices || w.items).map(() => 0);
    people().forEach((p) => {
      const a = S.ans[p.pid];
      if (a && w.kind === "order") a.order.forEach((it, pos) => { if (it === pos) counts[pos]++; });
      else if (a) counts[a.v]++;
      const ok = wagerRight(a);
      if (p.role === "player") {
        const w = S.wagers[p.pid] || 0;
        if (w) { p.score += ok ? w : -w; gains[p.pid] = ok ? w : -w; }
      } else if (ok) addScore(p.pid, P.finalAudienceCorrect || 100, gains);
    });
    S.res = { counts, gains, right: people().filter((p) => wagerRight(S.ans[p.pid])).length };
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
    const ordering = ph === "oq" || (ph === "xq" && S.wagerQ.kind === "order");
    if (ordering) {
      if (m.t !== "order" || S.ans[p.pid]) return sendView(p.pid);
      const sh = ph === "oq" ? round().puzzles[S.i].shown : S.wagerQ.shown;
      const v = Array.isArray(m.v) ? m.v.map(Number) : [];
      if (v.length !== sh.length || new Set(v).size !== v.length || !v.every((i) => Number.isInteger(i) && i >= 0 && i < sh.length)) return sendView(p.pid);
      S.ans[p.pid] = { order: v.map((i) => sh[i]), left };
    } else if (ph === "tq" || ph === "xq" || ph === "fg" || ph === "dg" || ph === "ag") {
      if (m.t === "ans") {
        if (S.ans[p.pid]) return sendView(p.pid);
        if ((ph === "fg" || ph === "dg" || ph === "ag") && inCurrentSet(p.pid)) return;
        const n = ph === "tq" ? round().questions[S.i].choices.length : ph === "xq" ? S.wagerQ.choices.length : ph === "fg" || ph === "ag" ? S.opts.length : round().stories.length;
        const v = Number(m.v); if (!(v >= 0 && v < n)) return;
        S.ans[p.pid] = { v: ph === "dg" ? S.storyOrder[v] : v, left };
        if (ph === "dg" && S.drawings.length <= 1) S.ans[p.pid].fav = -1;
      } else if (m.t === "fav" && ph === "dg" && S.ans[p.pid] && S.ans[p.pid].fav === undefined) {
        const f = Number(m.v);
        S.ans[p.pid].fav = f >= 0 && f < S.drawings.length ? f : -1;
      } else return;
    } else if ((ph === "fw" || ph === "aw") && m.t === "text") {
      if (p.set < 0) return;
      const text = String(m.v || "").replace(/\s+/g, " ").trim().slice(0, ph === "aw" ? set().applyMax || 140 : set().answerMax || 40);
      if (!norm(text)) return sendView(p.pid, ph === "aw" ? "Write an answer first." : "Type a fake answer first.");
      if (ph === "fw") {
        const c = round().clues[S.sets[p.set].item];
        const truth = [c.answer].concat(c.alt || []);
        if (truth.some((t) => similar(text, t))) return sendView(p.pid, "That's the real answer, or too close to it. Write something that sounds right but isn't.");
      }
      S.subs[p.pid] = { text, set: p.set, hidden: false };
    } else if (ph === "dw" && m.t === "img") {
      if (p.set < 0) return;
      const img = String(m.v || "");
      if (!img.startsWith("data:image/") || img.length > 400000) return sendView(p.pid, "That drawing didn't come through. Try sending it again.");
      S.subs[p.pid] = { img, set: p.set, hidden: false };
    } else if (ph === "lobby" && m.t === "vote") {
      if (!votingOn()) return sendView(p.pid);
      const menu = getPlan().order, v = Array.isArray(m.v) ? m.v.map(Number) : [];
      if (v.length > votePicks() || new Set(v).size !== v.length || !v.every((i) => menu.includes(i))) return sendView(p.pid);
      S.votes = S.votes || {}; S.votes[p.pid] = v;
      update(false); sendView(p.pid);
      return;
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
    if (S.hold && HOLD_PHASES.includes(ph) && !((ph === "fg" || ph === "ag") && inCurrentSet(pid))) return wait("Listen to the question.", "Answers open as soon as it has been read.");
    switch (ph) {
      case "lobby": if (votingOn()) {
        const opts = getPlan().order.map((i) => ({ i, title: roundTitle(D.rounds[i]), blurb: GAME_BLURB[D.rounds[i].type] || "" }));
        return Object.assign(base, { v: "vote", options: opts, picked: (S.votes || {})[pid] || [], max: votePicks(), cap: set().maxRounds || 5 });
      } // falls through
      case "setup": return wait("You're in.", "Watch the screen. The game starts soon.");
      case "intro": return wait(r.title, ((r.mult || 1) > 1 ? "Points are ×" + r.mult + " this round. " : "") + (r.intro || ""));
      case "scores": return wait(rankLine(pid), "Next round coming up.");
      case "end": return Object.assign(base, { v: "end", msg: rankLine(pid, true) });
      case "tq": { const q = r.questions[S.i]; return Object.assign(base, { v: "choose", prompt: q.q, choices: q.choices, picked: a ? a.v : null, tf: !!q.tf }, timing()); }
      case "oq": { const z = r.puzzles[S.i]; return Object.assign(base, { v: "order", prompt: z.prompt, items: z.shown.map((i) => z.items[i]), locked: !!a }, timing()); }
      case "or": {
        const z = r.puzzles[S.i], n = z.items.length, k = a ? rightCount(a.order) : null;
        return resultFor(pid, Object.assign(base, { ok: !a ? null : k === n ? true : k === 0 ? false : null, msg: a ? (k === n ? "Perfect order." : k + " of " + n + " in the right place.") : "", list: z.items, note: z.note || "" }));
      }
      case "aw": {
        if (p.set < 0) return wait("Sets are writing answers.", audSub || "Get ready to vote.");
        const z = r.prompts[S.sets[p.set].item], sub = S.subs[pid];
        return Object.assign(base, { v: "write", prompt: z.prompt + (z.ref ? " (" + z.ref + ")" : ""), lead: "How does this scripture help? Write a sentence or two.", button: "Send answer", placeholder: "Your answer", sent: sub ? sub.text : "", error: error || "", max: set().applyMax || 140 }, timing());
      }
      case "aready": return wait("Answers are in.", "Look at the screen.");
      case "ag": {
        if (inCurrentSet(pid)) return wait("Your set wrote these.", "Sit tight and see how the class votes.");
        const z = r.prompts[S.sets[S.i].item];
        return Object.assign(base, { v: "choose", prompt: z.prompt, choices: S.opts.map((o) => o.text), picked: a ? a.v : null, sub: audSub || "Vote for the answer you like best." }, timing());
      }
      case "ar": {
        if (inCurrentSet(pid)) {
          const i = S.opts.findIndex((o) => o.authors.includes(pid)), n = i >= 0 ? S.res.votes[i] : 0;
          return resultFor(pid, Object.assign(base, { ok: null, msg: n + (n === 1 ? " vote" : " votes") + " for your answer." + (S.res.win.includes(i) ? " Top answer!" : "") }));
        }
        return resultFor(pid, Object.assign(base, { ok: null, msg: "Thanks for voting." }));
      }
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
        if (!S.wagerQ) return wait("Watch the screen.");
        return Object.assign(base, { v: "wager", max: maxWager(p), wager: S.wagers[pid], category: S.wagerQ.src }, timing());
      }
      case "xq": {
        const w = S.wagerQ;
        if (w.kind === "order") return Object.assign(base, { v: "order", prompt: w.prompt, items: w.shown.map((i) => w.items[i]), locked: !!a }, timing());
        return Object.assign(base, { v: "choose", prompt: w.q, choices: w.choices, picked: a ? a.v : null, tf: !!w.tf }, timing());
      }
      case "xr": {
        const w = S.wagerQ;
        if (w.kind === "order") return resultFor(pid, Object.assign(base, { ok: wagerRight(a), list: w.items, note: w.note || "" }));
        return resultFor(pid, Object.assign(base, { ok: wagerRight(a), answer: w.choices[w.answer], note: w.note || "" }));
      }
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
    if (["fw", "fready", "fg", "dw", "dready", "dg", "aw", "aready", "ag"].includes(S.phase)) {
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
    if (S.phase === "setup") return "Setup" + (D && D.course ? " · " + D.course : "");
    if (S.phase === "lobby") return "Lobby";
    if (S.phase === "end") return "Final scores";
    if (["xw", "xq", "xr"].includes(S.phase)) return "Final wager" + (S.wagerQ ? " · " + S.wagerQ.src : "");
    if (!r) return "";
    let t = r.title + ((r.mult || 1) > 1 ? " · ×" + r.mult + " points" : "");
    if (S.phase === "tq" || S.phase === "tr") t += ", question " + (S.i + 1) + " of " + r.questions.length;
    if (S.phase === "oq" || S.phase === "or") t += ", puzzle " + (S.i + 1) + " of " + r.puzzles.length;
    if (["fg", "fr", "dg", "dr", "ag", "ar"].includes(S.phase)) t += ", set " + (S.i + 1) + " of " + S.sets.length;
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
      case "oq": return "Reveal order";
      case "or": return more(r.puzzles.length) ? "Next puzzle" : "Show scores";
      case "aw": return "Close writing";
      case "aready": return "Start voting";
      case "ag": return "Reveal votes";
      case "ar": return more(S.sets.length) ? "Next set" : "Show scores";
      case "fw": return "Close writing";
      case "fready": case "dready": return "Start guessing";
      case "fg": case "dg": return "Reveal";
      case "fr": return more(S.sets.length) ? "Next clue" : "Show scores";
      case "dw": return "Close drawing";
      case "dr": return more(S.sets.length) ? "Next set" : "Show scores";
      case "xw": return "Show the question";
      case "xq": return "Reveal answer";
      case "xr": return "Final standings";
      case "scores": return S.r + 1 < S.rounds.length ? "Next round" : wagerPending() ? "Final wager" : "Finish";
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
      h = `<div class="lobby ${votingOn() ? "voting" : ""}"><div class="qrbig rise">${qr(playUrl(), 8)}</div><div class="rise">
        <div class="muted">Scan or go to</div><div style="font-size:1.4em;font-weight:700">${esc(shortUrl())}</div>
        <div class="muted" style="margin-top:.6em">Room code</div><div class="code">${S.code}</div>
        <div class="chips">${ps.map((p) => `<span class="chip ${p.pid === S.lastJoin ? "fresh-chip" : ""}" style="background:${p.color}">${esc(p.name)}</span>`).join("")}</div>
        <div class="count">${ps.length} joined</div>${votingOn() ? voteBoardHTML() : ""}</div></div>`;
    } else if (ph === "intro") {
      const m = r.mult || 1;
      const chips = S.rounds.map((x, i) => `<span class="rchip ${i === S.r ? "on" : i < S.r ? "done" : ""}" title="${esc(x.title)}">${i + 1}</span>`).join("") + (S.wagerQ ? `<span class="rchip" title="Final wager">W</span>` : "");
      h = `<div class="intro">
        <div class="intro-top rise"><span class="muted">${S.r === 0 ? "Welcome to " + esc(D.title) + ". " : ""}Round ${S.r + 1} of ${S.rounds.length}</span><span class="rchips">${chips}</span></div>
        <div class="intro-title rise"><span class="big">${esc(r.title)}</span>${m > 1 ? `<span class="mult">×${m} points</span>` : ""}</div>
        <p class="lead rise">${esc(r.intro || "")}</p>
        <div class="intro-cols">
          <div class="card rise"><h3>How it works</h3><ol>${(r.rules || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ol></div>
          <div class="card rise"><h3>Points${m > 1 ? ` (×${m} this round)` : ""}</h3><ul>${roundPoints(r).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
        </div>
        <div class="intro-foot rise muted">${S.r === 0 && S.voteResult ? "You voted. Tonight, favorite last: " + S.voteResult.slice().reverse().map((x) => esc(x.title) + " (" + x.n + ")").join(", ") : (D.welcome || []).map(esc).join(" · ")}</div></div>`;
    } else if (ph === "oq" || ph === "or" || ((ph === "xq" || ph === "xr") && S.wagerQ.kind === "order")) {
      const z = ph[0] === "o" ? r.puzzles[S.i] : S.wagerQ, rev = ph.endsWith("r");
      const counts = rev ? (ph === "or" ? S.res.posRight : S.res.counts) : [];
      const list = rev ? z.items.map((t, i) => `<div class="tile rise right"><span class="k">${i + 1}</span><span class="txt">${esc(t)}</span><span class="n" title="Players with this in place">${counts[i] || 0}</span></div>`).join("")
        : z.shown.map((i, k) => `<div class="tile rise"><span class="k">${letter(k)}</span><span class="txt">${esc(z.items[i])}</span></div>`).join("");
      const sum = rev ? (ph === "or" ? `${S.res.perfect} of ${S.res.answered} got it perfect.` : `${S.res.right} got it perfect.`) : "";
      const main = `<div class="prompt rise">${esc(z.prompt)}</div><div class="tiles order ${rev ? "rev" : ""}">${list}</div>${rev ? `<div class="note rise">${esc(sum)}${z.note ? " " + esc(z.note) : ""}</div>` : `<div class="count">Put these in order on your phone.</div>${answeredLine()}`}`;
      h = rev ? `<div class="split"><div>${main}</div><div class="board-list rise"><h3>${ph === "xr" ? "Standings" : "Top 5"}</h3>${leaderHTML(ph === "xr" ? 8 : 5, S.res.gains)}</div></div>` : main;
    } else if (ph === "tq" || ph === "tr" || ph === "xq" || ph === "xr") {
      const q = ph[0] === "t" ? r.questions[S.i] : S.wagerQ;
      const rev = ph.endsWith("r");
      const tiles = q.choices.map((c, i) => `<div class="tile rise ${rev ? (i === q.answer ? "right" : "dim") : ""}"><span class="k">${letter(i)}</span><span class="txt">${esc(c)}</span>${rev ? `<span class="n">${S.res.counts[i] || 0}</span>` : ""}</div>`).join("");
      const main = `<div class="prompt rise">${esc(q.q)}</div><div class="tiles ${q.choices.length > 4 ? "many" : ""}">${tiles}</div>${rev && q.note ? `<div class="note rise">${esc(q.note)}</div>` : answeredLine()}`;
      h = rev ? `<div class="split"><div>${main}</div><div class="board-list rise"><h3>${ph === "xr" ? "Standings" : "Top 5"}</h3>${leaderHTML(ph === "xr" ? 8 : 5, S.res.gains)}</div></div>` : main;
    } else if (ph === "aw") {
      h = `<div class="big rise">Apply it</div><p class="rise muted" style="font-size:1.2em">Check your phone for your set's situation and scripture. Write how the scripture helps.</p>${setsHTML()}`;
    } else if (ph === "aready") {
      const n = Object.keys(S.subs).length, hid = Object.values(S.subs).filter((s) => s.hidden).length;
      h = `<div class="big rise">The answers are in</div><p class="rise" style="font-size:1.3em">${n} received${hid ? `, ${hid} hidden by the host` : ""}. Voting starts when the host is ready.</p>`;
    } else if (ph === "ag" || ph === "ar") {
      const z = r.prompts[S.sets[S.i].item], rev = ph === "ar";
      const tiles = S.opts.map((o, i) => {
        const win = rev && S.res.win.includes(i), n = rev ? S.res.votes[i] : 0;
        return `<div class="tile rise ${win ? "right" : ""}"><span class="k">${letter(i)}</span><span class="txt">${esc(o.text)}${rev ? `<span class="by">${o.authors.map((a) => esc(pname(a))).join(", ")}${win ? ", top answer" : ""}</span>` : ""}</span>${rev ? `<span class="n">${n}</span>` : ""}</div>`;
      }).join("");
      const main = `<div class="prompt rise">${esc(z.prompt)}${z.ref ? ` <span class="muted" style="font-weight:400">${esc(z.ref)}</span>` : ""}</div><div class="tiles answers">${tiles}</div>${rev ? (z.note ? `<div class="note rise">${esc(z.note)}</div>` : "") : `<div class="count">Set ${S.i + 1} wrote these. Everyone else, vote on your phone.</div>${answeredLine()}`}`;
      h = rev ? `<div class="split"><div>${main}</div><div class="board-list rise"><h3>Top 5</h3>${leaderHTML(5, S.res.gains)}</div></div>` : main;
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
      const w = S.wagerQ, kind = w.kind === "order" ? "Put it in order" : w.tf ? "True or false" : "Multiple choice";
      h = `<div class="rise muted" style="font-size:1.2em">Final wager</div><div class="big rise" style="color:var(--saffron);font-size:4.4em">${esc(w.src)}</div><p class="rise muted" style="font-size:1.15em">One last question: ${kind}${w.kind === "order" ? ", and only a perfect order wins" : ""}.</p><p class="rise" style="font-size:1.3em">Place your wager on your phone. You can bet up to your score, or up to ${pts().finalMaxWagerFloor || 500} if your score is lower. Right: win it. Wrong: lose it.</p>${answeredLine()}`;
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
  function voteBoardHTML() {
    const t = voteTally(), voters = Object.keys(S.votes || {}).filter((pid) => S.players[pid] && !S.removed[pid] && S.votes[pid].length).length;
    const top = Math.max(1, ...t.map((x) => x.n));
    return `<div class="tally"><div class="muted">Vote on your phone: pick up to ${votePicks()} games. The top ${set().maxRounds || 5} are played, the favorite last. ${voters} voted.</div>
      ${t.slice().sort((a, b) => b.n - a.n).map((x) => `<div class="trow"><span class="tname">${esc(roundTitle(D.rounds[x.i]))}</span><span class="tbar"><i style="width:${100 * x.n / top}%"></i></span><span class="tn">${x.n}</span></div>`).join("")}</div>`;
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
  function contentCardHTML() {
    if (!D) return `<div class="card rise"><b>Content:</b> <span class="warn">No content loaded.</span>
      <label class="muted" style="display:block;margin-top:.5em">Load a content file <input type="file" id="fileIn" accept=".json,application/json"></label><div id="fileErr" class="warn"></div></div>`;
    const sm = RN_PACK.summary(D), all = siteExtras.concat(userExtras);
    const extras = all.length ? `<div class="muted" style="margin-top:.4em">Extras: ${all.map((x) => esc(x.name)).join(", ")}${userExtras.length ? ` <button class="ghost" id="removeExtras" style="padding:.15em .7em;font-size:.8em">Remove mine</button>` : ""}</div>` : "";
    const warn = sm.warnings.length ? `<div class="warn" style="margin-top:.4em;font-size:.85em">${sm.warnings.slice(0, 6).map(esc).join("<br>")}${sm.warnings.length > 6 ? "<br>…and " + (sm.warnings.length - 6) + " more." : ""}</div>` : "";
    return `<div class="card rise"><b>Content:</b> ${esc(D.title)}${D.course ? " · " + esc(D.course) : ""}${usingLoaded ? ` <span class="muted">(loaded here)</span>` : ""}
      <div class="muted" style="margin-top:.3em">${sm.lines.map(esc).join(" · ")}</div>${extras}${warn}
      <label class="muted" style="display:block;margin-top:.6em">Load a content file <input type="file" id="fileIn" accept=".json,application/json"></label>
      <div class="muted" style="font-size:.85em">A full pack replaces the content. An extras file adds to it.${usingLoaded || userExtras.length ? ` <button class="ghost" id="resetContent" style="padding:.15em .7em;font-size:.9em">Back to the site's content</button>` : ""}</div><div id="fileErr" class="warn"></div></div>`;
  }
  const TYPE_NAMES = { trivia: "multiple choice", tf: "true or false", order: "put in order", fib: "write fakes", draw: "drawing", apply: "write and vote" };
  function roundsCardHTML() {
    if (!D) return "";
    const plan = getPlan(), on = plan.order, off = playableIdx().filter((i) => !on.includes(i));
    const keyOf = { trivia: "questions", tf: "statements", order: "puzzles", fib: "clues", draw: "stories", apply: "prompts" };
    const row = (i, pos) => {
      const r = D.rounds[i], n = (r[keyOf[r.type]] || []).length, chosen = pos >= 0;
      const lastOn = chosen && on.length === 1;
      return `<div class="rrow ${chosen ? "" : "off"}"><label class="chk"><input type="checkbox" data-r="${i}" ${chosen ? "checked" : ""} ${lastOn ? "disabled" : ""}> <b>${esc(roundTitle(r))}</b></label>
        <span class="muted">${TYPE_NAMES[r.type]} · ${n} in bank</span>
        <span class="rmult">${chosen ? "×" + multFor(pos) : ""}</span>
        ${chosen ? `<button class="ghost mini" data-up="${i}" ${pos === 0 ? "disabled" : ""} aria-label="Move up">↑</button><button class="ghost mini" data-down="${i}" ${pos === on.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button>` : ""}</div>`;
    };
    return `<div class="card rise"><b>Rounds tonight</b> <span class="muted">(points multiply by position)</span>
      <div class="rlist">${on.map((i, pos) => row(i, pos)).join("")}${off.map((i) => row(i, -1)).join("")}</div>
      <label class="chk" style="display:block;margin-top:.6em"><input type="checkbox" id="planVote" ${plan.vote ? "checked" : ""}> <b>Let students vote</b> <span class="muted">In the lobby, students pick up to ${votePicks()} of the ticked games. The top ${set().maxRounds || 5} are played, least popular first and the favorite last. With no votes, your order is used.</span></label>
      <label class="chk" style="display:block;margin-top:.6em"><input type="checkbox" id="planWager" ${plan.wager ? "checked" : ""}> <b>End with a final wager</b> <span class="muted">After the last round's standings, everyone bets on one more question from that round.</span></label></div>`;
  }
  function bindRounds() {
    const plan = getPlan(), redo = () => { savePlan(plan); render(); };
    document.querySelectorAll(".rrow input[data-r]").forEach((el) => el.onchange = () => {
      const i = Number(el.dataset.r);
      if (el.checked) { if (!plan.order.includes(i)) plan.order.push(i); }
      else if (plan.order.length > 1) plan.order = plan.order.filter((x) => x !== i);
      redo();
    });
    const move = (i, d) => { const k = plan.order.indexOf(i), j = k + d; if (k < 0 || j < 0 || j >= plan.order.length) return; [plan.order[k], plan.order[j]] = [plan.order[j], plan.order[k]]; redo(); };
    document.querySelectorAll(".rrow [data-up]").forEach((b) => b.onclick = () => move(Number(b.dataset.up), -1));
    document.querySelectorAll(".rrow [data-down]").forEach((b) => b.onclick = () => move(Number(b.dataset.down), 1));
    const w = $("#planWager"); if (w) w.onchange = () => { plan.wager = w.checked; redo(); };
    const v = $("#planVote"); if (v) v.onchange = () => { plan.vote = v.checked; redo(); };
  }
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
      ${contentCardHTML()}
      ${roundsCardHTML()}
      ${fileWarn ? `<div class="card rise warn">This board is running from a file, so phones need the online address. Set playUrl in config.js.</div>` : ""}
      ${saved ? `<div class="rise" style="margin-top:.8em"><button class="ghost" id="resume">Resume the game in room ${esc(saved.code)}</button></div>` : ""}
      </div>`;
  }
  function bindSetup() {
    if (S.phase !== "setup") return;
    const fi = $("#fileIn");
    if (fi) fi.onchange = () => {
      const f = fi.files[0]; if (!f) return;
      f.text().then((t) => {
        const d = JSON.parse(t);
        if (RN_PACK.isExtras(d)) { RN_PACK.validateExtras(d); userExtras.push({ name: d.name || f.name, data: d }); saveExtras(); }
        else { RN_PACK.validate(d); BASE = d; usingLoaded = true; try { localStorage.setItem(DATA_KEY, t); } catch (e) {} }
        rebuildD(); render();
      }).catch((e) => { const er = $("#fileErr"); if (er) er.textContent = "That file could not be used: " + e.message; });
    };
    const rx = $("#removeExtras"); if (rx) rx.onclick = () => { userExtras = []; saveExtras(); rebuildD(); render(); };
    const rs0 = $("#resetContent"); if (rs0) rs0.onclick = () => { try { localStorage.removeItem(DATA_KEY); localStorage.removeItem(EXTRAS_KEY); } catch (e) {} location.reload(); };
    bindVoiceSettings("vs");
    bindRounds();
    const rs = $("#resume"); if (rs) rs.onclick = resume;
  }
  function savedGame() {
    try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || "null"); return s && s.phase !== "setup" && s.phase !== "end" && s.code !== S.code ? s : null; } catch (e) { return null; }
  }
  function resume() {
    const s = savedGame(); if (!s) return;
    try { const d = JSON.parse(localStorage.getItem(DATA_KEY) || "null"); if (d) { BASE = d; usingLoaded = true; rebuildD(); } } catch (e) {}
    S = s;
    if (S.hold) { S.hold = false; if (S.total) S.deadline = Date.now() + S.total; }
    Object.values(S.players).forEach((p) => (p.connected = false));
    links.clear();
    if (S.deadline) { S.deadline = Date.now() + Math.max(10000, S.total / 2); }
    restartNet();
    lastKey = -1; update(true);
  }
  function restartNet() { startNet(); }
  const validate = (d) => RN_PACK.validate(d);
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
    $("#" + px + "Test").onclick = () => VO.speak("Which scripture says, I will go and do? A, 1 Nephi 3:7. B, John 3:16.", null, true);
  }
  function openTools() { fillTools(); $("#tools").showModal(); }
  function fillTools() {
    const stats = D ? RN_PACK.summary(D).lines.join(", ") : "";
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
    const qs = new URLSearchParams(location.search);
    const url = qs.get("data") || cfg.dataUrl, xurl = qs.get("extras") === "none" ? "" : qs.get("extras") || cfg.extrasUrl;
    loadUserExtras();
    if (url) {
      try { const res = await fetch(url, { cache: "no-store" }); const d = await res.json(); validate(d); BASE = d; }
      catch (e) { try { const d = JSON.parse(localStorage.getItem(DATA_KEY) || "null"); if (d) { validate(d); BASE = d; usingLoaded = true; } } catch (e2) {} }
    }
    if (xurl) {
      try { const res = await fetch(xurl, { cache: "no-store" }); const x = await res.json(); RN_PACK.validateExtras(x); siteExtras = [{ name: x.name || xurl, data: x }]; } catch (e) { siteExtras = []; }
    }
    rebuildD();
    startNet();
    render();
    setInterval(() => { if (S) tick(false); }, 200);
    window.RN_HOST = { state: () => S, next };
  }
  boot();
})();
