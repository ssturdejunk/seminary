# Review Night

A phone-based review game for seminary: Quick Quiz (trivia), Fake Out (write
fake answers, find the real one), Sketch It (draw a story, guess the story),
and a wagered final question. Students join on their phones with a room code.

## Files

- `host.html` / `host.js`: the board you project from your laptop
- `play.html` / `play.js`: the page students open on their phones
- `net.js`: the connection between them (PeerJS, or local test mode)
- `config.js`: settings (connection mode, phone address, clue file)
- `data/review-night.json`: all clues, timers, and point values
- `lib/`: PeerJS 1.5.5 and qrcode-generator 2.0.4, both MIT licensed, copied in so the game doesn't depend on a CDN

## Put it on GitHub Pages

1. Upload this `review-night` folder to your repository, keeping the folder structure.
2. With Pages turned on, the board is at `https://<you>.github.io/<repo>/review-night/host.html`.
3. Phones scan the QR code on the board, or open `.../review-night/play.html` and type the room code.

You can also open `host.html` from a file on your laptop. Clue files can't load
automatically that way, so use "Load a different clue file" on the setup screen,
and set `playUrl` in `config.js` to the online address of `play.html`.

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

- `answer` in trivia and final questions counts from 0, so 0 is the first choice.
- Fake Out clues use `answer`, plus `alt` for other wordings that also count as the
  real answer, so students can't submit them as fakes. `house` fakes fill in when a
  set writes fewer than two.
- The game uses clues and stories in order, one per set, so put your favorites first.
  With 20 students in sets of 4, that's 5 per round; extras are spares.
- In Sketch It, every story in the list appears as a guessing option, used or not.

## How rounds work

- Sets of 3 or 4 are rebuilt at the start of Fake Out, Sketch It, and the final.
- Students who join during Quick Quiz play right away. Students who join later sit in
  the audience, earn points for correct answers, and become players at the next round
  with their points.
- If the board's page reloads, choose "Resume the game" on the setup screen.
  Phones reconnect on their own.
