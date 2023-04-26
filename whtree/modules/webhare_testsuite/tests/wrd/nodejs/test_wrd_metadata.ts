import * as test from "@webhare/test";
import { generateWRDDefs } from "@mod-system/js/internal/generation/gen_wrd";

async function testFileGeneration() {
  let result = await generateWRDDefs("webhare", ["system"]);

  //Basic sanity checks - we don't want to set up a full TS parser (yet?)
  result = result.replaceAll("\n", " ");
  test.eqMatch(/whuserDisabled/, result, "HS type WHUSER_DISABLED should appear as whuserDisabled in the output");
}

test.run([testFileGeneration], { wrdauth: true });
