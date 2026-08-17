import RepositoryWorkspaceScreen from "@/components/screens/RepositoryWorkspaceScreen";

export default async function Page({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  return <RepositoryWorkspaceScreen owner={owner} repo={repo} />;
}
