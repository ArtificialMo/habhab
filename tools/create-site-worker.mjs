import { gzipSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const artifactGzip = gzipSync(readFileSync("dist/carboy-artifact.html"), { level: 9 }).toString("base64");

mkdirSync("dist/server", { recursive: true });
writeFileSync(
  "dist/server/index.js",
  `const CARBOY_HTML_GZIP_B64 = ${JSON.stringify(artifactGzip)};

function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function artifactResponse() {
  const compressed = new Response(decodeBase64(CARBOY_HTML_GZIP_B64)).body;
  const body = compressed.pipeThrough(new DecompressionStream("gzip"));
  return new Response(body, {
    headers: {
      "cache-control": "no-cache",
      "content-type": "text/html; charset=utf-8",
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      return artifactResponse();
    }
    if (env?.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Carboy assets are unavailable", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
};
`
);
