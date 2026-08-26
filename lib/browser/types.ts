export type BrowserSessionStatus = "starting" | "active" | "paused" | "waiting_for_user" | "closed" | "failed";
export type BrowserActionType = "open" | "navigate" | "click" | "type" | "scroll" | "screenshot" | "extract" | "pause" | "close";
export type BrowserActionPayload = { url?: string; selector?: string; text?: string; direction?: "up" | "down"; amount?: number; fileName?: string };
export type BrowserAction = { type: BrowserActionType; selector?: string; text?: string; url?: string; direction?: "up" | "down"; amount?: number; fileName?: string };
export type BrowserActionRequest = BrowserAction & { id: string; status: "queued" | "running" | "completed" | "failed"; requiresApproval: boolean; approvalId?: string; createdAt: number; updatedAt: number; result?: string; error?: string };
export type BrowserObservation = { id: string; kind: "page" | "screenshot" | "action" | "error"; url?: string; title?: string; text?: string; imageDataUrl?: string; actionId?: string; createdAt: number };

export type BrowserSession = {
  id: string;
  taskId: string;
  ownerId?: string;
  status: BrowserSessionStatus;
  currentUrl?: string;
  title?: string;
  extractedText?: string;
  createdAt: number;
  updatedAt: number;
  lastError?: string;
  pendingActions: BrowserActionRequest[];
  observations: BrowserObservation[];
};

export type BrowserActionResult = {
  session: BrowserSession;
  summary: string;
  content?: string;
  sourceUrls?: string[];
  action?: BrowserActionRequest;
};
