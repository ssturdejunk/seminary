# Seminary Review Night

Jackbox-style review game for a seminary class (about 20 students on phones, board on a projector).
Round types: Quick Quiz (`trivia`), True or False (`tf`), Put It in Order (`order`), Fake Out (`fib`, Fibbage-style), Sketch It (`draw`, Drawful-style), Apply It (`apply`, write and vote). The host picks and orders tonight's rounds on the setup screen; an optional final wager follows the last round. `final` is only the wager's fallback question bank.
Live site: https://ssturdejunk.github.io/seminary/review-night/host.html

## Layout
- `review-night/` What GitHub Pages serves today (the live site). Do not edit it directly; when a `web/` change is approved, copy `web/` over it.
- `web/`      The source of the site. Copy its contents to `review-night/` to deploy. No build step, vanilla JS, no framework.
- `offline/`  Backup edition for when internet fails (students use dry-erase boards, host taps who was right). `python3 offline/build.py` writes one self-contained file to `dist/review-night-offline.html`. Only `app.js`, `style.css`, `template.html` are offline-specific; it inlines `web/pack.js`, `web/audio.js`, `web/voice.js` and the pack/extras named in `web/config.js`.
- `tools/content_sheet.py` Content workbook <-> pack. `make OUT.xlsx` builds the blank workbook (one tab per game, Verified column); `topack IN.xlsx OUT.json [--verified-only]` builds a pack and lists unverified rows. The teacher's copy lives in Google Sheets ("Review Night Content"); export it as .xlsx through Drive and run topack. Tested by `tests/content_sheet_test.py`.
- `tests/`    `node tests/validate_content.js` (content rules), `python3 tests/smoke.py` (Playwright: board + phone in local mode, plus offline build loads) and `python3 tests/full_game.py` (seven scripted games with 6s timers and exact score checks, using generated content). Run all three before every commit.

## Architecture (web/)
- `host.js` is the board and owns ALL game state and scoring. `play.js` is a thin phone client that renders whatever `view` message the host sends (`viewFor(pid)` in host.js). Moderator phone uses `modView/modCmd`.
- Phases: setup, lobby, intro, tq/tr (trivia and tf), oq/or (order), fw/fready/fg/fr (Fake Out), dw/dready/dg/dr (Sketch It), aw/aready/ag/ar (Apply It), xw/xq/xr (final wager), scores, end. Timed phases read `settings.timers` (defaults in `DEFAULT_TIMERS`). A `hold` flag pauses the timer while the voice reads (`HOLD_PHASES`). New reveal phases must be listed in `go()`'s `reveal` array or their answers are wiped.
- Round plan: `getPlan()` (localStorage `rn-plan-v1`, keyed per pack) holds the chosen round indexes and the wager flag. `buildDeck()` builds `S.rounds` in that order, sets each round's `mult` from `settings.multipliers` by position, and `wagerFrom()` sets `S.wagerQ` (kind `choice` or `order`) from one extra item of the last round, else the `finals` bank, else an unused trivia/tf item.
- Voting: with `plan.vote` on and 2+ ticked rounds, the lobby phone view is `vote` (pick up to `votePicks`, default 3). `S.votes[pid]` holds round indexes; `votedOrder()` keeps the top `maxRounds` (5) with at least one vote, least popular first (ties random), and records `S.voteResult` for the first intro. No votes means the host's order.
- Sets of 3 or 4 students are rebuilt at the start of Fake Out, Sketch It, Apply It and the wager. Late joiners are audience, earn points, and are promoted next round keeping their points.
- Scoring: base points times the round's position multiplier. Trivia and tf have speed bonuses. Order: per item in place plus a perfect bonus. Apply It: per vote plus a bonus for each set's top answer (ties share it). Final wager is capped at max(score, finalMaxWagerFloor); an order wager needs a perfect order.
- The offline edition supports trivia, fib, draw and final only; it drops other round types when loading a pack.
- `net.js` transports: `firebase` (default; Realtime Database relay, works on cellular), `peer` (PeerJS, fails on many cellular networks), `local` (BroadcastChannel, one browser, used by tests). Chosen by `config.js` `net` or `?net=`. Firebase layout: `rooms/<CODE>/{host, clients/<id>, up, down/<id>}`, messages are JSON strings. Rules open only `rooms/$room`.
- `pack.js` defines content: a PACK (full course) or EXTRAS (`"extras": true`, adds items). `validate`, `validateExtras`, `merge`, `summary`. Questions are drawn per game by `buildDeck`, preferring least-seen items (localStorage `rn-seen-v1`). In files the correct answer is first with `answer: 0`; the board reshuffles.
- Doctrinal Mastery: a pack's `mastery` list ({ref, phrase, quoted}) is expanded by `RN_PACK.expandMastery` (called from `merge`) into First Letters / Fill in the Blank quiz items, Unscramble / Matching order puzzles and Sketch It stories, tagged `dm` and `ref`. Generation is deterministic (stable ids for the seen-history).
- `buildDeck` picks the last round first, then Fake Out, registering their answers as guards; `pick(..., g)` skips items that would show a guard's answer earlier in the game (same passage via `refsOf` + answer text via `visible`), avoids one passage twice in a round, and caps `dm` items at `settings.mastery.share`. `wagerFrom` skips backup questions whose answer was already shown. `tests/smoke.py` checks 4 real builds for give-aways.
- True or False plays as a blitz (`settings.tfBlitz`, default on): 6s per statement, no voice hold or reading, the answer flashes for `TF_FLASH` ms and the next starts by itself; 15 per round. `expandMastery` also adds a true and a false (nearby wrong reference) statement per passage.
- Final Challenge (`settings.finalChallenge`, default on): the wager question comes from `D._challenges` (letters: first word plus first letters with 6 neighboring references; blanks: three missing words; words: every word in order after an order round), preferring a passage not used tonight.
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
- `python3 tests/full_game.py` (about 50 seconds)
- `python3 offline/build.py`
- Local run: `cd web && python3 -m http.server 8000`, open `http://localhost:8000/host.html?net=local`

## Good next steps
0. Read `CONTENT-PLAN.md` first: current content decisions, sources, the duplicate review, and proposals awaiting the teacher's OK.
1. Add a Seminary-wide pack for the next course (use `web/data/CONTENT-GUIDE.md`), keep `old-testament.json` as an example.
2. Check the unverified quotes in the Old Testament pack.
3. Add a trivia-elimination variant (Trivia Murder Party style) as an optional setting, off by default (proposal agreed in chat, not built).
4. Teach the offline edition the new round types (tf, order, apply).
5. Firebase: add a cleanup for old `rooms/*` and tighten rules if possible.
