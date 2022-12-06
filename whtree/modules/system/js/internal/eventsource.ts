export type EventCallback = (data: unknown, eventname: string) => unknown;
export type EventFilter = (data: unknown, eventname: string) => boolean;
export type ListenerId = number;

interface EventHandlerRecord {
  eventname: string;
  callback: EventCallback;
  filter: EventFilter | undefined;
  allevents: boolean;
}

export default class EventSource {
  private _nextid = 0;
  private _on_handlers = new Map<number, EventHandlerRecord>;

  /** Register a callback for every time an event is invoked

      @param eventname - Event name to match.
      @param callback - Callback to invoke
      @param filter - Optional filter to execute on the event */
  on(eventname: string, callback: EventCallback, filter?: EventFilter): ListenerId {
    const id = ++this._nextid;
    this._on_handlers.set(id, { eventname, callback, filter, allevents: false }); //webpack doesn't support options?. - radboud_events still needs this file
    return id;
  }

  /** Register a callback that will listen for all events (useful for forwarding or debugging)

      @param callback - Callback to invoke. The event name will be in the second parameter
      @param filter - Optional filter to execute on the event */
  onAll(callback: EventCallback, filter?: EventFilter): ListenerId {
    const id = ++this._nextid;
    this._on_handlers.set(id, { eventname: "*", callback, filter, allevents: true }); //webpack doesn't support options?. - radboud_events still needs this file
    return id;
  }

  /** Return a promise waiting for the next occurence of the specified event

      @param eventname - Event name to match
      @param filter - Optional filter to execute on the event */
  waitOn(eventname: string, filter?: EventFilter): Promise<unknown> {
    return new Promise(resolve => {
      const id = this.on(eventname, data => {
        this.off(id);
        resolve(data);
      }, filter);
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

      @param eventname - Event name to trigger
      @param data - Optional event data
  */
  emit(eventname: string, data?: unknown) {
    for (const handlerentry of this._on_handlers) { //'of' iterates on a map copy so it doesn't get confused when handler callbacks modify the callback list
      const handler = handlerentry[1];
      if (!handler.allevents && handler.eventname != eventname)
        continue;

      if (handler.filter && !handler.filter(data, eventname))
        continue;

      handler.callback(data, eventname);
    }
  }
}
