/* Generated from schemas/. Do not edit. */

/**
 * This interface was referenced by `PathsmithScenarioSuite01`'s JSON-Schema
 * via the `definition` "jsonValue".
 */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | {
      [k: string]: JsonValue;
    };
/**
 * This interface was referenced by `PathsmithScenarioSuite01`'s JSON-Schema
 * via the `definition` "expr".
 */
export type Expr =
  | {
      op: "literal";
      value: JsonValue;
    }
  | {
      op: "ref";
      /**
       * @minItems 1
       */
      path: [string | number, ...(string | number)[]];
    }
  | {
      op: "object";
      fields: {
        [k: string]: Expr;
      };
    }
  | {
      op: "array";
      items: Expr[];
    }
  | {
      op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "add" | "sub" | "mul" | "div" | "in";
      left: Expr;
      right: Expr;
    }
  | {
      op: "and" | "or" | "coalesce";
      /**
       * @minItems 1
       */
      args: [Expr, ...Expr[]];
    }
  | {
      op: "not" | "exists";
      value: Expr;
    };

export interface PathsmithScenarioSuite01 {
  formatVersion: "0.1";
  id: string;
  name: string;
  description: string;
  /**
   * @minItems 1
   * @maxItems 10000
   */
  scenarios: [
    {
      id: string;
      name: string;
      tags: string[];
      input: JsonValue;
      expected?: {
        /**
         * @minItems 1
         */
        allowedOutcomes?: [string, ...string[]];
        requiredNodes?: string[];
        forbiddenNodes?: string[];
        assertions?: Expr[];
      };
      referenceLabel?: {
        value: string | null;
        source: "generated" | "human" | "unknown";
        review: "provisional" | "reviewed";
      };
    },
    ...{
      id: string;
      name: string;
      tags: string[];
      input: JsonValue;
      expected?: {
        /**
         * @minItems 1
         */
        allowedOutcomes?: [string, ...string[]];
        requiredNodes?: string[];
        forbiddenNodes?: string[];
        assertions?: Expr[];
      };
      referenceLabel?: {
        value: string | null;
        source: "generated" | "human" | "unknown";
        review: "provisional" | "reviewed";
      };
    }[]
  ];
  classification?: {
    nodeId: string;
    questionId: string;
    positiveLabel: string;
    negativeLabel: string;
  };
}
