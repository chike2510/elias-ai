function assertFiniteOperands(a: number, b: number): void {
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    throw new TypeError("Operands must be finite numbers.");
  }
}

export function add(a: number, b: number): number {
  assertFiniteOperands(a, b);
  return a + b;
}

export function subtract(a: number, b: number): number {
  assertFiniteOperands(a, b);
  return a - b;
}

export function multiply(a: number, b: number): number {
  assertFiniteOperands(a, b);
  return a * b;
}

export function divide(a: number, b: number): number {
  assertFiniteOperands(a, b);
  if (b === 0) throw new RangeError("Cannot divide by zero.");
  return a / b;
}
