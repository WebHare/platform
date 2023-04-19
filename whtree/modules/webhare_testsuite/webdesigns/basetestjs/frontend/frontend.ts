import * as dompack from 'dompack';
import 'dompack/browserfix/reset.css';
import "@mod-publisher/js/analytics/gtm"; //TODO need a @webhare/frontend .. ?

import * as whintegration from '@mod-system/js/wh/integration';
import '@mod-system/js/wh/errorreporting'; //log JS errors to notice log

import './forms/forms';
import './rtd/rtd';
import './frontend.scss';

import '../widgets/video';

/* Commonly used:

// open external links in new window - see https://code.webhare.com/publisher/utilities/linkhandler/
import { openLinksInNewWindow } from '@mod-publisher/js/linkhandler';
openLinksInNewWindow();

*/
