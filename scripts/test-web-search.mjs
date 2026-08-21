const base = process.env.ELIAS_TEST_BASE || "http://localhost:3100";
const query = "Hull City Manchester United August 22 2026 official fixture";
const response = await fetch(`${base}/api/web/search`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ query }),
});
if (!response.ok) throw new Error(`search endpoint returned HTTP ${response.status}`);
const body = await response.json();
const results = Array.isArray(body.results) ? body.results : [];
if (!results.length) throw new Error("search returned no results");
const text = results.map((item) => `${item.title} ${item.url}`).join(" ").toLowerCase();
if (!text.includes("manutd") && !text.includes("manchester united")) throw new Error("current fixture query did not return a Manchester United source");
if (!text.includes("hull")) throw new Error("current fixture query did not return a Hull City source");
if (/merriam|cambridge|dictionary/.test(text)) throw new Error("irrelevant dictionary result leaked into fixture search results");
console.log(JSON.stringify({ pass: true, resultCount: results.length, topResults: results.slice(0, 5) }, null, 2));
