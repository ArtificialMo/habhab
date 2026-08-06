/**
 * Packs the built game into one self-contained HTML file.
 *
 * An artifact page is served under a strict CSP with no external hosts, so nothing
 * may be fetched at runtime: the JS bundle is inlined and the Havok wasm is carried
 * as base64 and handed to the engine as a binary rather than a URL.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dist = "dist/assets";
const files = readdirSync(dist);
const jsName = files.find((f) => f.startsWith("index-") && f.endsWith(".js"));
const wasmName = files.find((f) => f.endsWith(".wasm"));
if (!jsName || !wasmName) throw new Error("build output not found — run vite build first");

const js = readFileSync(join(dist, jsName), "utf8");
const wasmB64 = readFileSync(join(dist, wasmName)).toString("base64");
const cssName = files.find((f) => f.endsWith(".css"));
const css = cssName ? readFileSync(join(dist, cssName), "utf8") : "";
const audioFiles = {
  coin: "coin-drop.ogg",
  impact: "metal-impact.ogg",
  engine: "engine-loop.ogg",
};
const audio = Object.fromEntries(
  Object.entries(audioFiles).map(([id, filename]) => {
    const bytes = readFileSync(join("dist", "audio", filename));
    return [id, `data:audio/ogg;base64,${bytes.toString("base64")}`];
  })
);
const audioJson = JSON.stringify(audio);
const musicFiles = {
  "/audio/music/intro-1.mp3": "music/intro-1.mp3",
  "/audio/music/intro-2.mp3": "music/intro-2.mp3",
  "/audio/music/day-1.mp3": "music/day-1.mp3",
  "/audio/music/day-2.mp3": "music/day-2.mp3",
  "/audio/music/day-3.mp3": "music/day-3.mp3",
  "/audio/music/day-4.mp3": "music/day-4.mp3",
  "/audio/music/day-5.mp3": "music/day-5.mp3",
};
const music = Object.fromEntries(
  Object.entries(musicFiles).map(([url, filename]) => {
    const bytes = readFileSync(join("dist", "audio", filename));
    return [url, "data:audio/mpeg;base64," + bytes.toString("base64")];
  })
);
const musicJson = JSON.stringify(music);

// The shell mirrors index.html: a portrait 9:16 stage, letterboxed on wide screens.
const html = `<style>
  :root { color-scheme: dark; }
  html, body {
    margin: 0; padding: 0; height: 100%; overflow: hidden;
    background: #0a0e18;
    font-family: "Arial Black", Impact, system-ui, sans-serif;
    -webkit-user-select: none; user-select: none;
    -webkit-tap-highlight-color: transparent; overscroll-behavior: none;
  }
  #stage { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; }
  #frame {
    position: relative; height: 100%; aspect-ratio: 9 / 16; max-width: 100%;
    overflow: hidden; box-shadow: 0 0 80px rgba(0,0,0,.6);
  }
  #render { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; outline: none; z-index: 1; }
  #boot {
    position: absolute; inset: 0; display: grid; place-items: center; z-index: 20;
    color: #ffd23f; letter-spacing: .28em; font-size: 13px; background: #0a0e18;
    transition: opacity .4s ease;
  }
  ${css}
</style>
<div id="stage">
  <div id="frame">
    <canvas id="render"></canvas>
    <div id="boot">LOADING…</div>
  </div>
</div>
<script>
(function () {
  // Decode the physics engine binary once, before the game module runs.
  var b64 = "${wasmB64}";
  var bin = atob(b64);
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  globalThis.__CARBOY_WASM__ = bytes.buffer;
  globalThis.__CARBOY_AUDIO__ = ${audioJson};
  globalThis.__CARBOY_MUSIC__ = ${musicJson};
  // Shared build: no developer overlay, no tuning panel.
  globalThis.__CARBOY_SHARE__ = true;
})();
</script>
<script type="module">
${js}
</script>
<script>
  // The game removes nothing on boot, so the placeholder clears itself once the
  // canvas has something in it.
  (function () {
    var boot = document.getElementById("boot");
    var tries = 0;
    var t = setInterval(function () {
      if (globalThis.CARBOY || ++tries > 200) {
        clearInterval(t);
        if (boot) { boot.style.opacity = "0"; setTimeout(function(){ boot.remove(); }, 450); }
      }
    }, 100);
  })();
</script>`;

writeFileSync("dist/carboy-artifact.html", html);
console.log("wrote dist/carboy-artifact.html", (html.length / 1048576).toFixed(2) + " MB");
