import * as ts2 from './test-typescript-2';
import * as ts3 from './folder/';
import * as ts4 from '@mod-webhare_testsuite/tests/publisher/assetpacks/dependencies/typescript/folder/';
import * as env from '@webhare/env';
import * as std from '@webhare/std';

ts2.hello();
ts3.helloIndex();
ts4.helloIndex();
console.log(env.debugFlags);
std.sleep(1).then(() => console.log('done'));

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const test = 42;
