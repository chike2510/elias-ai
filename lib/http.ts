import { NextResponse } from "next/server";

export type ApiError = {
  code: string;
  message: string;
  details?: unknown;
};

export function jsonOk<T extends Record<string, unknown>>(
  data: T,
  init?: ResponseInit,
) {
  return NextResponse.json({ ok: true, ...data }, init);
}

export function jsonError(
  message: string,
  status = 500,
  code = "INTERNAL_ERROR",
  details?: unknown,
) {
  const error: ApiError = { code, message };
  if (details !== undefined) error.details = details;
  return NextResponse.json({ ok: false, error }, { status });
}

export async function readJsonRequest<T>(request: Request): Promise<T> {
  const raw = await request.text();
  if (!raw.trim()) throw new Error("Request body is empty.");

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}
