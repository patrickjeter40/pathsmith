/* Generated from schemas/. Do not edit. */

/**
 * This interface was referenced by `PathsmithExactRequestMockFixtures01`'s JSON-Schema
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
 * This interface was referenced by `PathsmithExactRequestMockFixtures01`'s JSON-Schema
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
/**
 * This interface was referenced by `PathsmithExactRequestMockFixtures01`'s JSON-Schema
 * via the `definition` "answer".
 */
export type Answer =
  | {
      kind: "choice";
      value: string;
      probabilities: {
        [k: string]: number;
      };
      confidence: number;
    }
  | {
      kind: "score";
      value: number;
      probabilities: {
        [k: string]: number;
      };
      confidence: number;
    }
  | {
      kind: "binary";
      probabilityTrue: number;
    };

export interface PathsmithExactRequestMockFixtures01 {
  formatVersion: "0.1";
  origin: "synthetic";
  description: string;
  entries: {
    scenarioId: string;
    nodeId: string;
    binding: string;
    request: {
      providerId: "mock";
      model: "mock-v1";
      state: JsonValue;
      questions: {
        [k: string]: Question;
      };
    };
    response: {
      model: "mock-v1";
      answers: {
        [k: string]: Answer;
      };
      usage: null;
    };
  }[];
}
