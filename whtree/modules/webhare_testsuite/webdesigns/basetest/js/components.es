import * as dompack from 'dompack';

import '../css/basetest.scss';
import Pulldown from 'dompack/components/pulldown';

if(location.href.includes("dompackpulldown=1"))
  dompack.register('select', node => new Pulldown(node, 'mypulldown'));
