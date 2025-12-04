import { createWRDTestSchema, getWRDSchema } from "@mod-webhare_testsuite/js/wrd/testhelpers";
import { HTTPErrorCode, HTTPSuccessCode, type OpenAPIAuthorization, type OpenAPIRequest, type OpenAPIResponse } from "@webhare/openapi-service";
import * as services from "@webhare/services";
import { WebHareNativeBlob } from "@webhare/services/src/webhareblob";
import { throwError } from "@webhare/std";
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

interface MyRestRequest extends OpenAPIRequest {
  authorization: MyAuthorization;
}

export async function allowAll(req: OpenAPIRequest): Promise<OpenAPIAuthorization> {
  return { authorized: true, authorization: null };
}

export async function reset(req: OpenAPIRequest) {
  await createWRDTestSchema();
  return req.createJSONResponse(HTTPSuccessCode.NoContent, null);
}

export async function getUsers(req: MyRestRequest): Promise<OpenAPIResponse> {
  test.eq('/users', req.path);
  let foundpersons = [...persons];
  if (req.params.searchFor)
    foundpersons = foundpersons.filter(person => person.firstName.includes(req.params.searchFor as string));

  return req.createJSONResponse(HTTPSuccessCode.Ok, foundpersons);
}

export async function getUser(req: TypedRestRequest<unknown, "get /users/{userid}">): Promise<OpenAPIResponse> {
  test.eq(`/users/${req.params.userid}`, req.path);
  test.eq("number", typeof req.params.userid);

  // @ts-expect-error -- userX should not exist and that should be validated
  if (req.params.userX) {
    return req.createErrorResponse(HTTPErrorCode.BadRequest, { message: "parameter userX is set" });
  }
  if (typeof req.params.wait !== "undefined" && typeof req.params.wait !== "boolean") {
    return req.createErrorResponse(HTTPErrorCode.InternalServerError, { message: `Parameter 'wait' has type ${typeof req.params.wait}` });
  }
  return req.createJSONResponse(HTTPSuccessCode.Ok, persons.find(_ => _.id === req.params.userid) ?? throwError(`User not found: ${req.params.userid}`));
}

export async function createUser(req: MyRestRequest): Promise<OpenAPIResponse> {
  test.eq('/users', req.path);

  const addperson = req.body as typeof persons[0];
  test.assert("email" in addperson);
  test.assert("firstName" in addperson);

  const wrdschema = await getWRDSchema();

  await whdb.beginWork(); //we need to get the transaction *before* we lock the mutex for testOverlappingCalls to make sense
  const lockadduser = await services.lockMutex("webhare_testsuite:adduser");

  const personid: number = await wrdschema.insert("wrdPerson", { wrdContactEmail: addperson.email, wrdFirstName: addperson.firstName, wrdauthAccountStatus: { status: "active" } });
  await whdb.commitWork();

  lockadduser.release(); //TODO it would be even cooler if WebHare could autorelease (or at least detect failure to release)
  return req.createJSONResponse(HTTPSuccessCode.Created, { ...addperson, id: personid });
}

export async function deleteUser(req: MyRestRequest): Promise<OpenAPIResponse> {
  test.eq(`/users/${req.params.userid}`, req.path);
  test.eq("number", typeof req.params.userid);
  return req.createJSONResponse(HTTPSuccessCode.NoContent, null);
}

export async function validateOutput(req: MyRestRequest): Promise<OpenAPIResponse> {
  switch (req.params.test) {
    case "ok": return req.createJSONResponse(HTTPSuccessCode.Ok, "ok");
    case "unknownStatusCode": return req.createJSONResponse(HTTPSuccessCode.SeeOther, { message: `See other people` });
    case "illegalData": return req.createJSONResponse(HTTPSuccessCode.Ok, { structure: "wrong" });
  }

  return req.createErrorResponse(HTTPErrorCode.BadRequest, { message: `Illegal type: ${JSON.stringify(req.params.test)}`, p: req.params });
}

export async function validatePathOutput(req: MyRestRequest): Promise<OpenAPIResponse> {
  switch (req.params.test) {
    case "ok": return req.createJSONResponse(HTTPSuccessCode.Ok, "ok");
    case "unknownStatusCode": return req.createJSONResponse(HTTPSuccessCode.SeeOther, { message: `See other people` });
    case "illegalData": return req.createJSONResponse(HTTPSuccessCode.Ok, { structure: "wrong" });
  }

  return req.createErrorResponse(HTTPErrorCode.BadRequest, { message: `Illegal path type: ${JSON.stringify(req.params.test)}`, p: req.params });
}

export async function getFile(req: TypedRestRequest<unknown, "/file/{type}">): Promise<OpenAPIResponse> {
  switch (req.params.type) {
    case "text": {
      return req.createRawResponse(HTTPSuccessCode.Ok, new Blob(["Hello world"]), { headers: { "Content-Type": "text/plain" } });
    }
    case "xml": {
      const resultBlob = new WebHareNativeBlob(new Blob(["<text>Hello world</text>"]));
      console.log(`resultBLob text: `, await resultBlob.text());
      return req.createRawResponse(HTTPSuccessCode.Ok, new WebHareNativeBlob(new Blob(["<text>Hello world</text>"])), { headers: { "Content-Type": "text/xml" } });
    }
    case "json": {
      // test sending a database file
      await whdb.beginWork();
      const blobToUpload = services.WebHareBlob.from(`{"json":true}`);
      const uploadedBlob = await whdb.uploadBlob(blobToUpload);
      await whdb.commitWork();
      return req.createRawResponse(HTTPSuccessCode.Ok, uploadedBlob, { headers: { "Content-Type": "application/json" } });
    }
  }
  return req.createErrorResponse(HTTPErrorCode.BadRequest, { message: `Illegal file type: ${JSON.stringify(req.params.type)}` });
}

export function getContext(req: TypedRestRequest<unknown, "/getcontext/{id}">) {
  return req.createJSONResponse(HTTPSuccessCode.Ok, {
    route: req.route,
    params: req.params,
    path: req.path,
  });
}
