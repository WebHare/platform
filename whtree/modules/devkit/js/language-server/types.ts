import type { TextDocument } from "vscode-languageserver-textdocument";
import type { Diagnostic } from "vscode-languageserver";

export type DocumentsLike = {
  get(uri: string): TextDocumentLike | undefined;
};

export type TextDocumentLike = Pick<TextDocument, "getText" | "languageId" | "uri">;

export type DiagnosticsCallback = (uri: string, diagnostics: Diagnostic[]) => void;
