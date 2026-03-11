import type { ListItem, Thing } from "schema-dts";

const INITIAL_ROBOTS_TAG = {
  noIndex: false,
  noFollow: false,
  noArchive: false,
  unavailableAfter: null as Temporal.Instant | null,
  noImageIndex: false,
  noSnippet: false,
  custom: "",
};

/** Manages page level metadata */
export class PageMetaData {
  viewport: string;
  htmlDirection: "ltr" | "rtl" = "ltr";
  htmlClasses: string[] = [];
  htmlDataSet: Record<string, string> = {};
  title = "";
  description = "";
  keywords = "";
  canonicalUrl: string | null = null;

  /** schema.org metadata for this page */
  structuredData: Array<Exclude<Thing, string>> = [];

  //mapping from lowercased prefix to [prefix,namespace] pairs for case-insensitive lookups
  #htmlPrefixes: Map<string, [string, string]> = new Map();
  get htmlPrefixes(): ReadonlyArray<[string, string]> {
    return [...this.#htmlPrefixes.values()];
  }

  #robotsTag = INITIAL_ROBOTS_TAG;
  get robotsTag() {
    return this.#robotsTag;
  }
  set robotsTag(robotsTag: typeof INITIAL_ROBOTS_TAG) {
    this.#robotsTag = { ...this.#robotsTag, ...robotsTag };
  }

  constructor() {
    this.viewport = "width=device-width, initial-scale=1.0";
  }

  /** Breadcrumb to the current page. Initialized using the targetPath by default, starts at site root and ends at the current targetObject */
  get breadcrumb(): ListItem[] {
    let crumb = this.structuredData.find(_ => _["@type"] === "BreadcrumbList");
    if (!crumb) {
      crumb = { "@type": "BreadcrumbList" };
      this.structuredData.push(crumb);
    }
    crumb.itemListElement ||= [];
    return crumb.itemListElement as ListItem[];
  }

  /** Register a prefix on the <html> node
      @param addPrefix Prefix
      @param addNamespace Namespace URI for the prefix */
  registerHTMLPrefix(addPrefix: string, addNamespace: string) {
    if (!addPrefix.trim())
      throw new Error(`Invalid prefix '${addPrefix}'`);
    if (!addNamespace.trim())
      throw new Error(`Invalid namespace '${addNamespace}'`);

    const alreadyKnownNS = this.#htmlPrefixes.get(addPrefix.toLowerCase())?.[1];
    if (alreadyKnownNS === addNamespace)
      return;
    else if (alreadyKnownNS)
      throw new Error(`Prefix '${addPrefix}' already registered with namespace '${alreadyKnownNS}'`);

    this.#htmlPrefixes.set(addPrefix.toLowerCase(), [addPrefix, addNamespace]);
  }
}
