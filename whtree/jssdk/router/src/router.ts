import { WebRequest } from './request';
export { WebRequest } from './request';
import { WebResponse } from './response';
export { WebResponse } from './response';
import { SiteRequest } from './siterequest';
export { SiteRequest } from './siterequest';
export { SiteResponse } from "./sitereponse";

export type WebHareWHFSRouter = (request: SiteRequest, response: WebResponse) => Promise<void>;
export type WebHareRouter = (request: WebRequest, response: WebResponse) => Promise<void>;
