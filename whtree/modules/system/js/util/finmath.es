/* A math library for safe calculation with money amounts in JS. If you don't
   know why we need this, try to predict what the following code would print:
   var cents=0;for(var i=0;i<100;++i)cents+=0.01;cents-=1;console.log(cents);
   and think twice about whether you want to code anything financial in JS.
*/

//a 'price' is a string of the form "nnn[.NNNN]"

function isSafeInteger(value) //Number.isSafeInteger is unavailable in IE11
{
   return Number.isInteger(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
}

function stripUnneededDecimals(num, decimals)
{
  //we have a maximum of 5 digits of external precision
  if(decimals > 5)
  {
    // math.round rounds toward positive infinity
    const isneg = num < 0;
    if (isneg)
      num = -num;

    while(decimals>6) //truncate excess digits
    {
      num = Math.floor(num/10);
      --decimals;
    }
    //round up if 6th decimal >= 5
    num = Math.round(num / 10);
    decimals = 5;

    if (isneg)
      num = -num;
  }

  //strip unneeded decimals
  while(decimals > 0 && !(num%10))
  {
    num/=10;
    --decimals;
  }

  return { num, decimals };
}

function toText(amount, decimalpoint, mindecimals)
{
  if(!isSafeInteger(amount.num))
    throw new Error("Result would overflow the safe value range");

  let num, decimals;
  ({ num, decimals } = stripUnneededDecimals(amount.num, amount.decimals));

  // Strip sign from number, may need to prefix it
  let isnegative = num < 0;
  if (isnegative)
    num = -num;

  let astext = String(num);

  // Ensure we have enough leading 0's to render the first integer digit
  if (astext.length <= decimals)
    astext = '00000000000000000000'.substr(0, decimals + 1 - astext.length) + astext;
  // make sure we have enough 0's to show mindecimals
  if (decimals < mindecimals)
  {
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

/** Convert a price of any format to a price parts object
    @param money Either an integer number, string with a number of a price object
    @return Price parts object
*/
function splitPrice(money)
{
  if(typeof money == 'number')
  {
    if(money != Math.floor(money))
      throw new Error("Passing a non-integer number to splitPrice");
    if(!isSafeInteger(money))
      throw new Error(`The value ${money} is outside the safe value range`);
    return { num: money, decimals: 0 };
  }
  if(typeof money != 'string')
    throw new Error("splitPrice should receive either number or string, got " + money);

  let split = money.match(/^(-)?([0-9]+)(\.[0-9]{0,5})?$/);
  if(!split)
    throw new Error(`splitPrice received illegal price: '${money}'`);

  let sign = split[1]=='-' ? -1 : 1;
  let decimals = split[3] ? split[3].length-1 : 0;
  let num = sign * (parseInt(split[2]) * Math.pow(10, decimals) + (parseInt((split[3]||'').substr(1)) || 0));
  if(!isSafeInteger(num))
    throw new Error(`The value '${money}' is outside the safe value range`);

  return stripUnneededDecimals(num, decimals);
}

/** Convert price parts into a string
*/
function joinPrice(parts)
{
  return toText(parts,'.',0);
}

function adjustDecimals(amount, requiredecimals)
{
  let toadd = requiredecimals - amount.decimals;
  if(toadd <= 0)
    return;

  let multiplier = 1;
  for (let idx = 0; idx < toadd; ++idx)
    multiplier *= 10;

  if(!isSafeInteger(amount.num * multiplier))
    throw new Error("adjustDecimals would overflow the safe value range");

  amount.num *= multiplier;
  amount.decimals += toadd;
}

/** Returns if a price string is valid
*/
export function isValidPrice(money)
{
  if(typeof money != 'string' || !money.match(/[0-9]+(\.[0-9]{0,5})?$/))
    return false;
  return true;
}

function __add(lhs,rhs)
{
  //equalize # of decimals, and then it's a simple addition
  let requiredecimals = Math.max(lhs.decimals, rhs.decimals);
  adjustDecimals(lhs, requiredecimals);
  adjustDecimals(rhs, requiredecimals);
  return { num: lhs.num + rhs.num, decimals: requiredecimals };
}

/** Adds two numbers together
*/
export function add(amount1, amount2)
{
  return joinPrice(__add(splitPrice(amount1), splitPrice(amount2)));
}

/** Subtracts a number from another number
*/
export function subtract(amount, tosubtract)
{
  let lhs = splitPrice(amount), rhs = splitPrice(tosubtract);
  rhs.num = -rhs.num;
  return joinPrice(__add(lhs, rhs));
}

function __multiply(lhs,rhs)
{
  //ADDME the naive 'add decimals, multiple nums' approach gets you out of the safe range real fast. needs tests
  return { num: lhs.num * rhs.num, decimals: lhs.decimals + rhs.decimals };
}

/** Multiplies two numbers together
*/
export function multiply(amount1, amount2)
{
  let lhs = splitPrice(amount1), rhs = splitPrice(amount2);
  return joinPrice(__multiply(lhs, rhs));
}

/** Compares two numbers
    @param amount1
    @param amount2
    @return Returns 0 if amount1 == amount2, -1 if amount1 < amount2, 1 if amount1 > amount2
*/
export function cmp(amount1,amount2)
{
  let diff = __add(splitPrice(amount1), __multiply(splitPrice(amount2), { num: -1, decimals: 0 }));
  return diff.num < 0 ? -1 : diff.num == 0 ? 0 : 1;
}

/** Returns a percentage of an amount
    @param amount Original amount
    @param perc Percentage of the amount to return
    @return Percentage of the amount
*/
export function getPercentageOfAmount(amount, perc)
{
  let lhs = splitPrice(amount), rhs = splitPrice(perc);
  amount = __multiply(lhs, rhs);
  amount.decimals += 2;
  return joinPrice(normalize(amount));
}

function normalize(amount)
{
  while (amount.decimals && (amount.num % 10) === 0)
  {
    amount.num /= 10;
    --amount.decimals;
  }
  return amount;
}

/// format a price amount. extend # of decimals to specified # if not enough
export function formatPrice(money, decimalpoint, decimals)
{
  return toText(splitPrice(money), decimalpoint, decimals);
}

//OBSOLETE - webshops before 3.3.1 still need it though
export function getCostFromTable(costtable, total)
{
  let bestcost = null;
  for(let row of costtable)
  {
    if(cmp(total, row.fromtotal) < 0) //total not high enough to trigger this row
      continue;

    if(bestcost === null || cmp(row.cost, bestcost) <= 0)//first or better offer
      bestcost = row.cost;
  }
  return bestcost || "0";
}

// === Math.trunc, but ie doesn't support that
function truncateFloat(value)
{
  let isnegative = value < 0;
  value = Math.floor(Math.abs(value));
  return isnegative && value ? -value :  value; // no -0, please
}

/** Rounds integer to multiple, exposed for testing only
*/
export function __roundIntegerToMultiple(value, roundunit, mode)
{
  switch (mode)
  {
    case "none":
    {
      // no rounding
    } break;
    case "toward-zero":
    {
      value = truncateFloat(value / roundunit) * roundunit;
    } break;
    case "toward-infinity":
    {
      if (value > 0)
        value = truncateFloat((value + roundunit - 1) / roundunit) * roundunit;
      else
        value = truncateFloat((value - roundunit + 1) / roundunit) * roundunit;
    } break;
    case "down":
    {
      if (value > 0)
        value = truncateFloat(value / roundunit) * roundunit;
      else
        value = truncateFloat((value - roundunit + 1) / roundunit) * roundunit;
    } break;
    case "up":
    {
      if (value > 0)
        value = truncateFloat((value + roundunit - 1) / roundunit) * roundunit;
      else
        value = truncateFloat(value / roundunit) * roundunit;
    } break;
    case "half-toward-zero":
    {
      if (value > 0)
        value = truncateFloat((value + (roundunit - 1) / 2) / roundunit) * roundunit;
      else
        value = truncateFloat((value - (roundunit - 1) / 2) / roundunit) * roundunit;
    } break;
    case "half-toward-infinity":
    {
      if (value > 0)
        value = truncateFloat((value + roundunit / 2) / roundunit) * roundunit;
      else
        value = truncateFloat((value - roundunit / 2) / roundunit) * roundunit;
    } break;
    case "half-down":
    {
      if (value > 0)
        value = truncateFloat((value + (roundunit - 1) / 2) / roundunit) * roundunit;
      else
        value = truncateFloat((value - roundunit / 2) / roundunit) * roundunit;
    } break;
    case "half-up":
    {
      if (value > 0)
        value = truncateFloat((value + roundunit / 2) / roundunit) * roundunit;
      else
        value = truncateFloat((value - (roundunit - 1) / 2) / roundunit) * roundunit;
    } break;
    default:
    {
      throw new Error(`Unknown rounding mode ${mode}`);
    }
  }
  return value;
}

/** Rounds a value to a multiple of a unit, with a specific rounding mode
    @param value Value to round
    @param unit The value will be rounded to a mulitple of this unit (except when rounding mode is 'none')
    @param mode Rounding mode. Possible values:<br>
      <ul>
        <li>none: No rounding</li>
        <li>toward-zero: Round toward zero</li>
        <li>down: Round toward negative infity</li>
        <li>up: Round toward positive infity</li>
        <li>half-toward-zero: Round nearest multiple, round half of a multiple toward zero</li>
        <li>half-down: Round nearest multiple, round half of a multiple toward negative infinity</li>
        <li>half-up: Round nearest multiple, round half of a multiple toward positive infity</li>
      </ul>
    @return The rounded value
*/
export function roundToMultiple(value, unit, mode)
{
  value = splitPrice(value);
  unit = splitPrice(unit);

  let requiredecimals = Math.max(value.decimals, unit.decimals);
  adjustDecimals(value, requiredecimals);
  adjustDecimals(unit, requiredecimals);

  let result = { num: __roundIntegerToMultiple(value.num, unit.num, mode), decimals: value.decimals };
  return joinPrice(result);
}

/** Returns the minimum of all the arguments
    @param amount First value
    @param amounts Rest of the values
    @return The lowest value among amount and amounts
*/
export function min(amount, ...amounts)
{
  for (const val of amounts)
    if (cmp(amount, val) > 0)
      amount = val;
  return joinPrice(splitPrice(amount));
}

/** Returns the maximum of all the arguments
    @param amount First value
    @param amounts Rest of the values
    @return The highest value among amount and amounts
*/
export function max(amount, ...amounts)
{
  for (const val of amounts)
    if (cmp(amount, val) < 0)
      amount = val;
  return joinPrice(splitPrice(amount));
}

/** Returns a power of 10
    @param exp Integer power, must be 0 or bigger
    @return Requested power of 10
*/
function getNonNegativePowerOf10(exp)
{
  let retval = 1, running_exp = 10;
  while (exp)
  {
    if (exp & 1)
      retval *= running_exp;
    running_exp *= running_exp;
    exp = exp >> 1;
  }
  return retval;
}

/** Divides two values, with 5 decimals of precision
    @param value Value To divide
    @param divisor Divisor
    @return Divided value, with 5 decimals of precision
*/
export function moneyDivide(value, divisor)
{
  const lhs = splitPrice(value), rhs = splitPrice(divisor);
  const mul10exp = lhs.decimals - rhs.decimals - 5;
  const mulfactor = mul10exp < 0 ? getNonNegativePowerOf10(-mul10exp) : 1;
  const roundunit = mul10exp > 0 ? getNonNegativePowerOf10(mul10exp) : 1;
  return joinPrice({ num: __roundIntegerToMultiple(mulfactor * lhs.num / rhs.num, roundunit, "half-toward-infinity"), decimals: 5 });
}

/** Test whether two values have a specific relation
    @param lhs Left hand value
    @param relation One of '<', '<=', '==', '!=', '>', '>=''
    @param rhs Right hand value
    @return TRUE if the relation holds
    @example
      console.log(finmath.test(1, '<', 2)); // prints 'true'
*/
export function test(lhs, relation, rhs)
{
  const compareresult = cmp(lhs, rhs);
  switch (relation)
  {
    case '<':   return compareresult < 0;
    case '<=':  return compareresult <= 0;
    case '==':  return compareresult === 0;
    case '!=':  return compareresult !== 0;
    case '>':   return compareresult > 0;
    case '>=':  return compareresult >= 0;
  }
  throw Error(`Cannot test for unknown relation '${relation}'`);
}
