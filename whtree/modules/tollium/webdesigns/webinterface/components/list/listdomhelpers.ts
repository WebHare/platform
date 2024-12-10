export function translatePageCoordinatesToElement(event: MouseEvent, element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

let scrollbarwidth: number | null = null;
export function getScrollbarWidth() {
  if (scrollbarwidth === null) { //not calculated yet
    const inner = document.createElement('p');
    inner.style.width = "100%";
    inner.style.height = "200px";

    const outer = document.createElement('div');
    outer.style.position = "absolute";
    outer.style.top = "0px";
    outer.style.left = "0px";
    outer.style.visibility = "hidden";
    outer.style.width = "200px";
    outer.style.height = "150px";
    outer.style.overflow = "hidden";
    outer.appendChild(inner);

    document.body.appendChild(outer);

    const w1 = inner.offsetWidth;
    outer.style.overflow = 'scroll';
    let w2 = inner.offsetWidth;
    if (w1 === w2)
      w2 = outer.clientWidth;

    document.body.removeChild(outer);

    //return (w1 - w2);
    // if the scrollbar takes no space it means the system/browser
    // shows the scrollbar as overlay (probably appearing upon mouseover and on scroll actions).
    // In this case we *don't* want to style the scrollbar, as this forces the browser to disable the scrollbar overlay mode.
    if (w1 - w2 > 0)
      document.documentElement.classList.add("stylescrollbars");

    scrollbarwidth = w1 - w2;
  }
  return scrollbarwidth;
}
