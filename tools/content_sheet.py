#!/usr/bin/env python3
"""Content spreadsheet <-> content pack.

  python3 tools/content_sheet.py make  OUT.xlsx              # a blank content workbook (one tab per game)
  python3 tools/content_sheet.py topack IN.xlsx OUT.json      # turn a filled workbook into a pack
  python3 tools/content_sheet.py topack IN.xlsx OUT.json --verified-only

The workbook is meant to live in Google Sheets (upload the .xlsx; Drive converts it).
To build a pack, download it as .xlsx (File > Download > Microsoft Excel) and run topack.

Rules when reading:
- A row whose first cell starts with "EXAMPLE" is skipped, as is a blank row.
- "Verified" is Yes when the scripture text or fact was checked in Gospel Library.
  topack lists every unverified row; --verified-only leaves them out of the pack.
- Settings (timers, points, rules text) come from web/data/template.json.
"""
import json, os, sys, argparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATE = os.path.join(ROOT, "web", "data", "template.json")

# One entry per game tab: tab name, round type, columns (header, width, help), and how to read a row.
TABS = [
    ("Quick Quiz", "trivia", [
        ("Question", 50, "The question as it appears on the screen."),
        ("Correct answer", 28, "The right choice."),
        ("Wrong 1", 24, "Plausible but clearly wrong."), ("Wrong 2", 24, ""), ("Wrong 3", 24, "Optional."), ("Wrong 4", 24, "Optional."),
        ("Note", 36, "Shown after the reveal (optional)."),
        ("Scripture", 18, "Reference, e.g. Proverbs 3:5–6."),
        ("Verified", 10, "Yes once checked in Gospel Library."),
        ("Comments", 30, "Notes to yourself or Claude. Not used in the game.")]),
    ("True or False", "tf", [
        ("Statement", 60, "A clear statement. False ones change one detail."),
        ("True or False", 12, "True or False."),
        ("Note", 40, "Shown after the reveal; say what is actually true."),
        ("Scripture", 18, ""), ("Verified", 10, ""), ("Comments", 30, "")]),
    ("Put It in Order", "order", [
        ("Prompt", 40, "What to put in order."),
        ("Item 1 (first)", 22, "Items in the CORRECT order. 3 to 8; 4 to 6 is best."),
        ("Item 2", 22, ""), ("Item 3", 22, ""), ("Item 4", 22, ""), ("Item 5", 22, ""), ("Item 6", 22, ""), ("Item 7", 22, ""), ("Item 8", 22, ""),
        ("Note", 36, "Shown after the reveal (optional)."),
        ("Scripture", 18, ""), ("Verified", 10, ""), ("Comments", 30, "")]),
    ("Fake Out", "fib", [
        ("Clue (ends with ____)", 50, "Quote that stops mid-sentence, then ____."),
        ("Real ending", 34, "The exact rest of the phrase."),
        ("Also accept", 30, "Other wordings of the real ending, separated by ;"),
        ("House fake 1", 28, "A believable fake that is NOT scripture."), ("House fake 2", 28, ""), ("House fake 3", 28, "Optional."),
        ("Scripture", 18, ""), ("Verified", 10, ""), ("Comments", 30, "")]),
    ("Sketch It", "draw", [
        ("Story to draw", 50, "Something students can draw without words."),
        ("Scripture", 18, ""), ("Verified", 10, ""), ("Comments", 30, "")]),
    ("Apply It", "apply", [
        ("Situation", 60, "A real-life situation a teenager might face."),
        ("Scripture", 22, "The passage students apply."),
        ("Note", 36, "Shown after the votes (optional)."),
        ("Verified", 10, ""), ("Comments", 30, "")]),
    ("Final Question", "final", [
        ("Question", 50, "Used for the final wager when the last round is Sketch It or Apply It."),
        ("Correct answer", 24, ""), ("Wrong 1", 22, "4 to 6 close choices in all."), ("Wrong 2", 22, ""), ("Wrong 3", 22, ""), ("Wrong 4", 22, "Optional."), ("Wrong 5", 22, "Optional."),
        ("Note", 36, ""), ("Scripture", 18, ""), ("Verified", 10, ""), ("Comments", 30, "")]),
]
EXAMPLES = {
    "trivia": ["EXAMPLE: Which book comes first in the Bible?", "Genesis", "Exodus", "Psalms", "Matthew", "", "Genesis begins the Old Testament.", "", "Yes", ""],
    "tf": ["EXAMPLE: Malachi is the first book of the Old Testament.", "False", "Malachi is the last book of the Old Testament.", "", "Yes", ""],
    "order": ["EXAMPLE: Put these books in Bible order.", "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "", "", "", "The five books of Moses.", "", "Yes", ""],
    "fib": ["EXAMPLE: (a quote that stops mid-sentence) ____", "(the real ending)", "(another wording; another)", "(a believable fake)", "(another fake)", "", "(reference)", "No", "Check the quote in Gospel Library, then set Verified to Yes."],
    "draw": ["EXAMPLE: A family choosing to serve the Lord together", "Joshua 24:15", "Yes", ""],
    "apply": ["EXAMPLE: A friend is anxious about a big decision and doesn't know what to do.", "Proverbs 3:5–6", "", "Yes", ""],
    "final": ["EXAMPLE: (a hard question)", "(right answer)", "(close wrong 1)", "(close wrong 2)", "(close wrong 3)", "", "", "", "", "No", ""],
}
STATUS = ["Idea", "Drafting", "In the sheet", "Dropped"]


def make(out):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment
    from openpyxl.worksheet.datavalidation import DataValidation
    from openpyxl.comments import Comment
    HEAD = PatternFill("solid", fgColor="1F3A4D"); HFONT = Font(name="Arial", bold=True, color="FFFFFF")
    EX = Font(name="Arial", italic=True, color="7A7A7A"); BODY = Font(name="Arial")
    WRAP = Alignment(wrap_text=True, vertical="top")
    ROWS = 300
    wb = Workbook()
    ws = wb.active; ws.title = "Start here"
    lines = [
        ("Review Night content", True),
        ("One tab per game. Each row is one item. Fill in the white cells; grey italic rows starting with EXAMPLE are skipped.", False),
        ("Verified: set to Yes once the scripture text or fact is checked in Gospel Library. Unverified rows are listed when the pack is built and can be left out.", False),
        ("Ideas tab: jot rough ideas, topics and scriptures to cover. Claude can turn them into rows on the game tabs.", False),
        ("Pack tab: the course name and title shown on the board.", False),
        ("Hover over a column header for what goes in it.", False),
        ("When ready: File > Download > Microsoft Excel (.xlsx), or ask Claude to build the pack from this sheet.", False),
        ("Keep student names and personal details out of this sheet if it may become public content.", False),
    ]
    for i, (t, b) in enumerate(lines, 1):
        c = ws.cell(row=i, column=1, value=t); c.font = Font(name="Arial", bold=b, size=14 if b else 11); c.alignment = WRAP
    ws.column_dimensions["A"].width = 110

    ps = wb.create_sheet("Pack")
    for r, (k, v) in enumerate([("Setting", "Value"), ("Title", "Seminary Review Night"), ("Course", ""), ("File name", "")], 1):
        a, b = ps.cell(row=r, column=1, value=k), ps.cell(row=r, column=2, value=v)
        (a.font, b.font) = (HFONT, HFONT) if r == 1 else (Font(name="Arial", bold=True), BODY)
        if r == 1: a.fill = b.fill = HEAD
    ps["C3"] = "For example: New Testament 2027"; ps["C4"] = "For example: new-testament-2027.json"
    ps["C3"].font = ps["C4"].font = EX
    ps.column_dimensions["A"].width = 14; ps.column_dimensions["B"].width = 40; ps.column_dimensions["C"].width = 40

    ideas = wb.create_sheet("Ideas")
    ih = [("Idea", 60), ("Game", 18), ("Scripture or topic", 26), ("Status", 14), ("Comments", 40)]
    for j, (h, w) in enumerate(ih, 1):
        c = ideas.cell(row=1, column=j, value=h); c.font = HFONT; c.fill = HEAD
        ideas.column_dimensions[chr(64 + j)].width = w
    dv = DataValidation(type="list", formula1='"Any,' + ",".join(t[0] for t in TABS) + '"', allow_blank=True); ideas.add_data_validation(dv); dv.add(f"B2:B{ROWS}")
    dv2 = DataValidation(type="list", formula1='"' + ",".join(STATUS) + '"', allow_blank=True); ideas.add_data_validation(dv2); dv2.add(f"D2:D{ROWS}")
    for r in range(2, ROWS + 1):
        for j in range(1, len(ih) + 1):
            c = ideas.cell(row=r, column=j); c.number_format = "@"; c.alignment = WRAP; c.font = BODY
    ideas.freeze_panes = "A2"

    for name, typ, cols in TABS:
        s = wb.create_sheet(name)
        for j, (h, w, tip) in enumerate(cols, 1):
            c = s.cell(row=1, column=j, value=h); c.font = HFONT; c.fill = HEAD; c.alignment = WRAP
            if tip: c.comment = Comment(tip, "Review Night")
            s.column_dimensions[s.cell(row=1, column=j).column_letter].width = w
        for r in range(2, ROWS + 1):
            for j in range(1, len(cols) + 1):
                c = s.cell(row=r, column=j); c.number_format = "@"; c.alignment = WRAP; c.font = BODY
        for j, v in enumerate(EXAMPLES[typ], 1):
            c = s.cell(row=2, column=j, value=v or None); c.font = EX
        heads = [c[0] for c in cols]
        vcol = s.cell(row=1, column=heads.index("Verified") + 1).column_letter
        dv = DataValidation(type="list", formula1='"Yes,No"', allow_blank=True); s.add_data_validation(dv); dv.add(f"{vcol}2:{vcol}{ROWS}")
        if typ == "tf":
            tcol = s.cell(row=1, column=heads.index("True or False") + 1).column_letter
            dv = DataValidation(type="list", formula1='"True,False"', allow_blank=True); s.add_data_validation(dv); dv.add(f"{tcol}2:{tcol}{ROWS}")
        s.freeze_panes = "B2"; s.row_dimensions[1].height = 32

    pr = wb.create_sheet("Pronounce")
    for j, (h, w) in enumerate([("Word", 24), ("Say it as", 30)], 1):
        c = pr.cell(row=1, column=j, value=h); c.font = HFONT; c.fill = HEAD; pr.column_dimensions[chr(64 + j)].width = w
    pr["A2"], pr["B2"] = "EXAMPLE: Zarahemla", "zah-rah-HEM-lah"; pr["A2"].font = pr["B2"].font = EX
    wb.save(out)
    print("wrote", out)


def s(v):
    if v is None: return ""
    if isinstance(v, bool): return "True" if v else "False"
    if isinstance(v, float) and v.is_integer(): v = int(v)
    return str(v).strip()


def topack(src, out, verified_only):
    from openpyxl import load_workbook
    wb = load_workbook(src, data_only=True)
    tpl = json.load(open(TEMPLATE, encoding="utf-8"))
    tpl_rounds = {r["type"]: r for r in tpl["rounds"]}
    meta = {}
    if "Pack" in wb.sheetnames:
        for row in wb["Pack"].iter_rows(min_row=2, values_only=True):
            if row and row[0]: meta[s(row[0])] = s(row[1] if len(row) > 1 else "")
    pack = {"title": meta.get("Title") or "Seminary Review Night", "course": meta.get("Course", ""), "pronounce": {},
            "welcome": tpl.get("welcome", []), "settings": tpl["settings"], "rounds": []}
    unverified, problems, counts = [], [], {}
    for name, typ, cols in TABS:
        if name not in wb.sheetnames: continue
        heads = [c[0] for c in cols]
        items = []
        for rn, row in enumerate(wb[name].iter_rows(min_row=2, values_only=True), 2):
            row = list(row) + [None] * len(heads)
            v = {h: s(row[i]) for i, h in enumerate(heads)}
            first = v[heads[0]]
            if not first or first.upper().startswith("EXAMPLE"): continue
            ok = v.get("Verified", "").lower() in ("yes", "y", "true")
            ref = v.get("Scripture", "")
            where = f"{name} row {rn}"
            if not ok:
                unverified.append(f"{where}: {first[:60]}" + (f" ({ref})" if ref else ""))
                if verified_only: continue
            it = None
            if typ in ("trivia", "final"):
                wrong = [v[h] for h in heads if h.startswith("Wrong") and v[h]]
                if not v["Correct answer"] or not wrong: problems.append(f"{where}: needs a correct answer and at least one wrong one"); continue
                it = {"q": first, "choices": [v["Correct answer"]] + wrong, "answer": 0}
                note = " ".join(x for x in [v.get("Note", ""), ref] if x)
                if note: it["note"] = note
            elif typ == "tf":
                a = v["True or False"].lower()
                if a not in ("true", "false"): problems.append(f"{where}: True or False must be True or False"); continue
                it = {"s": first, "a": a == "true"}
                note = " ".join(x for x in [v.get("Note", ""), ref] if x)
                if note: it["note"] = note
            elif typ == "order":
                its = [v[h] for h in heads if h.startswith("Item") and v[h]]
                if len(its) < 3: problems.append(f"{where}: needs at least 3 items"); continue
                it = {"prompt": first, "items": its}
                note = " ".join(x for x in [v.get("Note", ""), ref] if x)
                if note: it["note"] = note
            elif typ == "fib":
                if "____" not in first and "__" not in first: problems.append(f"{where}: the clue needs a ____ blank"); continue
                if not v["Real ending"]: problems.append(f"{where}: needs the real ending"); continue
                it = {"prompt": first, "answer": v["Real ending"], "alt": [x.strip() for x in v["Also accept"].split(";") if x.strip()],
                      "ref": ref, "house": [v[h] for h in heads if h.startswith("House") and v[h]]}
            elif typ == "draw":
                it = {"story": first, "ref": ref}
            elif typ == "apply":
                it = {"prompt": first, "ref": ref}
                if v.get("Note"): it["note"] = v["Note"]
            items.append(it)
        counts[name] = len(items)
        if not items: continue
        base = tpl_rounds.get(typ, {})
        rnd = {k: base[k] for k in ("type", "title", "count", "intro", "rules") if k in base}
        rnd["type"] = typ
        rnd[{"trivia": "questions", "tf": "statements", "order": "puzzles", "fib": "clues", "draw": "stories", "apply": "prompts", "final": "finals"}[typ]] = items
        pack["rounds"].append(rnd)
    if "Pronounce" in wb.sheetnames:
        for row in wb["Pronounce"].iter_rows(min_row=2, values_only=True):
            if row and row[0] and not s(row[0]).upper().startswith("EXAMPLE") and len(row) > 1 and row[1]:
                pack["pronounce"][s(row[0])] = s(row[1])
    with open(out, "w", encoding="utf-8") as f: json.dump(pack, f, ensure_ascii=False, indent=1)
    print("wrote", out)
    for k, n in counts.items(): print(f"  {k}: {n}")
    if problems: print(f"\n{len(problems)} rows skipped:"); [print("  " + p) for p in problems]
    if unverified:
        print(f"\n{len(unverified)} unverified rows" + (" (left out)" if verified_only else " (included; use --verified-only to leave them out)") + ":")
        for u in unverified: print("  " + u)
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("make"); m.add_argument("out")
    t = sub.add_parser("topack"); t.add_argument("src"); t.add_argument("out"); t.add_argument("--verified-only", action="store_true")
    a = ap.parse_args()
    sys.exit(make(a.out) if a.cmd == "make" else topack(a.src, a.out, a.verified_only))
