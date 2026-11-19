# Seminary Review Night (repo)

See CLAUDE.md for the full map. Quick start:

- Deploy: copy the contents of `web/` into the `review-night/` folder of your GitHub Pages repo (see `web/README.md` for Firebase setup and class-day steps).
- Backup: `python3 offline/build.py`, then open `dist/review-night-offline.html`.
- Test: `node tests/validate_content.js && python3 tests/smoke.py`.
