import { type AuthorizedWRDAPIUser, type OpenAPIResponse, HTTPErrorCode, HTTPSuccessCode } from "@webhare/openapi-service";
import type { TypedRestRequest } from "@mod-platform/generated/openapi/platform/api";
import { createFirstPartyToken, getToken, listTokens } from "@webhare/auth";
import type { AuthTokenOptions, FirstPartyToken, ListedToken } from "@webhare/auth/src/identity";
import { pick, throwError, typedFromEntries } from "@webhare/std";
import { runInWork } from "@webhare/whdb";
import { listSchemas, WRDSchema } from "@webhare/wrd";
import type { AllowedFilterConditions } from "@webhare/wrd/src/types";
import { decryptForThisServer, encryptForThisServer } from "@webhare/services";

/* FIXME for nearly all APIs here:
   - privilege checks
   - audit information
   */

const maxPageSize = 1000;

declare module "@webhare/services" {
  interface ServerEncryptionScopes {
    "platform:wrdapi": {
      lastId: number;
    };
  }

}

export async function getSchemas(req: TypedRestRequest<AuthorizedWRDAPIUser, "get /wrd">): Promise<OpenAPIResponse> {
  const schemas = await listSchemas();
  return req.createJSONResponse(HTTPSuccessCode.Ok, schemas.map(schema => ({
    tag: schema.tag,
  })));
}

export async function createEntity(req: TypedRestRequest<AuthorizedWRDAPIUser, "post /wrd/{schema}/type/{type}/entity">): Promise<OpenAPIResponse> {
  const schema = new WRDSchema(req.params.schema);

  return await runInWork(async () => {
    if (!req.body.fields.wrdGuid)
      req.body.fields.wrdGuid = schema.getNextGuid(req.params.type);

    await schema.insert(req.params.type, req.body.fields);
    return req.createJSONResponse(HTTPSuccessCode.Created, { wrdGuid: req.body.fields.wrdGuid });
  });
}

export async function updateEntity(req: TypedRestRequest<AuthorizedWRDAPIUser, "patch /wrd/{schema}/type/{type}/entity/{entity}">): Promise<OpenAPIResponse> {
  const schema = new WRDSchema(req.params.schema);

  return await runInWork(async () => {
    await schema.update(req.params.type, { wrdGuid: req.params.entity }, req.body.fields);
    return req.createJSONResponse(HTTPSuccessCode.NoContent, null);
  });
}

export async function queryType(req: TypedRestRequest<AuthorizedWRDAPIUser, "post /wrd/{schema}/type/{type}/query">): Promise<OpenAPIResponse> {
  //We sort/paginate by wrdId but that is not supposed to be a future promise - whatever works for pagination!
  const schema = new WRDSchema(req.params.schema);
  let query = schema.query(req.params.type).select("wrdId");
  for (const filter of req.body.filters || [])
    query = query.where(filter.field, filter.matchType as AllowedFilterConditions, filter.value);

  const resultIds = await query.execute();
  resultIds.sort((a, b) => a - b); //sort by wrdId

  const usePageSize = req.body.pageSize ? Math.min(req.body.pageSize, maxPageSize) : maxPageSize;
  if (usePageSize < 1)
    return req.createErrorResponse(HTTPErrorCode.BadRequest, { error: "pageSize must be at least 1" });

  if (req.body.nextToken) {
    const prevToken = decryptForThisServer("platform:wrdapi", req.body.nextToken, { nullIfInvalid: true });
    if (!prevToken)
      return req.createErrorResponse(HTTPErrorCode.BadRequest, { error: "Invalid nextToken" });

    resultIds.splice(0, resultIds.findIndex(id => id > prevToken.lastId));
  }

  const haveMoreReults = resultIds.length > usePageSize;
  if (haveMoreReults)
    resultIds.splice(usePageSize);

  if (!resultIds.length)
    return req.createJSONResponse(HTTPSuccessCode.Ok, {
      results: []
    });

  const nextToken = haveMoreReults ? encryptForThisServer("platform:wrdapi", { lastId: resultIds[resultIds.length - 1] }) : undefined;

  const finalResults = await schema.query(req.params.type).
    where("wrdId", "in", resultIds).
    select(req.body.fields || []).
    execute({ export: true, exportResources: "fetch" });

  return req.createJSONResponse(HTTPSuccessCode.Ok, {
    results: finalResults,
    ...nextToken ? { nextToken } : {}
  });
}

export async function listTypes(req: TypedRestRequest<AuthorizedWRDAPIUser, "get /wrd/{schema}/type">): Promise<OpenAPIResponse> {
  const types = await new WRDSchema(req.params.schema).listTypes();
  return req.createJSONResponse(HTTPSuccessCode.Ok, typedFromEntries(types.map(type =>
    [
      type.tag,
      pick(type, ["metaType"])
    ]
  )));
}

function mapTokenInfo(token: ListedToken) {
  return {
    created: token.created.toString(),
    ...token.expires ? { expires: token.expires.toString() } : {},
    ...token.title ? { title: token.title } : {}
  };
}

export async function listApiTokens(req: TypedRestRequest<AuthorizedWRDAPIUser, "get /wrd/{schema}/type/{type}/entity/{entity}/apitoken">): Promise<OpenAPIResponse> {
  const schema = new WRDSchema(req.params.schema);
  const target = await schema.find(req.params.type, { wrdGuid: req.params.entity });
  if (!target)
    return req.createErrorResponse(HTTPErrorCode.NotFound, { error: "Entity not found" });

  const tokens = await listTokens(schema, target);
  return req.createJSONResponse(HTTPSuccessCode.Ok, tokens.filter(tok => tok.type === "api" && tok.client === null).map(mapTokenInfo));
}

export async function createApiToken(req: TypedRestRequest<AuthorizedWRDAPIUser, "post /wrd/{schema}/type/{type}/entity/{entity}/apitoken">): Promise<OpenAPIResponse> {
  const schema = new WRDSchema(req.params.schema);
  const target = await schema.find(req.params.type, { wrdGuid: req.params.entity });
  if (!target)
    return req.createErrorResponse(HTTPErrorCode.NotFound, { error: "Entity not found" });

  const options: AuthTokenOptions = {
    scopes: req.body.scopes || [],
    title: req.body.title || ""
  };

  if ("expires" in req.body)
    options.expires = req.body.expires === null ? Infinity : req.body.expires;

  const tok: FirstPartyToken = await createFirstPartyToken(schema, "api", target, options);
  const allinfo = await getToken(schema, tok.id) ?? throwError("Could not retrieve created token info");
  return req.createJSONResponse(HTTPSuccessCode.Created, { token: tok.accessToken, ...mapTokenInfo(allinfo) });
}
