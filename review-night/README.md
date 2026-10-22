# Review Night

A phone-based review game for seminary: Quick Quiz (trivia), Fake Out (write
fake answers, find the real one), Sketch It (draw a story, guess the story),
and a wagered final question. Students join on their phones with a room code.

## Files

- `host.html` / `host.js`: the board you project from your laptop
- `play.html` / `play.js`: the page students open on their phones
- `audio.js`: music and sound effects, all generated in the browser (no audio files)
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

## Test on one computer

Add `?net=local` to the board's address. The lobby QR code and link then point
to `play.html?net=local&room=...`. Open that link in several tabs of the same
browser; each tab acts as one phone.

## Edit clues

Everything lives in `data/review-night.json`. Notes:

- `answer` in trivia and final questions counts from 0, so 0 is the first choice. Trivia choices are shown in the order you write them.
- Fake Out clues use `answer`, plus `alt` for other wordings that also count as the
  real answer, so students can't submit them as fakes. Fakes that share most of their key words with the real answer are also rejected. `house` fakes fill in when a
  set writes fewer than two.
- The game uses clues and stories in order, one per set, so put your favorites first.
  With 20 students in sets of 4, that's 5 per round; extras are spares.
- In Sketch It, every story in the list appears as a guessing option, used or not.

## Sound

Sound plays on the board only, never on phones.

- Lobby and standings: a calm background tune
- Timed phases: an upbeat tune that adds drums, an arpeggio, and a doubled melody as the clock runs down, speeds up, and shifts up a step for the last stretch. The final question uses a minor-key version
- Screen changes: a whoosh
- Reveals: a chime. The end: a fanfare. Join: a soft two-note beep. Last 5 seconds: a tick
- The Sound button on the board (or the M key) turns it all on and off
- Browsers keep audio off until the page is clicked once. If the button says "Tap for sound", click anywhere on the board

## How rounds work

- Sets of 3 or 4 are rebuilt at the start of Fake Out, Sketch It, and the final.
- Students who join during Quick Quiz play right away. Students who join later sit in
  the audience, earn points for correct answers, and become players at the next round
  with their points.
- If the board's page reloads, choose "Resume the game" on the setup screen.
  Phones reconnect on their own.
