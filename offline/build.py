#!/usr/bin/env python3
"""Build the offline edition: one self-contained HTML file with no external URLs.

Usage (from anywhere):  python3 offline/build.py [--out PATH]
Inlines web/pack.js, web/audio.js, web/voice.js, offline/app.js, offline/style.css,
and the pack + extras named in web/config.js (dataUrl / extrasUrl).
"""
import json, os, re, sys, argparse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
WEB = os.path.join(ROOT, "web")

def rd(p):
    with open(p, encoding="utf-8") as f:
        return f.read()

def cfg_value(name):
    m = re.search(name + r'\s*:\s*"([^"]*)"', rd(os.path.join(WEB, "config.js")))
    return m.group(1) if m else ""

def compact(path):
    return json.dumps(json.load(open(path, encoding="utf-8")), ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "dist", "review-night-offline.html"))
    ap.add_argument("--pack", default=None)
    ap.add_argument("--extras", default=None)
    a = ap.parse_args()
    pack = a.pack or os.path.join(WEB, cfg_value("dataUrl"))
    ex = a.extras if a.extras is not None else (cfg_value("extrasUrl") and os.path.join(WEB, cfg_value("extrasUrl")))
    local = os.path.join(WEB, "data", "class-extras.local.json")
    if a.extras is None and not ex and os.path.exists(local):
        ex = local  # teacher-only extras on this computer; dist/ is gitignored

    t = rd(os.path.join(HERE, "template.html"))
    parts = {
        "/*STYLE*/": rd(os.path.join(HERE, "style.css")).rstrip("\n"),
        "/*PACK*/": rd(os.path.join(WEB, "pack.js")),
        "/*AUDIO*/": rd(os.path.join(WEB, "audio.js")),
        "/*VOICE*/": rd(os.path.join(WEB, "voice.js")),
        "/*APP*/": rd(os.path.join(HERE, "app.js")),
        "/*CLUES*/": compact(pack),
        "/*EXTRAS*/": compact(ex) if ex else "null",
    }
    for k, v in parts.items():
        assert k in t, "template missing " + k
        t = t.replace(k, v)
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        f.write(t)
    bad = re.findall(r'(?:src|href)="https?://', t)
    print("wrote", a.out, len(t), "bytes;", "external refs:", len(bad))
    return 1 if bad else 0

if __name__ == "__main__":
    sys.exit(main())
