export type BrowserSessionStatus = "starting" | "active" | "paused" | "waiting_for_user" | "closed" | "failed";
export type BrowserActionType = "open" | "extract" | "screenshot" | "pause" | "close";
export type BrowserAction =
  | { type: "open"; url: string }
  | { type: "extract"; selector?: string }
  | { type: "screenshot" }
  | { type: "pause" }
  | { type: "close" };

export type BrowserSession = {
  id: string;
  taskId: string;
  status: BrowserSessionStatus;
  currentUrl?: string;
  title?: string;
  extractedText?: string;
  createdAt: number;
  updatedAt: number;
  lastError?: string;
};

export type BrowserActionResult = {
  session: BrowserSession;
  summary: string;
  content?: string;
  sourceUrls?: string[];
};
