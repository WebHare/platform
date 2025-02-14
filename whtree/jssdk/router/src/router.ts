// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/router" {
}

import { WebRequest } from './request';
import { WebResponse } from './response';
import { SiteRequest } from './siterequest';

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
export { getAssetPackIntegrationCode } from "./concepts";
export { SiteResponse, SiteResponseSettings } from "./sitereponse";

export type WebHareWHFSRouter = (request: SiteRequest) => Promise<WebResponse>;
export type WebHareRouter = (request: WebRequest) => Promise<WebResponse>;
