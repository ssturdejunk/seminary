#!/usr/bin/env python3
"""Scripted full games: board + phones in local mode, short timers, exact score checks.

Run: python3 tests/full_game.py     (needs: pip install playwright; a Chromium for Playwright)

Content is generated here (arithmetic, weekdays, made-up clues), not scripture, so the test
never depends on a real pack. Every timer is 6s. Extras are skipped (?extras=none).

Game 1 (every round type, chosen and reordered on the setup screen):
  True or False x1, Put It in Order x2, Fake Out x3, Sketch It x3, Apply It x3, Quick Quiz x3,
  then the final wager on one more Quick Quiz question.
  Players: A (always right), B, C, D (always wrong, ends at 0 before the wager),
  L joins between Fake Out writing and guessing (audience) and must keep points when promoted,
  M joins during the wager (audience, flat bonus).
Game 2: Put It in Order only; the wager question is an order (only a perfect order wins).
Game 3: Apply It last; the wager falls back to the pack's finals bank.
Game 4: final wager turned off; the game ends after the last round's standings.
"""
import os, sys, json, threading, http.server, time, math
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(HERE, "..", "web")
TIMER = 6
FLOOR = 300
jsround = lambda x: math.floor(x + 0.5)  # JavaScript Math.round

def make_pack():
    nums = [(2, 3), (4, 5), (6, 1), (7, 2), (3, 8), (5, 5)]
    trivia = [{"q": f"What is {a} plus {b}?", "choices": [str(a + b), str(a + b + 1), str(a + b + 2), str(a + b + 3)], "answer": 0} for a, b in nums]
    tf = [{"s": f"{a} is greater than {b}.", "a": a > b} for a, b in [(9, 2), (1, 7), (5, 3), (2, 8), (6, 4), (3, 9), (8, 1), (4, 6)]]
    order = [
        {"prompt": "Put the weekdays in order.", "items": ["Monday", "Tuesday", "Wednesday", "Thursday"]},
        {"prompt": "Put the months in order.", "items": ["January", "February", "March", "April", "May"]},
        {"prompt": "Smallest to largest.", "items": ["one", "ten", "hundred", "thousand"]},
        {"prompt": "Earliest to latest.", "items": ["dawn", "noon", "dusk", "midnight"]},
    ]
    fib = [{"prompt": f"Test clue {i}: the secret word is ____", "answer": f"zebra{i}", "alt": [], "ref": f"Test {i}",
            "house": [f"housefake alpha{i}", f"housefake beta{i}"]} for i in range(4)]
    draw = [{"story": s, "ref": "Test"} for s in ["A cat on a mat", "A boat at sea", "A tall tree", "The rising sun"]]
    apply = [{"prompt": f"Test situation {i}", "ref": f"Test ref {i}"} for i in range(4)]
    finals = [{"q": "Fallback final: which letter comes first?", "choices": ["A", "B", "C", "D", "E"], "answer": 0},
              {"q": "Fallback final: which color is the sky?", "choices": ["Blue", "Green", "Red", "Yellow", "Purple"], "answer": 0}]
    timers = {k: TIMER for k in ["trivia", "tf", "order", "fibWrite", "fibGuess", "drawDraw", "drawGuess", "applyWrite", "applyVote", "finalWager", "finalQuestion"]}
    return {"title": "Test Pack", "course": "Tests", "settings": {"setSize": 4, "timers": timers, "points": {
        "triviaCorrect": 100, "triviaSpeedBonus": 50, "tfCorrect": 50, "tfSpeedBonus": 25, "orderPerItem": 25, "orderPerfect": 50,
        "fibTruth": 100, "fibFooled": 50, "drawCorrect": 100, "drawArtistMax": 100, "drawFavorite": 50,
        "applyVote": 50, "applyWin": 100, "finalMaxWagerFloor": FLOOR, "finalAudienceCorrect": 100}},
        "rounds": [
            {"type": "trivia", "count": 2, "questions": trivia},
            {"type": "tf", "count": 3, "statements": tf},
            {"type": "order", "count": 2, "puzzles": order},
            {"type": "fib", "count": 2, "clues": fib},
            {"type": "draw", "count": 3, "stories": draw},
            {"type": "apply", "count": 2, "prompts": apply},
            {"type": "final", "title": "Bonus Bank", "finals": finals}]}

PACK = make_pack()
PTS = PACK["settings"]["points"]
TRIVIA, TF, ORDER, FIB, DRAW, APPLY = range(6)

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


class Game:
    def __init__(self, ctx, name):
        self.ctx, self.name, self.phones = ctx, name, {}
        self.host = ctx.new_page(); self.host.on("pageerror", lambda e: errs.append(name + " board: " + str(e)))
        self.host.goto(BASE + "/host.html?net=local&extras=none&data=data/__test-pack.json")
        self.host.wait_for_function("window.RN_HOST && document.querySelector('#cNext') && !document.querySelector('#cNext').disabled", timeout=10000)
        self.code = self.H("return S.code")

    def H(self, js): return self.host.evaluate("(() => { const S = RN_HOST.state(); " + js + " })()")
    def phase(self): return self.H("return S.phase")
    def key(self): return self.H("return S.key")
    def nxt(self): self.host.click("#cNext")
    def scores(self): return self.H("const o={}; for (const id in S.players) o[id]=S.players[id].score; return o")
    def wait_phase(self, *ph, timeout=TIMER * 1000 + 8000):
        self.host.wait_for_function("p => p.includes(RN_HOST.state().phase)", arg=list(ph), timeout=timeout)
        return self.phase()

    # ----- setup screen: tonight's rounds -----
    def plan(self): return self.host.evaluate("""() => { const all = JSON.parse(localStorage.getItem('rn-plan-v1') || '{}'); const v = Object.values(all)[0]; return v || null; }""")
    def cur_plan(self): return self.plan() or {"order": list(range(6)), "wager": True}  # nothing saved yet = defaults
    def checked(self, i): return self.host.locator(f'.rrow input[data-r="{i}"]').is_checked()
    def set_plan(self, want, wager):
        for i in want:
            if not self.checked(i): self.host.click(f'.rrow input[data-r="{i}"]')
        for i in range(6):
            if i not in want and self.checked(i): self.host.click(f'.rrow input[data-r="{i}"]')
        for t, i in enumerate(want):
            while self.cur_plan()["order"].index(i) > t: self.host.click(f'.rrow [data-up="{i}"]')
        if self.host.locator("#planWager").is_checked() != wager: self.host.click("#planWager")
        p = self.cur_plan()
        check(p["order"] == want and p["wager"] == wager, f"{self.name}: setup screen saved rounds {want}, wager {'on' if wager else 'off'}")
        check(self.host.locator("#cNext").is_visible() and self.host.locator("#cNext").is_enabled(), f"{self.name}: Start button still visible after choosing rounds")

    # ----- phones -----
    def join(self, label):
        pg = self.ctx.new_page(); pg.set_viewport_size({"width": 390, "height": 800})
        pg.on("pageerror", lambda e, l=label: errs.append(f"{self.name} {l}: {e}"))
        pg.goto(f"{BASE}/play.html?net=local&room={self.code}")
        pg.wait_for_selector("#jn"); pg.fill("#jn", label); pg.click("#jb")
        pid = None
        for _ in range(50):
            pid = pg.evaluate("sessionStorage.getItem('rn-pid')")
            if pid and self.H(f"return !!S.players[{json.dumps(pid)}]"): break
            time.sleep(0.1)
        self.phones[label] = {"page": pg, "pid": pid}
        return pid
    def pid(self, l): return self.phones[l]["pid"]
    def page(self, l): return self.phones[l]["page"]
    def label_of(self, p): return next(l for l in self.phones if self.phones[l]["pid"] == p)
    def view(self, l, k, kinds):
        self.page(l).wait_for_function(
            "([k, kinds]) => { const v = window.RN_PHONE && RN_PHONE.view(); return v && v.key === k && kinds.includes(v.v); }",
            arg=[k, kinds], timeout=8000)
    def tap(self, l, k, idx=None, text=None):
        self.view(l, k, ["choose"])
        b = self.page(l).locator(".choices button")
        (b.filter(has_text=text).first if text is not None else b.nth(idx)).click()
    def order(self, l, k, shown, want):
        """Tap items so the submitted order is `want` (original item numbers)."""
        self.view(l, k, ["order"])
        pg = self.page(l)
        for o in want: pg.locator(".oitem").nth(shown.index(o)).click()
        pg.click("#ol")
        pg.wait_for_function("k => RN_PHONE.view().key === k && RN_PHONE.view().locked", arg=k, timeout=5000)
    def expect(self, before, exp, what):
        after, bad = self.scores(), []
        for p in after:
            got, want = after[p] - before.get(p, 0), exp.get(p, 0)
            if got != want: bad.append(f"{self.label_of(p)} got {got:+} want {want:+}")
        check(not bad, f"{self.name}: {what}" + ("" if not bad else ": " + "; ".join(bad)))
    def close(self):
        for v in self.phones.values(): v["page"].close()
        self.host.close()


def play_choice_round(g, kind, m, players, timeout_last=False):
    """Quick Quiz or True or False: A right, B/C alternate, D wrong. Optionally the last item times out."""
    base = PTS["tfCorrect" if kind == "tf" else "triviaCorrect"]; bonus = PTS["tfSpeedBonus" if kind == "tf" else "triviaSpeedBonus"]
    n = g.H("return S.rounds[S.r].questions.length")
    for qi in range(n):
        g.wait_phase("tq"); k = g.key(); total = g.H("return S.total")
        ans = g.H("return S.rounds[S.r].questions[S.i].answer"); nch = g.H("return S.rounds[S.r].questions[S.i].choices.length")
        if kind == "tf": check(nch == 2 and g.H("return S.rounds[S.r].questions[S.i].choices.join('/')") == "True/False", f"{g.name}: True or False shows True/False in that order")
        wrong = (ans + 1) % nch
        before = g.scores()
        if timeout_last and qi == n - 1:
            plan = {"A": ans}; g.tap("A", k, ans)
            t0 = time.time(); g.wait_phase("tr", timeout=TIMER * 1000 + 4000)
            check(time.time() - t0 < TIMER + 3, f"{g.name}: unanswered question auto-revealed after the {TIMER}s timer")
        else:
            plan = {l: (ans if l == "A" or (l != "D" and (qi + ord(l)) % 2 == 0) else wrong) for l in players}
            for l, v in plan.items(): g.tap(l, k, v)
            g.wait_phase("tr")
        left = g.H("const o={}; for (const id in S.ans) o[id]=S.ans[id].left; return o")
        exp = {g.pid(l): m * (base + jsround(bonus * max(0, left[g.pid(l)]) / total)) for l, v in plan.items() if v == ans}
        g.expect(before, exp, f"{kind} q{qi+1}: correct = ({base} + speed) x{m}")
        g.nxt()
    g.wait_phase("scores")


def play_order_round(g, m, players):
    n = g.H("return S.rounds[S.r].puzzles.length")
    for zi in range(n):
        g.wait_phase("oq"); k = g.key()
        shown = g.H("return S.rounds[S.r].puzzles[S.i].shown"); items = len(shown)
        ident = list(range(items))
        plans = {"A": ident, "B": [1, 0] + ident[2:], "C": ident[:-2] + [items - 1, items - 2], "D": ident[1:] + [0], "L": ident}
        before = g.scores(); exp = {}
        for l in players:
            o = plans[l]; g.order(l, k, shown, o)
            right = sum(1 for p, it in enumerate(o) if it == p)
            exp[g.pid(l)] = m * (PTS["orderPerItem"] * right + (PTS["orderPerfect"] if right == items else 0))
        g.wait_phase("or")
        g.expect(before, exp, f"Put It in Order puzzle {zi+1}: 25 per place + 50 perfect, x{m}")
        g.nxt()
    g.wait_phase("scores")


with sync_playwright() as pw:
    b = pw.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
    ctx = b.new_context(viewport={"width": 1280, "height": 720})
    ctx.add_init_script("try{localStorage.setItem('rn-voice',JSON.stringify({on:false}))}catch(e){}")
    ctx.route("**/data/__test-pack.json", lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps(PACK)))

    # =================== Game 1: every round type ===================
    g = Game(ctx, "G1")
    check(g.plan() is None and all(g.checked(i) for i in range(6)), "G1: by default every round in the pack is chosen, in pack order")
    want = [TF, ORDER, FIB, DRAW, APPLY, TRIVIA]
    g.set_plan(want, True)
    mults = [t.strip() for t in g.host.locator(".rrow .rmult").all_inner_texts()][:6]
    check(mults == ["×1", "×2", "×3", "×3", "×3", "×3"], f"G1: multipliers follow position {mults}")
    g.nxt(); g.wait_phase("lobby")
    for l in "ABCD": g.join(l)
    g.nxt(); g.wait_phase("intro")
    check(g.H("return S.rounds.map(r => r.type).join(',')") == "tf,order,fib,draw,apply,trivia", "G1: game uses the chosen order")
    check(g.H("return S.rounds.map(r => r.mult).join(',')") == "1,2,3,3,3,3", "G1: round multipliers 1,2,3,3,3,3")
    check(g.H("return S.wagerQ && S.wagerQ.kind") == "choice" and g.H("return S.wagerQ.src") == "Quick Quiz", "G1: wager question comes from the last round (Quick Quiz)")
    check(g.H("return S.rounds[5].questions.every(q => q.q !== S.wagerQ.q)"), "G1: wager question is not one of the round's questions")

    # True or False x1
    g.nxt(); play_choice_round(g, "tf", 1, "ABCD", timeout_last=True)
    # Put It in Order x2
    g.nxt(); g.wait_phase("intro"); g.nxt(); play_order_round(g, 2, "ABCD")
    check(g.scores()[g.pid("D")] == 0, "G1: D has 0 after two rounds")

    # Fake Out x3
    m = 3; g.nxt(); g.wait_phase("intro"); g.nxt(); g.wait_phase("fw"); k = g.key()
    sets = g.H("return S.sets.map(s => s.members)")
    for i, l in enumerate("ABCD"):
        g.view(l, k, ["write"]); g.page(l).fill("#wi", f"zorblax quintessa {l.lower()}{i}"); g.page(l).click("#wb")
    g.wait_phase("fready"); g.join("L")
    check(g.H(f"return S.players[{json.dumps(g.pid('L'))}].role") == "audience", "G1: late joiner L is audience during Fake Out")
    g.nxt()
    for si in range(len(sets)):
        g.wait_phase("fg"); k = g.key()
        members = g.H("return S.sets[S.i].members"); opts = g.H("return S.opts.map(o => ({truth:o.truth, authors:o.authors}))")
        truth = next(i for i, o in enumerate(opts) if o["truth"])
        fooler = next((i for i, o in enumerate(opts) if o["authors"] and g.pid("D") not in o["authors"]), None)
        not_d = next(i for i, o in enumerate(opts) if not o["truth"] and g.pid("D") not in o["authors"])
        guessers = [l for l in "ABCDL" if g.pid(l) not in members]
        before = g.scores(); exp = {}
        for l in guessers:
            if l == "D": v = not_d
            elif l == guessers[0] and fooler is not None and l != "L": v = fooler
            else: v = truth
            g.tap(l, k, v)
            if v == truth: exp[g.pid(l)] = exp.get(g.pid(l), 0) + PTS["fibTruth"] * m
            else:
                for a in opts[v]["authors"]: exp[a] = exp.get(a, 0) + PTS["fibFooled"] * m
        g.wait_phase("fr"); g.expect(before, exp, f"Fake Out set {si+1}: real 100, fooled 50, x{m}"); g.nxt()
    g.wait_phase("scores")
    l_score = g.scores()[g.pid("L")]
    check(l_score > 0, f"G1: late joiner L earned points as audience ({l_score})")

    # Sketch It x3
    g.nxt(); g.wait_phase("intro"); g.nxt(); g.wait_phase("dw"); k = g.key()
    check(g.H(f"return S.players[{json.dumps(g.pid('L'))}].role") == "player", "G1: late joiner L promoted to player")
    check(g.scores()[g.pid("L")] == l_score, f"G1: late joiner L kept their points ({l_score})")
    for l in "ABCDL":
        pg = g.page(l); g.view(l, k, ["draw"]); box = pg.locator("#pad").bounding_box()
        pg.mouse.move(box["x"] + 30, box["y"] + 30); pg.mouse.down(); pg.mouse.move(box["x"] + 150, box["y"] + 120, steps=4); pg.mouse.up()
        pg.click("#db"); pg.wait_for_function("() => RN_PHONE.view() && RN_PHONE.view().sent === true", timeout=5000)
    g.wait_phase("dready"); g.nxt()
    for si in range(g.H("return S.sets.length")):
        g.wait_phase("dg"); k = g.key()
        members = g.H("return S.sets[S.i].members"); drawers = g.H("return S.drawings.map(d => d.pid)")
        story = g.H("return S.rounds[S.r].stories[S.sets[S.i].item].story")
        other = g.H("const r = S.rounds[S.r], it = S.sets[S.i].item; return r.stories.find((s, i) => i !== it).story")
        guessers = [l for l in "ABCDL" if g.pid(l) not in members]; d_set = g.pid("D") in members
        right = {l: (not d_set and l != "D") for l in guessers}
        fav_i = next((i for i, p in enumerate(drawers) if p != g.pid("D")), None) if len(drawers) > 1 else None
        before = g.scores(); exp = {}
        for l in guessers:
            g.tap(l, k, text=story if right[l] else other)
            if len(drawers) > 1:
                g.view(l, k, ["fav"]); g.page(l).locator(".choices button").nth(fav_i).click()
        g.wait_phase("dr")
        correct = sum(right.values())
        for l in guessers:
            if right[l]: exp[g.pid(l)] = exp.get(g.pid(l), 0) + PTS["drawCorrect"] * 3
        for p in drawers: exp[p] = exp.get(p, 0) + jsround(PTS["drawArtistMax"] * 3 * correct / len(guessers))
        if fav_i is not None: exp[drawers[fav_i]] = exp.get(drawers[fav_i], 0) + PTS["drawFavorite"] * 3
        g.expect(before, exp, f"Sketch It set {si+1}: guess, artist share, favorite, x3"); g.nxt()
    g.wait_phase("scores")

    # Apply It x3
    m = 3; g.nxt(); g.wait_phase("intro"); g.nxt(); g.wait_phase("aw"); k = g.key()
    check(g.H("return S.sets.length") == 2, "G1: Apply It split 5 players into 2 sets")
    for l in "ABCDL":
        g.view(l, k, ["write"]); pg = g.page(l)
        check(pg.locator("#wb").inner_text().strip() == "Send answer", f"G1: {l}'s Apply It screen says Send answer") if l == "A" else None
        pg.fill("#wi", f"Answer written by {l}: pray and read."); pg.click("#wb")
        pg.wait_for_function("() => RN_PHONE.view() && !!RN_PHONE.view().sent", timeout=5000)
    g.wait_phase("aready"); g.nxt()
    nsets = g.H("return S.sets.length"); done = 0
    while g.phase() != "scores" and done < nsets:
        g.wait_phase("ag", "scores")
        if g.phase() == "scores": break
        k = g.key(); members = g.H("return S.sets[S.i].members")
        opts = g.H("return S.opts.map(o => o.authors)")
        good = [i for i, a in enumerate(opts) if g.pid("D") not in a]
        voters = [l for l in "ABCDL" if g.pid(l) not in members]
        before = g.scores(); votes = [0] * len(opts)
        for j, l in enumerate(voters):
            v = good[0] if (j == 0 or len(good) == 1) else good[1 % len(good)] if j == 1 else good[0]
            g.tap(l, k, v); votes[v] += 1
        g.wait_phase("ar")
        exp = {}
        top = max(votes)
        for i, a in enumerate(opts):
            for p in a:
                exp[p] = exp.get(p, 0) + votes[i] * PTS["applyVote"] * m + (PTS["applyWin"] * m if votes[i] == top and top > 0 else 0)
        g.expect(before, exp, f"Apply It set {done+1}: 50 per vote, 100 top answer, x{m}")
        check(g.host.locator(".tile.right").count() >= 1, f"G1: Apply It set {done+1} board marks the top answer")
        done += 1; g.nxt()
    g.wait_phase("scores")
    check(g.scores()[g.pid("D")] == 0, "G1: D still has 0")

    # Quick Quiz x3 (last round), then the wager
    g.nxt(); g.wait_phase("intro")
    check("final wager" in g.host.locator("#stage").inner_text().lower(), "G1: last round's rules mention the final wager")
    g.nxt(); play_choice_round(g, "trivia", 3, "ABCDL")
    check(g.host.locator("#cNext").inner_text().strip() == "Final wager", "G1: after the last standings the button says Final wager")
    g.nxt(); g.wait_phase("xw"); k = g.key()
    g.join("M")
    check(g.H(f"return S.players[{json.dumps(g.pid('M'))}].role") == "audience", "G1: M is audience in the wager")
    sc = g.scores(); hi = max("ABCL", key=lambda l: sc[g.pid(l)])
    check(sc[g.pid(hi)] > FLOOR, f"G1: {hi} has {sc[g.pid(hi)]}, above the floor (score-cap branch tested)")
    for l in "ABCDL":
        g.view(l, k, ["wager"]); off = g.page(l).evaluate("RN_PHONE.view().max")
        check(off == max(sc[g.pid(l)], FLOOR), f"G1: {l} offered max wager {off} = max(score {sc[g.pid(l)]}, {FLOOR})")
    sent = {"A": 99999, "B": 0, "C": 50, "D": 99999, "L": 99999}
    sent[hi] = sc[g.pid(hi)] + 5000
    for l, v in sent.items():
        g.page(l).evaluate("""([code, pid, key, v]) => { const ch = new BroadcastChannel('rn-' + code), from = 'c-test-' + pid;
            ch.postMessage({ to: 'host', from, msg: { t: 'join', pid, name: '' } }); ch.postMessage({ to: 'host', from, msg: { t: 'wager', key, v } }); }""",
            [g.code, g.pid(l), k, v])
    g.host.wait_for_function("n => Object.keys(RN_HOST.state().wagers).length >= n", arg=5, timeout=5000)
    wg = g.H("return S.wagers")
    for l, v in sent.items():
        want_w = min(v, max(sc[g.pid(l)], FLOOR))
        check(wg.get(g.pid(l)) == want_w, f"G1: {l} wager {v} stored as {wg.get(g.pid(l))}, want {want_w}")
    g.wait_phase("xq"); k = g.key()
    ans = g.H("return S.wagerQ.answer"); wrong = (ans + 1) % g.H("return S.wagerQ.choices.length")
    plan = {"A": ans, "B": ans, "C": wrong, "D": wrong, "L": ans, "M": ans}
    before = g.scores()
    for l, v in plan.items(): g.tap(l, k, v)
    g.wait_phase("xr")
    exp = {g.pid(l): (wg[g.pid(l)] if plan[l] == ans else -wg[g.pid(l)]) for l in "ABCDL"}
    exp[g.pid("M")] = PTS["finalAudienceCorrect"]
    g.expect(before, exp, "wager: right adds the capped wager, wrong subtracts it, audience flat bonus")
    g.nxt(); g.wait_phase("end")
    g.close()

    # =================== Game 2: order wager ===================
    g = Game(ctx, "G2")
    g.set_plan([ORDER], True)
    g.nxt(); g.wait_phase("lobby")
    for l in "ABC": g.join(l)
    g.nxt(); g.wait_phase("intro")
    check(g.H("return S.rounds[0].mult") == 1, "G2: a single round is x1")
    check(g.H("return S.wagerQ.kind") == "order", "G2: the wager question is an order puzzle")
    g.nxt(); play_order_round(g, 1, "ABC")
    g.nxt(); g.wait_phase("xw"); k = g.key()
    check("only a perfect order wins" in g.host.locator("#stage").inner_text(), "G2: the board says only a perfect order wins")
    sc = g.scores()
    for l in "ABC":
        g.view(l, k, ["wager"]); pg = g.page(l)
        pg.click(".quick button[data-f='1']"); pg.click("#wl")   # "All of it" through the real slider
    g.host.wait_for_function("n => Object.keys(RN_HOST.state().wagers).length >= n", arg=3, timeout=5000)
    wg = g.H("return S.wagers")
    got = {l: (wg.get(g.pid(l)), max(sc[g.pid(l)], FLOOR)) for l in "ABC"}
    check(all(a == b for a, b in got.values()), f"G2: All of it on the phone wagers exactly the cap (stored, cap: {got})")
    g.wait_phase("xq"); k = g.key()
    shown = g.H("return S.wagerQ.shown"); n = len(shown); ident = list(range(n))
    plans = {"A": ident, "B": [1, 0] + ident[2:], "C": ident[1:] + [0]}
    before = g.scores()
    for l in "ABC": g.order(l, k, shown, plans[l])
    g.wait_phase("xr")
    g.expect(before, {g.pid("A"): wg[g.pid("A")], g.pid("B"): -wg[g.pid("B")], g.pid("C"): -wg[g.pid("C")]},
             "order wager: perfect wins the wager, two swapped items loses it")
    g.nxt(); g.wait_phase("end")
    g.close()

    # =================== Game 3: fallback wager bank ===================
    g = Game(ctx, "G3")
    g.set_plan([APPLY], True)
    g.nxt(); g.wait_phase("lobby"); g.join("A"); g.join("B"); g.nxt(); g.wait_phase("intro")
    check(g.H("return S.wagerQ.kind") == "choice" and g.H("return S.wagerQ.src") == "Bonus Bank",
          "G3: Apply It last, so the wager comes from the pack's finals bank")
    g.close()

    # =================== Game 4: wager off ===================
    g = Game(ctx, "G4")
    g.set_plan([TF], False)
    g.nxt(); g.wait_phase("lobby")
    for l in "ABCD": g.join(l)
    g.nxt(); g.wait_phase("intro")
    check(g.H("return S.wagerQ") is None, "G4: no wager question when the wager is off")
    g.nxt(); play_choice_round(g, "tf", 1, "ABCD")
    check(g.host.locator("#cNext").inner_text().strip() == "Finish", "G4: last standings button says Finish")
    g.nxt(); g.wait_phase("end")
    check(True, "G4: game ended without a wager")
    g.close()

    check(not errs, "no uncaught page errors" + (": " + "; ".join(errs[:3]) if errs else ""))
    b.close()
srv.shutdown()
print(f"\n{len(fails)} failed" if fails else "\nall checks passed")
sys.exit(1 if fails else 0)
