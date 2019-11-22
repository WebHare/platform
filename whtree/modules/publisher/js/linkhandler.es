/* See https://code.webhare.com/publisher/utilities/linkhandler/
*/

import { closest } from 'dompack';
import { URL } from 'dompack/browserfix/url';

let linkopenoptions = null;

function onLinkClick(event)
{
  let link = closest(event.target,'a');
  if(!link || link.download)
    return;

  if(!['http','https'].includes(link.href.split(':')[0]))
    return; //not a browser protocol, skip

  if(link.target) //never overwrite an explicit target
    return;

  var destdomain = (new URL(link.href)).host.toLowerCase();
  if(!linkopenoptions.internalhosts.includes(destdomain))
  {
    link.target = "_blank";
    return;
  }

  if(linkopenoptions.extensions)
  {
    var ext = link.href.split('?')[0].split('#')[0].split('.').slice(-1)[0];
    if(ext && linkopenoptions.extensions.find(match => match.toUpperCase() == ext.toUpperCase()))
    {
      link.target = "_blank";
      return;
    }
  }
}

export function openLinksInNewWindow(options)
{
  if(!openLinksInNewWindow.attached)
  {
    openLinksInNewWindow.attached=true;
    //IE11 fails sometimes (mostly, when navigating to the page but never when using F5, the back/forward page cache must be involved) to actually attach this element
    window.addEventListener("click", onLinkClick);
  }
  linkopenoptions = {...options};

  if(!linkopenoptions.internalhosts)
  {
    var ourdomain = (new URL(location.href)).host.toLowerCase();
    if(ourdomain.substr(0,4) == 'www.')
      linkopenoptions.internalhosts = [ ourdomain, ourdomain.substr(4) ];
    else
      linkopenoptions.internalhosts = [ ourdomain, 'www.' + ourdomain ];
  }
}
