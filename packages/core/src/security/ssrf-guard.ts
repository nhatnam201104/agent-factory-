import { isIP } from "node:net";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.azure.com"
]);

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 127 || a === 10 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b === 100) return true;
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("fe80:")) return true;
  if (normalized.startsWith("::ffff:")) {
    const v4 = normalized.slice("::ffff:".length);
    if (isIP(v4) === 4) return isPrivateIPv4(v4);
  }
  return false;
}

export function assertSafeRemoteUrl(
  rawUrl: string,
  options: { allowLoopbackForLocalAgent?: boolean } = {}
): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Blocked unsafe URL scheme: ${parsed.protocol}`);
  }

  if (parsed.username || parsed.password) {
    throw new Error("URLs embedding userinfo credentials are prohibited");
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) {
    if (options.allowLoopbackForLocalAgent && host === "localhost") {
      return parsed;
    }
    throw new Error(`Blocked restricted host: ${host}`);
  }

  const ipKind = isIP(host);
  if (ipKind === 4 && isPrivateIPv4(host)) {
    if (options.allowLoopbackForLocalAgent && host.startsWith("127.")) {
      return parsed;
    }
    throw new Error(`Blocked private/loopback/metadata IPv4 address: ${host}`);
  }
  if (ipKind === 6 && isPrivateIPv6(host)) {
    if (options.allowLoopbackForLocalAgent && host === "::1") {
      return parsed;
    }
    throw new Error(`Blocked private/loopback/metadata IPv6 address: ${host}`);
  }

  return parsed;
}
