/* NOTE:
   - this library is involuntarily imported into .dev packages */

import { scanCommonErrors } from './validator';
import { scanPrefillableForms } from './formprefiller';

import * as dompack from 'dompack';

function initDevHelper()
{
  scanPrefillableForms();
  scanCommonErrors();
}

//run on timeout, other onreadys must have a chance to run
dompack.onDomReady(() => setTimeout(initDevHelper,1));
