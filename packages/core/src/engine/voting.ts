import type { Vote } from "@factory-arena/protocol";

export interface VoteTallyResult {
  scoresByAlias: Record<string, number>;
  firstPlaceVotes: Record<string, number>;
  winnerAlias: string | null;
  tiedAliases: string[];
  isTie: boolean;
  resolutionMethod: "supermajority" | "ranked_choice" | "tie_pending";
}

export class WeightedVotingResolver {
  public tally(votes: Vote[], candidateAliases: string[]): VoteTallyResult {
    const scoresByAlias: Record<string, number> = {};
    const firstPlaceVotes: Record<string, number> = {};
    for (const alias of candidateAliases) {
      scoresByAlias[alias] = 0;
      firstPlaceVotes[alias] = 0;
    }

    const n = Math.max(candidateAliases.length, 1);
    for (const vote of votes) {
      const weight = Math.max(0.2, vote.confidence);
      vote.ranked_aliases.forEach((alias, idx) => {
        if (!(alias in scoresByAlias)) {
          scoresByAlias[alias] = 0;
          firstPlaceVotes[alias] = 0;
        }
        const bordaPoints = Math.max(1, n - idx);
        scoresByAlias[alias] = Number((scoresByAlias[alias] + bordaPoints * weight).toFixed(4));
        if (idx === 0) {
          firstPlaceVotes[alias] += 1;
        }
      });
    }

    const sorted = Object.entries(scoresByAlias).sort((a, b) => b[1] - a[1]);
    if (sorted.length === 0 || votes.length === 0) {
      return {
        scoresByAlias,
        firstPlaceVotes,
        winnerAlias: null,
        tiedAliases: [],
        isTie: false,
        resolutionMethod: "tie_pending",
      };
    }

    const topScore = sorted[0][1];
    const tiedAliases = sorted
      .filter(([, s]) => Math.abs(s - topScore) < 1e-6)
      .map(([alias]) => alias);

    if (tiedAliases.length > 1) {
      return {
        scoresByAlias,
        firstPlaceVotes,
        winnerAlias: null,
        tiedAliases,
        isTie: true,
        resolutionMethod: "tie_pending",
      };
    }

    const winnerAlias = sorted[0][0];
    const firstShare = (firstPlaceVotes[winnerAlias] ?? 0) / votes.length;
    return {
      scoresByAlias,
      firstPlaceVotes,
      winnerAlias,
      tiedAliases: [winnerAlias],
      isTie: false,
      resolutionMethod: firstShare >= 0.67 ? "supermajority" : "ranked_choice",
    };
  }
}
