// Renders the Training lie pictures from their SVG sources to JPEGs the app
// bundles (the app has no SVG library, and plain images ship in OTA updates).
//
//   cd mobile/tools/lie-art
//   npm i --no-save @resvg/resvg-js sharp
//   node render.mjs            # all 14
//   node render.mjs uphill     # just one
//
// Each scene in scenes/<art>.svg is drawn on a 320 × 220 grid and shares the
// ball, sky, grain and haze in defs.svg. Output: assets/images/lies/<art>.jpg
// at 3× (960 × 660). <art> matches LieArt in src/lib/training.ts.

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "../../assets/images/lies");
mkdirSync(out, { recursive: true });

const defs = readFileSync(join(here, "defs.svg"), "utf8");
const only = process.argv.slice(2);
const scenes = readdirSync(join(here, "scenes"))
  .filter((f) => f.endsWith(".svg"))
  .map((f) => f.replace(/\.svg$/, ""))
  .filter((name) => !only.length || only.includes(name));

for (const name of scenes) {
  const body = readFileSync(join(here, "scenes", `${name}.svg`), "utf8");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 320 220" width="320" height="220">${defs}${body}</svg>`;
  const png = new Resvg(svg, { fitTo: { mode: "width", value: 960 } }).render().asPng();
  const jpg = await sharp(png).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
  writeFileSync(join(out, `${name}.jpg`), jpg);
  console.log(`${name}.jpg  ${Math.round(jpg.length / 1024)} KB`);
}
