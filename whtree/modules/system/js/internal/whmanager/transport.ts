import { MessageChannel, MessagePort, TransferListItem } from 'node:worker_threads';
import { dumpRefs } from './refs';
import { getCallStackAsText } from "@mod-system/js/internal/util/stacktrace";
import { debugFlags } from "@webhare/env";

const titlesymbol = Symbol("whRefTracker");

interface Trackable {
  [titlesymbol]: string;
}

const ports = new Array<WeakRef<MessagePort>>();

function setTrackingSymbol(obj: unknown, title = "unknown") {
  (obj as Trackable)[titlesymbol] = `MessagePort: '${title}'\n${debugFlags.async ? getCallStackAsText(1) : ""}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- allow all types of TypedMessagePort
export type AnyTypedMessagePort = TypedMessagePort<any, any>;

export interface TypedMessagePort<SendType extends object, ReceiveType extends object> {
  on(name: "message", cb: (message: ReceiveType) => void): void;
  on(name: "close", cb: () => void): void;
  postMessage(message: SendType, transferList?: ReadonlyArray<TransferListItem | AnyTypedMessagePort>): void;
  ref(): void;
  unref(): void;
  close(): void;
}


export function createTypedMessageChannel<SendType extends object, ReceiveType extends object>(title = "unknown"): { port1: TypedMessagePort<SendType, ReceiveType>; port2: TypedMessagePort<ReceiveType, SendType> } {
  const retval = new MessageChannel();
  setTrackingSymbol(retval.port1, title + " - port1");
  setTrackingSymbol(retval.port2, title + " - port2");

  ports.push(new WeakRef(retval.port1));
  ports.push(new WeakRef(retval.port2));

  return retval;
}

export function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
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
  ports.push(new WeakRef(port as MessagePort));
}
