import * as frontend from "@webhare/frontend";

// import * as dompack from 'dompack';
// import "@mod-publisher/js/analytics/gtm"; //TODO need a @webhare/frontend .. ?

// import * as whintegration from '@mod-system/js/wh/integration';
// import '@mod-system/js/wh/errorreporting'; //log JS errors to notice log

import * as dialog from 'dompack/components/dialog';
import * as dialogapi from 'dompack/api/dialog';

import './forms/forms';
import './rtd/rtd';
import './frontend.scss';

import '../widgets/video';
import '../pages/wrdauthtest';
import '../pages/formtest/formtest';

/* Commonly used:

// open external links in new window - see https://code.webhare.com/publisher/utilities/linkhandler/
import { openLinksInNewWindow } from '@mod-publisher/js/linkhandler';
openLinksInNewWindow();

*/
dialogapi.setupDialogs(options => dialog.createDialog('mydialog', options));

console.log("Frontend configuration object", frontend.frontendConfig);
