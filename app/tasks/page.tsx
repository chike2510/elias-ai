import { Suspense } from "react";
import TaskWorkspace from "@/components/screens/TaskWorkspace";

function TaskLoading() {
  return <main className="screen task-loading"><div className="task-loading-mark">ELIAS</div><p>opening task workspace…</p></main>;
}

export default function TasksPage() {
  return <Suspense fallback={<TaskLoading />}><TaskWorkspace /></Suspense>;
}
