import { MessageChannel, type MessagePort, type TransferListItem } from 'node:worker_threads';
import { dumpRefs } from './refs';
import { getCallStackAsText } from "@mod-system/js/internal/util/stacktrace";
import { debugFlags } from "@webhare/env";

const titlesymbol = Symbol("whRefTracker");

interface Trackable {
  [titlesymbol]: string;
}

class SetOfWeakRef<T extends object> extends Set<WeakRef<T>> {
  #finalization = new FinalizationRegistry<WeakRef<T>>(ref => this.delete(ref));
  add(value: WeakRef<T>): this {
    const deref = value.deref();
    if (deref) {
      this.#finalization.register(deref, value);
      return super.add(value);
    }
    return this;
  }
}

const ports = new SetOfWeakRef<MessagePort>();

export function getTrackingSymbol(obj: unknown): string | undefined {
  return (obj as Trackable)[titlesymbol];
}

function setTrackingSymbol(obj: unknown, title = "unknown") {
  (obj as Trackable)[titlesymbol] = `MessagePort: '${title}'\n${debugFlags.async ? getCallStackAsText(1) : ""}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- allow all types of TypedMessagePort
export type AnyTypedMessagePort = TypedMessagePort<any, any>;

export interface TypedMessagePort<SendType extends object, ReceiveType extends object> {
  on(name: "message", cb: (message: ReceiveType) => void): void;
  on(name: "close", cb: () => void): void;
  off(name: "message", cb: (message: ReceiveType) => void): void;
  off(name: "close", cb: () => void): void;
  postMessage(message: SendType, transferList?: ReadonlyArray<TransferListItem | AnyTypedMessagePort>): void;
  ref(): void;
  unref(): void;
  close(): void;
}


export function createTypedMessageChannel<SendType extends object, ReceiveType extends object>(title = "unknown"): { port1: TypedMessagePort<SendType, ReceiveType>; port2: TypedMessagePort<ReceiveType, SendType> } {
  const retval = new MessageChannel();
  setTrackingSymbol(retval.port1, title + " - port1");
  setTrackingSymbol(retval.port2, title + " - port2");

  ports.add(new WeakRef(retval.port1));
  ports.add(new WeakRef(retval.port2));

  return retval;
}

export function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer; //'as ArrayBuffer' is a TS 5.7 workaround, TODO can we undo this?
}

export function dumpActiveIPCMessagePorts({ onlyreferenced = true } = {}) {
  for (const a of ports) {
    const b = a.deref();
    if (b && (!onlyreferenced || (b as unknown as { hasRef(): boolean }).hasRef())) {
      console.log((b as unknown as Trackable)[titlesymbol]);
      dumpRefs(b);
      console.log(`\n`);
    }
  }
}

export function registerTransferredPort(port: AnyTypedMessagePort, title = "unknown") {
  setTrackingSymbol(port, title + " - transferred");
  ports.add(new WeakRef(port as MessagePort));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- need it for generics
export async function getSingleMessage<Response extends object>(port: TypedMessagePort<any, Response>): Promise<Response> {
  let removeListeners: (() => void) | undefined;
  try {
    return await new Promise<Response>((resolve, reject) => {
      const closer = () => reject(new Error("Service link was closed"));
      port.on("message", resolve);
      port.on("close", () => reject(new Error("Service link was closed")));
      removeListeners = () => {
        port.off("message", resolve);
        port.off("close", closer);
      };
    });
  } finally {
    removeListeners?.();
  }
}
