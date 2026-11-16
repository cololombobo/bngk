import { readFileSync, writeFileSync } from "node:fs";

const dist = new URL("./dist/", import.meta.url);
const read = name => readFileSync(new URL(name, dist), "utf8");
const escapeScriptEnd = text => text.replace(/<\/script/gi, "<\\/script");

const scripts = [];
const template = read("index.html").replace(
  /^  <script defer src="([^"]+)"><\/script>\n/gm,
  (_, source) => {
    scripts.push(source);
    return "";
  }
);
const stylesheet = '<link rel="stylesheet" href="styles.css">';
if (!scripts.length || !template.includes(stylesheet) || !template.includes("</body>")) {
  throw new Error("Expected stylesheet, scripts and body in dist/index.html.");
}

const tileIndex = read("map-data.js").match(/^window\.BangkokTileIndex=(.*);$/m);
if (!tileIndex) throw new Error("No detail tile index in dist/map-data.js.");

const tileTags = [];
for (const [zoom, files] of Object.entries(JSON.parse(tileIndex[1]))) {
  for (const file of files) {
    const key = [zoom, file].join("/");
    const assignment = read("map/" + key + ".js")
      .match(/^window\.BangkokTiles\["([^"]+)"\]=([\s\S]+);\s*$/);
    if (assignment?.[1] !== key || !Array.isArray(JSON.parse(assignment[2]))) {
      throw new Error("Invalid detail tile " + key);
    }
    tileTags.push('<script type="application/json" id="offline-tile-' + key + '">' +
      escapeScriptEnd(assignment[2]) + "</script>");
  }
}

const runtime = scripts.map(source =>
  "<script>\n" + escapeScriptEnd(read(source)) + "\n</script>"
).join("\n");
const html = template
  .replace(stylesheet, () => "<style>\n" + read("styles.css") + "\n</style>")
  .replace(/<title>[^<]*<\/title>/, "<title>Bangkok Rail — офлайн-карта Бангкока</title>")
  .replace('href="./index.html"', 'href=""')
  .replace(/^    <a id="offline-download".*<\/a>\n/m, "")
  .replace("</body>", () =>
    '<div id="offline-map-tiles" hidden>\n' + tileTags.join("\n") + "\n</div>\n" +
    runtime + "\n</body>"
  );

const output = new URL("bangkok-rail-offline.html", dist);
writeFileSync(output, html);
console.log("Created dist/bangkok-rail-offline.html with " + tileTags.length + " embedded detail tiles.");
