export interface CatalogListEntry {
  /** Catalog id */
  id: number;
  /** Catalog tag */
  tag: string;
  /** Description */
  description: string;
  /** Where this catalog was defined/created */
  definedBy: string;
  /** Catalog language */
  lang: string;
  /** True if this is managed catalog (supports contentsources) */
  managed: boolean;
  /** Wildcard mask for related suffixes, if any */
  suffixMask: string;
};

export interface AttachedIndex {
  id: number;
  indexName: string;
  searchPriority: number;
  readOnly: boolean;
  /** If set, this WebHare installation manages this index manager */
  isManaged: boolean;
}

export interface CatalogSuffix {
  // indexName: string;
  /** Suffix name. Can be empty for the main index */
  suffix: string;
  // health: string;
  // status: string;
  // docs: number;
  // size: number;
};
