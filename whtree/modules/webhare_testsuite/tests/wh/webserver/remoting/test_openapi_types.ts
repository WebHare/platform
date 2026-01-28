/* eslint-disable @typescript-eslint/no-unused-vars */
import type { DefaultErrorType, GetBodyType, GetOperation, GetParametersType, IsMediaTypeJSON, OperationResponseTypes, ResponseTypesFromResponses, MergeParameters, OpenApiTypedRestAuthorizationRequest, OpenApiTypedRestRequest, OperationIds, SquashObjectType } from "@webhare/openapi-client/src/types";
import { HTTPErrorCode, HTTPSuccessCode, type RestRequest } from "@webhare/router";
import * as test from "@webhare/test";

type ErrorResponseContent = {
  status: number;
  error: string;
};
type ErrorResponse = {
  content: {
    "application/json": ErrorResponseContent;
  };
};

interface paths {
  "/path": {
    get: {
      responses: {
        [HTTPSuccessCode.Ok]: {
          content: {
            "application/json": {
              status: "ok";
              value: number;
            };
          };
        };
        [HTTPErrorCode.Unauthorized]: ErrorResponse;
        [HTTPErrorCode.Forbidden]: ErrorResponse;
        [HTTPErrorCode.InternalServerError]: ErrorResponse;
      };
    };
    post: {
      requestBody: {
        content: {
          "application/json": {
            id: string;
          };
        };
      };
      responses: {
        [HTTPSuccessCode.Created]: {
          content: {
            "application/json": {
              status: "ok";
              value: string;
            };
          };
        };
        [HTTPErrorCode.Unauthorized]: ErrorResponse;
        [HTTPErrorCode.Forbidden]: ErrorResponse;
      };
    };
  };
  "/path/{bla}": {
    parameters: { path: { bla: string } };
    get: {
      parameters: { path: { bla: string } };
      responses: {
        [HTTPSuccessCode.Ok]: {
          content: {
            "application/json": {
              status: "ok";
              value: number;
            };
          };
        };
        [HTTPErrorCode.Unauthorized]: ErrorResponse;
        [HTTPErrorCode.Forbidden]: ErrorResponse;
      };
    };
    delete: {
      parameters: { path: { bla: string } };
    };
  };
  "/path/{bla}/paramtest": {
    parameters: { path: { bla: string } };
    get: {
      parameters: { path: { bla: string }; query: { bla2?: string } };
      responses: {
        [HTTPSuccessCode.Ok]: {
          content: {
            "application/json": {
              status: "ok";
              value: number;
            };
          };
        };
        [HTTPErrorCode.Unauthorized]: ErrorResponse;
        [HTTPErrorCode.Forbidden]: ErrorResponse;
      };
    };
    delete: {
      parameters: { path: { bla: string } };
      responses: {
        [HTTPSuccessCode.NoContent]: object;
        [HTTPErrorCode.Unauthorized]: ErrorResponse;
        [HTTPErrorCode.Forbidden]: ErrorResponse;
      };
    };
  };
  // Request without any specified content types in ok, and a error response with non-standard content
  "/dummy": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** A dummy */
        [HTTPSuccessCode.Ok]: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** Bad request */
        [HTTPErrorCode.BadRequest]: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              code?: string;
              errorid?: string;
              message?: string;
            };
          };
        };
      };
    };
  };
}

interface auth_paths {
  "/path": {
    get: {
      responses: {
        [HTTPSuccessCode.Ok]: {
          content: {
            "application/json": {
              status: "ok";
              value: number;
            };
          };
        };
        [HTTPErrorCode.Unauthorized]: ErrorResponse;
        [HTTPErrorCode.Forbidden]: ErrorResponse;
        [HTTPErrorCode.InternalServerError]: ErrorResponse;
      };
    };
  };
  "/path/{bla}": {
    parameters: { path: { bla: string } };
    get: {
      parameters: { path: { bla: string } };
      responses: {
        [HTTPSuccessCode.Ok]: {
          content: {
            "application/json": {
              status: "ok";
              value: number;
            };
          };
        };
        [HTTPErrorCode.Unauthorized]: ErrorResponse;
        [HTTPErrorCode.Forbidden]: ErrorResponse;
      };
    };
  };
}

type components_defaulterror = {
  schemas: {
    defaulterror: {
      status: number;
      error: string;
      extra?: string;
    };
  };
};

export type SimplifyIntersections<T> = T extends object ? SquashObjectType<T> : T;

function testOpenAPITypes() {
  // For operations, all `${method} ${path}` are allowed, as well as all `${path}`
  test.typeAssert<test.Assignable<
    "/path" | "get /path" | "post /path" |
    "/path/{bla}" | "get /path/{bla}" | "delete /path/{bla}" |
    "/path/{bla}/paramtest" | "get /path/{bla}/paramtest" | "delete /path/{bla}/paramtest" |
    "/dummy" | "get /dummy" |
    "*", OperationIds<paths>>>();

  // GetOperation should return the operation and the path, for paths a union of all operations and the path
  test.typeAssert<test.Equals<paths["/path"]["get"] & { _path: paths["/path"] }, GetOperation<paths, "get /path">>>();
  test.typeAssert<test.Equals<(paths["/path"]["get"] | paths["/path"]["post"]) & { _path: paths["/path"] }, GetOperation<paths, "/path">>>();
  test.typeAssert<test.Equals<(paths["/path/{bla}"]["get"] | paths["/path/{bla}"]["delete"]) & { _path: paths["/path/{bla}"] }, GetOperation<paths, "/path/{bla}">>>();
  test.typeAssert<test.Equals<GetOperation<paths, "/path"> | GetOperation<paths, "/path/{bla}"> | GetOperation<paths, "/dummy"> | GetOperation<paths, "/path/{bla}/paramtest">, GetOperation<paths, "*">>>();

  test.typeAssert<test.Equals<{ a: 1; b: 2 }, SimplifyIntersections<MergeParameters<{ path: { a: 1 }; query: { b: 2 } }>>>>();
  test.typeAssert<test.Equals<{ a: 1; b?: 2 }, SimplifyIntersections<MergeParameters<{ path: { a: 1 }; query?: { b?: 2 } }>>>>();
  test.typeAssert<test.Equals<{ a: 1 } | { a: 1; b: 2 }, SimplifyIntersections<MergeParameters<{ path: { a: 1 }; query: { b: 2 } } | { path: { a: 1 } }>>>>();

  // No responses at all provided: none allowed
  test.typeAssert<test.Equals<never, ResponseTypesFromResponses<object>>>();

  // Response for a code provided, but no content: allow raw and unknown json
  test.typeAssert<test.Equals<
    { status: HTTPSuccessCode.Ok; isjson: boolean; response: unknown },
    ResponseTypesFromResponses<{ [HTTPSuccessCode.Ok]: object }>>>();

  // No response provided: don't allow to read the body via JSON
  test.typeAssert<test.Equals<
    { status: HTTPSuccessCode.Ok; isjson: boolean; response: unknown },
    ResponseTypesFromResponses<{ [HTTPSuccessCode.Ok]: never }>>>();

  test.typeAssert<test.Equals<
    { status: HTTPSuccessCode.Ok; isjson: boolean; response: unknown },
    ResponseTypesFromResponses<{ [HTTPSuccessCode.Ok]: { content: never } }>>>();

  test.typeAssert<test.Equals<
    { status: HTTPSuccessCode.Ok; isjson: true; response: number },
    ResponseTypesFromResponses<{ [HTTPSuccessCode.Ok]: { content: { "application/json": number } } }>>>();
  test.typeAssert<test.Equals<
    { status: HTTPSuccessCode.Ok; isjson: false; response: unknown },
    ResponseTypesFromResponses<{ [HTTPSuccessCode.Ok]: { content: { "image/png": unknown } } }>>>();
  test.typeAssert<test.Equals<
    { status: HTTPSuccessCode.Ok; isjson: boolean; response: number },
    ResponseTypesFromResponses<{ [HTTPSuccessCode.Ok]: { content: { "application/json": number; "image/png": unknown } } }>>>();

  test.typeAssert<test.Equals<
    { status: HTTPSuccessCode.Ok; isjson: boolean; response: number } |
    { status: HTTPSuccessCode.Created; isjson: true; response: string } |
    { status: HTTPErrorCode.NotFound; isjson: true; response: { status: HTTPErrorCode; error: string; extra: boolean } },
    ResponseTypesFromResponses<{
      [HTTPSuccessCode.Ok]: { content: { "application/json": number; "image/png": unknown } };
      [HTTPSuccessCode.Created]: { content: { "application/json": string } };
      [HTTPErrorCode.NotFound]: { content: { "application/json": { status: HTTPErrorCode; error: string; extra: boolean } } };
    }>>>();

  test.typeAssert<test.Equals<
    { status: HTTPSuccessCode.Ok; isjson: boolean; response: number } |
    { status: HTTPErrorCode.NotFound; isjson: true; response: ({ status: HTTPErrorCode; error: string; extra: string } | { status: HTTPErrorCode; error: string }) },
    ResponseTypesFromResponses<{
      [HTTPSuccessCode.Ok]: { content: { "application/json": number; "image/png": unknown } };
      [HTTPSuccessCode.Created]: { content: { "application/json": string } };
      [HTTPErrorCode.NotFound]: { content: { "application/json": { status: HTTPErrorCode; error: string } } };
    } | {
      [HTTPSuccessCode.Ok]: { content: { "application/json": number; "image/png": unknown } };
      [HTTPErrorCode.NotFound]: { content: { "application/json": { status: HTTPErrorCode; error: string; extra: string } } };
      [HTTPErrorCode.InternalServerError]: { content: { "application/json": { status: HTTPErrorCode; error: string; extra: string } } };
    }>>>();

  test.typeAssert<test.Equals<
    { status: HTTPSuccessCode.Ok; isjson: true; response: { status: "ok"; value: number } } |
    { status: HTTPErrorCode.Unauthorized; isjson: true; response: ErrorResponseContent } |
    { status: HTTPErrorCode.Forbidden; isjson: true; response: ErrorResponseContent } |
    { status: HTTPErrorCode.InternalServerError; isjson: true; response: ErrorResponseContent },
    OperationResponseTypes<paths["/path"]["get"]>>>();

  test.typeAssert<test.Equals<
    { status: HTTPErrorCode.Unauthorized; isjson: true; response: ErrorResponseContent } |
    { status: HTTPErrorCode.Forbidden; isjson: true; response: ErrorResponseContent },
    OperationResponseTypes<paths["/path"]["get"] | paths["/path"]["post"]>>>();

  test.typeAssert<test.Equals<
    { status: HTTPErrorCode.Unauthorized; isjson: true; response: ErrorResponseContent } |
    { status: HTTPErrorCode.Forbidden; isjson: true; response: ErrorResponseContent },
    OperationResponseTypes<GetOperation<paths, "/path">>>>();

  test.typeAssert<test.Equals<true, IsMediaTypeJSON<{ "application/json": number }>>>();
  test.typeAssert<test.Equals<false, IsMediaTypeJSON<{ "image/png": number }>>>();
  test.typeAssert<test.Equals<boolean, IsMediaTypeJSON<{ "image/png": number; "application/json": number }>>>();
  test.typeAssert<test.Equals<boolean, IsMediaTypeJSON<never>>>();

  test.typeAssert<test.Equals<{ status: HTTPSuccessCode.Ok; isjson: true; response: number }, ResponseTypesFromResponses<{ [HTTPSuccessCode.Ok]: { content: { "application/json": number } } }>>>();
  test.typeAssert<test.Equals<{ status: HTTPSuccessCode.Ok; isjson: boolean; response: number }, ResponseTypesFromResponses<{ [HTTPSuccessCode.Ok]: { content: { "application/json": number; "image/png": string } } }>>>();
  test.typeAssert<test.Equals<{ status: HTTPSuccessCode.Ok; isjson: false; response: unknown }, ResponseTypesFromResponses<{ [HTTPSuccessCode.Ok]: { content: { "image/png": string } } }>>>();
  test.typeAssert<test.Equals<{ status: HTTPSuccessCode.Ok; isjson: boolean; response: unknown }, ResponseTypesFromResponses<{ [HTTPSuccessCode.Ok]: object }>>>();
  test.typeAssert<test.Equals<{ status: HTTPSuccessCode.Ok; isjson: boolean; response: unknown }, ResponseTypesFromResponses<{ [HTTPSuccessCode.Ok]: never }>>>();
  test.typeAssert<test.Equals<{ status: HTTPSuccessCode.Ok; isjson: boolean; response: unknown }, ResponseTypesFromResponses<{ [HTTPSuccessCode.Ok]: { content: never } }>>>();

  // Delete has no responses defined, so JSONResponseTypes should be empty
  test.typeAssert<test.Equals<never, OperationResponseTypes<paths["/path/{bla}"]["get"] | paths["/path/{bla}"]["delete"]>>>();

  // Request body of /path/post
  test.typeAssert<test.Equals<paths["/path"]["post"]["requestBody"]["content"]["application/json"], GetBodyType<paths["/path"]["post"]>>>();
  test.typeAssert<test.Equals<unknown | paths["/path"]["post"]["requestBody"]["content"]["application/json"], GetBodyType<paths["/path"]["get"] | paths["/path"]["post"]>>>();

  // Parameters of operations/paths
  test.typeAssert<test.Equals<{ bla: string }, SimplifyIntersections<GetParametersType<GetOperation<paths, "get /path/{bla}">>>>>();
  test.typeAssert<test.Equals<{ bla: string }, SimplifyIntersections<GetParametersType<GetOperation<paths, "/path/{bla}">>>>>();
  test.typeAssert<test.Equals<object, GetParametersType<GetOperation<paths, "get /path/{bla}" | "get /path">>>>();
  test.typeAssert<test.Equals<{ bla: string; bla2?: string }, GetParametersType<GetOperation<paths, "get /path/{bla}/paramtest">>>>();
  test.typeAssert<test.Equals<{ bla: string }, GetParametersType<GetOperation<paths, "/path/{bla}/paramtest">>>>();

  // Can assert a typed rest request for an operation to a rest request for a path (for calling path-generic checks from operations)
  test.typeAssert<test.Assignable<OpenApiTypedRestRequest<number, paths, object, "/path">, OpenApiTypedRestRequest<number, paths, object, "get /path">>>();

  // No default error? Then use the union of all error responses
  test.typeAssert<test.Equals<{
    status: number;
    error: string;
  }, DefaultErrorType<auth_paths, object>>>();

  // No default error? Then use the union of all error responses
  test.typeAssert<test.Equals<ErrorResponseContent | {
    code?: string;
    errorid?: string;
    message?: string;
  }, DefaultErrorType<paths, object>>>();

  test.typeAssert<test.Equals<{
    status: number;
    error: string;
    extra?: string;
  }, DefaultErrorType<auth_paths, components_defaulterror>>>();

  const b = false;
  if (b) { // unreachable code for type-error tests
    const any_value: any = null;
    const path_get: OpenApiTypedRestRequest<number, paths, object, "get /path"> = any_value;
    test.typeAssert<test.Equals<number, typeof path_get.authorization>>();
    path_get?.createJSONResponse(HTTPSuccessCode.Ok, { status: "ok", value: 13 });
    // TODO: see if we can disallow this (for example by)
    path_get?.createJSONResponse(200, { status: "ok", value: 13 });
    // @ts-expect-error -- Type checked responses
    path_get.createJSONResponse(HTTPSuccessCode.Ok, { status: "fail" });
    test.typeAssert<test.Equals<object, typeof path_get.params>>();
    test.typeAssert<test.Equals<unknown, typeof path_get.body>>();

    const path_post: OpenApiTypedRestRequest<number, paths, object, "post /path"> = any_value;
    test.typeAssert<test.Equals<{ id: string }, typeof path_post.body>>();

    const pathbla_delete: OpenApiTypedRestRequest<number, paths, object, "delete /path/{bla}"> = any_value;

    test.typeAssert<test.Equals<{ bla: string }, SimplifyIntersections<typeof pathbla_delete.params>>>();

    const authtest: OpenApiTypedRestAuthorizationRequest<auth_paths, object> = any_value;
    authtest.createErrorResponse(HTTPErrorCode.Forbidden, { error: "failure" });
    authtest.createErrorResponse(HTTPErrorCode.InternalServerError, { error: "failure" });

    let path: OpenApiTypedRestRequest<number, paths, object, "/path"> = any_value;
    path.createErrorResponse(HTTPErrorCode.Unauthorized, { error: "failure" });

    // @ts-expect-error -- Type checked error response
    path.createErrorResponse(HTTPErrorCode.Unauthorized, { error: "failure", extra: "16" });

    // run-time assignment also compiles
    path = path_get;

    const path_errdef: OpenApiTypedRestRequest<number, paths, components_defaulterror, "/path"> = any_value;
    path_errdef.createErrorResponse(HTTPErrorCode.Conflict, { error: "failure", extra: "16" });

    const path_opparams_get: OpenApiTypedRestRequest<number, paths, components_defaulterror, "get /path/{bla}/paramtest"> = any_value;
    test.typeAssert<test.Equals<{ bla: string; bla2?: string }, SimplifyIntersections<typeof path_opparams_get.params>>>();

    const default_restRequest: RestRequest = any_value;
    const allSuccessCodes: HTTPSuccessCode = any_value;
    default_restRequest.createJSONResponse(HTTPSuccessCode.Ok, { status: "ok", value: 13 });
    default_restRequest.createJSONResponse(allSuccessCodes, { status: "ok", value: 13 });
    default_restRequest.createErrorResponse(HTTPErrorCode.Conflict, { error: "blabla" });
  }
}

test.runTests([testOpenAPITypes]);
