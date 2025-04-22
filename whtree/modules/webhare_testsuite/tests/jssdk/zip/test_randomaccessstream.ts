import * as test from "@webhare/test-backend";
import { promises as fs } from "node:fs";
import { RandomAccessReadStream } from "@webhare/zip/src/randomaccessstream";
import path from "node:path";
import { backendConfig } from "@webhare/services";

async function testRandomAccessReadStream() {

  // Test ArrayBufferRandomAccessReadStream
  {
    await using str = await RandomAccessReadStream.from(new Uint8Array([1, 2, 3, 4, 5]));

    test.eq(5, await str.size());

    const r1 = await str.read({ length: 3, position: 0 });
    test.eq(3, r1.bytesRead);
    test.eq([1, 2, 3], [...r1.buffer]);

    // read more than available in the stream
    const r2 = await str.read({ buffer: r1.buffer, length: 3, position: 3 });
    test.eq(2, r2.bytesRead);
    test.eq([4, 5, 3], [...r1.buffer]);

    // read more than available in data
    await test.throws(/Not enough bytes/, str.read({ length: 5, exactLength: true, position: 1 }));

    const r3 = await str.read({ length: 1, position: 2 });
    test.eq(1, r3.bytesRead);
    test.eq([3], [...r3.buffer]);

    const buf = new Uint8Array(5);
    const r4 = await str.read({ buffer: buf, offset: 1, length: 2, position: 2 });
    test.eq(2, r4.bytesRead);
    test.eq([0, 3, 4, 0, 0], [...buf]);

    // try to read more than fits in the buffer
    const r5 = await str.read({ buffer: buf, offset: 4, length: 2, position: 1 });
    test.eq(1, r5.bytesRead);
    test.eq([0, 3, 4, 0, 2], [...buf]);
  }

  {
    const sourceData = crypto.getRandomValues(new Uint8Array(65536));

    await using arrayBufferStream = await RandomAccessReadStream.from(sourceData);
    await using blobStream = await RandomAccessReadStream.from(new Blob([sourceData]));

    const tmpDir = process.env.WEBHARE_TEMP || path.join(backendConfig.dataRoot || "tmp/");
    const tempname = path.join(tmpDir, "$tmp$" + Math.random());
    await fs.writeFile(tempname, sourceData, { flag: "wx" });
    await using fileStream = await RandomAccessReadStream.fromDisk(tempname);
    await using streamStream = await RandomAccessReadStream.from(new Blob([sourceData]).stream());

    // fuzz the other readers
    for (let i = 0; i < 1000; ++i) {
      const offset = Math.floor(Math.random() * sourceData.length);
      const length = Math.floor(Math.random() * (sourceData.length + 256 - offset));
      const position = Math.floor(Math.random() * (sourceData.length + 256 - length));

      const buffer = Math.random() < 0.1 ? new Uint8Array(Math.max(length - 128 + Math.floor(Math.random() * 512), 256)) : undefined;

      console.log(`test ${i.toString().padStart(5, " ")}: offset=${offset.toString().padStart(6, " ")}, length=${length.toString().padStart(6, " ")}, position=${position.toString().padStart(6, " ")}, buffer: ${buffer ? buffer.length.toString().padStart(6, " ") : "   N/A"}`);

      const arrayBufferResult = await arrayBufferStream.read({ buffer, length, position });
      const blobResult = await blobStream.read({ buffer, length, position });
      const fileResult = await fileStream.read({ buffer, length, position });
      const streamResult = await streamStream.read({ buffer, length, position });

      console.log(`  result: ${arrayBufferResult.bytesRead.toString().padStart(6, " ")}, ${blobResult.bytesRead.toString().padStart(6, " ")}, ${fileResult.bytesRead.toString().padStart(6, " ")}, ${streamResult.bytesRead.toString().padStart(6, " ")}`);
      console.log(`  buffer: ${arrayBufferResult.buffer.byteLength.toString().padStart(6, " ")}, ${blobResult.buffer.byteLength.toString().padStart(6, " ")}, ${fileResult.buffer.byteLength.toString().padStart(6, " ")}, ${streamResult.buffer.byteLength.toString().padStart(6, " ")}`);

      test.eq(blobResult.bytesRead, arrayBufferResult.bytesRead);
      test.eq(fileResult.bytesRead, arrayBufferResult.bytesRead);
      test.eq(streamResult.bytesRead, arrayBufferResult.bytesRead);

      test.eq([...arrayBufferResult.buffer], [...blobResult.buffer]);
      test.eq([...arrayBufferResult.buffer], [...fileResult.buffer]);
      test.eq([...arrayBufferResult.buffer], [...streamResult.buffer]);
    }

    {
      for (const str of [
        arrayBufferStream,
        blobStream,
        fileStream,
        streamStream,
      ]) {


        // test that multiple streams can be active
        const ar1 = str.stream({ start: 0 });
        const ar1r = ar1.getReader();
        const ar2 = str.stream({ start: 0 });
        const ar2r = ar2.getReader();

        await ar1r.read();
        await ar2r.read();
        ar1r.releaseLock();
        ar2r.releaseLock();
      }
    }
  }
}


test.runTests([testRandomAccessReadStream]);
