#!/usr/bin/env python3
"""Round trip for tools/content_sheet.py: make a workbook, fill one row per tab,
convert it to a pack, and check the pack with web/pack.js (the board's own rules).
Run: python3 tests/content_sheet_test.py   (needs openpyxl and node)
"""
import os, sys, json, subprocess, tempfile
from openpyxl import load_workbook

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
TOOL = os.path.join(ROOT, "tools", "content_sheet.py")
d = tempfile.mkdtemp(); x = os.path.join(d, "c.xlsx"); out = os.path.join(d, "p.json")
subprocess.run([sys.executable, TOOL, "make", x], check=True, capture_output=True)
wb = load_workbook(x)
rows = {
    "Quick Quiz": ["What is 2 plus 2?", "4", "3", "5", "", "", "Basic sums.", "", "Yes"],
    "True or False": ["Two is more than one.", "True", "", "", "Yes"],
    "Put It in Order": ["Count up.", "one", "two", "three", "four", "", "", "", "", "", "", "Yes"],
    "Fake Out": ["The test word is ____", "zebra", "a zebra; zebras", "lion", "tiger", "", "", "No"],
    "Sketch It": ["A cat", "", "Yes"],
    "Apply It": ["A test situation.", "Test 1:1", "", "Yes"],
    "Final Question": ["Pick A.", "A", "B", "C", "D", "", "", "", "", "Yes"],
}
for tab, vals in rows.items():
    for j, v in enumerate(vals, 1): wb[tab].cell(row=3, column=j, value=v or None)
wb["Sketch It"].cell(row=4, column=1, value="A dog"); wb["Sketch It"].cell(row=4, column=3, value="Yes")
wb["Pack"]["B3"] = "Test Course"
wb.save(x)
r = subprocess.run([sys.executable, TOOL, "topack", x, out], capture_output=True, text=True)
print(r.stdout.strip())
fails = []
def check(ok, msg):
    print(("PASS " if ok else "FAIL ") + msg)
    if not ok: fails.append(msg)
p = json.load(open(out))
check([rd["type"] for rd in p["rounds"]] == ["trivia", "tf", "order", "fib", "draw", "apply", "final"], "every tab became a round, examples skipped")
check(p["course"] == "Test Course", "course read from the Pack tab")
check(p["rounds"][1]["statements"][0]["a"] is True, "True or False read as a boolean")
check(p["rounds"][3]["clues"][0]["alt"] == ["a zebra", "zebras"], "Also accept split on ;")
check("Fake Out row 3" in r.stdout and "unverified" in r.stdout, "unverified row is reported")
node = subprocess.run(["node", "-e", """
const fs=require('fs'),vm=require('vm');const c={window:{}};c.window.window=c.window;
vm.runInNewContext(fs.readFileSync(process.argv[1],'utf8'),c);const P=c.window.RN_PACK;
const d=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));P.validate(d);console.log(JSON.stringify(P.summary(d).lines));""",
    os.path.join(ROOT, "web", "pack.js"), out], capture_output=True, text=True)
check(node.returncode == 0, "the board accepts the pack " + (node.stdout.strip() or node.stderr.strip()[:200]))
r2 = subprocess.run([sys.executable, TOOL, "topack", x, out, "--verified-only"], capture_output=True, text=True)
check("fib" not in [rd["type"] for rd in json.load(open(out))["rounds"]], "--verified-only leaves unverified rows out")
sys.exit(1 if fails else 0)
