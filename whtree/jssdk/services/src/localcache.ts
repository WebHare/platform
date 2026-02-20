import bridge, { type BridgeEvent, type SimpleMarshallableRecord } from "@mod-system/js/internal/whmanager/bridge";
import { regExpFromWildcards, stringify } from "@webhare/std/src/strings";
import type { MaybePromise } from "@webhare/std/src/types";


export type LocalCacheKey = Record<string, unknown> | string;

export type LocalCacheValueRecord<T> = {
  value: T;
  masks: string[];
} & ({ expires: Temporal.Instant; ttl?: never } | { ttl?: number; expires?: never });

export type LocalCacheOptions = {
  maxSize?: number;
};


const expiryDelay = 10;
const maxTimeout = 2 ** 31 - 1;

const cleanup = new FinalizationRegistry((id: number) => bridge.off(id));

export class LocalCache<T> {
  private options: LocalCacheOptions;
  private dataMap = new Map<string, { key: LocalCacheKey; created: number; value: T; masks: RegExp; expires: number }>();
  private recordEvents = new Set<Set<string>>;
  private nextInvalidation: [number, NodeJS.Timeout] | undefined;
  private waitMap = new Map<string, PromiseWithResolvers<void>>();
  private bridgeListenerId: number | null = null;

  constructor(options?: LocalCacheOptions) {
    this.options = options ?? {};
  }

  private calcDataKey(key: LocalCacheKey): string {
    if (typeof key === "string")
      return key;
    return stringify(key, { stable: true, typed: true });
  }

  private handleEvent(data: BridgeEvent<SimpleMarshallableRecord>) {
    for (const events of this.recordEvents)
      events.add(data.name);
    for (const [k, v] of this.dataMap.entries())
      if (v.masks.test(data.name))
        this.dataMap.delete(k);
  }

  private runExpiry() {
    let nextExpires = 0;
    const now = Date.now();
    for (const [k, v] of this.dataMap.entries()) {
      if (v.expires)
        if (v.expires <= now)
          this.dataMap.delete(k);
        else if (!nextExpires || nextExpires > v.expires)
          nextExpires = v.expires;
    }
    this.nextInvalidation = nextExpires ? [
      nextExpires + expiryDelay,
      setTimeout(() => this.runExpiry(), Math.min(nextExpires + expiryDelay - now, maxTimeout))
    ] : undefined;
  }

  private async create(key: LocalCacheKey, dataKey: string, create: () => MaybePromise<LocalCacheValueRecord<T>>): Promise<T> {
    do {
      {
        const wait = this.waitMap.get(dataKey);
        const rec = this.dataMap.get(dataKey);
        if (rec) {
          if (rec.expires && rec.expires <= Date.now())
            this.dataMap.delete(dataKey);
          else
            return rec.value;
        }
        if (wait) {
          await wait.promise;
          continue;
        }
      }

      const myLock = Promise.withResolvers<void>();
      this.waitMap.set(dataKey, myLock);
      const events = new Set<string>();
      this.recordEvents.add(events);
      if (this.recordEvents.size === 1 && !this.dataMap.size && !this.bridgeListenerId) {
        const weakRef = new WeakRef(this);
        this.bridgeListenerId = bridge.on("event", (data) => weakRef.deref()?.handleEvent(data));
        cleanup.register(this, this.bridgeListenerId);
      }
      try {
        for (let iter = 0; ; ++iter) {
          const createResult = await create();
          let expires = 0;
          if ("ttl" in createResult && createResult.ttl !== undefined && createResult.ttl >= 0)
            expires = Date.now() + createResult.ttl;
          else if ("expires" in createResult && createResult.expires)
            expires = createResult.expires.epochMilliseconds;

          const now = Date.now();
          const rec = {
            key,
            created: now,
            value: createResult.value,
            masks: regExpFromWildcards(["system:cachereset", ...new Set(createResult.masks)]),
            expires,
          };

          // ignore when the data was invalidated during calculation. Try recalc a few times to avoid internal inconsistency
          if (events.values().some(event => rec.masks.test(event))) {
            if (iter < 10)
              continue;
            return rec.value;
          }

          // Set expiry timeout
          if (rec.expires) {
            // Already expired? Just return it but don't store it
            if (rec.expires <= now)
              return rec.value;

            if (!this.nextInvalidation || this.nextInvalidation[0] > rec.expires + expiryDelay) {
              if (this.nextInvalidation)
                clearTimeout(this.nextInvalidation[1]);
              this.nextInvalidation = [rec.expires + expiryDelay, setTimeout(() => this.runExpiry(), Math.min(rec.expires + expiryDelay - now, maxTimeout))];
            }
          }

          this.dataMap.set(dataKey, rec);
          if (this.options.maxSize && this.dataMap.size > this.options.maxSize)
            this.dataMap.delete(this.dataMap.keys().take(1).toArray()[0]);
          return rec.value;
        }
      } finally {
        myLock.resolve();
        this.waitMap.delete(dataKey);
        this.recordEvents.delete(events);
      }
      // eslint-disable-next-line no-constant-condition
    } while (true);
  }

  get(key: LocalCacheKey): T | null;
  get(key: LocalCacheKey, create: () => MaybePromise<LocalCacheValueRecord<T>>): Promise<T>;
  get(key: LocalCacheKey, create?: () => MaybePromise<LocalCacheValueRecord<T>>): Promise<T> | T | null {
    const datakey = this.calcDataKey(key);
    let rec = this.dataMap.get(datakey);
    if (rec?.expires && rec.expires <= Date.now())
      rec = undefined;
    if (rec || !create)
      return rec?.value ?? null;
    return this.create(key, datakey, create);
  }

  reset() {
    this.dataMap.clear();
    if (this.nextInvalidation) {
      clearTimeout(this.nextInvalidation[1]);
      this.nextInvalidation = undefined;
    }
  }

  [Symbol.dispose]() {
    this.reset();
  }
}
