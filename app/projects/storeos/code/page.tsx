import CodeWorkbenchScreen from "@/components/screens/CodeWorkbenchScreen";
import { ProjectStoreProvider } from "@/components/store/ProjectStore";
export default function Page() { return <ProjectStoreProvider><CodeWorkbenchScreen /></ProjectStoreProvider>; }