/* See https://code.webhare.com/publisher/utilities/linkhandler/
*/

interface LinkOpenOptions {
  internalhosts?: string[];
  extensions?: string[];
}

const linkopenoptions: LinkOpenOptions = {};

function onLinkClick(event: MouseEvent) {
  const link = (event.target as HTMLElement)?.closest?.('a');
  if (!link || link.download)
    return;

  if (!['http', 'https'].includes(link.href.split(':')[0]))
    return; //not a browser protocol, skip

  if (link.target) //never overwrite an explicit target
    return;

  const destdomain = (new URL(link.href)).host.toLowerCase();
  if (!linkopenoptions?.internalhosts?.includes(destdomain)) {
    link.target = "_blank";
    return;
  }

  if (linkopenoptions.extensions) {
    const ext = link.href.split('?')[0].split('#')[0].split('.').at(-1);
    if (ext && linkopenoptions.extensions.find(match => match.toUpperCase() === ext.toUpperCase())) {
      link.target = "_blank";
      return;
    }
  }
}

let isattached = false;

export function openLinksInNewWindow(options?: LinkOpenOptions) {
  if (!isattached) {
    isattached = true;
    //IE11 fails sometimes (mostly, when navigating to the page but never when using F5, the back/forward page cache must be involved) to actually attach this element
    window.addEventListener("click", onLinkClick);
  }
  Object.assign(linkopenoptions, options);

  if (!linkopenoptions.internalhosts) {
    const ourdomain = (new URL(location.href)).host.toLowerCase();
    if (ourdomain.substr(0, 4) === 'www.')
      linkopenoptions.internalhosts = [ourdomain, ourdomain.substr(4)];
    else
      linkopenoptions.internalhosts = [ourdomain, 'www.' + ourdomain];
  }
}
