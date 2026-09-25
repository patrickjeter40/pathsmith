import type { Diagnostic, Json } from "./types.js";

export const forbiddenKeys = new Set(["__proto__", "prototype", "constructor"]);
export const pointerPart = (key: string | number) =>
  String(key).replace(/~/g, "~0").replace(/\//g, "~1");

// Count UTF-8 JSON without allocating the expanded representation. Lone UTF-16
// surrogates are escaped as six bytes by JSON.stringify.
function stringBytes(value: string, limit: number): number {
  let bytes = 2;
  for (let i = 0; i < value.length && bytes <= limit; i++) {
    const code = value.charCodeAt(i);
    if (code === 34 || code === 92) bytes += 2;
    else if (code < 32) bytes += [8, 9, 10, 12, 13].includes(code) ? 2 : 6;
    else if (code < 128) bytes++;
    else if (code < 2048) bytes += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      value.charCodeAt(i + 1) >= 0xdc00 &&
      value.charCodeAt(i + 1) <= 0xdfff
    ) {
      bytes += 4;
      i++;
    } else bytes += code >= 0xd800 && code <= 0xdfff ? 6 : 3;
  }
  return bytes;
}
interface Size {
  bytes: number;
  nodes: number;
  height: number;
}
function measure(
  value: unknown,
  maxBytes: number,
): { bytes: number; diagnostics: Diagnostic[] } {
  // Reports have an aggregate byte budget; their reader must not impose a
  // smaller element budget than the writer. Each JSON element costs >=1 byte.
  const maxNodes = maxBytes > 8 * 1024 * 1024 ? maxBytes : 500_000;
  const diagnostics: Diagnostic[] = [],
    ancestors = new Set<object>(),
    cache = new WeakMap<object, Size>();
  const fail = (message: string, pointer: string) => {
    if (!diagnostics.length)
      diagnostics.push({
        code: "UNSAFE_JSON",
        message,
        pointer,
        severity: "error",
      });
  };
  function visit(item: unknown, pointer: string, depth: number): Size {
    let size: Size = { bytes: 0, nodes: 1, height: 0 };
    if (diagnostics.length) return size;
    if (depth > 128) {
      fail("JSON nesting limit exceeded", pointer);
      return size;
    }
    if (item === null) size.bytes = 4;
    else if (typeof item === "boolean") size.bytes = item ? 4 : 5;
    else if (typeof item === "string") size.bytes = stringBytes(item, maxBytes);
    else if (typeof item === "number") {
      if (!Number.isFinite(item)) fail("Numbers must be finite", pointer);
      else size.bytes = JSON.stringify(item).length;
    } else if (typeof item !== "object")
      fail("Only JSON values are supported", pointer);
    else {
      if (ancestors.has(item)) {
        fail("Cyclic values are not JSON", pointer);
        return size;
      }
      const cached = cache.get(item);
      if (cached) {
        if (depth + cached.height > 128)
          fail("JSON nesting limit exceeded", pointer);
        return cached;
      }
      const array = Array.isArray(item);
      if (
        !array &&
        Object.getPrototypeOf(item) !== Object.prototype &&
        Object.getPrototypeOf(item) !== null
      ) {
        fail("Only plain JSON objects are supported", pointer);
        return size;
      }
      const keys = Object.keys(item);
      if (Object.getOwnPropertySymbols(item).length)
        fail("Symbol keys are not JSON", pointer);
      if (
        array &&
        (keys.length !== item.length ||
          keys.some(
            (k) => !/^(0|[1-9]\d*)$/.test(k) || Number(k) >= item.length,
          ))
      )
        fail("Sparse or extended arrays are not JSON", pointer);
      ancestors.add(item);
      size.bytes = 2;
      for (const [index, key] of keys.entries()) {
        if (diagnostics.length) break;
        const child = `${pointer}/${pointerPart(key)}`;
        if (forbiddenKeys.has(key)) {
          fail(`Unsafe object key: ${key}`, child);
          break;
        }
        const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
        if (!("value" in descriptor)) {
          fail("Accessors are not JSON", child);
          break;
        }
        const sub = visit(descriptor.value, child, depth + 1);
        size = {
          bytes:
            size.bytes +
            sub.bytes +
            (index ? 1 : 0) +
            (array ? 0 : stringBytes(key, maxBytes) + 1),
          nodes: size.nodes + sub.nodes,
          height: Math.max(size.height, sub.height + 1),
        };
        if (size.bytes > maxBytes || size.nodes > maxNodes) {
          fail(
            size.bytes > maxBytes
              ? `JSON exceeds ${maxBytes} bytes`
              : "JSON element limit exceeded",
            pointer,
          );
          break;
        }
      }
      ancestors.delete(item);
      if (!diagnostics.length) cache.set(item, size);
    }
    if (size.bytes > maxBytes) fail(`JSON exceeds ${maxBytes} bytes`, pointer);
    return size;
  }
  const size = visit(value, "", 0);
  return { bytes: diagnostics.length ? Infinity : size.bytes, diagnostics };
}

/** Invalid or over-budget values measure as Infinity without expanded serialization. */
export const byteLength = (value: unknown, maxBytes = 64 * 1024 * 1024) =>
  measure(value, maxBytes).bytes;
export const inspectJson = (
  value: unknown,
  maxBytes = 8 * 1024 * 1024,
): Diagnostic[] => measure(value, maxBytes).diagnostics;

export function parseJson(text: string, maxBytes = 8 * 1024 * 1024): Json {
  if (
    text.length > maxBytes ||
    new TextEncoder().encode(text).length > maxBytes
  )
    throw new Error(`JSON exceeds ${maxBytes} bytes`);
  const value: unknown = JSON.parse(text),
    issues = inspectJson(value, maxBytes);
  if (issues.length)
    throw new Error(issues.map((d) => `${d.pointer}: ${d.message}`).join("; "));
  return value as Json;
}
