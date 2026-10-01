export function resolveWebHost(requestedHost, inDockerContainer) {
  const host = requestedHost ?? "127.0.0.1";
  if (host === "127.0.0.1") return host;
  if (host === "0.0.0.0" && inDockerContainer) return host;
  throw new Error(
    "PATHSMITH_WEB_HOST must be 127.0.0.1 on the host; 0.0.0.0 is only allowed inside Docker",
  );
}
