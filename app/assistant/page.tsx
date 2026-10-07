import { redirect } from "next/navigation";

/** The assistant is the chat now. Old /assistant links land in it. */
export default async function AssistantPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) if (typeof value === "string") params.set(key, value);
  redirect(params.size ? `/?${params}` : "/");
}
