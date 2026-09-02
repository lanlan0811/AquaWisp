import type {
  HybridKnowledgeIndex,
  HybridSearchRequest,
  HybridSearchResult,
  KnowledgeBase,
  KnowledgeChunk,
  KnowledgeBaseStatus,
  KnowledgeDocument,
  KnowledgeDocumentSummary,
  KnowledgeSearchResult,
} from "@aquawisp/kb";

export interface KnowledgeTools {
  add(document: KnowledgeDocument): void;
  search(query: string, limit: number): readonly KnowledgeSearchResult[];
  list(limit: number): readonly KnowledgeDocumentSummary[];
  status(): KnowledgeBaseStatus;
}

export function createKnowledgeTools(knowledgeBase: KnowledgeBase): KnowledgeTools {
  return {
    add: (document) => {
      knowledgeBase.add(document);
    },
    search: (query, limit) => knowledgeBase.search(query, limit),
    list: (limit) => knowledgeBase.list(limit),
    status: () => knowledgeBase.status(),
  };
}

export interface HybridKnowledgeTools {
  add(document: KnowledgeDocument): Promise<readonly KnowledgeChunk[]>;
  search(request: HybridSearchRequest): Promise<readonly HybridSearchResult[]>;
  list(limit: number): readonly KnowledgeDocumentSummary[];
  status(): KnowledgeBaseStatus;
}

export function createHybridKnowledgeTools(
  knowledgeBase: KnowledgeBase,
  hybridIndex: HybridKnowledgeIndex,
): HybridKnowledgeTools {
  return {
    add: async (document) => await hybridIndex.add(document),
    search: async (request) => await hybridIndex.search(request),
    list: (limit) => knowledgeBase.list(limit),
    status: () => knowledgeBase.status(),
  };
}
