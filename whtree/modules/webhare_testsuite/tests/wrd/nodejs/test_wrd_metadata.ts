import * as test from "@webhare/test";
import { generateWRDDefs } from "@mod-system/js/internal/generation/gen_wrd";
import { buildGeneratorContext } from "@mod-system/js/internal/generation/generator";

async function testFileGeneration() {
  const context = await buildGeneratorContext(["system"], true);
  let result = await generateWRDDefs(context, "platform");

  //Basic sanity checks - we don't want to set up a full TS parser (yet?)
  result = result.replaceAll("\n", " ");
  test.eq(/whuserDisabled/, result, "HS type WHUSER_DISABLED should appear as whuserDisabled in the output");
  test.eq(/whuserDisableType/, result, "HS type WHUSER_DISABLE_TYPE should appear as whuserDisableType in the output");
}

test.run([testFileGeneration], { wrdauth: true });
