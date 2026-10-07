// Elias embeddings: free gte-small (384 dims) on the Supabase Edge Runtime.
// POST { "input": "text" } or { "inputs": ["a", "b"] } -> { "embeddings": number[][], "model": "gte-small", "dims": 384 }
// Auth: header x-elias-embed-secret == ELIAS_EMBED_SECRET (function secret), or Bearer == the project's service role key.
// deno-lint-ignore-file no-explicit-any
const session = new (globalThis as any).Supabase.ai.Session("gte-small");

function authorized(req: Request) {
  const secret = Deno.env.get("ELIAS_EMBED_SECRET");
  const given = req.headers.get("x-elias-embed-secret");
  if (secret && given && given === secret) return true;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return Boolean(service && bearer && bearer === service);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return Response.json({ error: "POST only" }, { status: 405 });
  if (!authorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    const inputs: string[] = Array.isArray(body.inputs) ? body.inputs : typeof body.input === "string" ? [body.input] : [];
    if (!inputs.length || inputs.length > 32) return Response.json({ error: "Send input (string) or inputs (1-32 strings)." }, { status: 400 });
    const embeddings = [];
    for (const text of inputs) embeddings.push(Array.from(await session.run(String(text).slice(0, 2000), { mean_pool: true, normalize: true }) as number[]));
    return Response.json({ embeddings, model: "gte-small", dims: 384 });
  } catch (error) {
    return Response.json({ error: String((error as Error)?.message || error) }, { status: 500 });
  }
});
