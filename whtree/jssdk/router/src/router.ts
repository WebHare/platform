// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/router" {
}

import type { WebRequest } from './request';
import type { WebResponse } from './response';
import type { SiteRequest } from './siterequest';

export { HTTPMethod } from './request';
export type { WebRequest } from './request';
export {
  createWebResponse, createJSONResponse, createRedirectResponse, HTTPErrorCode, HTTPSuccessCode
} from './response';
export type { WebResponse, HTTPStatusCode, HTTPRedirectCode } from './response';
export type { SiteRequest, WebDesignFunction } from './siterequest';
export {
  RestRequest
} from './restrequest';
export type { DefaultRestParams, RestSuccessfulAuthorization, RestFailedAuthorization, RestAuthorizationResult, RestImplementationFunction, RestAuthorizationFunction, RestResponseType, RestDefaultErrorBody } from './restrequest';
export { SiteResponse, SiteResponseSettings, getAssetPackIntegrationCode } from "./sitereponse";
export { type WebHareOpenAPIDocument, type OpenAPIServiceInitializationContext } from "./openapi";

export type WebHareWHFSRouter = (request: SiteRequest) => Promise<WebResponse>;
export type WebHareRouter = (request: WebRequest) => Promise<WebResponse>;
