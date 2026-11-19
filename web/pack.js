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
  const KEYS = { trivia: "questions", fib: "clues", draw: "stories", final: "finals" };
  const NOUN = { trivia: ["question", "questions"], fib: ["clue", "clues"], draw: ["story", "stories"], final: ["question", "questions"] };
  const snip = (s) => '"' + String(s == null ? "" : s).replace(/\s+/g, " ").slice(0, 45) + (String(s).length > 45 ? "…" : "") + '"';

  function checkChoices(item, where) {
    if (!Array.isArray(item.choices) || item.choices.length < 2) throw new Error(where + " needs a list of at least 2 choices.");
    if (typeof item.answer !== "number" || !item.choices[item.answer]) throw new Error(where + " has an answer number that doesn't match a choice. Answers count from 0, so 0 is the first choice.");
  }
  function checkItems(type, items, label) {
    if (!Array.isArray(items) || !items.length) throw new Error(label + " is empty.");
    items.forEach((it, j) => {
      const where = label + ", item " + (j + 1);
      if (type === "trivia") { if (!it.q) throw new Error(where + " needs a q (the question)."); checkChoices(it, where + " (" + snip(it.q) + ")"); }
      else if (type === "fib") { if (!it.prompt || !it.answer) throw new Error(where + " needs a prompt and an answer (" + snip(it.prompt) + ")."); }
      else if (type === "draw") { if (!it.story) throw new Error(where + " needs a story."); }
      else if (type === "final") { if (!it.q) throw new Error(where + " needs a q (the question)."); checkChoices(it, where + " (" + snip(it.q) + ")"); }
    });
  }

  // Throws an Error with a plain-English message if the pack can't be used.
  P.validate = function (d) {
    if (!d || typeof d !== "object" || Array.isArray(d)) throw new Error("it isn't a content pack.");
    if (d.extras === true) throw new Error("this is an extras file, not a full pack.");
    if (!Array.isArray(d.rounds) || !d.rounds.length) throw new Error("it has no rounds.");
    d.settings = d.settings || {};
    d.rounds.forEach((r, i) => {
      const n = "Round " + (i + 1) + (r.title ? " (" + r.title + ")" : "");
      if (!KEYS[r.type]) throw new Error(n + " has an unknown type: " + snip(r.type) + ". Use trivia, fib, draw, or final.");
      if (r.type === "final") {
        if (r.finals) checkItems("final", r.finals, n + " finals");
        else { if (!r.q) throw new Error(n + " needs finals (a list of questions) or a q."); checkChoices(r, n); }
      } else checkItems(r.type, r[KEYS[r.type]], n + " " + KEYS[r.type]);
      if (r.type === "draw" && r.stories.length < 2) throw new Error(n + " needs at least 2 stories.");
      if (r.count != null && !(r.count >= 1)) throw new Error(n + " has a bad count.");
    });
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
    return d;
  };

  // Counts and gentle warnings, for showing the host what was loaded.
  P.summary = function (d) {
    const lines = [], warnings = [];
    if (!d.title) warnings.push("The pack has no title.");
    d.rounds.forEach((r) => {
      const items = r.type === "final" ? r.finals || [r] : r[KEYS[r.type]] || [];
      lines.push(r.title + ": " + items.length + " " + NOUN[r.type][items.length === 1 ? 0 : 1]);
      const label = r.title || r.type;
      if (r.count && r.count > items.length) warnings.push(label + " asks for " + r.count + " but has only " + items.length + ". It will use them all.");
      const seen = new Set();
      items.forEach((it) => {
        const id = it.q || it.prompt || it.story;
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
      });
    });
    return { lines, warnings };
  };

  window.RN_PACK = P;
})();
