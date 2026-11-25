/* Renders the WRD types of a schema as a UML class diagram inside a Tollium <iframe> (see TypesDiagram in
   mod::wrd/lib/screens/types.whlib)

   The layout is done by ELK's layered algorithm (elkjs). Relations point 'down': from a type to the domain it refers to,
   from a link/attachment to the types it links and from a parent type to its child types. Relations of attributes start
   at a port at the attribute's row, on the side of the box facing the referred type.
*/
import "@webhare/tollium-iframe-api/styling/tollium.css";
import { createTolliumImage, getTheme, Host, setupGuest, type HostContext } from "@webhare/tollium-iframe-api";
import { getTid } from "@webhare/gettid";
import ELK, { type ElkExtendedEdge, type ElkNode, type ElkPoint } from "elkjs/lib/elk.bundled.js";
import "./typesdiagram.css";
import "./typesdiagram.lang.json";

// The data as sent by HareScript (so with lowercase cell names)
type MetaType = "object" | "link" | "attachment" | "domain";

interface DiagramAttr {
  tag: string;
  type: "domain" | "domainarray" | "array";
  domain: number;
  isrequired: boolean;
  children: DiagramAttr[];
}

interface DiagramType {
  id: number;
  tag: string;
  title: string;
  metatype: MetaType | "";
  parenttype: number;
  linkfrom: number;
  linkto: number;
  attrs: DiagramAttr[];
}

interface InitData {
  types: DiagramType[];
  selected: number;
}

interface TypesDiagramHostProtocol {
  select: { id: number };
}

type Point = { x: number; y: number };
type PortSide = "EAST" | "WEST";

interface AttrRow {
  text: string;
  indent: number;
  attr: DiagramAttr;
}

interface Box {
  type: DiagramType;
  rows: AttrRow[];
  width: number;
  height: number;
  /// Left
  x: number;
  /// Top
  y: number;
}

interface Relation {
  /// The box the relation starts at (the type with the attribute, the link/attachment or the child type)
  from: Box;
  /// The box the relation points at
  to: Box;
  kind: "assoc" | "link" | "inherit";
  /// For "assoc" relations: the row of the attribute in the 'from' box
  row: number;
  /// Text to show at the 'to' end (multiplicity or role)
  label: string;
  /// For "assoc" relations: the side of the 'from' box the relation leaves at
  portSide: PortSide;
  /// The route as calculated by the layout
  points: Point[];
  /// Position of the label (top left)
  labelPos: Point | null;
}

const svgNS = "http://www.w3.org/2000/svg";
const boxPadding = 8;
const boxMinWidth = 120;
const indentWidth = 14;
const diagramMargin = 24;
const cornerRadius = 6;
const minZoom = 0.1;
const maxZoom = 3;

const host = new Host<TypesDiagramHostProtocol>();
const elk = new ELK();

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, text?: string): SVGElementTagNameMap[K] {
  const node = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attrs))
    node.setAttribute(key, String(value));
  if (text !== undefined)
    node.textContent = text;
  return node;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/** Build an SVG path through the points of an orthogonal route, with rounded corners */
function buildRoundedPath(points: Point[]) {
  let path = `M${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length - 1; ++i) {
    const prev = points[i - 1], corner = points[i], next = points[i + 1];
    const lenIn = Math.hypot(corner.x - prev.x, corner.y - prev.y), lenOut = Math.hypot(next.x - corner.x, next.y - corner.y);
    const radius = Math.min(cornerRadius, lenIn / 2, lenOut / 2);
    if (radius < 0.5) {
      path += ` L${corner.x},${corner.y}`;
      continue;
    }
    const before = { x: corner.x - (corner.x - prev.x) / lenIn * radius, y: corner.y - (corner.y - prev.y) / lenIn * radius };
    const after = { x: corner.x + (next.x - corner.x) / lenOut * radius, y: corner.y + (next.y - corner.y) / lenOut * radius };
    path += ` L${before.x},${before.y} Q${corner.x},${corner.y} ${after.x},${after.y}`;
  }
  const last = points[points.length - 1];
  return path + ` L${last.x},${last.y}`;
}

const nodeId = (box: Box) => `t${box.type.id}`;
const portId = (box: Box, row: number) => `t${box.type.id}_r${row}`;

class TypesDiagram {
  container: HTMLDivElement;
  svgRoot: SVGSVGElement;
  measureContext = document.createElement("canvas").getContext("2d")!;
  types: DiagramType[] = [];
  boxes = new Map<number, Box>();
  relations: Relation[] = [];
  width = 0;
  height = 0;
  zoom = 1;
  selected = 0;
  fontSize = 12;
  fontFamily = "sans-serif";
  lineHeight = 20;
  headerHeight = 40;
  /// Whether the zoom was explicitly set by the user (if not, we'll zoom to fit after layout changes)
  userZoomed = false;
  /// Incremented for every layout, so an older (async) layout finishing late doesn't overwrite a newer one
  layoutGeneration = 0;
  pan: { x: number; y: number; scrollLeft: number; scrollTop: number; moved: boolean; pointerId: number } | null = null;

  constructor(parent: HTMLElement) {
    this.container = document.createElement("div");
    this.container.className = "typesdiagram";
    this.svgRoot = svg("svg");
    this.container.append(this.svgRoot);
    parent.append(this.container);

    this.createToolbar(parent);

    this.svgRoot.addEventListener("click", e => this.onClick(e));
    this.container.addEventListener("pointerdown", e => this.onPointerDown(e));
    this.container.addEventListener("pointermove", e => this.onPointerMove(e));
    this.container.addEventListener("pointerup", e => this.onPointerUp(e));
    this.container.addEventListener("pointercancel", e => this.onPointerCancel(e));
    this.container.addEventListener("wheel", e => this.onWheel(e), { passive: false });
    // Capture Enter/space on types before Tollium sees them (Enter would activate the screen's default button)
    window.addEventListener("keydown", e => this.onKeyDown(e), true);
    getTheme().addEventListener("change", () => void this.relayout());
  }

  createToolbar(parent: HTMLElement) {
    const toolbar = document.createElement("div");
    toolbar.className = "typesdiagram__toolbar";
    parent.append(toolbar);
    const buttons: Array<[string, string, () => void]> = [
      ["zoomin", "tollium:maps/zoomin", () => this.zoomBy(1.25)],
      ["zoomout", "tollium:maps/zoomout", () => this.zoomBy(1 / 1.25)],
      ["zoomfit", "tollium:maps/center", () => this.zoomToFit()]
    ];
    for (const [tid, icon, onclick] of buttons) {
      const button = document.createElement("button");
      button.type = "button";
      button.title = getTid("wrd:types.typesdiagram." + tid);
      button.ariaLabel = button.title;
      button.addEventListener("click", () => {
        this.userZoomed = true;
        onclick();
      });
      toolbar.append(button);
      // Load the icons in the background, a failing icon shouldn't take the other buttons with it
      createTolliumImage(icon, 24, 24).then(img => {
        const imgnode = document.createElement("img");
        imgnode.src = img.src;
        imgnode.width = img.width;
        imgnode.height = img.height;
        imgnode.alt = "";
        button.append(imgnode);
      }).catch(e => console.error(`Loading icon ${icon} failed`, e));
    }
  }

  async setTypes(types: DiagramType[]) {
    this.types = types;
    await this.relayout();
  }

  setSelected(typeid: number, { scrollIntoView = false } = {}) {
    if (!this.boxes.has(typeid))
      typeid = 0;
    const changed = typeid !== this.selected;
    this.selected = typeid;
    this.render();
    if (changed && scrollIntoView && typeid)
      this.scrollIntoView(this.boxes.get(typeid)!);
  }

  select(typeid: number) {
    if (typeid === this.selected)
      return;
    this.setSelected(typeid);
    host.post("select", { id: typeid });
  }

  // Layout ------------------------------------------------------------------------------------------------------------

  measure(text: string, { bold = false, fontSize = this.fontSize } = {}) {
    this.measureContext.font = `${bold ? "bold " : ""}${fontSize}px ${this.fontFamily}`;
    return Math.ceil(this.measureContext.measureText(text).width) + 2;
  }

  async relayout() {
    const generation = ++this.layoutGeneration;
    const style = getComputedStyle(document.documentElement);
    this.fontSize = parseFloat(style.getPropertyValue("--tollium-font-size")) || 12;
    this.fontFamily = style.getPropertyValue("--tollium-font-family").trim() || "sans-serif";
    this.lineHeight = Math.round(this.fontSize * 1.7);
    this.headerHeight = this.lineHeight * 2 + 4;

    this.createBoxes();
    this.createRelations();

    // First pass: lay out with all attribute ports on the right, then put each port on the side facing its target and
    // lay out again
    let result = await elk.layout(this.buildGraph());
    if (generation !== this.layoutGeneration)
      return;
    const positions = new Map((result.children ?? []).map(child => [child.id, child]));
    let anyWest = false;
    for (const rel of this.relations)
      if (rel.kind === "assoc" && rel.from !== rel.to) {
        const from = positions.get(nodeId(rel.from)), to = positions.get(nodeId(rel.to));
        if (from && to && (to.x ?? 0) + rel.to.width / 2 < (from.x ?? 0) + rel.from.width / 2) {
          rel.portSide = "WEST";
          anyWest = true;
        }
      }
    if (anyWest) {
      result = await elk.layout(this.buildGraph());
      if (generation !== this.layoutGeneration)
        return;
    }

    this.applyLayout(result);
    if (!this.userZoomed)
      this.zoom = this.getFitZoom();
    this.render();
  }

  createBoxes() {
    const tags = new Map(this.types.map(type => [type.id, type.tag]));
    const getTag = (id: number) => tags.get(id) ?? `#${id}`;

    this.boxes.clear();
    for (const type of this.types) {
      const rows: AttrRow[] = [];
      const addRows = (attrs: DiagramAttr[], indent: number) => {
        for (const attr of attrs) {
          const text = attr.type === "array" ? `${attr.tag}[]`
            : attr.type === "domainarray" ? `${attr.tag}: ${getTag(attr.domain)}[]`
              : `${attr.tag}: ${getTag(attr.domain)}`;
          rows.push({ text, indent, attr });
          if (attr.type === "array")
            addRows(attr.children || [], indent + 1);
        }
      };
      addRows(type.attrs || [], 0);

      const width = Math.ceil(Math.max(boxMinWidth,
        this.measure(type.tag, { bold: true }) + 2 * boxPadding,
        this.measure(`«${type.metatype}»`) + 2 * boxPadding,
        ...rows.map(row => this.measure(row.text) + row.indent * indentWidth + 2 * boxPadding)));
      const height = this.headerHeight + Math.max(rows.length * this.lineHeight, boxPadding) + 4;
      this.boxes.set(type.id, { type, rows, width, height, x: 0, y: 0 });
    }
  }

  createRelations() {
    this.relations = [];
    const add = (rel: Pick<Relation, "from" | "to" | "kind" | "row" | "label">) => this.relations.push({ ...rel, portSide: "EAST", points: [], labelPos: null });
    for (const box of this.boxes.values()) {
      const type = box.type;
      box.rows.forEach((row, idx) => {
        const target = row.attr.type !== "array" ? this.boxes.get(row.attr.domain) : undefined;
        if (target) {
          const many = row.attr.type === "domainarray" || row.indent > 0; //attributes inside arrays can have multiple values too
          add({ from: box, to: target, kind: "assoc", row: idx, label: many ? "*" : row.attr.isrequired ? "1" : "0..1" });
        }
      });
      // wrd_leftentity and wrd_rightentity are shown as relations from box to box
      const left = type.linkfrom ? this.boxes.get(type.linkfrom) : undefined;
      if (left)
        add({ from: box, to: left, kind: "link", row: -1, label: type.metatype === "link" ? "left" : "" }); //attachments only have one end
      const right = type.linkto ? this.boxes.get(type.linkto) : undefined;
      if (right)
        add({ from: box, to: right, kind: "link", row: -1, label: "right" });
      const parent = type.parenttype ? this.boxes.get(type.parenttype) : undefined;
      if (parent && parent !== box)
        add({ from: box, to: parent, kind: "inherit", row: -1, label: "" });
    }
  }

  getRowCenterY(box: Box, row: number) {
    return box.y + this.headerHeight + 2 + row * this.lineHeight + this.lineHeight / 2;
  }

  buildGraph(): ElkNode {
    const labelFontSize = this.fontSize - 1;
    const aspectRatio = this.container.clientWidth && this.container.clientHeight ? this.container.clientWidth / this.container.clientHeight : 1.6;

    const children: ElkNode[] = [...this.boxes.values()].map(box => ({
      id: nodeId(box),
      width: box.width,
      height: box.height,
      layoutOptions: { "elk.portConstraints": "FIXED_POS" },
      ports: this.relations
        .filter(rel => rel.kind === "assoc" && rel.from === box)
        .map(rel => ({
          id: portId(box, rel.row),
          x: rel.portSide === "EAST" ? box.width : 0,
          y: this.getRowCenterY({ ...box, y: 0 }, rel.row),
          width: 0,
          height: 0,
          layoutOptions: { "elk.port.side": rel.portSide }
        }))
    }));

    const edges: ElkExtendedEdge[] = this.relations.map((rel, idx) => ({
      id: `e${idx}`,
      // Inheritance is laid out from parent to child, so parents end up above their children
      sources: [rel.kind === "assoc" ? portId(rel.from, rel.row) : nodeId(rel.kind === "inherit" ? rel.to : rel.from)],
      targets: [nodeId(rel.kind === "inherit" ? rel.from : rel.to)],
      labels: rel.label ? [{
        text: rel.label,
        width: this.measure(rel.label, { fontSize: labelFontSize }),
        height: labelFontSize + 2,
        layoutOptions: { "elk.edgeLabels.placement": "HEAD" }
      }] : []
    }));

    return {
      id: "root",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "DOWN",
        "elk.edgeRouting": "ORTHOGONAL",
        "elk.padding": `[top=${diagramMargin},left=${diagramMargin},bottom=${diagramMargin},right=${diagramMargin}]`,
        "elk.spacing.nodeNode": "32",
        "elk.spacing.edgeNode": "16",
        "elk.spacing.edgeEdge": "8",
        "elk.spacing.edgeLabel": "2",
        "elk.spacing.componentComponent": "32",
        "elk.layered.spacing.nodeNodeBetweenLayers": "48",
        "elk.layered.spacing.edgeNodeBetweenLayers": "16",
        "elk.layered.spacing.edgeEdgeBetweenLayers": "8",
        "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
        "elk.separateConnectedComponents": "true",
        "elk.aspectRatio": String(aspectRatio)
      },
      children,
      edges
    };
  }

  applyLayout(result: ElkNode) {
    for (const child of result.children ?? []) {
      const box = this.boxes.get(parseInt(child.id.substring(1)));
      if (box) {
        box.x = child.x ?? 0;
        box.y = child.y ?? 0;
      }
    }

    const edges = new Map((result.edges ?? []).map(edge => [edge.id, edge as ElkExtendedEdge]));
    this.relations.forEach((rel, idx) => {
      const edge = edges.get(`e${idx}`);
      const section = edge?.sections?.[0];
      rel.points = section ? [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((p: ElkPoint) => ({ x: p.x, y: p.y })) : [];
      const label = edge?.labels?.[0];
      rel.labelPos = label?.x !== undefined && label.y !== undefined ? { x: label.x, y: label.y } : null;
    });

    this.width = Math.ceil(result.width ?? 0);
    this.height = Math.ceil(result.height ?? 0);
  }

  // Rendering ---------------------------------------------------------------------------------------------------------

  createMarkers(defs: SVGDefsElement) {
    for (const highlight of [false, true]) {
      const suffix = highlight ? "-hl" : "";
      const arrow = svg("marker", { id: "arrow" + suffix, viewBox: "0 0 12 12", refX: 11, refY: 6, markerWidth: 12, markerHeight: 12, markerUnits: "userSpaceOnUse", orient: "auto-start-reverse" });
      arrow.append(svg("path", { d: "M1,1 L11,6 L1,11", class: "marker__arrow" + (highlight ? " marker--highlight" : "") }));
      const triangle = svg("marker", { id: "triangle" + suffix, viewBox: "0 0 16 16", refX: 15, refY: 8, markerWidth: 16, markerHeight: 16, markerUnits: "userSpaceOnUse", orient: "auto-start-reverse" });
      triangle.append(svg("path", { d: "M1,1 L15,8 L1,15 Z", class: "marker__triangle" + (highlight ? " marker--highlight" : "") }));
      defs.append(arrow, triangle);
    }
  }

  isHighlighted(rel: Relation) {
    return this.selected !== 0 && (rel.from.type.id === this.selected || rel.to.type.id === this.selected);
  }

  renderRelation(rel: Relation, parent: SVGGElement) {
    if (rel.points.length < 2)
      return;

    const highlight = this.isHighlighted(rel);
    const marker = `url(#${rel.kind === "inherit" ? "triangle" : "arrow"}${highlight ? "-hl" : ""})`;
    parent.append(svg("path", {
      d: buildRoundedPath(rel.points),
      class: `relation relation--${rel.kind}` + (highlight ? " relation--highlight" : ""),
      // Inheritance was laid out from the parent (the 'to' box) to the child, so its marker is at the start
      [rel.kind === "inherit" ? "marker-start" : "marker-end"]: marker
    }));

    if (rel.label && rel.labelPos)
      parent.append(svg("text", {
        class: "relation__label" + (highlight ? " relation__label--highlight" : ""),
        x: rel.labelPos.x,
        y: rel.labelPos.y + (this.fontSize + 1) / 2,
        "dominant-baseline": "central"
      }, rel.label));
  }

  renderBox(box: Box, parent: SVGGElement) {
    const { type, width, height } = box;
    const group = svg("g", {
      class: `type type--${type.metatype || "object"}` + (type.id === this.selected ? " type--selected" : ""),
      transform: `translate(${box.x},${box.y})`,
      tabindex: 0,
      role: "button",
      "data-typeid": type.id
    });
    group.append(svg("title", {}, type.title && type.title !== type.tag ? `${type.title} (${type.tag})` : type.tag));
    group.append(svg("rect", { class: "type__body", width, height }));
    group.append(svg("rect", { class: "type__header", width, height: this.headerHeight }));
    group.append(svg("text", { class: "type__stereotype", x: width / 2, y: 2 + this.lineHeight / 2, "text-anchor": "middle", "dominant-baseline": "central" }, `«${type.metatype}»`));
    group.append(svg("text", { class: "type__name", x: width / 2, y: 2 + this.lineHeight * 1.5, "text-anchor": "middle", "dominant-baseline": "central" }, type.tag));
    group.append(svg("line", { class: "type__divider", x1: 0, x2: width, y1: this.headerHeight, y2: this.headerHeight }));
    box.rows.forEach((row, idx) => {
      group.append(svg("text", {
        class: "type__attr",
        x: boxPadding + row.indent * indentWidth,
        y: this.getRowCenterY(box, idx) - box.y,
        "dominant-baseline": "central"
      }, row.text));
    });
    group.append(svg("rect", { class: "type__border", x: 0.5, y: 0.5, width: width - 1, height: height - 1, rx: 2 }));
    parent.append(group);
  }

  render() {
    const focusedTypeId = (document.activeElement as Element | null)?.closest?.(".type")?.getAttribute("data-typeid");

    this.svgRoot.replaceChildren();
    this.svgRoot.setAttribute("viewBox", `0 0 ${this.width} ${this.height}`);
    this.applyZoom();

    const defs = svg("defs");
    this.createMarkers(defs);
    const relationsGroup = svg("g"), boxesGroup = svg("g");
    this.svgRoot.append(defs, relationsGroup, boxesGroup);

    // Draw highlighted relations last, so they're on top of the others
    for (const rel of [...this.relations.filter(candidate => !this.isHighlighted(candidate)), ...this.relations.filter(candidate => this.isHighlighted(candidate))])
      this.renderRelation(rel, relationsGroup);
    for (const box of this.boxes.values())
      this.renderBox(box, boxesGroup);

    if (focusedTypeId)
      this.svgRoot.querySelector<SVGGElement>(`.type[data-typeid="${focusedTypeId}"]`)?.focus();

    // Let tests know we've rendered
    try {
      window.parent.dispatchEvent(new Event("wrd:typesdiagram-rendered"));
    } catch {
      //ignore, parent might not be accessible
    }
  }

  // Zooming and scrolling ---------------------------------------------------------------------------------------------

  applyZoom() {
    this.svgRoot.setAttribute("width", String(Math.round(this.width * this.zoom)));
    this.svgRoot.setAttribute("height", String(Math.round(this.height * this.zoom)));
  }

  getFitZoom() {
    if (!this.width || !this.height || !this.container.clientWidth || !this.container.clientHeight)
      return 1;
    return clamp(Math.min(this.container.clientWidth / this.width, this.container.clientHeight / this.height, 1), minZoom, 1);
  }

  /** Set the zoom level, keeping the diagram point under the given container point in place */
  setZoom(zoom: number, around?: Point) {
    zoom = clamp(zoom, minZoom, maxZoom);
    const pivot = around ?? { x: this.container.clientWidth / 2, y: this.container.clientHeight / 2 };
    const diagramX = (this.container.scrollLeft + pivot.x) / this.zoom;
    const diagramY = (this.container.scrollTop + pivot.y) / this.zoom;
    this.zoom = zoom;
    this.applyZoom();
    this.container.scrollLeft = diagramX * zoom - pivot.x;
    this.container.scrollTop = diagramY * zoom - pivot.y;
  }

  zoomBy(factor: number, around?: Point) {
    this.setZoom(this.zoom * factor, around);
  }

  zoomToFit() {
    this.setZoom(this.getFitZoom());
    this.container.scrollLeft = 0;
    this.container.scrollTop = 0;
  }

  scrollIntoView(box: Box) {
    const left = box.x * this.zoom, top = box.y * this.zoom;
    const right = (box.x + box.width) * this.zoom, bottom = (box.y + box.height) * this.zoom;
    const { scrollLeft, scrollTop, clientWidth, clientHeight } = this.container;
    if (left < scrollLeft || right > scrollLeft + clientWidth)
      this.container.scrollLeft = (left + right) / 2 - clientWidth / 2;
    if (top < scrollTop || bottom > scrollTop + clientHeight)
      this.container.scrollTop = (top + bottom) / 2 - clientHeight / 2;
  }

  // Event handling ----------------------------------------------------------------------------------------------------

  getTypeIdFromEvent(event: Event) {
    const typenode = (event.target as Element | null)?.closest?.(".type");
    return typenode ? parseInt(typenode.getAttribute("data-typeid") || "0") : 0;
  }

  onClick(event: MouseEvent) {
    const typeid = this.getTypeIdFromEvent(event);
    if (typeid)
      this.select(typeid);
  }

  onKeyDown(event: KeyboardEvent) {
    if (event.key !== "Enter" && event.key !== " ")
      return;
    const typeid = this.getTypeIdFromEvent(event);
    if (typeid) {
      event.preventDefault();
      event.stopPropagation();
      this.select(typeid);
    } else if ((event.target as Element | null)?.closest?.(".typesdiagram__toolbar")) {
      // Let the browser activate the toolbar button, but don't let Tollium activate the screen's default button too
      event.stopPropagation();
    }
  }

  onPointerDown(event: PointerEvent) {
    if (event.button !== 0 || this.getTypeIdFromEvent(event))
      return;
    this.pan = { x: event.clientX, y: event.clientY, scrollLeft: this.container.scrollLeft, scrollTop: this.container.scrollTop, moved: false, pointerId: event.pointerId };
    this.container.setPointerCapture(event.pointerId);
  }

  onPointerMove(event: PointerEvent) {
    if (!this.pan || event.pointerId !== this.pan.pointerId)
      return;
    const dx = event.clientX - this.pan.x, dy = event.clientY - this.pan.y;
    if (!this.pan.moved && Math.hypot(dx, dy) < 4)
      return;
    this.pan.moved = true;
    this.container.classList.add("typesdiagram--panning");
    this.container.scrollLeft = this.pan.scrollLeft - dx;
    this.container.scrollTop = this.pan.scrollTop - dy;
  }

  onPointerUp(event: PointerEvent) {
    if (!this.pan || event.pointerId !== this.pan.pointerId)
      return;
    const wasClick = !this.pan.moved;
    this.endPan();
    if (wasClick) //clicking the background clears the selection
      this.select(0);
  }

  onPointerCancel(event: PointerEvent) {
    if (this.pan && event.pointerId === this.pan.pointerId)
      this.endPan();
  }

  endPan() {
    this.pan = null;
    this.container.classList.remove("typesdiagram--panning");
  }

  onWheel(event: WheelEvent) {
    if (!event.ctrlKey && !event.metaKey) //ctrl+wheel (or a pinch gesture, which is reported with ctrlKey) zooms
      return;
    event.preventDefault();
    const rect = this.container.getBoundingClientRect();
    this.userZoomed = true;
    this.zoomBy(Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.002)), { x: event.clientX - rect.left, y: event.clientY - rect.top });
  }
}

let diagram: TypesDiagram | null = null;
let currentTypes = "";

async function init(_context: HostContext, initdata: InitData) {
  diagram ??= new TypesDiagram(document.body);

  // init is also invoked when only the selection changes (the selection is kept in the initdata), so only relayout when needed
  const types = JSON.stringify(initdata.types);
  if (types !== currentTypes) {
    currentTypes = types;
    await diagram.setTypes(initdata.types || []);
  }
  diagram.setSelected(initdata.selected, { scrollIntoView: true });
}

setupGuest(init, {});
