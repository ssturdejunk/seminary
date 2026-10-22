// audio.js: all board sound. Music and effects are synthesized in the browser,
// so there are no audio files to load or license.
//
// Music: a looping chiptune tune. During timed phases the tune speeds up and
// adds layers (drums, arpeggio, doubled lead) as the clock runs down.
// Effects: join, whoosh (screen transitions), reveal, start, tick, end fanfare.
(function () {
  "use strict";
  const A = {};
  const KEY = "rn-muted";
  let muted = false;
  try { muted = localStorage.getItem(KEY) === "1"; } catch (e) {}
  let live = null, mode = "off", intensityNow = 0, timer = null, ducked = false;
  const level = () => (mode === "calm" ? 0.5 : 1) * (ducked ? 0.3 : 1);
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // ---------- audio graph ----------
  function makeGraph(ctx) {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.2;
    const master = ctx.createGain(); master.gain.value = 0.8;
    const musicBus = ctx.createGain(); musicBus.gain.value = 0;
    const fxBus = ctx.createGain(); fxBus.gain.value = 2.6;
    musicBus.connect(master); fxBus.connect(master); master.connect(comp); comp.connect(ctx.destination);
    const len = ctx.sampleRate, nb = ctx.createBuffer(1, len, ctx.sampleRate), d = nb.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return { ctx, master, musicBus, fxBus, nb, step: 0, next: 0 };
  }

  // ---------- instruments ----------
  function tone(g, dest, t, midi, dur, type, vol, atk) {
    const c = g.ctx, o = c.createOscillator(), a = c.createGain();
    atk = Math.min(atk || 0.005, dur / 3);
    o.type = type; o.frequency.setValueAtTime(mtof(midi), t);
    a.gain.setValueAtTime(0.0001, t);
    a.gain.linearRampToValueAtTime(vol, t + atk);
    a.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(a); a.connect(dest); o.start(t); o.stop(t + dur + 0.03);
  }
  function glide(g, dest, t, f0, f1, dur, type, vol) {
    const c = g.ctx, o = c.createOscillator(), a = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    a.gain.setValueAtTime(vol, t); a.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(a); a.connect(dest); o.start(t); o.stop(t + dur + 0.03);
  }
  function kick(g, dest, t, vol) { glide(g, dest, t, 150, 42, 0.2, "sine", vol); }
  function noiseHit(g, dest, t, dur, vol, type, freq, q) {
    const c = g.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), a = c.createGain();
    s.buffer = g.nb; f.type = type; f.frequency.value = freq; if (q) f.Q.value = q;
    a.gain.setValueAtTime(vol, t); a.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(a); a.connect(dest); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.03);
  }
  const snare = (g, d, t, v) => { noiseHit(g, d, t, 0.14, v, "bandpass", 1800, 0.8); tone(g, d, t, 55, 0.09, "triangle", v * 0.5); };
  const hat = (g, d, t, v) => noiseHit(g, d, t, 0.04, v, "highpass", 7000);

  // ---------- tunes ----------
  // Each tune is 4 bars of 16 steps. The lead has 8 eighth notes per bar (null is a rest).
  const TUNES = {
    major: {
      chords: [{ bass: 48, arp: [60, 64, 67, 72] }, { bass: 45, arp: [57, 60, 64, 69] }, { bass: 53, arp: [53, 57, 60, 65] }, { bass: 55, arp: [55, 59, 62, 67] }],
      lead: [72, 76, 79, 76, 72, 76, 79, 84, 81, 79, 76, 72, 76, 79, 81, null,
             77, 81, 84, 81, 77, 74, 72, null, 79, 83, 86, 83, 79, 74, 79, null]
    },
    minor: {
      chords: [{ bass: 45, arp: [57, 60, 64, 69] }, { bass: 53, arp: [53, 57, 60, 65] }, { bass: 48, arp: [60, 64, 67, 72] }, { bass: 52, arp: [56, 59, 64, 68] }],
      lead: [81, null, 76, 81, 84, 81, 79, 76, 77, null, 72, 77, 81, 77, 76, 72,
             79, null, 72, 76, 79, 76, 72, 76, 80, null, 76, 80, 83, 80, 76, 71]
    }
  };

  // I is intensity from 0 (calm) to 1 (frantic). It adds layers and raises the tempo.
  function playStep(g, tune, n, t, sd, I) {
    const bar = Math.floor(n / 16) % 4, s = n % 16, ch = tune.chords[bar], d = g.musicBus;
    const up = I > 0.85 ? 2 : 0; // last stretch: key change for extra urgency
    // bass
    if (I < 0.25) { if (s % 8 === 0) tone(g, d, t, ch.bass + up, sd * 6, "triangle", 0.3); }
    else if (s % 2 === 0) tone(g, d, t, ch.bass + up + (s % 4 === 2 ? 12 : 0), sd * 1.7, "triangle", s % 4 === 2 ? 0.2 : 0.3);
    // lead
    if (s % 2 === 0) {
      const note = tune.lead[bar * 8 + s / 2];
      if (note != null) {
        tone(g, d, t, note + up, sd * 1.9, "square", 0.075);
        if (I > 0.6) tone(g, d, t, note + up + 12, sd * 1.6, "triangle", 0.05);
      }
    }
    // arpeggio
    if (I >= 0.35) tone(g, d, t, ch.arp[s % 4] + up + (I > 0.7 ? 12 : 0), sd * 0.9, "square", 0.028);
    // drums
    if (I > 0.15 && (s % 8 === 0 || (I > 0.5 && s % 4 === 0))) kick(g, d, t, 0.85);
    if (I > 0.3 && (s === 4 || s === 12)) snare(g, d, t, 0.32);
    if (I > 0.85 && s >= 12 && s % 2 === 1) snare(g, d, t, 0.18);
    if (I > 0.25 && (s % 4 === 2 || (I > 0.5 && s % 2 === 0) || I > 0.75)) hat(g, d, t, 0.1);
  }
  function schedule(g, tune, upTo, getI) {
    while (g.next < upTo) {
      const I = getI(g.next);
      const bpm = 104 + 56 * Math.pow(I, 1.2), sd = 60 / bpm / 4;
      playStep(g, tune, g.step, g.next, sd, I);
      g.next += sd; g.step++;
    }
  }

  // ---------- effects ----------
  const FX = {
    join(g, t) { tone(g, g.fxBus, t, 76, 0.18, "triangle", 0.18); tone(g, g.fxBus, t + 0.08, 83, 0.24, "triangle", 0.15); },
    tick(g, t) { tone(g, g.fxBus, t, 96, 0.07, "square", 0.13); },
    start(g, t) { [60, 64, 67].forEach((m, i) => tone(g, g.fxBus, t + i * 0.1, m + 12, 0.25, "triangle", 0.16)); },
    // Screen change: a rising air sweep that ends in a little bloop.
    whoosh(g, t) {
      const c = g.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), a = c.createGain();
      s.buffer = g.nb; f.type = "bandpass"; f.Q.value = 1.4;
      f.frequency.setValueAtTime(250, t); f.frequency.exponentialRampToValueAtTime(3800, t + 0.34);
      a.gain.setValueAtTime(0.0001, t); a.gain.linearRampToValueAtTime(0.3, t + 0.14); a.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      s.connect(f); f.connect(a); a.connect(g.fxBus); s.start(t, Math.random() * 0.5); s.stop(t + 0.45);
      glide(g, g.fxBus, t + 0.26, 420, 980, 0.12, "sine", 0.16);
    },
    reveal(g, t) {
      [60, 64, 67, 72].forEach((m, i) => tone(g, g.fxBus, t + i * 0.07, m + 12, 0.35, "triangle", 0.16));
      tone(g, g.fxBus, t + 0.32, 96, 0.5, "sine", 0.1);
    },
    end(g, t) {
      [60, 64, 67, 72, 76, 79, 84].forEach((m, i) => tone(g, g.fxBus, t + i * 0.12, m, 0.5, "square", 0.08));
      [60, 64, 67, 72].forEach((m) => tone(g, g.fxBus, t + 0.9, m + 12, 1.4, "triangle", 0.12));
    }
  };

  // ---------- live control ----------
  function applyMute() { if (live) live.master.gain.setTargetAtTime(muted ? 0 : 0.8, live.ctx.currentTime, 0.02); }
  function ensure() {
    if (!live) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      live = makeGraph(new C()); applyMute();
    }
    return live;
  }
  const running = () => !!live && live.ctx.state === "running";

  function startMusic() {
    if (!running() || mode === "off") return;
    const g = live, now = g.ctx.currentTime, tune = mode === "final" ? TUNES.minor : TUNES.major;
    clearInterval(timer);
    g.musicBus.gain.cancelScheduledValues(now);
    g.musicBus.gain.setTargetAtTime(0, now, 0.03);
    g.musicBus.gain.setTargetAtTime(level(), now + 0.2, 0.04);
    g.step = 0; g.next = now + 0.22;
    timer = setInterval(() => {
      if (g.next < g.ctx.currentTime - 0.1) g.next = g.ctx.currentTime + 0.05; // tab was throttled: skip ahead
      schedule(g, tune, g.ctx.currentTime + 0.18, () => (mode === "calm" ? 0.12 : intensityNow));
    }, 30);
  }

  // m: "off", "calm" (lobby and scores), "play" (timed phases), "final" (final question)
  A.music = function (m) {
    if (m === mode) return;
    mode = m; clearInterval(timer); timer = null;
    ensure();
    if (!running()) return;
    if (m === "off") live.musicBus.gain.setTargetAtTime(0, live.ctx.currentTime, 0.04);
    else startMusic();
  };
  // Lower the music while the board is reading aloud.
  A.duck = function (on) {
    ducked = !!on;
    if (running() && mode !== "off") live.musicBus.gain.setTargetAtTime(level(), live.ctx.currentTime, 0.12);
  };
  A.intensity = (x) => { intensityNow = Math.max(0, Math.min(1, x)); };
  A.fx = function (name) {
    const g = ensure();
    if (g && running() && FX[name]) FX[name](g, g.ctx.currentTime + 0.01);
  };
  A.unlock = function () {
    const g = ensure();
    if (g && g.ctx.state !== "running") g.ctx.resume().then(() => { if (mode !== "off") startMusic(); }).catch(() => {});
  };
  A.blocked = () => !running();
  A.muted = () => muted;
  A.setMuted = function (v) { muted = !!v; try { localStorage.setItem(KEY, muted ? "1" : "0"); } catch (e) {} applyMute(); };
  A.status = () => ({ mode, running: running(), intensity: intensityNow, muted });

  // Offline render, used for testing and for the preview file.
  // items: { fx: name, t } or { music: "major"|"minor", t0, t1, I: (seconds) => 0..1 }
  A._render = async function (seconds, items) {
    const c = new OfflineAudioContext(1, Math.ceil(44100 * seconds), 44100), g = makeGraph(c);
    g.musicBus.gain.value = 1;
    items.forEach((it) => {
      if (it.fx) FX[it.fx](g, it.t);
      else { g.step = 0; g.next = it.t0; schedule(g, TUNES[it.music], it.t1, (t) => it.I(t - it.t0)); }
    });
    return (await c.startRendering()).getChannelData(0);
  };

  window.RN_AUDIO = A;
})();
