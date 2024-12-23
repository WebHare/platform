import * as test from "@mod-system/js/wh/testframework";
import { TestList } from "./test";

export async function runTests(tests: TestList, options?: object) {
  test.runTests(tests);
}
