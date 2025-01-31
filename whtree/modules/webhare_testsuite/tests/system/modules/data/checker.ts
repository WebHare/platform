import { readRegistryKey, type CheckFunction } from "@webhare/services";

export async function runTestsuiteCheck() {
  const response = await readRegistryKey("webhare_testsuite:tests.response");
  if (response !== "checker.ts test")
    return [];

  return [
    {
      type: "webhare_testsuite:error1",
      metadata: null,
      messageText: `Test error #1`,
      jumpTo: null,
      scopes: []
    }
  ];
}

runTestsuiteCheck satisfies CheckFunction;
