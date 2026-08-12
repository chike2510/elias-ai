import { NextRequest,NextResponse } from "next/server"; import { fetchUrl } from "@/lib/webSearch";
export const runtime="nodejs";
export async function POST(req:NextRequest){try{const {url}=await req.json();if(!url)return NextResponse.json({error:"url required"},{status:400});return NextResponse.json({url,content:await fetchUrl(String(url))});}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"fetch failed"},{status:500});}}
