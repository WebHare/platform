// export * doesn't seem to re-export the default getTid export
export { getTid as default
       , getTid
       , getTidLanguage
       , getHTMLTid
       , convertElementTids
       , registerTexts
       } from "./gettid.ts";
