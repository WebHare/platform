import * as test from "@webhare/test-backend";
import { convertToWillPublish, PubPrio_Scheduled } from "@webhare/whfs/src/support";

function testRepublishPriority() {
  test.eq(100006, convertToWillPublish(100000, false, false, PubPrio_Scheduled), "An already published file must be queued again");
  test.eq(0, convertToWillPublish(0, false, false, PubPrio_Scheduled), "Republish must not enable a disabled file");
  test.eq(6, convertToWillPublish(0, false, true, PubPrio_Scheduled), "Explicit enable remains supported");
  test.eq(100001, convertToWillPublish(100001, false, false, PubPrio_Scheduled), "An existing higher priority must be preserved");
  test.eq(6, convertToWillPublish(100000, true, false, PubPrio_Scheduled), "First publication at a new location resets the previous publication flag");
}

test.runTests([testRepublishPriority]);
