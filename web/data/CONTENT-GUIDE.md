# Making content for a new course

The game is the same every year. Only the content files change.

## The two kinds of content file

- **Pack:** everything for one course. Loading a pack replaces the content. `old-testament.json` is a pack.
- **Extras:** extra questions, clues, or stories that get added to the pack. Use extras for things that belong to one class or teacher, such as teacher trivia. `class-extras.local.json` (kept on your computer, never committed) is an extras file. An extras file has `"extras": true` at the top.

## Steps for a new course

1. Copy `template.json` and rename it, for example `new-testament-2027.json`.
2. Fill it in, or have Claude write it (prompt below).
3. Try it: open the board, and on the setup screen use **Load a content file**. The screen lists how many questions it found and warns about problems. If the file has an error, it says which item and what is wrong.
4. Play a few questions to check them.
5. To make it the default, upload it to the `data` folder in your repository and change this line in `config.js`:
   `dataUrl: "data/new-testament-2027.json",`
   Or leave the default alone and open the board with `host.html?data=data/new-testament-2027.json`.

The offline version (`review-night-offline.html`) has a copy of the content built in. For a new course, open **More** and load the same file; it is remembered in that browser.

## What goes in a pack

| Round type | List name | Each item |
|---|---|---|
| `trivia` (Quick Quiz) | `questions` | `q` (question), `choices` (correct answer first), `answer` (0), `note` (shown after the reveal) |
| `tf` (True or False) | `statements` | `s` (the statement), `a` (`true` or `false`, no quotes), `note`. Keep a mix of true and false. |
| `order` (Put It in Order) | `puzzles` | `prompt` (what to order), `items` (3 to 8 in the **correct** order; 4 to 6 is best on a phone), `note` |
| `fib` (Fake Out) | `clues` | `prompt` (ends mid-sentence with `____`), `answer`, `alt` (other wordings that count as the real answer), `ref`, `house` (2 or more fake endings used when students write too few) |
| `draw` (Sketch It) | `stories` | `story` (something drawable), `ref` |
| `apply` (Apply It) | `prompts` | `prompt` (a real-life situation), `ref` (the scripture to apply), `note` (optional, shown after the votes) |
| `final` (wager bank) | `finals` | `q`, `choices` (4 to 6 close ones, correct first), `answer` (0), `note`. Not a round people pick; see the final wager below. |

A pack can include any of these. The host picks which rounds to play tonight, and in what order, on the setup screen. Include a round only when it has enough items.

## Choosing rounds and the final wager

- On the setup screen, **Rounds tonight** lists every round in the pack. Tick the ones to play and use the arrows to order them. The choice is remembered in that browser for that pack.
- **Let students vote** (on by default; `settings.vote: false` turns the default off): in the lobby, students pick up to `settings.votePicks` (3) of the ticked games on their phones and the board shows a live tally. At the start, the top `settings.maxRounds` (5) are played, least popular first and the favorite last. Games nobody picked are left out. If nobody votes, your ticked order is used.
- Points multiply by position: first round ×1, second ×2, third and later ×3. Change this with `settings.multipliers`, for example `[1, 1, 2, 2, 3]` (the last number repeats).
- **End with a final wager** (on by default; `settings.finalWager: false` turns the default off): after the last round's standings, everyone bets up to their score, or up to `finalMaxWagerFloor` if they're lower, on one more question. A right answer wins the bet, a wrong answer loses it. Late joiners answer for a flat `finalAudienceCorrect` bonus.
- The wager question is one more item from the last round: a Quick Quiz question, a True or False statement, a Put It in Order puzzle (only a perfect order wins), or a Fake Out clue (real ending among the house fakes). If the last round is Sketch It or Apply It, it uses the `finals` bank, then any unused Quick Quiz or True or False item.

Other fields:
- `count`: how many items a game draws from the bank. Keep banks larger than `count` so games vary. The last round draws one extra item for the wager.
- `mult` on a round is no longer used; see multipliers above.
- `title`, `intro`, `rules`: shown on the rules page before the round.
- `welcome`: the line at the bottom of every rules page.
- `pronounce`: how the voice should say things, for example `"Zarahemla": "zah-rah-HEM-lah"`.
- `settings.timers` (seconds) and `settings.points`.

Put the correct answer **first** in `choices` and set `answer` to 0. The game shuffles the choices each time.

## Extras files

```json
{
  "extras": true,
  "name": "Class extras",
  "pronounce": { "Aimee": "AY-mee" },
  "clues": [ { "prompt": "Our class mascot is ____", "answer": "a llama", "ref": "Class trivia", "house": ["a goat", "an owl"] } ]
}
```
Any of `questions`, `clues`, `stories`, or `finals` can be included. They are added to the first round of that type.

The site loads the extras file named by `extrasUrl` in `config.js`. Leave it empty for none, or open the board with `?extras=none` to skip it once. You can also load an extras file on the setup screen.

## Student information

The repository is public. Don't put student names or personal details in a file that goes in it. For class trivia about students, keep an extras file on your own computer and load it on the setup screen before class. It stays in that browser and is not uploaded.

## Before class

- Check every scripture quote against the scriptures. Claude can make mistakes.
- Look at the warnings on the setup screen.
- Make sure a few answers are not all the same letter (the game shuffles, but check the question reads right).
- Run a few questions of each round with a friend's phone.

## A prompt for Claude

Attach `template.json` and paste something like this, filling in the brackets:

> I run a seminary review game. The attached template.json shows the exact format. Write a new content pack for **[course and year]** using **only** these passages and lesson topics: **[paste your list]**.
>
> Output only valid JSON in the template's structure, with the course in `"course"`.
> - Quick Quiz: about 60 questions. Mix quote-to-reference, real-life scenarios, fill-in-the-word, "what does this passage teach", and history from the lessons. Put the correct answer first and set `answer` to 0. Every wrong choice must be plausible but clearly wrong, and no scenario may have two defensible answers among its choices.
> - Fake Out: about 25 clues. Quote **[translation]** exactly, stopping mid-sentence at a word like "and", "for", or "thine", with `____` for the rest. Include `answer`, `alt`, `ref`, and two `house` fakes that are not real scripture.
> - Sketch It: about 15 stories that can be drawn, each with a `ref`.
> - True or False: about 40 statements, roughly half true. A false statement changes one clear detail (who, where, which book), never a trick of wording.
> - Put It in Order: about 15 puzzles of 4 to 6 items each (events in a story, steps in a teaching, books, or verses in a passage), listed in the correct order.
> - Apply It: about 15 real-life situations a teenager might face, each paired with one Doctrinal Mastery passage in `ref` that clearly applies.
> - Final: about 12 hard questions with 5 or 6 close choices (used for the wager when the last round is Sketch It or Apply It).
> - Add a `pronounce` entry for any name the voice might mispronounce.
> - Check every quote against the scriptures and list anything you couldn't verify.
