import * as test from "@mod-system/js/wh/testframework";
import { TestList } from "./test";

export async function run(tests: TestList, options?: object) {
  test.registerTests(tests);
}
