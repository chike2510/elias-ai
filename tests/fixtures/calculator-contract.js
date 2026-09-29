function assertFiniteOperands(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    throw new TypeError("Operands must be finite numbers.");
  }
}

function add(a, b) {
  assertFiniteOperands(a, b);
  return a + b;
}

function subtract(a, b) {
  assertFiniteOperands(a, b);
  return a - b;
}

function multiply(a, b) {
  assertFiniteOperands(a, b);
  return a * b;
}

function divide(a, b) {
  assertFiniteOperands(a, b);
  if (b === 0) throw new RangeError("Cannot divide by zero.");
  return a / b;
}

module.exports = { add, subtract, multiply, divide };
