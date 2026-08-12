import { ProviderConfig, ProviderName, TaskType } from "@/lib/types";

const CONFIG:Record<ProviderName,ProviderConfig> = {
  qwen:{name:"qwen",key:process.env.QWEN_API_KEY,baseUrl:"https://dashscope-intl.aliyuncs.com/compatible-mode/v1",fallbackModels:["qwen3.7-plus","qwen3.7-flash"]},
  agentrouter:{name:"agentrouter",key:process.env.AGENTROUTER_API_KEY,baseUrl:"https://co.agentrouter.org/v1",fallbackModels:["kimi-k2.6","glm-5.1","step3p5-code-alpha"]},
  groq:{name:"groq",key:process.env.GROQ_API_KEY,baseUrl:"https://api.groq.com/openai/v1",fallbackModels:["openai/gpt-oss-120b"]},
  openrouter:{name:"openrouter",key:process.env.OPENROUTER_API_KEY,baseUrl:"https://openrouter.ai/api/v1",fallbackModels:["openrouter/free"]},
  cerebras:{name:"cerebras",key:process.env.CEREBRAS_API_KEY,baseUrl:"https://api.cerebras.ai/v1",fallbackModels:["zai-glm-4.7"]},
  mistral:{name:"mistral",key:process.env.MISTRAL_API_KEY,baseUrl:"https://api.mistral.ai/v1",fallbackModels:["mistral-large-latest"]},
  github:{name:"github",key:process.env.GITHUB_TOKEN,baseUrl:"https://models.github.ai/inference",fallbackModels:[]}
};

export function providerConfig(p:ProviderName){return CONFIG[p];}
export function configuredProviders(){return (Object.keys(CONFIG) as ProviderName[]).filter(p=>!!CONFIG[p].key);}

export async function listModels(p:ProviderName){
  const c=CONFIG[p]; if(!c.key) return [];
  try{
    const r=await fetch(`${c.baseUrl}/models`,{headers:{Authorization:`Bearer ${c.key}`},cache:"no-store"});
    if(!r.ok)return [];
    const d=await r.json(); return Array.isArray(d?.data)?d.data:[];
  }catch{return []}
}

function score(id:string,task:TaskType){
  const s=id.toLowerCase(); let n=0;
  if(task==="code") {if(/code|coder|devstral|qwen|kimi|glm|gpt-oss/.test(s))n+=10;if(/reason|thinking/.test(s))n+=2;}
  if(task==="research"||task==="general") {if(/qwen|kimi|glm|mistral|llama|gpt-oss|deepseek/.test(s))n+=7;if(/reason|thinking/.test(s))n+=2;}
  if(task==="study") {if(/qwen|mistral|kimi|glm|gpt-oss/.test(s))n+=6;}
  if(/free/.test(s))n+=2; return n;
}

export async function pickModel(p:ProviderName,task:TaskType){
  const c=CONFIG[p]; if(!c.key)return null;
  const models=await listModels(p);
  if(models.length){
    const sorted=models.map((m:any)=>String(m.id)).sort((a,b)=>score(b,task)-score(a,task));
    if(sorted[0])return sorted[0];
  }
  return c.fallbackModels[0]||null;
}

export function providerOrder(task:TaskType,complexity:number):ProviderName[]{
  if(task==="code"&&complexity>=8)return ["qwen","agentrouter","cerebras","openrouter","mistral","github","groq"];
  if(task==="code")return ["qwen","cerebras","agentrouter","openrouter","mistral","github","groq"];
  if(task==="research")return ["openrouter","cerebras","qwen","mistral","agentrouter","groq","github"];
  return ["cerebras","qwen","openrouter","mistral","agentrouter","groq","github"];
}

export async function chooseProvider(task:TaskType,complexity:number){
  for(const p of providerOrder(task,complexity)){if(CONFIG[p].key&&await pickModel(p,task))return p;}
  return null;
}
