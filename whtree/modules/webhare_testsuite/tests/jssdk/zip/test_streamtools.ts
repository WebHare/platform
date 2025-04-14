import * as test from "@webhare/test-backend";
import { FileBasedStreamsBuffer, getCalculateLengthAndCRC32Transform, MemoryStreamsBuffer } from "@webhare/zip/src/streamtools";

async function testCalcLen() {
  const transform = getCalculateLengthAndCRC32Transform();

  // CRC32 checked with https://crccalc.com/?crc=&method=CRC-32/ISO-HDLC&datatype=ascii&outtype=hex
  test.eq("12345", await (await new Response(new Blob(["12345"]).stream().pipeThrough(transform.transformStream)).blob()).text());
  test.eq({ size: 5, crc32: 3421846044 }, await transform.done);

  const transform2 = getCalculateLengthAndCRC32Transform();
  test.eq("", await (await new Response(new Blob([""]).stream().pipeThrough(transform2.transformStream)).blob()).text());
  test.eq({ size: 0, crc32: 0 }, await transform2.done);
}

async function testBuffer() {
  const chunk = new Uint8Array(256 * 1024);
  const chunkCount = 10;

  {
    console.log(`create readable`);
    const readable = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < chunkCount; i++)
          controller.enqueue(chunk);
        controller.close();
      }
    });

    console.log(`create memory buffer`);
    const sb = new MemoryStreamsBuffer();
    const stream = sb.getStreamBuffer();

    console.log(`create length transform`);
    const transform = getCalculateLengthAndCRC32Transform();

    console.log(`sleep a bit`);
    await new Promise(r => setTimeout(r, 100));

    console.log(`pipe through length transform to buffer writable`);
    await readable.pipeThrough(transform.transformStream).pipeTo(stream.writable);

    // entire stream should be buffered
    console.log(`wait for length transform to completely transform`);
    await test.wait(transform.done);
    test.eq(chunkCount * chunk.length, (await transform.done).size);

    console.log(`gathering the result data`);
    test.eq(chunkCount * chunk.length, (await new Response(stream.readable).blob()).size);
  }

  {
    console.log(`create readable`);
    const readable = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < chunkCount; i++)
          controller.enqueue(chunk);
        controller.close();
      }
    });

    console.log(`create disk-based buffer`);
    const sb = new FileBasedStreamsBuffer();
    const stream = sb.getStreamBuffer();

    console.log(`create length transform`);
    const transform = getCalculateLengthAndCRC32Transform();

    console.log(`sleep a bit`);
    await new Promise(r => setTimeout(r, 100));

    console.log(`pipe through length transform to buffer writable`);
    await readable.pipeThrough(transform.transformStream).pipeTo(stream.writable);

    // entire stream should be buffered
    console.log(`wait for length transform to completely transform`);
    await test.wait(transform.done);
    test.eq(chunkCount * chunk.length, (await transform.done).size);

    console.log(`gathering the result data`);
    test.eq(chunkCount * chunk.length, (await new Response(stream.readable).blob()).size);
  }
}

test.runTests([
  testCalcLen,
  testBuffer
]);
