import * as test from "@webhare/test";
import * as services from "@webhare/services";
import { WebHareBlob } from "@webhare/services";
import { getServiceInstance } from "@mod-system/js/internal/openapi/openapiservice";
import { HTTPMethod, HTTPErrorCode, HTTPSuccessCode } from "@webhare/router";
import * as restrequest from "@webhare/router/src/restrequest";
import { OpenAPITestserviceClient } from "wh:openapi/webhare_testsuite/testservice";

let userapiroot = '', authtestsroot = '';

const pietje = { email: "openapi@beta.webhare.net", firstName: "pietje" };
const jsonheader = { "Content-Type": "application/json" };
const basecall = { sourceip: "127.0.0.1", method: HTTPMethod.GET, body: WebHareBlob.from(""), headers: {} };

async function testService() {
  //whitebox try the service directly for more useful traces etc
  const instance = await getServiceInstance("webhare_testsuite:testservice");
  let res = await instance.APICall({ ...basecall, url: "http://localhost/unknownapi" }, "unknownapi");
  test.eq(HTTPErrorCode.NotFound, res.status);

  res = await instance.APICall({ ...basecall, url: "http://localhost/users" }, "users");
  test.eq(HTTPSuccessCode.Ok, res.status);
  test.eq([
    { id: 1, firstName: "Alpha", email: "alpha@beta.webhare.net" },
    { id: 55, firstName: "Bravo", email: "bravo@beta.webhare.net" }
  ], JSON.parse(await res.body.text()));
  test.eq("application/json", res.headers["content-type"]);

  res = await instance.APICall({ ...basecall, method: HTTPMethod.POST, url: "http://localhost/reset" }, "reset");
  test.eq(HTTPSuccessCode.NoContent, res.status);

  res = await instance.APICall({ ...basecall, url: "http://localhost/users/1" }, "users/1");
  test.eq(HTTPSuccessCode.Ok, res.status);
  test.eq({ id: 1, firstName: "Alpha", email: "alpha@beta.webhare.net" }, JSON.parse(await res.body.text()));

  res = await instance.APICall({ ...basecall, method: HTTPMethod.DELETE, url: "http://localhost/users" }, "users");
  test.eq(HTTPErrorCode.MethodNotAllowed, res.status);

  res = await instance.APICall({ ...basecall, url: "http://localhost/users?searchFor=Br" }, "users");
  test.eq(HTTPSuccessCode.Ok, res.status);
  test.eq([{ id: 55, firstName: "Bravo", email: "bravo@beta.webhare.net" }],
    JSON.parse(await res.body.text()));

  res = await instance.APICall({ ...basecall, method: HTTPMethod.POST, url: "http://localhost/users", body: WebHareBlob.from("hi!") }, "users");
  test.eq(HTTPErrorCode.BadRequest, res.status);

  res = await instance.APICall({ ...basecall, method: HTTPMethod.POST, url: "http://localhost/users", body: WebHareBlob.from("hi!") }, "users");
  test.eq(HTTPErrorCode.BadRequest, res.status);

  res = await instance.APICall({ ...basecall, method: HTTPMethod.POST, url: "http://localhost/users", body: WebHareBlob.from(JSON.stringify(pietje)) }, "users");
  test.eq(HTTPErrorCode.BadRequest, res.status, "should fail: no contenttype set");

  res = await instance.APICall({ ...basecall, method: HTTPMethod.POST, url: "http://localhost/users", body: WebHareBlob.from(JSON.stringify(pietje)), headers: jsonheader }, "users");
  test.eq(HTTPSuccessCode.Created, res.status);

  const resbody = JSON.parse(await res.body.text());
  test.eqProps({ "email": "openapi@beta.webhare.net", "firstName": "pietje" }, resbody);
  test.assert(resbody.id > 0);

  res = await instance.APICall({ ...basecall, method: HTTPMethod.POST, url: "http://localhost/users", body: WebHareBlob.from(JSON.stringify({ firstName: "Klaasje" })), headers: jsonheader }, "users");
  test.eq(HTTPErrorCode.BadRequest, res.status);

  res = await instance.APICall({ ...basecall, url: "http://localhost/validateoutput?test=ok", headers: jsonheader }, "validateoutput");
  test.eq(HTTPSuccessCode.Ok, res.status);

  res = await instance.APICall({ ...basecall, url: "http://localhost/validateoutput?test=unknownStatusCode", headers: jsonheader }, "validateoutput");
  test.eq(HTTPErrorCode.InternalServerError, res.status);

  res = await instance.APICall({ ...basecall, url: "http://localhost/validateoutput?test=illegalData", headers: jsonheader }, "validateoutput");
  test.eq(HTTPErrorCode.InternalServerError, res.status);

  res = await instance.APICall({ ...basecall, url: "http://localhost/validateoutput?test=with%2F", headers: jsonheader }, "validateoutput");
  test.eq(HTTPErrorCode.BadRequest, res.status);
  test.eq(`Illegal type: "with/"`, JSON.parse(await res.body.text()).error);

  res = await instance.APICall({ ...basecall, url: "http://localhost/validateoutput/with%2F", headers: jsonheader }, "validateoutput/with%2F");
  test.eq(HTTPErrorCode.BadRequest, res.status);
  test.eq(`Illegal path type: "with/"`, JSON.parse(await res.body.text()).error);
}

function enumRefs(obj: unknown, result: string[] = []): string[] {
  if (Array.isArray(obj)) {
    for (const elt of obj)
      enumRefs(elt, result);
  } else {
    if (typeof obj === "object" && obj) {
      for (const [key, value] of Object.entries(obj))
        if (key === "$ref" && typeof value === "string")
          result.push(value);
        else if (typeof value === "object" && value)
          enumRefs(value, result);
    }
  }
  return result;
}

async function testAuthorization() {
  //whitebox try the service directly for more useful traces etc
  const instance = await getServiceInstance("webhare_testsuite:authtests");
  let res = await instance.APICall({ ...basecall, method: HTTPMethod.GET, url: "http://localhost/other" }, "other");
  test.eq(HTTPErrorCode.Forbidden, res.status); //Blocked because the route lacks an authorizer

  res = await instance.APICall({ ...basecall, method: HTTPMethod.GET, url: "http://localhost/dummy" }, "dummy");
  test.eq(HTTPErrorCode.Unauthorized, res.status); //No key!
  test.eq({ error: "Dude where's my key?" }, JSON.parse(await res.body.text()));

  res = await instance.APICall({ ...basecall, method: HTTPMethod.GET, url: "http://localhost/dummy", headers: { "x-key": "secret" } }, "dummy");
  test.eq(HTTPSuccessCode.Ok, res.status);
  test.eq('"secret"', await res.body.text());

  res = await instance.APICall({ ...basecall, method: HTTPMethod.GET, url: "http://localhost/dummy", headers: { "x-key": "secret" } }, "dummy");
  test.eq(HTTPSuccessCode.Ok, res.status);
  test.eq('"secret"', await res.body.text());

  res = await instance.APICall({ ...basecall, method: HTTPMethod.GET, url: "http://localhost/dummy", headers: { "x-key": "secret2" } }, "dummy");
  test.eq(HTTPSuccessCode.Ok, res.status);
  test.eq('"secret2"', await res.body.text());

  res = await instance.APICall({ ...basecall, method: HTTPMethod.POST, url: "http://localhost/dummy", headers: { "x-key": "secret" } }, "dummy");
  test.eq(HTTPErrorCode.Unauthorized, res.status, "Should not be getting NotImplemented - access checks go first!");
  test.eq({ status: HTTPErrorCode.Unauthorized, error: "Authorization is required for this endpoint" }, JSON.parse(await res.body.text()));
}

async function testOverlappingCalls() {
  const instance = await getServiceInstance("webhare_testsuite:testservice");

  //TODO also test overlapping authorization calls so they can write to the database too (eg. audit)
  const lockadduser = await services.lockMutex("webhare_testsuite:adduser");

  const respromise1 = instance.APICall({ ...basecall, method: HTTPMethod.POST, url: "http://localhost/users", body: WebHareBlob.from(JSON.stringify({ ...pietje, email: "user1@beta.webare.net" })), headers: jsonheader }, "users");
  const respromise2 = instance.APICall({ ...basecall, method: HTTPMethod.POST, url: "http://localhost/users", body: WebHareBlob.from(JSON.stringify({ ...pietje, email: "user2@beta.webare.net" })), headers: jsonheader }, "users");

  test.eq("still waiting", await Promise.race([
    test.sleep(200).then(() => "still waiting"),
    respromise1.then(() => "respromise1 should not have completed"),
    respromise2.then(() => "respromise2 should not have completed")
  ]));
  lockadduser.release();
  test.eq(HTTPSuccessCode.Created, (await respromise1).status);
  test.eq(HTTPSuccessCode.Created, (await respromise2).status);
}

async function verifyPublicParts() {
  test.assert(services.backendConfig.backendURL, "backendURL not set in configuration");
  userapiroot = services.backendConfig.backendURL + ".webhare_testsuite/openapi/testservice/";
  authtestsroot = services.backendConfig.backendURL + ".webhare_testsuite/openapi/authtests/";

  //Verify we get the openapi.json (not available through direct APICalls)
  const useropenapi = await (await fetch(userapiroot + "openapi.json", { redirect: "manual" })).json();
  test.eq("3.1.0", useropenapi.openapi);
  test.assert(!JSON.stringify(useropenapi).includes("x-webhare"));
  test.eq(userapiroot, useropenapi.servers[0].url, "Verify full URL (it was '.' in the source file)");
  test.assert(enumRefs(useropenapi).length > 0, "$refs should still exists (only cross-file refs should be removed)");
  test.eq([], enumRefs(useropenapi).filter(r => !r.startsWith("#")), "Only internal refs should remain");

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

  const invalidparametercall = await fetch(userapiroot + `users?searchFor=${"a".repeat(101)}`);
  test.eq(HTTPErrorCode.BadRequest, invalidparametercall.status);
  test.eq({ status: HTTPErrorCode.BadRequest, error: "Invalid parameter searchFor: must NOT have more than 100 characters (limit=100)" }, await invalidparametercall.json());

  const deniedcall = await fetch(authtestsroot + "dummy");
  test.eq(HTTPErrorCode.Unauthorized, deniedcall.status);
  test.eq("X-Key", deniedcall.headers.get("www-authenticate"));
  test.eq({ error: "Dude where's my key?" }, await deniedcall.json());

  // Test decoding of encoded variables
  const validatecall = await fetch(userapiroot + "validateoutput?test=with%2F");
  test.eq(HTTPErrorCode.BadRequest, validatecall.status);
  test.eq(`Illegal type: "with/"`, (await validatecall.json()).error);

  const validatepathcall = await fetch(userapiroot + "validateoutput/with%2F");
  test.eq(HTTPErrorCode.BadRequest, validatepathcall.status);
  test.eq(`Illegal path type: "with/"`, (await validatepathcall.json()).error);
}

function testInternalTypes() {

  type TestResponses =
    { status: HTTPSuccessCode.Ok; isjson: true; response: { code: number } } |
    { status: HTTPSuccessCode.Created; isjson: false } |
    { status: HTTPSuccessCode.PartialContent; isjson: boolean; response: string } | // true|false, so both raw and json requests are accepted
    { status: HTTPErrorCode.NotFound; isjson: true; response: { status: HTTPErrorCode.NotFound; error: string; extra: string } };

  test.typeAssert<test.Extends<TestResponses, restrequest.RestResponsesBase>>();

  test.typeAssert<test.Equals<
    { status: HTTPSuccessCode.Ok; isjson: true; response: { code: number } } |
    { status: HTTPSuccessCode.PartialContent; isjson: boolean; response: string } |
    { status: HTTPErrorCode.NotFound; isjson: true; response: { status: HTTPErrorCode.NotFound; error: string; extra: string } },
    restrequest.JSONResponses<TestResponses>>>();

  test.typeAssert<test.Equals<HTTPErrorCode | HTTPSuccessCode.Ok | HTTPSuccessCode.PartialContent, restrequest.JSONResponseCodes<TestResponses>>>();
  test.typeAssert<test.Equals<HTTPSuccessCode.Created | HTTPSuccessCode.PartialContent, restrequest.RawResponseCodes<TestResponses>>>();

  test.typeAssert<test.Equals<{ code: number }, restrequest.JSONResponseForCode<TestResponses, restrequest.RestDefaultErrorBody, HTTPSuccessCode.Ok>>>();
  test.typeAssert<test.Equals<{ status: HTTPErrorCode.NotFound; error: string; extra: string }, restrequest.JSONResponseForCode<TestResponses, restrequest.RestDefaultErrorBody, HTTPErrorCode.NotFound>>>();
  test.typeAssert<test.Equals<{ status: HTTPErrorCode; error: string }, restrequest.JSONResponseForCode<TestResponses, restrequest.RestDefaultErrorBody, HTTPErrorCode.BadRequest>>>();
  // When both json and non-json are accepted, returns the JSON format
  test.typeAssert<test.Equals<string, restrequest.JSONResponseForCode<TestResponses, restrequest.RestDefaultErrorBody, HTTPSuccessCode.PartialContent>>>();
  // Test with override of default error
  test.typeAssert<test.Equals<{ status: HTTPErrorCode; error: string; extra: string }, restrequest.JSONResponseForCode<TestResponses, { status: HTTPErrorCode; error: string; extra: string }, HTTPErrorCode.BadRequest>>>();

  // just type-check the following code, don't run it
  const f = false;
  if (f) {
    const req: restrequest.RestRequest<null, object, null, TestResponses, restrequest.RestDefaultErrorBody> = null as any;
    const req_errdef: restrequest.RestRequest<null, object, null, TestResponses, { status: HTTPErrorCode; error: string; extra: string }> = null as any;

    req.createJSONResponse(HTTPSuccessCode.Ok, { code: 3 });
    // @ts-expect-error -- Not allowed to add extra properties
    req.createJSONResponse(HTTPSuccessCode.Ok, { code: 3, extra: 6 });
    // @ts-expect-error -- Wrong type for response body
    req.createJSONResponse(HTTPSuccessCode.Ok, "a");
    // @ts-expect-error -- Errors only via createErrorResponse
    req.createJSONResponse(HTTPErrorCode.BadRequest, { error: "a" });
    // @ts-expect-error -- When response isn't json
    req.createJSONResponse(HTTPSuccessCode.Created, { error: "a" });
    req.createJSONResponse(HTTPSuccessCode.PartialContent, "content");

    req.createErrorResponse(HTTPErrorCode.NotFound, { error: "not found", extra: "extra" });
    // @ts-expect-error -- doesn't accept default error if overridden
    req.createErrorResponse(HTTPErrorCode.NotFound, { error: "not found" });
    // @ts-expect-error -- Don't allow extra stuff in literal
    req.createErrorResponse(HTTPErrorCode.BadGateway, { error: "not found", nonexisting: "extra" });
    // Is override of default error format handled?
    req_errdef.createErrorResponse(HTTPErrorCode.BadRequest, { error: "not found", extra: "extra" });
    // @ts-expect-error -- 'extra' is required
    req_errdef.createErrorResponse(HTTPErrorCode.BadRequest, { error: "not found" });
    // @ts-expect-error -- Not allowed to add extra properties
    req.createErrorResponse(HTTPErrorCode.BadGateway, { error: "Bad gateway", extra: 6 });

    req.createRawResponse(HTTPSuccessCode.Created, "blabla");
    req.createRawResponse(HTTPSuccessCode.PartialContent, "blabla");
    // @ts-expect-error -- not allowed for json-only apis
    req.createRawResponse(HTTPSuccessCode.Ok, "blabla");
  }
}

async function testLogFile() {
  const loglines = [];
  for await (const line of services.readLogLines<{ service: string; route: string; status: number; authorized?: { lastchar: string } }>("system:apicalls", { start: test.startTime, limit: new Date }))
    loglines.push(line);

  const usercalls = loglines.filter(_ => _.route === '/users/{userid}');
  test.eq(2, usercalls.length);

  const authtestcalls = loglines.filter(_ => _.service === 'webhare_testsuite:authtests' && _.status >= 200 && _.status < 300);
  test.eq(3, authtestcalls.length);
  test.eqProps([
    { authorized: { lastchar: 't' } },
    { authorized: { lastchar: 't' } },
    { authorized: { lastchar: '2' } }
  ], authtestcalls, [], "Ensure all 3 calls had an authorized (even if we cache in the future!");
}

async function testGeneratedClient() {
  const client = new OpenAPITestserviceClient(userapiroot);

  {
    const res = await client.get("/users");
    test.eq([
      { id: 1, firstName: "Alpha", email: "alpha@beta.webhare.net" },
      { id: 55, firstName: "Bravo", email: "bravo@beta.webhare.net" }
    ], res.body);
    test.eq("application/json", res.headers.get("content-type"));
  }
  {
    const res = await client.get("/users/{userid}", { params: { userid: 1 } });
    test.eq({ id: 1, firstName: "Alpha", email: "alpha@beta.webhare.net" }, res.body);
  }
  {
    const res = await client.get("/users/{userid}", { params: { userid: 1, wait: true } });
    test.eq({ id: 1, firstName: "Alpha", email: "alpha@beta.webhare.net" }, res.body);
  }
}

test.run([
  testService,
  testAuthorization,
  testOverlappingCalls,
  verifyPublicParts,
  testInternalTypes,
  testLogFile,
  testGeneratedClient
]);
