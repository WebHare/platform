import YAML, { LineCounter, type YAMLParseError } from "yaml";
import type { ResourcePosition, ValidationMessageWithType } from "./validation";

///Simply decode YAML data, throw on failure.
export function decodeYAML<T>(text: string): T {
  const result = YAML.parse(text, { strict: true, version: "1.2" });
  return result;
}

/** Convert /apply/0 path to ['apply','0'] */
function pointerToYamlPath(ptr: string): string[] {
  //doesn't YAML have an API to do this?
  return ptr.substring(1).split('/');
}

export class TrackedYAML<T> {
  doc: T;
  errors: YAML.YAMLError[];
  private lineCounter = new LineCounter;
  private srcTokens = new WeakMap<object, YAML.CST.Token>;
  private sourcedoc: YAML.Document.Parsed;

  constructor(text: string) {
    this.sourcedoc = YAML.parseDocument(text, { strict: true, version: "1.2", prettyErrors: false, lineCounter: this.lineCounter, keepSourceTokens: true });
    this.errors = this.sourcedoc.errors;
    this.doc = this.toJS(this.sourcedoc.contents) as T;
  }

  anyErrors() {
    return this.errors.length > 0;
  }

  getMessages(resourceName: string): ValidationMessageWithType[] {
    return this.errors.map((e: YAMLParseError): ValidationMessageWithType => {
      const pos = e.pos?.length === 2 ? this.lineCounter.linePos(e.pos[0]) : null;
      return {
        type: "error",
        resourcename: resourceName,
        line: pos?.line || 0,
        col: pos?.col || 0,
        ...e.pos?.length ? { length: e.pos[1] - e.pos[0] } : null,
        message: e.message,
        source: "validation"
      };
    });
  }

  getPositionForPointer(pointer: string): ResourcePosition | null {
    //keepScalar: without it getIn returns plain values for scalars (which have no range), only maps/seqs come back as nodes
    const pointsto = this.sourcedoc.getIn(pointerToYamlPath(pointer), true) as { range?: [number] } | undefined;
    return pointsto?.range?.[0] !== undefined ? this.lineCounter.linePos(pointsto.range[0]) : null;
  }

  // Parse the document to JS but record offsets of all objects/arrays
  private toJS(node: unknown): unknown {
    if (node instanceof YAML.Scalar)
      return node.value;

    if (node instanceof YAML.YAMLSeq) {
      const outarray = node.items.map(item => this.toJS(item)).filter(it => it !== undefined);
      if (node.srcToken)
        this.srcTokens.set(outarray, node.srcToken);
      return outarray;
    }
    if (node instanceof YAML.YAMLMap) {
      const outobj = Object.fromEntries(node.items.
        map(item => [item.key, this.toJS(item.value)]). //convert the YAML obj to [key, jsvalue]
        filter(([key, value]) => value !== undefined)); //filter out funny stuff
      if (node.srcToken)
        this.srcTokens.set(outobj, node.srcToken);
      return outobj;
    }
    return undefined;
  }

  getPosition(node: unknown): ResourcePosition | null {
    const tok = this.srcTokens.get(node as object);
    if (!tok)
      return null;

    return { ...this.lineCounter.linePos(tok.offset) };
  }
}
