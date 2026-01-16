/** Type definitions for qpg driver */

/** Node's Buffer has a few undocumented read/write methods that are not officially documented but universally available
 * see https://github.com/nodejs/node/issues/46467 / https://github.com/nodejs/node/pull/48041
*/
export type UndocumentedBuffer = Buffer & {
  utf8Write: (string: string, offset?: number, maxLength?: number) => number;
  utf8Slice: (offset: number, end: number) => string;

  hexWrite: (string: string, offset?: number, maxLength?: number) => number;
  hexSlice: (start: number, end: number) => string;
};

/// Test if the undocumented Buffer functions are present and work as expected
export function testUndocumentedBufferFunctions() {
  {
    const buf = Buffer.from("Hello, world!") as UndocumentedBuffer;
    if (buf.utf8Slice(0, 5) !== "Hello")
      throw new Error("Buffer.utf8Slice() failed");
    if (buf.utf8Write("allo", 1) !== 4)
      throw new Error("Buffer.utf8Write() failed");
    if (buf.toString() !== "Hallo, world!")
      throw new Error("Buffer.utf8Write() failed");
  }
  {
    const buf = Buffer.alloc(17) as UndocumentedBuffer;
    buf.hexWrite("0123456789abcdef0123456789abcdef88", 0, 16); // should ignore the last two chars
    if (buf.hexSlice(0, 16) !== "0123456789abcdef0123456789abcdef")
      throw new Error("Buffer.hexWrite/hexSlice() failed");
    if (buf.hexSlice(0, 17) !== "0123456789abcdef0123456789abcdef00")
      throw new Error("Buffer.hexWrite/hexSlice() failed");
  }
}
