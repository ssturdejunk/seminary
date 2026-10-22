// Review Night settings. Edit these, then reload the pages.
window.RN_CONFIG = {
  // How phones reach the board:
  //   "firebase": relays through your Firebase database. Works on any network.
  //   "peer":     PeerJS direct connections. Free, but often fails on cellular.
  //   "local":    test mode, every tab in one browser on one computer.
  // Any page can override this with ?net=local or ?net=peer in its address.
  net: "firebase",

  // Paste the settings from your Firebase project here (see README).
  firebase: {
    apiKey: "AIzaSyAh4GLNVZ-5n5B7fIYNxCVG6H5H5RElvME",
    authDomain: "cpseminaryss.firebaseapp.com",
    databaseURL: "https://cpseminaryss-default-rtdb.firebaseio.com",
    projectId: "cpseminaryss",
    appId: "1:191817141776:web:129028f95f48f1b9830495"
  },

  // Address of play.html as phones should open it. Leave empty to use the
  // folder the board was opened from (right for GitHub Pages).
  playUrl: "",

  // Clue file the board loads at startup. You can also pick a file on the setup screen.
  dataUrl: "data/review-night.json",

  // Options passed to PeerJS in "peer" mode. Empty uses the free public PeerJS server.
  peerOptions: {}
};
