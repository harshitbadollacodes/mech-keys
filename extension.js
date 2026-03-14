// @ts-check
const vscode = require("vscode");
const path = require("path");

/** @type {vscode.WebviewView | undefined} */
let audioView;

/** @type {vscode.StatusBarItem} */
let statusBarItem;

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  console.log("MechKeys is now active!");

  let config = vscode.workspace.getConfiguration("mechkeys");
  let enabled = config.get("enabled");
  let profile = config.get("profile");
  let volume = config.get("volume");

  // --- Register Sidebar Webview Provider (plain object instead of class) ---
  // VS Code only needs an object with a resolveWebviewView method.
  // Since context is already available here, we don't need a class to store it.
  const provider = {
    resolveWebviewView(webviewView) {
      audioView = webviewView;

      webviewView.webview.options = {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(context.extensionPath, "sounds")),
        ],
      };

      webviewView.webview.html = getWebviewContent(
        context,
        webviewView.webview,
        profile,
        volume,
      );

      webviewView.onDidDispose(() => {
        audioView = undefined;
      });

      webviewView.webview.onDidReceiveMessage((msg) => {
        console.log("MechKeys webview:", msg);
      });
    },
  };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "mechKeys.audioPlayer",
      provider,
      {
        webviewOptions: { retainContextWhenHidden: true },
      },
    ),
  );

  // --- Status Bar ---
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  statusBarItem.command = "mech-keys.cycleProfile";
  updateStatusBar(enabled, profile);
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // --- Safe postMessage helper ---
  function postMessage(msg) {
    if (audioView) {
      try {
        audioView.webview.postMessage(msg);
      } catch (e) {
        console.error("MechKeys: postMessage failed", e);
      }
    }
  }

  // --- Listen for text changes (A-Z, 0-9, enter, backspace, space, tab) ---
  const textChangeListener = vscode.workspace.onDidChangeTextDocument(
    (event) => {
      try {
        if (!enabled) return;
        if (event.contentChanges.length === 0) return;

        const change = event.contentChanges[0];
        const text = change.text;

        let soundType = "key";

        if (text === "\n" || text === "\r\n") {
          soundType = "enter";
        } else if (text === "\t") {
          soundType = "tab";
        } else if (text === " ") {
          soundType = "space";
        } else if (text === "" && change.rangeLength > 0) {
          soundType = "backspace";
        }

        postMessage({ command: "play", type: soundType });
      } catch (e) {
        console.error("MechKeys: error handling text change", e);
      }
    },
  );
  context.subscriptions.push(textChangeListener);

  // --- Listen for cursor moves (arrow keys) ---
  const selectionListener = vscode.window.onDidChangeTextEditorSelection(
    (event) => {
      try {
        if (!enabled) return;
        if (event.kind === vscode.TextEditorSelectionChangeKind.Mouse) return;
        if (event.kind === vscode.TextEditorSelectionChangeKind.Command) return;
        if (
          event.textEditor.document === vscode.window.activeTextEditor?.document
        ) {
          postMessage({ command: "play", type: "arrow" });
        }
      } catch (e) {
        console.error("MechKeys: error handling selection change", e);
      }
    },
  );
  context.subscriptions.push(selectionListener);

  context.subscriptions.push(
    vscode.commands.registerCommand("mech-keys.toggle", () => {
      enabled = !enabled;
      vscode.workspace
        .getConfiguration("mechkeys")
        .update("enabled", enabled, true);
      updateStatusBar(enabled, profile);
      vscode.window.showInformationMessage(
        `MechKeys: ${enabled ? "🎹 Sound ON" : "🔇 Sound OFF"}`,
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("mech-keys.cycleProfile", () => {
      if (!enabled) {
        // OFF → Blue
        enabled = true;
        profile = "blue";
        vscode.workspace
          .getConfiguration("mechkeys")
          .update("enabled", enabled, true);
        vscode.workspace
          .getConfiguration("mechkeys")
          .update("profile", profile, true);
        postMessage({ command: "setProfile", profile });
        updateStatusBar(enabled, profile);
        vscode.window.showInformationMessage("MechKeys: 🔵 Blue");
      } else if (profile === "blue") {
        // Blue → Typewriter
        profile = "typewriter";
        vscode.workspace
          .getConfiguration("mechkeys")
          .update("profile", profile, true);
        postMessage({ command: "setProfile", profile });
        updateStatusBar(enabled, profile);
        vscode.window.showInformationMessage("MechKeys: ⌨️ Typewriter");
      } else {
        enabled = false;
        vscode.workspace
          .getConfiguration("mechkeys")
          .update("enabled", enabled, true);
        updateStatusBar(enabled, profile);
        vscode.window.showInformationMessage("MechKeys: 🔇 Sound OFF");
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("mech-keys.switchProfile", async () => {
      const selected = await vscode.window.showQuickPick(
        [
          { label: "🔵 Blue", description: "Loud & clicky", value: "blue" },
          {
            label: "⌨️  Typewriter",
            description: "Retro thunk",
            value: "typewriter",
          },
        ],
        { placeHolder: "Select a keyboard sound profile" },
      );

      if (selected) {
        profile = selected.value;
        vscode.workspace
          .getConfiguration("mechkeys")
          .update("profile", profile, true);
        postMessage({ command: "setProfile", profile });
        updateStatusBar(enabled, profile);
        vscode.window.showInformationMessage(
          `MechKeys: Switched to ${selected.label} profile`,
        );
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("mech-keys.setVolume", async () => {
      const input = await vscode.window.showInputBox({
        prompt: "Enter volume level (0-100)",
        value: String(volume),
        validateInput: (val) => {
          const num = Number(val);
          if (isNaN(num) || num < 0 || num > 100)
            return "Please enter a number between 0 and 100";
          return null;
        },
      });

      if (input !== undefined) {
        volume = Number(input);
        vscode.workspace
          .getConfiguration("mechkeys")
          .update("volume", volume, true);
        postMessage({ command: "setVolume", volume });
        vscode.window.showInformationMessage(
          `MechKeys: Volume set to ${volume}`,
        );
      }
    }),
  );

  vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("mechkeys")) {
      const newConfig = vscode.workspace.getConfiguration("mechkeys");
      enabled = newConfig.get("enabled");
      profile = newConfig.get("profile");
      volume = newConfig.get("volume");
      updateStatusBar(enabled, profile);
      postMessage({ command: "setProfile", profile });
      postMessage({ command: "setVolume", volume });
    }
  });
}

/**
 * Updates the status bar text and tooltip
 * @param {boolean} enabled
 * @param {string} currentProfile
 */
function updateStatusBar(enabled, currentProfile) {
  const profileIcon = currentProfile === "blue" ? "🔵" : "⌨️";
  const profileName = currentProfile === "blue" ? "Blue" : "Typewriter";
  statusBarItem.text = enabled
    ? `$(unmute) MechKeys: ${profileIcon} ${profileName}`
    : "$(mute) MechKeys: OFF";
  statusBarItem.tooltip = enabled
    ? `${profileName} profile active. Click to switch profile.`
    : "MechKeys OFF. Click to turn on.";
}

/**
 * Builds the HTML for the sidebar webview audio engine
 * @param {vscode.ExtensionContext} context
 * @param {vscode.Webview} webview
 * @param {string} profile
 * @param {number} volume
 */
function getWebviewContent(context, webview, profile, volume) {
  const profiles = ["blue", "typewriter"];
  const soundTypes = [
    "key",
    "enter",
    "backspace",
    "space",
    "tab",
    "arrow",
    "modifier",
    "function",
  ];

  const soundUris = {};
  for (const p of profiles) {
    soundUris[p] = {};
    for (const t of soundTypes) {
      const filePath = vscode.Uri.file(
        path.join(context.extensionPath, "sounds", p, `${t}.wav`),
      );
      soundUris[p][t] = webview.asWebviewUri(filePath).toString();
    }
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src ${webview.cspSource}; script-src 'unsafe-inline'; connect-src ${webview.cspSource};">
  <style>
    body { font-family: sans-serif; padding: 10px; }
    button {
      width: 100%; padding: 8px; margin-top: 8px;
      background: #0e639c; color: white; border: none;
      cursor: pointer; border-radius: 4px; font-size: 13px;
    }
    button:hover { background: #1177bb; }
    #status { font-size: 12px; color: #ccc; margin-top: 8px; }
  </style>
</head>
<body>
  <button id="unlockBtn">🎹 Click to Activate Sound</button>
  <div id="status">Loading sounds...</div>
<script>
  const vscode = acquireVsCodeApi();
  const soundUris = ${JSON.stringify(soundUris)};
  let currentProfile = '${profile}';
  let currentVolume = ${volume} / 100;
  let audioCtx;
  let unlocked = false;
  const audioBuffers = {};

  // User clicks button to unlock AudioContext
  // This is required by browsers - audio cannot start without a user interaction
  document.getElementById('unlockBtn').addEventListener('click', async () => {
    if (!audioCtx) audioCtx = new AudioContext();
    await audioCtx.resume();
    unlocked = true;
    document.getElementById('unlockBtn').textContent = '✅ Sound Active!';
    document.getElementById('unlockBtn').style.background = '#388a34';
    document.getElementById('status').textContent = 'Ready! Start typing...';

    // Play a silent sound every 10s to keep AudioContext alive
    setInterval(() => {
      if (audioCtx && audioCtx.state !== 'closed') {
        const silentBuffer = audioCtx.createBuffer(1, 1, 22050);
        const source = audioCtx.createBufferSource();
        source.buffer = silentBuffer;
        source.connect(audioCtx.destination);
        source.start();
      }
    }, 10000);

    vscode.postMessage({ type: 'unlocked' });
  });

  // Load all sound files into memory upfront
  // This means zero disk reading at keypress time = low latency
  async function loadAllSounds() {
    document.getElementById('status').textContent = 'Loading sounds...';
    for (const p of Object.keys(soundUris)) {
      audioBuffers[p] = {};
      for (const type of Object.keys(soundUris[p])) {
        try {
          const response = await fetch(soundUris[p][type]);
          const arrayBuffer = await response.arrayBuffer();
          audioBuffers[p][type] = await audioCtx.decodeAudioData(arrayBuffer);
        } catch(e) {
          console.error('MechKeys failed to load: ' + p + '/' + type, e);
        }
      }
    }
    document.getElementById('status').textContent = 'Click the button to activate!';
    console.log('MechKeys: All sounds preloaded!');
  }

  // Play a sound buffer through the Web Audio API signal chain:
  // AudioBuffer -> GainNode (volume) -> Speakers
  function triggerSound(buffer) {
    const source = audioCtx.createBufferSource();
    const gainNode = audioCtx.createGain();
    gainNode.gain.setValueAtTime(currentVolume, audioCtx.currentTime);
    source.buffer = buffer;
    source.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    source.start(audioCtx.currentTime);
    source.stop(audioCtx.currentTime + 0.15); // only play first 150ms
  }

  // Called when extension.js sends a 'play' message
  function playSound(type) {
    if (!unlocked || !audioCtx) return;
    const buffer = audioBuffers[currentProfile]?.[type];
    if (!buffer) {
      console.warn('MechKeys: No buffer for', currentProfile, type);
      return;
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().then(() => triggerSound(buffer));
    } else {
      triggerSound(buffer);
    }
  }

  // Listen for messages from extension.js
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.command === 'play') {
      playSound(msg.type);
    } else if (msg.command === 'setProfile') {
      currentProfile = msg.profile;
      document.getElementById('status').textContent = 'Profile: ' + currentProfile;
    } else if (msg.command === 'setVolume') {
      currentVolume = msg.volume / 100;
    }
  });

  // Start loading sounds immediately when webview opens
  audioCtx = new AudioContext();
  loadAllSounds();
</script>
</body>
</html>`;
}

function deactivate() {
  if (statusBarItem) statusBarItem.dispose();
}

module.exports = { activate, deactivate };
