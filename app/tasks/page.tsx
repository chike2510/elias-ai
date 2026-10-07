import { Suspense } from "react";
import TasksScreen from "@/components/screens/TasksScreen";

export default function TasksPage() {
  return <Suspense fallback={null}><TasksScreen /></Suspense>;
}
