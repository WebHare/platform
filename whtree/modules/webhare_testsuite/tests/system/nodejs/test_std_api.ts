import * as test from "@webhare/test";
import * as api from "@webhare/std/api";

//Test helpers for building APIs

async function testAPI() {
  //convertWaitPeriodToDate
  test.eq(-864000 * 1000 * 10000000, api.convertWaitPeriodToDate(0).getTime(), "minimum date");
  test.eq(864000 * 1000 * 10000000, api.convertWaitPeriodToDate(Infinity).getTime(), "maximum date");

  const now = Date.now(), soon = api.convertWaitPeriodToDate(100);
  test.assert(now <= soon.getTime() && soon.getTime() <= now + 1000);

  await test.throws(/Invalid wait duration/, () => api.convertWaitPeriodToDate(-1));
  await test.throws(/Invalid wait duration/, () => api.convertWaitPeriodToDate(7 * 86400 * 1000 + 1));
  await test.throws(/Invalid wait duration/, () => api.convertWaitPeriodToDate(Date.now()));
}

test.run([testAPI]);
