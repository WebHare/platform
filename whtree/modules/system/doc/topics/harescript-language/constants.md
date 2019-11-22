# Constants and initialisers

Constants and initialisers are used to feed the basic data to the scripts. Every
simple value (eg. 4, 2.20371) or string (eg. "Hello, World") is considered to be
a constant. More complex data structures, such as records and arrays, can be
built using both constant and dynamic data.

## String constants and escape sequences

String constants can be used to fill a _string_ variable, print something, or
pass a string parameter to a function or string operator. A string constant can
contain an unlimited number of characters. For a string to be printable and
usable in most HareScript functions, every character must either be a TAB, one
of the 95 printable ASCII characters (character codes 32 to 126), or be part of
a UTF-8 encoded Unicode character.

If an external editor is used to edit a HareScript file, and you wish to use any
non-ASCII characters, such as `á` or `ç`, you should make sure that this editor
can properly create and edit UTF-8 encoded files.

String constants must be enclosed in either single quotes or double quotes. A
string constant may not span more than one line.

All occurrences of the enclosing quote character and the backslash character, in
the string constant, must be escaped using an escape sequence. The following
escape sequences are supported inside HareScript string constants:

| Sequence | Meaning |
| --- | ---- |
| \a | audible bell (ASCII code 7) |
| \b | backspace (ASCII code 8) |
| \f | formfeed (ASCII code 12) |
| \n | linefeed (ASCII code 10) |
| \r | carriage return (ASCII code 13) |
| \t | horizontal tab (ASCII code 9) |
| \` | escaped single quote |
| \" | escaped double quote |
| \\ | escaped backslash |
| \\_nnn_ | octal ascii code |
| \x_nn_ | hexadecimal ascii code |

```harescript
//A string containing four linefeeds
STRING linefeeds := "\n\n\n\n";

//A string containing ASCII characters 4, 12, 20
STRING asciis := `\004\014\024`;

//A string containing backslashes, and the quote character
//used to delimit it
STRING escapes := `Backslash: \\    Single quote: \`    Double quote \"   `;
```

### Template strings
A template string is delimited by the backquote character `` ` ``. If can
contain expressions within the string, which are encoded by `${<expression}`.
These expressions are concatenated with the other parts of the template string
using the string merge operator (`||`), so it is save to use expressions
returning _integer_ and _integer64_ values.

```harescript
STRING good := "good";
PRINT(`this is a ${good} value\n`);

INTEGER base := 2;
PRINT(`${base} + 1 = ${base + 1}\n`);
```

### UTF-8 encoding

HareScript expects its strings and files to follow the UTF-8 encoding standard.
The UTF-8 encoding is a popular method for storing characters from the Unicode
character set, because it allows many existing applications (which expect 8-bit
characters) to easily support the full Unicode character set. UTF-8 is also a
very efficient coding system when most text in a file is in the ASCII character
set (such as HTML and HareScript), because the ASCII characters only require 8
bits per character to store.

## Numerical constants

Numerical constants, such as `5`, `2.20371` and hexadecimal numbers, can be used
to fill variables of the various numeric types WebHare supports, or passed as
parameters to a function or a numerical operator.

Numerical constants can be of type _integer_, _integer64_, _money_ or _float_.
For decimal numbers, a constant will always be of the smallest type that is able
to represent it. For example, the constant `1000` will always be of type
_integer_ as `1000` can be stored by every numerical type, and _integer_ is the
smallest of those types. The constant `1.23456789` will always be of type _float_,
since both _integer_ and _money_ are unable to store a value with 8 decimals.

HareScript considers _integer_ to be the smallest numeric type, then _integer64_,
then _money_, and finally _float_. The last type, _float_, may not be able to
represent every value exactly.

### Overriding a constant's type

In most cases, it doesn't matter which type HareScript assigns to a numerical
constant, as all numerical operators and functions will convert a small type to
a larger type when necessary. Eg, when you multiple `1000` with `1.23456789`,
`1000` is converted to type _float_ before the multiplication takes place. A
numerical type is never implicitly converted to a smaller type.

However, in some cases you may want to exactly specify the type of a constant,
for reasons of clarity, or perhaps because you require a specific type to be
used for a record cell. In these cases, you can add an `i`, `i64`, `f`, or `m`
suffix to a numerical constant to specify its type, as detailed in the following
example:

```harescript
// Store the value `5` in a floating point value in a cell.
RECORD r;
INSERT CELL fl := 5f INTO r;

/* Store the integer value `8` into a money variable (the integer to money
conversion is done automatically - the suffix here is optional) */
MONEY m := 8i;

// Illegal: a money value cannot be stored into an integer variable
INTEGER i := 15m;

// Illegal: 1.23456789 is always of float type, and cannot be stored
// as an integer
INTEGER i := 1.23456789;

// Illegal: 1.23i cannot be of integer type
INTEGER i := 1.23i;

// Convert 1 as _integer64_ value
INSERT CELL int64val := 1i64 INTO r;
```

### Hexadecimal and binary constants

HareScript also permits the use of hexadecimal and binary constants, which may
be easier to use when using any of the bit manipulation operators, such as
BITAND or BITRSHIFT. A hexadecimal constant must be prefixed with `0x`, and a
binary constant must be prefixed with `0b`. Hexadecimal and binary constants are
interpreted as 2-complement signed integers, and can only be of type _integer_:

```harescript
// The decimal value `31` in hex:
INTEGER thirty_one := 0x1F;

// The decimal value `20` in binary:
INTEGER twenty := 0b10100;

// The decimal value `-2` in hex:
INTEGER minus_two := 0xFFFFFFFE;

// Illegal: the value `4294967296` is out of range for a hexadecimal value, even
// when immediately assigned to a MONEY variable:
MONEY out_of_range := 0x100000000;
```

## Boolean constants

Boolean constants can be used to fill boolean variables, or passed as parameters
to functions and operators expecting a boolean value. The only supported boolean
constants are the keywords `TRUE` and `FALSE`.

Boolean constants are most commonly used to initialise a boolean value to a
default, or to pass a simple `switch` parameter to a function. They can also be
used to add clarity to conditional expressions, or to create an `infinite` loop.

The following examples show some of the most common uses of boolean constants:

```harescript
// Define a boolean variable B and set it to `true`
BOOLEAN b := TRUE;

// An example of a clarifying but unnecessary use of boolean constants:
BOOLEAN FUNCTION TestCondition() { ... }
IF (TestCondition() = TRUE) ...;

// An example of an `infinite` loop
WHILE (TRUE)
{ ...
  IF (...) BREAK;
}
```

## Record initialisers
There are two forms of forms of record initialisers, a simple variant
(`[ <contents> ]`) and an advanced variant (`CELL[ <contents> ]`).

The following elements can be used (comma-separated) in both variants:
a simple initializer must have an assignment expression as the first element):
- Assignment expression (`<cell name> := <expression>`). This inserts a single
  cell.
- Spread operator (`...<expression>`). This expects the expression to be a
  _record_, and inserts all cells of that record.
- DELETE operator (`DELETE <cell name>`). This deletes a column from the record
  (used to remove unwanted cells from a record that were inserted by a spread
  operator)

The simple variant must start with an assignment expression.

The following elements can only be used in the advanced variant:
- Simple variables (`<variablename>`). This inserts the value of the variable
  with its name as the cell name.
- An expression ending with a dot-operator (`<base expression> . <cell
  name>`). This inserts the expression value with the specified cell name.
- An expression ending with a arrow-operator (`<base expression> -> <object
  member name>`). This inserts the expression value with the specified object member
  name as cell name.
- A string constant (`eg. "value"`). This inserts the string value with that
  value also used as cell name.

A record initializer always returns existing records, use `DEFAULT RECORD` to
create an non-existing record.

Example:
```harescript
// A record containing two integer cells, named A and B,
// containing values 2 and 3
RECORD r1 := [ a := 2, b := 3 ];

// Illegal: multiple cells with the same name appear in the
// initialiser list
RECORD r3 := [ str := "Text", str := "Another Text" ];

// Illegal: the simple variant must start with an assignment expression
RECORD r4 := [];

// Defines an empty record.
RECORD r5 := CELL[];

// Get both cells 'A' en 'B" from r1, then remove 'A'
RECORD r6 := CELL[ ...r1, DELETE a ];

// Equivalent to [ i := i, b := r6.b, f := "f" ]
INTEGER i := 2;
RECORD r7 := CELL[ i, r6.b, "f" ];
```

## Array initialisers
An array can be constructed by enclosing a number of comma-separated values in
square brackets (`[` and `]`). The type of the array can be specified by
specifying the typ ebefore the opening bracket. If no type is given, the
compiler tries to infer the type of the array from the type of the first
value.

All values in the array are converted match the type of the array (so all values
in a _float array_ are converted to _float_). _Variant array_ is the exception
to this rule, this type stores all values without conversion.

Within an array initializer, the spread syntax is allowed. All the values in an
array value prefixed with `...` are copied into the array at that position, and
converted if necessary.

Example:
```harescript
// An empty array
STRING ARRAY a := STRING[];

// The compiler uses the type of the first element to infer the type of the array.
MONEY ARRAY b := [ 2.3m ];

/* Illegal: the compiler doesn't known the type of the first element at
   compile-time
*/
RECORD ARRAY c := [ MyFunction().value ];

// This can be fixed by specifying the type
RECORD ARRAY d := RECORD[ MyFunction().value ];

// Elements are converted to match the type of array elements
FLOAT ARRAY e := FLOAT[ 1, 2m, 3f ];

// Spread syntax, results in an array with the values 0 to 4
FLOAT ARRAY f := [ 0f, ...e, 4f ];
```

## Default values

Every HareScript type has a _default_ value, which is assigned to a variable
if it's defined without an initializer. The default value for any type can also
be obtained by specifying the keyword `DEFAULT` followed by the type name. The
following examples show some uses of default values:

```harescript
//The following two statements are identical and both initialize i to zero
INTEGER i;
INTEGER i := DEFAULT INTEGER;

//Insert a cell with `string array` type, but with no elements so far
INSERT CELL strarray := DEFAULT STRING ARRAY INTO myrecord;

//Check if 29th feburari of 2003 exists - variable isbaddate
//will contain TRUE.
//(makedate returns a default datetime if the parameters are
//out of range)
DATETIME mydate := MakeDate(2003,2,29);
BOOLEAN isbaddate := mydate = DEFAULT DATETIME;
```

For all numeric types, the default value is the zero value. For all other types,
the default value is the `smallest` possible value, ie. it will compare `less
than or equal to` any possible value for that type. The following table shows
the default values for all HareScript types:

| Type | Default value |
| --- | --- |
| Any array type | An empty array |
| Blob | A blob which is 0 bytes in size |
| Datetime | The day before 1-1-1 |
| Float | 0 |
| Integer | 0 |
| Integer64 | 0 |
| Money | 0 |
| Record | A non-existing record, with no cells |
| String | An empty string |
| Object | A non-existing object reference |
| Weak object | A non-existing weak object reference |
| Schema | Unbound. Using DEFAULT SCHEMA is not permitted. |
| Table | Unbound. Using DEFAULT TABLE is not permitted. |
| Variant | None. Variants are never initialized and using DEFAULT VALUE is not permitted. |
