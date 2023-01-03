import * as test from "@webhare/test";

import { createDeferred } from "@mod-system/js/internal/tools";
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
  await bridge.log("system:debug", "js bridge test");
  await bridge.flushLog("system:debug");

  // FIXME: test if log item was correctly delivered
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
    test.eqProps({
      message: { type: "reply" },
      replyto: sendres
    }, await gl_fifo.asyncShift());
    test.eq(null, await gl_fifo.asyncShift());
  }
}

test.run([testBridge]);
