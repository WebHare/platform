import type { TypedRestRequest } from "@mod-platform/generated/openapi/platform/api";
import type { AuthorizedWRDAPIUser } from "@webhare/openapi-service";
import { HTTPSuccessCode, type WebResponse } from "@webhare/router";
import { omit } from "@webhare/std";
import { runInWork } from "@webhare/whdb";
import { listSchemas, WRDSchema } from "@webhare/wrd";
import type { AllowedFilterConditions } from "@webhare/wrd/src/types";

export async function getSchemas(req: TypedRestRequest<AuthorizedWRDAPIUser, "get /wrd">): Promise<WebResponse> {
  //FIXME privilege checks

  const schemas = await listSchemas();
  return req.createJSONResponse(HTTPSuccessCode.Ok, schemas.map(schema => ({
    tag: schema.tag,
  })));
}

export async function createEntity(req: TypedRestRequest<AuthorizedWRDAPIUser, "post /wrd/{schema}/type/{type}/entity">): Promise<WebResponse> {
  //FIXME privilege checks

  const schema = new WRDSchema(req.params.schema);

  return await runInWork(async () => {
    if (!req.body.fields.wrdGuid)
      req.body.fields.wrdGuid = schema.getNextGuid(req.params.type);

    await schema.insert(req.params.type, req.body.fields);
    return req.createJSONResponse(HTTPSuccessCode.Created, { wrdGuid: req.body.fields.wrdGuid });
  });
}

export async function updateEntity(req: TypedRestRequest<AuthorizedWRDAPIUser, "patch /wrd/{schema}/type/{type}/entity/{entity}">): Promise<WebResponse> {
  //FIXME privilege checks

  const schema = new WRDSchema(req.params.schema);

  return await runInWork(async () => {
    await schema.update(req.params.type, { wrdGuid: req.params.entity }, req.body.fields);
    return req.createJSONResponse(HTTPSuccessCode.NoContent, null);
  });
}

export async function queryType(req: TypedRestRequest<AuthorizedWRDAPIUser, "post /wrd/{schema}/type/{type}/query">): Promise<WebResponse> {
  //FIXME privilege checks

  const schema = new WRDSchema(req.params.schema);
  let query = schema.query(req.params.type).select(["wrdId", ...req.body.fields || []]);
  for (const filter of req.body.filters || [])
    query = query.where(filter.field, filter.matchType as AllowedFilterConditions, filter.value);

  const results = await query.execute({ export: true });
  results.sort((a, b) => a.wrdId - b.wrdId); //sort by wrdId

  return req.createJSONResponse(HTTPSuccessCode.Ok, {
    results: req.body.fields?.includes("wrdId") ? results : omit(results, ["wrdId"]),
    nextToken: null
  });
}
