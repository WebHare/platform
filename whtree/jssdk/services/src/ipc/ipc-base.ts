/* Shared between local & backend services */

import type { ServiceEventMessage, WebHareServiceDescription } from "@mod-system/js/internal/types";
import { setLink } from "../symbols";
import { HareScriptType } from "@webhare/hscompat/src/hson";

export interface LinkInterface {
  handler: BackendServiceConnection | null;
  // send(message: ServiceEventMessage, replyto?: bigint): bigint;
  send(message: ServiceEventMessage): void;
  close(): void;
}


/** Base class for service connections */
export class BackendServiceConnection implements Disposable {
  #link?: LinkInterface;
  #eventQueue?: Array<{ event: string; data: unknown }>;

  constructor() {
  }

  /** Emit an event to the client */
  emit(event: string, data: unknown) {
    if (!this.#link) {
      this.#eventQueue ||= [];
      this.#eventQueue.push({ event, data });
    } else {
      this.#link.send({ event, data });
    }
  }

  /** Invoke to close this connection. This will cause onClose to be invoked */
  [Symbol.dispose]() {
    this.#link?.close();
  }

  /** Invoked when the client explicitly closed the connection */
  onClose() {
  }

  //private api used to associate the connection with a link
  [setLink](link: LinkInterface) {
    while (this.#eventQueue?.length)
      link.send(this.#eventQueue.shift()!);

    this.#link = link;
    this.#eventQueue = undefined;
  }
}


//Describe a JS public interface in a HS compatible way
export function describePublicInterface(inobj: object): WebHareServiceDescription {
  const methods: WebHareServiceDescription["methods"] = [];
  const seenMethods = new Set<string>();

  // Hide any names of the base class - prevents them from being exposed if also defined by the service
  Object.getOwnPropertyNames(BackendServiceConnection.prototype).forEach(name => seenMethods.add(name));

  //iterate to top and discover all methods
  for (; inobj && !Object.hasOwn(inobj, setLink); inobj = Object.getPrototypeOf(inobj)) {
    for (const name of Object.getOwnPropertyNames(inobj)) {
      // Don't expose _-prefixed APIs (often 'internal' methods), anything we've already seen in higher classes, or BackendServiceConnection members (including 'constructor)
      if (name[0] === '_' || seenMethods.has(name))
        continue;

      seenMethods.add(name); //We're ignoring the risk of only case-differing identifiers sent to HareScript and clashing there. Just don't.

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- cleanup later, creating interfaces this way is ugly anyway
      const method = (inobj as any)[name];
      if (typeof method !== 'function')
        continue; //we only expose real functions, not variables, constants etc

      const params = [];
      for (let i = 0; i < method.length; ++i) //iterate arguments of method
        params.push({ type: HareScriptType.Variant, has_default: true }); //pretend all arguments to be VARIANTs in HareScript

      methods.push({
        signdata: {
          returntype: HareScriptType.Variant,  //variant return value
          params,
          excessargstype: -1
        },
        name
      });
    }
  }
  return { isjs: true, methods };
}
