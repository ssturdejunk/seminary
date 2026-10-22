// Review Night settings. Edit these, then reload the pages.
window.RN_CONFIG = {
  // How phones reach the board: "peer" (PeerJS, works over the internet)
  // or "local" (test mode: every tab in one browser on one computer).
  // Any page can override this with ?net=local in its address.
  net: "peer",

  // Address of play.html as phones should open it. Leave empty to use the
  // folder the board was opened from (right for GitHub Pages). Set it when the
  // board runs from a file on your laptop, for example
  // "https://yourname.github.io/seminary/review-night/play.html"
  playUrl: "",

  // Clue file the board loads at startup. You can also pick a file on the setup screen.
  dataUrl: "data/review-night.json",

  // Options passed to PeerJS. Empty uses the free public PeerJS server.
  peerOptions: {}
};
