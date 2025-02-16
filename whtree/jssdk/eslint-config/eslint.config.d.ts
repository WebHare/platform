declare module "@webhare/eslint-config" {
  import type { Linter } from "eslint";
  export const strictConfig: Linter.Config[];
  export const relaxedConfig: Linter.Config[];
  export interface ConfigOptions {
    tsconfigRootDir?: string;
    project?: boolean | string;
  }
  export function buildBaseConfig(options?: ConfigOptions): Linter.Config[];
  export function buildStrictConfig(options?: ConfigOptions): Linter.Config[];
  export function buildRelaxedConfig(options?: ConfigOptions): Linter.Config[];
}
