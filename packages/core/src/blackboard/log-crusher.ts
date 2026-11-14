const NOISE_PATTERNS = [
  /^npm warn /i,
  /^Progress:\s+resolved\s+\d+/i,
  /^Downloading\s+\S+/i,
  /^\s*✓\s+\d+\s+modules transformed/i,
  /^\s*\.\.\.\s*\d+\s+more lines/i,
];

export class LogCrusher {
  public crush(
    rawText: string,
    maxLines = 60,
  ): {
    compressed: string;
    originalBytes: number;
    compressedBytes: number;
  } {
    const originalBytes = Buffer.byteLength(rawText, "utf8");
    const lines = rawText.split(/\r?\n/);

    const kept: string[] = [];
    let skippedCount = 0;

    for (const line of lines) {
      const isSignal = /(error|fail|exception|assert|warn|traceback|at\s+\S+:\d+)/i.test(line);
      const isNoise = !isSignal && NOISE_PATTERNS.some((rx) => rx.test(line));
      if (isNoise || (line.trim() === "" && kept[kept.length - 1] === "")) {
        skippedCount++;
        continue;
      }
      kept.push(line);
    }

    let finalLines = kept;
    if (kept.length > maxLines) {
      const head = kept.slice(0, Math.floor(maxLines / 2));
      const tail = kept.slice(-Math.ceil(maxLines / 2));
      skippedCount += kept.length - (head.length + tail.length);
      finalLines = [
        ...head,
        `... [LogCrusher omitted ${skippedCount} noisy/intermediate lines] ...`,
        ...tail,
      ];
    } else if (skippedCount > 0) {
      finalLines.push(`[LogCrusher filtered ${skippedCount} noise lines]`);
    }

    const compressed = finalLines.join("\n");
    return {
      compressed,
      originalBytes,
      compressedBytes: Buffer.byteLength(compressed, "utf8"),
    };
  }
}
