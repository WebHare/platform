import * as test from "@webhare/test";
import * as services from "@webhare/services";
import { getServiceInstance } from "@mod-system/js/internal/openapi/openapiservice";
import { HTTPMethod, HTTPErrorCode, HTTPSuccessCode } from "@webhare/router";

let userapiroot = '', authtestsroot = '';

const pietje = { email: "pietje@beta.webhare.net", firstName: "pietje" };
const jsonheader = { "Content-Type": "application/json" };

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
  test.eq("application/json", res.headers["content-type"]);

  res = await instance.APICall({ method: HTTPMethod.GET, url: "http://localhost/users/1", body: "", headers: {} }, "users/1");
  test.eq(HTTPSuccessCode.Ok, res.status);
  test.eq({ id: 1, firstName: "Alpha", email: "alpha@beta.webhare.net" }, JSON.parse(res.body));

  res = await instance.APICall({ method: HTTPMethod.DELETE, url: "http://localhost/users", body: "", headers: {} }, "users");
  test.eq(HTTPErrorCode.MethodNotAllowed, res.status);

  res = await instance.APICall({ method: HTTPMethod.GET, url: "http://localhost/users?searchFor=Br", body: "", headers: {} }, "users");
  test.eq(HTTPSuccessCode.Ok, res.status);
  test.eq([{ id: 55, firstName: "Bravo", email: "bravo@beta.webhare.net" }],
    JSON.parse(res.body));

  res = await instance.APICall({ method: HTTPMethod.POST, url: "http://localhost/users", body: "hi!", headers: {} }, "users");
  test.eq(HTTPErrorCode.BadRequest, res.status);

  res = await instance.APICall({ method: HTTPMethod.POST, url: "http://localhost/users", body: "hi!", headers: {} }, "users");
  test.eq(HTTPErrorCode.BadRequest, res.status);

  res = await instance.APICall({ method: HTTPMethod.POST, url: "http://localhost/users", body: JSON.stringify(pietje), headers: {} }, "users");
  test.eq(HTTPErrorCode.BadRequest, res.status, "should fail: no contenttype set");

  res = await instance.APICall({ method: HTTPMethod.POST, url: "http://localhost/users", body: JSON.stringify(pietje), headers: jsonheader }, "users");
  test.eq(HTTPSuccessCode.Created, res.status);
  test.eq({ "email": "pietje@beta.webhare.net", "firstName": "pietje", "id": 77 }, JSON.parse(res.body));

  res = await instance.APICall({ method: HTTPMethod.POST, url: "http://localhost/users", body: JSON.stringify({ firstName: "Klaasje" }), headers: jsonheader }, "users");
  test.eq(HTTPErrorCode.BadRequest, res.status);
}

async function testAuthorization() {
  await services.ready();

  //whitebox try the service directly for more useful traces etc
  const instance = await getServiceInstance("mod::webhare_testsuite/tests/wh/webserver/remoting/openapi/authtests.yaml");
  let res = await instance.APICall({ method: HTTPMethod.GET, url: "http://localhost/other", body: "", headers: {} }, "other");
  test.eq(HTTPErrorCode.Forbidden, res.status); //Blocked because the route lacks an authorizer

  res = await instance.APICall({ method: HTTPMethod.GET, url: "http://localhost/dummy", body: "", headers: {} }, "dummy");
  test.eq(HTTPErrorCode.Unauthorized, res.status); //No key!
  test.eq({ error: "Dude where's my key?" }, JSON.parse(res.body));

  res = await instance.APICall({ method: HTTPMethod.GET, url: "http://localhost/dummy", body: "", headers: { "x-key": "secret" } }, "dummy");
  test.eq(HTTPSuccessCode.Ok, res.status);
  test.eq('"secret"', res.body);

  res = await instance.APICall({ method: HTTPMethod.POST, url: "http://localhost/dummy", body: "", headers: { "x-key": "secret" } }, "dummy");
  test.eq(HTTPErrorCode.Unauthorized, res.status, "Should not be getting NotImplemented - access checks go first!");
  test.eq("null", res.body);
}

async function verifyPublicParts() {
  userapiroot = services.getConfig().backendurl + ".webhare_testsuite/openapi/testservice/";
  authtestsroot = services.getConfig().backendurl + ".webhare_testsuite/openapi/authtests/";

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

  const deniedcall = await fetch(authtestsroot + "dummy");
  test.eq(HTTPErrorCode.Unauthorized, deniedcall.status);
  test.eq("X-Key", deniedcall.headers.get("www-authenticate"));
  test.eq({ error: "Dude where's my key?" }, await deniedcall.json());
}

test.run([
  testService,
  testAuthorization,
  verifyPublicParts
]);
