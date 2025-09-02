/* Experimental TS Catalog abstraction

   Requires @opensearch-project/opensearch 3.0 (Beta)

   Set DEBUG=opensearch for debugging opensearch requests. It uses the http/https module, not fetch, and WEBHARE_DEBUG=wrq cannot track that
   */

import { broadcastOnCommit, db, nextVal, runInWork, uploadBlob } from "@webhare/whdb";
import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { isValidModuleScopedName } from "@webhare/services/src/naming";
import { convertWaitPeriodToDate, isTruthy, omit, pick, type WaitPeriod } from "@webhare/std";
import { whconstant_consilio_catalogtype_managed, whconstant_consilio_catalogtype_unmanaged, whconstant_consilio_default_suffix_mask, whconstant_consilio_osportoffset } from "@mod-system/js/internal/webhareconstants";
import "@webhare/env";
import type { API as OpenSearchAPI, Client as OpenSearchClient } from "@opensearch-project/opensearch";
import type { ErrorCause } from "@opensearch-project/opensearch/api/_types/_common";
import { getStackTrace } from "@webhare/js-api-tools";
import { scheduleTimedTask, WebHareBlob } from "@webhare/services";
import { encodeHSON } from "@webhare/hscompat";
import { loadlib } from "@webhare/harescript";
import type { AttachedIndex, CatalogListEntry, CatalogSuffix } from "./types";
import { isValidIndexSuffix } from "./support";
import { buildGeneratorContext } from "@mod-system/js/internal/generation/generator";
import { getExpectedCatalogs } from "@mod-platform/js/configure/consilio";
import { getBasePort } from "@webhare/services/src/config";

interface AttachedIndexWithAddress extends AttachedIndex {
  baseurl: string;
  suffix: string;
}

function getBuiltinOpensearchAddress() {
  const baseport = getBasePort();
  const host = process.env["WEBHARE_OPENSEARCH_BINDHOST"] || "127.0.0.1";
  return `http://${host}:${baseport + whconstant_consilio_osportoffset}/`;
}

function getOSIndexName(indexName: string, suffix: string) {
  return indexName + (suffix ? "-" + suffix : "");
}

type OpenSearchDocument = { _id?: string } & Record<string, unknown>;

// Extend opensearch model to support document type
type BaseQueryContainer = NonNullable<NonNullable<OpenSearchAPI.Search_Request["body"]>["query"]>;
type BaseBool = NonNullable<BaseQueryContainer["bool"]>;
type BaseMatchQuery = NonNullable<BaseQueryContainer["match"]>;

type ExtendQueryContainer<TDocument> = BaseQueryContainer & {
  bool?: ExtendBool<TDocument>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- this any was copied from the opensearch definitions
  match?: Record<keyof TDocument, BaseMatchQuery | any>;
};

type ExtendBool<TDocument> = BaseBool & {
  must?: ExtendQueryContainer<TDocument> | Array<ExtendQueryContainer<TDocument>>;
};

export type SearchRequest<TDocument> = OpenSearchAPI.Search_Request & {
  body?: {
    _source?: boolean | (TDocument extends object ? Array<keyof TDocument> : string[]);
    query?: ExtendQueryContainer<TDocument>;
  };
};

export type SearchResultHit<TDocument> = OpenSearchAPI.Search_ResponseBody["hits"]["hits"][number] & {
  //fields: SearchDocument; // FIXME the typings are not an exact match.., eg some fields come out as an array[]
  _source?: Partial<TDocument>;
};

export type SearchResult<TDocument> = OpenSearchAPI.Search_ResponseBody & {
  hits: {
    hits: Array<SearchResultHit<TDocument>>;
  };
};

type OpenSearchError<TDocument extends OpenSearchDocument = OpenSearchDocument> = ErrorCause & { doc: TDocument };

class BulkUploadError<TDocument extends OpenSearchDocument = OpenSearchDocument> extends Error {
  constructor(public errors: Array<OpenSearchError<TDocument>>) {
    super(`${errors.length} errors during bulk action`);
  }
}

class BulkAction<TDocument extends OpenSearchDocument = OpenSearchDocument> {
  private queue: Array<{ doc: OpenSearchDocument; suffix: string }> = [];
  private errors = new Array<OpenSearchError<TDocument>>;
  private updatedSuffixes: Set<string> = new Set();
  private ensuredSuffixes: Set<string> = new Set();
  queuesize = 0;
  debug;

  constructor(private catalog: Catalog<TDocument>, { debug = false } = {}) {
    this.debug = debug;
  }

  /** Add a document to index */
  async index(doc: TDocument, { suffix = "" } = {}) {
    if (suffix && !isValidIndexSuffix(suffix))
      throw new Error(`Invalid suffix '${suffix}'`);

    this.queue.push({ doc, suffix });
    this.queuesize += JSON.stringify(doc).length;

    if (this.queue.length >= 1000 || this.queuesize >= 262_144)  //upload every 1000 docs or 256KB. these limits are an educated guesstimate
      await this.flush(); //TODO allow one flush to run in parallel to the process building up a new queue
    return;
  }

  private async flush() {
    const { client, indexName } = await this.catalog.getRawClient();

    //extract the queue immediately, so it's safe for parallel actions to add to the queue
    const queued = this.queue;
    this.queue = [];
    this.queuesize = 0;

    //FIXME prevent use of -suffix if index isn't suffixed, and vice versa
    const body = queued.flatMap(({ doc, suffix }) => {
      const index = getOSIndexName(indexName, suffix);
      const addDoc = omit(doc, ["_id"]);
      this.updatedSuffixes.add(suffix);
      return [
        doc?._id ? { update: { _index: index, _id: doc._id } } : { create: { _index: index } },
        doc?._id ? { doc: addDoc, doc_as_upsert: true } : addDoc
      ];
    });

    //Create any necessary suffixes
    const toAdd = [...this.updatedSuffixes].filter(suffix => suffix && !this.ensuredSuffixes.has(suffix));
    if (toAdd.length) {
      // Trigger creation of the suffixes
      await this.catalog.applyConfiguration({ suffixes: toAdd });
      // Record in this.ensuredSuffixes that they've been created so we know not to retry
      toAdd.forEach(suffix => this.ensuredSuffixes.delete(suffix));
    }

    //NOTE do *not* use client.helpers.bulk - it doesn't report errors!
    if (this.debug)
      console.error(`Bulk uploading ${queued.length} documents to ${indexName}`);

    const bulkres = await client.bulk({ body });
    if (this.debug)
      console.error(`Bulk upload done`, bulkres);

    // console.dir(bulkres.body, { depth: 10 });

    //TODO what if we get errors not associated with an id..
    if (bulkres.body.errors && bulkres.body.items.length) {
      const errors: Array<OpenSearchError<TDocument>> = bulkres.body.items?.map((item, idx) => {
        const err = item.create?.error || item.update?.error;
        if (err)
          return { ...err, _id: queued[idx].doc._id, doc: queued[idx].doc as TDocument };
        return null;
      }).filter(isTruthy);
      if (errors) {
        if (this.debug)
          console.error(`There were ${errors.length} errors during bulk upload to ${indexName}, first:`, errors[0]);

        this.errors.push(...errors);
      }
    }
  }

  /** Commit the prepared actions to the index */
  async commit({ refresh = false } = {}) {
    const { client, indexName } = await this.catalog.getRawClient();

    if (this.queue.length)
      await this.flush();
    if (this.errors.length)
      throw new BulkUploadError(this.errors);
    if (refresh)
      for (const suffix of this.updatedSuffixes)
        await client.indices.refresh({ index: getOSIndexName(indexName, suffix) });
  }

  /** @deprecated renamed to commit in WH 5.8*/
  async finish({ refresh = false } = {}) {
    return await this.commit({ refresh });
  }
}

class CatalogObj<TDocument extends OpenSearchDocument = OpenSearchDocument> {
  constructor(private readonly id: number, public readonly tag: string) {

  }

  /** Attach an index (backing store) to a catalog. Creation may not apply until you've waited for reconfiguration (WaitReady with forconfiguration := TRUE)
    @param options - Options
      = indexManager - Index manager to use. Use 0 for the builtin index manager
      - indexName Index name
      - readOnly Do not write to or apply mappings to this index
    @returns ID of the newly attached index */

  async attachIndex(options?: { indexManager?: number; indexName?: string; readOnly?: boolean }): Promise<number> {
    const catalog = await loadlib("mod::consilio/lib/catalogs.whlib").OpenConsilioCatalogById(this.id);
    return await catalog.AttachIndex(options?.indexManager || 0, pick(options || {}, ["indexName", "readOnly"]));
  }

  /** Delete us */
  async deleteSelf(): Promise<void> {
    const catalog = await loadlib("mod::consilio/lib/catalogs.whlib").OpenConsilioCatalogById(this.id);
    return await catalog.deleteSelf();
  }

  /** Wait until the index is ready for storage
    @param deadline - Deadline, set to DEFAULT DATETIME for nonblocking wait.
    @param options - Options:
    - forStorage Wait for storage to be ready. If the index is readonly, WaitReady will return immediately, even if the deadline wasn't hit yet
     -forConfiguration Wait for configuration to be applied.
  */
  async waitReady(deadline: WaitPeriod, options?: { forStorage?: boolean; forConfiguration?: boolean }): Promise<boolean> {
    const catalog = await loadlib("mod::consilio/lib/catalogs.whlib").OpenConsilioCatalogById(this.id);
    return await catalog.waitReady(convertWaitPeriodToDate(deadline), options || {});
  }

  /** Describe how the catalog is stored. Useful for debugging
    @returns Storage info, will not contain linefeeds but should be considered free form (so we can extend/modify it later) */
  async getStorageInfo() {
    const storage = new Array<string>;
    for (const attachedindex of await this.listAttachedIndices()) {
      let indexName = attachedindex.indexName;
      if (attachedindex.readOnly)
        indexName = `${indexName}(r/o)`;
      storage.push(indexName);
    }

    if (storage.length >= 1)
      return `${this.tag} => (${storage.join(", ")})`;
    else
      return `${this.tag} => (unattached)`;
  }

  private async listFullAttachedIndices(): Promise<AttachedIndexWithAddress[]> {
    const indices = await db<PlatformDB>().
      selectFrom("consilio.catalog_indexmanagers").
      innerJoin("consilio.indexmanagers", "consilio.indexmanagers.id", "consilio.catalog_indexmanagers.indexmanager").
      innerJoin("consilio.catalogs", "consilio.catalogs.id", "consilio.catalog_indexmanagers.catalogid").
      select(["consilio.catalog_indexmanagers.id", "consilio.catalog_indexmanagers.indexname", "consilio.catalog_indexmanagers.searchpriority", "consilio.catalog_indexmanagers.readonly", "consilio.indexmanagers.address", "consilio.catalogs.suffix"]).
      where("consilio.catalog_indexmanagers.catalogid", '=', this.id).
      execute();

    return indices.map(index => ({
      id: index.id,
      indexName: index.indexname,
      searchPriority: index.searchpriority,
      readOnly: index.readonly,
      baseurl: index.address === "builtin-opensearch" ? getBuiltinOpensearchAddress() : index.address,
      isManaged: index.address === "builtin-opensearch",
      suffix: index.suffix
    }));
  }

  async listAttachedIndices(): Promise<AttachedIndex[]> {
    //don't leak the baseurl to the outside world, it may contain credentials
    //order by descending searchpriority and then ascending by id (usually creation order)
    return omit(await this.listFullAttachedIndices(), ["baseurl"]).sort((a, b) => b.searchPriority - a.searchPriority || a.id - b.id);
  }

  /** Make sure configuration is applied and, if unsuffixed, the root index exists
   * @param options - Options
   * - suffixes Update the configuration of the specified suffixes only, and ensure they exist
  */
  async applyConfiguration(options?: { suffixes?: string[] }) {
    const catalog = await loadlib("mod::consilio/lib/catalogs.whlib").OpenConsilioCatalogById(this.id);
    await catalog.ApplyConfiguration(options || {});
  }

  /** List suffixes created in this index
      @returns The suffixes, sorted alphabetically */
  async listSuffixes(): Promise<CatalogSuffix[]> {
    //delegating to HS for now
    const catalog = await loadlib("mod::consilio/lib/catalogs.whlib").OpenConsilioCatalogById(this.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (await catalog.listSuffixes()).map((_: any) => ({
      // indexName: _.indexname,
      suffix: _.suffix,
      // health: _.health,
      // status: _.status,
      // docs: _.docs,
      // size: _.size
    })).sort((a: CatalogSuffix, b: CatalogSuffix) => a.suffix.localeCompare(b.suffix));
  }

  async deleteSuffix(suffix: string): Promise<void> {
    const catalog = await loadlib("mod::consilio/lib/catalogs.whlib").OpenConsilioCatalogById(this.id);
    await catalog.DeleteSuffix(suffix);
  }

  /** Explicitly refresh. This may be needed to ensure visibility of recent insertions if you cannot update that inserter
   * to do a flush (this often happens during CI tests but excessive refreshing should be avoided in production)
  */
  async refresh() {
    const catalog = await loadlib("mod::consilio/lib/catalogs.whlib").OpenConsilioCatalogById(this.id);
    await catalog.Refresh();
  }

  /** Get a raw opensearch-project/opensearch client for the index
   * @returns An object containing a client and the indexname to use
   */
  async getRawClient(): Promise<{ client: OpenSearchClient; indexName: string; suffix: string }> {
    const indices = await this.listFullAttachedIndices();
    if (!indices.length)
      throw new Error(`No indices attached to catalog '${this.tag}'`);

    const imp = await import("@opensearch-project/opensearch");
    const { Client } = imp;
    return {
      client: new Client({ node: indices[0].baseurl }),
      indexName: indices[0].indexName,
      suffix: indices[0].suffix
    };
  }

  /** Start a bulk action which will automatically do intermediate flushes */
  startBulkAction<Doc extends OpenSearchDocument = TDocument>({ debug = false } = {}): BulkAction<Doc> {
    return new BulkAction<Doc>(this, { debug });
  }

  /** Search, routing it to the proper index
   * @typeParam SearchDocument - The type of the document we expect to be returned. Defaults to an Optional of the catalog's document class (as we don't known which fields you selected)
  */
  async search<SearchDocument = Partial<TDocument>>(req: SearchRequest<SearchDocument>, options?: { printRequest?: boolean }): Promise<SearchResult<SearchDocument>> {
    if (req.index)
      throw new Error("Don't specify the index in the search request, it's automatically set by the catalog");

    const { client, indexName, suffix } = await this.getRawClient();
    if (options?.printRequest) {
      //We can't grab the exact syntax from OpenSearch api I think?  but we can simulate it:
      console.log(`GET /${indexName + suffix}/_search\n${JSON.stringify(req.body, null, 2)}`);
    }
    return (await client.search({ index: indexName + suffix, ...req })).body as SearchResult<SearchDocument>;
  }

  /** Bulk upload */

  /* TODO should Catalog still wrap Suffix management, or shouldn't they?) */
  async delete(docid: string) {
    const indices = await this.listFullAttachedIndices();
    if (!indices.length)
      throw new Error(`No indices attached to catalog ${this.id}`);

    const res = await fetch(indices[0].baseurl + "_doc/" + docid, { method: "delete" });
    if (!res.ok)
      throw new Error(`Failed to delete document ${docid}: ${res.status} ${await res.text()}`);
  }
}

/** List all Consilio catalogs
    @returns List of catalogs
*/
export async function listCatalogs(): Promise<CatalogListEntry[]> {
  const catalogs = await db<PlatformDB>().selectFrom("consilio.catalogs").select(["id", "name", "description", "definedby", "lang", "type", "suffix"]).execute();
  return catalogs.map(catalog => ({
    id: catalog.id,
    tag: catalog.name,
    description: catalog.description,
    definedBy: catalog.definedby,
    lang: catalog.lang,
    managed: catalog.type === whconstant_consilio_catalogtype_managed,
    suffixMask: catalog.suffix
  }));
}

export async function openCatalog<DocType extends object = object>(catalogName: string): Promise<Catalog<DocType>> {
  if (!isValidModuleScopedName(catalogName)) //blocks mixed/uppercase values too, so we don't need case insensitive lookups
    throw new Error(`Illegal catalog name '${catalogName}'`);

  const catalog = await db<PlatformDB>().selectFrom("consilio.catalogs").select(["id", "name"]).where("name", '=', catalogName).executeTakeFirst();
  if (!catalog) //TODO allowMissing
    throw new Error(`Catalog '${catalogName}' not found`);

  return new CatalogObj<DocType & OpenSearchDocument>(catalog.id, catalog.name);
}

export interface CatalogOptions {
  /** An optional description for the catalog */
  comment?: string;
  /** priority (-9 to 9, 0 is the default) */
  priority?: number;
  /** Create a managed catalog where consilio manages attached indices and content. Defaults to TRUE */
  managed?: boolean;
  /** Create a suffixed catalog */
  suffixed?: boolean;
  lang?: string;
  definedBy?: string;
  fieldGroups?: string[];
  logLevel?: number;
}

/** Create a new Consilio catalog.
    @param tag - The name of the catalog (this name should be unique)
    @param options - Options
    @returns Catalog object
*/
export async function createCatalog<DocType extends object = object>(tag: string, options?: CatalogOptions): Promise<Catalog<DocType>> {
  const context = await buildGeneratorContext(null, false);
  const catalogconfig = getExpectedCatalogs(context).catalogs.find(catalog => catalog.tag === tag);
  if (catalogconfig) {
    if (options?.fieldGroups)
      throw new Error(`Catalog ${tag} is configured in the moduledefinition, you cannot update its fieldgroups`);
    if (options?.lang)
      throw new Error(`Catalog ${tag} is configured in the moduledefinition, you cannot update its language`);

    options = {
      ...options,
      fieldGroups: catalogconfig.fieldGroups,
      lang: catalogconfig.lang,
    };
  }

  await doCreateCatalog(tag, options);
  return await openCatalog<DocType>(tag);
}

export async function doCreateCatalog(tag: string, options?: CatalogOptions): Promise<void> {
  if (!tag || !isValidModuleScopedName(tag))
    throw new Error(`Invalid catalog tag '${tag}'`);

  // Index name should be unique
  const existing = await db<PlatformDB>().selectFrom("consilio.catalogs").select("id").where("name", '=', tag).execute();
  if (existing.length)
    throw new Error(`Catalog with tag '${tag}' already exists with id #${existing[0].id}`);

  const indexid = await nextVal("consilio.catalogs.id");
  if (options?.suffixed && options?.managed)
    throw new Error("A managed index can't be set to suffixed");

  const lang = options?.lang || "en";
  const fieldgrousps = options?.fieldGroups || [];

  // Prepare configuration
  const config = await loadlib("mod::consilio/lib/internal/opensearch/mapping.whlib").CalculateExpectedConfiguration(fieldgrousps, options?.managed || false, tag, [], lang);  //no contentsource ids yet
  const internalmetadata = await loadlib("mod::consilio/lib/internal/opensearch/mapping.whlib").BuildInternalMetadataFromConfiguration(config);
  await db<PlatformDB>().insertInto("consilio.catalogs").values({
    id: indexid,
    name: tag,
    description: options?.comment || "",
    loglevel: options?.logLevel || 0,
    priority: options?.priority || 0,
    definedby: options?.definedBy || `createConsilioCatalog from ${getStackTrace()[1].filename}#${getStackTrace()[1].func}`,
    type: options?.managed ? whconstant_consilio_catalogtype_managed : whconstant_consilio_catalogtype_unmanaged,
    suffix: options?.suffixed ? whconstant_consilio_default_suffix_mask : "",
    fieldgroups: await loadlib("mod::consilio/lib/catalogs.whlib").__BuildFieldgroups(fieldgrousps),
    lang,
    internalmetadata: await uploadBlob(WebHareBlob.from(encodeHSON(internalmetadata)))
  }).execute();

  const finishHandler = await loadlib("mod::consilio/lib/internal/finishhandler.whlib").GetConsilioFinishHandler();
  await finishHandler.ScheduleUpdate();
  broadcastOnCommit("consilio:indiceschanged");
}

export async function removeCatalogs(obsolete: string[], options?: { verbose?: boolean }) {
  const tocleanup = await db<PlatformDB>().selectFrom("consilio.catalogs").select(["id", "name"]).where("name", "in", obsolete).execute();
  if (tocleanup.length) {
    if (options?.verbose)
      console.log(`Removing ${tocleanup.length} catalogs`);

    await runInWork(async () => {
      await db<PlatformDB>().deleteFrom(["consilio.catalogs"]).where("id", "in", tocleanup.map(_ => _.id)).execute();
      await scheduleTimedTask("consilio:cleanupindices");
    });
  }
}

export type Catalog<DocType extends object = object> = CatalogObj<DocType & OpenSearchDocument>;
export type { BulkAction, BulkUploadError };
