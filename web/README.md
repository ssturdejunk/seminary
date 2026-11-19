# Seminary Review Night

A phone-based review game for seminary: Quick Quiz (trivia), Fake Out (write
fake answers, find the real one), Sketch It (draw a story, guess the story),
and a wagered final question. Students join on their phones with a room code.

## Files

- `host.html` / `host.js`: the board you project from your laptop
- `play.html` / `play.js`: the page students open on their phones
- `pack.js`: reads, checks, and combines content files
- `audio.js`: music and sound effects, all generated in the browser (no audio files)
- `voice.js`: reads questions aloud using the browser's built-in speech (no audio files)
- `net.js`: the connection between the board and phones (Firebase, PeerJS, or local test mode)
- `config.js`: settings (connection, which content files to load)
- `data/old-testament.json`: the Old Testament content pack
- `data/class-extras.local.json` (not in the repo): extras that belong to one class, such as teacher trivia. Load it on the setup screen.
- `data/template.json`: a documented starting point for a new course
- `data/CONTENT-GUIDE.md`: how to make content for a new course, with a prompt for Claude
- `lib/`: Firebase JS SDK 12.19.0 (Apache 2.0), PeerJS 1.5.5 and qrcode-generator 2.0.4 (both MIT), copied in so the game doesn't depend on a CDN

## Put it on GitHub Pages

1. Upload this `review-night` folder to your repository, keeping the folder structure.
2. With Pages turned on, the board is at `https://<you>.github.io/<repo>/review-night/host.html`.
3. Phones scan the QR code on the board, or open `.../review-night/play.html` and type the room code.

You can also open `host.html` from a file on your laptop. Clue files can't load
automatically that way, so use "Load a different clue file" on the setup screen,
and set `playUrl` in `config.js` to the online address of `play.html`.

## Firebase setup (one time)

The `config.js` in this package already contains the settings for the `cpseminaryss` project, so uploading the whole folder is safe. The steps below are only needed to set up a different Firebase project.

Firebase relays messages between phones and the board, so the game works on
cellular and any Wi-Fi. Firebase's screens may have changed since these steps were written.

1. Go to https://console.firebase.google.com and create a project. Google Analytics isn't needed.
2. Open Build, then Realtime Database, then Create Database. Pick a United States location and start in locked mode.
3. On the database's Rules tab, replace the rules with the block below and click Publish.
4. Open Project settings (gear icon), scroll to Your apps, and click the web icon (`</>`). Give it any nickname and register it. Firebase shows a `firebaseConfig` block.
5. Copy `apiKey`, `authDomain`, `databaseURL`, `projectId`, and `appId` into the `firebase` section of `config.js`. If `databaseURL` is missing, copy the address shown at the top of the Realtime Database Data tab (it ends in `firebaseio.com` or `firebasedatabase.app`).

Rules:

```json
{
  "rules": {
    ".read": false,
    ".write": false,
    "rooms": {
      "$room": { ".read": true, ".write": true }
    }
  }
}
```

The API key in `config.js` is not a secret; Firebase expects it in web pages.
These rules let anyone who has your database address read and write game rooms,
which is fine for a review game, but don't store anything private in the clue file.

To use PeerJS instead, set `net: "peer"` in `config.js`. It needs no setup, but
phones on cellular often can't connect.

## Before class

1. Open the board. On the setup screen, scan the moderator QR code with your phone.
   Your phone can advance the game, hide fake answers or drawings, and remove players.
2. Open the lobby and project the board.
3. Test at the church building with two or three phones, on cell data and on church Wi-Fi.

## If the laptop loses internet

The easiest fix is to turn on your phone's hotspot and connect the laptop to it. Nothing else changes.

You can also run the board from your phone. Open the same `host.html` address in the phone's browser. On a phone or other small screen the board switches to a phone layout: one column, large touch buttons in a bar at the bottom, and the timer along the top. The screen also stays awake while the board is open.

- To show it to the class, mirror or cast the phone to the projector. Rotate the phone to landscape first; the landscape layout fits a mirrored screen better
- The phone layout turns on automatically for narrow or short screens. Add `?compact=1` to the board's address to force it, or `?compact=0` to force the projector layout
- A game in progress on the laptop can be resumed on the phone only from the same browser, so start a fresh game if you switch devices

## Test on one computer

Add `?net=local` to the board's address. The lobby QR code and link then point
to `play.html?net=local&room=...`. Open that link in several tabs of the same
browser; each tab acts as one phone.

## Content (using this for a new course)

The game itself is the same every year. The questions live in files in the `data` folder: one **pack** per course, and optional **extras** for things that belong to one class. See `data/CONTENT-GUIDE.md` for the full steps, the field reference, and a prompt you can give Claude to write a new pack.

Short version for a new course:
1. Copy `data/template.json` and fill it in (or ask Claude, using the prompt in the guide).
2. On the board's setup screen, use Load a content file to try it. The screen shows how many questions it found and warns about problems.
3. To make it the default, upload it to the `data` folder and change `dataUrl` in `config.js` to its path. Or open the board with `host.html?data=data/your-file.json`.

Other things that live in the content files:
- **Banks:** each round holds a bank of items and a `count`. A game draws `count` items, preferring ones this laptop has shown least, so back-to-back games share no questions until a bank runs out. Host tools has Reset question history
- **Points and timers:** `mult` on a round multiplies its points. Base values are in `settings.points`, and seconds in `settings.timers`
- **Rules page:** each round's `rules` and `intro`, plus `welcome`, appear before every round
- **Voice:** `pronounce` teaches the reader how to say names and terms, like `"Zarahemla": "zah-rah-HEM-lah"`

## Sound

Sound plays on the board only, never on phones.

- Lobby: a pipe-organ prelude, an original hymn-style piece in G major (about a minute, looping) with a church-hall echo, playing while students scan the QR code
- Standings and the end: a calm background tune
- Timed phases: an upbeat tune that adds drums, an arpeggio, and a doubled melody as the clock runs down, speeds up, and shifts up a step for the last stretch. The final question uses a minor-key version
- Screen changes: a whoosh
- Reveals: a chime. The end: a fanfare. Join: a soft two-note beep. Last 5 seconds: a tick
- The Sound button on the board (or the M key) turns it all on and off
- Browsers keep audio off until the page is clicked once. If the button says "Tap for sound", click anywhere on the board

## Voice

The board reads questions aloud with the laptop's built-in voice.

- It reads each question and its choices, the answer at each reveal, the intro to each round, the top three on the standings, and the winner
- While a question is being read, the timer waits and phones show "Listen to the question." Answers open when the reading ends. If the voice stalls, the game continues on its own after a short wait
- The music gets quieter while the voice speaks
- The Voice button on the board (or the V key) turns it on and off. You can pick a voice, change the speed, and test it on the setup screen or in Host tools
- Voices differ by device. Chrome and Edge usually have the best ones. Check the voice and the speed before class, and use a different voice if one sounds poor
- Scripture references are spoken as "Moses 7, verse 18". If a name or word is read wrong, tell me and I'll add a spelling fix

## How rounds work

- Sets of 3 or 4 are rebuilt at the start of Fake Out, Sketch It, and the final.
- Students who join during Quick Quiz play right away. Students who join later sit in
  the audience, earn points for correct answers, and become players at the next round
  with their points.
- If the board's page reloads, choose "Resume the game" on the setup screen.
  Phones reconnect on their own.
