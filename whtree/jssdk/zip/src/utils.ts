// Utilities for zip

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SearchableArray = Readonly<Uint8Array> | readonly any[];

export function searchLastSubArray<T extends SearchableArray>(array: T, toSearch: T, startSearch?: number): number {
  if (startSearch !== undefined && startSearch > array.length - toSearch.length)
    startSearch = undefined;

  firstByteLoop:
  for (let idx = startSearch ?? (array.length - toSearch.length); idx >= 0; --idx) {
    idx = array.lastIndexOf(toSearch[0], idx);
    if (idx === -1)
      break;
    for (let c = 1; c < toSearch.length; c++) {
      if (array[idx + c] !== toSearch[c])
        continue firstByteLoop;
    }
    return idx;
  }
  return -1;
}

export function getDataViewFromUint8Array(buf: Uint8Array) {
  return new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
}

export function getUint8ArrayFromDataView(buf: DataView) {
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

export function uint8ArrayToHex(buf: Uint8Array) {
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function hexToUint8Array(hex: string) {
  const buf = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    buf[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return buf;
}

export function concatUint8Arrays(arrays: Uint8Array[]) {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const view = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    view.set(arr, offset);
    offset += arr.length;
  }
  return view;
}

export async function streamIntoBlob(stream: ReadableStream<Uint8Array>) {
  return await new Response(stream).blob();
}

export function collapsePathString(path: string, preserveTrailingSlash: boolean = false) {
  preserveTrailingSlash &&= path.endsWith("/");
  const startsSlash = path.startsWith("/") ? "/" : "";
  const parts = path.split("/").filter(_ => _ && _ !== ".");
  for (let i = 0; i < parts.length; ++i) {
    if (parts[i] === "..") {
      const removeBefore = Math.min(i, 1);
      parts.splice(i - removeBefore, 1 + removeBefore);
      i -= 1 + removeBefore;
    }
  }
  const retval = startsSlash + parts.join("/");
  return retval + (preserveTrailingSlash && !retval.endsWith("/") ? "/" : "");
}

const codePage437 = [
  //    0       1      2       3       4       5       6       7       8       9
  0x0000, 0x0001, 0x0002, 0x0003, 0x0004, 0x0005, 0x0006, 0x0007, 0x0008, 0x0009, //00-09
  0x000A, 0x000B, 0x000C, 0x000D, 0x000E, 0x000F, 0x0010, 0x0011, 0x0012, 0x0013,
  0x0014, 0x0015, 0x0016, 0x0017, 0x0018, 0x0019, 0x001A, 0x001B, 0x001C, 0x001D,
  0x001E, 0x001F, 0x0020, 0x0021, 0x0022, 0x0023, 0x0024, 0x0025, 0x0026, 0x0027,
  0x0028, 0x0029, 0x002A, 0x002B, 0x002C, 0x002D, 0x002E, 0x002F, 0x0030, 0x0031,
  0x0032, 0x0033, 0x0034, 0x0035, 0x0036, 0x0037, 0x0038, 0x0039, 0x003A, 0x003B, //50-59
  0x003C, 0x003D, 0x003E, 0x003F, 0x0040, 0x0041, 0x0042, 0x0043, 0x0044, 0x0045,
  0x0046, 0x0047, 0x0048, 0x0049, 0x004A, 0x004B, 0x004C, 0x004D, 0x004E, 0x004F,
  0x0050, 0x0051, 0x0052, 0x0053, 0x0054, 0x0055, 0x0056, 0x0057, 0x0058, 0x0059,
  0x005A, 0x005B, 0x005C, 0x005D, 0x005E, 0x005F, 0x0060, 0x0061, 0x0062, 0x0063,
  0x0064, 0x0065, 0x0066, 0x0067, 0x0068, 0x0069, 0x006A, 0x006B, 0x006C, 0x006D, //100-109
  0x006E, 0x006F, 0x0070, 0x0071, 0x0072, 0x0073, 0x0074, 0x0075, 0x0076, 0x0077,
  0x0078, 0x0079, 0x007A, 0x007B, 0x007C, 0x007D, 0x007E, 0x007F, 0x00C7, 0x00FC,
  0x00E9, 0x00E2, 0x00E4, 0x00E0, 0x00E5, 0x00E7, 0x00EA, 0x00EB, 0x00E8, 0x00EF,
  0x00EE, 0x00EC, 0x00C4, 0x00C5, 0x00C9, 0x00E6, 0x00C6, 0x00F4, 0x00F6, 0x00F2,
  0x00FB, 0x00F9, 0x00FF, 0x00D6, 0x00DC, 0x00A2, 0x00A3, 0x00A5, 0x00A7, 0x0192, //150-159
  0x00E1, 0x00ED, 0x00F3, 0x00FA, 0x00F1, 0x00D1, 0x00AA, 0x00BA, 0x00BF, 0x2310,
  0x00AC, 0x00BD, 0x00BC, 0x00A1, 0x00AB, 0x00BB, 0x2591, 0x2592, 0x2593, 0x2502,
  0x2524, 0x2561, 0x2562, 0x2556, 0x2555, 0x2563, 0x2551, 0x2557, 0x255D, 0x255C,
  0x255B, 0x2510, 0x2514, 0x2534, 0x252C, 0x251C, 0x2500, 0x253C, 0x255E, 0x255F,
  0x255A, 0x2554, 0x2569, 0x2566, 0x2560, 0x2550, 0x256C, 0x2567, 0x2568, 0x2564, //200-209
  0x2565, 0x2559, 0x2558, 0x2552, 0x2553, 0x256B, 0x256A, 0x2518, 0x250C, 0x2588,
  0x2584, 0x258C, 0x2590, 0x2580, 0x03B1, 0x00DF, 0x0393, 0x03C0, 0x03A3, 0x03C3,
  0x00B5, 0x03C4, 0x03A6, 0x0398, 0x03A9, 0x03B4, 0x221E, 0x03C6, 0x03B5, 0x2229,
  0x2261, 0x00B1, 0x2265, 0x2264, 0x2320, 0x2321, 0x00F7, 0X2248, 0x00B0, 0x2219,
  0x00B7, 0x221A, 0x207F, 0x00B2, 0x25A0, 0x00A0 //250-255
];

export function decodeCP437(data: Uint8Array): string {
  return Array.from(data).map((byte) => String.fromCodePoint(codePage437[byte])).join("");
}

export function encodeCP437(str: string, options?: { fallback?: string }): Uint8Array {
  let fallbackCP = -1;
  if (options?.fallback) {
    if ([...options.fallback].length !== 1)
      throw new Error(`Fallback string must be a single character`);
    fallbackCP = codePage437.indexOf(options.fallback.codePointAt(0) ?? -1);
    if (fallbackCP === -1)
      throw new Error(`Fallback character '${options.fallback}' not found in code page 437`);
  }
  return new Uint8Array(Array.from(str)
    .map(c => codePage437.indexOf(c.codePointAt(0) ?? -1))
    .map(_ => _ === -1 ? fallbackCP : _)
    .filter(_ => _ !== -1));
}

let utf8TextDecoder: TextDecoder | undefined;

export function isValidUTF8(data: Uint8Array): boolean {
  /// https://lemire.me/blog/2023/12/05/how-fast-can-you-validate-utf-8-strings-in-javascript/
  try {
    utf8TextDecoder ??= new TextDecoder("utf-8", { fatal: true });
    utf8TextDecoder.decode(data);
    return true;
  } catch {
    return false;
  }
}

export function readDOSDateTime(first: number, second: number): Date {
  const day = first & 0x1F;
  const month = ((first >> 5) & 0xF) - 1;
  const year = 1980 + ((first >> 9) & 0x7F);
  const seconds = (second & 0x1F) * 2;
  const minutes = (second >> 5) & 0x3F;
  const hours = (second >> 11) & 0x1F;
  return new Date(Date.UTC(year, month, day, hours, minutes, seconds));
}

export function makeDOSDateTime(date: Date | null): { mod_date: number; mod_time: number } {
  if (!date)
    return { mod_date: 0, mod_time: 0 };
  return {
    mod_date: ((date.getUTCDate() & 0x1F) | (((date.getUTCMonth() + 1) & 0xF) << 5) | (((date.getUTCFullYear() - 1980) & 0x7F) << 9)),
    mod_time: ((date.getUTCSeconds() / 2) & 0x1F) | ((date.getUTCMinutes() & 0x3F) << 5) | ((date.getUTCHours() & 0x1F) << 11),
  };
}

export class AsyncFifo<T> {
  private queue: T[] = [];
  private waiting: PromiseWithResolvers<void> | null = null;
  private closed = false;

  push(item: T) {
    if (this.closed)
      throw new Error("Cannot push to a closed FIFO");
    this.queue.push(item);
    this.waiting?.resolve();
    this.waiting = null;
  }
  close() {
    this.closed = true;
    this.waiting?.resolve();
  }

  /** Waits for an item or the fifo being closed. Returns `undefined` when closed */
  async get() {
    if (!this.queue.length && !this.closed)
      await (this.waiting ??= Promise.withResolvers()).promise;
    return this.queue.shift();
  }
}
