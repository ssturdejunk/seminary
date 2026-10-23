# Review Night

A phone-based review game for seminary: Quick Quiz (trivia), Fake Out (write
fake answers, find the real one), Sketch It (draw a story, guess the story),
and a wagered final question. Students join on their phones with a room code.

## Files

- `host.html` / `host.js`: the board you project from your laptop
- `play.html` / `play.js`: the page students open on their phones
- `audio.js`: music and sound effects, all generated in the browser (no audio files)
- `voice.js`: reads questions aloud using the browser's built-in speech (no audio files)
- `net.js`: the connection between them (Firebase, PeerJS, or local test mode)
- `config.js`: settings (connection mode, phone address, clue file)
- `data/review-night.json`: all clues, timers, and point values
- `lib/`: Firebase JS SDK 12.19.0 (Apache 2.0), PeerJS 1.5.5 and qrcode-generator 2.0.4 (both MIT), copied in so the game doesn't depend on a CDN

## Put it on GitHub Pages

1. Upload this `review-night` folder to your repository, keeping the folder structure.
2. With Pages turned on, the board is at `https://<you>.github.io/<repo>/review-night/host.html`.
3. Phones scan the QR code on the board, or open `.../review-night/play.html` and type the room code.

You can also open `host.html` from a file on your laptop. Clue files can't load
automatically that way, so use "Load a different clue file" on the setup screen,
and set `playUrl` in `config.js` to the online address of `play.html`.

## Firebase setup (one time)

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

## Edit clues

Everything lives in `data/review-night.json`.

- **Banks:** each round holds a bank of questions and a `count`. At the start of a game the board draws `count` items from the bank, so every game is different. It prefers items this laptop has shown least, so back-to-back games share no questions until the bank runs out. Host tools has a Reset question history button
- **Trivia:** `questions` is the bank, `count` is how many are asked. `answer` counts from 0, so 0 is the first choice. Choices are reshuffled every game. Add `"fixed": true` to a question to keep its choices in the order you wrote them
- **Fake Out:** `clues` is the bank. Use `answer` for the real ending and `alt` for other wordings that also count, so students can't submit them as fakes. `house` fakes fill in when a set writes fewer than two. The first clue in each draw goes to the first set
- **Sketch It:** `stories` is the bank. Stories drawn this game are all shown as guessing options, so keep `count` a bit above the number of sets (7 works for up to 20 students)
- **Final:** `finals` is the bank, and one question is drawn. Five or six close choices make it harder
- **Points:** `mult` on each round multiplies its points (Quick Quiz ×1, Fake Out ×2, Sketch It ×3). Base values are in `settings.points`
- **Timers:** `settings.timers`, in seconds
- **Rules page:** each round's `rules` list and `intro` appear on the page shown at the start of the game and between rounds. `welcome` is the line at the bottom. The points shown on that page come from `settings.points` and `mult`, so they stay correct when you change them
- If you change `count` for a round, also update that round's `intro` text if it names a number

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
