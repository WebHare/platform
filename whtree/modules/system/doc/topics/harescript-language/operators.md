# Operators

Operators are used to build expressions and perform calculations. HareScript
offers the following operators:

| Category | Operators |
| --- | --- |
| Assignment operator | `:=` |
| Merge operators | `||`, `CONCAT` |
| Comparison operators | `=`, `<`, `>`, `<=`, `>=`, `<>`, `!=` |
| Arithmetic operators | `+`, `-`, `*`, `/`, `%` |
| Logical operators | `AND`, `OR`, `XOR`, `NOT` |
| Array subscript operator | `[]` |
| Cell operator | `.` |
| Arrow operator | `->` |
| Conditional operator | `?:` |
| IN operator | `IN`, `NOT IN` |
| LIKE operator | `LIKE`, `NOT LIKE` |
| Bit operators | `BITAND`, `BITOR`, `BITXOR`, `BITLSHIFT`, `BITRSHIFT`, `BITNEG` |
| TYPEID operator | `TYPEID` |

The precedence rules for all operators can be found in [Appendix 2](operatorprecedence).

## Assignment operator

The assignment operator is used to assign a value to an existing variable, cell,
array element or member. An assignment operator may only appear once in an
expression, and has no resulting value.

When assigning a value to a cell, the assignment operator cannot create a new
cell or change the type of an existing cell - the assigned value must be
convertible to the type of the original value stored inside the cell.

The general syntax of the assignment operator is as follows:

```harescript
// Assign "Hello, World" to (an earlier defined) string variable `s`
s := "Hello, World";

// Modify the contents of cell `id` of record `file`
file.id := 7;

// Replace element #3 inside integer array `intarray` with element #2
intarray[3] := intarray[2];

// Illegal: the assignment operator cannot be used
// inside another expression
IF ( ( i := myvar) = 5) ...;
```

## Merge operators

The string merge operator merges two values together to form a new string. It
can merge strings, integers, and integer64 values. It cannot be used to
merge floating point, money or datetime values to a string - those types require
the use of a formatting function first.

The string merge operator is probably the most-used operator in HareScript. Its
general syntax is as follows:

```harescript
// Assign "Hello, World" to string `str`
STRING hello := "Hello," || " World";

// Append the number `5` to an existing string
hello := hello || `5`;

// Assign "25" to string `twentyfive`
STRING twentyfive := 2 || 5;
```

The array merge operator CONCAT merges two arrays of the same type together,
and returns a new combined array. CONCAT does not re-order the elements in the
individuals arrays, and does not eliminate duplicate elements. It is used as
follows:

```harescript
// Returns [ 1, 2, 2, 3, 4 ]
INTEGER ARRAY j := [ 1, 2 ] CONCAT [ 2, 3, 4 ];

//Illegal to merge a string array to an integer array
STRING ARRAY s := j CONCAT [ "abc", "def" ];

//Illegal: merging a single element to an array:
INTEGER i := 4;
INTEGER ARRAY k := [ 1, 2, 3 ] CONCAT i;

// Legal: first convert the element to a single element array,
// and then merge it
INTEGER ARRAY k := [ 1, 2, 3 ] CONCAT [ i ];
```

## Comparison operators

The comparison operators are used to compare two values of the same type, or
two values of a numerical type. Eg, the comparison operators can also compare
money values to floating point values, integers to money values, etcetera.

It is not possible to compare two values of a blob, record or table type, or to
compare two values of any array type. When comparing boolean values, `false` is
considered smaller than `true`.

Strings are compared based on the ordering of characters in the ASCII table.
For instance, "abcdef" < "pqrst" evaluates to TRUE, because `a` comes before
`p`. "ABCDE" < "abcde" evaluates to TRUE, because `A` comes before `a`. "abcd"
< "PQ" evaluates to FALSE, because "P"comes before "a".

A comparison operator always returns a boolean value, according to the following
truth table:

| Expression | Result |
| --- | --- |
| `A = B` | TRUE if A equals B |
| `A >= B` | TRUE if A is greater than or equals B |
| `A <=B` | TRUE if A is less than or equals B |
| `A > B` | TRUE if A is greater than B |
| `A < B` | TRUE if A is less than B |
| `A <> B` | TRUE if A is not equal to B |
| `A != B` | TRUE if A is not equal to B |

The following example code demonstrates the comparison operators:

```harescriot
// evaluates to TRUE
BOOLEAN b := 3 >= 1;

// evaluates to FALSE
BOOLEAN b := "Dog" < "Cat";

// evaluates to TRUE
DATETIME today := GetCurrentDatetime();
DATETIME start := MakeDate(1974,08,31);
BOOLEAN b := start != today;
```

## Arithmetic operators

The arithmetic operators are used to perform basic arithmetic operations on two
values of a numeric type. If the two types used in an arithmetic operation
differ, the operator automatically upgrades the smaller of the two types. The
resulting type of an arithmetic operation is the same as the largest type
involved in the operation.

The addition, subtraction, multiplication and division operators can be applied
to all numerical types (Integer, Float and Money). The modulus operator can only
be applied to integer values.

If the result of a division requires more precision than is available in the
final result type, it is rounded towards zero.

| Expression | Type | Result |
| --- | --- | --- |
| `A + B` | Addition | returns the sum of A and B |
| `A - B` | Subtraction | returns the difference between A and B |
| `A * B` | Multiplication | returns the product of A and B |
| `A / B` | Division | returns the quotient of A and B, rounded towards zero |
| `A % B` | Modulus | returns the remainder of A divided by B |

## Logical operators

The logical operators perform logical computation on boolean values. The NOT
operator is a unary operator, and must be followed by a boolean expression.
The AND, OR and XOR operators are binary operators, and must appear in between
boolean expressions. All logical operators return a boolean value.

The following thruth table applies to the logical operators:

| Expression | Type | Result |
| --- | --- | --- |
| `a AND b` | logical AND | evalutes to TRUE if both A and B are TRUE |
| `a OR b` | logical OR | returns TRUE if either A or B is TRUE |
| `a XOR b` | exclusive OR | returns TRUE if either A or B is TRUE, but not both |
| `NOT a` | logical NOT | returns FALSE if A is TRUE |

The following code gives examples on how the logical operators can and cannot
be used:

```harescript
// Stores TRUE in boolean `B`
BOOLEAN b := FALSE OR TRUE;
// Stores FALSE in boolean `B`
BOOLEAN b := NOT (TRUE XOR FALSE);
// Illegal: logical operators only work with boolean values
BOOLEAN c := TRUE AND 5;
```

The AND and OR operators are short-circuiting, which means that they won't
evaluate their second parameter if the first parameter is sufficient to
determine their end value. This permits the folllowing code:

```harescript
/* Safe, as the expression `myrec.id` won`t be evaluated unless
   `RecordExists(myrec) returns TRUE, so there is no risk of
   `Non-existing record`
errors */
IF (RecordExists(myrec) AND myrec.id > 2) ...;

/* Unsafe, as both expressions would be evaluated,
   and the second evaluation can
cause an error if the first evaluation returned FALSE */
BOOLEAN did\_record\_exist := RecordExists(myrec);
BOOLEAN is\_id\_greater\_than\_2 := myrec.id > 2;
IF (did\_record\_exist AND is\_id\_greater\_than\_2) ...;
```

## Array subscript operator

```
// Retrieving a value from an array
<array value> `[` <index> `]`

// Updating a value in an array
<array variable> `[` <index> `]` `:=` <new value> `;`
```

The array subscript operator allows direct access to an element inside an array.
It can be used to read or to update an element in array.

The `index` must be equal to or larger than 0 (zero), and smaller than the
number of elements in the array. Trying to access a non-existing element causes
a run-time error. To create elements, you must either use an array initialiser,
or an INSERT statement.

Within the index statement, the keyword `END` can be used for getting the length
of the array.

```harescript
STRING ARRAY strs := [ "a", "b" ];

// Prints the last string in the array strs
PRINT(strs[END - 1]);
```


## Cell operator

```
// Retrieving a cell from a record
<record value> `.` <cell name>

//Updating a cell in a record
<record value> `.` <cell name> `:=` <new value> `;`
```
The cell subscript operator allows direct access to a cell inside a record. It
can be used to read or to update cells in a record.

The specified cell name must already have been created in the record. Trying to
access a non-existing cell causes a run-time error. Cells can be created using
various statements and expressions, including a record initialiser and the
INSERT CELL statement.

## Conditional operator

```
<boolean expression> ? <result if true> : <result if false>
```

The conditional operator evaluates its first parameter, and if it evaluates to
_true,_ it returns its second parameter. Otherwise, it returns its third
parameter. The first parameter must evaluate to a boolean value, and the second
and third parameter must evaluate to the same type.

The conditional operator is short-circuiting in normal expressions, just like
the AND and OR operators. After evaluating the first parameter, it will only
evaluate the second or third parameter, but will never evaluate both. Although
the effect of the conditional operator is comparable to an IF statement, it
can be used in a context where an IF statement is impractical:

```harescript
// Use a different WHERE expression, depending on a pre-set boolean flag
BOOLEAN get\_all\_files := ...;
SELECT * FROM files WHERE get_all_files ? TRUE : files.parent = parent_id;

// Stores `10` into `i`, because `8 < 5` is false.
INTEGER i := 8 < 5 ? 100 : 10;

// Illegal, the type of the second and third parameter may not differ
10 > 100 ? 15 : "string";
```

## IN operator

```
<value> IN <array value>

<value> NOT IN <array value>
```

The `IN` operator (or `is element of` operator) is used to check whether a
certain value exists in an array. The operator returns a boolean value, which
is true if the requested element indeed exists in the specified array. The `NOT
IN` operator operates in the exact opposite manner, returning the boolean value
true when the requested element does not exist.

The array must be an array of the same type as the value that is being looked
for.

## LIKE operator

The `LIKE` operator offers wildcard pattern matching, and returns true when a
given value matches a specified pattern. In the pattern, a `?` is used to
signify `any` character, a `*` indicates `any amount of any character`, and
any other character indicates that this character must appear as-is in the given
value. The pattern matching is always performed case-sensitively. The `NOT LIKE`
operator can be used to obtain the logical NOT of the return value of the `LIKE`
operator.

The following code gives some examples of this pattern-matching:

```harescript
// Stores `true`, as the text matches the pattern
BOOLEAN b := "hello.txt" LIKE "*.txt";

// Stores `true`, as every `?` is matched by a character
BOOLEAN b := "1234567" LIKE "12?45?7";

// Stores `false`, as a `?` must match at least one character
BOOLEAN b := "abc?def" LIKE "abcdef";

// Stores `false`, as pattern mathing is done case-sensitively
BOOLEAN b := "ABCDEF*" LIKE "abc*";

// Stores `false`, as the text does match the pattern

BOOLEAN b := "hello.txt" NOT LIKE "*.txt"
```

## Explicit arrays
Arrays can be prefixed with their type to generate that array, eg `STRING[]` is an empty array of strings. A record can also
be explicitly built by prefixing the cell list with `CELL`. `CELL[]` is an empty record (not a default record!)

```harescript
// instead of
INTEGER ARRAY ids := [INTEGER(myrecs[0].id), myrecs[1].id)];
// write
INTEGER ARAY ids := INTEGER[myrecs[0].id, myrecs[1].id];

// instead of
DEFAULT INTEGER ARRAY
// write
INTEGER[]
```

## Record and Array spread
We recommend using %ValidateOptions or the rest/spread syntax instead of MakeUpdated/Replaced/OverwrittenRecord (etc)

```harescript
INTEGER ARRAY x1 := [1,2,3];
INTEGER ARRAY x2 := [...x1,4]; // [1,2,3,4]
INTEGER ARRAY x3 := [0,...x1]; // [0,1,2,3]

// concatenate
INTEGER ARRAY x4 := [...x1, ...x2, ...x3];

RECORD y1 := [ c1 := 42 ];
RECORD y2 := [ ...y1, c2 := 43]; //[c1 := 42, c2 := 43];

// anything before the ', ...<spread>' acts a default
RECORD y3 := [ c1 := 41, ...y1]; //[c1 := 42 ];
RECORD y4 := [ c0 := 40, ...y1]; //[c0 := 40, c1 := 42 ];

// and we can delete cells we don't like
RECORD y5 := [ ...y4, DELETE y1]; //[c0 := 40]

// or combine records
RECORD y6 := CELL[ ...y1, ...y2, ...y3, ...y4 ];

// it can function as some sort of 'options'
MACRO MyMacro(RECORD options) // options.formatc - set to true to free all disk space
{
  options := [ formatc := FALSE, ...options ]; //but you should probably prefer ValidateOptions
}
```

## Structuring

```harescript
INTEGER i1 := 1, i2 := 2;
// instead of
RECORD y6 := [ i1 := i1, i2 := i2 ];
// we can do
RECORD y6 := CELL[ i1, i2 ]; //[ i1 := 1, i2 := 2]
// You can also use records cells and member names
RECORD rec := (some value);
OBJECT obj := (some value);
RECORD y6 := CELL[ rec.a, obj->b ]; //[ a := (value of rec.a), b := (value of obj->b) ]
// Also, you can use strings
RECORD y6 := CELL[ "a", "b" ]; //[ a := "a", b := "b" ]
```

Please note that structuring *requires* you to prefix the record list with `CELL[`, otherwise `[i1,i2]` would be interpreted as an array.

## Bit operators

The bit operators can be used to perform operations at the bit level on integer
values. The BITNEG operator is a unary operator, and must be followed by an
integer expression. All other bit operators are binary operators, and must
appear in between integer expressions. All bit operators return an integer
value.

The following table defines the effect of the bit operators:

| Expression | Result |
| --- | --- |
| `BITNEG a` | Returns the value `a` with all bits inverted (all 0s become 1s, and vice versa). |
| `a BITOR b` | Returns a value in which every bit is set that is set in either `a` or `b`. |
| `a BITAND b` | Returns a value in which every bit is set that is set in both `a` and `b`. |
| `a BITXOR b` | Returns a value in which every bit is set that is set in either `a` or `b`, but not in both. |
| `a BITLSHIFT i` | Returns a value with all bits in `a` shift `i` positions to the left. The newly inserted bits will all be zero. If `i` is smaller than 1, nothing happens. If `i` is larger than 31, 0 (zero) is returned. |
| `a BITRSHIFT i` | Returns a value with all bits in `a` shift `i` positions to the right. The newly inserted bits will all have the same value as the most significant bit in the original value (a negative value will never become positive). If `i` is smaller than 1, nothing happens. If `i` is larger than 31, either -1 or 0 is returned, depending on the original value. |

The following code gives examples on how the logical operators can and cannot be
used:

```harescript
// Stores -6 in integer `i`
INTEGER i := BITNEG 5;
// Stores -2 in integer `i`
INTEGER i := -8 BITRSHIFT 2;
// Illegal: bit operators only work with integer values
INTEGER i := 7 BITAND 2.5;
```

## TYPEID operator

```
TYPEID(<type>)
TYPEID(<expression>)
```

The `TYPEID` operator is used to obtain the _type number_ of a HareScript type
or a HareScript value. This function is mostly used to detect the type of a
cell inside a record, when you have no other way of knowing the cell's type
(eg, after a call to the _UnpackRecord_ function).

In most practical applications, this function will not be that useful, as you
will usually know which types you stored inside a record. The `TYPEID` operator
is however sometimes useful when debugging HareScript applications, or when
writing `general` conversion functions. Some database drivers use _type
numbers_ to communicate the HareScript types used in returned record arrays.

You should not expect the returned integer values to have any special meaning,
or to remain constant between different versions of the HareScript compiler. It
is not possible to request the type id of a _table_ or _schema_ variable.

A simple example of the `TYPEID` operator follows:

```harescript
VARIANT value := DecodeJSON(jsonvalue);
SWITCH (TypeID(value))
{
  CASE TypeID(INTEGER) { PRINT("This is an INTEGER"); }
  CASE TypeID(STRING)  { PRINT("This is a STRING"); }
  DEFAULT              { PRINT("This is something else"); }
}
```
