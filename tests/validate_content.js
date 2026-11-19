// Validates every content file in web/data with the same rules the board uses.
// Run: node tests/validate_content.js
const fs = require("fs"), path = require("path"), vm = require("vm");
const root = path.join(__dirname, "..", "web");
const ctx = { window: {} }; ctx.window.window = ctx.window;
vm.runInNewContext(fs.readFileSync(path.join(root, "pack.js"), "utf8"), ctx);
const P = ctx.window.RN_PACK;
const dir = path.join(root, "data");
let fails = 0, base = null; const extras = [];
for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".json"))) {
  const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  if (f === "template.json") {
    try { P.validate(d); console.log("format ", f, "ok (examples, not merged)"); } catch (e) { fails++; console.error("FAIL   ", f, "-", e.message); }
    continue;
  }
  try {
    if (P.isExtras(d)) { P.validateExtras(d); extras.push(d); console.log("extras ", f, "ok"); }
    else { P.validate(d); if (!base) base = d; console.log("pack   ", f, "ok"); }
  } catch (e) { fails++; console.error("FAIL   ", f, "-", e.message); }
}
if (base) { const m = P.merge(base, extras); console.log("merged:", JSON.stringify(P.summary(m))); }
process.exit(fails ? 1 : 0);
