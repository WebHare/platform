/* eslint-disable @typescript-eslint/no-loop-func */
import bridge from "@mod-system/js/internal/whmanager/bridge";
import { broadcast, LocalCache } from "@webhare/services";
import * as test from "@webhare/test-backend";


async function localCacheTest() {
  const cache = new LocalCache<string>();

  let itr = 0;
  // STORY: caches values
  test.eq(null, cache.get({ a: 1 }));
  test.eq(`1-1`, await cache.get({ a: 1 }, () => ({ value: `1-${++itr}`, masks: ["webhare_testsuite:test"] })));
  test.eq(`1-1`, await cache.get({ a: 1 }, () => ({ value: `1-${++itr}`, masks: ["webhare_testsuite:test"] })));
  test.eq(`1-1`, cache.get({ a: 1 }));

  // STORY: clears on broadcast
  broadcast("webhare_testsuite:test");
  await test.wait(() => cache.get({ a: 1 }) === null);

  // STORY: handles multiple keys and string keys
  test.eq(`2-2`, await cache.get({ a: 2 }, () => ({ value: `2-${++itr}`, masks: ["webhare_testsuite:test"] })));
  test.eq(`2-2`, await cache.get({ a: 2 }, () => ({ value: `2-${++itr}`, masks: ["webhare_testsuite:test"] })));

  test.eq(`x-3`, await cache.get(`x`, () => ({ value: `x-${++itr}`, masks: ["webhare_testsuite:test"] })));
  test.eq(`x-3`, await cache.get(`x`, () => ({ value: `x-${++itr}`, masks: ["webhare_testsuite:test"] })));
  test.eq(`x-3`, cache.get(`x`));

  // STORY: handles objects
  const v = new Date;
  test.eq(`d-4`, await cache.get({ d: v }, () => ({ value: `d-${++itr}`, masks: ["webhare_testsuite:test"] })));
  test.eq(`d-4`, await cache.get({ d: v }, () => ({ value: `d-${++itr}`, masks: ["webhare_testsuite:test"] })));

  // STORY: expires items. TImeout-bases, so retry a few times to avoid flakes
  for (let i = 0; ; ++i) {
    try {
      itr = 0;
      test.eq(`e-1`, await cache.get({ e: 1 }, () => ({ value: `e-${++itr}`, ttl: 20, masks: ["webhare_testsuite:test"] })));
      test.eq(`e-1`, await cache.get({ e: 1 }, () => ({ value: `e-${++itr}`, ttl: 20, masks: ["webhare_testsuite:test"] })));
      await test.sleep(20);
      test.eq(null, cache.get({ e: 1 }));
      break;
    } catch (err) {
      if (i >= 10)
        throw err;
      console.log(`Expiry test failed with error ${err}, retrying...`);
    }
  }

  // Handle events during creation. 10 retries are done internally, then the last value is returned.
  itr = 0;
  test.eq(`f-11`, await cache.get({ f: 1 }, async () => {
    await new Promise<void>(resolve => {
      // broadcast the event, and make sure it is received before returning
      const l = bridge.on("event", (data) => {
        if (data.name === "webhare_testsuite:test" && (data.data as { itr: number }).itr === itr) {
          bridge.off(l);
          resolve();
        }
      });
      broadcast("webhare_testsuite:test", { itr });
    });
    return {
      value: `f-${++itr}`,
      masks: ["webhare_testsuite:test"],
    };
  }));
  test.eq(null, cache.get({ f: 1 }));
}

test.runTests([localCacheTest]);
