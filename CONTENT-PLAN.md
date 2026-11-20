# Content plan (Old Testament 2026)

Working notes so a new session can pick up the content work.

## Decisions so far
- Course: Old Testament 2026 seminary. Reuse `web/data/old-testament.json` as the base; add new items on top.
- Content is written in the teacher's Google Sheet **Review Night Content** (one tab per game, Verified column).
  Claude writes drafts there with Verified = No; the teacher checks them in Gospel Library.
  Build the pack with `tools/content_sheet.py topack`.
- Some new content should come from the "life lessons" 161–186 of the 2026 manual.
- The Doctrinal Mastery list (24 passages, reference + key phrase) is in `old-testament.json` under `mastery`,
  exactly as the teacher provided it. `quoted` holds only the text inside quotation marks.
  Three entries are summaries with no quote (Exodus 20:3–17, Isaiah 58:6–7, Malachi 3:8–10).

## Sources available
- The church website is blocked from the cloud container. Do not write scripture text or manual content from memory.
- The teacher's Drive has their own lesson decks for 162 (Seeking Personal Revelation), 163 (Acting in Faith to
  Find Answers), 168 (Annotating Scriptures), 172 (Setting Goals) and 185 (Coping with Sadness and Depression).
  Deck 172 contains the teacher's personal lists (names, goals): never use those slides.
  Other lessons 161–186: ask the teacher for titles or decks.

## Doctrinal Mastery drills (approved, built: melded into existing games)
Generated from the `mastery` list, no per-game content needed. From the manual's memorization ideas:
- Unscramble: the quoted phrase in 4–6 word chunks; tap in order (Put It in Order engine).
- First Letters: first letter of each word; pick the reference (Quick Quiz engine). Fewer letters later.
- Fill in the Blank: phrase with key words missing; pick the missing words (Quick Quiz engine).
- Matching: 4 references, 4 phrases; order the phrases to match (Put It in Order engine).
- Related Pictures: Sketch It variant; draw a key phrase, guess the reference.
Word games use `quoted` only; summary entries are used in Matching and Pictures only.

## Duplicate review of old-testament.json (Nov 2026)
Quick Quiz has 65 questions: 22 "Which scripture says …" (quote to reference), 16 fill-in-the-blank, 27 other
(scenarios, meaning, history, lesson questions).

1. Same fact asked twice inside Quick Quiz:
   22 & 41 (Abraham 2:9–11, all nations), 15 & 35 (Amos 3:7, prophets), 14 & 40 (Daniel 2, never destroyed),
   and quote-to-reference vs fill-in-the-blank on the same phrase: 3 & 48, 8 & 47, 9 & 50, 12 & 49, 18 & 46.
2. Giveaways across rounds (an earlier round shows the answer to a later one in the same game):
   Quick Quiz quote questions vs Fake Out clues on the same phrase (e.g. Quick Quiz 6 shows "…and sin against God",
   which is Fake Out 8's answer). Pairs: Q6/F8, Q8/F13, Q10/F17, Q14/F15, Q20/F3, Q45/F20, Q47/F13, Q49/F19,
   Q54/F2, Q43/F5, Q53/F6, Q21/F10, Q15/F11, Q16/F16, Q57/F14, Q2/F4, Q9/F18; Fake Out vs final wager bank:
   F11/Final 2, F14/Final 12, F17/Final 4, F20/Final 10, F18/Final 5, F6/Final 1; Final 3 & 10 share a verse.
3. Sketch It stories that repeat a quiz phrase (scarlet/snow, image of God, two sticks, windows of heaven,
   Elijah in Kirtland, Martin Harris): fine for review, not a giveaway.

Fixes (approved and done, Nov 2026): the 22 quote-to-reference and 16 fill-in-the-blank questions (and the similar Abraham 3 question) were removed from Quick Quiz, since the drills now cover them; a Put It in Order round was added (filled by drills); the give-away guard is in buildDeck. Original proposals:
- Once the Doctrinal Mastery games exist, move the 22 quote-to-reference and 16 fill-in-the-blank questions out of
  Quick Quiz (the new games cover them), keeping Quick Quiz for scenarios, meaning, history and lessons.
- Remove the in-round repeats in item 1.
- Code: when building tonight's deck, skip an item whose scripture reference is already used by another round
  in the same game, so cross-round giveaways can't happen.

## Sheet status (Nov 2026)
- "Review Night Content" (Google Sheets) now holds: the Doctrinal Mastery list (Verified = Yes, teacher-provided),
  all existing Old Testament pack items (Verified blank = not yet checked; Moses/Abraham/D&C items marked No),
  and drafts from the teacher's decks for lessons 162, 163, 168, 172, 185 plus Apply It situations for life lessons
  (all Verified = No, with a source note in Comments). The Ideas tab has one row per lesson 161–186.
- Lesson titles for 161–186 come from the teacher's "Old Testament Seminary Manual — Lesson Index" doc (titles and
  one-line purposes only, no lesson content).
- Leader-quote items have no scripture reference, so the give-away guard can't see them: keep each quote in one
  game only (Fake Out leader-quote drafts were held back for that reason).
- To build the pack: export the sheet as .xlsx, run `tools/content_sheet.py topack`, check, then replace
  `web/data/old-testament.json` (use --verified-only once the teacher has marked rows Yes).

## Nov 20 update
- Every game has content; the live pack is built from the sheet plus later additions (all mirrored in the sheet).
- Lessons 97–148: every lesson block now has at least one item (gaps filled from the teacher's Isaiah 40–43/49,
  Isaiah 53–54 and Assess Your Learning 8 decks, and the lesson index). Assess Your Learning 9 topics covered.
- Final Challenge (settings.finalChallenge, default on) replaces the easy wager question; the old finals bank
  is now only a fallback for packs without Doctrinal Mastery passages.
- Unverified drafts are live (Verified = No in the sheet, each with a source note). Items "from memory":
  Ten Commandments order, Elijah's still small voice, Esther, Gideon, Psalm 23 shepherd, Jeremiah 16:16
  fishers and hunters, Ezekiel 47 temple water, Daniel 6, Red Sea, Joseph's coat, Samuel at night, David and Goliath.
- The teacher's Hosea puzzle has a note-like last item ("This represents…"); suggest moving it to the Note column.
