import { encodeValue, encodeJSCompatibleJSON, encodeHTML } from "dompack/types/text";

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

export enum EncodingStyles {
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

function GetNonquoteEncoding(encodingstyle: EncodingStyles): ContentEncoding {
  if (encodingstyle == EncodingStyles.HTML)
    return ContentEncoding.Html;
  else if (encodingstyle == EncodingStyles.XML)
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

const wittyMessages = [
  "", // unused, pushes first message to index 1
  /*  1 */ "Unterminated instruction",
  /*  2 */ "Linefeed appears inside instruction",
  /*  3 */ "Unknown data follows the value: '%0'",
  /*  4 */ "Unknown encoding '%0' requested",
  /*  5 */ "Reserved word '%0' cannot be used as print data",
  /*  6 */ "An [else] or [elseif] must be inside an [if]-block",
  /*  7 */ "Duplicate [else] in [if]-block",
  /*  8 */ "[/if] must be inside an [if]-block",
  /*  9 */ "Duplicate component name",
  /* 10 */ "[/component] must be inside a [component]-block",
  /* 11 */ "Parameter passed must be a cell name",
  /* 12 */ "[/forevery] must be inside a [forevery]-block",
  /* 13 */ "Unterminated block",
  /* 14 */ "Unterminated comment",
  /* 15 */ "No such cell '%0'",
  /* 16 */ "Cell '%0' did not evaluate to an array",
  /* 17 */ "Requesting '%0' outside a [forevery]-block",
  /* 18 */ "Don't know how to print cell '%0' of type '%1'",
  /* 19 */ "", // unused, formerly about truthy values
  /* 20 */ "No such component '%0'",
  /* 21 */ "Empty command",
  /* 22 */ "", // unused, formerly about /REPEAT
  /* 23 */ "", // unused, formerly about INTEGER values
  /* 24 */ "Invalid closing tag '%0'",
  /* 25 */ "", // unused, formerly about missing encoding
  /* 26 */ "Missing required parameter",
  /* 27 */ "[/rawcomponent] must be inside a [rawcomponent]-block"
];

class WittyErrorRec {
  readonly line: number;
  readonly column: number;
  readonly text: string;
  readonly code: number;
  readonly arg?: string;
  readonly arg2?: string;

  constructor(lineNum: number, columnNum: number, errorCode: number, arg = "", arg2 = "") {
    this.text = wittyMessages[errorCode].replaceAll("%0", arg).replaceAll("%1", arg2);
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
  constructor(errors: WittyErrorRec[]) {
    super("Witty runtime error", errors);
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
  foreveryNonRA?: ParsedPart; // index within parts
  wittyVar: unknown;
};

export type WittyOptions = {
  encoding?: EncodingStyles;
  getTidModule?: string;
};

export class WittyTemplate {
  private es: EncodingStyles;
  private parts: ParsedPart[] = [];
  private printData = "";
  private blockstack: ParsedPart[] = [];
  private startPositions: Map<string, number> = new Map();
  private _errors: WittyErrorRec[] = [];
  private getTidModule: string;
  private callStack: CallStackElement[] = [];
  private varStack: VarStackElement[] = [];


  //-------------------------------------------------------------------------------------------------------------------------
  //
  // Public API
  //

  constructor(data: string, options?: WittyOptions) {
    this.es = options?.encoding || EncodingStyles.HTML;
    this.getTidModule = options?.getTidModule || "";
    this.readWitty(data);
    if (this._errors.length)
      throw new WittyParseError(this._errors);
  }

  async run(wittyData?: unknown): Promise<string> {
    if (this._errors.length)
      throw new Error("Cannot run, there were parse errors!");
    this.callStack = [];
    this.varStack = [];
    this.smPush(true, 0, this.parts.length, wittyData, true);
    try {
      return this.smRun();
    } catch (e) {
      if (e instanceof WittyErrorRec)
        throw new WittyRunError([e]);
      else
        throw e;
    }
  }


  //-------------------------------------------------------------------------------------------------------------------------
  //
  // Parsing Witty
  //

  private readWitty(data: string): boolean {
    let state: ParserStates = this.es == EncodingStyles.Text ? ParserStates.Text : ParserStates.Content;

    let inComment = false;
    let lineNum = 1, columnNum = 1;
    this._errors = [];
    for (let i = 0, endData = data.length; i < endData;) {
      if (data[i] == "\xEF" && (endData - i) > 2 && data[i + 1] == "\xBB" && data[i + 2] == "\xBF") {
        i += 3;
        continue;
      }

      ++columnNum;
      if (data[i] == "[" && !inComment) {

        let endInstruction = 0;
        ++i;
        if (state == ParserStates.RawComponent) {
          // Looking for "/rawcomponent]"
          if (endData - i > 14 && data.substring(i, i + 14) == "/rawcomponent]") {
            endInstruction = i + 14 - 1;
          } else {
            this.addContentChar(lineNum, columnNum, "[");
            continue;
          }
        } else {
          if (i < endData && data[i] == "[") {
            // escaped "["
            this.addContentChar(lineNum, columnNum, data[i]);
            ++i;
            ++columnNum;
            continue;
          }
          if (i < endData && data[i] == "!") {
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
            if (endInstruction == endData) {
              this.addError(new WittyErrorRec(lineNum, columnNum, 1));
              return false;
            }
            if (data[endInstruction] == "\n") {
              this.addError(new WittyErrorRec(lineNum, columnNum, 2));
              haveError = true;
              break;
            }
            if (data[endInstruction] == "\\") {
              ++endInstruction;
              if (endInstruction != endData)
                ++endInstruction;
            }
            if (!inQuote) {
              if (data[endInstruction] == '"' || data[endInstruction] == "'") {
                inQuote = true;
                quoteChar = data[endInstruction];

                ++endInstruction;
                continue;
              }
              if (data[endInstruction] == "]")
                break;
            } else {
              if (data[endInstruction] == quoteChar) {
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
          const res = this.addInstruction(lineNum, columnNum, i, endInstruction, data, state == ParserStates.TagSQuote || state == ParserStates.TagDQuote || state == ParserStates.Tag ? ContentEncoding.Value : GetNonquoteEncoding(this.es), state);
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
            if (state == ParserStates.Content)
              state = ParserStates.Tag;
            break;
          case ">":
            if (state == ParserStates.Tag)
              state = ParserStates.Content;
            break;
          case "'":
            if (state == ParserStates.Tag)
              state = ParserStates.TagSQuote;
            else if (state == ParserStates.TagSQuote)
              state = ParserStates.Tag;
            break;
          case '"':
            if (state == ParserStates.Tag)
              state = ParserStates.TagDQuote;
            else if (state == ParserStates.TagDQuote)
              state = ParserStates.Tag;
            break;
          case "!":
            if (inComment && i + 1 < endData && data[i + 1] == "]") {
              i += 2;
              ++columnNum;
              inComment = false;
              continue;
            }
        }

        if (!inComment) {
          this.addContentChar(lineNum, columnNum, data[i]);
        }

        if (data[i] == "\n") {
          ++lineNum;
          columnNum = 1;
        }

        ++i;
      }
    }

    if (this.blockstack.length)
      this.addError(new WittyErrorRec(lineNum, columnNum, 13));
    if (inComment)
      this.addError(new WittyErrorRec(lineNum, columnNum, 14));

    return this._errors.length == 0;
  }

  private addContentChar(lineNum: number, columnNum: number, char: string) {
    if (this.parts.at(-1)?.type != ParsedPartType.Content)
      this.parts.push(new ParsedPart(lineNum, columnNum, ParsedPartType.Content));

    // at this point, we know there is at least one item in the parts array
    const lastPart = this.parts[this.parts.length - 1];

    if (lastPart.contentLen == 0) {
      lastPart.contentPos = this.printData.length;
      lastPart.lineNum = lineNum;
      lastPart.columnNum = columnNum;
    }

    ++lastPart.contentLen;
    this.printData += char;
  }

  private parseParameter(lineNum: number, columnNum: number, lastEnd: number, limit: number, data: string, dataType: DataType | undefined, stopAtColon: boolean, required: boolean): { haveParam: boolean; param: string; dataType?: DataType; paramEnd: number } {
    while (lastEnd != limit && /\s/.test(data[lastEnd]))
      ++lastEnd;
    const haveParam = lastEnd != limit && (!stopAtColon || data[lastEnd] != ":");
    let parsedData = "";

    if (haveParam) {
      const dataStart = lastEnd;
      const quoted = data[dataStart] == '"' || data[dataStart] == "'";
      const quoteChar = data[dataStart];

      if (quoted) {
        stopAtColon = false;
        ++lastEnd;
      }

      // eslint-disable-next-line no-unmodified-loop-condition -- quoted is unmodified, but lastEnd is modified
      while (lastEnd != limit && (quoted || !/\s/.test(data[lastEnd]))) {
        if (data[lastEnd] == "\\") {
          if (++lastEnd != limit) {
            if (data[lastEnd] != ":" && data[lastEnd] != "]")
              parsedData += "\\";

            parsedData += data[lastEnd];
            ++lastEnd;
          }
        } else if (stopAtColon && data[lastEnd] == ":")
          break;
        else if (quoted && data[lastEnd] == quoteChar) {
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
      throw new WittyErrorRec(lineNum, columnNum, 26);

    return { haveParam, param: parsedData, dataType, paramEnd: lastEnd };
  }

  private parseEncoding(lineNum: number, columnNum: number, lastEnd: number, limit: number, data: string): { haveEncoding: boolean; encoding: ContentEncoding; paramEnd: number } {
    while (lastEnd != limit && /\s/.test(data[lastEnd]))
      ++lastEnd;

    let encoding = ContentEncoding.Invalid;

    if (lastEnd == limit)
      return { haveEncoding: false, encoding, paramEnd: 0 };
    if (data[lastEnd] != ":")
      throw new WittyErrorRec(lineNum, columnNum, 3, data.substring(lastEnd, limit));

    let encodingStart = ++lastEnd;

    // Skip whitespace following ":"
    while (encodingStart != limit && /\s/.test(data[encodingStart]))
      ++encodingStart;

    // Parse encoding until first whitespace
    lastEnd = encodingStart;
    while (lastEnd != limit && !/\s/.test(data[lastEnd]))
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
    if (encoding == ContentEncoding.Invalid)
      throw new WittyErrorRec(lineNum, columnNum, 4, data.substring(encodingStart, lastEnd));

    return { haveEncoding: true, encoding, paramEnd: lastEnd };
  }

  private addInstruction(lineNum: number, columnNum: number, start: number, limit: number, data: string, suggestedEncoding: ContentEncoding, state: ParserStates): { state: ParserStates; instrEnd: number } {
    // Trim whitespace
    while (start != limit && /\s/.test(data[start]))
      ++start;
    while (start != limit && /\s/.test(data[limit - 1]))
      --limit;
    //FIXME: also return updated start and limit!

    // No empty tags!
    if (start == limit)
      throw new WittyErrorRec(lineNum, columnNum, 21);

    // Parse initial command (ignores "\ ", but that doesn't matter, that will come out as NotACommand)
    let commandEnd = start;
    while (commandEnd != limit && !/\s/.test(data[commandEnd]))
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
          newPart.ifNot = newPart.content == "not";
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
            throw new WittyErrorRec(lineNum, columnNum, 6);
          const lastBlock = this.blockstack[this.blockstack.length - 1];
          if (lastBlock.type != ParsedPartType.If && lastBlock.type != ParsedPartType.ElseIf)
            throw new WittyErrorRec(lineNum, columnNum, 6);
          if (lastBlock.cmdLimit != 0)
            throw new WittyErrorRec(lineNum, columnNum, 7);

          lastBlock.cmdLimit = this.parts.length;

          const newPart = new ParsedPart(lineNum, columnNum, ParsedPartType.ElseIf);
          this.parts.push(newPart);

          let parsedParam = this.parseParameter(lineNum, columnNum, commandEnd, limit, data, newPart.dataType, true, true);
          newPart.content = parsedParam.param;
          if (parsedParam.dataType)
            newPart.dataType = parsedParam.dataType;
          newPart.encoding = suggestedEncoding;
          newPart.ifNot = newPart.content == "not";
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
            throw new WittyErrorRec(lineNum, columnNum, 6);
          const lastBlock = this.blockstack[this.blockstack.length - 1];
          if (lastBlock.type != ParsedPartType.If && lastBlock.type != ParsedPartType.ElseIf)
            throw new WittyErrorRec(lineNum, columnNum, 6);
          if (lastBlock.cmdLimit != 0)
            throw new WittyErrorRec(lineNum, columnNum, 7);

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
              throw new WittyErrorRec(lineNum, columnNum, 8);
            const lastBlock = this.blockstack[this.blockstack.length - 1];

            const thisType = lastBlock.type;
            if (thisType != ParsedPartType.If && thisType != ParsedPartType.ElseIf)
              throw new WittyErrorRec(lineNum, columnNum, 8);

            if (!lastBlock.cmdLimit)
              lastBlock.cmdLimit = this.parts.length;
            lastBlock.elseLimit = this.parts.length;
            this.parts.push(new ParsedPart(lineNum, columnNum, ParsedPartType.Content));
            this.blockstack.pop();

            if (thisType == ParsedPartType.If)
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
          if (parsedParam.dataType != DataType.Cell)
            throw new WittyErrorRec(lineNum, columnNum, 11);
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
            throw new WittyErrorRec(lineNum, columnNum, 12);
          const lastBlock = this.blockstack[this.blockstack.length - 1];
          if (lastBlock.type != ParsedPartType.Forevery)
            throw new WittyErrorRec(lineNum, columnNum, 12);
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
          if (parsedParam.dataType != DataType.Cell)
            throw new WittyErrorRec(lineNum, columnNum, 11);
          newPart.content = parsedParam.param;
          newPart.dataType = parsedParam.dataType;
          newPart.encoding = suggestedEncoding;

          if (this.startPositions.has(newPart.content))
            throw new WittyErrorRec(lineNum, columnNum, 9);

          this.startPositions.set(newPart.content, this.parts.length);
          this.blockstack.push(newPart);
          start = parsedParam.paramEnd;

          if (cmd == "rawcomponent")
            state = ParserStates.RawComponent;
          else if (state == ParserStates.Tag || state == ParserStates.TagSQuote || state == ParserStates.TagDQuote)
            state = ParserStates.Content;
          break;
        }
      case "/component":
      case "/rawcomponent":
        {
          let lastBlock: ParsedPart;
          if (cmd == "/component") {
            if (!this.blockstack.length)
              throw new WittyErrorRec(lineNum, columnNum, 10);
            lastBlock = this.blockstack[this.blockstack.length - 1];
            if (lastBlock.type != ParsedPartType.Component || state == ParserStates.RawComponent)
              throw new WittyErrorRec(lineNum, columnNum, 10);
          } else if (cmd == "/rawcomponent") {
            if (!this.blockstack.length)
              throw new WittyErrorRec(lineNum, columnNum, 27);
            lastBlock = this.blockstack[this.blockstack.length - 1];
            if (lastBlock.type != ParsedPartType.Component || state != ParserStates.RawComponent)
              throw new WittyErrorRec(lineNum, columnNum, 27);
          }

          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- TypeScript doesn't infer that cmd can only be "/component" or "/rawcomponent" and lastBlock will always be set
          lastBlock!.cmdLimit = this.parts.length;
          this.parts.push(new ParsedPart(lineNum, columnNum, ParsedPartType.Content));
          this.blockstack.pop();
          start = commandEnd;
          if (state == ParserStates.RawComponent)
            state = this.es == EncodingStyles.Text ? ParserStates.Text : ParserStates.Content;
          else if (state == ParserStates.Tag || state == ParserStates.TagSQuote || state == ParserStates.TagDQuote)
            state = ParserStates.Content;
          break;
        }
      case "embed":
        {
          const newPart = new ParsedPart(lineNum, columnNum, ParsedPartType.Embed);
          this.parts.push(newPart);

          const parsedParam = this.parseParameter(lineNum, columnNum, commandEnd, limit, data, newPart.dataType, true, true);
          if (parsedParam.dataType != DataType.Cell)
            throw new WittyErrorRec(lineNum, columnNum, 11);
          newPart.content = parsedParam.param;
          newPart.dataType = parsedParam.dataType;
          newPart.encoding = suggestedEncoding;

          start = parsedParam.paramEnd;
          break;
        }
      case "gettid":
      case "gethtmltid":
        {
          const newPart = new ParsedPart(lineNum, columnNum, cmd == "gettid" ? ParsedPartType.GetTid : ParsedPartType.GetHTMLTid);
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

            if (dataType != DataType.Cell)
              throw new WittyErrorRec(lineNum, columnNum, 11);

            haveParam = true;
          }

          if (newPart.parameters.length && this.getTidModule != "" && newPart.parameters[0].indexOf(":") < 0)
            newPart.parameters[0] = this.getTidModule + ":" + newPart.parameters[0];

          newPart.dataType = DataType.Cell;
          newPart.encoding = cmd == "gettid" ? suggestedEncoding : ContentEncoding.None;
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
          if (commandEnd != start && data[start] == "/")
            throw new WittyErrorRec(lineNum, columnNum, 24, data.substring(start, limit));

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

          if (newPart.dataType != DataType.Seqnr && newPart.dataType != DataType.Cell)
            throw new WittyErrorRec(lineNum, columnNum, 5, newPart.content);
        }
    }

    if (start != limit)
      throw new WittyErrorRec(lineNum, columnNum, 3, data.substring(start, limit));

    return { state, instrEnd: limit };
  }

  private addError(error: WittyErrorRec) {
    this._errors.push(error);
  }


  //-------------------------------------------------------------------------------------------------------------------------
  //
  // Running Witty
  //

  private smPush(newInvocation: boolean, itr: number, limit: number, wittyData: unknown, rootInvocation: boolean, foreveryNonRA?: ParsedPart) {
    const depth = this.callStack.length ? this.callStack[this.callStack.length - 1].depth + (newInvocation ? 1 : 0) : 1;
    const hasVariable = wittyData != undefined && ((typeof wittyData == "object" && !Array.isArray(wittyData)) || foreveryNonRA != undefined);

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

  private smRun(): string {
    if (!this.callStack.length)
      throw new Error("Running on empty witty stack!");

    let output = "";
    while (this.callStack.length) {
      const elt = this.callStack[this.callStack.length - 1];
      if (elt.itr == elt.limit) {
        if (elt.hasVariable)
          this.varStack.pop();
        const mustReturn = elt.mustReturn;
        this.callStack.pop();
        if (mustReturn)
          return output;
        continue;
      }
      const part = this.parts[elt.itr];

      let wittyVar: unknown;
      let isHtml = false;
      if (![ParsedPartType.Content, ParsedPartType.Component, ParsedPartType.Embed, ParsedPartType.GetTid, ParsedPartType.GetHTMLTid].includes(part.type) && part.dataType == DataType.Cell) {
        wittyVar = this.findCellInStack(this.parts[elt.itr].content);
        if (wittyVar === undefined)
          throw new WittyErrorRec(part.lineNum, part.columnNum, 15, part.content);
      }
      switch (part.type) {
        case ParsedPartType.Content:
          {
            if (part.contentLen)
              output += this.printData.substring(part.contentPos, part.contentPos + part.contentLen);
            ++elt.itr;
            break;
          }
        case ParsedPartType.Data:
          {
            output += this.smPrintCell(part, elt, wittyVar);
            ++elt.itr;
            break;
          }
        case ParsedPartType.If:
        case ParsedPartType.ElseIf:
          {
            const matches = this.smEvaluateIf(part, wittyVar);
            if (matches != part.ifNot) {
              const recVar = typeof wittyVar == "object" && !Array.isArray(wittyVar) ? wittyVar : undefined;
              this.smPush(false, elt.itr + 1, part.cmdLimit, recVar, false);
            } else
              this.smPush(false, part.cmdLimit, part.elseLimit, undefined, false);
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
            output += this.smEmbed();
            ++elt.itr;
            break;
          }
        case ParsedPartType.GetHTMLTid:
          {
            isHtml = true;
          } //fallthrough
        case ParsedPartType.GetTid:
          {
            console.log("getTid", isHtml);//TODO: console.log isHtml to suppress 'unused var' warning
            throw new Error("GetTid/GetHTMLTid not yet implemented");
          }
        case ParsedPartType.Forevery:
          {
            if (!Array.isArray(wittyVar))
              throw new WittyErrorRec(part.lineNum, part.columnNum, 16, part.content);
            if (elt.foreveryEltLimit == -1) {
              elt.foreveryEltLimit = wittyVar.length;
              elt.foreveryEltNr = 0;
            } else
              ++elt.foreveryEltNr;

            if (elt.foreveryEltNr == elt.foreveryEltLimit) {
              elt.itr = part.cmdLimit;
              elt.foreveryEltNr = -1;
              elt.foreveryEltLimit = -1;
            } else {
              const el = wittyVar[elt.foreveryEltNr];
              this.smPush(false, elt.itr + 1, part.cmdLimit, wittyVar[elt.foreveryEltNr], false, typeof el != "object" ? part : undefined);
            }
          }
      }
    }
    return output;
  }

  smEmbed(): string {
    throw new Error("Embed not yet implemented");//TODO
  }

  smPrintCell(part: ParsedPart, elt: CallStackElement, wittyVar: unknown): string {
    switch (part.dataType) {
      case DataType.Seqnr:
        {
          const forevery = this.findForeveryInStack();
          if (!forevery)
            throw new WittyErrorRec(part.lineNum, part.columnNum, 17, "seqnr");
          return forevery.foreveryEltNr.toString();
        }
      case DataType.Cell:
        {
          if (part.encoding == ContentEncoding.Json || part.encoding == ContentEncoding.JsonValue) {
            const temp = encodeJSCompatibleJSON(wittyVar);
            if (part.encoding == ContentEncoding.Json)
              return this.printEncoded(temp, ContentEncoding.None);
            else
              return this.printEncoded(temp, ContentEncoding.Value);
          }
          switch (typeof wittyVar) {
            case "number":
              {
                return wittyVar.toString();
              }
            case "string":
              {
                return this.printEncoded(wittyVar, part.encoding);
              }
            //TODO: function ptr
            default:
              {
                throw new WittyErrorRec(part.lineNum, part.columnNum, 18, part.content, typeof wittyVar);
              }
          }
        }
      default:
        throw new Error("Unexpected datatype in data print statement");
    }
  }

  smEvaluateIf(part: ParsedPart, wittyVar: unknown): boolean {
    if (part.dataType == DataType.Cell) {
      if (Array.isArray(wittyVar))
        return wittyVar.length > 0;
      return Boolean(wittyVar);
    }
    const forevery = this.findForeveryInStack();
    switch (part.dataType) {
      case DataType.First:
        {
          if (!forevery)
            throw new WittyErrorRec(part.lineNum, part.columnNum, 17, "first");
          return forevery.foreveryEltNr == 0;
        }
      case DataType.Last:
        {
          if (!forevery)
            throw new WittyErrorRec(part.lineNum, part.columnNum, 17, "last");
          return forevery.foreveryEltNr == forevery.foreveryEltLimit - 1;
        }
      case DataType.Odd:
        {
          if (!forevery)
            throw new WittyErrorRec(part.lineNum, part.columnNum, 17, "odd");
          return forevery.foreveryEltNr % 2 == 1;
        }
      case DataType.Even:
        {
          if (!forevery)
            throw new WittyErrorRec(part.lineNum, part.columnNum, 17, "event");
          return forevery.foreveryEltNr % 2 == 0;
        }
      case DataType.Seqnr:
        {
          if (!forevery)
            throw new WittyErrorRec(part.lineNum, part.columnNum, 17, "seqnr");
          return forevery.foreveryEltNr != 0;
        }
    }
  }

  printEncoded(value: string, encoding: ContentEncoding) {
    switch (encoding) {
      case ContentEncoding.None:
        {
          return value;
        }
      case ContentEncoding.Html:
        {
          return encodeHTML(value);
        }
      case ContentEncoding.Value:
        {
          return encodeValue(value);
        }
      case ContentEncoding.CData:
        {
          return "<![CDATA[" + value.split("]]>").join("]]]]><![CDATA[>") + "]]>";
        }
    }
    return "";
  }

  findCellInStack(cellName: string) {
    const cellParts = cellName.split(".");
    let colVar;
    for (let i = this.varStack.length - 1; i >= 0 && colVar == undefined; --i) {
      const elem = this.varStack[i];
      if (cellParts.length == 1 && elem.foreveryNonRA != undefined) {
        const foreveryName = elem.foreveryNonRA.content.split(".").pop();
        if (foreveryName == cellName)
          colVar = elem.wittyVar;
      } else if (elem.wittyVar && typeof elem.wittyVar == "object" && !Array.isArray(elem))
        colVar = elem.wittyVar[cellParts[0] as keyof object];
    }
    cellParts.shift();
    while (colVar != undefined && cellParts.length) {
      if (typeof colVar != "object" || Array.isArray(colVar))
        return;
      colVar = colVar[cellParts[0] as keyof object];
      cellParts.shift();
    }
    return colVar;
  }

  findForeveryInStack(): CallStackElement | undefined {
    for (let i = this.callStack.length - 1; i >= 0; --i) {
      if (this.callStack[i].foreveryEltLimit != -1)
        return this.callStack[i];
    }
    return undefined;
  }
}
