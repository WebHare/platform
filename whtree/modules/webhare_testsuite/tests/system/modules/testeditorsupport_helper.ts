import bridge from "@mod-system/js/internal/whmanager/bridge";


export async function testLogError() {
  try {
    throw new Error("test-notice-log-js", { cause: new Error("cause1", { cause: new Error("cause2") }) });
  } catch (e) {
    bridge.logError(e as Error, { info: { context: "webhare_testsuite:testeditorsupport" } });
  }
  await bridge.ensureDataSent();
}
