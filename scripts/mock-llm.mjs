/* Scripted OpenAI-compatible server for scripts/test-assistant.ts and local screenshots.
   Behaviour is picked from the last user message. Supports stream:true (SSE) and plain JSON.
   Run: node scripts/mock-llm.mjs [port]  (default 5599) */
import http from "node:http";

const port = Number(process.argv[2] || process.env.MOCK_LLM_PORT || 5599);
let n = 0;

const textOf = (content) => Array.isArray(content) ? content.filter((part) => part.type === "text").map((part) => part.text).join("\n") : content || "";
const imagesIn = (content) => Array.isArray(content) ? content.filter((part) => part.type === "image_url" && /^data:image\//.test(part.image_url?.url || "")).length : 0;

function decide(data) {
  const msgs = data.messages;
  const last = msgs[msgs.length - 1];
  const lastUserMessage = [...msgs].reverse().find((m) => m.role === "user");
  const lastUser = textOf(lastUserMessage?.content);
  const images = imagesIn(lastUserMessage?.content);
  const call = (name, args) => ({ role: "assistant", content: null, tool_calls: [{ id: `c${++n}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
  const text = (content) => ({ role: "assistant", content });
  if (!data.tools) return text(lastUser.includes("long-term memory") ? '{"facts":[{"kind":"preference","content":"Prefers window seats on flights."}]}' : "Summary.");
  if (msgs[0].content.includes("MORNING BRIEF DATA")) return text("Morning! Mild day ahead. Nothing urgent before noon, so start with the hard thing.");
  // Background job slices (the job brief rides in the system prompt).
  const job = msgs[0].content.match(/TASK: ([\w-]+)/)?.[1];
  if (msgs[0].content.includes("BACKGROUND JOB") && job) {
    const starting = lastUser.includes("Start the job");
    if (job === "multi-research") {
      if (last.role === "tool") return text("Checked the time.\nSTATUS: CONTINUE\nNotes: time checked, next compare suya spots.");
      return starting ? call("get_time", {}) : text("STATUS: DONE\n**Glover Court Suya** is the pick: consistent, open late.");
    }
    if (job === "email-task") {
      if (last.role === "tool") return text("Drafted it; waiting for the go-ahead.");
      return starting ? call("gmail_send", { to: "ada@example.com", subject: "Friday", body: "Hi Ada, still on for Friday?" }) : text("STATUS: DONE\nThe email step is settled.");
    }
    if (job === "slow-task") return text("Still going.\nSTATUS: CONTINUE\nMore notes.");
    if (job === "crash-task") throw new Error("mock crash");
  }
  if (last.role === "tool") {
    const tools = msgs.filter((m) => m.role === "tool");
    if (lastUser.includes("plan my day")) return text("Here's your day: a light one. Block the morning for deep work and clear email after lunch.");
    if (lastUser.includes("check my email")) return text("Tap Connect Google below and I'll go through your inbox.");
    if (lastUser.includes("weather")) return text("Warm and mostly clear today. Take water.");
    if (process.env.MOCK_LLM_FRIENDLY && last.content.startsWith("PAUSED FOR APPROVAL")) return text("Drafted it. Have a look and tap Approve to send.");
    if (process.env.MOCK_LLM_FRIENDLY && lastUser.includes("Remind me")) return text("Done. I'll nudge you every morning at 8.");
    if (process.env.MOCK_LLM_FRIENDLY && lastUser.includes("remember")) return text("Got it, Port Harcourt. I'll keep that in mind.");
    if (process.env.MOCK_LLM_FRIENDLY && lastUser.includes("search")) return text("Lagos has great options. Glover Court Suya keeps topping the lists. Want directions?");
    return text(`OK after ${tools.length} tool(s): ${last.content.slice(0, 120)}`);
  }
  if (lastUser.includes("start a background job")) return call("start_background_job", { title: "Suya research", prompt: "multi-research the best suya in Lagos", kind: "research" });
  if (lastUser.includes("remember")) return call("memory_save", { content: "Chikeziri lives in Port Harcourt.", kind: "profile" });
  if (lastUser.includes("every morning") && lastUser.includes("Remind")) return call("schedule_create", { name: "Drink water", prompt: "Remind me to drink water.", schedule: { type: "daily", time: "08:00" } });
  if (lastUser.includes("every morning")) return call("schedule_create", { name: "Brief", prompt: "Brief me", schedule: { type: "daily", time: "08:00" } });
  if (lastUser.includes("email bola")) return call("gmail_send", { to: "bola@example.com", subject: "Hi", body: "Hello Bola,\n\nAre we still on for Friday?\n\nChikeziri" });
  if (lastUser.includes("invite ada")) return call("calendar_create", { summary: "Project sync", start: "2026-10-08T10:00:00+01:00", end: "2026-10-08T10:30:00+01:00", attendees: ["ada@example.com"] });
  if (lastUser.includes("check my email")) return call("gmail_search", { query: "is:unread newer_than:1d" });
  if (lastUser.includes("plan my day")) return call("daily_brief", {});
  if (lastUser.includes("weather")) return call("weather", { place: "Lagos" });
  if (lastUser.includes("search")) return call("web_search", { query: "best suya in Lagos" });
  if (lastUser.includes("text tool")) return text('<tool_call>{"name":"get_time","arguments":{}}</tool_call>');
  if (images) return text(`I can see ${images} image(s) via ${data.model}.`);
  if (lastUser.includes("which model")) return text(`model=${data.model}`);
  if (lastUser.includes("[Attached file:")) return text(`Read the file: ${(lastUser.match(/<<<\n([\s\S]{0,40})/) || [])[1] || "empty"}`);
  if (lastUser.includes("[system note]")) return text("Follow-up: " + lastUser.slice(0, 80));
  if (lastUser.includes("long answer")) return text("Sure. Here's the short version: it depends on traffic, but leave by 7:40 and you'll make it with ten minutes to spare. Want me to set a reminder?");
  return text("Plain answer. System prompt had memory: " + msgs[0].content.includes("Port Harcourt"));
}

http.createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const data = JSON.parse(body || "{}");
  // Like real text-only models: image parts are rejected unless the model name says it can see.
  if (data.messages?.some((m) => imagesIn(m.content)) && !String(data.model || "").includes("vision")) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: `model ${data.model} does not support image input` } }));
    return;
  }
  let message;
  try { message = decide(data); } catch (error) { res.statusCode = 500; res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ error: { message: String(error.message) } })); return; }
  if (!data.stream) { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ choices: [{ message }] })); return; }
  res.writeHead(200, { "content-type": "text/event-stream" });
  const send = (delta) => res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
  if (message.tool_calls) message.tool_calls.forEach((call, index) => {
    send({ tool_calls: [{ index, id: call.id, type: "function", function: { name: call.function.name, arguments: "" } }] });
    const args = call.function.arguments;
    for (let i = 0; i < args.length; i += 12) send({ tool_calls: [{ index, function: { arguments: args.slice(i, i + 12) } }] });
  });
  else {
    const words = String(message.content || "").split(/(?<=\s)/);
    for (const word of words) { send({ content: word }); await new Promise((r) => setTimeout(r, Number(process.env.MOCK_LLM_DELAY || 0))); }
  }
  res.write("data: [DONE]\n\n");
  res.end();
}).listen(port, () => console.log(`mock llm on ${port}`));
