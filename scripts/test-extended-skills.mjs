import fs from "node:fs";

const source = fs.readFileSync(new URL("../lib/extendedSkills.ts", import.meta.url), "utf8");
const expected = [
  ["elias-api", "Elias API"],
  ["typst-pdf-maker", "Typst PDF Maker"],
  ["video-generator", "Video Generator"],
  ["youtube-video-research", "YouTube Video Research"],
  ["tts-prompter", "TTS Prompter"],
  ["stock-analysis", "Stock Analysis"],
  ["similarweb-analytics", "SimilarWeb Analytics"],
  ["music-prompter", "Music Prompter"],
  ["excel-generator", "Excel Generator"],
];
const failures = [];
for (const [id, name] of expected) {
  if (!source.includes(`id: \"${id}\"`)) failures.push(`${id}: missing manifest id`);
  if (!source.includes(`name: \"${name}\"`)) failures.push(`${id}: missing display name`);
}
for (const token of ["confirmation", "Do not fabricate", "real data", "source", "limitations"]) {
  if (!source.toLowerCase().includes(token.toLowerCase())) failures.push(`missing safety/grounding token: ${token}`);
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, skills: expected.map(([id]) => id), safetyChecks: 5 }, null, 2));
