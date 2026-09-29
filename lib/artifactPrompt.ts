import { requestedArtifactNames } from "@/lib/taskArtifactRequirements";

const CALCULATOR_SOURCE_NAME = /^calculator(?:[-_][a-z0-9]+)*\.(?:js|ts)$/i;
const CALCULATOR_GUIDE_NAME = /^calculator(?:[-_][a-z0-9]+)*\.(?:pdf|docx|md|txt)$/i;

export function calculatorArtifactConsistencyPrompt(task: string) {
  const names = requestedArtifactNames(task);
  const hasCalculatorSource = names.some((name) => CALCULATOR_SOURCE_NAME.test(name));
  const hasCalculatorGuide = names.some((name) => CALCULATOR_GUIDE_NAME.test(name));

  if (!hasCalculatorSource || !hasCalculatorGuide) return "";

  return [
    "CALCULATOR ARTIFACT CONSISTENCY CONTRACT:",
    "- Treat each operand as valid only when it is a primitive finite JavaScript number. Every requested arithmetic operation must reject non-number values, NaN, Infinity, and -Infinity with a TypeError before computing; implement this with Number.isFinite checks.",
    "- If division is requested, validate both operands first, then reject a denominator of 0 or -0 with a RangeError.",
    "- Keep the requested JavaScript and TypeScript operations, operand checks, validation order, and error classes identical. The guide must describe the same runtime behavior and must not claim a check or result guarantee that the source files do not implement.",
    "- Distinguish input validation from result validation: finite operands do not guarantee a finite computed result, and do not claim arithmetic overflow is rejected unless both source files explicitly check it.",
  ].join("\n");
}
