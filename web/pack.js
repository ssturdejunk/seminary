// pack.js: reads, checks, and combines content files.
//
// A PACK is a full content file for one course: title, settings, and the four
// rounds (trivia, fib, draw, final). Loading a pack replaces the content.
// An EXTRAS file ({ "extras": true, ... }) adds questions, clues, stories, or
// final questions to the pack, for things that belong to one class or teacher.
(function () {
  "use strict";
  const P = {};
  // Which list in a round holds its items, and how an extras file names that list.
  // "final" is not a round people pick: its finals are the fallback bank for the final wager.
  const KEYS = { trivia: "questions", tf: "statements", order: "puzzles", fib: "clues", draw: "stories", apply: "prompts", final: "finals" };
  const NOUN = { trivia: ["question", "questions"], tf: ["statement", "statements"], order: ["puzzle", "puzzles"], fib: ["clue", "clues"], draw: ["story", "stories"], apply: ["prompt", "prompts"], final: ["question", "questions"] };
  // Names and rules used when a pack leaves them out. Course-neutral on purpose.
  P.DEFAULTS = {
    trivia: { title: "Quick Quiz", intro: "Questions on what we've studied.", rules: ["A question and choices appear on the screen. Pick one on your phone.", "The clock starts after the question is read aloud.", "A correct answer scores. A faster correct answer scores a little more."] },
    tf: { title: "True or False", intro: "Fast true-or-false statements.", rules: ["A statement appears on the screen. Tap True or False on your phone.", "The clock is short, so trust your first instinct.", "A correct answer scores. A faster correct answer scores a little more."] },
    order: { title: "Put It in Order", intro: "Put events, verses, or steps in the right order.", rules: ["Your phone shows a mixed-up list.", "Tap the items in order, first to last, then lock in.", "You score for every item in the right place, plus a bonus for a perfect order."] },
    fib: { title: "Fake Out", intro: "Write a believable fake ending, then find the real one.", rules: ["Your set of 3 or 4 gets one clue. Write a fake ending that sounds real.", "Everyone else sees the real ending mixed in with the fakes and picks the one they trust.", "Pick the real one and score. Fool a classmate with your fake and score every time."] },
    draw: { title: "Sketch It", intro: "Draw a scripture story and guess your classmates' drawings.", rules: ["Your set draws the same story on your phone. No words or letters.", "Everyone else sees the drawings and guesses which story it is.", "Guess right and score. Draw clearly, because you score when classmates guess your story. Pick a favorite drawing for a bonus."] },
    apply: { title: "Apply It", intro: "Use a scripture to answer a real-life situation.", rules: ["Your set of 3 or 4 gets the same situation and scripture.", "Each of you writes how the scripture helps, in a sentence or two.", "Everyone else votes for the answer they like best. You score for every vote, and the top answer gets a bonus."] }
  };
  P.PLAYABLE = ["trivia", "tf", "order", "fib", "draw", "apply"];
  const snip = (s) => '"' + String(s == null ? "" : s).replace(/\s+/g, " ").slice(0, 45) + (String(s).length > 45 ? "…" : "") + '"';

  function checkChoices(item, where) {
    if (!Array.isArray(item.choices) || item.choices.length < 2) throw new Error(where + " needs a list of at least 2 choices.");
    if (typeof item.answer !== "number" || !item.choices[item.answer]) throw new Error(where + " has an answer number that doesn't match a choice. Answers count from 0, so 0 is the first choice.");
  }
  function checkItems(type, items, label, mayBeEmpty) {
    if (!Array.isArray(items) || (!items.length && !mayBeEmpty)) throw new Error(label + " is empty.");
    items.forEach((it, j) => {
      const where = label + ", item " + (j + 1);
      if (type === "trivia") { if (!it.q) throw new Error(where + " needs a q (the question)."); checkChoices(it, where + " (" + snip(it.q) + ")"); }
      else if (type === "fib") { if (!it.prompt || !it.answer) throw new Error(where + " needs a prompt and an answer (" + snip(it.prompt) + ")."); }
      else if (type === "draw") { if (!it.story) throw new Error(where + " needs a story."); }
      else if (type === "final") { if (!it.q) throw new Error(where + " needs a q (the question)."); checkChoices(it, where + " (" + snip(it.q) + ")"); }
      else if (type === "tf") {
        if (!it.s) throw new Error(where + " needs an s (the statement).");
        if (typeof it.a !== "boolean") throw new Error(where + " (" + snip(it.s) + ") needs a: true or a: false, without quotes.");
      } else if (type === "order") {
        if (!it.prompt) throw new Error(where + " needs a prompt.");
        if (!Array.isArray(it.items) || it.items.length < 3 || it.items.length > 8) throw new Error(where + " (" + snip(it.prompt) + ") needs a list of 3 to 8 items, in the correct order.");
        if (new Set(it.items.map((x) => String(x).trim().toLowerCase())).size !== it.items.length) throw new Error(where + " (" + snip(it.prompt) + ") has two items that match.");
      } else if (type === "apply") { if (!it.prompt) throw new Error(where + " needs a prompt (the situation)."); }
    });
  }

  // Throws an Error with a plain-English message if the pack can't be used.
  P.validate = function (d) {
    if (!d || typeof d !== "object" || Array.isArray(d)) throw new Error("it isn't a content pack.");
    if (d.extras === true) throw new Error("this is an extras file, not a full pack.");
    if (!Array.isArray(d.rounds) || !d.rounds.length) throw new Error("it has no rounds.");
    d.settings = d.settings || {};
    // A Quick Quiz, Put It in Order or Sketch It bank may be empty when Doctrinal Mastery fills it.
    const hasMastery = Array.isArray(d.mastery) && d.mastery.length >= 4;
    d.rounds.forEach((r, i) => {
      const n = "Round " + (i + 1) + (r.title ? " (" + r.title + ")" : "");
      if (!KEYS[r.type]) throw new Error(n + " has an unknown type: " + snip(r.type) + ". Use " + Object.keys(KEYS).join(", ") + ".");
      if (r.type === "final") {
        if (r.finals) checkItems("final", r.finals, n + " finals");
        else { if (!r.q) throw new Error(n + " needs finals (a list of questions) or a q."); checkChoices(r, n); }
      } else checkItems(r.type, r[KEYS[r.type]], n + " " + KEYS[r.type], hasMastery && ["trivia", "order", "draw"].includes(r.type));
      if (r.type === "draw" && r.stories.length < 2 && !hasMastery) throw new Error(n + " needs at least 2 stories.");
      if (r.count != null && !(r.count >= 1)) throw new Error(n + " has a bad count.");
    });
    if (!d.rounds.some((r) => P.PLAYABLE.includes(r.type))) throw new Error("it has no playable rounds (" + P.PLAYABLE.join(", ") + ").");
    if (d.mastery != null) {
      if (!Array.isArray(d.mastery)) throw new Error("mastery must be a list of { ref, phrase }.");
      d.mastery.forEach((m, i) => { if (!m || !m.ref || !m.phrase) throw new Error("Doctrinal Mastery item " + (i + 1) + " needs a ref and a phrase."); });
    }
  };
  P.isExtras = (d) => !!(d && typeof d === "object" && d.extras === true);
  P.validateExtras = function (x) {
    if (!P.isExtras(x)) throw new Error("it isn't an extras file (it needs \"extras\": true).");
    let any = false;
    Object.keys(KEYS).forEach((type) => {
      const key = KEYS[type];
      if (x[key] == null) return;
      checkItems(type, x[key], "Extras " + key); any = true;
    });
    if (!any) throw new Error("it has nothing to add. Include questions, clues, stories, or finals.");
  };

  // The base pack plus any extras lists, as one pack the game can use.
  P.merge = function (base, list) {
    const d = JSON.parse(JSON.stringify(base));
    d.pronounce = Object.assign({}, base.pronounce);
    d._added = 0;
    (list || []).forEach((x) => {
      Object.assign(d.pronounce, x.pronounce || {});
      Object.keys(KEYS).forEach((type) => {
        const key = KEYS[type], add = x[key];
        if (!Array.isArray(add) || !add.length) return;
        const r = d.rounds.find((rr) => rr.type === type);
        if (!r) return;
        if (type === "final" && !r.finals) r.finals = [{ q: r.q, choices: r.choices, answer: r.answer, note: r.note }];
        r[key] = (r[key] || []).concat(JSON.parse(JSON.stringify(add)));
        d._added += add.length;
      });
    });
    P.expandMastery(d);
    return d;
  };

  // ---------- Doctrinal Mastery drills ----------
  // A pack may list its Doctrinal Mastery passages as "mastery": [{ ref, phrase, quoted }], where
  // quoted is only the text inside quotation marks. These are turned into extra items for rounds the
  // pack already has (from the manual's memorization ideas):
  //   Quick Quiz: First Letters (pick the reference) and Fill in the Blank (pick the missing words)
  //   Put It in Order: Unscramble (phrase in chunks) and Matching (phrases in the order of 4 references)
  //   Sketch It: draw the key phrase, the class guesses it
  // Word drills use quoted text only. Generation is deterministic, so the same item keeps the same
  // text from game to game. settings.mastery can switch parts off: { quiz, order, draw: false }.
  const DM_STOP = new Set("a an the of and to in on unto for his her my thy thine thee your you is are was be as at by with that this it or they shall will he she we i them him who which not no so but if then hath doth ye".split(" "));
  const dmWords = (s) => String(s).replace(/…/g, " … ").replace(/—/g, "— ").split(/\s+/).filter(Boolean);
  const dmJoin = (ws) => ws.join(" ").replace(/— /g, "—").replace(/ … /g, " … ");
  const bare = (w) => w.replace(/[^A-Za-z']/g, "");
  function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  function others(list, i, n, key) { // n entries other than i, chosen by a stable hash
    const out = [], seen = new Set([key(list[i])]);
    for (let k = 1; out.length < n && k < list.length * 3; k++) {
      const c = list[(i + 1 + (hash(key(list[i]) + k) % (list.length - 1))) % list.length];
      if (!seen.has(key(c))) { seen.add(key(c)); out.push(c); }
    }
    return out;
  }
  function contentWords(text) {
    // w keeps a capital only for a proper noun (capitalized after the first word); o is the word as written.
    return dmWords(text).map((w, i) => ({ o: bare(w), w: i > 0 && /^[A-Z]/.test(bare(w)) ? bare(w) : bare(w).toLowerCase(), i }))
      .filter((x) => x.w.length >= 3 && !DM_STOP.has(x.w.toLowerCase()));
  }
  P.expandMastery = function (d) {
    const M = (d.mastery || []).filter((m) => m && m.ref && (m.quoted || m.phrase));
    d._mastery = { quiz: 0, order: 0, draw: 0 };
    if (M.length < 4) return d;
    const opt = (d.settings && d.settings.mastery) || {};
    const round = (type) => d.rounds.find((r) => r.type === type);
    const Q = M.filter((m) => m.quoted && dmWords(m.quoted).length >= 4);
    const tag = (it, m, kind) => Object.assign(it, { ref: m.ref, dm: kind });

    const quiz = round("trivia");
    if (quiz && opt.quiz !== false) {
      const add = [];
      Q.forEach((m, i) => {
        const refs = [m.ref].concat(others(Q, i, 3, (x) => x.ref).map((x) => x.ref));
        const words = dmWords(m.quoted);
        // First Letters: every word's first letter; the harder one hides every other letter.
        const fl = words.map((w) => (w === "…" ? "…" : (bare(w)[0] || "") + (/[,.;:?!]$/.test(w) ? w.slice(-1) : ""))).join(" ");
        const fl2 = fl.split(" ").map((x, k) => (x === "…" || k % 2 === 0 ? x : "_")).join(" ");
        add.push(tag({ q: "First letters: “" + fl + "” Which passage is it?", choices: refs, answer: 0, note: m.ref + ": " + m.phrase }, m, "first-letters"));
        add.push(tag({ q: "Harder first letters: “" + fl2 + "” Which passage is it?", choices: refs, answer: 0, note: m.ref + ": " + m.phrase }, m, "first-letters"));
        // Fill in the Blank: the longest content word, then the two longest.
        const cw = contentWords(m.quoted).sort((a, b) => b.w.length - a.w.length || a.i - b.i);
        if (cw.length >= 2) {
          const pool = others(Q, i, 6, (x) => x.ref).map((x) => contentWords(x.quoted).sort((a, b) => b.w.length - a.w.length)).filter((x) => x.length >= 2);
          const one = cw[0], blank1 = dmJoin(words.map((w, k) => (k === one.i ? w.replace(one.o, "____") : w)));
          const d1 = [...new Set(pool.map((x) => x[0].w))].filter((w) => w.toLowerCase() !== one.w.toLowerCase()).slice(0, 3);
          if (d1.length === 3) add.push(tag({ q: m.ref + ": “" + blank1 + "” Which word is missing?", choices: [one.w].concat(d1), answer: 0, note: m.ref + ": “" + m.quoted + "”" }, m, "fill-blank"));
          const two = cw.slice(0, 2).sort((a, b) => a.i - b.i), set2 = new Set(two.map((x) => x.i));
          const blank2 = dmJoin(words.map((w, k) => (set2.has(k) ? w.replace(bare(w), "____") : w)));
          const pair = (xs) => xs.slice(0, 2).sort((a, b) => a.i - b.i).map((x) => x.w).join(" … ");
          const right2 = pair(two), d2 = [...new Set(pool.map(pair))].filter((x) => x !== right2).slice(0, 3);
          if (d2.length === 3) add.push(tag({ q: "“" + blank2 + "” Which words are missing?", choices: [right2].concat(d2), answer: 0, note: m.ref + ": “" + m.quoted + "”" }, m, "fill-blank"));
        }
      });
      quiz.questions = quiz.questions.concat(add); d._mastery.quiz = add.length;
    }

    const ord = round("order");
    if (ord && opt.order !== false) {
      const add = [];
      Q.forEach((m) => { // Unscramble: 3 to 6 chunks of words
        const w = dmWords(m.quoted).filter((x) => x !== "…"), k = Math.max(3, Math.min(6, Math.round(w.length / 3)));
        const chunks = Array.from({ length: k }, (_, j) => dmJoin(w.slice(Math.round(j * w.length / k), Math.round((j + 1) * w.length / k)))).filter(Boolean);
        if (chunks.length >= 3 && new Set(chunks.map((c) => c.toLowerCase())).size === chunks.length)
          add.push(tag({ prompt: "Unscramble " + m.ref + ".", items: chunks, note: "“" + m.quoted + "”" }, m, "unscramble"));
      });
      for (let i = 0; i + 4 <= M.length; i += 4) { // Matching: phrases in the order of 4 references
        const g = M.slice(i, i + 4), short = (m) => { const t = m.quoted || m.phrase; return t.length > 70 ? t.slice(0, 67).replace(/\s+\S*$/, "") + "…" : t; };
        add.push(Object.assign({ prompt: "Match the key phrases to " + g.map((m, k) => (k + 1) + ") " + m.ref).join("  ") + ".", items: g.map(short), note: g.map((m) => m.ref).join(", "), dm: "matching" }));
      }
      ord.puzzles = ord.puzzles.concat(add); d._mastery.order = add.length;
    }

    const dr = round("draw");
    if (dr && opt.draw !== false) {
      const add = M.map((m) => tag({ story: m.ref + ": " + (m.quoted || m.phrase), ref: m.ref }, m, "picture"));
      dr.stories = dr.stories.concat(add); d._mastery.draw = add.length;
    }
    return d;
  };

  // Counts and gentle warnings, for showing the host what was loaded.
  P.summary = function (d) {
    const lines = [], warnings = [];
    if (!d.title) warnings.push("The pack has no title.");
    d.rounds.forEach((r) => {
      const items = r.type === "final" ? r.finals || [r] : r[KEYS[r.type]] || [];
      const label = r.title || (P.DEFAULTS[r.type] || {}).title || r.type;
      lines.push((r.type === "final" ? "Final wager bank" : label) + ": " + items.length + " " + NOUN[r.type][items.length === 1 ? 0 : 1]);
      if (r.count && r.count > items.length) warnings.push(label + " asks for " + r.count + " but has only " + items.length + ". It will use them all.");
      const seen = new Set();
      items.forEach((it) => {
        const id = it.q || it.prompt || it.story || it.s;
        if (seen.has(id)) warnings.push(label + " has a repeated item: " + snip(id) + "."); seen.add(id);
        if (r.type === "trivia" || r.type === "final") {
          const texts = it.choices.map((c) => String(c).trim().toLowerCase());
          if (new Set(texts).size !== texts.length) warnings.push(label + ": two choices match in " + snip(it.q) + ".");
          if (r.type === "trivia" && it.choices.length < 3) warnings.push(label + ": " + snip(it.q) + " has only " + it.choices.length + " choices.");
          if (r.type === "final" && it.choices.length < 4) warnings.push(label + ": " + snip(it.q) + " has only " + it.choices.length + " choices. A final is better with 5 or 6 close ones.");
        } else if (r.type === "fib") {
          if (String(it.prompt).indexOf("__") < 0) warnings.push(label + ": " + snip(it.prompt) + " has no ____ blank.");
          if (!Array.isArray(it.house) || it.house.length < 2) warnings.push(label + ": " + snip(it.prompt) + " has fewer than 2 house fakes. They fill in when students write too few.");
        }
        else if (r.type === "order" && it.items.length > 6) warnings.push(label + ": " + snip(it.prompt) + " has " + it.items.length + " items. 4 to 6 is easier to tap on a phone.");
      });
      if (r.type === "tf" && items.length >= 6) {
        const t = items.filter((x) => x.a).length;
        if (t / items.length > 0.75 || t / items.length < 0.25) warnings.push(label + ": " + t + " of " + items.length + " statements are true. Aim for a mix.");
      }
    });
    if (!d.rounds.some((r) => P.PLAYABLE.includes(r.type))) warnings.push("The pack has no playable rounds.");
    const g = d._mastery;
    if (g && g.quiz + g.order + g.draw) lines.push("Doctrinal Mastery drills mixed in: " + [g.quiz && g.quiz + " quiz", g.order && g.order + " order", g.draw && g.draw + " drawing"].filter(Boolean).join(", "));
    return { lines, warnings };
  };

  window.RN_PACK = P;
})();
