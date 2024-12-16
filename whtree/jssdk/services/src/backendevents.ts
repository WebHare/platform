import whbridge, { BridgeEvent, BridgeEventData } from "@mod-system/js/internal/whmanager/bridge";
import { regExpFromWildcards } from "@webhare/std/strings";
import { isValidBackendEventName } from "./naming";

export type BackendEvent = BridgeEvent;
export type BackendEventData = BridgeEventData;
type BackendEventMasks = string | string[];
type BackendEventCallback = (events: BackendEvent[], subscription: BackendEventSubscription) => void;

//TODO groupevents, supsend/resume - See TolliumEventListenerBase for inspiration on what a good event listener can do. OR just redesign a subscription or the bridge as an EventTarget
class BackendEventSubscription implements Disposable {
  private listenerid = 0;
  private mask: RegExp | null = null;

  constructor(private readonly callback: BackendEventCallback) {
  }

  async setMasks(masks: BackendEventMasks): Promise<void> {
    const masklist = Array.isArray(masks) ? masks : [masks];
    for (const mask of masklist) {

      if (!isValidBackendEventName(mask.replaceAll('*', 'xx')))
        throw new Error(`Mask must be in the format module:eventname, got '${mask}'`);

      if (mask.indexOf('*') !== -1 && !mask.endsWith('.*'))
        throw new Error(`Mask must be exact or end in '.*', got '${mask}'`);
    }

    await Promise.resolve(true); //wait a tick to ensure users aren't expecting events until we've had a chance to tell WHBridge (although we currently don't really have to....)
    if (!this.listenerid) {
      this.listenerid = whbridge.on("event", evt => this.onEvent(evt));
    }

    this.mask = masklist.length ? regExpFromWildcards(masklist) : null;
  }

  private onEvent(evt: BackendEvent) {
    if (this.mask?.test(evt.name)) {
      //we strip __recordexists and __sourcegroup we receive from HS/the bridge
      if (evt.data?.__recordexists === false) //explicitly nonexisting
        evt.data = null;
      else if (evt.data) {
        delete evt.data.__recordexists;
        delete evt.data.__sourcegroup;
      }
      this.callback([evt], this);
    }
  }

  [Symbol.dispose]() {
    if (this.listenerid) {
      whbridge.off(this.listenerid);
      this.listenerid = 0;
      this.mask = null; //This also stops processing of any events that are still in the queue
    }
  }
}

export async function subscribe(masks: BackendEventMasks, callback: BackendEventCallback): Promise<BackendEventSubscription> {
  const subscr = new BackendEventSubscription(callback);
  await subscr.setMasks(masks);
  return subscr;
}

class EventStream implements Disposable, AsyncIterable<BackendEvent> {
  private subscription?: Promise<BackendEventSubscription>;
  private pendingPromise?: PromiseWithResolvers<BackendEvent | null>;
  private queue: BackendEvent[] = [];

  constructor(masks: BackendEventMasks) {
    this.subscription = subscribe(masks, (events) => this.callback(events));
  }

  private callback(events: BackendEvent[]) {
    for (const event of events) {
      if (this.pendingPromise) {
        this.pendingPromise.resolve(event);
        this.pendingPromise = undefined;
      } else {
        this.queue.push(event);
      }
    }
  }

  [Symbol.asyncIterator]() {
    return this;
  }

  [Symbol.dispose]() {
    this.subscription?.then(sub => sub[Symbol.dispose]()).then(() => { }, () => { });
    this.subscription = undefined;

    if (this.pendingPromise)
      this.pendingPromise.resolve(null);
  }

  async next(): Promise<IteratorResult<BackendEvent>> {
    if (this.subscription)
      await this.subscription; //Ensure we're subscribed

    if (!this.subscription) //we're cancelled. (Waiting can change the subscription status if we're already disposed!)
      return Promise.resolve({ done: true, value: null });

    if (this.queue.length)
      return { done: false, value: this.queue.shift()! };

    if (!this.pendingPromise)
      this.pendingPromise = Promise.withResolvers();

    const result = await this.pendingPromise.promise;
    if (result)
      return Promise.resolve({ done: false, value: result });
    else
      return Promise.resolve({ done: true, value: null });
  }
};

export function subscribeToEventStream(masks: BackendEventMasks) {
  return new EventStream(masks);
}


/** Broadcast an event to all WebHare processes (the bridge connection may linger a while to ensure the event is sent)
    @param event - Name of the event
    @param data - Event data
*/
export function broadcast(event: string, data?: BackendEventData) {
  whbridge.sendEvent(event, data ?? null);
}

export type { BackendEventSubscription };
