import * as dompack from 'dompack';

type CSSRef =
  {
    type: "style" | "link";
    src: string;
  };

interface TrackedCSSRefs extends CSSRef {
  rtes: CSSRefRequester[];
  node: HTMLLinkElement | HTMLStyleElement;
  promise: Promise<void> | null;
}

const addedcss: TrackedCSSRefs[] = [];

export interface CSSRefRequester {
  addcss: CSSRef[];
}

function promiseNewLinkNode(element: HTMLLinkElement) {
  return new Promise<void>((resolve, reject) => {
    element.onload = () => resolve();
    element.onerror = reject;
  });
}

function findCSSRule(addcss: CSSRef) {
  for (let i = 0; i < addedcss.length; ++i)
    if (addedcss[i].type === addcss.type && addedcss[i].src === addcss.src)
      return { idx: i, rule: addedcss[i] };

  return null;
}

/// Register this in the list of active RTE's
export function register(rte: CSSRefRequester) {
  if (dompack.debugflags.rte)
    console.log('[wh.rich] Register new rte');

  const rules = [];

  //Add any missing stylesheets
  for (let i = 0; i < rte.addcss.length; ++i) {
    const rulepos = findCSSRule(rte.addcss[i]);
    if (rulepos) {
      rulepos.rule.rtes.push(rte);
      rules.push(rulepos.rule);
    } else {
      let node, promise = null;
      if (rte.addcss[i].type === 'link') {
        node = dompack.create("link", {
          href: rte.addcss[i].src,
          rel: "stylesheet",
          dataset: { whRtdTempstyle: "" }
        }) as HTMLLinkElement;
        promise = promiseNewLinkNode(node);
        promise.catch(() => null); // ignore rejections that aren't handled
        document.body.appendChild(node);
      } else {
        node = dompack.create("style", {
          type: "text/css",
          dataset: { whRtdTempstyle: "" }
        }) as HTMLStyleElement;
        document.body.appendChild(node);
        node.innerHTML = rte.addcss[i].src;
      }

      const rule = {
        type: rte.addcss[i].type,
        src: rte.addcss[i].src,
        node: node,
        rtes: [rte],
        promise
      };
      addedcss.push(rule);
      rules.push(rule);
    }
  }
  return rules;
}

/// Unregister this
export function unregister(rte: CSSRefRequester) {
  if (dompack.debugflags.rte)
    console.log('[wh.rich] Unregister new rte');

  for (let i = rte.addcss.length - 1; i >= 0; --i) {
    const rulepos = findCSSRule(rte.addcss[i]);
    if (rulepos) {
      rulepos.rule.rtes = rulepos.rule.rtes.filter(el => el !== rte); //erase us from the list
      if (!rulepos.rule.rtes.length) {
        rulepos.rule.node.remove();
        addedcss.splice(rulepos.idx, 1);
      }
    }
  }
}

class PreloadedCSS implements CSSRefRequester {
  addcss: CSSRef[];
  loadpromise: Promise<boolean>;
  constructor(links: string[]) {
    this.addcss = links.map(href => ({ type: "link", src: href }));

    const rules = register(this);
    // Wait for all rule promises, return false if any gave back an error
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- we know rule.promise to be set because of type:"link"
    this.loadpromise = Promise.all(rules.map(rule => rule.promise!.then(() => true, () => false))).then(arr => arr.every(_ => _));
  }

  clone() {
    return new PreloadedCSS(this.addcss.map(e => e.src));
  }
}

export function preloadCSS(links: string[]) {
  return new PreloadedCSS(links);
}

export type { PreloadedCSS };
