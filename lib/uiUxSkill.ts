export const UI_UX_SKILL_ID = "ui-ux-engineering";

export type UiUxAssetRole = "hero-background" | "functional-surface" | "decorative-texture" | "empty-state-art" | "illustration";

export type UiUxAssetMetadata = {
  id: string;
  name: string;
  role: UiUxAssetRole;
  mood: string[];
  palette: string[];
  contrast: "light-overlay-required" | "dark-overlay-required" | "neutral";
  safeAreas: string[];
  recommendedSurfaces: string[];
  avoidFor: string[];
  license: "user-owned" | "generated" | "verified-source";
  sourceUrl?: string;
};

export const UI_UX_ASSET_LIBRARY: UiUxAssetMetadata[] = [];

export const UI_UX_EVALUATION_RUBRIC = [
  { id: "hierarchy", label: "Clear hierarchy and task focus", weight: 20 },
  { id: "responsive", label: "Responsive mobile composition", weight: 15 },
  { id: "spacing", label: "Spacing and alignment consistency", weight: 15 },
  { id: "typography", label: "Typography and readability", weight: 15 },
  { id: "accessibility", label: "Contrast and accessibility", weight: 15 },
  { id: "states", label: "Complete interaction states", weight: 10 },
  { id: "distinctiveness", label: "Distinctive and appropriate visual direction", weight: 10 },
] as const;

const UI_UX_TERMS = /ui|ux|interface|frontend|front-end|design system|dashboard|landing page|workspace|mobile app|web app|component|layout|visual|styling|typography|background|hero section|responsive|accessibility|redesign|screen|page design|design review/i;

export function isUiUxRequest(query: string) {
  return UI_UX_TERMS.test(query);
}

export function uiUxSystemInstruction(query: string) {
  return `[UI/UX ENGINEERING SKILL ENABLED]\nRequest: ${query}\n\nAct as Elias's UI/UX Engineering specialist. Before proposing implementation, form a concise UI Design Brief covering product context, primary user job, visual mood, visual focal point, background strategy, color roles, typography hierarchy, spacing rhythm, surface treatment, interaction states, mobile behavior, accessibility risks, and acceptance criteria.\n\nImplement with the existing repository's framework and design system. Inspect existing routes, components, tokens, typography, breakpoints, and state models before changing architecture. Prefer reusable tokens and components over isolated styling. Treat backgrounds as intentional assets: use them only when they support hierarchy, preserve readable contrast with overlays, and avoid decorative imagery behind dense forms, tables, code, or agent output.\n\nCover loading, empty, error, disabled, focus, upload-progress, approval, success, and failure states. For any visual asset, record its role, palette, contrast requirement, safe text area, recommended surfaces, avoid-for surfaces, and license/source.\n\nAfter implementation, review the result against this rubric: hierarchy 20%, responsive mobile composition 15%, spacing/alignment 15%, typography/readability 15%, contrast/accessibility 15%, interaction states 10%, visual distinctiveness 10%. Report concrete issues and make a second refinement pass before claiming completion. Never claim a screenshot, asset, or visual test exists unless it was actually produced.\n\nSeparate design decisions from sourced facts, preserve existing behavior, and request confirmation before repository writes or external side effects.`;
}

export function uiUxSelectedSkills(query: string, enabledSkills: string[] = []) {
  return isUiUxRequest(query) ? [...new Set([...enabledSkills, UI_UX_SKILL_ID])] : enabledSkills;
}
