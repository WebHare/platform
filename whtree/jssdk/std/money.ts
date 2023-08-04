/* A Money type library for safe calculation with money amounts in JS. If you don't
   know why we need this, try to predict what the following code would print:
   var cents=0;for(var i=0;i<100;++i)cents+=0.01;cents-=1;console.log(cents);
   and think twice about whether you want to code anything financial in JS.

   We haven't decideded yet what range Money should support. To keep our options open and keep HS compatbility for now
   we will fix ourselves to 5 digits (HS compat) and not allow values bigger than 900_000_000 (2**53 / 100000 'number' compatbiility clamped to a more readable number)

  Users should not rely on JS Money keeping this smaller range in the future. Money values supplied from HareScript should be formatted using FormatJSFinmathMoney
*/

// relative import so hsmarshalling doesn't break on us. TODO we should just absorb finmath
// import * as finmath from "@mod-system/js/util/finmath";
import * as finmath from "../../modules/system/js/util/finmath";

export type MoneyRoundingMode = "none" | "toward-zero" | "down" | "up" | "half-toward-zero" | "half-down" | "half-up" | "toward-infinity" | "half-toward-infinity";
export type MoneyTestTypes = "<" | "<=" | "==" | "!=" | ">" | ">=";

type MoneyParameter = Money | string;

/** A decimal based JS money type*/
export class Money {
  /** finmath-compatible value */
  readonly value: string;

  constructor(value: MoneyParameter = "0") {
    this.value = Money.parseParameter(value);

    const intvalue = parseInt(this.value);
    if (intvalue < -900_000_000 || intvalue > 900_000_000)
      throw new TypeError(`Money value '${value}' is out of range`);

    /// Marker for safe type detections across realms - TODO we need to define a more stable marshalling interface
    Object.defineProperty(this, "__hstype", { value: 0x11 });
  }

  private static parseParameter(param: MoneyParameter): string {
    if (typeof param === "string")
      return param;
    if (Money.isMoney(param))
      return (param as unknown as { value: string }).value;

    throw new TypeError(`Money cannot be constructed out of a value of type ${typeof param}`);
  }
  static isMoney(value: unknown): value is Money {
    return typeof value === "object" && Boolean(value) && ((value as { __hstype: unknown }).__hstype === 0x11);
  }

  static fromNumber(value: number): Money {
    return new Money(String(value));
  }

  /** Adds two numbers together
  */
  static add(left: MoneyParameter, right: MoneyParameter) {
    return new Money(finmath.add(Money.parseParameter(left), Money.parseParameter(right)));
  }

  /** Subtracts a number from another number
  */
  static subtract(left: MoneyParameter, right: MoneyParameter) {
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
  static roundToMultiple(amount: MoneyParameter, roundto: MoneyParameter, mode: MoneyRoundingMode) {
    return new Money(finmath.roundToMultiple(Money.parseParameter(amount), Money.parseParameter(roundto), mode));
  }

  /** Compares two numbers
      @param amount1 - Left hand value
      @param amount2 - Right hand value
      @returns Returns 0 if amount1 == amount2, -1 if amount1 \< amount2, 1 if amount1 \> amount2
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
        console.log(finmath.test(1, '\<', 2)); // prints 'true'
  */
  static test(left: MoneyParameter, relation: MoneyTestTypes, right: MoneyParameter): boolean {
    return finmath.test(Money.parseParameter(left), relation, Money.parseParameter(right));
  }

  /** Multiplies two numbers together
  */
  static multiply(left: MoneyParameter, right: MoneyParameter) {
    return new Money(finmath.multiply(Money.parseParameter(left), Money.parseParameter(right)));
  }

  /** Returns a percentage of an amount
      @param amount - Original amount
      @param perc - Percentage of the amount to return
      @returns Percentage of the amount
  */
  static getPercentage(amount: MoneyParameter, percentage: MoneyParameter) {
    return new Money(finmath.getPercentageOfAmount(Money.parseParameter(amount), Money.parseParameter(percentage)));
  }

  /** Divides two values, (currently with up to 5 decimals of precision)
      @param numerator - Value to divide
      @param divisor - Divisor
      @returns Divided value
  */
  static divide(numerator: MoneyParameter, divider: MoneyParameter) {
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
  format(decimalpoint: string, mindecimals: number): string {
    return finmath.formatPrice(this.value, decimalpoint, mindecimals);
  }

  toJSON(): string {
    return finmath.formatPrice(this.value, ".", 0);
  }

  toString(): string {
    return finmath.formatPrice(this.value, ".", 0);
  }
}
