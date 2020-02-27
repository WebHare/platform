import './css/webinterface.scss';
import 'typeface-roboto';
import 'typeface-roboto-mono';
import './pages/harescripterror';

import * as dompack from "dompack";
import * as feedback from "./js/feedback";

require('font-awesome/css/font-awesome.css');
require('@mod-wrd/js/auth');

const IndyShell = require('@mod-tollium/web/ui/js/shell');


if(document.documentElement.classList.contains('wh-tollium--app'))
{
  if(!document.all && ("max" in document.createElement("progress")) && !document.documentElement.classList.contains("previewframe")) //IE < 11
  {
    window.$shell = new IndyShell;
    dompack.register("body", node => feedback.init(node));
  }
}
else if(window.parent && document.documentElement.classList.contains("previewframe")) //plain preview interface
{
  if(window.parent.suggestRenderingPDF)
  {
    let whpdfnode = document.querySelector('wh-pdf');
    if(whpdfnode)
      window.parent.suggestRenderingPDF(whpdfnode.getAttribute("url"));
  }
}
