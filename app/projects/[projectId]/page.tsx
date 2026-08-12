import AgentWorkspace from "@/components/screens/AgentWorkspace";

export default async function Page({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <AgentWorkspace initialProjectId={projectId} />;
}
