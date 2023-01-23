import { WebRequest } from './request';
import { WebResponse } from './response';
import { SiteRequest } from './siterequest';

export { WebRequest } from './request';
export { WebResponse } from './response';
export { SiteRequest, WebDesignFunction } from './siterequest';
export { SiteResponse } from "./sitereponse";

export type WebHareWHFSRouter = (request: SiteRequest, response: WebResponse) => Promise<void>;
export type WebHareRouter = (request: WebRequest, response: WebResponse) => Promise<void>;
