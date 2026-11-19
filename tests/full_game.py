#!/usr/bin/env python3
"""Scripted full game: board + phones in local mode, short timers, exact score checks.

Run: python3 tests/full_game.py     (needs: pip install playwright; a Chromium for Playwright)

The test copies the pack named in web/config.js (dataUrl), changes only test-friendly
settings in memory (every timer 6s, a few items per round, a lower wager floor so both
sides of the wager cap are reachable), and serves that copy to the board. No file on
disk is changed. Extras are skipped (?extras=none) so the content is predictable.

Players: A (always right), B, C, D (always wrong, ends at 0), plus two late joiners:
  L joins between Fake Out writing and guessing (audience), earns points as audience,
    and must keep those points when promoted to a player in Sketch It.
  M joins during the final wager (audience) and earns the flat audience bonus.

Checks:
  - every scored reveal: each player's score change equals the value this script expects,
    using the pack's points times the round's mult (x1, x2, x3)
  - trivia speed bonus is applied from the time left, within its bounds
  - a trivia question nobody finishes auto-reveals when the 6s timer runs out
  - final wager is capped at max(score, finalMaxWagerFloor), both for what the phone
    offers and for an oversized wager sent straight to the board
  - right/wrong final answers add/subtract the capped wager; audience gets the flat bonus
  - late joiner keeps points through promotion; no uncaught page errors
"""
import os, sys, json, re, threading, http.server, time, math
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(HERE, "..", "web")
TIMER = 6
TEST_FLOOR = 300  # pack uses 1000; lowered so one player's score exceeds it and one doesn't

def cfg_value(name):
    src = open(os.path.join(WEB, "config.js"), encoding="utf-8").read()
    m = re.search(name + r'\s*:\s*"([^"]*)"', src)
    return m.group(1) if m else ""

PACK = json.load(open(os.path.join(WEB, cfg_value("dataUrl")), encoding="utf-8"))
st = PACK.setdefault("settings", {})
st["timers"] = {k: TIMER for k in ["trivia", "fibWrite", "fibGuess", "drawDraw", "drawGuess", "finalWager", "finalQuestion"]}
st.setdefault("points", {})["finalMaxWagerFloor"] = TEST_FLOOR
COUNTS = {"trivia": 3, "fib": 2, "draw": 3}
for r in PACK["rounds"]:
    if r["type"] in COUNTS: r["count"] = COUNTS[r["type"]]
PTS = st["points"]
MULT = {r["type"]: r.get("mult", 1) for r in PACK["rounds"]}
P = lambda k, d: PTS.get(k, d)
jsround = lambda x: math.floor(x + 0.5)  # JavaScript Math.round, not Python's banker's rounding

class Quiet(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=WEB, **k)
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Quiet)
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{srv.server_port}"

fails, errs = [], []
def check(ok, msg):
    print(("PASS " if ok else "FAIL ") + msg)
    if not ok: fails.append(msg)

with sync_playwright() as pw:
    b = pw.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
    ctx = b.new_context(viewport={"width": 1280, "height": 720})
    ctx.add_init_script("try{localStorage.setItem('rn-voice',JSON.stringify({on:false}))}catch(e){}")
    ctx.route("**/data/__test-pack.json", lambda route: route.fulfill(
        status=200, content_type="application/json", body=json.dumps(PACK)))

    host = ctx.new_page(); host.on("pageerror", lambda e: errs.append("board: " + str(e)))
    host.goto(BASE + "/host.html?net=local&extras=none&data=data/__test-pack.json")
    host.wait_for_function("window.RN_HOST && document.querySelector('#cNext') && !document.querySelector('#cNext').disabled", timeout=10000)
    H = lambda js: host.evaluate("(() => { const S = RN_HOST.state(); " + js + " })()")
    code = H("return S.code")
    phase = lambda: H("return S.phase")
    def wait_phase(*ph, timeout=TIMER * 1000 + 8000):
        host.wait_for_function("p => p.includes(RN_HOST.state().phase)", arg=list(ph), timeout=timeout)
        return phase()
    def nxt(): host.click("#cNext")
    scores = lambda: H("const o={}; for (const id in S.players) o[id]=S.players[id].score; return o")
    key = lambda: H("return S.key")

    phones = {}  # label -> {page, pid}
    def join(label):
        pg = ctx.new_page(); pg.set_viewport_size({"width": 390, "height": 800})
        pg.on("pageerror", lambda e, l=label: errs.append(l + ": " + str(e)))
        pg.goto(f"{BASE}/play.html?net=local&room={code}")
        pg.wait_for_selector("#jn"); pg.fill("#jn", label); pg.click("#jb")
        pid = None
        for _ in range(50):
            pid = pg.evaluate("sessionStorage.getItem('rn-pid')")
            if pid and H(f"return !!S.players[{json.dumps(pid)}]"): break
            time.sleep(0.1)
        phones[label] = {"page": pg, "pid": pid}
        return pid
    pid = lambda l: phones[l]["pid"]
    label_of = lambda p: next(l for l in phones if phones[l]["pid"] == p)
    def phone_view(l, k, kinds):
        phones[l]["page"].wait_for_function(
            "([k, kinds]) => { const v = window.RN_PHONE && RN_PHONE.view(); return v && v.key === k && kinds.includes(v.v); }",
            arg=[k, kinds], timeout=8000)
    def tap_choice(l, k, idx=None, text=None):
        phone_view(l, k, ["choose"])
        btns = phones[l]["page"].locator(".choices button")
        if text is not None: btns.filter(has_text=text).first.click()
        else: btns.nth(idx).click()
    def expect_gains(before, expected, what):
        after = scores()
        bad = []
        for p in after:
            got, want = after[p] - before.get(p, 0), expected.get(p, 0)
            if got != want: bad.append(f"{label_of(p)} got {got:+} want {want:+}")
        check(not bad, what + ("" if not bad else ": " + "; ".join(bad)))

    # ---------- lobby ----------
    nxt(); wait_phase("lobby")
    for l in "ABCD": join(l)
    check(H("return S.order.length") == 4, "four phones joined the lobby")
    nxt(); wait_phase("intro")

    # ---------- Quick Quiz (x{trivia mult}) ----------
    m = MULT["trivia"]; nxt()
    nq = H("return S.rounds[S.r].questions.length")
    for qi in range(nq):
        wait_phase("tq"); k = key(); total = H("return S.total")
        ans = H("return S.rounds[S.r].questions[S.i].answer"); nch = H("return S.rounds[S.r].questions[S.i].choices.length")
        wrong = (ans + 1) % nch
        before = scores()
        if qi < nq - 1:
            plan = {"A": ans, "B": ans if qi == 0 else wrong, "C": wrong if qi == 0 else ans, "D": wrong}
            for l, v in plan.items(): tap_choice(l, k, v)
            wait_phase("tr")
        else:
            # Only A answers; the 6s timer must reveal on its own.
            plan = {"A": ans}; tap_choice("A", k, ans)
            t0 = time.time(); wait_phase("tr", timeout=TIMER * 1000 + 4000)
            check(time.time() - t0 < TIMER + 3, f"unanswered question auto-revealed when the {TIMER}s timer ran out")
        left = H("const o={}; for (const id in S.ans) o[id]=S.ans[id].left; return o")
        base, bonus = P("triviaCorrect", 100), P("triviaSpeedBonus", 0)
        exp = {pid(l): m * (base + jsround(bonus * max(0, left[pid(l)]) / total)) for l, v in plan.items() if v == ans}
        expect_gains(before, exp, f"Quick Quiz q{qi+1}: correct = (100 + speed bonus) x{m}, wrong = 0")
        gains = [g for g in exp.values()]
        check(all(m * base <= g <= m * (base + bonus) for g in gains), f"Quick Quiz q{qi+1}: speed bonus within 0..{bonus * m}")
        nxt()
    wait_phase("scores")
    check(scores()[pid("D")] == 0, "D (always wrong) has 0 after Quick Quiz")

    # ---------- Fake Out (x{fib mult}) ----------
    m = MULT["fib"]; nxt(); wait_phase("intro"); nxt(); wait_phase("fw"); k = key()
    sets = H("return S.sets.map(s => s.members)")
    check(len(sets) == 2 and sorted(len(s) for s in sets) == [2, 2], "Fake Out: 4 players split into 2 sets of 2")
    for i, l in enumerate("ABCD"):
        pg = phones[l]["page"]; phone_view(l, k, ["write"])
        pg.fill("#wi", f"zorblax quintessa {l.lower()}{i} vexillum"); pg.click("#wb")
    wait_phase("fready")
    # L joins now: a set phase, so L is audience.
    join("L")
    check(H(f"return S.players[{json.dumps(pid('L'))}].role") == "audience", "late joiner L is audience during Fake Out")
    nxt()
    for si in range(len(sets)):
        wait_phase("fg"); k = key()
        members = H("return S.sets[S.i].members"); opts = H("return S.opts.map(o => ({truth:o.truth, authors:o.authors}))")
        truth = next(i for i, o in enumerate(opts) if o["truth"])
        guessers = [l for l in "ABCDL" if pid(l) not in members]
        # Pick a fake by a set member who is not D, so D never scores.
        fooler = next((i for i, o in enumerate(opts) if o["authors"] and pid("D") not in o["authors"]), None)
        any_fake = next(i for i, o in enumerate(opts) if not o["truth"])
        before = scores(); exp = {}
        for l in guessers:
            if l == "D": v = any_fake if (fooler is None or pid("D") in opts[any_fake]["authors"]) else fooler
            elif l == guessers[0] and fooler is not None and l != "L": v = fooler
            else: v = truth
            tap_choice(l, k, v)
            if v == truth: exp[pid(l)] = exp.get(pid(l), 0) + P("fibTruth", 100) * m
            else:
                for a in opts[v]["authors"]: exp[a] = exp.get(a, 0) + P("fibFooled", 50) * m
        wait_phase("fr")
        expect_gains(before, exp, f"Fake Out set {si+1}: real = 100 x{m}, each fooled = 50 x{m} to the author")
        nxt()
    wait_phase("scores")
    l_score = scores()[pid("L")]
    check(l_score > 0, f"late joiner L earned points as audience ({l_score})")
    check(scores()[pid("D")] == 0, "D still has 0 after Fake Out")

    # ---------- Sketch It (x{draw mult}) ----------
    m = MULT["draw"]; nxt(); wait_phase("intro"); nxt(); wait_phase("dw"); k = key()
    check(H(f"return S.players[{json.dumps(pid('L'))}].role") == "player", "late joiner L promoted to player in Sketch It")
    check(scores()[pid("L")] == l_score, f"late joiner L kept their points on promotion ({l_score})")
    check(H(f"return S.players[{json.dumps(pid('L'))}].set") >= 0, "late joiner L was placed in a set")
    for l in "ABCDL":
        pg = phones[l]["page"]; phone_view(l, k, ["draw"])
        box = pg.locator("#pad").bounding_box()
        pg.mouse.move(box["x"] + 30, box["y"] + 30); pg.mouse.down()
        pg.mouse.move(box["x"] + 150, box["y"] + 120, steps=4); pg.mouse.up()
        pg.click("#db")
        pg.wait_for_function("() => RN_PHONE.view() && RN_PHONE.view().sent === true", timeout=5000)
    wait_phase("dready"); nxt()
    nsets = H("return S.sets.length")
    for si in range(nsets):
        wait_phase("dg"); k = key()
        members = H("return S.sets[S.i].members"); drawers = H("return S.drawings.map(d => d.pid)")
        story = H("return S.rounds[S.r].stories[S.sets[S.i].item].story")
        other = H("const r = S.rounds[S.r], it = S.sets[S.i].item; return r.stories.find((s, i) => i !== it).story")
        guessers = [l for l in "ABCDL" if pid(l) not in members]
        d_set = pid("D") in members
        # D's set: everyone guesses wrong, so D's drawing earns nothing. Elsewhere: all right except D.
        right = {l: (not d_set and l != "D") for l in guessers}
        fav_i = next((i for i, p in enumerate(drawers) if p != pid("D")), None) if len(drawers) > 1 else None
        before = scores(); exp = {}
        for l in guessers:
            tap_choice(l, k, text=story if right[l] else other)
            if len(drawers) > 1:
                phone_view(l, k, ["fav"])
                pg = phones[l]["page"]
                if fav_i is None: pg.locator(".choices button.ghost").click()
                else: pg.locator(".choices button").nth(fav_i).click()
        wait_phase("dr")
        correct = sum(1 for l in guessers if right[l])
        for l in guessers:
            if right[l]: exp[pid(l)] = exp.get(pid(l), 0) + P("drawCorrect", 100) * m
        for p in drawers:
            exp[p] = exp.get(p, 0) + jsround(P("drawArtistMax", 100) * m * correct / len(guessers))
        if fav_i is not None and guessers:
            exp[drawers[fav_i]] = exp.get(drawers[fav_i], 0) + P("drawFavorite", 50) * m
        expect_gains(before, exp, f"Sketch It set {si+1}: guess = 100 x{m}, artist = 100 x{m} x share right, favorite = 50 x{m}")
        nxt()
    wait_phase("scores")
    check(scores()[pid("D")] == 0, "D still has 0 before the final")

    # ---------- The Final Question ----------
    nxt(); wait_phase("intro"); nxt(); wait_phase("xw"); k = key()
    join("M")
    check(H(f"return S.players[{json.dumps(pid('M'))}].role") == "audience", "late joiner M is audience in the final")
    sc = scores(); floor = P("finalMaxWagerFloor", 500)
    hi = max("ABCL", key=lambda l: sc[pid(l)])
    check(sc[pid(hi)] > floor, f"{hi} has {sc[pid(hi)]}, above the floor {floor} (so the score-cap branch is tested)")
    for l in "ABCDL":
        phone_view(l, k, ["wager"])
        offered = phones[l]["page"].evaluate("RN_PHONE.view().max")
        check(offered == max(sc[pid(l)], floor), f"{l} is offered max wager {offered} = max(score {sc[pid(l)]}, floor {floor})")
    # Send oversized wagers straight to the board (bypassing the phone slider) to test the cap.
    sent = {"A": 99999, "B": 0, "C": 50, "D": 99999, "L": 99999}
    for l, v in sent.items():
        if l == hi: v = sc[pid(l)] + 5000; sent[l] = v
        phones[l]["page"].evaluate("""([code, pid, key, v]) => {
            const ch = new BroadcastChannel('rn-' + code), from = 'c-test-' + pid;
            ch.postMessage({ to: 'host', from, msg: { t: 'join', pid, name: '' } });
            ch.postMessage({ to: 'host', from, msg: { t: 'wager', key, v } });
        }""", [code, pid(l), k, v])
    host.wait_for_function("n => Object.keys(RN_HOST.state().wagers).length >= n", arg=5, timeout=5000)
    wg = H("return S.wagers")
    for l, v in sent.items():
        want = min(v, max(sc[pid(l)], floor))
        check(wg.get(pid(l)) == want, f"{l} wager {v} stored as {wg.get(pid(l))}, want {want} (cap = max(score, floor))")
    wait_phase("xq"); k = key()
    ans = H("const r = S.rounds[S.r]; return r.answer"); nch = H("return S.rounds[S.r].choices.length")
    wrong = (ans + 1) % nch
    plan = {"A": ans, "B": ans, "C": wrong, "D": wrong, "L": ans, "M": ans}
    before = scores()
    for l, v in plan.items(): tap_choice(l, k, v)
    wait_phase("xr")
    exp = {pid(l): (wg[pid(l)] if plan[l] == ans else -wg[pid(l)]) for l in "ABCDL"}
    exp[pid("M")] = P("finalAudienceCorrect", 100)
    expect_gains(before, exp, "Final: right adds the capped wager, wrong subtracts it, audience right = flat bonus")
    nxt(); wait_phase("end")
    final = scores()
    check(final[pid("D")] == -wg[pid("D")], f"D finished at {final[pid('D')]} (0 minus a {wg[pid('D')]} floor wager)")
    check(not errs, "no uncaught page errors" + (": " + "; ".join(errs[:3]) if errs else ""))
    b.close()
srv.shutdown()
print(f"\n{len(fails)} failed" if fails else "\nall checks passed")
sys.exit(1 if fails else 0)
