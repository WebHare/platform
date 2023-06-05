import * as test from "@webhare/test";
import { generateWRDDefs } from "@mod-system/js/internal/generation/gen_wrd";
import { allocateHSVM } from "@webhare/harescript/src/wasm-hsvm";

async function testFileGeneration() {
  const hsvm = await allocateHSVM();
  let result = await generateWRDDefs(hsvm, "webhare", ["system"]);

  //Basic sanity checks - we don't want to set up a full TS parser (yet?)
  result = result.replaceAll("\n", " ");
  test.eqMatch(/whuserDisabled/, result, "HS type WHUSER_DISABLED should appear as whuserDisabled in the output");
  test.eqMatch(/whuserDisableType/, result, "HS type WHUSER_DISABLE_TYPE should appear as whuserDisableType in the output");
}

test.run([testFileGeneration], { wrdauth: true });
