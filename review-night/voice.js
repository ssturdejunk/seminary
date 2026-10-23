// voice.js: reads questions aloud on the board using the browser's built-in
// speech. No audio files. The voices come from the laptop, so they sound
// different on a Mac, a Windows PC, and a Chromebook.
(function () {
  "use strict";
  const V = {};
  const KEY = "rn-voice";
  const supported = typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  let cfg = { on: true, name: "", rate: 1 };
  try { Object.assign(cfg, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) {}
  let voices = [], gen = 0, fallback = null, active = false;
  V.onDuck = null; // called with true while speaking, false when done
  V.onVoices = null; // called when the list of voices changes
  V.preferLocal = false; // offline use: prefer voices installed on the device (others need internet)

  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} };
  function load() {
    if (!supported) return;
    const before = voices.length;
    voices = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang));
    if (voices.length !== before && V.onVoices) V.onVoices();
  }
  if (supported) {
    load();
    if (speechSynthesis.addEventListener) speechSynthesis.addEventListener("voiceschanged", load);
    else speechSynthesis.onvoiceschanged = load;
  }

  // Prefer natural-sounding English voices when the user hasn't chosen one.
  function rank(v) {
    let s = 0;
    if (V.preferLocal && !v.localService) s -= 20;
    if (/^en-US/i.test(v.lang)) s += 3; else if (/^en/i.test(v.lang)) s += 1;
    if (/natural|neural|online/i.test(v.name)) s += 6;
    if (/google/i.test(v.name)) s += 4;
    if (/samantha|ava|allison|aria|jenny|guy|daniel|karen|zira|david|alex/i.test(v.name)) s += 2;
    return s;
  }
  // Default voice: the best-ranked US English voice, or the best English voice if there is no US one.
  function defaultVoice() {
    const ranked = voices.slice().sort((a, b) => rank(b) - rank(a)), us = ranked.filter((v) => /^en-US/i.test(v.lang));
    return us[0] || ranked[0] || null;
  }
  function pick() {
    if (cfg.name) { const m = voices.find((v) => v.name === cfg.name); if (m) return m; }
    return defaultVoice();
  }
  // "Microsoft Aria Online (Natural) - English (United States)" -> "Aria (natural)"
  function label(v) {
    return v.name.replace(/^(Microsoft|Google)\s+/i, "").replace(/\s*-\s*English.*$/i, "").replace(/\s*Online\s*\(Natural\)/i, " (natural)").trim() || v.name;
  }

  // Turn text into something a speech engine reads correctly.
  function speakable(t) {
    return String(t || "")
      .replace(/_{2,}/g, " blank ")
      .replace(/(\d+):(\d+)\s*[–-]\s*(\d+)/g, "$1, verses $2 through $3")
      .replace(/(\d+):(\d+)/g, "$1, verse $2")
      .replace(/ldssingleschat\.com/gi, "L D S singles chat dot com")
      .replace(/\bBYU\b/g, "B Y U")
      .replace(/\bLDS\b/g, "L D S")
      .replace(/[—–]/g, ", ")
      .replace(/[“”]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  // Long utterances get cut off by some browsers, so speak in short pieces.
  function chunk(t) {
    const parts = t.match(/[^.?!;:]+[.?!;:]*\s*/g) || [t], out = [];
    let cur = "";
    parts.forEach((p) => { if ((cur + p).length > 170 && cur) { out.push(cur); cur = p; } else cur += p; });
    if (cur.trim()) out.push(cur);
    return out;
  }

  V.supported = supported;
  V.enabled = () => supported && cfg.on;
  V.setEnabled = (v) => { cfg.on = !!v; save(); if (!cfg.on) V.cancel(); };
  V.voiceCount = () => voices.length;
  // A short, ranked list: the best 8 US English voices (or English voices if there are none).
  // all = true returns every English voice. A voice you chose earlier is always included.
  V.voices = (all) => {
    const ranked = voices.slice().sort((a, b) => rank(b) - rank(a)), us = ranked.filter((v) => /^en-US/i.test(v.lang));
    const pool = all || !us.length ? ranked : us, names = new Set(), out = [];
    pool.forEach((v) => { if (!names.has(v.name)) { names.add(v.name); out.push(v); } });
    let list = all ? out : out.slice(0, 8);
    const chosen = cfg.name && voices.find((v) => v.name === cfg.name);
    if (chosen && !list.includes(chosen)) list = [chosen].concat(list);
    return list.map((v) => ({ name: v.name, label: label(v), lang: v.lang, local: !!v.localService }));
  };
  V.voiceName = () => (pick() ? pick().name : "");
  V.chosen = () => cfg.name;
  V.setVoice = (n) => { cfg.name = n || ""; save(); };
  V.rate = () => cfg.rate;
  V.setRate = (r) => { cfg.rate = Math.max(0.6, Math.min(1.5, Number(r) || 1)); save(); };
  V.speakable = speakable; // exposed for testing

  V.cancel = function () {
    gen++;
    clearTimeout(fallback); fallback = null;
    if (supported) try { speechSynthesis.cancel(); } catch (e) {}
    if (active) { active = false; if (V.onDuck) V.onDuck(false); }
  };

  // Returns true if speech started. done() runs once when it finishes, errors,
  // or takes longer than a generous estimate (so a broken voice can't stall the game).
  V.speak = function (text, done, force) {
    V.cancel();
    if (!supported || (!cfg.on && !force) || !text) return false;
    const my = gen, chunks = chunk(speakable(text));
    let i = 0, finished = false;
    const finish = () => {
      if (finished || my !== gen) return;
      finished = true; clearTimeout(fallback); fallback = null;
      active = false; if (V.onDuck) V.onDuck(false);
      if (done) done();
    };
    const words = String(text).split(/\s+/).length;
    fallback = setTimeout(finish, (words / 2.3 / cfg.rate) * 1000 + 3500);
    active = true; if (V.onDuck) V.onDuck(true);
    const next = () => {
      if (my !== gen || finished) return;
      if (i >= chunks.length) return finish();
      const u = new SpeechSynthesisUtterance(chunks[i++]), v = pick();
      if (v) { u.voice = v; u.lang = v.lang; } else u.lang = "en-US";
      u.rate = cfg.rate;
      u.onend = next;
      u.onerror = () => finish();
      try { speechSynthesis.speak(u); } catch (e) { finish(); }
    };
    setTimeout(next, 80); // some browsers drop speech queued right after cancel()
    return true;
  };

  window.RN_VOICE = V;
})();
