import * as test from "@webhare/test";
import { generateWRDDefs } from "@mod-system/js/internal/generation/gen_wrd";

async function testFileGeneration() {
  let result = await generateWRDDefs({ verbose: true }, "webhare", ["system"]);

  //Basic sanity checks - we don't want to set up a full TS parser (yet?)
  result = result.replaceAll("\n", " ");
  test.eq(/whuserDisabled/, result, "HS type WHUSER_DISABLED should appear as whuserDisabled in the output");
  test.eq(/whuserDisableType/, result, "HS type WHUSER_DISABLE_TYPE should appear as whuserDisableType in the output");
}

test.run([testFileGeneration], { wrdauth: true });
