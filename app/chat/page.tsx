import { Suspense } from "react";
import ChatScreen from "@/components/screens/ChatScreen";

function ChatLoading() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#07070a",
        color: "#a1a1aa",
      }}
    >
      loading ELIAS…
    </main>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<ChatLoading />}>
      <ChatScreen />
    </Suspense>
  );
}