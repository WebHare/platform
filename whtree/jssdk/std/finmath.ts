/* A math library for safe calculation with money amounts in JS. If you don't
   know why we need this, try to predict what the following code would print:
   var cents=0;for(var i=0;i<100;++i)cents+=0.01;cents-=1;console.log(cents);
   and think twice about whether you want to code anything financial in JS.

   Money values supplied from HareScript should be formatted using FormatJSFinmathMoney
*/

export type FinmathInput = string | number;

export type RoundMode = "none" | "toward-zero" | "down" | "up" | "half-toward-zero" | "half-down" | "half-up" | "toward-infinity" | "half-toward-infinity";

export interface SplitNumber {
  num: number;
  decimals: number;
}

//a 'price' is a string of the form "nnn[.NNNN]"

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

function toText(amount: SplitNumber, decimalpoint: string, mindecimals: number) {
  if (!Number.isSafeInteger(amount.num))
    throw new Error("Result would overflow the safe value range");

  let num, decimals;
  ({ num, decimals } = stripUnneededDecimals(amount.num, amount.decimals));

  // Strip sign from number, may need to prefix it
  const isnegative = num < 0;
  if (isnegative)
    num = -num;

  let astext = String(num);

  // Ensure we have enough leading 0's to render the first integer digit
  if (astext.length <= decimals)
    astext = '00000000000000000000'.substr(0, decimals + 1 - astext.length) + astext;
  // make sure we have enough 0's to show mindecimals
  if (decimals < mindecimals) {
    astext += '00000000000000000000'.substr(0, mindecimals - decimals);
    decimals = mindecimals;
  }

  // insert decimal point if needed
  if (decimals)
    astext = astext.substr(0, astext.length - decimals) + decimalpoint + astext.substr(-decimals);

  // add sign if needed
  astext = (isnegative ? "-" : "") + astext;
  return astext;
}

/** Convert a money of any format to a split number object
    @param money - Either an integer number or string with a number
    @returns Split number object
*/
function splitValue(money: FinmathInput): SplitNumber {
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

/** Convert split number into a string
*/
function joinPrice(parts: SplitNumber): string {
  return toText(parts, '.', 0);
}

function adjustDecimals(amount: SplitNumber, requiredecimals: number) {
  const toadd = requiredecimals - amount.decimals;
  if (toadd <= 0)
    return;

  let multiplier = 1;
  for (let idx = 0; idx < toadd; ++idx)
    multiplier *= 10;

  if (!Number.isSafeInteger(amount.num * multiplier))
    throw new Error("adjustDecimals would overflow the safe value range");

  amount.num *= multiplier;
  amount.decimals += toadd;
}

/** Returns if a price string is valid
*/
export function isValidPrice(money: string) {
  if (typeof money !== 'string' || !money.match(/[0-9]+(\.[0-9]{0,5})?$/))
    return false;
  return true;
}

function __add(lhs: SplitNumber, rhs: SplitNumber) {
  //equalize # of decimals, and then it's a simple addition
  const requiredecimals = Math.max(lhs.decimals, rhs.decimals);
  adjustDecimals(lhs, requiredecimals);
  adjustDecimals(rhs, requiredecimals);
  return { num: lhs.num + rhs.num, decimals: requiredecimals };
}

/** Adds two numbers together
*/
export function add(amount1: FinmathInput, amount2: FinmathInput): string {
  return joinPrice(__add(splitValue(amount1), splitValue(amount2)));
}

/** Subtracts a number from another number
*/
export function subtract(amount: FinmathInput, tosubtract: FinmathInput) {
  const lhs = splitValue(amount), rhs = splitValue(tosubtract);
  rhs.num = -rhs.num;
  return joinPrice(__add(lhs, rhs));
}

function __multiply(lhs: SplitNumber, rhs: SplitNumber) {
  //ADDME the naive 'add decimals, multiple nums' approach gets you out of the safe range real fast. needs tests
  return { num: lhs.num * rhs.num, decimals: lhs.decimals + rhs.decimals };
}

/** Multiplies two numbers together
*/
export function multiply(amount1: FinmathInput, amount2: FinmathInput): string {
  const lhs = splitValue(amount1), rhs = splitValue(amount2);
  return joinPrice(__multiply(lhs, rhs));
}

/** Compares two numbers
    @param amount1 - Left hand value
    @param amount2 - Right hand value
    @returns Returns 0 if amount1 === amount2, -1 if amount1 \< amount2, 1 if amount1 \> amount2
*/
export function cmp(amount1: FinmathInput, amount2: FinmathInput) {
  const diff = __add(splitValue(amount1), __multiply(splitValue(amount2), { num: -1, decimals: 0 }));
  return diff.num < 0 ? -1 : diff.num === 0 ? 0 : 1;
}

/** Returns a percentage of an amount
    @param amount - Original amount
    @param perc - Percentage of the amount to return
    @returns Percentage of the amount
*/
export function getPercentageOfAmount(amount: FinmathInput, perc: FinmathInput) {
  const lhs = splitValue(amount), rhs = splitValue(perc);
  const result = __multiply(lhs, rhs);
  result.decimals += 2;
  return joinPrice(normalize(result));
}

function normalize(amount: SplitNumber) {
  while (amount.decimals && (amount.num % 10) === 0) {
    amount.num /= 10;
    --amount.decimals;
  }
  return amount;
}

/// format a price amount. extend # of decimals to specified # if not enough
export function formatPrice(money: FinmathInput, decimalpoint: string, decimals: number) {
  return toText(splitValue(money), decimalpoint, decimals);
}

/** Rounds integer to multiple, exposed for testing only
*/
export function __roundIntegerToMultiple(value: number, roundunit: number, mode: RoundMode) {
  switch (mode) {
    case "none":
      {
        // no rounding
      } break;
    case "toward-zero":
      {
        value = Math.trunc(value / roundunit) * roundunit;
      } break;
    case "toward-infinity":
      {
        if (value > 0)
          value = Math.trunc((value + roundunit - 1) / roundunit) * roundunit;
        else
          value = Math.trunc((value - roundunit + 1) / roundunit) * roundunit;
      } break;
    case "down":
      {
        if (value > 0)
          value = Math.trunc(value / roundunit) * roundunit;
        else
          value = Math.trunc((value - roundunit + 1) / roundunit) * roundunit;
      } break;
    case "up":
      {
        if (value > 0)
          value = Math.trunc((value + roundunit - 1) / roundunit) * roundunit;
        else
          value = Math.trunc(value / roundunit) * roundunit;
      } break;
    case "half-toward-zero":
      {
        if (value > 0)
          value = Math.trunc((value + (roundunit - 1) / 2) / roundunit) * roundunit;
        else
          value = Math.trunc((value - (roundunit - 1) / 2) / roundunit) * roundunit;
      } break;
    case "half-toward-infinity":
      {
        if (value > 0)
          value = Math.trunc((value + roundunit / 2) / roundunit) * roundunit;
        else
          value = Math.trunc((value - roundunit / 2) / roundunit) * roundunit;
      } break;
    case "half-down":
      {
        if (value > 0)
          value = Math.trunc((value + (roundunit - 1) / 2) / roundunit) * roundunit;
        else
          value = Math.trunc((value - roundunit / 2) / roundunit) * roundunit;
      } break;
    case "half-up":
      {
        if (value > 0)
          value = Math.trunc((value + roundunit / 2) / roundunit) * roundunit;
        else
          value = Math.trunc((value - (roundunit - 1) / 2) / roundunit) * roundunit;
      } break;
    default:
      {
        throw new Error(`Unknown rounding mode ${mode}`);
      }
  }
  return value;
}

/** Rounds a value to a multiple of a unit, with a specific rounding mode
    @param value - Value to round
    @param unit - The value will be rounded to a mulitple of this unit (except when rounding mode is 'none')
    @param mode - Rounding mode. Possible values:
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
export function roundToMultiple(value: FinmathInput, unit: FinmathInput, mode: RoundMode) {
  const split_value = splitValue(value);
  const split_unit = splitValue(unit);

  const requiredecimals = Math.max(split_value.decimals, split_unit.decimals);
  adjustDecimals(split_value, requiredecimals);
  adjustDecimals(split_unit, requiredecimals);

  const result = { num: __roundIntegerToMultiple(split_value.num, split_unit.num, mode), decimals: split_value.decimals };
  return joinPrice(result);
}

/** Returns the minimum of all the arguments
    @param amount - First value
    @param amounts - Rest of the values
    @returns The lowest value among amount and amounts
*/
export function min(amount: FinmathInput, ...amounts: FinmathInput[]) {
  for (const val of amounts)
    if (cmp(amount, val) > 0)
      amount = val;
  return joinPrice(splitValue(amount));
}

/** Returns the maximum of all the arguments
    @param amount - First value
    @param amounts - Rest of the values
    @returns The highest value among amount and amounts
*/
export function max(amount: FinmathInput, ...amounts: FinmathInput[]) {
  for (const val of amounts)
    if (cmp(amount, val) < 0)
      amount = val;
  return joinPrice(splitValue(amount));
}

/** Returns a power of 10
    @param exp - Integer power, must be 0 or bigger
    @returns Requested power of 10
*/
function getNonNegativePowerOf10(exp: number) {
  let retval = 1, running_exp = 10;
  while (exp) {
    if (exp & 1)
      retval *= running_exp;
    running_exp *= running_exp;
    exp = exp >> 1;
  }
  return retval;
}

/** Divides two values, with 5 decimals of precision
    @param value - Value To divide
    @param divisor - Divisor
    @returns Divided value, with 5 decimals of precision
*/
export function divide(value: FinmathInput, divisor: FinmathInput) {
  const lhs = splitValue(value), rhs = splitValue(divisor);
  const mul10exp = lhs.decimals - rhs.decimals - 5;
  const mulfactor = mul10exp < 0 ? getNonNegativePowerOf10(-mul10exp) : 1;
  const roundunit = mul10exp > 0 ? getNonNegativePowerOf10(mul10exp) : 1;
  return joinPrice({ num: __roundIntegerToMultiple(mulfactor * lhs.num / rhs.num, roundunit, "half-toward-infinity"), decimals: 5 });
}

export function moneyDivide(value: FinmathInput, divisor: FinmathInput) { //divide was added in 5.0. remove this old name eventually
  return divide(value, divisor);
}

/** Test whether two values have a specific relation
    @param lhs - Left hand value
    @param relation - One of '\<', '\<=', '==', '!=', '\>', '\>=''
    @param rhs - Right hand value
    @returns TRUE if the relation holds
    @example
      console.log(finmath.test(1, '\<', 2)); // prints 'true'
*/
export function test(lhs: FinmathInput, relation: "<" | "<=" | "==" | "!=" | ">" | ">=", rhs: FinmathInput) {
  const compareresult = cmp(lhs, rhs);
  switch (relation) {
    case '<': return compareresult < 0;
    case '<=': return compareresult <= 0;
    case '==': return compareresult === 0;
    case '!=': return compareresult !== 0;
    case '>': return compareresult > 0;
    case '>=': return compareresult >= 0;
  }
  throw Error(`Cannot test for unknown relation '${relation}'`);
}
