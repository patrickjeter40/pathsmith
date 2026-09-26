import { HttpException } from "@nestjs/common";
import { inspectJson, type Json } from "@pathsmith/contracts";

export function badRequest(message: string): never {
  throw new HttpException({ error: { code: "BAD_REQUEST", message } }, 400);
}
export function envelope(
  value: unknown,
  keys: string[],
  required: string[] = [],
): Record<string, Json> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    inspectJson(value, 9 * 1024 * 1024).length
  )
    badRequest("Expected a safe JSON object");
  const body = value as Record<string, Json>;
  if (
    Object.keys(body).some((key) => !keys.includes(key)) ||
    required.some((key) => !Object.hasOwn(body, key))
  )
    badRequest("Missing or unsupported request fields");
  return body;
}
export function identifier(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value))
    badRequest("Expected an opaque identifier");
  return value;
}
export function textValue(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 200)
    badRequest("Name must contain 1–200 characters");
  return value;
}
export function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    badRequest("Expected a positive draft revision");
  return value as number;
}
export function selection(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.length || value.length > 1000)
    badRequest("Select 1–1,000 scenario IDs");
  return value.map(identifier);
}
export function pagination(
  query: Record<string, unknown>,
  extra: string[] = [],
): { offset: number; limit: number } {
  if (
    Object.keys(query).some(
      (key) => !["offset", "limit", ...extra].includes(key),
    )
  )
    badRequest("Unsupported query fields");
  function number(key: string, defaultValue: number): number {
    const value = query[key];
    if (value === undefined) return defaultValue;
    if (typeof value !== "string" || !/^\d+$/.test(value))
      badRequest("Invalid pagination");
    return Number(value);
  }
  const offset = number("offset", 0),
    limit = number("limit", 50);
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    badRequest("Invalid pagination");
  return { offset, limit };
}
export function confirmed(value: unknown): void {
  const body = envelope(value, ["confirm"], ["confirm"]);
  if (body.confirm !== true) badRequest("Explicit confirmation is required");
}
