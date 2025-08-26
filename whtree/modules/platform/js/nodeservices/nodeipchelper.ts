import { getHareScriptResourceDescriptor } from "@webhare/hscompat/hson";
import { isResourceDescriptor } from "@webhare/services/src/descriptor";
import { WebHareDiskBlob, WebHareMemoryBlob } from "@webhare/services/src/webhareblob";
import { Money, stdTypeOf } from "@webhare/std";
import { getWHType } from "@webhare/std/quacks";
import type { TransferListItem } from "node:worker_threads";

function runReplacerRecursive(value: unknown, replacer: (arg: object) => object | undefined): unknown {
  if (typeof value === "object" && value) {
    if (Array.isArray(value))
      return value.map((item) => typeof item === "object" && item ? runReplacerRecursive(item, replacer) : item);
    const replaced = replacer(value as object);
    if (!replaced)
      value = Object.fromEntries(Object.entries(value as object).map(([key, val]) => [key, typeof val === "object" && val ? runReplacerRecursive(val, replacer) : val]));
    else
      value = replaced;
  }
  return value;
}

export function encodeforMessageTransfer(toEncode: unknown): Promise<{ value: unknown; transferList: TransferListItem[] }> | { value: unknown; transferList: TransferListItem[] } {
  const promises: Array<Promise<void>> = [];
  const transferList: TransferListItem[] = [];
  const retval = runReplacerRecursive(toEncode, (orgValue) => {
    const type = stdTypeOf(orgValue);
    switch (type) {
      case "Date":
        return { "$ipcType": "Date", date: (orgValue as Date).toISOString() };
      case "Money":
      case "bigint":
      case "Instant":
      case "PlainDate":
      case "PlainDateTime":
      case "ZonedDateTime":
        return { "$ipcType": type, [type.toLowerCase()]: (orgValue as { toString: () => string }).toString() };
      case "Blob": {
        switch (getWHType(orgValue)) {
          case "WebHareMemoryBlob": {
            const blob = orgValue as WebHareMemoryBlob;
            const newBuffer = blob.data.buffer.slice(blob.data.byteOffset, blob.data.byteOffset + blob.data.byteLength) as ArrayBuffer;
            transferList.push(newBuffer);
            return {
              "$ipcType": "WebHareMemoryBlob",
              type: blob.type,
              data: newBuffer
            };
          }
          case "WebHareDiskBlob": {
            //IPC can 't do diskblob:
            //value = { "$ipcType": "WebHareDiskBlob", type: orgValue.type, path: orgValue.path, size: orgValue.size };

            //async transfer as UInt8Buffer (as JS Blobs aren't IPC/CallJS safe anyway)
            const blob = orgValue as WebHareDiskBlob;
            const value = { "$ipcType": "WebHareMemoryBlob", type: blob.type, data: undefined as ArrayBuffer | undefined }; //we'll modify this value when completing the promise
            const promiseBuffer = blob.arrayBuffer().then((buffer) => {
              value.data = buffer;
              transferList.push(buffer);
            });
            promises.push(promiseBuffer);
            return value;
          }
          default:
            throw new Error(`Cannot encode Blob of type '${orgValue.constructor.name}' as a message transfer value. Use WebHareMemoryBlob or WebHareDiskBlob instead.`);
        }
      } break;
      case "object":
        if ("$ipcType" in (orgValue as { "$ipcType": string }))
          throw new Error(`Cannot encode objects with already embedded '$ipcType's`);

        if (isResourceDescriptor(orgValue)) { //TODO if we want to use encodeforMessageTransfer more generally than just for CallJS we need to return $ipcType: ResourceDescriptor and properly restore it, and have IPC's writeMarshalDataInternal do the getHareScriptResourceDescriptor call
          const forhs = getHareScriptResourceDescriptor(orgValue);
          const value = { ...forhs, data: { "$ipcType": "WebHareMemoryBlob", type: forhs.data.type, data: undefined as ArrayBuffer | undefined } }; //we'll modify this value when completing the promise
          const promiseBuffer = forhs.data.arrayBuffer().then((buffer) => {
            value.data.data = buffer;
            transferList.push(buffer);
          });
          promises.push(promiseBuffer);
          return value;
        }

        if (Buffer.isBuffer(orgValue)) {
          const data: ArrayBuffer = orgValue.buffer.slice(orgValue.byteOffset, orgValue.byteOffset + orgValue.byteLength) as ArrayBuffer;
          transferList.push(data);
          return { "$ipcType": "Buffer", data };
        }
    }
    //fallthrough
    return undefined;
  });
  if (promises.length)
    return Promise.all(promises).then(() => ({ value: retval, transferList }));
  return { value: retval, transferList };
}

export function decodeFromMessageTransfer(toDecode: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return runReplacerRecursive(toDecode, (value: any) => {
    switch (value?.["$ipcType"]) {
      case "Money":
        return new Money(value.money);
      case "Date":
        return new Date(value.date);
      case "bigint":
      case "BigInt": //pre wh5.7 spelling
        return BigInt(value.bigint as string);
      case "Instant":
      case "PlainDate":
      case "PlainDateTime":
      case "ZonedDateTime":
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- we just assume/require you to have Temporal installed if you expect to receive/decode Temporal types. browsers should catch up eventually
        if (!(globalThis as any).Temporal)
          throw new Error(`Temporal is not available in this environment, cannot deserialize value of type Temporal.${value["$ipcType"]}. Load eg. @webhare/deps/temporal-polyfill to use Temporal types in browsers`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- we just assume/require you to have Temporal installed if you expect to receive/decode Temporal types. browsers should catch up eventually
        return (globalThis as any).Temporal[value["$ipcType"]].from(value[value["$ipcType"].toLowerCase()]);
      case "WebHareMemoryBlob":
        return new WebHareMemoryBlob(new Uint8Array(value.data), value.type);
      case "WebHareDiskBlob": //NOTE not yet generated as IPC can't deal with it
        return new WebHareDiskBlob(value.size as number, value.path as string, { type: value.type as string });
      case "Blob":
        return new Blob([value.data]);
      case "Buffer":
        return Buffer.from(value.data as ArrayBuffer);
      case undefined:
        return undefined;
      default:
        throw new Error(`Unrecognized type '${value["$ipcType"]}'`);
    }
  });
}
