export interface EmbeddingProvider {
  readonly dimensions: number;
  embed(text: string): Promise<readonly number[]>;
}

export interface VectorMatch {
  readonly id: string;
  readonly score: number;
}

export interface VectorIndex {
  upsert(id: string, vector: readonly number[]): void;
  search(vector: readonly number[], limit: number): readonly VectorMatch[];
  remove(id: string): void;
}

export class MemoryVectorIndex implements VectorIndex {
  readonly #dimensions: number;
  readonly #vectors = new Map<string, readonly number[]>();
  constructor(dimensions: number) {
    if (!Number.isInteger(dimensions) || dimensions <= 0)
      throw new Error("Vector dimensions must be a positive integer");
    this.#dimensions = dimensions;
  }
  upsert(id: string, vector: readonly number[]): void {
    this.#validate(vector);
    this.#vectors.set(id, [...vector]);
  }
  remove(id: string): void {
    this.#vectors.delete(id);
  }
  search(vector: readonly number[], limit: number): readonly VectorMatch[] {
    this.#validate(vector);
    if (!Number.isInteger(limit) || limit <= 0)
      throw new Error("Vector search limit must be a positive integer");
    return [...this.#vectors.entries()]
      .map(([id, candidate]) => ({ id, score: cosineSimilarity(vector, candidate) }))
      .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
      .slice(0, limit);
  }
  #validate(vector: readonly number[]): void {
    if (vector.length !== this.#dimensions || vector.some((value) => !Number.isFinite(value)))
      throw new Error("Vector does not match index dimensions");
  }
}

export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length || left.length === 0)
    throw new Error("Vectors must be non-empty and equal length");
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined || b === undefined) continue;
    dot += a * b;
    leftMagnitude += a * a;
    rightMagnitude += b * b;
  }
  return leftMagnitude === 0 || rightMagnitude === 0
    ? 0
    : dot / Math.sqrt(leftMagnitude * rightMagnitude);
}
