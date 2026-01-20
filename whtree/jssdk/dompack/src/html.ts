import { createElement } from "dompack/src/create";


// Remove 'on' and other unneeded attributes: we want to define onXxxx attributes which will use addEventListener instead of direct binding to the 'on' property
// Capitalize<string> removes the ATTRIBUTE_NODE etc properties
type CleanupAttributes<T> = {
  [K in keyof T as K extends `on${string}` | "childNodes" | "style" | Capitalize<string>
  ? never
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  : T[K] extends Function
  ? never
  : K]?: T[K];
};

type EventHandlersFor<E extends keyof HTMLElementTagNameMap> = {
  on?: { [K in keyof HTMLElementEventMap]?: (this: HTMLElementTagNameMap[E], ev: HTMLElementEventMap[K]) => void; };
};

type CreateAttributesFor<K extends keyof HTMLElementTagNameMap> = CleanupAttributes<HTMLElementTagNameMap[K]> & EventHandlersFor<K> & {
  style?: Partial<CSSStyleDeclaration> & object;
};

export function html<K extends keyof HTMLElementTagNameMap>(elementname: K, attributes?: CreateAttributesFor<K>, children?: Array<Node | string>): HTMLElementTagNameMap[K] {
  //TODO consider making second parameteer optional?
  const el = createElement(elementname, attributes, false);
  if (children?.length)
    el.append(...children);
  return el as HTMLElementTagNameMap[K];
}
