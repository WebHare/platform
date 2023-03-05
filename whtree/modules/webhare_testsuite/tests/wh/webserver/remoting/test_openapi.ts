import * as test from "@webhare/test";
import * as services from "@webhare/services";

let userapiroot = '';

async function verifyPublicParts() {
  await services.ready();
  userapiroot = services.getConfig().backendurl + ".webhare_testsuite/openapi/testservice/";

  const useropenapi = await (await fetch(userapiroot + "openapi.json")).json();
  test.eq("3.0.2", useropenapi.openapi);
  test.assert(!JSON.stringify(useropenapi).includes("x-webhare"));
}

test.run([verifyPublicParts]);
