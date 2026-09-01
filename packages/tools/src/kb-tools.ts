import type {
  KnowledgeBase,
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
