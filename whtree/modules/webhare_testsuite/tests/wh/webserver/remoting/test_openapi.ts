import * as test from "@webhare/test";
import * as services from "@webhare/services";
import { getDirectOpenAPIFetch, type OpenAPIClientFetch } from "@webhare/openapi-service";
import { getServiceInstance } from "@mod-system/js/internal/openapi/openapiservice";
import { HTTPErrorCode, HTTPSuccessCode } from "@webhare/router";
import type * as restrequest from "@webhare/router/src/restrequest";
import { OpenAPITestserviceClient } from "wh:openapi/webhare_testsuite/testservice";
import { OpenAPIAuthtestsClient } from "wh:openapi/webhare_testsuite/authtests";
import { createOpenAPIClient } from "@webhare/openapi-client";

let userapiroot = '', authtestsroot = '';

const pietje = { email: "openapi@beta.webhare.net", firstName: "pietje" };

async function testService() {
  //verify native fetch is a valid OpenAPIClientFetch
  fetch satisfies OpenAPIClientFetch;

  //whitebox try the service directly for more useful traces etc
  using serviceFetch = await getDirectOpenAPIFetch("webhare_testsuite:testservice");
  const service = createOpenAPIClient<"webhare_testsuite:testservice">(serviceFetch);
  const serviceUsingGlobalFetch = createOpenAPIClient<"webhare_testsuite:testservice">(services.backendConfig.backendURL + ".webhare_testsuite/openapi/testservice/");

  using serviceNoValidationFetch = await getDirectOpenAPIFetch("webhare_testsuite:testservice_novalidation");
  const serviceNoValidation = new OpenAPITestserviceClient(serviceNoValidationFetch);

  {
    //@ts-expect-error TS knows /unknownapi is invalid
    const res = await service.get("/unknownapi");
    test.eq(HTTPErrorCode.NotFound, res.status);
  }

  {
    const res = await service.get("/users");
    test.eq(HTTPSuccessCode.Ok, res.status);
    test.eq([
      { id: 1, firstName: "Alpha", email: "alpha@beta.webhare.net" },
      { id: 55, firstName: "Bravo", email: "bravo@beta.webhare.net" }
    ], res.body);

    const resGlobal = await serviceUsingGlobalFetch.get("/users");
    test.eq(HTTPSuccessCode.Ok, resGlobal.status);
    test.eq(res.body, resGlobal.body);
  }

  {
    const res = await service.post("/reset", {});
    test.eq(HTTPSuccessCode.NoContent, res.status);
  }

  {
    const res = await service.get("/users/{userid}", { params: { userid: 1 } });
    test.eq(HTTPSuccessCode.Ok, res.status);
    test.eq({ id: 1, firstName: "Alpha", email: "alpha@beta.webhare.net" }, res.body);
  }

  {
    const res = await service.delete("/users", {});
    test.eq(HTTPErrorCode.MethodNotAllowed, res.status);
  }

  {
    const res = await service.get("/users", { params: { searchFor: "Br" } });
    test.eq(HTTPSuccessCode.Ok, res.status);
    test.eq([{ id: 55, firstName: "Bravo", email: "bravo@beta.webhare.net" }], res.body);
  }

  {
    const res = await service.invoke("POST", "/users", "hi!");
    test.eq(HTTPErrorCode.BadRequest, res.status);
  }

  {
    const res = await serviceNoValidation.invoke("POST", "/users", "hi!");
    test.eq(HTTPErrorCode.InternalServerError, res.status);
  }

  {
    const res = await service.invoke("POST", "/users", JSON.stringify(pietje), { contentType: null });
    test.eq(HTTPErrorCode.BadRequest, res.status, "should fail: no contenttype set");
  }

  {
    const res = await service.post("/users", pietje);
    test.assert(res.status === HTTPSuccessCode.Created);
    test.eqPartial({ "email": "openapi@beta.webhare.net", "firstName": "pietje" }, res.body);
    test.assert(typeof res.body.id !== "undefined");
    test.assert(res.body.id > 0);
  }

  {
    //@ts-expect-error TS also detects the missing 'email' field
    const res = await service.post("/users", { firstName: "Klaasje" });
    test.eq(HTTPErrorCode.BadRequest, res.status);
  }

  {
    const res = await service.get("/validateoutput", { params: { test: "ok" } });
    test.eq(HTTPSuccessCode.Ok, res.status);
  }

  {
    const res = await service.get("/validateoutput", { params: { test: "unknownStatusCode" } });
    test.eq(HTTPErrorCode.InternalServerError, res.status);
  }

  {
    const res = await service.get("/validateoutput", { params: { test: "illegalData" } });
    test.eq(HTTPErrorCode.InternalServerError, res.status);
  }

  {
    const res = await serviceNoValidation.get("/validateoutput", { params: { test: "illegalData" } });
    test.eq(HTTPSuccessCode.Ok, res.status);
  }

  {
    const res = await service.get("/validateoutput", { params: { test: "with/" } });
    test.assert(res.status === HTTPErrorCode.BadRequest);
    console.log(res.body);
    test.eq(`Illegal type: "with/"`, res.body.message);
  }


  {
    //@ts-expect-error TS also detects the invalid url
    const res = await service.get("/validateoutput/with%2F");
    test.assert(res.status === HTTPErrorCode.BadRequest);
    test.eq(`Illegal path type: "with/"`, res.body.message);
  }
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
  using authFetch = await getDirectOpenAPIFetch("webhare_testsuite:authtests");
  const authService = new OpenAPIAuthtestsClient(authFetch);
  const authServiceWithToken = new OpenAPIAuthtestsClient(authFetch, { bearerToken: "secret" });

  {
    const res = await authService.get("/other");
    test.eq(HTTPErrorCode.Forbidden, res.status); //Blocked because the route lacks an authorizer
  }

  {
    const res = await authService.get("/dummy");
    test.eq(HTTPErrorCode.Unauthorized, res.status); //No key!
    test.assert(res.status === HTTPErrorCode.Unauthorized && "body" in res);
    console.log(res.body);
    test.eq({ status: 401, message: "Dude where's my key?" }, res.body);
  }

  {
    const res = await authServiceWithToken.get("/dummy");
    test.assert(res.status === HTTPSuccessCode.Ok && "body" in res);
    test.eq("Bearer secret", res.body);
  }

  { //NOTE not sure why this test was doubled previously?
    const res = await authServiceWithToken.get("/dummy");
    test.assert(res.status === HTTPSuccessCode.Ok && "body" in res);
    test.eq("Bearer secret", res.body);
  }

  {
    const authServiceWithToken2 = new OpenAPIAuthtestsClient(authFetch, { bearerToken: "secret2" });
    const res = await authServiceWithToken2.get("/dummy");
    test.assert(res.status === HTTPSuccessCode.Ok && "body" in res);
    test.eq("Bearer secret2", await res.body);
  }

  {
    const res = await authServiceWithToken.post("/dummy", {});
    test.assert(res.status === HTTPErrorCode.Unauthorized, "Should not be getting NotImplemented - access checks go first!");
    // error should be mapped by the error mapper, which is why we'll get "message" and not "error"
    test.eq({ message: "Authorization is required for this endpoint" }, res.body);
  }
}


async function testCORS() {
  { //lowlevel tests
    using instance = await getServiceInstance("webhare_testsuite:authtests");
    // Test if crossdomain origins are read from the service definition
    test.eq(["example.*", "https://webhare.dev:1234"], instance.restapi.crossdomainOrigins);

  }

  using authFetch = await getDirectOpenAPIFetch("webhare_testsuite:authtests", { baseUrl: "http://localhost" });
  const authService = new OpenAPIAuthtestsClient(authFetch);

  { // Fake preflight requests
    const res = await authService.invoke("OPTIONS", "/dummy", null, {
      headers: {
        "Access-Control-Request-Method": "DELETE", // invalid method
        "Access-Control-Request-Headers": "Authorization",
        "Origin": "http://localhost",
      }
    });
    test.eq(HTTPErrorCode.MethodNotAllowed, res.status);
    test.eq(/Cannot match request method 'DELETE'/, res.headers.get("X-WebHare-CORS-Error"));
  }

  {
    const res = await authService.invoke("OPTIONS", "/dummy", null, {
      headers: {
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "My-Custom-Header", // invalid header
        "Origin": "http://localhost",
      }
    });
    test.eq(HTTPErrorCode.MethodNotAllowed, res.status);
    test.eq(/Cannot match request header 'My-Custom-Header'/, res.headers.get("X-WebHare-CORS-Error"));
  }

  {
    const res = await authService.invoke("OPTIONS", "/dummy", null, {
      headers: {
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "Authorization",
        "Origin": "http://webhare.nl", // invalid origin
      }
    });
    test.eq(HTTPErrorCode.MethodNotAllowed, res.status);
    test.eq(/Cannot match origin 'http:\/\/webhare.nl'/, res.headers.get("X-WebHare-CORS-Error"));
  }

  {
    const res = await authService.invoke("OPTIONS", "/dummy", null, {
      headers: {
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "Authorization",
        "Origin": "http://webhare.dev:1234", // invalid protocol
      }
    });
    test.eq(HTTPErrorCode.MethodNotAllowed, res.status);
    test.eq(/Cannot match origin 'http:\/\/webhare.dev:1234'/, res.headers.get("X-WebHare-CORS-Error"));
  }

  {
    const res = await authService.invoke("OPTIONS", "/dummy", null, {
      headers: {
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "Authorization",
        "Origin": "https://webhare.dev", // invalid port
      }
    });
    test.eq(HTTPErrorCode.MethodNotAllowed, res.status);
    test.eq(/Cannot match origin 'https:\/\/webhare.dev'/, res.headers.get("X-WebHare-CORS-Error"));
  }

  {
    const res = await authService.invoke("OPTIONS", "/dummy", null, {
      headers: {
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "Authorization",
        "Origin": "https://webhare.dev:1234",
        "Authorization": "secreta",
      }
    });
    test.eq(HTTPSuccessCode.Ok, res.status);
    test.eq("https://webhare.dev:1234", res.headers.get("Access-Control-Allow-Origin"));
    test.eq(/GET/, res.headers.get("Access-Control-Allow-Methods")); // preflight header
    test.assert(!("body" in res)); // dummy service not actually executed, only preflight
  }

  {
    const res = await authService.invoke("OPTIONS", "/dummy", null, {
      headers: {
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Authorization",
        "Origin": "http://example.org", // protocol and tld don't matter for example.*
        "Authorization": "secretb",
      }
    });
    test.eq(HTTPSuccessCode.Ok, res.status);
    test.eq("http://example.org", res.headers.get("Access-Control-Allow-Origin"));
    test.eq(/POST/, res.headers.get("Access-Control-Allow-Methods")); // preflight header
    test.assert(!("body" in res)); // dummy service not actually executed, only preflight
  }

  {
    const res = await authService.invoke("OPTIONS", "/dummy", null, {
      headers: {
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "Authorization",
        "Origin": "https://example.com", // protocol and tld don't matter for example.*
        "Authorization": "secretc",
      }
    });
    test.eq(HTTPSuccessCode.Ok, res.status);
    test.eq("https://example.com", res.headers.get("Access-Control-Allow-Origin"));
    test.eq(/authorization/, res.headers.get("Access-Control-Allow-Headers")); // preflight header
    test.assert(!("body" in res)); // dummy service not actually executed, only preflight
  }

  {
    const res = await authService.invoke("OPTIONS", "/dummy", null, {
      headers: {
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "Authorization",
        "Origin": "https://www.example.com", // subdomain not allowed for example.*
        "Authorization": "secretd",
      }
    });
    test.eq(HTTPErrorCode.MethodNotAllowed, res.status);
    test.eq(/Cannot match origin 'https:\/\/www.example.com'/, res.headers.get("X-WebHare-CORS-Error"));
  }

  {
    const res = await authService.invoke("OPTIONS", "/dummy", null, {
      headers: {
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "Authorization",
        "Origin": "http://localhost", // requested url matches origin, so it's allowed
        "Authorization": "secrete",
      }
    });
    test.eq(HTTPSuccessCode.Ok, res.status);
    test.eq("http://localhost", res.headers.get("Access-Control-Allow-Origin"));
    test.assert(!("body" in res)); // dummy service not actually executed, only preflight
  }

  { // Direct calls
    const res = await authService.invoke("GET", "/dummy", null, {
      headers: {
        "Origin": "http://localhost", // requested url matches origin, so it's allowed
        "Authorization": "bearer secretf",
      }
    });
    test.eq(HTTPSuccessCode.Ok, res.status);
    test.eq("http://localhost", res.headers.get("Access-Control-Allow-Origin"));
    test.eq(null, res.headers.get("Access-Control-Allow-Methods")); // direct call doesn't contain preflight headers
    test.eq(null, res.headers.get("Access-Control-Allow-Headers")); // direct call doesn't contain preflight headers
    //@ ts-expect-error FIXME openapi invoke doesn't understand that it might return non-JSON bod
    test.eq("bearer secretf", res.body);
  }

  {
    const res = await authService.invoke("GET", "/dummy", null, {
      headers: {
        "Origin": "http://webhare.nl", // invalid origin
        "Authorization": "bearer secretg",
      }
    });
    test.eq(HTTPSuccessCode.Ok, res.status);
    test.eq(null, res.headers.get("Access-Control-Allow-Origin"));
    //@ ts-expect-error FIXME openapi invoke doesn't understand that it might return non-JSON bod
    test.eq("bearer secretg", res.body);
  }
}

async function testOverlappingCalls() {
  using serviceFetch = await getDirectOpenAPIFetch("webhare_testsuite:testservice");
  const service = new OpenAPITestserviceClient(serviceFetch);

  //TODO also test overlapping authorization calls so they can write to the database too (eg. audit)
  const lockadduser = await services.lockMutex("webhare_testsuite:adduser");

  const respromise1 = service.post("/users", { ...pietje, email: "user1@beta.webare.net" });
  const respromise2 = service.post("/users", { ...pietje, email: "user2@beta.webare.net" });

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
  test.eq(userapiroot, useropenapi.servers?.[0].url, "Verify full URL (it was '.' in the source file)");
  test.assert(enumRefs(useropenapi).length > 0, "$refs should still exists (only cross-file refs should be removed)");
  test.eq([], enumRefs(useropenapi).filter(r => !r.startsWith("#")), "Only internal refs should remain");
  test.assert(!("/extension" in useropenapi.paths), "Extended paths should not be in the 'testservice' API");

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
  test.eq("Authorization", deniedcall.headers.get("www-authenticate"));
  test.eq({ status: 401, message: "Dude where's my key?" }, await deniedcall.json());


  // Test decoding of encoded variables
  const validatecall = await fetch(userapiroot + "validateoutput?test=with%2F");
  test.eq(HTTPErrorCode.BadRequest, validatecall.status);
  test.eq(`Illegal type: "with/"`, (await validatecall.json()).message);

  const validatepathcall = await fetch(userapiroot + "validateoutput/with%2F");
  test.eq(HTTPErrorCode.BadRequest, validatepathcall.status);
  test.eq(`Illegal path type: "with/"`, (await validatepathcall.json()).message);

  const extendedapiroot = services.backendConfig.backendURL + ".webhare_testsuite/openapi/extendedservice/";
  const extendedopenapi = await (await fetch(extendedapiroot + "openapi.json", { redirect: "manual" })).json();
  test.assert("/extension" in extendedopenapi.paths, "Extended paths should be visible in the extendedservice API");
  test.eq({ "message": "I have been extended" }, (await (await fetch(extendedapiroot + "extension")).json()));

  const firstUuid = extendedopenapi["x-webhare_testsuite-randomuuid"];
  const scriptUuid = extendedopenapi["x-webhare_testsuite-scriptuuid"];
  test.assert(firstUuid && scriptUuid, "UUIDs should be set");

  test.eq({
    checkedAtInput: "testfw-ok",
    checkedAtOutput: "testfw-ok"
  }, await (await fetch(extendedapiroot + "extension", {
    method: "post", body: JSON.stringify({
      checkedAtInput: "testfw-ok",
      checkedAtOutput: "testfw-ok"
    }),
    redirect: "manual",
    headers: { "content-type": "application/json" },
  })).json());

  test.eq({
    error: "Invalid request body: must match format \"wh-testfw-extformat\" (format=\"wh-testfw-extformat\") (at \"/checkedAtInput\")",
    status: 400
  }, await (await fetch(extendedapiroot + "extension", {
    method: "post", body: JSON.stringify({
      checkedAtInput: "nonmatch",
      checkedAtOutput: "testfw-ok"
    }),
    redirect: "manual",
    headers: { "content-type": "application/json" },
  })).json());

  test.eqPartial(500, (await fetch(extendedapiroot + "extension", {
    method: "post", body: JSON.stringify({
      checkedAtInput: "testfw-ok",
      checkedAtOutput: "nonmatch"
    }),
    redirect: "manual",
    headers: { "content-type": "application/json" },
  })).status);

  services.broadcast("webhare_testsuite:invalidateopenapiextendedservice");
  let extendedopenapi2 = await (await fetch(extendedapiroot + "openapi.json", { redirect: "manual" })).json();
  await test.wait(async () => {
    if (extendedopenapi2["x-webhare_testsuite-randomuuid"] !== firstUuid)
      return true;
    extendedopenapi2 = await (await fetch(extendedapiroot + "openapi.json", { redirect: "manual" })).json();
  });
  test.eq(scriptUuid, extendedopenapi2["x-webhare_testsuite-scriptuuid"]);

  // Broadcast an resource update event for the hooks script, to trigger a reload of the OpenAPI spec
  services.broadcast("system:modulefolder.mod::webhare_testsuite/tests/wh/webserver/remoting/openapi/", {
    resourcename: "mod::webhare_testsuite/tests/wh/webserver/remoting/openapi/hooks.ts",
  });
  await test.wait(async () => {
    if (extendedopenapi2["x-webhare_testsuite-scriptuuid"] !== scriptUuid)
      return true;
    extendedopenapi2 = await (await fetch(extendedapiroot + "openapi.json", { redirect: "manual" })).json();
  });
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

  test.typeAssert<test.Equals<{ code: number }, restrequest.ResponseForCode<TestResponses, restrequest.RestDefaultErrorBody, HTTPSuccessCode.Ok>["response"]>>();
  test.typeAssert<test.Equals<{ status: HTTPErrorCode.NotFound; error: string; extra: string }, restrequest.ResponseForCode<TestResponses, restrequest.RestDefaultErrorBody, HTTPErrorCode.NotFound>["response"]>>();
  test.typeAssert<test.Assignable<{ status: HTTPErrorCode; error: string }, restrequest.ResponseForCode<TestResponses, restrequest.RestDefaultErrorBody, HTTPErrorCode.BadRequest>["response"]>>();
  // When both json and non-json are accepted, returns the JSON format
  test.typeAssert<test.Equals<string, restrequest.ResponseForCode<TestResponses, restrequest.RestDefaultErrorBody, HTTPSuccessCode.PartialContent>["response"]>>();
  // Test with override of default error
  test.typeAssert<test.Equals<{ status: HTTPErrorCode; error: string; extra: string }, restrequest.ResponseForCode<TestResponses, { status: HTTPErrorCode; error: string; extra: string }, HTTPErrorCode.BadRequest>["response"]>>();

  // just type-check the following code, don't run it
  const f = false;
  if (f) {
    const req: restrequest.RestRequest<null, object, null, TestResponses, restrequest.RestDefaultErrorBody> = null as any;
    const req_errdef: restrequest.RestRequest<null, object, null, TestResponses, { status: HTTPErrorCode; error: string; extra: string }> = null as any;
    const req_nonstderrdef: restrequest.RestRequest<null, object, null, TestResponses, { error: string; extra: string }> = null as any;

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
    req.createErrorResponse(HTTPErrorCode.BadGateway, { error: "not found", nonexisting: "extra" });
    // Is override of default error format handled?
    req_errdef.createErrorResponse(HTTPErrorCode.BadRequest, { error: "not found", extra: "extra" });
    // @ts-expect-error -- 'extra' is required
    req_errdef.createErrorResponse(HTTPErrorCode.BadRequest, { error: "not found" });
    req.createErrorResponse(HTTPErrorCode.BadGateway, { error: "Bad gateway", extra: 6 });

    req.createRawResponse(HTTPSuccessCode.Created, "blabla");
    req.createRawResponse(HTTPSuccessCode.PartialContent, "blabla");
    // @ts-expect-error -- not allowed for json-only apis
    req.createRawResponse(HTTPSuccessCode.Ok, "blabla");

    // @ts-expect-error -- not for errors where the body doesn't have a 'status' property
    req_nonstderrdef.createErrorResponse(HTTPErrorCode.BadRequest, { error: "not found", extra: "extra" });
  }
}

async function testLogFile() {
  const loglines = [];
  for await (const line of services.readLogLines<{ service: string; route: string; status: number; authorized?: { lastchar: string } }>("system:apicalls", { start: test.startTime, limit: new Date }))
    loglines.push(line);

  const usercalls = loglines.filter(_ => _.route === '/users/{userid}');
  test.eq(2, usercalls.length);

  const authtestcalls = loglines.filter(_ => _.service === 'webhare_testsuite:authtests' && _.status >= 200 && _.status < 300);
  test.eq(9, authtestcalls.length); // 3 from testAuthorization, 6 from testCORS
  test.eqPartial([
    { authorized: { lastchar: 't' } },
    { authorized: { lastchar: 't' } },
    { authorized: { lastchar: '2' } },
    { authorized: undefined }, // preflight calls
    { authorized: undefined }, // preflight calls
    { authorized: undefined }, // preflight calls
    { authorized: undefined }, // preflight calls
    { authorized: { lastchar: 'f' } },
    { authorized: { lastchar: 'g' } },
  ], authtestcalls, "Ensure all 9 calls had an authorized (even if we cache in the future!");
}

async function testGeneratedClient() { //test the client online
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

async function testFileTransfer() {
  using serviceFetch = await getDirectOpenAPIFetch("webhare_testsuite:testservice");
  const client = new OpenAPITestserviceClient(serviceFetch);

  {
    const res = await client.get("/file/{type}", { params: { type: "text" } });
    test.assert(res.status === HTTPSuccessCode.Ok && !("body" in res));
    test.eq("Hello world", await res.response.text());
  }

  {
    const res = await client.get("/file/{type}", { params: { type: "xml" } });
    test.assert(res.status === HTTPSuccessCode.Ok && !("body" in res));
    test.assert(!("body" in res));
    test.eq("<text>Hello world</text>", await res.response.text());
  }

  {
    const res = await client.get("/file/{type}", { params: { type: "json" } });
    test.assert(res.status === HTTPSuccessCode.Ok && "body" in res);
    test.eq({ json: true }, res.body);
  }

  {
    const res = await client.get("/getcontext/{id}", { params: { id: "json" } });
    test.assert(res.status === HTTPSuccessCode.Ok && "body" in res);
    test.eq({
      route: "/getcontext/{id}",
      params: { id: "json" },
      path: "/getcontext/json",
    }, res.body);
  }

}

test.runTests([
  testService,
  testAuthorization,
  testCORS,
  testOverlappingCalls,
  verifyPublicParts,
  testInternalTypes,
  testLogFile,
  testGeneratedClient,
  testFileTransfer,
]);
