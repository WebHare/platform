import { WebRequest } from './request';
import { WebResponse } from './response';
import { SiteRequest } from './siterequest';

export { WebRequest } from './request';
export { WebResponse } from './response';
export { SiteRequest, WebDesignFunction } from './siterequest';
export { SiteResponse, SiteResponseSettings } from "./sitereponse";

export type WebHareWHFSRouter = (request: SiteRequest) => Promise<WebResponse>;
export type WebHareRouter = (request: WebRequest) => Promise<WebResponse>;
