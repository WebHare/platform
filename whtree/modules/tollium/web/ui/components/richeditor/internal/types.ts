export interface RTEStructure {
  blockstyles: object[];
}

export interface RTESettings {
  structure?: RTEStructure;
  csslinks?: string[];
  editembeddedobjects?: boolean;
}

export interface RTEWidget {
  embedtype: "inline" | "block";
  htmltext: string;
  canedit: boolean;
  wide: boolean;
  instanceref: string;
  typetext: string;
}
