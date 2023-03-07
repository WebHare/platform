import { createJSONResponse, RestRequest, WebResponse } from "@webhare/router";
import * as test from "@webhare/test";

const persons = [
  { id: 1, firstName: "Alpha", email: "alpha@beta.webhare.net" },
  { id: 55, firstName: "Bravo", email: "bravo@beta.webhare.net" }
];

export async function getUsers(req: RestRequest): Promise<WebResponse> {
  test.eq('/users', req.path);
  return createJSONResponse(persons);
}
