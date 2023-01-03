import { MessageChannel, TransferListItem } from 'node:worker_threads';

const titlesymbol = Symbol("whRefTracker");

interface Trackable {
  [titlesymbol]: string;
}

function setTrackingSymbol(obj: unknown, title = "unknown") {
  (obj as Trackable)[titlesymbol] = title + "\n" + (new Error().stack || "");
}

export interface TypedMessagePort<SendType extends object, ReceiveType extends object> {
  on(name: "message", cb: (message: ReceiveType) => void): void;
  on(name: "close", cb: () => void): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  postMessage(message: SendType, transferList?: ReadonlyArray<TransferListItem | TypedMessagePort<any, any>>): void;
  ref(): void;
  unref(): void;
  close(): void;
}

export function createTypedMessageChannel<SendType extends object, ReceiveType extends object>(title = "unknown"): { port1: TypedMessagePort<SendType, ReceiveType>; port2: TypedMessagePort<ReceiveType, SendType> } {
  const retval = new MessageChannel();
  setTrackingSymbol(retval.port1, title + " - port1");
  setTrackingSymbol(retval.port2, title + " - port2");

  return retval;
}

export function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}
