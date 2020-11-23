import './css/webinterface.scss';
import 'typeface-roboto';
import 'typeface-roboto-mono';
import './pages/harescripterror';

import 'font-awesome/css/font-awesome.css';
import '@mod-wrd/js/auth';
import * as whintegration from '@mod-system/js/wh/integration';

import IndyShell from '@mod-tollium/web/ui/js/shell';


if(document.documentElement.classList.contains('wh-tollium--app'))
{
  if(!document.all && ("max" in document.createElement("progress")) && !document.documentElement.classList.contains("previewframe")) //IE < 11
  {
    window.$shell = new IndyShell;
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
else if (window.parent && document.documentElement.classList.contains("wh-tollium--manual"))
{
  document.documentElement.addEventListener("click", event =>
  {
    // Open external links in new window
    if (event.target.nodeName == "A" && !event.target.href.startsWith(whintegration.config.siteroot))
      window.open(event.target.href);
  });
}
