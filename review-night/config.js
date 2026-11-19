// Review Night settings. Edit these, then reload the pages.
window.RN_CONFIG = {
  // How phones reach the board:
  //   "firebase": relays through your Firebase database. Works on any network.
  //   "peer":     PeerJS direct connections. Free, but often fails on cellular.
  //   "local":    test mode, every tab in one browser on one computer.
  // Any page can override this with ?net=local or ?net=peer in its address.
  net: "firebase",

  // Settings for the cpseminaryss Firebase project (already filled in).
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

  // The content pack the board loads at startup (one file per course). To use a different
  // course, upload its file to the data folder and change this line, or open the board with
  // ?data=data/your-file.json. You can also load a file on the setup screen.
  dataUrl: "data/old-testament.json",

  // Optional extras added to the pack, for things that belong to one class or teacher (teacher
  // trivia, for example). Leave it empty ("") for none. Open the board with ?extras=none to skip it once.
  extrasUrl: "",

  // Options passed to PeerJS in "peer" mode. Empty uses the free public PeerJS server.
  peerOptions: {}
};
