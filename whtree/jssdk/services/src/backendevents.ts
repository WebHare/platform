import whbridge, { BridgeEvent, BridgeEventData } from "@mod-system/js/internal/whmanager/bridge";
import { wildcardsToRegExp } from "@webhare/std/strings";
import { isValidBackendEventName } from "./naming";

export type BackendEvent = BridgeEvent;
export type BackendEventData = BridgeEventData;
type BackendEventMasks = string | string[];
type BackendEventCallback = (events: BackendEvent[], subscription: BackendEventSubscription) => void;

//TODO groupevents, supsend/resume - See TolliumEventListenerBase for inspiration on what a good event listener can do
class EventSubscription {
  listenerid = 0;
  callback: BackendEventCallback;
  private mask: RegExp | null = null;

  constructor(callback: BackendEventCallback) {
    this.callback = callback;
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

    this.mask = new RegExp(masklist.map(wildcardsToRegExp).join('|'));
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

export type BackendEventSubscription = Pick<EventSubscription, "setMasks" | typeof Symbol.dispose>;

export async function subscribe(masks: BackendEventMasks, callback: BackendEventCallback): Promise<BackendEventSubscription> {
  const subscr = new EventSubscription(callback);
  await subscr.setMasks(masks);
  return subscr;
}

/** Broadcast an event to all WebHare processes (the bridge connection may linger a while to ensure the event is sent)
    @param event - Name of the event
    @param data - Event data
*/
export function broadcast(event: string, data?: BackendEventData) {
  whbridge.sendEvent(event, data ?? null);
}
