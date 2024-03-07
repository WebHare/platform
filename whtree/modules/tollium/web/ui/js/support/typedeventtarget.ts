/** Allows TS supported events for classes deriving from EventTarget that are not in the DOM */

export interface EventMapType {
  [key: string]: CustomEvent<unknown>;
}

export class TypedEventTarget<EventMap extends EventMapType> extends EventTarget {
  dispatch<E extends keyof EventMap>(eventname: E, detail: EventMap[E]["detail"]) {
    this.dispatchEvent(new CustomEvent(eventname as string, { bubbles: false, cancelable: false, detail }));
  }

  addEventListener<E extends keyof EventMap>(type: E, listener: ((this: TypedEventTarget<EventMap>, ev: EventMap[E]) => void) | EventListenerObject | null, options?: boolean | AddEventListenerOptions): void {
    return super.addEventListener(type as string, listener as EventListener, options);
  }
}
