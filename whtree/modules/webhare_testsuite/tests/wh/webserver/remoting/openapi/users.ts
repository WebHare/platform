import { createJSONResponse, HTTPSuccessCode, RestRequest, WebResponse } from "@webhare/router";
import * as test from "@webhare/test";

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

export async function allowAll(req: RestRequest) {
  return { authorized: true };
}

export async function getUsers(req: MyRestRequest): Promise<WebResponse> {
  test.eq('/users', req.path);
  let foundpersons = [...persons];
  if (req.params.searchFor)
    foundpersons = foundpersons.filter(person => person.firstName.includes(req.params.searchFor as string));

  return createJSONResponse(foundpersons);
}

export async function getUser(req: MyRestRequest): Promise<WebResponse> {
  test.eq(`/users/${req.params.userid}`, req.path);
  test.eq("number", typeof req.params.userid);
  return createJSONResponse(persons.find(_ => _.id == req.params.userid));
}

export async function createUser(req: MyRestRequest): Promise<WebResponse> {
  test.eq('/users', req.path);

  const addperson = req.body as typeof persons[0];
  test.assert("email" in addperson);
  test.assert("firstName" in addperson);

  return createJSONResponse({ ...addperson, id: 77 }, { status: HTTPSuccessCode.Created });
}
