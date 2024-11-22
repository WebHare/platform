declare module "@webhare/eslint-config" {
  import { Linter } from "eslint";
  const config: Linter.Config;
  export default config;
  export const webHareConfig: Linter.Config;
  export const moduleConfig: Linter.Config;
}
