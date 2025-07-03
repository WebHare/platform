/* A Money type library for safe calculation with money amounts in JS. If you don't
   know why we need this, try to predict what the following code would print:
   var cents=0;for(var i=0;i<100;++i)cents+=0.01;cents-=1;console.log(cents);
   and think twice about whether you want to code anything financial in JS.

   We haven't decideded yet what range Money should support. To keep our options open and keep HS compatbility for now
   we will fix ourselves to 5 digits (HS compat) and not allow values bigger than 900_000_000 (2**53 / 100000 'number' compatbiility clamped to a more readable number)

  Users should not rely on JS Money keeping this smaller range in the future. Money values supplied from HareScript should be formatted using FormatJSFinmathMoney
*/

import * as finmath from "./finmath"; //TODO absorb into us as soon as noone externally depends on finmath anymore
import { isMoney } from "./quacks";

export type MoneyRoundingMode = "none" | "toward-zero" | "down" | "up" | "half-toward-zero" | "half-down" | "half-up" | "toward-infinity" | "half-toward-infinity";
export type MoneyTestTypes = "<" | "<=" | "==" | "!=" | ">" | ">=";

type MoneyParameter = Money | string;

interface SplitNumber {
  num: number;
  decimals: number;
}

export interface MoneyFormatOptions {
  //thousand separator. defaults to ""
  thousandsSeparator?: string;
  //decimal separator. defaults to "."
  decimalSeparator?: string;
  //minimum # of decimals. defaults to 2
  minDecimals?: number;
}

function stripUnneededDecimals(num: number, decimals: number) {
  //we have a maximum of 5 digits of external precision
  if (decimals > 5) {
    // math.round rounds toward positive infinity
    const isneg = num < 0;
    if (isneg)
      num = -num;

    while (decimals > 6) { //truncate excess digits
      num = Math.floor(num / 10);
      --decimals;
    }
    //round up if 6th decimal >= 5
    num = Math.round(num / 10);
    decimals = 5;

    if (isneg)
      num = -num;
  }

  //strip unneeded decimals
  while (decimals > 0 && !(num % 10)) {
    num /= 10;
    --decimals;
  }

  return { num, decimals };
}

/** Convert a money of any format to a split number object
    @param money - Either an integer number or string with a number
    @returns Split number object
*/
function splitValue(money: MoneyParameter): SplitNumber {
  if (typeof money === 'number') {
    if (money !== Math.floor(money))
      throw new Error("Non-integer number passed");
    if (!Number.isSafeInteger(money))
      throw new Error(`The value ${money} is outside the safe value range`);
    return { num: money, decimals: 0 };
  }
  if (typeof money !== 'string')
    throw new Error("Number or string expected, got " + money);

  const split = money.match(/^(-)?([0-9]*)(\.([0-9]{0,5})([0-9]*))?$/);
  if (!split)
    throw new Error(`Illegal money value received: '${money}'`);

  const sign = split[1] === '-' ? -1 : 1;
  const decimals = split[3] ? split[4].length : 0;
  // If there are more than 5 decimals, round up (using halfExpand strategy)
  const num = sign * (parseInt(split[2] || "0") * Math.pow(10, decimals) + (parseInt((split[4] || '')) || 0) + (split[5]?.[0] >= '5' ? 1 : 0));
  if (!Number.isSafeInteger(num))
    throw new Error(`The value '${money}' is outside the safe value range`);

  return stripUnneededDecimals(num, decimals);
}

function toText(amount: SplitNumber, decimalpoint: string, mindecimals: number, thousandpoint: string) {
  if (!Number.isSafeInteger(amount.num))
    throw new Error("Result would overflow the safe value range");

  let { num, decimals } = stripUnneededDecimals(amount.num, amount.decimals);

  // Strip sign from number, may need to prefix it
  const isnegative = num < 0;
  if (isnegative)
    num = -num;

  let astext = String(num);

  // Ensure we have enough leading 0's to render the first integer digit
  if (astext.length <= decimals)
    astext = '00000000000000000000'.substring(0, decimals + 1 - astext.length) + astext;
  // make sure we have enough 0's to show mindecimals
  if (decimals < mindecimals) {
    astext += '00000000000000000000'.substring(0, mindecimals - decimals);
    decimals = mindecimals;
  }

  let beforepoint = astext.substring(0, astext.length - decimals);
  const afterpoint = astext.substring(astext.length - decimals);

  // Add thouands points if neeed
  if (thousandpoint)
    beforepoint = beforepoint.replaceAll(/\B(?=(\d{3})+(?!\d))/g, thousandpoint);

  return (isnegative ? "-" : "") + beforepoint + (afterpoint.length ? decimalpoint + afterpoint : "");
}

/** A decimal based JS money type*/
export class Money {
  /** finmath-compatible value */
  readonly value: string;
  private static "__ $whTypeSymbol" = "Money";

  constructor(value: MoneyParameter = "0") {
    this.value = Money.parseParameter(value);

    const intvalue = parseInt(this.value);
    //We need the number to be in the safe range even after adding 5 decimals
    if (intvalue <= (Number.MIN_SAFE_INTEGER / 100000) || intvalue >= (Number.MAX_SAFE_INTEGER / 100000))
      throw new TypeError(`Money value '${value}' is out of range`);
  }

  private static parseParameter(param: MoneyParameter): string {
    if (typeof param === "string")
      return toText(splitValue(param), ".", 0, "");
    if (Money.isMoney(param))
      return (param as unknown as { value: string }).value;

    throw new TypeError(`Money cannot be constructed out of a value of type ${typeof param}`);
  }

  static isMoney(value: unknown): value is Money {
    return isMoney(value);
  }

  static fromNumber(value: number): Money {
    return new Money(String(value));
  }

  /** Adds numbers together
  */
  static add(left: MoneyParameter, ...right: MoneyParameter[]): Money {
    let sum = Money.parseParameter(left);
    for (const item of right)
      sum = finmath.add(sum, Money.parseParameter(item));
    return new Money(sum);
  }

  /** Subtracts a number from another number
  */
  static subtract(left: MoneyParameter, right: MoneyParameter): Money {
    return new Money(finmath.subtract(Money.parseParameter(left), Money.parseParameter(right)));
  }

  /** Rounds a value to a multiple of a unit, with a specific rounding mode
      @param value - Value to round
      @param unit - The value will be rounded to a mulitple of this unit (except when rounding mode is 'none')
      @param mode - Rounding mode. Possible values:<br>
        <ul>
          <li>none: No rounding</li>
          <li>toward-zero: Round toward zero</li>
          <li>down: Round toward negative infity</li>
          <li>up: Round toward positive infity</li>
          <li>half-toward-zero: Round nearest multiple, round half of a multiple toward zero</li>
          <li>half-down: Round nearest multiple, round half of a multiple toward negative infinity</li>
          <li>half-up: Round nearest multiple, round half of a multiple toward positive infity</li>
        </ul>
      @returns The rounded value
  */
  static roundToMultiple(amount: MoneyParameter, roundto: MoneyParameter, mode: MoneyRoundingMode): Money {
    return new Money(finmath.roundToMultiple(Money.parseParameter(amount), Money.parseParameter(roundto), mode));
  }

  /** Compares two numbers
      @param amount1 - Left hand value
      @param amount2 - Right hand value
      @returns Returns 0 if amount1 === amount2, -1 if amount1 \< amount2, 1 if amount1 \> amount2
  */
  static cmp(left: MoneyParameter, right: MoneyParameter): -1 | 0 | 1 {
    return finmath.cmp(Money.parseParameter(left), Money.parseParameter(right));
  }

  /** Test whether two values have a specific relation
      @param lhs - Left hand value
      @param relation - One of '\<', '\<=', '==', '!=', '\>', '\>=''
      @param rhs - Right hand value
      @returns TRUE if the relation holds
      @example
        console.log(Money.check(1, '\<', 2)); // prints 'true'
  */
  static check(left: MoneyParameter, relation: MoneyTestTypes, right: MoneyParameter): boolean {
    return finmath.test(Money.parseParameter(left), relation, Money.parseParameter(right));
  }

  /** Multiplies two numbers together
  */
  static multiply(left: MoneyParameter, right: MoneyParameter): Money {
    return new Money(finmath.multiply(Money.parseParameter(left), Money.parseParameter(right)));
  }

  /** Returns a percentage of an amount
      @param amount - Original amount
      @param perc - Percentage of the amount to return
      @returns Percentage of the amount
  */
  static getPercentage(amount: MoneyParameter, percentage: MoneyParameter): Money {
    return new Money(finmath.getPercentageOfAmount(Money.parseParameter(amount), Money.parseParameter(percentage)));
  }

  /** Divides two values, (currently with up to 5 decimals of precision)
      @param numerator - Value to divide
      @param divisor - Divisor
      @returns Divided value
  */
  static divide(numerator: MoneyParameter, divider: MoneyParameter): Money {
    return new Money(finmath.divide(Money.parseParameter(numerator), Money.parseParameter(divider)));
  }
  /** Returns the minimum of all the arguments
      @param amount - First value
      @param amounts - Rest of the values
      @returns The lowest value among amount and amounts
  */
  static min(amount: MoneyParameter, ...amounts: MoneyParameter[]): Money {
    return new Money(finmath.min(Money.parseParameter(amount), ...(amounts.map(Money.parseParameter))));

  }

  /** Returns the maximum of all the arguments
      @param amount - First value
      @param amounts - Rest of the values
      @returns The highest value among amount and amounts
  */
  static max(amount: MoneyParameter, ...amounts: MoneyParameter[]): Money {
    return new Money(finmath.max(Money.parseParameter(amount), ...(amounts.map(Money.parseParameter))));
  }

  /** format a price amount. extend # of decimals to specified # if not enough */
  format(format?: MoneyFormatOptions): string {
    return toText(splitValue(this.value),
      format?.decimalSeparator ?? ".",
      format?.minDecimals ?? 2,
      format?.thousandsSeparator ?? "");
  }

  toJSON(): string {
    return this.value;
  }

  toString(): string {
    return this.value;
  }

  toNumber(): number {
    return parseFloat(this.value);
  }
}
