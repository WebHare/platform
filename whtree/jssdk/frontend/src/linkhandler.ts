/** Link handler options */
export interface LinkOpenOptions {
  /** List of internal hosts (do not open in a new window) */
  internalhosts?: string[];
  /** List of extensions to open in a new window, even if they are internal */
  extensions?: string[];
}

let linkopenoptions: LinkOpenOptions | undefined;
let isattached: true | undefined;

function onLinkClick(event: MouseEvent) {
  const link = (event.target as HTMLElement)?.closest?.('a');
  if (!link || link.download)
    return;

  const url = new URL(link.href);
  if (!['http:', 'https:'].includes(url.protocol))
    return; //not a browser protocol, skip

  if (link.target) //never overwrite an explicit target
    return;

  const destdomain = url.host.toLowerCase();
  if (!linkopenoptions?.internalhosts?.includes(destdomain)) {
    link.target = "_blank";
    return;
  }

  if (linkopenoptions.extensions) {
    const ext = url.pathname.split('.').at(-1);
    if (ext && linkopenoptions.extensions.find(match => match.toUpperCase() === ext.toUpperCase())) {
      link.target = "_blank";
      return;
    }
  }
}


/** Open external links in a new window */
export function setupLinksInNewWindow(options?: LinkOpenOptions) {
  if (!isattached) {
    isattached = true;
    window.addEventListener("click", onLinkClick);
  }
  linkopenoptions = { ...linkopenoptions, ...options };

  if (!linkopenoptions.internalhosts) {
    const ourdomain = (new URL(location.href)).host.toLowerCase();
    if (ourdomain.startsWith('www.'))
      linkopenoptions.internalhosts = [ourdomain, ourdomain.substring(4)];
    else
      linkopenoptions.internalhosts = [ourdomain, 'www.' + ourdomain];
  }
}
