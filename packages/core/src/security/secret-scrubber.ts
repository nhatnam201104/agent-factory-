const TOKEN_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g,
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bAIza[0-9A-Za-z_-]{25,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}\b/gi,
];

export class SecretScrubber {
  private readonly knownSecrets = new Set<string>();

  public registerSecret(secret: string): void {
    const trimmed = secret.trim();
    if (trimmed.length >= 6) {
      this.knownSecrets.add(trimmed);
    }
  }

  public scrubText(input: string): string {
    let out = input;
    for (const secret of this.knownSecrets) {
      if (out.includes(secret)) {
        out = out.split(secret).join("[REDACTED_SECRET]");
      }
    }
    for (const regex of TOKEN_PATTERNS) {
      out = out.replace(regex, "[REDACTED_TOKEN]");
    }
    return out;
  }

  public scrubUnknown<T>(value: T): T {
    if (typeof value === "string") {
      return this.scrubText(value) as unknown as T;
    }
    if (Array.isArray(value)) {
      return value.map((v) => this.scrubUnknown(v)) as unknown as T;
    }
    if (value !== null && typeof value === "object") {
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (k === "raw_secret" || k === "encrypted_secret") {
          cleaned[k] = "[REDACTED_SECRET]";
        } else {
          cleaned[k] = this.scrubUnknown(v);
        }
      }
      return cleaned as T;
    }
    return value;
  }
}
