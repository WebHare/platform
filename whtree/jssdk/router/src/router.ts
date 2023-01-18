import { WebRequest } from './request';
export { WebRequest } from './request';
import { WebResponse } from './response';
export { WebResponse } from './response';
import { WHFSRequest } from './whfsrequest';
export { WHFSRequest } from './whfsrequest';

export type WebHareWHFSRouter = (request: WHFSRequest, response: WebResponse) => Promise<void>;
export type WebHareRouter = (request: WebRequest, response: WebResponse) => Promise<void>;
