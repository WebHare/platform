import type { WebHareServiceIPCLinkType } from "@mod-system/js/internal/types";
import { LocalService, LocalServiceHandlerBase } from "@webhare/services/src/localservice";
import { emplace } from "@webhare/std/collections";
import { recordLowerBound, recordUpperBound } from "@webhare/hscompat/algorithms";
import bridge, { type BridgeEvent } from "@mod-system/js/internal/whmanager/bridge";
import { regExpFromWildcards } from "@webhare/std/strings";
import { debugFlags } from "@webhare/env/src/envbackend";

/* The adhoc cache service is hosted by a local service together with the mainbridge of a
   process.

   Because it uses a local service, the data is sent over MessagePorts, and should
   be sendable with the structured clone algorithm (see https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm)
   HareScript now encodes its data into a SharedArrayBuffer using the HSM binary marshaller (in 'data' mode,
   so the data is encoded in linear binary data).
*/


export async function openAdhocCacheService(link: WebHareServiceIPCLinkType["AcceptEndPoint"]) {
  return new LocalServiceHandlerBase("local:adhocCacheService", (groupId) => new AdhocCacheService(groupId), { dropListenerReference: true });
}

type Item = {
  libraryModDate: bigint;
  value: unknown;
  expires: Date | null;
  eventMasks: string[];
  eventMaskRegExp: RegExp | null;
};

class LibraryData {
  items = new Map<string, Item>;
}

class AdhocCacheData {
  libraries = new Map<string, LibraryData>;
  expiries = new Array<{ expires: Date; libraryUri: string; hash: string }>;
  expireCB: NodeJS.Timeout | undefined;
  hits = 0;
  requests = 0;

  constructor() {
    bridge.on("event", (data) => this.gotEvent(data));
  }

  gotEvent(data: BridgeEvent) {
    for (const [libraryUri, libraryData] of this.libraries.entries()) {
      for (const [hash, item] of libraryData.items.entries()) {
        if (item.eventMaskRegExp?.exec(data.name)) {
          libraryData.items.delete(hash);
          if (item.expires) {
            const pos = recordLowerBound(this.expiries, { expires: item.expires, libraryUri, hash }, ["expires", "libraryUri", "hash"]);
            if (pos.found)
              this.expiries.splice(pos.position, 1);
          }
        }
      }
      if (!libraryData.items.size)
        this.libraries.delete(libraryUri);
    }
  }

  getCachedData(libraryUri: string, libraryModDate: bigint, hash: string) {
    ++this.requests;
    this.runExpiry();

    const lib = this.libraries.get(libraryUri);
    const rec = lib?.items.get(hash);
    if (!lib || !rec) {
      if (debugFlags.ahc)
        console.error(`[ahc] no item found for ${libraryUri} ${hash}`);
      return null;
    }
    if (rec.libraryModDate !== libraryModDate) {
      if (debugFlags.ahc)
        console.error(`[ahc] found item from other library version for ${libraryUri} ${hash}`);
      return null;
    }

    if (debugFlags.ahc)
      console.error(`[ahc] found item for ${libraryUri} ${hash}`);
    ++this.hits;
    return { value: rec.value };
  }

  removeExpiry(libraryUri: string, hash: string, item: Item) {
    if (!item.expires)
      return;

    const pos = recordLowerBound(this.expiries, { expires: item.expires, libraryUri, hash }, ["expires", "libraryUri", "hash"]);
    if (pos.found)
      this.expiries.splice(pos.position, 1);
  }

  setCachedData(libraryUri: string, libraryModDate: bigint, hash: string, expires: Date | null, eventMasks: string[], value: unknown) {
    const newEntry: Item = {
      libraryModDate,
      value,
      expires,
      eventMasks,
      eventMaskRegExp: eventMasks.length === 0 ? null : regExpFromWildcards(eventMasks),
    };
    //Get the library to add the item to
    const items = emplace(this.libraries, libraryUri, { insert: () => new LibraryData }).items;
    //And add it by hash..
    const emplaced = emplace(items, hash, {
      insert: () => newEntry,
      update: (item) => {
        this.removeExpiry(libraryUri, hash, item);
        if (item.libraryModDate <= libraryModDate)
          return newEntry;
        return item;
      }
    });
    if (debugFlags.ahc) {
      console.error(`[ahc] set new item ${libraryUri} ${hash}, ${emplaced === newEntry ? "inserted" : "ignored, older library version"}`);
    }
    if (expires) {
      const pos = recordUpperBound(this.expiries, { libraryUri, expires, hash }, ["expires", "libraryUri", "hash"]);
      this.expiries.splice(pos, 0, { expires, libraryUri, hash });
      if (pos === 0) { //item is next to expire, reschedule expiry timer
        if (this.expireCB)
          clearTimeout(this.expireCB);
        this.updateExpireCB();
      }
    }
  }

  deleteItem(libraryUri: string, hash: string) {
    const lib = this.libraries.get(libraryUri);
    if (lib) {
      const item = lib.items.get(hash);
      if (item) {
        this.removeExpiry(libraryUri, hash, item);
        lib.items.delete(hash);
        if (!lib.items.size)
          this.libraries.delete(libraryUri);
      }
    }
  }

  gotExpiryTimeout(): void {
    this.expireCB = undefined;
    this.runExpiry();
  }

  runExpiry() {
    const now = Date.now();
    let idx = 0;
    for (; this.expiries.length > idx && this.expiries[idx].expires.getTime() <= now; ++idx) {
      const rec = this.expiries[idx];
      if (debugFlags.ahc)
        console.error(`[ahc] remove item ${rec.libraryUri} ${rec.hash}, expired at ${rec.expires.toISOString()}`);
      this.deleteItem(rec.libraryUri, rec.hash);
    }
    this.expiries.splice(0, idx);
    this.updateExpireCB();
  }

  private updateExpireCB() {
    if (this.expiries.length) {
      //Clamp timeout to 1 day as adhoc cache values without ttl have infinite expiry, but timeout must stay within 31bits
      //But also minimum of 1 sec, as the item might already have expired
      this.expireCB = setTimeout(() => this.gotExpiryTimeout(), Math.max(1, Math.min(86400 * 1000, this.expiries[0].expires.getTime() - Date.now())));
      this.expireCB.unref();
    } else
      this.expireCB = undefined;
  }

  clearCache() {
    if (this.expireCB)
      clearTimeout(this.expireCB);
    this.expireCB = undefined;
    this.libraries.clear();
    this.expiries.splice(0);
    this.hits = 0;
    this.requests = 0;
  }

  getStats() {
    return {
      cachesize: [...this.libraries.values()].reduce((prev, libraryData) => prev + libraryData.items.size, 0),
      hits: this.hits,
      requests: this.requests,
    };
  }
}

let globalAdhocCacheData: AdhocCacheData | undefined;

export class AdhocCacheService extends LocalService {
  adhocCacheData: AdhocCacheData;
  groupId: string;

  constructor(groupId: string) {
    super();
    this.adhocCacheData = (globalAdhocCacheData ??= new AdhocCacheData);
    this.groupId = groupId;
  }

  getItem(libraryUri: string, libraryModDate: bigint, hash: string): { value: unknown } | null {
    return this.adhocCacheData.getCachedData(libraryUri, libraryModDate, hash);
  }

  setItem(libraryUri: string, libraryModDate: bigint, hash: string, expires: Date | null, eventMasks: string[], value: unknown): void {
    this.adhocCacheData.setCachedData(libraryUri, libraryModDate, hash, expires, eventMasks, value);
  }

  clearCache(): void {
    this.adhocCacheData.clearCache();
  }

  getStats(): { cachesize: number; hits: number; requests: number } {
    return this.adhocCacheData.getStats();
  }
}
