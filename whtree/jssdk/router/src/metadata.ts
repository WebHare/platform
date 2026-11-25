import type { ApplySetMetadata } from "@mod-platform/generated/schema/siteprofile";
import { typedEntries, appendToArray } from "@webhare/std";
import type { DataLayerEntry } from "@webhare/frontend";
import type { SchemaOrg } from "@webhare/deps";
import { resizeTSDescriptor, type ExportedTSDescriptor } from "@webhare/hscompat";
import type { ResourceDescriptor, ResizeMethod } from "@webhare/services";


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
  image?: { url: string; type?: string; width?: number; height?: number };
  imageMethod?: ResizeMethod;
  imageResource?: ResourceDescriptor | ExportedTSDescriptor;
  imageAlt?: string;
  video?: { url: string; type?: string; width?: number; height?: number };
};

export type StructuredDataItem = Exclude<SchemaOrg.Thing, string>;
export type StructuredData = StructuredDataItem[];

export type NormalizedFaqPage = SchemaOrg.FAQPage & { mainEntity: SchemaOrg.Question[] };

function fixupFAQPage(item: StructuredDataItem): NormalizedFaqPage | null {
  if (!("mainEntity" in item))
    return null;

  return {
    ...structuredClone(item) as NormalizedFaqPage,
    mainEntity: (Array.isArray(item.mainEntity) ? item.mainEntity : [item.mainEntity]) as unknown as SchemaOrg.Question[]
  };
}

/** Value of a field in PageMetadata.consilioFields. Records are allowed for catalog fields mapped as objects */
export type ConsilioFieldValue = string | number | boolean | string[] | { [key: string]: ConsilioFieldValue };

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

  /** H1/pageHeading to use for this page */
  pageHeading = "";

  /** schema.org metadata for this page */
  readonly structuredData: StructuredData = []; //readonly to make it harder to overwrite instead of pushing/appending

  /** dataLayer. Should only be appended to */
  readonly dataLayer: DataLayerEntry[] = []; //readonly to make it harder to overwrite instead of pushing/appending

  /** OpenGraph metadata; usually preferred by social media sharing */
  openGraph: OpenGraphMetadata = {};

  /** Additional consilio fields to index with frontend content. Use camelCase names (eg `pageType`, `imageUrl`):
   * they're converted to snake_case (also in nested records) so HareScript can access them, eg `pageType` is indexed as `page_type` */
  readonly consilioFields: Record<string, ConsilioFieldValue> = {}; //TODO shouldn't consilio offer a type for this?

  //mapping from lowercased prefix to [prefix,namespace] pairs for case-insensitive lookups
  #htmlPrefixes: Map<string, [string, string]> = new Map();
  get htmlPrefixes(): ReadonlyArray<[string, string]> {
    return [...this.#htmlPrefixes.values()];
  }

  #robotsTag = { ...INITIAL_ROBOTS_TAG };
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
        if (value?.image?.alt)
          this.openGraph.imageAlt = value.image.alt;

        continue;
      }
      if (prop in this && typeof value === typeof this[prop as keyof PageMetadata]) {
        (this as Record<string, unknown>)[prop] = value;
      }
    }
  }

  /** Breadcrumb to the current page. Initialized using the targetPath by default, starts at site root and ends at the current targetObject */
  get breadcrumb(): SchemaOrg.ListItem[] {
    let crumb = this.structuredData.find(_ => _["@type"] === "BreadcrumbList");
    if (!crumb) {
      crumb = { "@type": "BreadcrumbList" };
      this.structuredData.push(crumb);
    }
    crumb.itemListElement ||= [];
    return crumb.itemListElement as SchemaOrg.ListItem[];
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

  getFinalStructuredData() {
    const items = [];
    let faqPage: NormalizedFaqPage | null = null;
    for (let item of this.structuredData) {
      if (item["@type"] === "BreadcrumbList" && Array.isArray(item.itemListElement) && item.itemListElement.length === 0)
        continue;

      if (item["@type"] === "FAQPage") { //merge FAQPage entries together as one
        const page = fixupFAQPage(item);
        if (!page)
          continue;

        if (faqPage) {
          //"Expression produces a union type that is too complex to represent.ts(2590)" - so let's keep TS' life easy
          appendToArray(faqPage.mainEntity as unknown[], page.mainEntity as unknown[]);
          continue;
        }

        faqPage = page;
        item = page;
      }

      //Add the required @context we didn't ask our users to add
      items.push({
        "@context": "https://schema.org",
        ...item
      });
    }
    return items;
  }
}

function toOpenGraph(res: ExportedTSDescriptor | ResourceDescriptor | undefined, siteBaseURL: string) {
  if (!res)
    return null;

  const imageMethod: ResizeMethod = { method: "fill", width: 1200, height: 630, format: "image/jpeg", };
  let { link: url, width, height } = "ts$resourcedescriptor" in res ? resizeTSDescriptor(res, imageMethod) : res.toResized(imageMethod);
  if (url.startsWith('/')) //UC link not bound to a domainname yet ?
    url = new URL(url, siteBaseURL).toString();
  return { url, width, height, type: "image/jpeg" };
}

export function getOpenGraphData(pageMetadata: PageMetadata, siteBaseURL: string) {
  const ogData: Array<{ property: string; content: string }> = [];
  const ogUrl = pageMetadata.openGraph.url === null ? "" : (pageMetadata.openGraph.url ?? pageMetadata.canonicalUrl);
  const ogTitle = pageMetadata.openGraph.title ?? pageMetadata.title;
  const ogDescription = pageMetadata.openGraph.description ?? pageMetadata.description;
  if (ogTitle)
    ogData.push({ property: "og:title", content: ogTitle });
  if (ogDescription)
    ogData.push({ property: "og:description", content: ogDescription });
  if (pageMetadata.openGraph.description)
    ogData.push({ property: "og:description", content: pageMetadata.openGraph.description });
  if (ogUrl)
    ogData.push({ property: "og:url", content: ogUrl });
  if (pageMetadata.openGraph.siteName)
    ogData.push({ property: "og:site_name", content: pageMetadata.openGraph.siteName });
  if (pageMetadata.openGraph.type)
    ogData.push({ property: "og:type", content: pageMetadata.openGraph.type });


  const ogImageData = pageMetadata.openGraph.image?.url ? pageMetadata.openGraph.image : toOpenGraph(pageMetadata.openGraph.imageResource, siteBaseURL);

  if (ogImageData) {
    ogData.push({ property: "og:image", content: ogImageData.url });
    if (ogImageData.type)
      ogData.push({ property: "og:image:type", content: ogImageData.type });
    if (ogImageData.width)
      ogData.push({ property: "og:image:width", content: ogImageData.width.toString() });
    if (ogImageData.height)
      ogData.push({ property: "og:image:height", content: ogImageData.height.toString() });
    if (pageMetadata.openGraph.imageAlt)
      ogData.push({ property: "og:image:alt", content: pageMetadata.openGraph.imageAlt });
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
