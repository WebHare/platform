import type { ServiceCallMessage, ServiceCallResult, ServiceEventMessage, WebHareServiceDescription, WebHareServiceIPCLinkType } from "@mod-system/js/internal/types";
import bridge, { type IPCMarshallableData } from "@mod-system/js/internal/whmanager/bridge";
import type { PromisifyFunctionReturnType } from "@webhare/js-api-tools";
import { parseTyped, sleep, stringify } from "@webhare/std";
import type { BackendServices } from "@webhare/services";
import { getFullConfigFile } from "@mod-system/js/internal/configuration";
import { Socket } from "net";
import { UnixSocketLineBasedConnection, type USLMethodCall, type USLMethodResponse } from "@mod-system/js/internal/whmanager/unix-connections";
import { debugFlags } from "@webhare/env";

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

export class UnixSocketServiceBase extends EventTarget {
  #socket: Socket;

  constructor(socket: Socket) {
    super();
    this.#socket = socket;
  }

  close(): void {
    this.#socket.end();
  }

  [Symbol.dispose](): void {
    this.#socket.end();
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

export class UnixSocketServiceProxy<T extends object> extends UnixSocketLineBasedConnection<true> implements ProxyHandler<T & ServiceBase> {
  private openRequests = new Map<number, PromiseWithResolvers<unknown>>;
  nextMsgId = 0;
  constructorPromise?: Promise<unknown>;
  linger: boolean;

  constructor(private sb: UnixSocketServiceBase, socket: Socket, args: unknown[], awaitConstructor: boolean, linger: boolean) {
    super(socket);

    this.linger = linger;
    if (args.length || awaitConstructor) {
      this.constructorPromise = this.remotingFunc("constructor", args);
      this.constructorPromise.catch(() => { }); //prevent uncaught rejection
    }
  }

  processMessage(message: USLMethodResponse | ServiceEventMessage): void {
    if ("event" in message) {
      this.sb.dispatchEvent(new CustomEvent(message.event, { detail: message.data }));
      return;
    }
    if (!("id" in message))
      throw new Error("Invalid message received, missing id");

    const req = this.openRequests.get(message.id);
    if (!req)
      throw new Error(`No matching request for response with id ${message.id}`);

    if ("error" in message)
      req.reject(new Error(String(message.error)));
    else
      req.resolve(message.result);

    this.openRequests.delete(message.id);
    if (!this.linger && this.openRequests.size === 0) { //no more pending requests, allow the connection to close if it was idle before
      this.unref();
    }
  }

  processDisconnect(): void {
    for (const [, { reject }] of this.openRequests)
      reject(new Error(`Request is cancelled, link was closed`));
    this.sb.dispatchEvent(new CustomEvent("close"));
  }

  get(target: object, prop: string | symbol, receiver: unknown) {
    if (prop in target) //access to a function
      return (...params: unknown[]) => (target as Record<string | symbol, (...p: unknown[]) => unknown>)[prop](...params);
    if (!this.has(target, prop))
      return undefined;

    return (...args: unknown[]) => this.remotingFunc(prop as string, args);
  }

  has(target: object, prop: string | symbol): boolean {
    return prop in target || (typeof prop === "string" && !prop.startsWith("_") && !["then", "emit", "catch", "finally", "onClose"].includes(prop));
  }

  set(target: object, prop: string | symbol): boolean {
    throw new Error(`Cannot override service functions, trying to change property ${JSON.stringify(prop)}`);
  }

  async remotingFunc(method: string, args: unknown[]) {
    const id = ++this.nextMsgId;
    const calldata: USLMethodCall = { id, method, ...args ? { args } : null };
    const defer = Promise.withResolvers<unknown>();
    this.openRequests.set(id, defer);
    if (!this.linger && this.openRequests.size === 1) { //starting to wait for requests?
      this.ref();
    }
    this.send(calldata);
    return defer.promise;
  }
}

export type BackendServiceProtocol = "bridge" | "unix-socket";

export interface BackendServiceOptions {
  timeout?: number;
  ///Allow the service to linger, requiring an explicit close() to shut down. Often needed when you'll be listening for events.
  linger?: boolean;
  ///Do not try to autostart an ondemand service
  notOnDemand?: boolean;
  ///Force a specific protocol
  protocol?: BackendServiceProtocol;
  ///Force to wait for constructor completion
  awaitConstructor?: boolean;
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

//this may become openBackendService again if we manage to convert all services to unixsocket
async function openUnixSocketService<Service extends object>(name: string, args: unknown[], deadline: Promise<unknown>, options?: BackendServiceOptions): Promise<ConvertToClientInterface<Service> | null> {
  const socketDir = getFullConfigFile().socketDir;
  if (!socketDir)
    throw new Error("Socket directory is not configured");

  const targetPath = `${socketDir}${name}`;
  const socket = new Socket({});
  const defer = Promise.withResolvers<boolean>();
  //FIXME belongs in unix-connections

  const onConnectError = (e: Error) => {
    if (debugFlags["ipc-unixsockets"])
      console.log(`[ipc-unixsockets] Unix socket connection error on`, targetPath, e);

    defer.resolve(false);
  };

  socket.on("error", onConnectError);
  socket.connect(targetPath, () => {
    if (debugFlags["ipc-unixsockets"])
      console.log(`[ipc-unixsockets] Unix socket connected on`, targetPath);
    defer.resolve(true);
  });

  const connected = await Promise.race([defer.promise, deadline]);
  if (!connected) {
    socket.destroy();
    return null; //timeout!
  }

  socket.off("error", onConnectError);
  const sb = new UnixSocketServiceBase(socket);
  const proxy = new UnixSocketServiceProxy(sb, socket, args, options?.awaitConstructor || false, options?.linger || false);
  const service = new Proxy(sb, proxy) as ConvertToClientInterface<Service>;
  if (options?.awaitConstructor)
    await proxy.constructorPromise!;

  return service;
}

async function openBridgeIPCService<Service extends object>(name: string, args: unknown[], deadline: Promise<unknown>, options?: BackendServiceOptions): Promise<ConvertToClientInterface<Service> | null> {
  const link = bridge.connect<WebHareServiceIPCLinkType>("webhareservice:" + name, { global: true });
  const result = link.doRequest({ __new: (args as IPCMarshallableData[]) ?? [] }) as Promise<WebHareServiceDescription>;
  result.catch(() => false); // don't want this one to turn into an uncaught rejection

  try {
    //wrap activate() in a promise returning true, so we can differentiate from the deadline returning false
    const linkpromise = link.activate().then(() => true);

    const connected = await Promise.race([linkpromise, deadline]);
    if (!connected) {
      link.close();
      return null; //timeout!
    }
  } catch (e) {
    link.close();
    return null;
  }

  const description = await result;
  if (!options?.linger)
    link.dropReference();

  const sb = new ServiceBase(link);
  return new Proxy(sb, new ServiceProxy(sb, link, description)) as ConvertToClientInterface<Service>;
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
  let deadlineHit = false;
  const deadline = new Promise(resolve => setTimeout(() => resolve(false), options?.timeout || 30000).unref()).then(() => { deadlineHit = true; return false; });
  let attemptedstart = false;
  let waitMs = 1;
  args ||= [];

  // eslint-disable-next-line no-unmodified-loop-condition -- it will be changed through the deadline promise
  while (!deadlineHit) { //repeat until we're connected
    let uplink;
    if (options?.protocol === "unix-socket")
      uplink = await openUnixSocketService<Service>(name, args, deadline, options);
    else
      uplink = await openBridgeIPCService<Service>(name, args, deadline, options);

    if (!uplink) {
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
    return uplink;
  }
  throw new Error(`Service '${name}' is unavailable (tried to connect for ${Date.now() - startconnect} ms)`);
}
