import { Suspense } from "react";
import ChatView from "@/components/chat/ChatView";

export default function Page() {
  return <Suspense fallback={null}><ChatView /></Suspense>;
}
