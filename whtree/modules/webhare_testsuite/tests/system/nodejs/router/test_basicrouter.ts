import * as test from "@webhare/test";
import * as services from "@webhare/services";
import { HTTPMethod, WebRequest } from "@webhare/router";
import { coreWebHareRouter } from "@webhare/router/src/corerouter";
import { decodeHSON } from "@webhare/hscompat/hscompat";

interface GetRequestDataResponse {
  method: string;
  webvars: Array<{ ispost: boolean; name: string; value: string }>;
}

async function testHSWebserver() {
  const testsuiteresources = services.config.backendurl + "tollium_todd.res/webhare_testsuite/tests/";
  let result = await coreWebHareRouter(new WebRequest(testsuiteresources + "getrequestdata.shtml"));
  test.eq(200, result.status);
  test.eq("application/x-hson", result.headers["content-type"]);

  let response = decodeHSON(result.body) as unknown as GetRequestDataResponse;
  test.eq("GET", response.method);

  result = await coreWebHareRouter(new WebRequest(testsuiteresources + "getrequestdata.shtml", {
    method: HTTPMethod.POST,
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: "a=1&b=2"
  }));

  test.eq(200, result.status);
  test.eq("application/json", result.headers["content-type"]);

  response = JSON.parse(result.body) as GetRequestDataResponse;
  test.eq("POST", response.method);
  test.eqProps([{ name: 'a', value: '1' }, { name: 'b', value: '2' }], response.webvars);
}

test.run([
  services.ready,
  testHSWebserver
]);
