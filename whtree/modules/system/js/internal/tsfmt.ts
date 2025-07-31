import { backendConfig } from "@webhare/services";
import { readFileSync } from "node:fs";
import ts from "typescript";

/// Format of our incoming commands
interface FormattingCommand {
  path: string;
  data: string;
}

export type TSFormatResult = {
  path: string;
  output: string;
};

// This code is based on the MIT Licensed https://github.com/vvakame/typescript-formatter originally Copyright © 2015 Masahiro Wakame
class MockedLanguageServiceHost implements ts.LanguageServiceHost {
  files: ts.MapLike<ts.IScriptSnapshot> = {};
  addFile(fileName: string, text: string) {
    this.files[fileName] = ts.ScriptSnapshot.fromString(text);
  }
  options: ts.FormatCodeSettings = {
    ...ts.getDefaultFormatCodeSettings(),
    ...JSON.parse(readFileSync(`${backendConfig.installationRoot}tsfmt.json`, 'utf8'))
  };

  getCompilationSettings = () => ts.getDefaultCompilerOptions();
  getScriptFileNames = () => Object.keys(this.files);
  getScriptVersion = (_fileName: string) => "0";
  getScriptSnapshot = (fileName: string) => this.files[fileName];
  getCurrentDirectory = () => process.cwd();
  getDefaultLibFileName = (options: ts.CompilerOptions) => ts.getDefaultLibFilePath(options);
  readFile = (fileName: string) => this.files[fileName]?.getText(0, this.files[fileName].getLength()) ?? "";
  fileExists = (fileName: string) => fileName in this.files;
}

export class TSFormatter {
  private host = new MockedLanguageServiceHost;
  private languageService = ts.createLanguageService(this.host);

  format(fileName: string, text: string): string | null {
    this.host.addFile(fileName, text);

    const edits = this.languageService.getFormattingEditsForDocument(fileName, this.host.options);
    if (!edits.length) //no changes
      return null;

    edits
      .sort((a, b) => a.span.start - b.span.start)
      .reverse()
      .forEach(edit => {
        const head = text.slice(0, edit.span.start);
        const tail = text.slice(edit.span.start + edit.span.length);
        text = `${head}${edit.newText}${tail}`;
      });

    return text;
  }
}

export function handleFormattingCommand(indata: FormattingCommand): TSFormatResult {
  const formatter = new TSFormatter;
  const result = formatter.format(indata.path, indata.data);

  return {
    path: indata.path,
    output: result || indata.data //if no changes, return the original data
  };
}
