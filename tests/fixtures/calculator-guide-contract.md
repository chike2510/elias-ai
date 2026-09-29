# Calculator validation

All calculator functions accept only primitive finite JavaScript numbers. Passing a string, `NaN`, `Infinity`, or `-Infinity` as either operand throws a `TypeError` before calculation. For division, a denominator of `0` or `-0` throws a `RangeError` after operand validation. The JavaScript and TypeScript files apply the same checks and error types.

Finite inputs do not guarantee a finite computed result: arithmetic overflow is not separately rejected.
