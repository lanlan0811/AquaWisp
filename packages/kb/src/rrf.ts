export interface RankedCandidate<T> {
  readonly id: string;
  readonly value: T;
}

export interface RrfSource<T> {
  readonly weight: number;
  readonly candidates: readonly RankedCandidate<T>[];
}

export interface RrfOptions {
  readonly rankConstant: number;
  readonly limit: number;
}

export interface RrfResult<T> extends RankedCandidate<T> {
  readonly score: number;
}

export function reciprocalRankFusion<T>(
  sources: readonly RrfSource<T>[],
  options: RrfOptions,
): readonly RrfResult<T>[] {
  if (!Number.isInteger(options.rankConstant) || options.rankConstant <= 0) {
    throw new Error("RRF rankConstant must be a positive integer");
  }
  if (!Number.isInteger(options.limit) || options.limit <= 0) {
    throw new Error("RRF limit must be a positive integer");
  }
  const merged = new Map<string, RrfResult<T>>();
  for (const source of sources) {
    if (!Number.isFinite(source.weight) || source.weight <= 0) {
      throw new Error("RRF source weights must be positive");
    }
    for (const [index, candidate] of source.candidates.entries()) {
      const score = source.weight / (options.rankConstant + index + 1);
      const existing = merged.get(candidate.id);
      merged.set(candidate.id, {
        id: candidate.id,
        value: existing?.value ?? candidate.value,
        score: (existing?.score ?? 0) + score,
      });
    }
  }
  return [...merged.values()]
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, options.limit);
}
