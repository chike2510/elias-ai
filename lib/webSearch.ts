function clean(s:string){return s.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/\s+/g," ").trim();}
export async function searchWeb(query:string){
  const q=encodeURIComponent(query);
  for(const url of [`https://html.duckduckgo.com/html/?q=${q}`,`https://www.google.com/search?q=${q}`]){
    try{
      const r=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0 ELIAS research agent"},cache:"no-store"}); if(!r.ok)continue;
      const html=await r.text(); const out:{title:string;url:string}[]=[]; const re=/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi; let m;
      while((m=re.exec(html))&&out.length<10){const href=m[1];const title=clean(m[2]);if(title.length>8&&/^https?:\/\//i.test(href)&&!/(duckduckgo|google\.)/i.test(href))out.push({title,url:href});}
      const unique=out.filter((x,i,a)=>a.findIndex(y=>y.url===x.url)===i); if(unique.length)return unique;
    }catch{}
  }
  return [];
}
export async function fetchUrl(url:string){
  const r=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0 ELIAS research agent"},cache:"no-store"}); if(!r.ok)throw new Error(`URL returned ${r.status}`); return clean(await r.text()).slice(0,30000);
}
