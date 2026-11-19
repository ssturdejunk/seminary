# Seminary Review Night

Jackbox-style review game for a seminary class (about 20 students on phones, board on a projector).
Rounds: Quick Quiz (trivia), Fake Out (Fibbage-style), Sketch It (Drawful-style), The Final Question (wager).
Live site: https://ssturdejunk.github.io/seminary/review-night/host.html

## Layout
- `review-night/` What GitHub Pages serves today (the live site). Do not edit it directly; when a `web/` change is approved, copy `web/` over it.
- `web/`      The source of the site. Copy its contents to `review-night/` to deploy. No build step, vanilla JS, no framework.
- `offline/`  Backup edition for when internet fails (students use dry-erase boards, host taps who was right). `python3 offline/build.py` writes one self-contained file to `dist/review-night-offline.html`. Only `app.js`, `style.css`, `template.html` are offline-specific; it inlines `web/pack.js`, `web/audio.js`, `web/voice.js` and the pack/extras named in `web/config.js`.
- `tests/`    `node tests/validate_content.js` (content rules) and `python3 tests/smoke.py` (Playwright: board + phone in local mode, plus offline build loads). Run both before every commit.

## Architecture (web/)
- `host.js` is the board and owns ALL game state and scoring. `play.js` is a thin phone client that renders whatever `view` message the host sends (`viewFor(pid)` in host.js). Moderator phone uses `modView/modCmd`.
- Phases: setup, lobby, intro, tq/tr (trivia), fw/fready/fg/fr (Fake Out), dw/dready/dg/dr (Sketch It), xw/xq/xr (final), scores, end. Timed phases read `settings.timers`. A `hold` flag pauses the timer while the voice reads.
- Sets of 3 or 4 students are rebuilt at the start of Fake Out, Sketch It and the final. Late joiners are audience, earn points, and are promoted next round keeping their points.
- Scoring: base points times round `mult` (x1, x2, x3). Trivia has a speed bonus. Final wager is capped at max(score, finalMaxWagerFloor).
- `net.js` transports: `firebase` (default; Realtime Database relay, works on cellular), `peer` (PeerJS, fails on many cellular networks), `local` (BroadcastChannel, one browser, used by tests). Chosen by `config.js` `net` or `?net=`. Firebase layout: `rooms/<CODE>/{host, clients/<id>, up, down/<id>}`, messages are JSON strings. Rules open only `rooms/$room`.
- `pack.js` defines content: a PACK (full course) or EXTRAS (`"extras": true`, adds items). `validate`, `validateExtras`, `merge`, `summary`. Questions are drawn per game by `buildDeck`, preferring least-seen items (localStorage `rn-seen-v1`). In files the correct answer is first with `answer: 0`; the board reshuffles.
- Fake answers too similar to the real one are rejected (60% word overlap after dropping stop words).
- `audio.js` synthesizes all sound (no files). `voice.js` uses SpeechSynthesis, shows the best 8 voices plus Show all, normalizes text through a pronounce map.
- Content is DATA, not code: edit `web/data/*.json`. `data/template.json` and `data/CONTENT-GUIDE.md` explain the format. Content must stay course-neutral in code; Old Testament lives only in `data/old-testament.json`.

## Conventions and gotchas
- Repo that gets deployed is PUBLIC. Never commit student names or personal details. Class-specific content goes in a local extras file (`*.local.json` is gitignored) loaded on the setup screen, named `web/data/class-extras.local.json` (offline/build.py picks it up automatically when extrasUrl is empty).
- The Firebase web config in `web/config.js` is a public client config, safe to commit; protection comes from the database rules. Do not add secrets.
- Do not break: the primary button must always be visible on setup (stage scrolls); the voice list must stay short by default; phones retry join every 2.5s; timers pause while the voice reads.
- Keep the offline file free of external URLs (build.py checks).
- Scripture quotes must be checked against the real text. Moses, Abraham, and D&C quotes were NOT machine-verified; confirm in Gospel Library. Trivia scriptures should be Doctrinal Mastery items only.
- No emoji clues. Fake Out clues stop mid-sentence and players fill in a phrase.
- Cannot reach Google from a sandbox, so live Firebase is only testable in a real browser. For Firebase changes, test with the mock approach or ask the teacher to test on cellular.

## Commands
- `node tests/validate_content.js`
- `python3 tests/smoke.py` (pip install playwright; playwright install chromium)
- `python3 offline/build.py`
- Local run: `cd web && python3 -m http.server 8000`, open `http://localhost:8000/host.html?net=local`

## Good next steps
1. Add a Seminary-wide pack for the next course (use `web/data/CONTENT-GUIDE.md`), keep `old-testament.json` as an example.
2. Check the unverified quotes in the Old Testament pack.
3. Add a trivia-elimination variant (Trivia Murder Party style) as an optional setting, off by default.
4. Expand tests: a scripted full game with short timers, scoring checks, late joiner carryover.
5. Firebase: add a cleanup for old `rooms/*` and tighten rules if possible.
