import { whenAborted } from "@webhare/std";

/** Event callback type.
    @typeParam T - Record with the callback types (eg `{ data: string, end: undefined }`)
    @typeParam K - Name of the used event
    @param data - Event data
    @param eventname - Name of the event
*/
export type EventCallback<T, K extends keyof T> = (data: T[K], eventname: K) => void;

/** Event callback type.
    @typeParam T - Record with the callback types (eg `{ data: string, end: undefined }`)
    @typeParam K - Name of the used event
    @param data - Event data
    @param eventname - Name of the event
    @returns Return false to skip calling the handler for this event.
*/
export type EventFilter<T, K extends keyof T> = (data: T[K], eventname: K) => boolean;

/** Id given back on listener registration
*/
export type ListenerId = number;

/** Event handler record. Haven't found a way to make the callback for eventname K accept only `EventCallback< T, K >`,
    typescript insists on combining them to `EventCallback<T, keyof T>`.
    @typeParam T - Record with the types of all the callbacks
 */
type EventHandlerRecord<T> = {
  eventname: keyof T | "*";
  callback: EventCallback<T, keyof T>;
  filter?: EventFilter<T, keyof T>;
};

/** Options for event handlers
*/
interface EventHandlerOptions<T, K extends keyof T> {
  /** If set, call filter for every event, only emit events where the filter function returns true */
  filter?: EventFilter<T, K>;
  /** If set, the event listener will be removed when the signal has aborted */
  signal?: AbortSignal;
}

/** Event source
    @typeParam T - Record with the possible callbacks and their types (eg `{ data: string, end: undefined }`)
*/
export default class EventSource<T extends Record<string, unknown>> {
  private _nextid = 0;
  private _on_handlers = new Map<number, EventHandlerRecord<T>>;

  /** Register a callback for every time an event is invoked
      @typeParam K - Type of the eventname (usually inferred automatically, for type checking purposes)
      @param eventname - Event name to match.
      @param callback - Callback to invoke
      @param options - Options
      @returns Listener ID that can be used to deregister with {@link off}.
  */
  on<K extends keyof T>(eventname: K, callback: EventCallback<T, K>, options: EventHandlerOptions<T, K> = {}): ListenerId {
    const id = ++this._nextid;
    this._on_handlers.set(id, {
      eventname,
      callback: callback as EventCallback<T, keyof T>,
      filter: options.filter as (EventFilter<T, keyof T> | undefined)
    });
    whenAborted(options.signal, () => this.off(id));
    return id;
  }

  /** Register a callback that will listen for all events (useful for forwarding or debugging)
      @param callback - Callback to invoke. The event name will be in the second parameter
      @param options - Options
      @returns Listener ID that can be used to deregister with {@link off}
  */
  onAll(callback: EventCallback<T, keyof T>, options?: EventHandlerOptions<T, keyof T>): ListenerId {
    const id = ++this._nextid;
    this._on_handlers.set(id, { eventname: "*", callback, filter: options?.filter });
    return id;
  }

  /** Return a promise waiting for the next occurence of the specified event
      @typeParam K - Type of the eventname (usually inferred automatically, for type checking purposes)
      @param eventname - Event name to match
      @param filter - Options
      @returns Data of triggered event
  */
  waitOn<K extends keyof T>(eventname: K, options?: EventHandlerOptions<T, K>): Promise<T[K]> {
    return new Promise(resolve => {
      const id = this.on(eventname, data => {
        this.off(id);
        resolve(data);
      }, options);
    });
  }

  /** Deregister an earler registered handler */
  off(id: ListenerId) {
    if (this._on_handlers.has(id))
      this._on_handlers.delete(id);
    else
      console.error(`Attempting to unregister handler #${id} but that handler ${id <= this._nextid ? " was already deregistered" : " was never registered"}`);
  }

  /** Emit an event. Note that you can only send a single parameter (usually an object) with an event as waitOn would not be able to return multiple arguments
      @typeParam K - Type of the eventname (usually inferred automatically, for type checking purposes)
      @param eventname - Event name to trigger
      @param data - Optional event data
  */
  protected emit<K extends keyof T>(eventname: K, data: T[K]) {
    for (const handlerentry of this._on_handlers) { //'of' iterates on a map copy so it doesn't get confused when handler callbacks modify the callback list
      const handler = handlerentry[1];
      if (handler.eventname === "*") {
        if (handler.filter && !handler.filter(data, eventname))
          continue;

        handler.callback(data, eventname);
      } else if (handler.eventname === eventname) {
        if (handler.filter && !handler.filter(data, eventname))
          continue;

        handler.callback(data, eventname);
      }
    }
  }
}
