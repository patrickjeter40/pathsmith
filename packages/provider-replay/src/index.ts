import {
  canonicalize,
  immutable,
  PathsmithError,
  requestFingerprint,
  validateResponse,
  validUsage,
  type Bindings,
  type Exchange,
} from "@pathsmith/core";

/** Structural subset of a saved RunReport; no evaluation or storage dependency. */
export interface ReplaySource {
  formatVersion: "0.1";
  artifactType: "pathsmith_run";
  id: string;
  origin: "synthetic" | "live";
  profile: { bindings: Record<string, { providerId: string; model: string }> };
  adapters: Record<
    string,
    {
      providerId: string;
      adapterVersion: string;
      normalizerVersion: string;
      requestedModel: string;
      resolvedModels: string[];
    }
  >;
  scenarios: { scenarioId: string; exchanges: Exchange[] }[];
}

/** An isolated immutable lookup. It has no transport and cannot dispatch live work. */
export function createReplayBindings(value: ReplaySource): Bindings {
  try {
    // Reject unsafe keys/non-JSON and oversized artifacts before copying them.
    canonicalize(value);
    if (
      value.formatVersion !== "0.1" ||
      value.artifactType !== "pathsmith_run" ||
      typeof value.id !== "string" ||
      !value.id.trim() ||
      !["synthetic", "live"].includes(value.origin) ||
      !value.profile?.bindings ||
      !value.adapters ||
      !Array.isArray(value.scenarios)
    )
      throw new Error("Invalid source envelope");
    const source = immutable(value);
    const entries = new Map<string, Exchange>();
    const ids = new Set<string>();
    for (const scenario of source.scenarios) {
      if (
        typeof scenario.scenarioId !== "string" ||
        ids.has(scenario.scenarioId) ||
        !Array.isArray(scenario.exchanges)
      )
        throw new Error("Duplicate or invalid scenario");
      ids.add(scenario.scenarioId);
      for (const exchange of scenario.exchanges) {
        const identity = source.adapters[exchange.binding];
        const profile = source.profile.bindings[exchange.binding];
        if (
          !identity ||
          !profile ||
          exchange.runId !== source.id ||
          exchange.scenarioId !== scenario.scenarioId ||
          typeof exchange.nodeId !== "string" ||
          !exchange.nodeId ||
          exchange.providerId !== identity.providerId ||
          exchange.providerId !== profile.providerId ||
          exchange.adapterVersion !== identity.adapterVersion ||
          exchange.normalizerVersion !== identity.normalizerVersion ||
          exchange.origin !== source.origin ||
          exchange.request.model !== profile.model ||
          exchange.request.model !== identity.requestedModel ||
          !identity.resolvedModels.includes(exchange.response.model) ||
          exchange.fingerprint !==
            requestFingerprint(
              {
                providerId: exchange.providerId,
                adapterVersion: exchange.adapterVersion,
                normalizerVersion: exchange.normalizerVersion,
              },
              exchange.request,
            )
        )
          throw new Error("Inconsistent exchange provenance");
        validateResponse(exchange.request, exchange.response, 512 * 1024);
        if (
          !Number.isSafeInteger(exchange.actualHttpAttempts) ||
          exchange.actualHttpAttempts < 0 ||
          exchange.actualHttpAttempts > 3 ||
          (Object.hasOwn(exchange, "usage") && !validUsage(exchange.usage)) ||
          (Object.hasOwn(exchange, "historicalUsage") &&
            !validUsage(exchange.historicalUsage))
        )
          throw new Error("Invalid historical call accounting");
        const key = scope(
          scenario.scenarioId,
          exchange.nodeId,
          exchange.binding,
        );
        if (entries.has(key)) throw new Error("Duplicate exchange scope");
        entries.set(key, exchange);
      }
    }
    if (
      canonicalize(Object.keys(source.profile.bindings).sort()) !==
      canonicalize(Object.keys(source.adapters).sort())
    )
      throw new Error("Incomplete adapter provenance");
    return Object.fromEntries(
      Object.entries(source.profile.bindings).map(([binding, profile]) => {
        const identity = source.adapters[binding];
        if (
          profile.providerId !== identity.providerId ||
          profile.model !== identity.requestedModel ||
          ![
            identity.providerId,
            identity.adapterVersion,
            identity.normalizerVersion,
            profile.model,
          ].every((v) => typeof v === "string" && v.trim())
        )
          throw new Error("Invalid adapter provenance");
        return [
          binding,
          {
            ...profile,
            adapter: {
              id: identity.providerId,
              version: identity.adapterVersion,
              normalizerVersion: identity.normalizerVersion,
              origin: source.origin,
              replay: { sourceRunId: source.id },
              async evaluate(request, context) {
                if (context.signal.aborted)
                  throw new PathsmithError(
                    "RUN_CANCELED",
                    "Replay was canceled",
                  );
                const entry = entries.get(
                  scope(context.scenarioId, context.nodeId, context.binding),
                );
                if (!entry)
                  throw new PathsmithError(
                    "REPLAY_MISS",
                    `Source run ${source.id} has no recorded judgment for scenario ${context.scenarioId ?? "(none)"}, node ${context.nodeId}, binding ${context.binding}`,
                  );
                const fingerprint = requestFingerprint(
                  {
                    providerId: identity.providerId,
                    adapterVersion: identity.adapterVersion,
                    normalizerVersion: identity.normalizerVersion,
                  },
                  request,
                );
                if (
                  context.binding !== binding ||
                  context.sourceRunId !== source.id ||
                  entry.fingerprint !== fingerprint ||
                  context.requestFingerprint !== fingerprint
                )
                  throw new PathsmithError(
                    "REPLAY_MISS",
                    `Source run ${source.id}: request model, state, questions, or provider configuration differs at node ${context.nodeId}`,
                  );
                return structuredClone({
                  ...entry.response,
                  historicalUsage: Object.hasOwn(entry, "historicalUsage")
                    ? entry.historicalUsage
                    : Object.hasOwn(entry, "usage")
                      ? entry.usage
                      : entry.response.usage,
                });
              },
            },
          },
        ];
      }),
    );
  } catch (error) {
    if (
      error instanceof PathsmithError &&
      error.code === "REPLAY_SOURCE_INVALID"
    )
      throw error;
    throw new PathsmithError(
      "REPLAY_SOURCE_INVALID",
      "Source is not a valid run recording with consistent exchange provenance",
    );
  }
}
function scope(
  scenarioId: string | null,
  nodeId: string,
  binding: string,
): string {
  return JSON.stringify([scenarioId, nodeId, binding]);
}
