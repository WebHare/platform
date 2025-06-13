import type { ServiceCallMessage, ServiceCallResult, WebHareServiceDescription, WebHareServiceIPCLinkType } from "@mod-system/js/internal/types";
import bridge, { type IPCMarshallableData } from "@mod-system/js/internal/whmanager/bridge";
import type { PromisifyFunctionReturnType } from "@webhare/js-api-tools";
import { parseTyped, sleep, stringify } from "@webhare/std";
import type { BackendServices } from "@webhare/services";

/** Get the client interface for a given backend service
 *
 * @example GetBackendServiceInterface\<"platform:servicemanager"\>
*/
export type GetBackendServiceInterface<T extends keyof BackendServices> = T extends keyof BackendServices ? ConvertToClientInterface<BackendServices[T]> : never;

export class ServiceBase extends EventTarget {
  #link: WebHareServiceIPCLinkType["ConnectEndPoint"];

  constructor(link: WebHareServiceIPCLinkType["ConnectEndPoint"]) {
    super();
    this.#link = link;
  }

  close(): void {
    this.#link.close();
  }

  [Symbol.dispose](): void {
    this.#link.close();
  }
}

export class ServiceProxy<T extends object> implements ProxyHandler<T & ServiceBase> {
  link: WebHareServiceIPCLinkType["ConnectEndPoint"];
  isjs: boolean;
  sb: ServiceBase;
  description: WebHareServiceDescription;

  constructor(sb: ServiceBase, link: WebHareServiceIPCLinkType["ConnectEndPoint"], description: WebHareServiceDescription) {
    this.sb = sb;
    this.link = link;
    link.on("message", _ => this.onMessage(_));
    link.on("close", _ => this.onClose());

    this.description = description;
    this.isjs = description.isjs || false;
  }

  get(target: object, prop: string | symbol, receiver: unknown) {
    if (prop in target) //access to a function
      return (...params: unknown[]) => (target as Record<string | symbol, (...p: unknown[]) => unknown>)[prop](...params);

    if (typeof prop === "string") {
      if (!this.isjs)
        prop = prop.toUpperCase();

      if (this.description.methods.find(m => m.name === prop))
        return (...args: unknown[]) => this.remotingFunc({ name: prop as string }, args);
    }

    return undefined;
  }

  has(target: object, prop: string): boolean {
    if (!this.isjs)
      prop = prop.toUpperCase();
    return Boolean(this.description.methods.find(m => m.name === prop)) || prop === "close";
  }

  set(target: object, prop: string): boolean {
    throw new Error(`Cannot override service functions, trying to change property ${JSON.stringify(prop)}`);
  }

  async remotingFunc(method: { name: string }, args: unknown[]) {
    const calldata: ServiceCallMessage = { call: method.name };
    if (this.isjs)
      calldata.jsargs = stringify(args, { typed: true });
    else
      calldata.args = args as IPCMarshallableData[];

    const response = await this.link.doRequest(calldata) as ServiceCallResult;
    if (this.isjs)
      return response.result ? parseTyped(response.result as string) : undefined;
    else
      return response.result;
  }

  onMessage(msg: WebHareServiceIPCLinkType["ConnectEndPointPacket"]) {
    if ("event" in msg.message)
      this.sb.dispatchEvent(new CustomEvent(msg.message.event, { detail: msg.message.data }));
    else
      console.error("Unknown message type", msg);
  }

  onClose() {
    this.sb.dispatchEvent(new CustomEvent("close"));
  }
}

export interface BackendServiceOptions {
  timeout?: number;
  ///Allow the service to linger, requiring an explicit close() to shut down. Often needed when you'll be listening for events.
  linger?: boolean;
  ///Do not try to autostart an ondemand service
  notOnDemand?: boolean;
}

/** Converts the interface of a WebHare service to the interface used by a client.
 * Removes the "close" method and all methods starting with `_`, and converts all return types to a promise. Readds "close" as added by ServiceBase
 * @typeParam BackendHandlerType - Type definition of the service class that implements this service.
*/
type ConvertToClientInterface<BackendHandlerType extends object> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- using any is needed for this type definition
  [K in Exclude<keyof BackendHandlerType, `_${string}` | "close" | "emit" | "onClose"> as BackendHandlerType[K] extends (...a: any) => any ? K : never]: BackendHandlerType[K] extends (...a: any[]) => void ? PromisifyFunctionReturnType<BackendHandlerType[K]> : never;
} & ServiceBase;

async function attemptAutoStart(name: string) {
  //TODO avoid a thundering herd, throttle repeated auto starts form our side
  //TODO check configuration (where will we persist the service list) whether this service can be started on demand
  //notOnDemand to prevent a loop if platform:servicemanager itself is unavailable
  using smservice = await openBackendService("platform:servicemanager", [], { timeout: 5000, notOnDemand: true });
  await smservice.startService(name);
}

//If the backendservice was properly defined in the @webhare/services BackendServices interface, we can return that type
export function openBackendService<ServiceName extends keyof BackendServices>(name1: ServiceName, args?: unknown[], options?: BackendServiceOptions): Promise<GetBackendServiceInterface<ServiceName>>;
//Otherwise you'll have to give an explicit type
export function openBackendService<Service extends object>(name: string, args?: unknown[], options?: BackendServiceOptions): Promise<ConvertToClientInterface<Service>>;

/** Open a WebHare backend service
 *  @param name - Service name (a module:service pair). Add this name to the BackendServices interface for automatic service type discovery
 *  @param args - Arguments to pass to the constructor
 *  @param options - timeout: Maximum time to wait for the service to come online in msecs (default: 30sec)
 *                   linger: If true, service requires an explicit close() and will keep the process running
 * @typeParam Service - Type definition of the service class that implements this service.
 */
export async function openBackendService<Service extends object>(name: string, args?: unknown[], options?: BackendServiceOptions): Promise<ConvertToClientInterface<Service>> {
  const startconnect = Date.now(); //only used for exception reporting
  const deadline = new Promise(resolve => setTimeout(() => resolve(false), options?.timeout || 30000).unref());
  let attemptedstart = false;
  let waitMs = 1;

  for (; ;) { //repeat until we're connected
    const link = bridge.connect<WebHareServiceIPCLinkType>("webhareservice:" + name, { global: true });
    const result = link.doRequest({ __new: (args as IPCMarshallableData[]) ?? [] }) as Promise<WebHareServiceDescription>;
    result.catch(() => false); // don't want this one to turn into an uncaught rejection

    //Try to setup a link. Loop until deadline if activate() fails
    try {
      //wrap activate() in a promise returning true, so we can differentiate from the deadline returning false
      const linkpromise = link.activate().then(() => true);

      const connected = await Promise.race([linkpromise, deadline]);
      if (!connected) {
        link.close();
        break; //timeout!
      }
    } catch (e) {
      link.close();
      if (!attemptedstart && !options?.notOnDemand) {
        attemptAutoStart(name).catch(() => { }); //ignore exceptions, we'll just timeout then
        attemptedstart = true;
      } else {
        // Exponential backoff until 100 ms
        await sleep(waitMs);
        waitMs = Math.min(waitMs * 2, 100);
      }
      continue;
    }

    try {
      const description = await result;
      if (!options?.linger)
        link.dropReference();

      const sb = new ServiceBase(link);
      return new Proxy(sb, new ServiceProxy(sb, link, description)) as ConvertToClientInterface<Service>;
    } catch (e) {
      link.close();
      throw e; //not relooping if describing fails
    }
  }
  throw new Error(`Service '${name}' is unavailable (tried to connect for ${Date.now() - startconnect} ms)`);
}
