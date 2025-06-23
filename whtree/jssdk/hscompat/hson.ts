import type { HSVMVar } from "@webhare/harescript/src/wasm-hsvmvar";
import { WebHareBlob } from "@webhare/services/src/webhareblob";
import { Money, isBlob, isDate, isTemporalInstant, isTemporalPlainDate, isTemporalPlainDateTime, isTemporalZonedDateTime } from "@webhare/std";
import { defaultDateTime, maxDateTime, maxDateTimeTotalMsecs } from "./datetime";

declare global {
  interface Object {
    [Marshaller]?: MarshallInfo;
  }
}

export const Marshaller = Symbol("Marshaller");

export interface MarshallInfo {
  type: HareScriptType;
  setValue?: (hsvmvar: HSVMVar) => void;
}

export type HSType<T extends HareScriptType> =
  T extends HareScriptType.Integer ? number :
  T extends HareScriptType.HSMoney ? Money :
  T extends HareScriptType.Float ? number :
  T extends HareScriptType.Boolean ? boolean :
  T extends HareScriptType.DateTime ? Date :
  T extends HareScriptType.Integer64 ? bigint :
  T extends HareScriptType.Record ? IPCMarshallableRecord :
  T extends HareScriptType.String ? string :
  T extends HareScriptType.Blob ? WebHareBlob :
  T extends HareScriptType.VariantArray ? IPCMarshallableData[] :
  T extends HareScriptType.IntegerArray ? Array<HSType<HareScriptType.Integer>> :
  T extends HareScriptType.MoneyArray ? Array<HSType<HareScriptType.HSMoney>> :
  T extends HareScriptType.FloatArray ? Array<HSType<HareScriptType.Float>> :
  T extends HareScriptType.BooleanArray ? Array<HSType<HareScriptType.Boolean>> :
  T extends HareScriptType.DateTimeArray ? Array<HSType<HareScriptType.DateTime>> :
  T extends HareScriptType.Integer64Array ? Array<HSType<HareScriptType.Integer64>> :
  T extends HareScriptType.FunctionPtrArray ? Array<HSType<HareScriptType.FunctionPtr>> :
  T extends HareScriptType.RecordArray ? Array<HSType<HareScriptType.Record>> :
  T extends HareScriptType.StringArray ? Array<HSType<HareScriptType.String>> :
  T extends HareScriptType.BlobArray ? Array<HSType<HareScriptType.Blob>> :
  never;

export function getDefaultValue<T extends HareScriptType>(type: T): HSType<T> {
  switch (type) {
    case HareScriptType.Integer: { return 0 as HSType<T>; }
    case HareScriptType.HSMoney: { return new Money("0") as HSType<T>; }
    case HareScriptType.Float: { return 0 as HSType<T>; }
    case HareScriptType.Boolean: { return false as HSType<T>; }
    case HareScriptType.DateTime: { return defaultDateTime as HSType<T>; }
    case HareScriptType.Integer64: { return BigInt(0) as HSType<T>; }
    case HareScriptType.Record: { return null as HSType<T>; }
    case HareScriptType.String: { return "" as HSType<T>; }
    case HareScriptType.Blob: { return WebHareBlob.from("") as HSType<T>; }
    case HareScriptType.VariantArray:
    case HareScriptType.IntegerArray:
    case HareScriptType.MoneyArray:
    case HareScriptType.FloatArray:
    case HareScriptType.BooleanArray:
    case HareScriptType.DateTimeArray:
    case HareScriptType.Integer64Array:
    case HareScriptType.RecordArray:
    case HareScriptType.StringArray:
    case HareScriptType.ObjectArray:
    case HareScriptType.BlobArray:
    case HareScriptType.WeakObjectArray:
    case HareScriptType.FunctionPtrArray:
    case HareScriptType.TableArray: {
      return setHareScriptType([] as HSType<T>, type);
    }
    default:
      throw new Error(`Cannot generate default value for type ${HareScriptType[type] ?? type}`);
  }
}

export function unifyEltTypes(a: HareScriptType, b: HareScriptType): HareScriptType {
  if (a === b || a === HareScriptType.Variant)
    return a;
  if (b === HareScriptType.Variant)
    return b;
  if (a === HareScriptType.Integer && (b === HareScriptType.Float || b === HareScriptType.HSMoney || b === HareScriptType.Integer64))
    return b;
  if ((a === HareScriptType.Float || a === HareScriptType.HSMoney || a === HareScriptType.Integer64) && b === HareScriptType.Integer)
    return a;
  if (a === HareScriptType.Float && (b === HareScriptType.HSMoney || b === HareScriptType.Integer64))
    return a;
  if ((a === HareScriptType.HSMoney || a === HareScriptType.Integer64) && b === HareScriptType.Float)
    return b;
  return HareScriptType.Variant;
}

/** Set a HareScript type on an object
 * @param variable - The object to set the type on
 * @param type - The type to set
 * @returns The `variable` parameter (to allow chaining)
*/
export function setHareScriptType<T>(variable: T, type: HareScriptType): T {
  if (Array.isArray(variable)) {
    if (type < 0x80) //see system.whlib IsTypeidArray
      throw new Error(`Cannot set a non-array type on an array`);
  } else {
    if (type >= 0x80)
      throw new Error(`Cannot set an array type on an non-array`);
  }

  Object.defineProperty(variable, Marshaller, { value: { type }, enumerable: false, configurable: true });
  return variable;
}

/* TODO we may need to support WHDBBlob too - encodeHSON and IPC only currently require that they can transfer the data without await */
export type IPCMarshallableData = boolean | null | string | number | bigint | Date | Money | ArrayBuffer | Uint8Array | WebHareBlob | { [key in string]: IPCMarshallableData } | IPCMarshallableData[];
export type IPCMarshallableRecord = null | { [key in string]: IPCMarshallableData };

export enum HareScriptType {
  Uninitialized = 0x00,                 ///< Not initialised variable
  Variant = 0x01,
  Integer = 0x10,
  HSMoney = 0x11,
  Float = 0x12,
  Boolean = 0x13,
  DateTime = 0x14,
  Table = 0x15,
  Schema = 0x16,
  Integer64 = 0x17,
  FunctionPtr = 0x20,                   // FunctionPtr in hsvm_constants.h
  Record = 0x21,
  String = 0x22,
  Object = 0x23,
  WeakObject = 0x24,
  Blob = 0x40,
  Array = 0x80,
  VariantArray = 0x81,
  IntegerArray = 0x90,
  MoneyArray = 0x91,
  FloatArray = 0x92,
  BooleanArray = 0x93,
  DateTimeArray = 0x94,
  TableArray = 0x95,
  Integer64Array = 0x97,
  FunctionPtrArray = 0xa0,
  RecordArray = 0xa1,
  StringArray = 0xa2,
  ObjectArray = 0xa3,
  WeakObjectArray = 0xa4,
  BlobArray = 0xc0,
}

export function determineType(value: unknown): HareScriptType {
  if (value?.[Marshaller])
    return value[Marshaller].type;
  if (Array.isArray(value)) {
    if (value.length === 0)
      return HareScriptType.VariantArray;
    let elttype = determineType(value[0]);
    for (let i = 1; i < value.length; ++i) {
      elttype = unifyEltTypes(elttype, determineType(value[i]));
    }
    if (elttype & HareScriptType.Array)
      return HareScriptType.VariantArray;
    return elttype | HareScriptType.Array;
  }
  switch (typeof value) {
    case "object": {
      if (WebHareBlob.isWebHareBlob(value)) //TODO we can only take sync-readable blobs so we can't support 'Blob'
        return HareScriptType.Blob;
      if (isBlob(value))
        throw new Error(`Cannot transfer blob of type '${value.constructor.name}' from/to a HSVM - use WebHareMemoryBlob or WebHareDiskBlob instead`);
      if (value instanceof Uint8Array || value instanceof ArrayBuffer || value instanceof Buffer)
        return HareScriptType.String;
      if (Money.isMoney(value))
        return HareScriptType.HSMoney;
      if (isDate(value) || isTemporalInstant(value) || isTemporalPlainDateTime(value) || isTemporalPlainDate(value) || isTemporalZonedDateTime(value))
        return HareScriptType.DateTime;

      return HareScriptType.Record;
    }
    case "bigint": {
      return HareScriptType.Integer64;
    }
    case "boolean": {
      return HareScriptType.Boolean;
    }
    case "string": {
      return HareScriptType.String;
    }
    case "number": {
      if (value === Math.floor(value)) {
        if (value >= -2147483648 && value < 2147483648)
          return HareScriptType.Integer;
        if (Number.isSafeInteger(value))
          return HareScriptType.Integer64;
      }
      return HareScriptType.Float;
    }
    case "undefined": //treat as 'null'
      return HareScriptType.Record;
    default: {
      throw new Error(`Cannot send variable of type ${JSON.stringify(typeof value)}`);
    }
  }
}


export function encodeHSON(value: IPCMarshallableData): string {
  return "hson:" + encodeHSONInternal(value);
}

function encodeHSONInternal(value: IPCMarshallableData, needtype?: HareScriptType): string {
  let type = determineType(value);
  if (needtype !== undefined && type !== needtype) {
    if (unifyEltTypes(type, needtype) !== needtype)
      throw new Error(`Cannot store an ${HareScriptType[type] ?? type} in an array for ${HareScriptType[needtype] ?? needtype}`);
    type = needtype;
  }

  let retval = "";
  switch (type) {
    case HareScriptType.VariantArray: retval = "va["; break;
    case HareScriptType.BooleanArray: retval = "ba["; break;
    case HareScriptType.DateTimeArray: retval = "da["; break;
    case HareScriptType.MoneyArray: retval = "ma["; break;
    case HareScriptType.FloatArray: retval = "fa["; break;
    case HareScriptType.StringArray: retval = "sa["; break;
    case HareScriptType.BlobArray: retval = "xa["; break;
    case HareScriptType.Integer64Array: retval = "i64a["; break;
    case HareScriptType.IntegerArray: retval = "ia["; break;
    case HareScriptType.RecordArray: retval = "ra["; break;
    case HareScriptType.ObjectArray: retval = "oa["; break;

    case HareScriptType.Boolean: retval = value ? "true" : "false"; break;
    case HareScriptType.DateTime: {
      const dt = value as Date;
      const totalmsecs = Number(dt);

      let daysvalue = Math.floor(totalmsecs / 86400000);
      const msecsvalue = totalmsecs - daysvalue * 86400000;
      daysvalue += 719163; // 1970-1-1

      if (totalmsecs >= maxDateTimeTotalMsecs) {
        retval = `d"MAX"`;
      } else if (daysvalue === 0 && msecsvalue === 0 || daysvalue < 0 || msecsvalue < 0) {
        retval = `d""`;
      } else if (daysvalue === 0) {
        retval = `d"T${msecsvalue}"`;
      } else {
        const year = String(dt.getUTCFullYear()).padStart(4, "0");
        const month = String(dt.getUTCMonth() + 1).padStart(2, "0");
        const day = String(dt.getUTCDate()).padStart(2, "0");
        const hours = String(dt.getUTCHours()).padStart(2, "0");
        retval = `d"${year}${month}${day}`;
        if (msecsvalue) {
          const minutes = String(dt.getUTCMinutes()).padStart(2, "0");
          const seconds = String(dt.getUTCSeconds()).padStart(2, "0");
          const mseconds = String(dt.getUTCMilliseconds()).padStart(3, "0");
          retval = retval + `T${hours}${minutes}${seconds}${mseconds !== "000" ? `.${mseconds}` : ""}"`;
        } else
          retval = retval + `"`;
      }
    } break;
    case HareScriptType.Float: {
      if (typeof value === "object") {
        if (Money.isMoney(value))
          retval = "f " + (value as Money).value;
        else
          throw new Error(`Unknown object to encode as float`);
      } else if (!isFinite(value as number))
        throw new Error(`Cannot encode non-finite value '${value}' in HSON`);
      else
        retval = "f " + (value as number).toString().replace('+', ''); //format 1e+308 as 1e308
    } break;
    case HareScriptType.String:
      if (typeof value === "string") { //FIXME this might break if the encodeHSON-ed value is then eg hashed .. as JSON stringify may not have the exact same escaping as HS encodeHSON would do!
        retval = JSON.stringify(value);
        break;
      }
      //FIXME should definitely use EncodeHSON style - binary is a hint that this data is not UTF8 safe.
      retval = JSON.stringify((value as Buffer).toString()).replaceAll("\\u0000", "\\x00");
      break;
    case HareScriptType.Blob: {
      if (!(value as WebHareBlob).size) {
        retval = `b""`;
        break;
      }

      const data = (value as WebHareBlob).__getAsSyncUInt8Array();
      retval = `b"` + Buffer.from(data).toString("base64") + `"`; //FIXME avoid this buffer copy
    } break;
    case HareScriptType.Integer64: retval = "i64 " + (value as number | bigint).toString(); break;
    case HareScriptType.Integer: retval = (value as number).toString(); break;
    case HareScriptType.HSMoney: {
      if (typeof value === "object") {
        if (!Money.isMoney(value))
          throw new Error(`Unknown object to encode as money`);
        retval = "m " + (value as Money).format({ minDecimals: 0 });
      } else
        retval = "m " + value.toString();
    } break;
    case HareScriptType.Record: {
      const recval = value as IPCMarshallableRecord;
      if (!recval)
        retval = "*";
      else {
        retval = "{";
        let first = true;
        for (const [key, propval] of Object.entries(recval).sort(([a], [b]) => a === b ? 0 : a < b ? -1 : 1)) {
          if (propval === undefined)
            continue;
          if (!first)
            retval = retval + ",";
          else
            first = false;
          retval = retval + JSON.stringify(key.toLowerCase()) + ":" + encodeHSONInternal(propval);
        }
        retval = retval + "}";
      }
    } break;

    default:
      throw new Error(`Cannot encode type ${HareScriptType[type] ?? type}`);
  }
  if (type & HareScriptType.Array) {
    const itemtype = type !== HareScriptType.VariantArray ? type & ~HareScriptType.Array : undefined;

    let first = true;
    for (const item of value as IPCMarshallableData[]) {
      if (!first)
        retval = retval + ",";
      else
        first = false;
      retval = retval + encodeHSONInternal(item, itemtype);
    }
    return retval + "]";
  }
  return retval;
}

////////////////////////////////////////////////
// JSONParser (ported from C++. only used for HSON parsing)

type LevelParentVar = { [K in number | string]: unknown };


class Level {
  parent: LevelParentVar;
  key: string | number;
  lastarrayelt: unknown;
  restorestate: ParseState;
  arrayelttype: HareScriptType;

  constructor(parent: LevelParentVar, key: string | number, restorestate: ParseState) {
    this.parent = parent;
    this.key = key;
    this.restorestate = restorestate;
    this.lastarrayelt = null;
    this.arrayelttype = HareScriptType.Uninitialized;
  }
}


enum TokenState {
  TS_Initial, // Allow BOM
  TS_Default,
  TS_LongToken,
  TS_QString,
  TS_QStringEsc,
  TS_DQString,
  TS_DQStringEsc,
  TS_NumberPrefix,
  TS_Number,
  TS_Error,
  TS_CommentStart,
  TS_LineComment,
  TS_BlockComment,
  TS_BlockCommentEnd
}

enum TokenType {
  JTT_SpecialToken,
  JTT_Token,
  JTT_String,
  JTT_Number
}

enum ParseState {
  PS_RootValue,
  PS_ObjectWantName,
  PS_ObjectWantColon,
  PS_ObjectWantValue,
  PS_ObjectWantComma,
  PS_ArrayWantValue,
  PS_ArrayWantComma,
  PS_Finished,
  PS_Error,

  PS_HSONStart,
  PS_HSONStartColon,
  PS_HSONWantArray,
  PS_HSONWantTypedValue
}



class JSONParser {
  /// Tokenizer state
  state = TokenState.TS_Default;
  comment_after_numberprefix = false;

  /// Current token
  currenttoken = "";

  /// Current parse state
  parsestate = ParseState.PS_HSONStart;

  /// State before hson type specifier
  hsonrestorestate = ParseState.PS_HSONStart;
  lastname = "";
  lasttype = HareScriptType.Uninitialized;

  root: { value?: IPCMarshallableData } = {};
  levels: Level[] = [];

  hson = true;
  allowcomments = false;

  line = 1;
  column = 1;
  errorline = 1;
  errorcolumn = 1;
  errormessage = "";


  constructor() {
    this.currenttoken = "";
    this.levels.push(new Level(this.root, "value", ParseState.PS_Error));
  }

  handleChar(val: string): boolean {
    if (val === "\n") {
      ++this.line;
      this.column = 1;
    } else
      ++this.column;

    const is_whitespace = val === " " || val === "\r" || val === "\n" || val === "\t";
    const is_tokenchar = val === "{" || val === "}" || val === "[" || val === "]" || val === ":" || val === ",";
    const is_specialchar = val === "'" || val === "\"" || val === "-" || val === "+" || val === ".";
    const is_comment = this.allowcomments && val === '/';

    // First process tokens that are terminated by a token outside their class (that still needs to be processed afterwards)

    if (this.state === TokenState.TS_LongToken) {
      // long token ends by whitespace or tokenchar or specialchar
      if (is_whitespace || is_tokenchar || is_specialchar || is_comment) {
        // Process the long token
        if (!this.handleToken(this.currenttoken, TokenType.JTT_Token))
          return false;
        // Continue to process the current character too
        this.state = TokenState.TS_Default;
      } else {
        // Add character to current token
        this.currenttoken = this.currenttoken + val;
        return true;
      }
    }

    if (this.state === TokenState.TS_Number || this.state === TokenState.TS_NumberPrefix) {
      // Number ends with whitespace after first non-prefix character ('+'/'-')
      if (is_tokenchar) {
        // Token character, ends number. Process the number
        if (!this.handleToken(this.currenttoken, TokenType.JTT_Number)) {
          this.state = TokenState.TS_Error;
          return false;
        }

        // Continue to process the current character too
        this.state = TokenState.TS_Default;
      } else {
        if (this.state === TokenState.TS_NumberPrefix) {
          // Only seen prefixes, skip whitespace
          if (is_comment) {
            this.comment_after_numberprefix = true;
            this.state = TokenState.TS_CommentStart;
            return true;
          }
          if (!is_whitespace) {
            // Check if other than prefix
            if (val !== '+' && val !== '-') {
              this.state = TokenState.TS_Number;
              this.comment_after_numberprefix = false;
            }

            // Add to token
            this.currenttoken = this.currenttoken + val;
            return true;
          }
        } else if (is_whitespace || is_comment) {
          // Whitespace or comment, ends the number
          if (!this.handleToken(this.currenttoken, TokenType.JTT_Number)) {
            this.state = TokenState.TS_Error;
            return false;
          }

          // Continue to process the current character too
          this.state = TokenState.TS_Default;
        } else {
          // Add to token (this adds also non-number charactes, but don't care now)
          this.currenttoken = this.currenttoken + val;
          return true;
        }
      }
    }

    if (this.state === TokenState.TS_CommentStart) {
      if (val === '/')
        this.state = TokenState.TS_LineComment;
      else if (val === '*')
        this.state = TokenState.TS_BlockComment;
      else {
        this.errormessage = "Unexpected character '" + this.currenttoken + "' encountered, expected '/' or '*'";
        this.errorline = this.line;
        this.errorcolumn = this.column - 1;
        this.state = TokenState.TS_Error;
        return false;
      }
      return true;
    }
    if (this.state === TokenState.TS_LineComment) {
      if (val === '\n')
        this.state = this.comment_after_numberprefix ? TokenState.TS_NumberPrefix : TokenState.TS_Default;
      return true;
    }
    if (this.state === TokenState.TS_BlockComment) {
      if (val === '*')
        this.state = TokenState.TS_BlockCommentEnd;
      return true;
    }
    if (this.state === TokenState.TS_BlockCommentEnd) {
      if (val === '/')
        this.state = this.comment_after_numberprefix ? TokenState.TS_NumberPrefix : TokenState.TS_Default;
      else if (val !== '*')
        this.state = TokenState.TS_BlockComment;
      return true;
    }

    if (this.state === TokenState.TS_Default || this.state === TokenState.TS_Initial) {
      // Set start of current token
      this.errorline = this.line;
      this.errorcolumn = this.column - 1;

      // Ignore whitespace
      if (is_whitespace)
        return true;

      if (is_comment) {
        this.state = TokenState.TS_CommentStart;
        return true;
      }

      this.currenttoken = "";
      if (is_tokenchar) {
        // token character, process immediately
        this.currenttoken = this.currenttoken + val;
        if (!this.handleToken(this.currenttoken, TokenType.JTT_SpecialToken)) {
          this.state = TokenState.TS_Error;
          return false;
        }
        return true;
      }
      // Detect strings. No need to add them to token, they are decoded immediately
      if (val === '"') {
        this.state = TokenState.TS_DQString;
        return true;
      }
      if (val === '\'') {
        this.state = TokenState.TS_QString;
        return true;
      }
      // Detect number
      if (val === '+' || val === '-') {
        this.currenttoken = this.currenttoken + val;
        this.state = TokenState.TS_NumberPrefix;
        return true;
      }
      if ((val >= '0' && val <= '9') || val === '.') {
        this.currenttoken = this.currenttoken + val;
        this.state = TokenState.TS_Number;
        return true;
      }

      // No special char, string or number, tread as long token
      this.currenttoken = this.currenttoken + val;
      this.state = TokenState.TS_LongToken;
      return true;
    }

    if (this.state === TokenState.TS_DQString || this.state === TokenState.TS_QString) {
      // End of string?
      if (val === (this.state === TokenState.TS_DQString ? '"' : '\'')) {
        // FIXME: also try to parse `/x`!!  need to use HS compatible decoding
        this.currenttoken = JSON.parse(val + this.currenttoken + val);
        //std::string currentstring;
        //std:: swap(currentstring, currenttoken);
        //Blex:: DecodeJava(currentstring.begin(), currentstring.end(), std:: back_inserter(this.currenttoken));
        this.state = TokenState.TS_Default;
        if (!this.handleToken(this.currenttoken, TokenType.JTT_String)) {
          this.state = TokenState.TS_Error;
          return false;
        }
        return true;
      } else if (val === '\\') { // String escape?
        this.currenttoken = this.currenttoken + val;
        this.state = this.state === TokenState.TS_DQString ? TokenState.TS_DQStringEsc : TokenState.TS_QStringEsc;
      } else if (val < ' ' && val !== '\t') {
        // Found a control character in a string, do not like that
        this.errormessage = "Control characters not allowed in strings";
        this.errorline = this.line;
        this.errorcolumn = this.column - 1;
        this.state = TokenState.TS_Error;
        return false;
      } else
        this.currenttoken = this.currenttoken + val;
      return true;
    }

    if (this.state === TokenState.TS_DQStringEsc || this.state === TokenState.TS_QStringEsc) {
      this.currenttoken = this.currenttoken + val;
      this.state = this.state === TokenState.TS_DQStringEsc ? TokenState.TS_DQString : TokenState.TS_QString;
      return true;
    }

    if (this.state !== TokenState.TS_Error) {
      this.currenttoken = "";
      this.currenttoken = this.currenttoken + val;
      this.errormessage = "Unexpected character '" + this.currenttoken + "' encountered";
      this.errorline = this.line;
      this.errorcolumn = this.column - 1;
      this.state = TokenState.TS_Error;
    }

    // INV: state = TokenState.TS_Error
    return false;
  }

  finish(): {
    success: boolean;
    msg: string;
    value: IPCMarshallableData;
  } {
    if (this.state === TokenState.TS_LongToken) {
      this.handleToken(this.currenttoken, TokenType.JTT_Token);
      this.state = TokenState.TS_Default;
    }
    if (this.state === TokenState.TS_Number) {
      this.handleToken(this.currenttoken, TokenType.JTT_Number);
      this.state = TokenState.TS_Default;
    }
    if (this.state !== TokenState.TS_Default && this.state !== TokenState.TS_Error) {
      this.errorline = this.line;
      this.errorcolumn = this.column;
      this.errormessage = "JSON token not complete";
      this.state = TokenState.TS_Error;
    } else if (this.parsestate !== ParseState.PS_Finished) {
      this.errorline = this.line;
      this.errorcolumn = this.column;
      switch (this.parsestate) {
        case ParseState.PS_Error: break;
        case ParseState.PS_ObjectWantName:
          {
            this.errormessage = "Expected a cellname";
          } break;
        case ParseState.PS_ObjectWantColon:
        case ParseState.PS_HSONStartColon:
          {
            this.errormessage = "Expected a ':'";
          } break;
        case ParseState.PS_ObjectWantComma:
          {
            this.errormessage = "Expected a ',' or a '}'";
          } break;
        case ParseState.PS_ArrayWantComma:
          {
            this.errormessage = "Expected a ',' or a ']'";
          } break;
        case ParseState.PS_RootValue:
        case ParseState.PS_ArrayWantValue:
        case ParseState.PS_ObjectWantValue:
        case ParseState.PS_HSONStart:
        case ParseState.PS_HSONWantArray:
        case ParseState.PS_HSONWantTypedValue:
          {
            this.errormessage = "Expected a value";
          } break;

        default:
          this.errormessage = "Internal error";
        // fallthrough
      }
      this.state = TokenState.TS_Error;
    }

    return {
      success: this.state !== TokenState.TS_Error,
      msg: this.errormessage ? `At :${this.errorline}:${this.errorcolumn}: ${this.errormessage}` : "",
      value: this.state === TokenState.TS_Error
        ? getDefaultValue(HareScriptType.Record)
        : this.root.value ?? getDefaultValue(HareScriptType.Record)
    };
  }

  handleToken(token: string, tokentype: TokenType): boolean {
    /* value ::= object | array | number | string | boolean | null

       object ::= '{' 1( ps_object_wantname string ps_object_wantcolon ':' ps_object_wantvalue value ps_object_wantcomma ( , \1 )? ) '}'
       array ::= [ 1( ps_array_wantvalue value ps_array_wantcomma ( , \1 )? ) ]
    */

    switch (this.parsestate) {
      case ParseState.PS_HSONStart: {
        if (tokentype !== TokenType.JTT_Token || (token !== "hson" && token !== "json")) {
          this.errormessage = "Unrecognized data format";
          this.parsestate = ParseState.PS_Error;
          return false;
        }

        // Switch back to legacy JSON if starts with 'json:'
        if (token === "json")
          this.hson = false;

        this.parsestate = ParseState.PS_HSONStartColon;
        return true;
      }
      case ParseState.PS_HSONStartColon: {
        if (tokentype !== TokenType.JTT_SpecialToken || token[0] !== ':') {
          this.errormessage = "Expected a ':'";
          this.parsestate = ParseState.PS_Error;
          return false;
        }
        this.parsestate = ParseState.PS_RootValue;
        return true;
      }
      case ParseState.PS_ObjectWantName:
        {
          // End of object (this handles empty objects and extra ',' after last member)
          if (tokentype === TokenType.JTT_SpecialToken && token[0] === '}') {

            this.parsestate = this.levels.pop()?.restorestate ?? ParseState.PS_Error;
            return true;
          }

          if ((tokentype !== TokenType.JTT_String && tokentype !== TokenType.JTT_Token)) {
            this.errormessage = "Expected a cellname";
            this.parsestate = ParseState.PS_Error;
            return false;
          }
          this.lastname = token;
          this.parsestate = ParseState.PS_ObjectWantColon;
          return true;
        }
      case ParseState.PS_ObjectWantColon:
        {
          if (tokentype !== TokenType.JTT_SpecialToken || token[0] !== ':') {
            this.errormessage = "Expected a ':'";
            this.parsestate = ParseState.PS_Error;
            return false;
          }
          this.parsestate = ParseState.PS_ObjectWantValue;
          return true;
        }
      case ParseState.PS_ObjectWantComma:
        {
          if (tokentype !== TokenType.JTT_SpecialToken || (token[0] !== ',' && token[0] !== '}')) {
            this.errormessage = "Expected a ',' or a '}'";
            this.parsestate = ParseState.PS_Error;
            return false;
          }
          if (token[0] === ',') {
            this.parsestate = ParseState.PS_ObjectWantName;
          } else {
            this.parsestate = this.levels.pop()?.restorestate ?? ParseState.PS_Error;
          }
          return true;
        }
      case ParseState.PS_ArrayWantComma:
        {
          if (tokentype !== TokenType.JTT_SpecialToken || (token[0] !== ',' && token[0] !== ']')) {
            this.errormessage = "Expected a ',' or a ']'";
            this.parsestate = ParseState.PS_Error;
            return false;
          }
          if (token[0] === ',') {
            this.parsestate = ParseState.PS_ArrayWantValue;
          } else {
            /*
                                                   // Convert arrays that are all integers, strings or records to their equivalent XXXArray
                                                   HSVM_VariableType type = this.levels[this.levels.length - 1].arrayelttype;
                        if (type === VariableType.IntegerArray || type === VariableType.StringArray || type === VariableType.RecordArray)
                          GetVirtualMachine(vm) -> stackmachine.ForcedCastTo(this.levels[this.levels.length - 1].var, static_cast < VariableTypes:: Type > (type));
            */
            this.parsestate = this.levels.pop()?.restorestate ?? ParseState.PS_Error;
          }
          return true;
        }
      case ParseState.PS_HSONWantArray:
        {
          if (tokentype !== TokenType.JTT_SpecialToken || token[0] !== '[') { // new array
            this.errormessage = "Expected array start token '[']";
            this.parsestate = ParseState.PS_Error;
            return false;
          }

          this.parsestate = ParseState.PS_ArrayWantValue;
          return true;
        }
      case ParseState.PS_ArrayWantValue:
        {
          if (tokentype === TokenType.JTT_SpecialToken && token[0] === ']') {
            /*
                                                   // Convert arrays that are all integers, strings or records to their equivalent XXXArray
                                                   HSVM_VariableType type = this.levels[this.levels.length - 1].arrayelttype;
                        if (type === VariableType.IntegerArray || type === VariableType.StringArray || type === VariableType.RecordArray)
                          GetVirtualMachine(vm) -> stackmachine.ForcedCastTo(this.levels[this.levels.length - 1].var, static_cast < VariableTypes:: Type > (type));
            */
            this.parsestate = this.levels.pop()?.restorestate ?? ParseState.PS_Error;
            return true;
          }
        }
      // Fallthrough
      case ParseState.PS_RootValue:
      case ParseState.PS_ObjectWantValue:
      case ParseState.PS_HSONWantTypedValue:
        {
          let parent: LevelParentVar;
          let key: string | number;
          let restorestate: ParseState;

          const is_hsontypedvalue = this.parsestate === ParseState.PS_HSONWantTypedValue;
          if (is_hsontypedvalue)
            this.parsestate = this.hsonrestorestate;

          switch (this.parsestate) {
            case ParseState.PS_RootValue:
              {
                parent = this.root;
                key = "value";
                //target = this.levels[this.levels.length - 1].variable;
                restorestate = ParseState.PS_Finished;
              } break;
            case ParseState.PS_ArrayWantValue:
              {
                const level = this.levels[this.levels.length - 1];
                parent = level.parent[level.key] as LevelParentVar;
                if (!is_hsontypedvalue) {
                  (parent as unknown as unknown[]).push(null);
                }
                key = (parent as unknown as []).length - 1;
                restorestate = ParseState.PS_ArrayWantComma;
              } break;
            case ParseState.PS_ObjectWantValue: {
              const level = this.levels[this.levels.length - 1];
              parent = level.parent[level.key] as LevelParentVar;
              key = this.lastname;

              restorestate = ParseState.PS_ObjectWantComma;
            } break;
            default:
              throw new Error("Unhandled parserstate #1");
          }
          /*
                    if (!target) {
                      this.errormessage = "Internal error - don't have a target variable available";
                      this.parsestate = ParseState.PS_Error;
                      return false;
                    }
          */
          if (is_hsontypedvalue) {
            if (!this.parseHSONTypedValue(parent, key, token, tokentype)) {
              parent[key] = false;
              return false;
            }

            this.parsestate = restorestate;
            return true;
          }

          if (tokentype === TokenType.JTT_SpecialToken) {
            if (token[0] === '{') { // new object
              if (this.levels[this.levels.length - 1].arrayelttype === 0)
                this.levels[this.levels.length - 1].arrayelttype = HareScriptType.RecordArray;
              else if (this.levels[this.levels.length - 1].arrayelttype !== HareScriptType.RecordArray)
                this.levels[this.levels.length - 1].arrayelttype = HareScriptType.VariantArray;
              this.levels.push(new Level(parent, key, restorestate));

              if (this.levels.length >= 2048) {
                this.errormessage = `Too many levels of recursion (${this.levels.length})`;
                this.parsestate = ParseState.PS_Error;
                return false;
              }

              parent[key] = {};
              this.parsestate = ParseState.PS_ObjectWantName;
              return true;
            } else if (token[0] === '[') { // new array
              if (this.hson) {
                this.errormessage = "Expected HSON type before '[' token";
                this.parsestate = ParseState.PS_Error;
                return false;
              }

              this.levels[this.levels.length - 1].arrayelttype = HareScriptType.VariantArray;
              this.levels.push(new Level(parent, key, restorestate));

              if (this.levels.length >= 2048) {
                this.errormessage = `Too many levels of recursion (${this.levels.length})`;
                this.parsestate = ParseState.PS_Error;
                return false;
              }

              parent[key] = getDefaultValue(HareScriptType.VariantArray);
              this.parsestate = ParseState.PS_ArrayWantValue;
              return true;
            } else {
              this.errormessage = "Unexpected character encountered";
              this.parsestate = ParseState.PS_Error;
              return false;
            }
          }

          if (this.hson && tokentype === TokenType.JTT_Token) { // Either type specifier, '*', 'true' or 'false'
            if (token.length === 1) {
              switch (token[0]) {
                case 'm': this.lasttype = HareScriptType.HSMoney; break;
                case 'f': this.lasttype = HareScriptType.Float; break;
                case 'd': this.lasttype = HareScriptType.DateTime; break;
                case 'b': this.lasttype = HareScriptType.Blob; break;
                case 'o': this.lasttype = HareScriptType.Object; break;
                case 'w': this.lasttype = HareScriptType.WeakObject; break;
                case 'p': this.lasttype = HareScriptType.FunctionPtr; break;
                case '*':
                  {
                    parent[key] = null;
                    this.parsestate = restorestate;
                    return true;
                  }
                default: {
                  this.errormessage = "Illegal variable type encoding '" + token + "'";
                  this.parsestate = ParseState.PS_Error;
                  return false;
                }
              }

              this.hsonrestorestate = this.parsestate;
              this.parsestate = ParseState.PS_HSONWantTypedValue;
              return true;
            } else if (token.length === 2) {
              if (token[1] !== 'a') {
                this.errormessage = "Illegal variable type encoding '" + token + "'";
                this.parsestate = ParseState.PS_Error;
                return false;
              }

              switch (token[0]) {
                case 'v': this.lasttype = HareScriptType.VariantArray; break;
                case 'b': this.lasttype = HareScriptType.BooleanArray; break;
                case 'd': this.lasttype = HareScriptType.DateTimeArray; break;
                case 'm': this.lasttype = HareScriptType.MoneyArray; break;
                case 'f': this.lasttype = HareScriptType.FloatArray; break;
                case 's': this.lasttype = HareScriptType.StringArray; break;
                case 'x': this.lasttype = HareScriptType.BlobArray; break;
                case 'i': this.lasttype = HareScriptType.IntegerArray; break;
                case 'r': this.lasttype = HareScriptType.RecordArray; break;
                case 'o': this.lasttype = HareScriptType.ObjectArray; break;
                case 'w': this.lasttype = HareScriptType.WeakObjectArray; break;
                case 'p': this.lasttype = HareScriptType.FunctionPtrArray; break;
                default: {
                  this.errormessage = "Illegal variable type encoding '" + token + "'";
                  this.parsestate = ParseState.PS_Error;
                  return false;
                }
              }

              this.levels[this.levels.length - 1].arrayelttype = HareScriptType.VariantArray;
              this.levels.push(new Level(parent, key, restorestate));
              this.levels[this.levels.length - 1].arrayelttype = this.lasttype;

              if (this.levels.length >= 2048) {
                this.errormessage = `Too many levels of recursion (${this.levels.length})`;
                this.parsestate = ParseState.PS_Error;
                return false;
              }

              parent[key] = getDefaultValue(this.lasttype);
              this.parsestate = ParseState.PS_HSONWantArray;
              return true;
            } else if (token === "i64" || token === "i64a") {
              const is_array = token.length === 4;
              if (!is_array)
                this.hsonrestorestate = this.parsestate;
              else {
                this.levels[this.levels.length - 1].arrayelttype = HareScriptType.Integer64Array;
                this.levels.push(new Level(parent, key, restorestate));

                if (this.levels.length >= 2048) {
                  this.errormessage = `Too many levels of recursion (${this.levels.length})`;
                  this.parsestate = ParseState.PS_Error;
                  return false;
                }

                parent[key] = getDefaultValue(HareScriptType.Integer64Array);
              }

              this.lasttype = is_array ? HareScriptType.Integer64Array : HareScriptType.Integer64;
              this.parsestate = is_array ? ParseState.PS_HSONWantArray : ParseState.PS_HSONWantTypedValue;
              return true;
            }
          }

          if (!this.parseSimpleValue(parent, key, token, tokentype)) {
            parent[key] = false;
            return false;
          }

          /*
          const type: VariableType = HSVM_GetType(vm, target) | VariableType.Array;
          if (this.levels[this.levels.length - 1].arrayelttype === 0)
            this.levels[this.levels.length - 1].arrayelttype = type;
          else if (this.levels[this.levels.length - 1].arrayelttype !== type)
            this.levels[this.levels.length - 1].arrayelttype = VariableType.VariantArray;
          */

          this.parsestate = restorestate;
          return true;
        }
      case ParseState.PS_Finished:
        {
          this.errormessage = "Extra character encountered";
          this.parsestate = ParseState.PS_Error;
          return false;
        }
      default: break;
      // Fallthrough
    }
    return false;

  }

  parseSimpleValue(parent: LevelParentVar, key: string | number, token: string, tokentype: TokenType): boolean {
    switch (tokentype) {
      case TokenType.JTT_String: {
        parent[key] = token;
        return true;
      }
      case TokenType.JTT_Token: {
        if (token === "null" && !this.hson) {
          parent[key] = getDefaultValue(HareScriptType.Record);
          return true;
        }
        if (token === "false") {
          parent[key] = false;
          return true;
        }
        if (token === "true") {
          parent[key] = true;
          return true;
        }

        this.errormessage = "Unexpected token '" + token + "'";
        this.parsestate = ParseState.PS_Error;
        return false;
      }

      case TokenType.JTT_Number:
        {
          // Don't check value, just return as string
          parent[key] = Number(token);
          /*
                                bool negate = false;

                    Blex::DecimalFloat value;
                    const char * data = token.c_str();
                    const char * limit = data + token.size();

                    while (* data === '+' || * data === '-') {
                      negate = negate ^ (* data === '-');
                      ++data;
                    }

                                char postfix = ' ';
                    const char * finish = limit;
                    Blex:: DecimalFloat::ParseResult res = value.ParseNumberString(data, limit, & postfix, & finish);
                    if (negate)
                      value.Negate();

                    if (finish !== limit) {
                      errormessage = "Illegal integer constant '" + token + "'";
                      parsestate = PS_Error;
                      return false;
                    }
                    switch (res) {
                      case Blex:: DecimalFloat:: PR_Error_IllegalIntegerConstant:
                        {
                          errormessage = "Illegal integer constant '" + token + "'";
                          parsestate = PS_Error;
                          return false;
                        }
                      case Blex:: DecimalFloat:: PR_Error_ExpectedReal:
                        {
                          errormessage = "Expected a real value, got '" + token + "'";
                          parsestate = PS_Error;
                          return false;
                        }
                      case Blex:: DecimalFloat:: PR_Error_IllegalExponent:
                        {
                          errormessage = "Expected a valid float exponent value, got '" + token + "'";
                          parsestate = PS_Error;
                          return false;
                        }
                      default: ;
                    }

                    if (postfix === ' ') {
                      // For JSON, we don't auto-convert to MONEY, but immediately to FLOAT
                      if (value.ConvertableToS32())
                        postfix = 'I';
                      else
                        postfix = 'F';
                    }

                    switch (postfix) {
                      case 'I':
                        {
                          if (!value.ConvertableToS32()) {
                            errormessage = "Integer overflow in token '" + token + "'";
                            parsestate = PS_Error;
                            return false;
                          }
                          HSVM_IntegerSet(vm, target, value.ToS32());
                        } break;
                      case '6':
                        {
                          if (!value.ConvertableToS64()) {
                            errormessage = "Integer64 overflow in token '" + token + "'";
                            parsestate = PS_Error;
                            return false;
                          }
                          HSVM_Integer64Set(vm, target, value.ToS64());
                        } break;
                      case 'M':
                        {
                          if (!value.ConvertableToMoney(false)) {
                            errormessage = "Money overflow in token '" + token + "'";
                            parsestate = PS_Error;
                            return false;
                          }
                          HSVM_MoneySet(vm, target, value.ToMoney());
                        } break;
                      case 'F':
                        {
                          if (!value.ConvertableToFloat()) {
                            errormessage = "Float overflow in token '" + token + "'";
                            parsestate = PS_Error;
                            return false;
                          }
                          HSVM_FloatSet(vm, target, value.ToFloat());
                        } break;
                      default:
                        errormessage = "Unknown postfix '" + std:: string(1, postfix) + "' encountered";
                        parsestate = PS_Error;
                        return false;
                    }
          */
          return true;
        } break;

      default:
        this.errormessage = "Unexpected token '" + token + "' encountered";
        this.parsestate = ParseState.PS_Error;
        return false;
    }
  }

  parseHSONTypedValue(parent: LevelParentVar, key: string | number, token: string, tokentype: TokenType): boolean {
    switch (this.lasttype) {
      case HareScriptType.Integer64: {
        parent[key] = BigInt(token);
        return true;
      }
      case HareScriptType.HSMoney: {
        parent[key] = new Money(token);
        return true;
      }
      case HareScriptType.Float: {
        if (tokentype !== TokenType.JTT_Number) {
          this.errormessage = "Illegal money/float value '" + token + "'";
          this.parsestate = ParseState.PS_Error;
          return false;
        }

        parent[key] = Number(token);
        return true;
      }
      case HareScriptType.Blob: {
        if (tokentype !== TokenType.JTT_String) {
          this.errormessage = "Illegal blob value '" + token + "'";
          this.parsestate = ParseState.PS_Error;
          return false;
        }
        parent[key] = WebHareBlob.from(Buffer.from(token, "base64"));
        return true;
      }
      case HareScriptType.DateTime: {
        if (tokentype !== TokenType.JTT_String) {
          this.errormessage = "Illegal datetime value '" + token + "'";
          this.parsestate = ParseState.PS_Error;
          return false;
        }
        let value: Date;
        if (token === "")
          value = defaultDateTime;
        else if (token === "MAX")
          value = maxDateTime;
        else if (token[0] === 'T') {
          const msecs = Number(token.substring(1));
          value = new Date(defaultDateTime.getTime() + msecs);
        } else {
          if (token.indexOf("T") === -1)
            token = token + "T000000";
          const parts = /^(\d+)(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d(.\d+)?)$/.exec(token);
          if (!parts) {
            this.errormessage = "Illegal datetime value '" + token + "'";
            this.parsestate = ParseState.PS_Error;
            return false;
          }
          // Can't parse years > 4 digits, so handle them using year correction
          const year = parts[1].padStart(4, "0");
          const datestr = `${year.length > 4 ? "2000" : year}-${parts[2]}-${parts[3]}T${parts[4]}:${parts[5]}:${parts[6]}Z`;
          value = new Date(Date.parse(datestr));
          if (year.length > 4)
            value.setUTCFullYear(Number(parts[1]));
          if (isNaN(value.getUTCFullYear())) // assume that overflows will result in a NaN, convert to maxDateTime
            value = maxDateTime;
        }
        parent[key] = value;
        return true;
      }
      case HareScriptType.Object:
      case HareScriptType.WeakObject:
      case HareScriptType.FunctionPtr: {
        throw new Error(`Not supported decoding type ${HareScriptType[this.lasttype] ?? this.lasttype} in JavaScript`);
      }
      default:
        throw new Error(`Unhandled variabletype in HSON typed decoder: ${HareScriptType[this.lasttype] ?? this.lasttype}`);
    }
  }
}

export function decodeHSON(hson: string | Uint8Array | ArrayBuffer | Buffer): IPCMarshallableData {
  const str = typeof hson === "string"
    ? hson
    : "length" in hson // true for Uint8Array and Buffer
      ? "copy" in hson
        ? hson.toString("utf-8")
        : Buffer.from(hson).toString("utf-8")
      : Buffer.from(hson).toString("utf-8");

  const decoder = new JSONParser();
  decoder.hson = true;

  for (const c of str) {
    if (!decoder.handleChar(c)) {
      break;
    }
  }
  const res = decoder.finish();
  if (res.success)
    return res.value;
  throw new Error(res.msg);
}
