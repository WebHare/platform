import { WebRequest } from './request';
import { WebResponse } from './response';
import { SiteRequest } from './siterequest';

export { WebRequest, HTTPMethod } from './request';
export { WebResponse, createJSONResponse, HTTPErrorCode, HTTPStatusCode, HTTPSuccessCode } from './response';
export { SiteRequest, WebDesignFunction } from './siterequest';
export { RestRequest, RestParams } from './restrequest';
export { SiteResponse, SiteResponseSettings } from "./sitereponse";

export type WebHareWHFSRouter = (request: SiteRequest) => Promise<WebResponse>;
export type WebHareRouter = (request: WebRequest) => Promise<WebResponse>;
