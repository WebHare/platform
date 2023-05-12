import * as test from "@mod-system/js/wh/testframework";
import testlist, { uuid4regex } from "./test_std_tests";
import { generateRandomId } from "@webhare/std";

function testUUIDFallback() {
  //@ts-ignore - we explicitly want to break stuff
  crypto.randomUUID = undefined;
  test.eqMatch(uuid4regex, generateRandomId("uuidv4", 16));
}

test.registerTests([
  ...testlist,
  testUUIDFallback
]);
