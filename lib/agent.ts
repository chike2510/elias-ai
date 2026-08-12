import { AgentAction, AgentRequest, TaskType, ToolResult, WorkspaceFile } from "@/lib/types";
import { chooseProvider, pickModel, providerConfig, providerOrder } from "@/lib/providers";

export type AgentInput={task:string;taskType:TaskType;files:WorkspaceFile[];messages:{role:string;content:string}[];toolResults:ToolResult[]};
export type AgentOutput={provider:string;model:string;message:string;requests:AgentRequest[];actions:AgentAction[];done:boolean};

function complexity(task:string,files:WorkspaceFile[]){let n=3;if(/build|implement|refactor|debug|repository|project|tsx|jsx|typescript|javascript|api|database/i.test(task))n+=3;if(/entire|complete|full|production|autonomous|all files/i.test(task))n+=2;if(files.length>20)n+=1;if(files.reduce((a,f)=>a+f.content.length,0)>100000)n+=1;return Math.min(10,n);}

const SYSTEM=`You are ELIAS, an autonomous software engineering and research agent.

You work against a user-provided workspace. Your job is to make real changes, not merely describe code.

AVAILABLE REQUESTS:
- read_file: request the exact contents of a file before editing unfamiliar code.
- search_web: search current internet information.
- get_url: fetch readable text from a URL.

AVAILABLE ACTIONS:
- write_file: create or replace a file.
- append_file: append a chunk to an existing file. Use this for long files instead of returning enormous single actions.
- rename_file: rename a file.
- delete_file: delete a file only when clearly required.

RULES:
1. Never invent the contents of files you have not read when those contents matter.
2. For a large project, work incrementally across multiple steps.
3. Keep each write/append action reasonably sized. Large files should be written in chunks.
4. Preserve existing architecture unless the task calls for changing it.
5. Never delete unrelated functionality.
6. Use web search for current libraries, APIs, prices, docs, compatibility or other time-sensitive facts.
7. If you need more context, issue requests rather than guessing.
8. After meaningful edits, inspect/review the relevant files in a later step when possible.
9. You cannot claim to have run shell commands, builds or tests; the host will add a sandbox tool separately.
10. Return ONLY JSON, no markdown fences, matching exactly: {"message":"...","requests":[],"actions":[],"done":false}.
11. When the requested work is complete, done=true.`;

function parse(raw:string){const s=raw.trim().replace(/^```(?:json)?\s*/i,"").replace(/```$/i,"");const a=s.indexOf("{");const b=s.lastIndexOf("}");if(a<0||b<a)throw new Error("ELIAS model returned invalid JSON");return JSON.parse(s.slice(a,b+1));}

async function call(provider:string,model:string,input:AgentInput){
  const c=providerConfig(provider as any); const messages=[{role:"system",content:SYSTEM},{role:"user",content:`TASK:\n${input.task}\n\nWORKSPACE MANIFEST:\n${input.files.map(f=>`${f.path} (${f.content.length} chars)`).join("\n")}\n\nTOOL RESULTS:\n${JSON.stringify(input.toolResults).slice(0,90000)}\n\nCONVERSATION:\n${input.messages.map(m=>`${m.role}: ${m.content}`).join("\n")}`}];
  const r=await fetch(`${c.baseUrl}/chat/completions`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${c.key}`},body:JSON.stringify({model,messages,temperature:0.15}),cache:"no-store"});
  if(!r.ok)throw new Error(`${provider} ${r.status}: ${(await r.text()).slice(0,700)}`);
  const d=await r.json(); const raw=d?.choices?.[0]?.message?.content;if(!raw)throw new Error(`${provider} returned no content`);const p=parse(raw);
  return {provider,model,message:String(p.message||""),requests:Array.isArray(p.requests)?p.requests:[],actions:Array.isArray(p.actions)?p.actions:[],done:Boolean(p.done)} as AgentOutput;
}

export async function runAgentStep(input:AgentInput){
  const c=complexity(input.task,input.files); const preferred=await chooseProvider(input.taskType,c); if(!preferred)throw new Error("No configured AI provider is available. Add at least one API key in Vercel.");
  const order=[preferred,...providerOrder(input.taskType,c)].filter((x,i,a)=>a.indexOf(x)===i);
  const errors:string[]=[];
  for(const p of order){try{const model=await pickModel(p,input.taskType);if(!model)continue;return await call(p,model,input);}catch(e){errors.push(e instanceof Error?e.message:String(e));}}
  throw new Error(`All configured providers failed. ${errors.slice(0,3).join(" | ")}`);
}
