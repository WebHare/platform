import { WebRequest } from './request';
import { WebResponse } from './response';
import { SiteRequest } from './siterequest';

export { WebRequest, HTTPMethod } from './request';
export {
  WebResponse, createWebResponse, createJSONResponse, HTTPErrorCode, HTTPStatusCode, HTTPSuccessCode
} from './response';
export { SiteRequest, WebDesignFunction } from './siterequest';
export {
  RestRequest, DefaultRestParams, RestSuccessfulAuthorization, RestFailedAuthorization, RestAuthorizationResult, RestImplementationFunction, RestAuthorizationFunction, RestResponseType, RestDefaultErrorBody
} from './restrequest';
export { SiteResponse, SiteResponseSettings, getAssetpackIntegrationCode } from "./sitereponse";

export type WebHareWHFSRouter = (request: SiteRequest) => Promise<WebResponse>;
export type WebHareRouter = (request: WebRequest) => Promise<WebResponse>;
