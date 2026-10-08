import { Brain, Code2, Folder, Globe2, LibraryBig, Link2, ListChecks, MessageCircle, Search, Settings2, ShieldCheck, Sparkles, SquareKanban, UserRound, Wand2, Workflow } from "lucide-react";

export type Destination = { href: string; label: string; detail: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; group: "primary" | "work" | "you" };

/** Primary tabs: exactly three. */
export const PRIMARY: Destination[] = [
  { href: "/", label: "Chat", detail: "Talk to Elias", icon: MessageCircle, group: "primary" },
  { href: "/tasks", label: "Tasks", detail: "Scheduled, waiting on you", icon: ListChecks, group: "primary" },
  { href: "/you", label: "You", detail: "Everything else", icon: UserRound, group: "primary" },
];

/** Everything else lives on the You page and in the ⌘K palette. */
export const MORE: Destination[] = [
  { href: "/projects", label: "Projects", detail: "Grouped work and files", icon: Folder, group: "work" },
  { href: "/agent", label: "Coding workspace", detail: "Build and edit code", icon: Code2, group: "work" },
  { href: "/tasks?view=workbench", label: "Task workbench", detail: "Multi-step tasks and artifacts", icon: SquareKanban, group: "work" },
  { href: "/research", label: "Research", detail: "Deep web research", icon: Search, group: "work" },
  { href: "/files", label: "Library", detail: "Files, summaries, quizzes, flashcards", icon: LibraryBig, group: "work" },
  { href: "/browser", label: "Browser", detail: "Remote browser sessions", icon: Globe2, group: "work" },
  { href: "/studio", label: "Studio", detail: "Generate images", icon: Wand2, group: "work" },
  { href: "/automations", label: "Automations", detail: "Event-driven workflows", icon: Workflow, group: "work" },
  { href: "/skills", label: "Skills", detail: "What Elias knows how to do", icon: Sparkles, group: "you" },
  { href: "/memory", label: "Memory", detail: "What Elias remembers", icon: Brain, group: "you" },
  { href: "/connectors", label: "Connectors", detail: "Google, GitHub, Vercel and more", icon: Link2, group: "you" },
  { href: "/approvals", label: "Workbench approvals", detail: "Go-aheads for workbench tasks", icon: ShieldCheck, group: "you" },
  { href: "/profile", label: "Profile & settings", detail: "Account and preferences", icon: Settings2, group: "you" },
];
