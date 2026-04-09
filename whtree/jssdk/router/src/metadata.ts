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

/** OpenGraph metadata format. See also https://ogp.me/ */
export type OpenGraphMetadata = {
  title?: string;
  description?: string;
  /** Item URL. Should be an absolute URL. If not set it will fall back to the canonical URL which is almost always what you want. Set to 'null' explicitly to supress the field  */
  url?: string | null;
  type?: string;
  siteName?: string;
  image?: { url: string; type?: string; width?: number; height?: number; alt?: string };
  video?: { url: string; type?: string; width?: number; height?: number };
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

  /** OpenGraph metadata; usually preferred by social media sharing */
  openGraph: OpenGraphMetadata = {};

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

export function getOpenGraphData(pageMetaData: PageMetaData) {
  const ogData: Array<{ property: string; content: string }> = [];
  const ogUrl = pageMetaData.openGraph.url === null ? "" : (pageMetaData.openGraph.url ?? pageMetaData.canonicalUrl);
  if (pageMetaData.openGraph.title)
    ogData.push({ property: "og:title", content: pageMetaData.openGraph.title });
  if (pageMetaData.openGraph.description)
    ogData.push({ property: "og:description", content: pageMetaData.openGraph.description });
  if (ogUrl)
    ogData.push({ property: "og:url", content: ogUrl });
  if (pageMetaData.openGraph.siteName)
    ogData.push({ property: "og:site_name", content: pageMetaData.openGraph.siteName });
  if (pageMetaData.openGraph.type)
    ogData.push({ property: "og:type", content: pageMetaData.openGraph.type });

  if (pageMetaData.openGraph.image?.url) {
    ogData.push({ property: "og:image", content: pageMetaData.openGraph.image.url });
    if (pageMetaData.openGraph.image.type)
      ogData.push({ property: "og:image:type", content: pageMetaData.openGraph.image.type });
    if (pageMetaData.openGraph.image.width)
      ogData.push({ property: "og:image:width", content: pageMetaData.openGraph.image.width.toString() });
    if (pageMetaData.openGraph.image.height)
      ogData.push({ property: "og:image:height", content: pageMetaData.openGraph.image.height.toString() });
    if (pageMetaData.openGraph.image.alt)
      ogData.push({ property: "og:image:alt", content: pageMetaData.openGraph.image.alt });
  }
  if (pageMetaData.openGraph.video?.url) {
    ogData.push({ property: "og:video", content: pageMetaData.openGraph.video.url });
    if (pageMetaData.openGraph.video.type)
      ogData.push({ property: "og:video:type", content: pageMetaData.openGraph.video.type });
    if (pageMetaData.openGraph.video.width)
      ogData.push({ property: "og:video:width", content: pageMetaData.openGraph.video.width.toString() });
    if (pageMetaData.openGraph.video.height)
      ogData.push({ property: "og:video:height", content: pageMetaData.openGraph.video.height.toString() });
  }

  return ogData;
}
