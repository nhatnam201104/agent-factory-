import type { Critique } from "@factory-arena/protocol";

export class AdversarialEngine {
  public shouldContinueIterating(params: {
    currentRound: number;
    maxRounds: number;
    critiquesInRound: Critique[];
  }): { continueDebate: boolean; blockingFindingsCount: number } {
    const blockingFindingsCount = params.critiquesInRound.reduce(
      (acc, c) =>
        acc + c.findings.filter((f) => f.severity === "critical" || f.severity === "high").length,
      0,
    );

    if (params.currentRound >= params.maxRounds) {
      return { continueDebate: false, blockingFindingsCount };
    }

    return {
      continueDebate: blockingFindingsCount > 0,
      blockingFindingsCount,
    };
  }
}

export class RoundtableRouter {
  public selectNextSpeaker(params: {
    messageText: string;
    participantCodes: Array<{ id: string; code: string; slug: string; capabilities: string[] }>;
    lastSpeakerId?: string;
  }): string | null {
    for (const p of params.participantCodes) {
      if (params.messageText.includes(`@${p.code}`) || params.messageText.includes(`@${p.slug}`)) {
        return p.id;
      }
    }
    const candidates = params.participantCodes.filter((p) => p.id !== params.lastSpeakerId);
    return candidates[0]?.id ?? params.participantCodes[0]?.id ?? null;
  }
}
