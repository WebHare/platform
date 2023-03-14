import * as test from "@webhare/test";
import * as services from "@webhare/services";
import { WebRequest } from "@webhare/router";
import { coreWebHareRouter } from "@webhare/router/src/corerouter";
import { decodeHSON } from "@webhare/hscompat/hscompat";

interface GetRequestDataResponse {
  method: string;
}

async function testHSWebserver() {
  const testsuiteresources = services.getConfig().backendurl + "tollium_todd.res/webhare_testsuite/tests/";
  const result = await coreWebHareRouter(new WebRequest(testsuiteresources + "getrequestdata.shtml"));
  test.eq(200, result.status);
  test.eq("application/x-hson", result.headers["content-type"]);

  const response = decodeHSON(result.body) as unknown as GetRequestDataResponse;
  test.eq("GET", response.method);

  console.log(response);
}

test.run([
  services.ready,
  testHSWebserver
]);
