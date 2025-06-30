export type TidParam = string | number | null | undefined;

export interface Tag {
  t: "tag";
  tag: string;
  subs: string | LanguagePart[]; // These subs are parsed by DecodeLanguageText, which may return a single string
}

export interface Link {
  t: "a";
  link: string;
  linkparam: number;
  target: string;
  subs: string | LanguagePart[]; // These subs are parsed by DecodeLanguageText, which may return a single string
}

export interface IfParam {
  t: "ifparam";
  p: number;
  value: string;
  subs: LanguagePart[]; // These subs are always an array of ParseTextNode results
  subselse: LanguagePart[]; // These subs are always an array of ParseTextNode results
}

// A text, an array of language text parts or an object with tids or gids
export type LanguageText = string | LanguagePart[];
// A text, a param or a tag, link or ifparam node
export type LanguagePart = string | number | Tag | Link | IfParam;

export type CompiledLanguageFile = {
  /** Disk path to language file */
  resource: string;
  langCode: string;
  fallbackLanguage: string;
  registered: Map<string, LanguageText>;
  texts: Map<string, LanguageText>;
};

/** Returns the map passed in the `texts` property */
export type CompiledFileLoader = ((module: string, language: string, texts: Map<string, LanguageText>) => CompiledLanguageFile);

/// Empty or no parameter lang is get, otherwise it's a set
export type GetSetLangaguage = (lang?: string) => string;

export type GetTidHooks = {
  loader: CompiledFileLoader | null;
  currentLanguage: GetSetLangaguage;
};

export type CodeContextTidStorage = {
  language: string;
};

export type RecursiveLanguageTexts = string | LanguagePart[] | { [tid: string]: RecursiveLanguageTexts };
