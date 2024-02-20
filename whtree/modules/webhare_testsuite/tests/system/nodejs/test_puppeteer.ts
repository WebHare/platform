import * as test from "@webhare/test-backend";
import { launchPuppeteer } from "@webhare/deps";

async function testPuppeteer() {
  //ensure it exists
  const puppet = await launchPuppeteer();
  test.assert(puppet);

  const page = await puppet.newPage();
  test.eq("about:blank", page.url());

  await puppet.close();
}

test.run([testPuppeteer]);
