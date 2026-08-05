import { mkdirSync, writeFileSync } from "node:fs";

mkdirSync("dist/server", { recursive: true });
writeFileSync(
  "dist/server/index.js",
  `export default {
  async fetch(request, env) {
    if (env?.ASSETS) {
      // Sites exposes the built files through ASSETS, but its root request does
      // not always apply the static index fallback. The self-contained artifact
      // is the canonical share build, so route both entry URLs to it explicitly.
      const url = new URL(request.url);
      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        url.pathname = "/carboy-artifact.html";
        return env.ASSETS.fetch(new Request(url, request));
      }
      return env.ASSETS.fetch(request);
    }
    return new Response("Carboy assets are unavailable", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
};
`
);
