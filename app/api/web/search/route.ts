import { NextRequest,NextResponse } from "next/server"; import { searchWeb } from "@/lib/webSearch";
export const runtime="nodejs";
export async function POST(req:NextRequest){try{const {query}=await req.json();if(!query)return NextResponse.json({error:"query required"},{status:400});return NextResponse.json({results:await searchWeb(String(query))});}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"search failed"},{status:500});}}
