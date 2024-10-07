// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/witty" {
}

import { encodeString, stringify } from "@webhare/std";
import { getHTMLTid, getTid } from "@mod-tollium/js/gettid";
import * as path from "node:path";

enum DataType {
  First = 1,
  Last,
  Odd,
  Even,
  Seqnr,
  Cell
}

enum ParserStates {
  Text = 1,
  Content,
  Tag,
  TagSQuote,
  TagDQuote,
  RawComponent
}

export enum WittyEncodingStyle {
  Invalid = 0,
  Text,
  HTML,
  XML
}

enum ContentEncoding {
  Invalid = 0,
  None,
  Html,
  Value,
  CData,
  JsonValue,
  Json
}

function GetNonquoteEncoding(encodingstyle: WittyEncodingStyle): ContentEncoding {
  if (encodingstyle === WittyEncodingStyle.HTML)
    return ContentEncoding.Html;
  else if (encodingstyle === WittyEncodingStyle.XML)
    return ContentEncoding.Value;
  else
    return ContentEncoding.None;
}

enum ParsedPartType {
  Content = 1,
  Data,
  Forevery,
  If,
  ElseIf,
  Component,
  Embed,
  GetTid,
  GetHTMLTid
}

class ParsedPart {
  lineNum: number;
  columnNum: number;
  type: ParsedPartType;
  dataType: DataType = DataType.Cell;
  encoding: ContentEncoding = ContentEncoding.Invalid;
  content = "";
  cmdLimit = 0;
  elseLimit = 0;
  contentPos = 0;
  contentLen = 0;
  ifNot = false;
  parameters: string[] = [];

  constructor(lineNum: number, columnNum: number, type: ParsedPartType) {
    this.lineNum = lineNum;
    this.columnNum = columnNum;
    this.type = type;
  }
}

export enum WittyErrorCode {
  UnterminatedInstruction = 1,
  LinefeedWithinInstruction,
  UnknownData,
  UnknownEncoding,
  ReservedWordAsCell,
  ElseOutsideIf,
  DuplicateElse,
  EndIfOutsideIf,
  DuplicateComponent,
  EndComponentOutsideComponent,
  ParameterNotACell,
  EndForeveryOutsideForevery,
  UnterminatedBlock,
  UnterminatedComment,
  NoSuchCell,
  CellNotAnArray,
  ForeveryVarOutsideForevery,
  CannotOutputCell,
  NoSuchComponent,
  EmptyCommand,
  InvalidClosingTag,
  MissingParameter,
  EndRawcomponentOutsideRawcomponent,
  MissingComponentName
}

const WittyMessages = {
  [WittyErrorCode.UnterminatedInstruction]: "Unterminated instruction",
  [WittyErrorCode.LinefeedWithinInstruction]: "Linefeed appears inside instruction",
  [WittyErrorCode.UnknownData]: "Unknown data follows the value: '%0'",
  [WittyErrorCode.UnknownEncoding]: "Unknown encoding '%0' requested",
  [WittyErrorCode.ReservedWordAsCell]: "Reserved word '%0' cannot be used as cell name",
  [WittyErrorCode.ElseOutsideIf]: "An [else] or [elseif] must be inside an [if]-block",
  [WittyErrorCode.DuplicateElse]: "Duplicate [else] in [if]-block",
  [WittyErrorCode.EndIfOutsideIf]: "[/if] must be inside an [if]-block",
  [WittyErrorCode.DuplicateComponent]: "Duplicate component name",
  [WittyErrorCode.EndComponentOutsideComponent]: "[/component] must be inside a [component]-block",
  [WittyErrorCode.ParameterNotACell]: "Parameter passed must be a cell name",
  [WittyErrorCode.EndForeveryOutsideForevery]: "[/forevery] must be inside a [forevery]-block",
  [WittyErrorCode.UnterminatedBlock]: "Unterminated block",
  [WittyErrorCode.UnterminatedComment]: "Unterminated comment",
  [WittyErrorCode.NoSuchCell]: "No such cell '%0'",
  [WittyErrorCode.CellNotAnArray]: "Cell '%0' did not evaluate to an array",
  [WittyErrorCode.ForeveryVarOutsideForevery]: "Requesting '%0' outside a [forevery]-block",
  [WittyErrorCode.CannotOutputCell]: "Don't know how to output cell '%0' of type '%1'",
  [WittyErrorCode.NoSuchComponent]: "No such component '%0'",
  [WittyErrorCode.EmptyCommand]: "Empty command",
  [WittyErrorCode.InvalidClosingTag]: "Invalid closing tag '%0'",
  [WittyErrorCode.MissingParameter]: "Missing required parameter",
  [WittyErrorCode.EndRawcomponentOutsideRawcomponent]: "[/rawcomponent] must be inside a [rawcomponent]-block",
  [WittyErrorCode.MissingComponentName]: "Missing component name in embedcomponent request for '%0'"
};

class WittyErrorRec {
  readonly resource: string;
  readonly line: number;
  readonly column: number;
  readonly text: string;
  readonly code: WittyErrorCode;
  readonly arg?: string;
  readonly arg2?: string;

  constructor(resource: string, lineNum: number, columnNum: number, errorCode: WittyErrorCode, arg?: string, arg2?: string) {
    this.text = WittyMessages[errorCode].replaceAll("%0", () => arg || "").replaceAll("%1", () => arg2 || "");
    this.resource = resource;
    this.line = lineNum;
    this.column = columnNum;
    this.code = errorCode;
    this.arg = arg;
    this.arg2 = arg2;
  }
}

export class WittyError extends Error {
  readonly errors: WittyErrorRec[];

  constructor(msg: string, errors: WittyErrorRec[]) {
    if (errors.length) {
      if (errors[0].line > 0 && errors[0].column > 0)
        msg += ` at ${errors[0].line}:${errors[0].column}`;
      msg += `: ${errors[0].text}`;
    }
    super(msg);
    this.errors = errors;
  }
}

export class WittyParseError extends WittyError {
  constructor(errors: WittyErrorRec[]) {
    super("Witty parse error", errors);
  }
}

export class WittyRunError extends WittyError {
  constructor(error: WittyErrorRec) {
    super("Witty runtime error", [error]);
  }
}

type CallStackElement = {
  depth: number;
  hasVariable: boolean;
  itr: number; // index within parts
  limit: number; // index within parts
  mustReturn: boolean;
  foreveryEltNr: number;
  foreveryEltLimit: number;
};

type VarStackElement = {
  foreveryNonRA?: ParsedPart;
  wittyVar: WittyData;
};

export interface WittyCallContext {
  get: (name: string) => WittyData | WittyData[] | undefined;
  embed: (name: string, wittyData?: WittyData) => Promise<string>;
  encode: (wittyVar?: WittyData | WittyData[]) => Promise<string>;
}

type WittyTemplateLoader = (resource: string) => Promise<string>;

type WittyCallbackFunction =
  (() => string) | (() => Promise<string>) | // function callback without context argument
  ((ctx: WittyCallContext) => string) | ((ctx: WittyCallContext) => Promise<string>); // function callback with context argument

type WittyVar =
  string | number | boolean | // base types
  WittyCallbackFunction |
  null; // null

export type WittyData = WittyVar | WittyVar[] | {
  [key: string]: WittyData | WittyData[];
};

export type WittyOptions = {
  encoding?: WittyEncodingStyle;
  getTidModule?: string;
  loader?: WittyTemplateLoader;
};

export class WittyTemplate {
  private encoding: WittyEncodingStyle;
  private parts: ParsedPart[] = [];
  private stringSource = "";
  private blockstack: ParsedPart[] = [];
  private startPositions: Map<string, number> = new Map();
  private errors: WittyErrorRec[] = [];
  private getTidModule: string;
  private resource: string;
  private loader?: WittyTemplateLoader;
  protected callStack: CallStackElement[] = [];
  protected varStack: VarStackElement[] = [];


  //-------------------------------------------------------------------------------------------------------------------------
  //
  // Public API
  //

  constructor(data: string, options?: WittyOptions & { _resource?: string }) {
    this.encoding = options?.encoding || WittyEncodingStyle.HTML;
    this.loader = options?.loader;
    this.resource = options?._resource || "";

    this.getTidModule = options?.getTidModule || "";
    // If no tid module is explicitly specified, extract it from the resource
    if (!this.getTidModule && this.resource) {
      const namespace = this.resource.indexOf("::") + 2;
      if (["mod::", "storage::"].includes(this.resource.substring(0, namespace).toLowerCase())) {
        const nextslash = this.resource.indexOf('/', namespace);
        this.getTidModule = nextslash <= namespace ? this.resource.substring(namespace) : this.resource.substring(namespace, nextslash);
      }
    }

    this.readWitty(data);
    if (this.errors.length)
      throw new WittyParseError(this.errors);
  }

  async run(wittyData?: WittyData): Promise<string> {
    if (this.errors.length)
      throw new Error("Cannot run, there were parse errors!");
    this.callStack = [];
    this.varStack = [];

    return await this.runComponentInternal(true, "", wittyData);
  }

  async runComponent(name: string, wittyData?: WittyData): Promise<string> {
    if (this.errors.length)
      throw new Error("Cannot run, there were parse errors!");
    this.callStack = [];
    this.varStack = [];

    return await this.callWittyComponent(true, name, wittyData);
  }

  hasComponent(name: string) {
    return this.startPositions.has(name);
  }

  async callWithScope(func: WittyCallbackFunction, wittyData?: WittyData) {
    if (this.errors.length)
      throw new Error("Cannot run, there were parse errors!");

    // Clone this witty
    const tempWitty = new WittyTemplate("", {
      encoding: this.encoding,
      getTidModule: this.getTidModule,
      loader: this.loader,
      _resource: this.resource
    });
    tempWitty.callStack = this.callStack;
    tempWitty.varStack = this.varStack;
    // Push a dummy part with the context
    tempWitty.pushState(true, 0, 0, true, wittyData);
    // Run the function
    return await this.runWittyFunction(tempWitty.parts[0], func);
  }


  //-------------------------------------------------------------------------------------------------------------------------
  //
  // Parsing Witty
  //

  private readWitty(data: string): boolean {
    let state: ParserStates = this.encoding === WittyEncodingStyle.Text ? ParserStates.Text : ParserStates.Content;

    let inComment = false;
    let lineNum = 1, columnNum = 1;
    this.errors = [];
    for (let i = 0, endData = data.length; i < endData;) {
      if (data[i] === "\xEF" && (endData - i) > 2 && data[i + 1] === "\xBB" && data[i + 2] === "\xBF") {
        i += 3;
        continue;
      }

      ++columnNum;
      if (data[i] === "[" && !inComment) {

        let endInstruction = 0;
        ++i;
        if (state === ParserStates.RawComponent) {
          // Looking for "/rawcomponent]"
          if (endData - i > 14 && data.substring(i, i + 14) === "/rawcomponent]") {
            endInstruction = i + 14 - 1;
          } else {
            this.addContentChar(lineNum, columnNum, "[");
            continue;
          }
        } else {
          if (i < endData && data[i] === "[") {
            // escaped "["
            this.addContentChar(lineNum, columnNum, data[i]);
            ++i;
            ++columnNum;
            continue;
          }
          if (i < endData && data[i] === "!") {
            ++i;
            ++columnNum;
            inComment = true;
            continue;
          }

          let inQuote = false;
          let quoteChar = " ";
          endInstruction = i;
          let haveError = false;
          for (; ;) {
            if (endInstruction === endData) {
              this.addError(new WittyErrorRec(this.resource, lineNum, columnNum, WittyErrorCode.UnterminatedInstruction));
              return false;
            }
            if (data[endInstruction] === "\n") {
              this.addError(new WittyErrorRec(this.resource, lineNum, columnNum, WittyErrorCode.LinefeedWithinInstruction));
              haveError = true;
              break;
            }
            if (data[endInstruction] === "\\") {
              ++endInstruction;
              if (endInstruction !== endData)
                ++endInstruction;
            }
            if (!inQuote) {
              if (data[endInstruction] === '"' || data[endInstruction] === "'") {
                inQuote = true;
                quoteChar = data[endInstruction];

                ++endInstruction;
                continue;
              }
              if (data[endInstruction] === "]")
                break;
            } else {
              if (data[endInstruction] === quoteChar) {
                inQuote = false;
                ++endInstruction;
                continue;
              }
            }

            ++endInstruction;
          }

          if (haveError)
            continue;
        }
        try {
          const res = this.addInstruction(lineNum, columnNum, i, endInstruction, data, state === ParserStates.TagSQuote || state === ParserStates.TagDQuote || state === ParserStates.Tag ? ContentEncoding.Value : GetNonquoteEncoding(this.encoding), state);
          state = res.state;
          endInstruction = res.instrEnd;
        } catch (e) {
          if (e instanceof WittyErrorRec)
            this.addError(e);
          else
            throw e;
        }
        columnNum += endInstruction + 1 - i;
        i = endInstruction + 1;
      } else {
        switch (data[i]) {
          case "<":
            if (state === ParserStates.Content)
              state = ParserStates.Tag;
            break;
          case ">":
            if (state === ParserStates.Tag)
              state = ParserStates.Content;
            break;
          case "'":
            if (state === ParserStates.Tag)
              state = ParserStates.TagSQuote;
            else if (state === ParserStates.TagSQuote)
              state = ParserStates.Tag;
            break;
          case '"':
            if (state === ParserStates.Tag)
              state = ParserStates.TagDQuote;
            else if (state === ParserStates.TagDQuote)
              state = ParserStates.Tag;
            break;
          case "!":
            if (inComment && i + 1 < endData && data[i + 1] === "]") {
              i += 2;
              ++columnNum;
              inComment = false;
              continue;
            }
        }

        if (!inComment) {
          this.addContentChar(lineNum, columnNum, data[i]);
        }

        if (data[i] === "\n") {
          ++lineNum;
          columnNum = 1;
        }

        ++i;
      }
    }

    if (this.blockstack.length)
      this.addError(new WittyErrorRec(this.resource, lineNum, columnNum, WittyErrorCode.UnterminatedBlock));
    if (inComment)
      this.addError(new WittyErrorRec(this.resource, lineNum, columnNum, WittyErrorCode.UnterminatedComment));

    return this.errors.length === 0;
  }

  private addContentChar(lineNum: number, columnNum: number, char: string) {
    if (this.parts.at(-1)?.type !== ParsedPartType.Content)
      this.parts.push(new ParsedPart(lineNum, columnNum, ParsedPartType.Content));

    // at this point, we know there is at least one item in the parts array
    const lastPart = this.parts[this.parts.length - 1];

    if (lastPart.contentLen === 0) {
      lastPart.contentPos = this.stringSource.length;
      lastPart.lineNum = lineNum;
      lastPart.columnNum = columnNum;
    }

    ++lastPart.contentLen;
    this.stringSource += char;
  }

  private parseParameter(lineNum: number, columnNum: number, lastEnd: number, limit: number, data: string, dataType: DataType | undefined, stopAtColon: boolean, required: boolean): { haveParam: boolean; param: string; dataType?: DataType; paramEnd: number } {
    while (lastEnd !== limit && /\s/.test(data[lastEnd]))
      ++lastEnd;
    const haveParam = lastEnd !== limit && (!stopAtColon || data[lastEnd] !== ":");
    let parsedData = "";

    if (haveParam) {
      const dataStart = lastEnd;
      const quoted = data[dataStart] === '"' || data[dataStart] === "'";
      const quoteChar = data[dataStart];

      if (quoted) {
        stopAtColon = false;
        ++lastEnd;
      }

      // eslint-disable-next-line no-unmodified-loop-condition -- quoted is unmodified, but lastEnd is modified
      while (lastEnd !== limit && (quoted || !/\s/.test(data[lastEnd]))) {
        if (data[lastEnd] === "\\") {
          if (++lastEnd !== limit) {
            if (data[lastEnd] !== ":" && data[lastEnd] !== "]")
              parsedData += "\\";

            parsedData += data[lastEnd];
            ++lastEnd;
          }
        } else if (stopAtColon && data[lastEnd] === ":")
          break;
        else if (quoted && data[lastEnd] === quoteChar) {
          ++lastEnd;
          break;
        } else {
          parsedData += data[lastEnd];
          ++lastEnd;
        }
      }

      switch (data.substring(dataStart, lastEnd)) {
        case "first": dataType = DataType.First; break;
        case "last": dataType = DataType.Last; break;
        case "odd": dataType = DataType.Odd; break;
        case "even": dataType = DataType.Even; break;
        case "seqnr": dataType = DataType.Seqnr; break;
      }

    } else if (required)
      throw new WittyErrorRec(this.resource, lineNum, columnNum, WittyErrorCode.MissingParameter);

    return { haveParam, param: parsedData, dataType, paramEnd: lastEnd };
  }

  private parseEncoding(lineNum: number, columnNum: number, lastEnd: number, limit: number, data: string): { haveEncoding: boolean; encoding: ContentEncoding; paramEnd: number } {
    while (lastEnd !== limit && /\s/.test(data[lastEnd]))
      ++lastEnd;

    let encoding = ContentEncoding.Invalid;

    if (lastEnd === limit)
      return { haveEncoding: false, encoding, paramEnd: 0 };
    if (data[lastEnd] !== ":")
      throw new WittyErrorRec(this.resource, lineNum, columnNum, WittyErrorCode.UnknownData, data.substring(lastEnd, limit));

    let encodingStart = ++lastEnd;

    // Skip whitespace following ":"
    while (encodingStart !== limit && /\s/.test(data[encodingStart]))
      ++encodingStart;

    // Parse encoding until first whitespace
    lastEnd = encodingStart;
    while (lastEnd !== limit && !/\s/.test(data[lastEnd]))
      ++lastEnd;

    switch (data.substring(encodingStart, lastEnd)) {
      case "none": encoding = ContentEncoding.None; break;
      case "xml": encoding = ContentEncoding.Value; break;
      case "value": encoding = ContentEncoding.Value; break;
      case "html": encoding = ContentEncoding.Html; break;
      case "cdata": encoding = ContentEncoding.CData; break;
      case "json": encoding = ContentEncoding.Json; break;
      case "jsonvalue": encoding = ContentEncoding.JsonValue; break;
    }
    if (encoding === ContentEncoding.Invalid)
      throw new WittyErrorRec(this.resource, lineNum, columnNum, WittyErrorCode.UnknownEncoding, data.substring(encodingStart, lastEnd));

    return { haveEncoding: true, encoding, paramEnd: lastEnd };
  }

  private addInstruction(lineNum: number, columnNum: number, start: number, limit: number, data: string, suggestedEncoding: ContentEncoding, state: ParserStates): { state: ParserStates; instrEnd: number } {
    // Trim whitespace
    while (start !== limit && /\s/.test(data[start]))
      ++start;
    while (start !== limit && /\s/.test(data[limit - 1]))
      --limit;
    //FIXME: also return updated start and limit!

    // No empty tags!
    if (start === limit)
      throw new WittyErrorRec(this.resource, lineNum, columnNum, WittyErrorCode.EmptyCommand);

    // Parse initial command (ignores "\ ", but that doesn't matter, that will come out as NotACommand)
    let commandEnd = start;
    while (commandEnd !== limit && !/\s/.test(data[commandEnd]))
      ++commandEnd;

    const cmd = data.substring(start, commandEnd);
    switch (cmd) {
      case "if":
        {
          const newPart = new ParsedPart(lineNum, columnNum, ParsedPartType.If);
          this.parts.push(newPart);

          let parsedParam = this.parseParameter(lineNum, columnNum, commandEnd, limit, data, newPart.dataType, true, true);
          newPart.content = parsedParam.param;
          if (parsedParam.dataType)
            newPart.dataType = parsedParam.dataType;
          newPart.encoding = suggestedEncoding;
          newPart.ifNot = newPart.content === "not";
          if (newPart.ifNot) {
            newPart.content = "";
            commandEnd = parsedParam.paramEnd;
            parsedParam = this.parseParameter(lineNum, columnNum, commandEnd, limit, data, parsedParam.dataType, true, true);
            newPart.content = parsedParam.param;
            if (parsedParam.dataType)
              newPart.dataType = parsedParam.dataType;
            newPart.encoding = suggestedEncoding;
          }

          this.blockstack.push(newPart);

          start = parsedParam.paramEnd;
          break;
        }
      case "elseif":
        {
          //[elseif XXX] = [else][if XXX].....   and an extra endif layer at the end.....
          if (!this.blockstack.length)
            throw new WittyErrorRec(this.resource, lineNum, columnNum, WittyErrorCode.ElseOutsideIf);
          const lastBlock = this.blockstack[this.blockstack.length - 1];
          if (lastBlock.type !== ParsedPartType.If && lastBlock.type !== ParsedPartType.ElseIf)
            throw new WittyErrorRec(this.resource, lineNum, columnNum, WittyErrorCode.ElseOutsideIf);
          if (lastBlock.cmdLimit !== 0)
            throw new WittyErrorRec(this.resource, lineNum, columnNum, WittyErrorCode.DuplicateElse);

          lastBlock.cmdLimit = this.parts.length;

          const newPart = new ParsedPart(lineNum, columnNum, ParsedPartType.ElseIf);
          this.parts.push(newPart);

          let parsedParam = this.parseParameter(lineNum, columnNum, commandEnd, limit, data, newPart.dataType, true, true);
          newPart.content = parsedParam.param;
          if (parsedParam.dataType)
            newPart.dataType = parsedParam.dataType;
          newPart.encoding = suggestedEncoding;
          newPart.ifNot = newPart.content === "not";
          if (newPart.ifNot) {
            newPart.content = "";
            commandEnd = parsedParam.paramEnd;
            parsedParam = this.parseParameter(lineNum, columnNum, commandEnd, limit, data, parsedParam.dataType, true, true);
            newPart.content = parsedParam.param;
            if (parsedParam.dataType)
              newPart.dataType = parsedParam.dataType;
            newPart.encoding = suggestedEncoding;
          }

          this.blockstack.push(newPart);

          start = parsedParam.paramEnd;
          break;
        }
      case "else":
        {
          if (!this.blockstack.length)
            throw new WittyErrorRec(this.resource, lineNum, columnNum, WittyErrorCode.ElseOutsideIf);
          const lastBlock = this.blockstack[this.blockstack.length - 1];
          if (lastBlock.type !== ParsedPartType.If && lastBlock.type !== ParsedPartType.ElseIf)
            throw new WittyErrorRec(this.resource, lineNum, columnNum, WittyErrorCode.ElseOutsideIf);
          if (lastBlock.cmdLimit !== 0)
            throw new WittyErrorRec(this.resource, lineNum, columnNum, WittyErrorCode.DuplicateElse);

          // Start a new content block
          lastBlock.cmdLimit = this.parts.length;
          this.parts.push(new ParsedPart(lineNum, columnNum, ParsedPartType.Content));
          start = commandEnd;
          break;
        }
      case "/if":
        {
          for (; ;) {
            if (!this.blockstack.length)
              throw new WittyErrorRec(this.resource, lineNum, columnNum, WittyErrorCode.EndIfOutsideIf);
            const lastBlock = this.blockstack[this.blockstack.length - 1];

            const thisType = lastBlock.type;
            if (thisType !== ParsedPartType.If && thisType !== ParsedPartType.ElseIf)
              throw new WittyErrorRec(this.resource, lineNum, columnNum, WittyErrorCode.EndIfOutsideIf);

            if (!lastBlock.cmdLimit)
              lastBlock.cmdLimit = this.parts.length;
            lastBlock.elseLimit = this.parts.length;
            this.parts.push(new ParsedPart(lineNum, columnNum, ParsedPartType.Content));
            this.blockstack.pop();

            if (thisType === ParsedPartType.If)
              break;
          }
          start = commandEnd;
          break;
        }
      case "forevery":
        {
          const newPart = new ParsedPart(lineNum, columnNum, ParsedPartType.Forevery);
          this.parts.push(newPart);

          const parsedParam = this.parseParameter(lineNum, columnNum, commandEnd, limit, data, newPart.dataType, true, true);
          if (parsedParam.dataType !== DataType.Cell)
            throw new WittyErrorRec(this.resource, lineNum, columnNum, WittyErrorCode.ParameterNotACell);
          newPart.content = parsedParam.param;
          newPart.dataType = parsedParam.dataType;
          newPart.encoding = suggestedEncoding;

          this.blockstack.push(newPart);

          start = parsedParam.paramEnd;
          break;
        }
      case "/forevery":
        {
          if (!this.blockstack.length)
            throw new WittyErrorRec(this.resource, lineNum, columnNum, WittyErrorCode.EndForeveryOutsideForevery);
          const lastBlock = this.blockstack[this.blockstack.length - 1];
          if (lastBlock.type !== ParsedPartType.Forevery)
            throw new WittyErrorRec(this.resource, lineNum, columnNum, WittyErrorCode.EndForeveryOutsideForevery);
          lastBlock.cmdLimit = this.parts.length;
          this.parts.push(new ParsedPart(lineNum, columnNum, ParsedPartType.Content));
          this.blockstack.pop();
          start = commandEnd;
          break;
        }
      case "component":
      case "rawcomponent":
        {
          const newPart = new ParsedPart(lineNum, columnNum, ParsedPartType.Component);
          this.parts.push(newPart);

          const parsedParam = this.parseParameter(lineNum, columnNum, commandEnd, limit, data, newPart.dataType, true, true);
          if (parsedParam.dataType !== DataType.Cell)
            throw new WittyErrorRec(this.resource, lineNum, columnNum, WittyErrorCode.ParameterNotACell);
          newPart.content = parsedParam.param;
          newPart.dataType = parsedParam.dataType;
          newPart.encoding = suggestedEncoding;

          if (this.startPositions.has(newPart.content))
            throw new WittyErrorRec(this.resource, lineNum, columnNum, WittyErrorCode.DuplicateComponent);

          this.startPositions.set(newPart.content, this.parts.length);
          this.blockstack.push(newPart);
          start = parsedParam.paramEnd;

          if (cmd === "rawcomponent")
            state = ParserStates.RawComponent;
          else if (state === ParserStates.Tag || state === ParserStates.TagSQuote || state === ParserStates.TagDQuote)
            state = ParserStates.Content;
          break;
        }
      case "/component":
      case "/rawcomponent":
        {
          let lastBlock: ParsedPart;
          if (cmd === "/component") {
            if (!this.blockstack.length)
              throw new WittyErrorRec(this.resource, lineNum, columnNum, WittyErrorCode.EndComponentOutsideComponent);
            lastBlock = this.blockstack[this.blockstack.length - 1];
            if (lastBlock.type !== ParsedPartType.Component || state === ParserStates.RawComponent)
              throw new WittyErrorRec(this.resource, lineNum, columnNum, WittyErrorCode.EndComponentOutsideComponent);
          } else if (cmd === "/rawcomponent") {
            if (!this.blockstack.length)
              throw new WittyErrorRec(this.resource, lineNum, columnNum, WittyErrorCode.EndRawcomponentOutsideRawcomponent);
            lastBlock = this.blockstack[this.blockstack.length - 1];
            if (lastBlock.type !== ParsedPartType.Component || state !== ParserStates.RawComponent)
              throw new WittyErrorRec(this.resource, lineNum, columnNum, WittyErrorCode.EndRawcomponentOutsideRawcomponent);
          }

          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- TypeScript doesn't infer that cmd can only be "/component" or "/rawcomponent" and lastBlock will always be set
          lastBlock!.cmdLimit = this.parts.length;
          this.parts.push(new ParsedPart(lineNum, columnNum, ParsedPartType.Content));
          this.blockstack.pop();
          start = commandEnd;
          if (state === ParserStates.RawComponent)
            state = this.encoding === WittyEncodingStyle.Text ? ParserStates.Text : ParserStates.Content;
          else if (state === ParserStates.Tag || state === ParserStates.TagSQuote || state === ParserStates.TagDQuote)
            state = ParserStates.Content;
          break;
        }
      case "embed":
        {
          const newPart = new ParsedPart(lineNum, columnNum, ParsedPartType.Embed);
          this.parts.push(newPart);

          const parsedParam = this.parseParameter(lineNum, columnNum, commandEnd, limit, data, newPart.dataType, false, true);
          if (parsedParam.dataType !== DataType.Cell)
            throw new WittyErrorRec(this.resource, lineNum, columnNum, WittyErrorCode.ParameterNotACell);
          newPart.content = parsedParam.param;
          newPart.dataType = parsedParam.dataType;
          newPart.encoding = suggestedEncoding;

          start = parsedParam.paramEnd;
          break;
        }
      case "gettid":
      case "gethtmltid":
        {
          const newPart = new ParsedPart(lineNum, columnNum, cmd === "gettid" ? ParsedPartType.GetTid : ParsedPartType.GetHTMLTid);
          this.parts.push(newPart);

          let haveParam = false;
          let paramEnd = commandEnd;
          let dataType: DataType | undefined;
          let param: string;
          for (; ;) {
            param = "";

            const parsedParam = this.parseParameter(lineNum, columnNum, paramEnd, limit, data, newPart.dataType, true, !haveParam);
            param = parsedParam.param;
            dataType = parsedParam.dataType;
            paramEnd = parsedParam.paramEnd;

            if (!parsedParam.haveParam)
              break;

            newPart.parameters.push(param);

            if (dataType !== DataType.Cell)
              throw new WittyErrorRec(this.resource, lineNum, columnNum, WittyErrorCode.ParameterNotACell);

            haveParam = true;
          }

          if (newPart.parameters.length && this.getTidModule !== "" && newPart.parameters[0].indexOf(":") < 0)
            newPart.parameters[0] = this.getTidModule + ":" + newPart.parameters[0];

          newPart.dataType = DataType.Cell;
          newPart.encoding = cmd === "gettid" ? suggestedEncoding : ContentEncoding.None;
          const parsedEncoding = this.parseEncoding(lineNum, columnNum, paramEnd, limit, data);
          if (parsedEncoding.haveEncoding) {
            newPart.encoding = parsedEncoding.encoding;
            paramEnd = parsedEncoding.paramEnd;
          }
          start = paramEnd;

          break;
        }
      default:
        {
          if (commandEnd !== start && data[start] === "/")
            throw new WittyErrorRec(this.resource, lineNum, columnNum, WittyErrorCode.InvalidClosingTag, data.substring(start, limit));

          const newPart = new ParsedPart(lineNum, columnNum, ParsedPartType.Data);
          this.parts.push(newPart);

          const parsedParam = this.parseParameter(lineNum, columnNum, start, limit, data, newPart.dataType, true, true);
          newPart.content = parsedParam.param;
          if (parsedParam.dataType)
            newPart.dataType = parsedParam.dataType;
          newPart.encoding = suggestedEncoding;
          start = parsedParam.paramEnd;

          const parsedEncoding = this.parseEncoding(lineNum, columnNum, parsedParam.paramEnd, limit, data);
          if (parsedEncoding.haveEncoding) {
            newPart.encoding = parsedEncoding.encoding;
            start = parsedEncoding.paramEnd;
          }

          if (newPart.dataType !== DataType.Seqnr && newPart.dataType !== DataType.Cell)
            throw new WittyErrorRec(this.resource, lineNum, columnNum, WittyErrorCode.ReservedWordAsCell, newPart.content);
        }
    }

    if (start !== limit)
      throw new WittyErrorRec(this.resource, lineNum, columnNum, WittyErrorCode.UnknownData, data.substring(start, limit));

    return { state, instrEnd: limit };
  }

  private addError(error: WittyErrorRec) {
    this.errors.push(error);
  }


  //-------------------------------------------------------------------------------------------------------------------------
  //
  // Running Witty
  //

  private async callWittyComponent(newInvocation: boolean, name: string, wittyData?: WittyData) {
    const sep = name.lastIndexOf(":");
    if (sep > 0) {
      //Make sure we don't confuse a '::' for a component indicator
      if (name[sep - 1] === ":")
        throw new WittyErrorRec("", 0, 0, WittyErrorCode.MissingComponentName, name);
      let resource = name.substring(0, sep);
      name = name.substring(sep + 1);
      if (resource.indexOf("::") < 0 && this.resource)
        resource = path.join(...this.resource.split("/").slice(0, -1), resource);
      if (resource !== this.resource) {
        if (!this.loader)
          throw new WittyError(`Cannot load library '${resource}': No resource loader available`, []);

        const witty = await loadWittyTemplate(resource, { loader: this.loader });
        witty.callStack = this.callStack;
        witty.varStack = this.varStack;
        return await witty.runComponentInternal(newInvocation, name, wittyData);
      }
    }
    return await this.runComponentInternal(newInvocation, name, wittyData);
  }

  protected async runComponentInternal(newInvocation: boolean, name: string, wittyData?: WittyData): Promise<string> {
    let start = 0, limit = this.parts.length;
    if (name !== "") {
      if (!this.startPositions.has(name))
        throw new WittyErrorRec(this.resource, this.parts[0].lineNum, this.parts[0].columnNum, WittyErrorCode.NoSuchComponent, name);
      const component = this.startPositions.get(name);
      start = component!;
      limit = this.parts[component! - 1].cmdLimit;
    }
    this.pushState(newInvocation, start, limit, true, wittyData);
    try {
      return await this.runStack();
    } catch (e) {
      if (e instanceof WittyErrorRec)
        throw new WittyRunError(e);
      else
        throw e;
    }
  }

  private pushState(newInvocation: boolean, itr: number, limit: number, rootInvocation: boolean, wittyData?: WittyData, foreveryNonRA?: ParsedPart) {
    const depth = this.callStack.length ? this.callStack[this.callStack.length - 1].depth + (newInvocation ? 1 : 0) : 1;
    const hasVariable = wittyData !== undefined && ((typeof wittyData === "object" && !Array.isArray(wittyData)) || foreveryNonRA !== undefined);

    this.callStack.push({
      depth,
      hasVariable,
      itr,
      limit,
      mustReturn: rootInvocation,
      foreveryEltNr: -1,
      foreveryEltLimit: -1
    });
    if (hasVariable)
      this.varStack.push({ foreveryNonRA, wittyVar: wittyData });
  }

  private async runStack(): Promise<string> {
    if (!this.callStack.length)
      throw new Error("Running on empty witty stack!");

    let output = "";
    while (this.callStack.length) {
      const elt = this.callStack[this.callStack.length - 1];
      if (elt.itr === elt.limit) {
        if (elt.hasVariable)
          this.varStack.pop();
        const mustReturn = elt.mustReturn;
        this.callStack.pop();
        if (mustReturn)
          return output;
        continue;
      }
      const part = this.parts[elt.itr];

      let wittyVar: WittyData | WittyData[] | undefined;
      let isHtml = false;
      if (![ParsedPartType.Content, ParsedPartType.Component, ParsedPartType.Embed, ParsedPartType.GetTid, ParsedPartType.GetHTMLTid].includes(part.type) && part.dataType === DataType.Cell) {
        wittyVar = this.findCellInStack(this.parts[elt.itr].content);
        if (wittyVar === undefined)
          throw new WittyErrorRec(this.resource, part.lineNum, part.columnNum, WittyErrorCode.NoSuchCell, part.content);
      }
      switch (part.type) {
        case ParsedPartType.Content:
          {
            if (part.contentLen)
              output += this.stringSource.substring(part.contentPos, part.contentPos + part.contentLen);
            ++elt.itr;
            break;
          }
        case ParsedPartType.Data:
          {
            output += await this.getOutputCell(part, wittyVar);
            ++elt.itr;
            break;
          }
        case ParsedPartType.If:
        case ParsedPartType.ElseIf:
          {
            const matches = this.evaluateIf(part, wittyVar);
            if (matches !== part.ifNot) {
              const recVar = typeof wittyVar === "object" && !Array.isArray(wittyVar) ? wittyVar : undefined;
              this.pushState(false, elt.itr + 1, part.cmdLimit, false, recVar);
            } else
              this.pushState(false, part.cmdLimit, part.elseLimit, false, undefined);
            elt.itr = part.elseLimit;
            break;
          }
        case ParsedPartType.Component:
          {
            // just skip it
            elt.itr = part.cmdLimit;
            break;
          }
        case ParsedPartType.Embed:
          {
            output += await this.embed(part);
            ++elt.itr;
            break;
          }
        case ParsedPartType.GetHTMLTid:
          {
            isHtml = true;
          } //fallthrough
        case ParsedPartType.GetTid:
          {
            const tid = part.parameters[0];
            const p1 = part.parameters.length > 1 ? await this.getTidParam(part, part.parameters[1]) : undefined;
            const p2 = part.parameters.length > 2 ? await this.getTidParam(part, part.parameters[2]) : undefined;
            const p3 = part.parameters.length > 3 ? await this.getTidParam(part, part.parameters[3]) : undefined;
            const p4 = part.parameters.length > 4 ? await this.getTidParam(part, part.parameters[4]) : undefined;
            if (isHtml)
              output += this.encodeString(getHTMLTid(tid, p1, p2, p3, p4), part.encoding);
            else
              output += this.encodeString(getTid(tid, p1, p2, p3, p4), part.encoding);
            ++elt.itr;
            break;
          }
        case ParsedPartType.Forevery:
          {
            if (!Array.isArray(wittyVar))
              throw new WittyErrorRec(this.resource, part.lineNum, part.columnNum, WittyErrorCode.CellNotAnArray, part.content);
            if (elt.foreveryEltLimit === -1) {
              elt.foreveryEltLimit = wittyVar.length;
              elt.foreveryEltNr = 0;
            } else
              ++elt.foreveryEltNr;

            if (elt.foreveryEltNr === elt.foreveryEltLimit) {
              elt.itr = part.cmdLimit;
              elt.foreveryEltNr = -1;
              elt.foreveryEltLimit = -1;
            } else {
              const el = wittyVar[elt.foreveryEltNr];
              this.pushState(false, elt.itr + 1, part.cmdLimit, false, wittyVar[elt.foreveryEltNr], typeof el !== "object" ? part : undefined);
            }
          }
      }
    }
    return output;
  }

  private async embed(part: ParsedPart): Promise<string> {
    return await this.callWittyComponent(false, part.content);
  }

  private async getOutputCell(part: ParsedPart, wittyVar?: WittyData | WittyData[]): Promise<string> {
    switch (part.dataType) {
      case DataType.Seqnr:
        {
          const forevery = this.findForeveryInStack();
          if (!forevery)
            throw new WittyErrorRec(this.resource, part.lineNum, part.columnNum, WittyErrorCode.ForeveryVarOutsideForevery, "seqnr");
          return forevery.foreveryEltNr.toString();
        }
      case DataType.Cell:
        {
          if (part.encoding === ContentEncoding.Json || part.encoding === ContentEncoding.JsonValue) {
            return stringify(wittyVar, { target: part.encoding === ContentEncoding.JsonValue ? "attribute" : "script" });
          }
          switch (typeof wittyVar) {
            case "number":
              {
                return wittyVar.toString();
              }
            case "string":
              {
                return this.encodeString(wittyVar, part.encoding);
              }
            case "function":
              {
                return await this.runWittyFunction(part, wittyVar);
              }
            case "object":
              {
                if (wittyVar === null)
                  return "";
              } //fallthrough
            default:
              {
                throw new WittyErrorRec(this.resource, part.lineNum, part.columnNum, WittyErrorCode.CannotOutputCell, part.content, typeof wittyVar);
              }
          }
        }
      default:
        throw new Error("Unexpected datatype in cell output statement");
    }
  }

  private encodeString(value: string, encoding: ContentEncoding) {
    switch (encoding) {
      case ContentEncoding.None:
        {
          return value;
        }
      case ContentEncoding.Html:
        {
          return encodeString(value, 'html');
        }
      case ContentEncoding.Value:
        {
          return encodeString(value, 'attribute');
        }
      case ContentEncoding.CData:
        {
          return "<![CDATA[" + value.split("]]>").join("]]]]><![CDATA[>") + "]]>";
        }
    }
    return "";
  }

  private async getTidParam(part: ParsedPart, param: string): Promise<string | number | undefined> {
    const wittyVar = this.findCellInStack(param);
    if (typeof wittyVar === "string")
      return wittyVar;
    if (typeof wittyVar === "number")
      return wittyVar;
    if (typeof wittyVar === "function")
      return await this.runWittyFunction(part, wittyVar);
    return undefined;
  }

  private async runWittyFunction(part: ParsedPart, func: WittyCallbackFunction) {
    const ctx: WittyCallContext = {
      get: (name: string) => this.findCellInStack(name),
      embed: (name: string, wdata?: WittyData) => this.callWittyComponent(false, name, wdata),
      encode: async (wvar?: WittyData | WittyData[]) => await this.getOutputCell(part, wvar)
    };
    return await func(ctx);
  }

  private evaluateIf(part: ParsedPart, wittyVar?: WittyData | WittyData[]): boolean {
    if (part.dataType === DataType.Cell) {
      if (Array.isArray(wittyVar))
        return wittyVar.length > 0;
      return Boolean(wittyVar);
    }
    const forevery = this.findForeveryInStack();
    switch (part.dataType) {
      case DataType.First:
        {
          if (!forevery)
            throw new WittyErrorRec(this.resource, part.lineNum, part.columnNum, WittyErrorCode.ForeveryVarOutsideForevery, "first");
          return forevery.foreveryEltNr === 0;
        }
      case DataType.Last:
        {
          if (!forevery)
            throw new WittyErrorRec(this.resource, part.lineNum, part.columnNum, WittyErrorCode.ForeveryVarOutsideForevery, "last");
          return forevery.foreveryEltNr === forevery.foreveryEltLimit - 1;
        }
      case DataType.Odd:
        {
          if (!forevery)
            throw new WittyErrorRec(this.resource, part.lineNum, part.columnNum, WittyErrorCode.ForeveryVarOutsideForevery, "odd");
          return forevery.foreveryEltNr % 2 === 1;
        }
      case DataType.Even:
        {
          if (!forevery)
            throw new WittyErrorRec(this.resource, part.lineNum, part.columnNum, WittyErrorCode.ForeveryVarOutsideForevery, "event");
          return forevery.foreveryEltNr % 2 === 0;
        }
      case DataType.Seqnr:
        {
          if (!forevery)
            throw new WittyErrorRec(this.resource, part.lineNum, part.columnNum, WittyErrorCode.ForeveryVarOutsideForevery, "seqnr");
          return forevery.foreveryEltNr !== 0;
        }
    }
  }

  private findCellInStack(cellName: string): WittyData | WittyData[] | undefined {
    const cellParts = cellName.split(".");
    let colVar: WittyData | WittyData[] | undefined = undefined;
    for (let i = this.varStack.length - 1; i >= 0 && colVar === undefined; --i) {
      const elem = this.varStack[i];
      if (cellParts.length === 1 && elem.foreveryNonRA !== undefined) {
        const foreveryName = elem.foreveryNonRA.content.split(".").pop();
        if (foreveryName === cellName)
          colVar = elem.wittyVar;
      } else if (elem.wittyVar && typeof elem.wittyVar === "object" && !Array.isArray(elem))
        colVar = elem.wittyVar[cellParts[0] as keyof object];
    }
    cellParts.shift();
    while (colVar !== undefined && cellParts.length) {
      if (typeof colVar !== "object" || Array.isArray(colVar) || colVar === null)
        return;
      colVar = colVar[cellParts[0] as keyof object];
      cellParts.shift();
    }
    return colVar;
  }

  private findForeveryInStack(): CallStackElement | undefined {
    for (let i = this.callStack.length - 1; i >= 0; --i) {
      if (this.callStack[i].foreveryEltLimit !== -1)
        return this.callStack[i];
    }
    return undefined;
  }
}

export async function loadWittyTemplate(resource: string, options?: WittyOptions): Promise<WittyTemplate> {
  if (!options?.loader)
    throw new WittyError(`Cannot load library '${resource}': No WittyTemplateLoader specified`, []);

  try {
    const data = await options.loader(resource);
    return new WittyTemplate(data, { ...options, _resource: resource });
  } catch (e) {
    if (e instanceof Error)
      throw new WittyError(`Cannot load library '${resource}': ${e.message}`, []);
    throw new WittyError(`Cannot load library '${resource}'`, []);
  }
}
