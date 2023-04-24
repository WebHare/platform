import { createWRDTestSchema, getWRDSchema } from "@mod-webhare_testsuite/js/wrd/testhelpers";
import { createJSONResponse, HTTPErrorCode, HTTPSuccessCode, RestRequest, RestSuccessfulAuthorization, WebResponse } from "@webhare/router";
import * as services from "@webhare/services";
import * as test from "@webhare/test";
import * as whdb from "@webhare/whdb";

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
  return createJSONResponse(HTTPSuccessCode.NoContent, {});
}

export async function getUsers(req: MyRestRequest): Promise<WebResponse> {
  test.eq('/users', req.path);
  let foundpersons = [...persons];
  if (req.params.searchFor)
    foundpersons = foundpersons.filter(person => person.firstName.includes(req.params.searchFor as string));

  return createJSONResponse(HTTPSuccessCode.Ok, foundpersons);
}

export async function getUser(req: MyRestRequest): Promise<WebResponse> {
  test.eq(`/users/${req.params.userid}`, req.path);
  test.eq("number", typeof req.params.userid);
  return createJSONResponse(HTTPSuccessCode.Ok, persons.find(_ => _.id == req.params.userid));
}

export async function createUser(req: MyRestRequest): Promise<WebResponse> {
  test.eq('/users', req.path);

  const addperson = req.body as typeof persons[0];
  test.assert("email" in addperson);
  test.assert("firstName" in addperson);

  const wrdschema = await getWRDSchema();

  await whdb.beginWork(); //we need to get the transaction *before* we lock the mutex for testOverlappingCalls to make sense
  const lockadduser = await services.lockMutex("webhare_testsuite:adduser");

  const persontype = wrdschema.types.wrd_person;
  const personid: number = (await persontype.createEntity({ wrd_contact_email: addperson.email, wrd_firstname: addperson.firstName })).id;
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

  return createJSONResponse(HTTPErrorCode.BadRequest, { error: `Illegal type` });
}
