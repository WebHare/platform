import type { RestRequest, HTTPErrorCode, HTTPSuccessCode } from "@webhare/router";


type NeverFallback<A, B> = [A] extends [never] ? B : A;

/** Given a paths object (`{ "/path": { "get": Operation } }`) returns all strings "/path" and "get /path"
 * @typeParam Paths - Paths from generated openapi ts file
 * @typeParam Path - Do not provide, is used to iterate over the keys of Paths
 */
export type OperationIds<Paths extends object, Path extends keyof Paths & string = keyof Paths & string> = (Path extends keyof Paths
  ? `${Exclude<keyof Paths[Path] & string, "parameters">} ${Path}`
  : never) | Path | "*";

/** Returns all the operation for a specified path and method
 * @typeParam Paths - Paths from generated openapi ts file
 * @typeParam Path - Path of the operation
 * @typeParam Method - Method of the operation
 */
export type GetOperationByPathAndMethod<Paths extends object, Path extends keyof Paths, Method extends Exclude<keyof Paths[Path], "parameters">> = Paths[Path] extends object ? Paths[Path][Method] & { _path: Paths[Path] } : never;

/** Returns all operations for paths (or all paths if second type parameter is not specified)
 * @typeParam Paths - Paths from generated openapi ts file
 * @typeParam Path - Do not provide, is used to iterate over the keys of Paths
 */
export type AllOperationsOfPath<Paths extends object, Path extends keyof Paths = keyof Paths> = (Path extends keyof Paths
  ? GetOperationByPathAndMethod<Paths, Path, Exclude<keyof Paths[Path], "parameters">>
  : never);

/** Given a path, return the union of all operations of that path. Given `method path`, return the specific operation. Also adds the path object as `_path`
 * @typeParam Paths - Paths from generated openapi ts file
 * @typeParam OperationId - Operation id, eg. "/path" (for all operations of a path) or "get /path"
 */
export type GetOperation<Paths extends object, OperationId extends OperationIds<Paths>> = OperationId extends `${infer Method} ${infer Path extends keyof Paths & string}`
  ? (Method extends Exclude<keyof Paths[Path], "parameters"> ? GetOperationByPathAndMethod<Paths, Path, Method> : never)
  : (OperationId extends keyof Paths
    ? AllOperationsOfPath<Paths, OperationId>
    : (OperationId extends "*"
      ? AllOperationsOfPath<Paths>
      : never));

/* ObjectUnionToIntersection, used to infer default method (return value when there is only one possibility, never otherwise when used for simple strings)
   from https://stackoverflow.com/questions/50374908/transform-union-type-to-intersection-type/50375286#50375286
*/
export type ObjectUnionToIntersection<T> = (T extends unknown ? (x: T) => unknown : never) extends (x: infer R extends object) => unknown ? R : never;

/** SquashObjectType gets rid of toplevel intersections and unions in a type, improves type hinting experience.
 *  When given a union of objects, it returns an object with intersection of all keys of the individual objects.
*/
/* We can't directly use `{ [K in keyof T]: T[K] }`, because that distributes over T when it's a union.
   Move the union to an inner property so distribution can be avoided.
*/
export type SquashObjectType<T extends object> = SquashObjectTypeInner<{ a: T }>;

/* First testing if there are any keys, if not return `object`.
   `{ [K in keyof T["a"]]: T["a"][K] }` would return `{}` in that case
*/
type SquashObjectTypeInner<T extends { a: object }> = keyof T["a"] extends never ? object : { [K in keyof T["a"]]: T["a"][K] };

/** Returns a union of all values of an object type */
export type ObjectValues<T> = T extends object ? T[keyof T] : never;

/** For a response object, return the JSON schemas of all error responses */
export type GetErrorResponses<R extends object> = R extends object ? ObjectValues<{ [K in keyof R as K extends HTTPErrorCode ? K : never]: R[K] extends { content: { "application/json": infer C extends object } } ? C : never }> : never;

/** Return a union of all error responses */
export type AllErrorResponses<Paths extends object> = GetErrorResponses<GetOperationResponses<AllOperationsOfPath<Paths>>>;

/** Given a parameters object (`{ path: { param1: string }; query: { queryparam?: string } }`), returns `{ param1: string, queryparam?: string }`.
 * @typeParam MergeParameters - Parameters object
 */
/* We need UnionToIntersection to merge the { paths: ..., queries: ... } part, but we need a union to keep only the members that are present in all parameter objects. So, distribute over the
union of parameter objects (with the first Parameters extends ...), and then make an intersection of all subobjects of the individual parameter objects. */
export type MergeParameters<Parameters extends object> = Parameters extends object ? ObjectUnionToIntersection<Parameters[keyof Parameters] & object> : never; // The `& object` is needed to convert `object | undefined` for query parameters to object

/** Returns the contents responses cell of an operation, if it has one. If not, an empty object
 * @typeParam Operation - Operation object
*/
export type GetOperationResponses<Operation extends object> = Operation extends { responses: infer Responses } ? Responses & object : object;

/** Returns true if a mediatypes object contains "application/json", false if it contains anything else. Returns boolean (= true | false) if it contains application/json and something else (or equals never)
 * @typeParam MediaTypes - Media types object (is contents of 'content' of a response)
*/
export type IsMediaTypeJSON<MediaTypes extends object, K extends keyof MediaTypes = keyof MediaTypes> = [MediaTypes] extends [never] ? boolean : (K extends "application/json" ? true : false);

/** Returns the content of the appliction/json mediatype, if it exists on the response object. Uses UnionToIntersection to combine schemas of a union of responses
 * @typeParam Response - Response object
 */
export type GetJSONContent<Response> = NeverFallback<Response extends { "content": { "application/json": infer C } } ? C : never, unknown>;

/** Calculates the response types for a response
 * @typeParam Responses - Operation responses object
 * @typeParam ResponseCode - Should not be provided, needed to enumerate all keys of R
 */
export type ResponseTypesFromResponses<Responses extends object, ResponseCode extends keyof Responses = keyof Responses> = ResponseCode extends keyof Responses
  ? (ResponseCode extends HTTPErrorCode // error codes must be JSON
    ? {
      status: ResponseCode;
      isjson: true;
      response: GetJSONContent<Responses[ResponseCode]>;
    }
    : (ResponseCode extends HTTPSuccessCode
      ? {
        status: ResponseCode;
        isjson: NeverFallback<Responses[ResponseCode] extends { "content": infer MediaTypes extends object } ? IsMediaTypeJSON<MediaTypes> : never, boolean>;
        response: GetJSONContent<Responses[ResponseCode]>;
      }
      : never))
  : never;

/** Calculates the response types for a (union of) operation(s)
 * @typeParam Operation - Operation object
 */
export type OperationResponseTypes<Operation extends object> = ResponseTypesFromResponses<GetOperationResponses<Operation>>;

/** Calculates the body types for a (union of) operation(s)
 * @typeParam Operation - Operation object
 */
export type GetBodyType<Operation extends object> = Operation extends { "requestBody": { "content": { "application/json": infer B } } }
  ? B
  : (Operation extends { "requestBody"?: { "content": { "application/json": infer B } } }
    ? B | undefined
    : unknown | undefined);

/** Calculates the parameter types for a (union of) operation(s).
 * @typeParam Operation - Operation object
 */
export type GetParametersType<Operation extends object> = SquashObjectType<Operation extends object ?
  (Operation extends { parameters: object } ? MergeParameters<Operation["parameters"]> : object) :
  never>;

/** Extracts the defaulterror type from the components, if it properly extends RestDefaultErrorBody
 * @typeParam Components - Components from generated openapi ts file
 */
export type DefaultErrorType<Paths extends object, Components extends object> =
  Components extends { schemas: { defaulterror: infer E extends object } } ? E :
  Components extends { schemas: { defaultError: infer E extends object } } ? E :
  AllErrorResponses<Paths>;

/** Type override for a RestRequest that gives proper types to all the data and nethods of RestRequest.
 * @typeParam Auth - Format of authorization data
 * @typeParam Paths - Paths from generated openapi ts file
 * @typeParam Components - Components from generated openapi ts file
 * @typeParam OperationId - Operation id, eg. "/path" (for all operations of a path) or "get /path"
 */
export type OpenApiTypedRestRequest<Auth, Paths extends object, Components extends object, OperationId extends OperationIds<Paths>> = RestRequest<Auth, GetParametersType<GetOperation<Paths, OperationId> & { _path: object }>, GetBodyType<GetOperation<Paths, OperationId>>, OperationResponseTypes<GetOperation<Paths, OperationId>>, DefaultErrorType<Paths, Components>>;

/** Type override for a RestRequest that is used for authorization functions
 * @typeParam Paths - Paths from generated openapi ts file
 * @typeParam Components - Components from generated openapi ts file
 */
export type OpenApiTypedRestAuthorizationRequest<Paths extends object, Components extends object> = RestRequest<never, object, unknown, OperationResponseTypes<GetOperation<Paths, keyof Paths & string>>, DefaultErrorType<Paths, Components>>;
