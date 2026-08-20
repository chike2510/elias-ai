import { redirect } from "next/navigation";

type TasksPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const key of ["id", "prompt"]) {
    const value = params[key];
    if (typeof value === "string" && value) query.set(key, value);
  }
  redirect(`/chat${query.toString() ? `?${query.toString()}` : ""}`);
}
