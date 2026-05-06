import type { ApplySetMetadata } from "@mod-platform/generated/schema/siteprofile";
import { typedEntries } from "@webhare/std";
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

export type StructuredData = Array<Exclude<Thing, string>>;

/** Manages page level metadata */
export class PageMetadata {
  viewport = "width=device-width, initial-scale=1";
  htmlDirection: "ltr" | "rtl" = "ltr";
  htmlClasses: string[] = [];
  htmlDataSet: Record<string, string> = {};
  title = "";
  description = "";
  keywords = "";
  canonicalUrl: string | null = null;

  /** schema.org metadata for this page */
  readonly structuredData: StructuredData = []; //readonly to make it harder to overwrite instead of pushing/appending

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

  constructor(initialData: ApplySetMetadata) {
    for (const [prop, value] of typedEntries(initialData)) {
      if (prop === "openGraph") {
        for (const [ogProp, ogValue] of Object.entries(value as Record<string, unknown>)) {
          (this.openGraph as Record<string, unknown>)[ogProp] = ogValue;
        }
        continue;
      }
      if (prop in this && typeof value === typeof this[prop as keyof PageMetadata]) {
        (this as Record<string, unknown>)[prop] = value;
      }
    }
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

export function getOpenGraphData(pageMetadata: PageMetadata) {
  const ogData: Array<{ property: string; content: string }> = [];
  const ogUrl = pageMetadata.openGraph.url === null ? "" : (pageMetadata.openGraph.url ?? pageMetadata.canonicalUrl);
  if (pageMetadata.openGraph.title)
    ogData.push({ property: "og:title", content: pageMetadata.openGraph.title });
  if (pageMetadata.openGraph.description)
    ogData.push({ property: "og:description", content: pageMetadata.openGraph.description });
  if (ogUrl)
    ogData.push({ property: "og:url", content: ogUrl });
  if (pageMetadata.openGraph.siteName)
    ogData.push({ property: "og:site_name", content: pageMetadata.openGraph.siteName });
  if (pageMetadata.openGraph.type)
    ogData.push({ property: "og:type", content: pageMetadata.openGraph.type });

  if (pageMetadata.openGraph.image?.url) {
    ogData.push({ property: "og:image", content: pageMetadata.openGraph.image.url });
    if (pageMetadata.openGraph.image.type)
      ogData.push({ property: "og:image:type", content: pageMetadata.openGraph.image.type });
    if (pageMetadata.openGraph.image.width)
      ogData.push({ property: "og:image:width", content: pageMetadata.openGraph.image.width.toString() });
    if (pageMetadata.openGraph.image.height)
      ogData.push({ property: "og:image:height", content: pageMetadata.openGraph.image.height.toString() });
    if (pageMetadata.openGraph.image.alt)
      ogData.push({ property: "og:image:alt", content: pageMetadata.openGraph.image.alt });
  }
  if (pageMetadata.openGraph.video?.url) {
    ogData.push({ property: "og:video", content: pageMetadata.openGraph.video.url });
    if (pageMetadata.openGraph.video.type)
      ogData.push({ property: "og:video:type", content: pageMetadata.openGraph.video.type });
    if (pageMetadata.openGraph.video.width)
      ogData.push({ property: "og:video:width", content: pageMetadata.openGraph.video.width.toString() });
    if (pageMetadata.openGraph.video.height)
      ogData.push({ property: "og:video:height", content: pageMetadata.openGraph.video.height.toString() });
  }

  return ogData;
}
