import { getWHType } from "@webhare/std/quacks";
import { openFileOrFolder } from "@webhare/whfs";

export function isIntExtLink(value: unknown): value is IntExtLink {
  return Boolean(value && getWHType(value) === "IntExtLink");
}

export type ExportedIntExtLink = { internalLink: string; append?: string } | { externalLink: string };

export class IntExtLink {
  private _internal: number | null = null;
  private _external: string | null = null;
  private _append: string | null = null;

  private static "__ $whTypeSymbol" = "IntExtLink";

  get internalLink() {
    return this._internal;
  }

  get externalLink() {
    return this._external;
  }

  get append() {
    return this._append;
  }

  constructor(target: number | string, options?: { append?: string }) {
    if (typeof target === "number") {
      this._internal = target;
      this._append = options?.append ?? null;
    } else if (typeof target === "string")
      this._external = target;
    if (!this._internal && !this._external)
      throw new Error("Cannot instantiate IntExtLink without a target");
  }

  async resolve() {
    if (this._internal) {
      const target = await openFileOrFolder(this._internal);
      if (target?.link)
        return target.link + (this._append ? this._append : "");
    } else if (this._external) {
      return this._external + (this._append ? this._append : "");
    }
    return null;
  }
}
