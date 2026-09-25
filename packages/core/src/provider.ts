import type { Answer, Json, Question } from "@pathsmith/contracts";
export interface EvaluationRequest {
  model: string;
  state: string | Json[] | Record<string, Json>;
  questions: Record<string, Question>;
}
export interface Usage {
  inputTokens: number;
  outputTokens: number;
}
export interface EvaluationResponse {
  model: string;
  answers: Record<string, Answer>;
  usage: Usage | null;
}
export interface ProviderContext {
  signal: AbortSignal;
  runId: string;
  scenarioId: string | null;
  nodeId: string;
  binding: string;
}
export interface JudgmentProvider {
  id: string;
  version: string;
  normalizerVersion: string;
  origin: "synthetic" | "live";
  evaluate(
    request: EvaluationRequest,
    context: ProviderContext,
  ): Promise<EvaluationResponse>;
}
export interface ProviderBinding {
  providerId: string;
  model: string;
  adapter: JudgmentProvider;
}
export type Bindings = Record<string, ProviderBinding>;
export interface Exchange {
  runId: string;
  scenarioId: string | null;
  nodeId: string;
  binding: string;
  providerId: string;
  adapterVersion: string;
  normalizerVersion: string;
  origin: "synthetic" | "live";
  fingerprint: string;
  request: EvaluationRequest;
  response: EvaluationResponse;
  elapsedMs: number;
  actualHttpAttempts: number;
}
