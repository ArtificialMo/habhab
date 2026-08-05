import { mkdirSync, writeFileSync } from "node:fs";

mkdirSync("dist/server", { recursive: true });
writeFileSync(
  "dist/server/index.js",
  `export default {
  async fetch(request, env) {
    if (env?.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Carboy assets are unavailable", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
};
`
);
