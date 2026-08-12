import { NextRequest, NextResponse } from "next/server";
import { runAgentStep } from "@/lib/agent";
export const runtime="nodejs";
export const maxDuration=60;
export async function POST(req:NextRequest){try{return NextResponse.json(await runAgentStep(await req.json()));}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Agent step failed"},{status:500});}}
