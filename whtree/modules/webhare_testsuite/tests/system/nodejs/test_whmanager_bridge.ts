import * as test from "@webhare/test";

import { createDeferred } from "@webhare/std";
import { WebHareBlob } from "@webhare/services";
import bridge from "@mod-system/js/internal/whmanager/bridge";

class FIFO<T> {
  queue: T[] = [];
  closed = false;
  defer = createDeferred<void>();

  push(t: T) {
    if (this.closed) {
      throw new Error(`FIFO already closed`);
      return;
    }
    this.queue.push(t);
    this.defer.resolve();
  }

  close() {
    this.closed = true;
    this.defer.resolve();
  }

  async asyncShift() {
    for (; ;) {
      await this.defer.promise;
      if (this.queue.length) {
        const retval = this.queue.shift();
        if (!this.queue.length && !this.closed)
          this.defer = createDeferred<void>();
        return retval;
      } else if (this.closed)
        return null;
    }
  }
}

async function testBridge() {

  // Logging
  {
    bridge.log("system:debug", { text: "js bridge test" });
    await bridge.flushLog("system:debug");
    // FIXME: test if log item was correctly delivered
  }

  // Story: connect to local port
  {
    const port = bridge.createPort("a");
    const clink = bridge.connect("a");
    clink.send({ a: 1 });

    port.on("accept", async (alink) => {
      alink.on("message", (evt) => {
        alink.send({ b: 1 }, evt.msgid);
        alink.close();
      });
      await alink.activate();
    });
    await port.activate();
    const defer = createDeferred<void>();
    clink.on("message", (evt) => {
      clink.close();
      defer.resolve();
    });
    await clink.activate();
    await defer.promise;
    port.close();
  }

  // STORY: connect to port in harescript process
  {
    const globallink = bridge.connect("webhare_testsuite:globalport", { global: true });

    const gl_fifo = new FIFO<unknown>();
    globallink.on("message", (evt) => gl_fifo.push(evt));
    globallink.on("close", () => gl_fifo.close());
    const sendres = globallink.send({ type: "sendreply" });
    await globallink.activate();
    test.eqPartial({
      message: { type: "reply" },
      replyto: sendres
    }, await gl_fifo.asyncShift());
    test.eq(null, await gl_fifo.asyncShift());
    globallink.close();
  }

  // STORY: sending and receiving fragmented messages to/from harescript
  {
    const globallink = bridge.connect("webhare_testsuite:globalport", { global: true });
    const buffer = Buffer.alloc(1000000);
    for (let i = 0; i < buffer.byteLength / 4; ++i) {
      buffer.writeInt32BE(i * 4, i * 4);
    }
    await globallink.activate();
    const reply = await globallink.doRequest({ type: "reflect", buffer: WebHareBlob.from(buffer) }) as { type: string; buffer: WebHareBlob };
    test.eq(0, Buffer.compare(buffer, Buffer.from(await reply.buffer.arrayBuffer())), "Buffer compare should return 0 (==equal)");
    globallink.close();
  }

  // STORY: connect to nonexisting port
  {
    test.throws(/Could not connect to local port "a"/, bridge.connect("a").activate());
    test.throws(/Could not connect to global port "a:a"/, bridge.connect("a:a", { global: true }).activate());
  }

  bridge.log("system:debug", { text: "js bridge final message" });
}

test.run([testBridge]);
