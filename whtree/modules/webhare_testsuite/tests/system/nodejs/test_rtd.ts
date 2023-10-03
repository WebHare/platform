import { createRichDocument } from "@webhare/services/src/rtdbuilder";
import * as test from "@webhare/test";

async function testRTDCreation() {
  const richdoc = await createRichDocument([
    { blockType: "h2", contents: "Intro" },
    { blockType: "p", contents: "Hello, World!" }
  ]);

  //verify class= and general syntax
  test.eq(`<html><body><h2 class="heading2">Intro</h2><p class="normal">Hello, World!</p></body></html>`, await richdoc.__getRawHTML());
}

test.run(
  [ // internal RTD creation APIs
    testRTDCreation
  ]);
