import { createWRDTestSchema, getWRDSchema } from "@mod-webhare_testsuite/js/wrd/testhelpers";
import { createJSONResponse, HTTPErrorCode, HTTPSuccessCode, type RestRequest, type RestSuccessfulAuthorization, type WebResponse } from "@webhare/router";
import * as services from "@webhare/services";
import * as test from "@webhare/test";
import * as whdb from "@webhare/whdb";
import type { TypedRestRequest } from "wh:openapi/webhare_testsuite/testservice";

const persons = [
  { id: 1, firstName: "Alpha", email: "alpha@beta.webhare.net" },
  { id: 55, firstName: "Bravo", email: "bravo@beta.webhare.net" }
];

interface MyAuthorization {
  username: string;
  canwrite: boolean;
}

interface MyRestRequest extends RestRequest {
  authorization: MyAuthorization;
}

export async function allowAll(req: RestRequest): Promise<RestSuccessfulAuthorization> {
  return { authorized: true, authorization: null };
}

export async function reset() {
  await createWRDTestSchema();
  return createJSONResponse(HTTPSuccessCode.NoContent, null);
}

export async function getUsers(req: MyRestRequest): Promise<WebResponse> {
  test.eq('/users', req.path);
  let foundpersons = [...persons];
  if (req.params.searchFor)
    foundpersons = foundpersons.filter(person => person.firstName.includes(req.params.searchFor as string));

  return createJSONResponse(HTTPSuccessCode.Ok, foundpersons);
}

export async function getUser(req: TypedRestRequest<unknown, "get /users/{userid}">): Promise<WebResponse> {
  test.eq(`/users/${req.params.userid}`, req.path);
  test.eq("number", typeof req.params.userid);

  // @ts-expect-error -- userX should not exist and that should be validated
  if (req.params.userX) {
    return createJSONResponse(HTTPErrorCode.BadRequest, { error: "parameter userX is set" });
  }
  if (typeof req.params.wait !== "undefined" && typeof req.params.wait !== "boolean") {
    return createJSONResponse(HTTPErrorCode.InternalServerError, { error: `Parameter 'wait' has type ${typeof req.params.wait}` });
  }
  return createJSONResponse(HTTPSuccessCode.Ok, persons.find(_ => _.id === req.params.userid));
}

export async function createUser(req: MyRestRequest): Promise<WebResponse> {
  test.eq('/users', req.path);

  const addperson = req.body as typeof persons[0];
  test.assert("email" in addperson);
  test.assert("firstName" in addperson);

  const wrdschema = await getWRDSchema();

  await whdb.beginWork(); //we need to get the transaction *before* we lock the mutex for testOverlappingCalls to make sense
  const lockadduser = await services.lockMutex("webhare_testsuite:adduser");

  const personid: number = await wrdschema.insert("wrdPerson", { wrdContactEmail: addperson.email, wrdFirstName: addperson.firstName });
  await whdb.commitWork();

  lockadduser.release(); //TODO it would be even cooler if WebHare could autorelease (or at least detect failure to release)
  return createJSONResponse(HTTPSuccessCode.Created, { ...addperson, id: personid });
}

export async function deleteUser(req: MyRestRequest): Promise<WebResponse> {
  test.eq(`/users/${req.params.userid}`, req.path);
  test.eq("number", typeof req.params.userid);
  return createJSONResponse(HTTPSuccessCode.NoContent, null);
}

export async function validateOutput(req: MyRestRequest): Promise<WebResponse> {
  switch (req.params.test) {
    case "ok": return createJSONResponse(HTTPSuccessCode.Ok, "ok");
    case "unknownStatusCode": return createJSONResponse(HTTPSuccessCode.SeeOther, { error: `See other people` });
    case "illegalData": return createJSONResponse(HTTPSuccessCode.Ok, { structure: "wrong" });
  }

  return createJSONResponse(HTTPErrorCode.BadRequest, { error: `Illegal type: ${JSON.stringify(req.params.test)}`, p: req.params });
}

export async function validatePathOutput(req: MyRestRequest): Promise<WebResponse> {
  switch (req.params.test) {
    case "ok": return createJSONResponse(HTTPSuccessCode.Ok, "ok");
    case "unknownStatusCode": return createJSONResponse(HTTPSuccessCode.SeeOther, { error: `See other people` });
    case "illegalData": return createJSONResponse(HTTPSuccessCode.Ok, { structure: "wrong" });
  }

  return createJSONResponse(HTTPErrorCode.BadRequest, { error: `Illegal path type: ${JSON.stringify(req.params.test)}`, p: req.params });
}
