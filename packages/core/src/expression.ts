import { forbiddenKeys, type Expr, type Json } from "@pathsmith/contracts";
import { PathsmithError } from "./error.js";

export const Missing = Symbol("Missing");
type Value = Json | typeof Missing;
export interface ExpressionStep {
  op: string;
  path?: (string | number)[];
  operands?: Json[];
  value?: Json;
  missing?: boolean;
}
export interface ExpressionBudget {
  remaining: number;
}
export function evaluateExpression(
  expression: Expr,
  context: Record<string, Json>,
  options: {
    budget?: ExpressionBudget;
    onStep?: (step: ExpressionStep) => void;
  } = {},
): Json {
  const budget = options.budget ?? { remaining: 10_000 };
  const typeError = (message: string): never => {
    throw new PathsmithError("EXPRESSION_TYPE_ERROR", message);
  };
  const present = (value: Value): Json => {
    if (value === Missing)
      throw new PathsmithError(
        "EXPRESSION_MISSING_VALUE",
        "An expression referenced missing data",
      );
    return value;
  };
  const boolean = (value: Value): boolean => {
    const v = present(value);
    return typeof v === "boolean" ? v : typeError("Boolean operand required");
  };
  const number = (value: Value): number => {
    const v = present(value);
    return typeof v === "number" && Number.isFinite(v)
      ? v
      : typeError("Finite numeric operand required");
  };
  const scalar = (value: Value): null | boolean | number | string => {
    const v = present(value);
    return v === null ||
      typeof v === "boolean" ||
      typeof v === "number" ||
      typeof v === "string"
      ? v
      : typeError("Scalar operand required");
  };
  const record = (expr: Expr, value: Value, operands?: Json[]): Value => {
    options.onStep?.({
      op: expr.op,
      ...(expr.op === "ref" ? { path: expr.path } : {}),
      ...(operands ? { operands } : {}),
      ...(value === Missing ? { missing: true } : { value }),
    });
    return value;
  };
  function evaluate(expr: Expr, depth = 1): Value {
    if (--budget.remaining < 0 || depth > 16)
      throw new PathsmithError(
        "RUN_LIMIT_EXCEEDED",
        "Expression operation or depth budget exceeded",
      );
    const run = (child: Expr) => evaluate(child, depth + 1);
    let value: Value;
    if (expr.op === "literal") value = expr.value;
    else if (expr.op === "ref") {
      let current: unknown = context;
      for (const segment of expr.path) {
        if (typeof segment === "string" && forbiddenKeys.has(segment))
          typeError("Unsafe reference key");
        if (
          !current ||
          typeof current !== "object" ||
          (Array.isArray(current)
            ? typeof segment !== "number" ||
              !Number.isSafeInteger(segment) ||
              segment < 0
            : typeof segment !== "string") ||
          !Object.hasOwn(current, segment)
        ) {
          current = Missing;
          break;
        }
        current = (current as Record<string | number, unknown>)[segment];
      }
      value = current as Value;
    } else if (expr.op === "object") {
      const fields: Record<string, Json> = {};
      for (const [key, child] of Object.entries(expr.fields)) {
        if (forbiddenKeys.has(key)) typeError("Unsafe object key");
        fields[key] = present(run(child));
      }
      value = fields;
    } else if (expr.op === "array")
      value = expr.items.map((e) => present(run(e)));
    else if ("args" in expr) {
      if (!expr.args.length) typeError("At least one operand is required");
      if (expr.op === "coalesce") {
        value = null;
        for (const arg of expr.args) {
          const v = run(arg);
          if (v !== Missing && v !== null) {
            value = v;
            break;
          }
        }
      } else {
        value = expr.op === "and";
        for (const arg of expr.args) {
          const v = boolean(run(arg));
          if ((expr.op === "and" && !v) || (expr.op === "or" && v)) {
            value = v;
            break;
          }
        }
      }
    } else if (expr.op === "not") value = !boolean(run(expr.value));
    else if (expr.op === "exists") value = run(expr.value) !== Missing;
    else if ("left" in expr) {
      const left = present(run(expr.left)),
        right = present(run(expr.right));
      switch (expr.op) {
        case "eq":
          value = scalar(left) === scalar(right);
          break;
        case "ne":
          value = scalar(left) !== scalar(right);
          break;
        case "in": {
          const item = scalar(left);
          if (!Array.isArray(right)) typeError("Membership requires an array");
          value = (right as Json[])
            .map((v) => scalar(v))
            .some((v) => v === item);
          break;
        }
        case "gt":
          value = number(left) > number(right);
          break;
        case "gte":
          value = number(left) >= number(right);
          break;
        case "lt":
          value = number(left) < number(right);
          break;
        case "lte":
          value = number(left) <= number(right);
          break;
        case "add":
          value = number(left) + number(right);
          break;
        case "sub":
          value = number(left) - number(right);
          break;
        case "mul":
          value = number(left) * number(right);
          break;
        case "div":
          if (number(right) === 0) typeError("Division by zero");
          value = number(left) / number(right);
          break;
        default:
          return typeError("Unsupported operator");
      }
      if (typeof value === "number" && !Number.isFinite(value))
        typeError("Arithmetic produced a non-finite result");
      return record(expr, value, [left, right]);
    } else return typeError("Unsupported expression");
    return record(expr, value);
  }
  return present(evaluate(expression));
}
