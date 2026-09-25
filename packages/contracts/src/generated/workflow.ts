/* Generated from schemas/. Do not edit. */

/**
 * This interface was referenced by `PathsmithWorkflow01`'s JSON-Schema
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
 * This interface was referenced by `PathsmithWorkflow01`'s JSON-Schema
 * via the `definition` "node".
 */
export type Node =
  | {
      id: string;
      kind: "start";
      label: string;
    }
  | {
      id: string;
      kind: "judgment";
      label: string;
      binding: string;
      state: Expr;
      questions: {
        [k: string]: Question;
      };
    }
  | {
      id: string;
      kind: "transform";
      label: string;
      value: Expr;
    }
  | {
      id: string;
      kind: "branch";
      label: string;
      /**
       * @minItems 1
       */
      cases: [
        {
          id: string;
          when: Expr;
        },
        ...{
          id: string;
          when: Expr;
        }[]
      ];
    }
  | {
      id: string;
      kind: "output";
      label: string;
      outcomeId: string;
      value: Expr;
    };
/**
 * This interface was referenced by `PathsmithWorkflow01`'s JSON-Schema
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
/**
 * This interface was referenced by `PathsmithWorkflow01`'s JSON-Schema
 * via the `definition` "question".
 */
export type Question =
  | {
      kind: "choice";
      instructions: string;
      options: {
        [k: string]: string;
      };
    }
  | {
      kind: "score";
      instructions: string;
      /**
       * @minItems 2
       * @maxItems 10
       */
      levels:
        | [string, string]
        | [string, string, string]
        | [string, string, string, string]
        | [string, string, string, string, string]
        | [string, string, string, string, string, string]
        | [string, string, string, string, string, string, string]
        | [string, string, string, string, string, string, string, string]
        | [string, string, string, string, string, string, string, string, string]
        | [string, string, string, string, string, string, string, string, string, string];
    }
  | {
      kind: "binary";
      instructions: string;
      trueCriteria?: string;
      falseCriteria?: string;
    };

export interface PathsmithWorkflow01 {
  formatVersion: "0.1";
  id: string;
  name: string;
  description: string;
  bindings: string[];
  inputSchema: DataSchema;
  outputSchema: DataSchema;
  /**
   * @minItems 2
   * @maxItems 100
   */
  nodes: [Node, Node, ...Node[]];
  /**
   * @minItems 1
   * @maxItems 500
   */
  edges: [
    {
      id: string;
      source: string;
      port: string;
      target: string;
    },
    ...{
      id: string;
      source: string;
      port: string;
      target: string;
    }[]
  ];
}
/**
 * This interface was referenced by `PathsmithWorkflow01`'s JSON-Schema
 * via the `definition` "dataSchema".
 */
export interface DataSchema {
  type: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
  title?: string;
  description?: string;
  properties?: {
    [k: string]: DataSchema;
  };
  required?: string[];
  additionalProperties?: boolean;
  items?: DataSchema;
  /**
   * @minItems 1
   */
  enum?: [JsonValue, ...JsonValue[]];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
}
