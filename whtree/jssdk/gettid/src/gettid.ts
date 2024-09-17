// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/gettid" {
}

export {
  getTidLanguage,
  setTidLanguage,
  getTid,
  getTidForLanguage,
  getHTMLTid,
  getHTMLTidForLanguage,
  getTIDListForLanguage
} from "./internal";
