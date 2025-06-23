import { WebHareMemoryBlob } from "@webhare/services/src/webhareblob";
import { Money, stdTypeOf } from "@webhare/std";
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
    let value: object | undefined = undefined;
    const type = stdTypeOf(orgValue);
    switch (type) {
      case "Date":
        value = { "$ipcType": "Date", date: (orgValue as Date).toISOString() };
        break;
      case "Money":
      case "bigint":
      case "Instant":
      case "PlainDate":
      case "PlainDateTime":
      case "ZonedDateTime":
        value = { "$ipcType": type, [type.toLowerCase()]: (orgValue as { toString: () => string }).toString() };
        break;
      case "Blob": {
        if (orgValue instanceof WebHareMemoryBlob) {
          const newBuffer = orgValue.data.buffer.slice(orgValue.data.byteOffset, orgValue.data.byteOffset + orgValue.data.byteLength) as ArrayBuffer;
          value = {
            "$ipcType": "WebHareMemoryBlob",
            type: orgValue.type,
            data: newBuffer
          };
          transferList.push(newBuffer);
        } else if (!(orgValue instanceof Blob)) {
          value = { "$ipcType": "Blob", type: (orgValue as Blob).type };
          promises.push((orgValue as Blob).arrayBuffer().then((buffer) => {
            (orgValue as { "$ipcType": string; data: ArrayBuffer }).data = buffer;
            transferList.push(buffer);
          }));
        }
      } break;
      case "object":
        if ("$ipcType" in (orgValue as { "$ipcType": string }))
          throw new Error(`Cannot encode objects with already embedded '$ipcType's`);
    }
    //fallthrough
    return value;
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
      case "Blob":
        return new Blob([value.data]);
      case undefined:
        return undefined;
      default:
        throw new Error(`Unrecognized type '${value["$ipcType"]}'`);
    }
  });
}
