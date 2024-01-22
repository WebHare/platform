import { WebRequest } from './request';
import { WebResponse } from './response';
import { SiteRequest } from './siterequest';

export { HTTPMethod } from './request';
export type { WebRequest } from './request';
export {
  createWebResponse, createJSONResponse, HTTPErrorCode, HTTPSuccessCode
} from './response';
export type { WebResponse, HTTPStatusCode } from './response';
export type { SiteRequest, WebDesignFunction } from './siterequest';
export {
  RestRequest
} from './restrequest';
export type { DefaultRestParams, RestSuccessfulAuthorization, RestFailedAuthorization, RestAuthorizationResult, RestImplementationFunction, RestAuthorizationFunction, RestResponseType, RestDefaultErrorBody } from './restrequest';
export { SiteResponse, SiteResponseSettings, getAssetpackIntegrationCode } from "./sitereponse";

export type WebHareWHFSRouter = (request: SiteRequest) => Promise<WebResponse>;
export type WebHareRouter = (request: WebRequest) => Promise<WebResponse>;
