import type { LinkWireMessage } from "./comm/linkendpoint";

export type EnableOnRule = {
  source: string;
  requirevisible: boolean;
  requirefocus: boolean;
  frameflags: string[];
  checkflags: string[];
  min: number;
  max: number;
  selectionmatch: SelectionMatch;
  customaction?: string;
};

export type FlagSet = Array<Record<string, boolean>>;

export type SelectionMatch = "any" | "all";

export type DropLocation = "ontarget" | "insertbefore" | "appendchild";

export type TolliumMessage = {
  instr: string; //"component"
  type: string;
  target: string;
  data: unknown;
};

export type AcceptType = {
  type: string;
  imageaction: string;
  imgsize: Record<string, number>;
  requiretarget: boolean;
  dropeffects: string;
  sourceflags: string[];
  targetflags: string[];
  frameflags: string[];
  insertbeforeflags: string[];
  appendchildflags: string[];
  allowontarget: boolean;
  allowposition: boolean;
  noloops: boolean;
  acceptmultiple: boolean;
};

export type TolliumCondition = {
  field: string;
  //TODO optional non default matchtype
  value: boolean; //TODO | string | integer | ... ?
};

export interface TolliumToddService {
  //mod::tollium/lib/todd/internal/service.whlib
  runToddComm(req: {
    links: LinkWireMessage[];
    frontendids: string[];
    unloading: boolean;
  }): Promise<{
    links: LinkWireMessage[];
  }>;

  retrieveImages(images: Array<{
    data: {
      imgnames: string[];
    };
  }>, nocache: boolean): Promise<{
    images: unknown[];
  }>;
}
