import * as test from "@webhare/test";
import * as services from "@webhare/services";
import { getServiceInstance } from "@mod-system/js/internal/openapi/openapiservice";
import { HTTPMethod, HTTPErrorCode, HTTPSuccessCode } from "@webhare/router";

let userapiroot = '';

async function testService() {
  await services.ready();

  //whitebox try the service directly for more useful traces etc
  const instance = await getServiceInstance("mod::webhare_testsuite/tests/wh/webserver/remoting/openapi/testservice.yaml");
  let res = await instance.APICall({ method: HTTPMethod.GET, url: "http://localhost/unknownapi", body: "", headers: {} }, "unknownapi");
  test.eq(HTTPErrorCode.NotFound, res.status);

  res = await instance.APICall({ method: HTTPMethod.GET, url: "http://localhost/users", body: "", headers: {} }, "users");
  test.eq(HTTPSuccessCode.Ok, res.status);
  test.eq([
    { id: 1, firstName: "Alpha", email: "alpha@beta.webhare.net" },
    { id: 55, firstName: "Bravo", email: "bravo@beta.webhare.net" }
  ], JSON.parse(res.body));

  res = await instance.APICall({ method: HTTPMethod.DELETE, url: "http://localhost/users", body: "", headers: {} }, "users");
  test.eq(HTTPErrorCode.MethodNotAllowed, res.status);
}

async function verifyPublicParts() {
  userapiroot = services.getConfig().backendurl + ".webhare_testsuite/openapi/testservice/";

  const useropenapi = await (await fetch(userapiroot + "openapi.json")).json();
  test.eq("3.0.2", useropenapi.openapi);
  test.assert(!JSON.stringify(useropenapi).includes("x-webhare"));
  test.eq(userapiroot, useropenapi.servers[0].url);

  const unkownapi = await fetch(userapiroot + "unknownapi");
  test.eq(HTTPErrorCode.NotFound, unkownapi.status);

  const userlistcall = await fetch(userapiroot + "users");
  test.eq(HTTPSuccessCode.Ok, userlistcall.status);

  const userlist = await userlistcall.json();
  test.eq([
    { id: 1, firstName: "Alpha", email: "alpha@beta.webhare.net" },
    { id: 55, firstName: "Bravo", email: "bravo@beta.webhare.net" }
  ], userlist);
}

test.run([
  testService,
  verifyPublicParts
]);
