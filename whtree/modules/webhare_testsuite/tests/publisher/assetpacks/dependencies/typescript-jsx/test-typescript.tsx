import * as ts2 from './test-typescript-2';
import * as ts3 from './folder/';

const node = ts2.hello();
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const len: number = ts3.helloLength(node);
