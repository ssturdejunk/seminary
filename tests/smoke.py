#!/usr/bin/env python3
"""Smoke test: board + one phone in local mode (no network needed).
Run: python3 tests/smoke.py        (needs: pip install playwright; playwright install chromium)
Checks: no page errors, Start button visible on setup, lobby opens, a phone can join.
"""
import os, sys, threading, http.server, functools, re
from playwright.sync_api import sync_playwright

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web")
class Quiet(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def log_message(self, *a): pass
H = Quiet
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{srv.server_port}"
errs, fails = [], []
def check(ok, msg):
    print(("PASS " if ok else "FAIL ") + msg)
    if not ok: fails.append(msg)

with sync_playwright() as p:
    b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
    ctx = b.new_context(viewport={"width": 1280, "height": 720})
    host = ctx.new_page(); host.on("pageerror", lambda e: errs.append(str(e)))
    host.goto(BASE + "/host.html?net=local"); host.wait_for_selector("#cNext", timeout=10000)
    check(host.locator("#cNext").is_visible() and host.locator("#cNext").is_enabled(), "setup shows an enabled primary button")
    check(host.locator(".rrow").count() >= 1 and host.locator("#planWager").count() == 1, "setup lists tonight's rounds and the final wager option")
    code = host.locator("#joinbox .code").first.inner_text().strip()
    check(bool(re.fullmatch(r"[A-Z0-9]{4}", code)), f"room code shown ({code})")
    host.click("#cNext")
    phone = ctx.new_page(); phone.set_viewport_size({"width": 390, "height": 800}); phone.on("pageerror", lambda e: errs.append(str(e)))
    phone.goto(f"{BASE}/play.html?net=local&room={code}")
    phone.wait_for_selector("#jc, input[type=text]", timeout=10000)
    names = phone.locator("input[type=text]")
    if names.count() > 1: names.nth(1).fill("Tester")
    phone.get_by_role("button").first.click()
    host.wait_for_function("document.body.innerText.includes('Tester')", timeout=10000)
    check(True, "phone joined and appears on the board")
    check(not errs, "no uncaught page errors" + (": " + "; ".join(errs[:3]) if errs else ""))
    # Real pack, several game builds: no round may show a later Fake Out ending or the wager answer
    # for the same passage, and generated Doctrinal Mastery drills stay at most half of a round.
    GIVE = """() => { const S = RN_HOST.state(), RE = null;
      const flat = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const refs = (it) => { const r = it.choices && typeof it.answer === 'number' ? it.choices[it.answer] : it.answer;
        return RN_PACK.refsIn([it.ref, it.note, it.s, r, it.story, it.prompt, it.q].filter((x) => typeof x === 'string').join(' ')); };
      const vis = (it) => flat([it.q, it.s, it.prompt, it.story, it.note, typeof it.answer === 'string' ? it.answer : ''].concat(it.choices || [], it.items || []).join(' '));
      const items = S.rounds.map((r) => r.questions || r.puzzles || r.clues || r.stories || r.prompts || []);
      const bad = [];
      S.rounds.forEach((r, fp) => { if (r.type !== 'fib') return; r.clues.forEach((cl) => { const a = flat(cl.answer), rf = refs(cl);
        items.slice(0, fp).forEach((l) => l.forEach((it) => { if (refs(it).some((f) => rf.includes(f)) && vis(it).includes(a)) bad.push('Fake Out: ' + cl.answer); })); }); });
      const w = S.wagerQ; if (w) { const a = flat(w.choices ? w.choices[w.answer] : (w.items || []).join(' ')), rf = refs(w);
        items.forEach((l) => l.forEach((it) => { if (a.length >= 3 && refs(it).some((f) => rf.includes(f)) && vis(it).includes(a)) bad.push('wager: ' + a); })); }
      const heavy = S.rounds.filter((r) => { const l = r.questions || []; return l.length && l.some((x) => !x.dm) && l.filter((x) => x.dm).length > Math.ceil(l.length / 2); }).map((r) => r.type);
      return { bad, heavy }; }"""
    probs = []
    for _ in range(4):
        g = ctx.new_page(); g.goto(BASE + "/host.html?net=local&extras=none"); g.wait_for_selector("#cNext")
        g.click("#cNext"); g.wait_for_timeout(150); g.click("#cNext"); g.wait_for_function("RN_HOST.state().phase === 'intro'", timeout=5000)
        r = g.evaluate(GIVE); probs += r["bad"] + ["too many drills in " + t for t in r["heavy"]]; g.close()
    g = ctx.new_page(); g.goto(BASE + "/host.html?net=local&extras=none"); g.wait_for_selector("#cNext")
    g.click("#cNext"); g.wait_for_timeout(150); g.click("#cNext"); g.wait_for_function("RN_HOST.state().phase === 'intro'", timeout=5000)
    w = g.evaluate("() => { const w = RN_HOST.state().wagerQ; return w && { src: w.src, kind: w.kind, n: (w.choices || w.items || []).length }; }"); g.close()
    check(bool(w) and w["src"] == "Final Challenge" and ((w["kind"] == "choice" and w["n"] == 6) or (w["kind"] == "order" and w["n"] >= 5)),
          f"real pack: the wager is a Final Challenge with 6 close choices or a word-by-word order ({w})")
    check(not probs, "4 game builds from the real pack: no give-aways, drills at most half of Quick Quiz" + (": " + "; ".join(probs[:3]) if probs else ""))
    # offline edition: build it, load it from disk, make sure it starts with no errors
    import subprocess, tempfile
    out = os.path.join(tempfile.mkdtemp(), "offline.html")
    subprocess.run([sys.executable, os.path.join(os.path.dirname(ROOT), "offline", "build.py"), "--out", out], check=True, capture_output=True)
    off = ctx.new_page(); oerr = []; off.on("pageerror", lambda e: oerr.append(str(e)))
    off.goto("file://" + out); off.wait_for_timeout(800)
    check(not oerr and off.locator("#stage").inner_text().strip() != "", "offline edition loads with no errors" + (": " + "; ".join(oerr[:3]) if oerr else ""))
    # A pack with the newer round types (the template) must still load offline; those rounds are skipped there.
    out2 = os.path.join(os.path.dirname(out), "offline-template.html")
    subprocess.run([sys.executable, os.path.join(os.path.dirname(ROOT), "offline", "build.py"), "--out", out2,
                    "--pack", os.path.join(ROOT, "data", "template.json"), "--extras", ""], check=True, capture_output=True)
    off2 = ctx.new_page(); oerr2 = []; off2.on("pageerror", lambda e: oerr2.append(str(e)))
    off2.goto("file://" + out2); off2.wait_for_timeout(800)
    check(not oerr2 and off2.locator("#stage").inner_text().strip() != "", "offline edition loads a pack with new round types" + (": " + "; ".join(oerr2[:3]) if oerr2 else ""))
    b.close()
srv.shutdown()
sys.exit(1 if fails else 0)
