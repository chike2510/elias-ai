const DELIVERABLE_EXTENSIONS = "pdf|docx|pptx|md|txt|html|css|jsx|tsx|js|ts|json|csv|xlsx|yml|yaml|toml|xml|svg|py|rb|go|rs|java|kt|swift|php|sql|sh|bash|zsh";
const CODE_EXTENSIONS = "js|jsx|ts|tsx|py|rb|go|rs|java|kt|swift|php|sql|sh";

export function requestedArtifactNames(objective: string) {
  const pattern = new RegExp(`(?<![\\w.-])([A-Za-z0-9][A-Za-z0-9_.-]*\\.(?:${DELIVERABLE_EXTENSIONS}))\\b`, "gi");
  const names: string[] = [];
  const seen = new Set<string>();
  for (const match of objective.matchAll(pattern)) {
    const name = match[1];
    const key = name;
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

export function missingArtifactNames(required: string[], artifacts: Array<{ name: string }>) {
  const available = new Set(artifacts.map((artifact) => artifact.name.trim()));
  return required.filter((name) => !available.has(name.trim()));
}

export function includesCodeArtifactFile(objective: string) {
  const pattern = new RegExp(`(?<![\\w.-])[A-Za-z0-9][A-Za-z0-9_.-]*\\.(?:${CODE_EXTENSIONS})\\b`, "i");
  return pattern.test(objective);
}
