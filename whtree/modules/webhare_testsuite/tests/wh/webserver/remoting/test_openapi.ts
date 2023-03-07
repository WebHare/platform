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

  res = await instance.APICall({ method: HTTPMethod.GET, url: "http://localhost/users/1", body: "", headers: {} }, "users/1");
  test.eq(HTTPSuccessCode.Ok, res.status);
  test.eq({ id: 1, firstName: "Alpha", email: "alpha@beta.webhare.net" }, JSON.parse(res.body));

  res = await instance.APICall({ method: HTTPMethod.DELETE, url: "http://localhost/users", body: "", headers: {} }, "users");
  test.eq(HTTPErrorCode.MethodNotAllowed, res.status);

  res = await instance.APICall({ method: HTTPMethod.GET, url: "http://localhost/users?searchFor=Br", body: "", headers: {} }, "users");
  test.eq(HTTPSuccessCode.Ok, res.status);
  test.eq([{ id: 55, firstName: "Bravo", email: "bravo@beta.webhare.net" }],
    JSON.parse(res.body));
}

async function verifyPublicParts() {
  userapiroot = services.getConfig().backendurl + ".webhare_testsuite/openapi/testservice/";

  //Verify we get the openapi.json (not available through direct APICalls)
  const useropenapi = await (await fetch(userapiroot + "openapi.json")).json();
  test.eq("3.0.2", useropenapi.openapi);
  test.assert(!JSON.stringify(useropenapi).includes("x-webhare"));
  test.eq(userapiroot, useropenapi.servers[0].url, "Verify full URL (it was '.' in the source file)");

  const unkownapi = await fetch(userapiroot + "unknownapi");
  test.eq(HTTPErrorCode.NotFound, unkownapi.status);

  const userlistcall = await fetch(userapiroot + "users");
  test.eq(HTTPSuccessCode.Ok, userlistcall.status);

  test.eq([
    { id: 1, firstName: "Alpha", email: "alpha@beta.webhare.net" },
    { id: 55, firstName: "Bravo", email: "bravo@beta.webhare.net" }
  ], await userlistcall.json());

  const user1call = await fetch(userapiroot + "users/1");
  test.eq(HTTPSuccessCode.Ok, user1call.status);

  test.eq({ id: 1, firstName: "Alpha", email: "alpha@beta.webhare.net" },
    await user1call.json());

  const filteredcall = await fetch(userapiroot + "users?searchFor=Br");
  test.eq([{ id: 55, firstName: "Bravo", email: "bravo@beta.webhare.net" }],
    await filteredcall.json());
}

test.run([
  testService,
  verifyPublicParts
]);
