# Variable types

HareScript offers various types for storage and manipulation of data, such as
_boolean_, _float_ and _string_. A few types, such as _record_, _blob_ and the
array types, can be used to store nearly infinite amounts of data. Function
calls (also function pointers or callbacks) can be stored using the _function
ptr_ type. HareScript also supports two `special` types, Table and Variant,
which cannot be used in the language itself, but are used to communicate with
external databases and functions.

## Integer

Integers are used to store non-fractional values in the range -2,147,483,648
(-(2^31)) to 2,147,483,647 (2^31-1).

An integer variable that is not explicitly initialised will contain the value
0 (zero). The following code shows examples of how to define integer variables:

```harescript
// Definition of integer `example1` with value 13
INTEGER example1 := 13;

// Definition of integer `example2`: a value of 0 is presumed
INTEGER example2;

/* Definition of integer `example3`, using an expression to set its value */
INTEGER example3 := file.id;
```
### 64-bit integers

64-bit integers have a larger range and can store non-fractional values in the
range -9,223,372,036,854,775,808 (−(2^63)) to 9,223,372,036,854,775,807 (2^63−1).

The following code shows examples of how to define 64-bit integer variables:

```harescript
// Definition of integer `example1` with value 13,000,000,000 (the i64 suffix is
// needed, because the value would be interpreted as a money value instead)
INTEGER64 example1 := 13000000000i64;

// Definition of integer `example2`: a value of 0 is presumed
INTEGER64 example2;

/* Definition of integer `example3`, using an expression to set its value */
INTEGER64 example3 := file.size;
```
## Boolean

Booleans are used to store '_truth_' values. A boolean variable contains either
the value _true_ or _false_.

A boolean variable that is not explicitly initialised will contain the value
_false_. The following code shows examples of how to define boolean variables:

```harescript
// Definition of boolean `example1` with value TRUE
BOOLEAN example1 := TRUE;

/* Definition of boolean `example2`, using an expression
   to set its value */
BOOLEAN example2 := file.name = "test";

// Definition of boolean `example3`, implicitly initialised to FALSE
BOOLEAN example3;
```

## String

A string contains a series of characters. It can be empty (contain no characters
at all), and may contain an unlimited number of characters, limited only be the
amount of available memory. For efficiency reasons, it's recommended to keep
strings to a short length (a few hundred characters) where possible, as
performing operations on long strings can be relatively slow.

As strings consist of 8-bit characters, the data in strings should normally be
UTF-8 encoded. PRINT and most Encoding functions (eg, EncodeHTML) will then take
care of properly encoding the character sequences in the final output format. To
use special characters in a string, you need to use escape sequences.

A string variable that is not explicitly initialised will contain an empty
string. The following code shows examples of how to define string variables:

```harescript
// Definition of string `example1` with initial value `Johnny and Jane`
STRING example1 := "Johnny and Jane";

// Definition of string `example2`: string is presumed to be empty
STRING example2;

/* Definition of string `example3`, using an expression to set
   the value */
STRING example3 := "Name:" || file.name;
```

### Template literals

A template literal is a string which starts and ends with a backtick (`` ` ``)
in which other expressions can be placed inline. This avoids having to
concatenate a lot of parts together.

Expressions can be placed inside the literal using the syntax `${ <expression >
}`. When evaluating the literal, this expression is concatenated to the rest
of the string using the string concatenation operator (`||`).

Example:
```harescript
// Results in "1 + 1 = 2"
STRING a := `1 + 1 = ${ 1 + 1 }`;

// greeting will have the value "Hello, John!"
STRING name := "John";
STRING greeting := `Hello, ${ name }!`;

// Illegal: cannot concatenate a float to a string
STRING b := `This piece of wood is ${1.5f} meters long`;
```

## Blob

A blob type is used to store a reference to a file or other large object on disk,
or inside a database table. The name blob is short for `Binary Large OBject`.

Blob variables can be read using blob functions, but can never be modified. To
create a new blob from scratch, the stream functions and MakeBlobFromStream
should be used.

Blobs are sometimes more useful than strings, as a blob usually takes up little
memory until it is opened, and a string always consumes at least the memory it
needs to store its own data. Another advantage of blobs is that some databases
can optimise their handling of blobs in ways that they cannot optimise other
objects.

A blob variable that is not explicitly initialised will contain a 0-byte blob.
The following code shows examples of how to define blob variables:

```harescript
// Definition of blob `example1` with a file from the Repository
BLOB example1 := OpenWHFSObject(1)->OpenByPath("path/to/file").data;

// Definition of blob `example2`, containing the text Hello, World
INTEGER blobstr := CreateStream();
PrintTo(blobstr, "Hello, World\n");
BLOB example2 := MakeBlobFromStream(blobstr);

// Definition of blob `example3`, implicitly initialised with an empty blob
BLOB example3;
```

## Datetime

The Datetime type is used to store date and/or time values. The type supports
dates starting from January 1st, year 1, and can stores time values with
millisecond precision.

A datetime type can also contain an `invalid` date, which is defined as a
special value that is smaller than all other date and time values. This value is
usually used to indicate that a date is not known, or an invalid date was
received somewhere.

Although a datetime value contains both a date and a time part, in some contexts
only a date or time value may be interesting. In those cases, it's customary to
use the first day (January 1st, year 1) or midnight (00:00, or 12:00 am) for
unused values.

A datetime variable that is not explicitly initialised will contain the _Invalid
date value_ (as given by `DEFAULT DATETIME`). The following code shows examples
of how to define datetime variables:

```harescript
/* Definition of datetime 'example1' with a value representing the current date
and time on the WebHare server */
DATETIME example1 := GetCurrentDatetime ();

/* Definition of datetime 'example2', with a value representing August
   31st 2002, midnight*/
DATETIME example2 := MakeDate (2002, 08, 31);
```

The datetime type and associated functions assume takes leap years into account.
The datetime type always calculates according to the Gregorian calender rules,
so calculations with datetime values before 1582 will not be historically
accurate. The maximum upper range of the datetime type is somewhere after the
58000th century, which shouldn't be a problem in any practical application.

## Money

Money types are used to store fractional values in the range
-92,233,720,368,547.75808 to 92,233,720,368,547.75807. Money values support up
to 5 decimals, but unlike floating point values, they have no accuracy loss when
storing decimal values.

A _money_ variable that is not explicitly initialised will contain the value 0
(zero). The following code shows examples of how to define _money_ variables:

```harescript
// Definition of money variable 'example1' with value 2.20371
MONEY example1 := 2.23071;

// Definition of money variable 'example2': a value of 0 is presumed
MONEY example2;
```

## Float

Float types are used to store fractional or large values in the range
-10³⁰⁸ to 10³⁰⁸, approximately. Floating-point values are not able to store most
decimal values exactly. Instead, floating point values attempt to store the best
possible approximation of a decimal value. This is not a limitation of
HareScript, but a general `problem` with floating point values. The
approximation may differ slightly between HareScript and WebHare versions.

In most cases where floating-point values are used, this limitation is not a
problem. However, floating points should never be used when loss of precision is
unacceptable, e.g. when doing financial calculations. The money type is often
better suited for such usage.

A floating-point variable that is not explicitly initialised will contain the
value 0 (zero). The following code shows examples of how to define
floating-point variables:

```harescript
// Definition of money variable `example1` with value 2.20371
FLOAT example1 := 2.3532458435253;

// Definition of money variable `example2`: a value of 0 is presumed
FLOAT example2;
```

## Array types
An array is not a separate type, but a modifier that can be applied to existing
types. It creates a list of elements of the original type, and allows you to
access the elements by their number in the list (their _subscript_). The size
of an array can be dynamically changed.

All elements in an array are numbered consecutively, beginning at 0 (zero). If
an element is deleted from the array, all elements after it are shifted
backwards, so that the elements in an array of `n` elements are always numbered
0 to n-1.

All elements in an array must be of the same type. HareScript does not allow the
creation of multidimensional arrays, or an array-of-arrays. However, it's
perfectly acceptable to create an array of records, and store arrays in the
cells of the individual records.

An array that is not explicitly initialised will contain no elements. The
following code shows examples of how to define array variables:

```harescript
// Create an array of four integers, initialising them to 1,2,3 and 4
INTEGER ARRAY intarray := [ 1,2,3,4 ];

// Create an empty array of strings
STRING ARRAY strarray;
```

### Automatic conversion of record arrays

HareScript will automatically convert a record array to a record, if a record
array is used in a context where a record is required. This conversion is done
by taking the first element of the record array and returning that record. An
empty record array is converted to a non-existing record.

This automatic conversion allows the following code fragments to work without
type-checking errors:

```harescript
// Get any file matching the WHERE criteria
RECORD myfile := SELECT * FROM files WHERE parent=5 AND name="abc.txt";

// See if the folder with id `6` has any subfolders
IF (RecordExists(SELECT FROM folders WHERE parent=6)) ...;

// Get the ID of user `sysop`
INTEGER sysop\_user\_id := (SELECT id FROM users WHERE name="sysop").id;
```

The automatic conversion is only permitted when evaluating a record array - it
may not occur on the left side of an assignment operator. For example, the
following code is illegal:

```harescript
// Illegal: Try to overwrite the name cell of the first returned record
RECORD ARRAY allfiles := SELECT name FROM files;
allfiles.name := "Trying to set a new name";
```

## Record

The _record_ type is used to store a collection of values, which can be of
various types. Each value is uniquely referred to by its _cell name_. A record
can store an unlimited number of cells, but a cell name may only be up to 64
characters in length. A record that does not contain any cells can be either
_empty_ or _non-existing_.

A non-existing record is created by using `DEFAULT RECORD`, by using a _record_
variable that hasn't been initialised with any value, or as a result of a
`SELECT` that did not find any matching records. Some functions, such as
FindFile, also return a non-existing record if they were unable to find the
requested data.

An empty record is created by using `CELL[]`, by a SELECT that did not select
any columns, or by deleting all cells from a record.

The following example shows how to define a record variable:

```harescript
/* Definition of record `example1` using a SELECT statement */
RECORD example1 := SELECT * FROM FOLDERS WHERE FOLDERS.NAME = "news";

/* Definition of record `example2`, using a FIND function*/
RECORD example2 := FindFile (1);
```

## Table
```
TABLE <table-field-list> <identifier> [ := <expression> ] ';'

<table-field-list> ::= '<' <table-fields> [ ';' KEY <table-field-names> ] '>'
<table-fields> ::= <table-field> [ ',' <table-fields>]
<table-field> ::= <type-specifier> <column-name> [AS <column-name>]
                  [ NULL := <constant> ]
<table-field-names> ::= <table-field-name> [ `,` <table-field-names> ]
```

The _table_ type is used to refer to a table inside an external database.
Variables of this type cannot be passed to HareScript functions, but only to
external functions. Inside HareScript expressions and statements, tables can
only appear after an `INTO` or a `FROM` clause of a SQL statement.

A table variable does not represent an actual table, but merely a binding to a
table inside a transaction. The normal way to associate table variables with an
external database is to open a transaction, and then pass that transaction id
and the table's name to a call to the _BindTransactionToTable_() function.

When defining a table variable, you also need to specify a list of column names
and types that the table will contain. You can optionally use `AS` to give a
column a different name in HareScript than the name that is used to refer to the
actual tables by the transaction driver.

This list will be used to check statements, to explain the table provider how to
convert the database's native types to HareScript types, and to provide a column
list for `SELECT *` statements. For more information on how a table provider
will interpret this column list, you will need to refer to the documentation
for that table provider.

An example of how a HareScript might connect to the WebHare _files_ table is
presented below. Note that the column list in this example is not the complete
list of columns in the _files_ table:

```harescript
LOADLIB "mod::system/database.whlib";

//Define the structure of the system.fs_objects table
TABLE fs_objects
< INTEGER id
, INTEGER parent
, BOOLEAN isfolder
, STRING name
, STRING title
>;

//Connect to the database
INTEGER webhare_transaction := OpenPrimary();

//Bind the transaction we just opened to the 'system.fs_objects' table
fs_objects := BindTransactionToTable(webhare_transaction, "system.fs_objects");
```

### NULL conversions

HareScript does not directly support the SQL 'NULL value', a separate value for
a variable of any type, which is different from all other values. When reading
NULLs from an external table, the database driver will usually convert NULL
values to the default value for a type. For example, a NULL integer value will
be converted to `0` in the returned HareScript record arrays, and a NULL string
value will be converted to an empty string.

This conversion is usually fine when reading data from an external database, but
makes it harder to explicitly insert NULL values into the database, or to
distinguish between the real value `0` and the NULL value in a table when both
values are valid. To solve this problem, HareScript allows you to explicitly
define a substitution value for the NULL value. HareScript will then convert any
NULLs it see to the specified value, and will convert the specified value to
NULL when it is used in any database query. You should ensure that this
substitution value can never occur as actual data in the table.

The following code gives an example on how the NULL conversion can be used to
write real NULLs to an external database:

```harescript
//Bind table `mydata` to some external database
//(eg, an MS Access dbase via ODBC)
TABLE mydata<INTEGER ref NULL -1, STRING name> := ....;

//This will insert a NULL into the `ref` field in the real table
INSERT INTO mydata(ref, name) VALUES(-1, `No reference`);

//Selecting the NULL will return `-1` in `ref`.
RECORD inserted\_data := SELECT * FROM mydata WHERE name = `No reference`;
```

### KEY lists

Key lists can be used to define which column(s) can be considered the primary
key for a table. This is intended as an extra aid for some database drivers,
which require a primary key in the data to be able to update and delete rows,
and cannot accurately tell which fields would be a proper primary key.

None of the available database drivers for HareScript currently support an
explicit specification of the primary keys, so using a KEY specification will
not have any effect yet.

## Schema

```
SCHEMA <schema-table-list> <identifier> [ := <expression> ] ';'
SCHEMA <identifier> LIKE <identifier> [ := <expression> ] ';'

<schema-table-list> ::= '<' <table-declarations> '>'
<table-declarations> ::= <table-declaration> [ ',' <table-declarations>]
<table-declaration> ::= 'TABLE' <table-field-specification> columnname [ 'AS' identifier ]");
```

The _schema_ type is used to refer to a schema with multiple tables inside an
external database. Just as with variables of type _table_, variables of this
type cannot be passed to HareScript functions, but only to external functions.
Inside HareScript expressions and statements, schemas can only appear after an
`INTO` or a `FROM` clause of a SQL statement.

```harescript
//Bind table `myschema` to some external database
//(eg, an MS Access dbase via ODBC)
SCHEMA
< TABLE
  < INTEGER ref NULL -1
  , STRING name
  > mytable
> myschema := ...;

//This will insert a NULL into the `ref` field in the real table
INSERT INTO myschema.mydata(ref, name) VALUES(-1, `No reference`);
```

## Variant

The _variant_ type is not a 'real' HareScript type, as it cannot be used to
define a variable. External functions can accept and return expressions of type
_variant_, which merely tells the HareScript compiler that the function accepts
any type of argument. An example of such a function is _Length_, which accepts
many different types, such as a _record array_ or a _string_, as its argument.

You may also see the type name _variant_ mentioned inside error or warning
messages generated by the compiler when it tries to refer to a type, but it
doesn't know the exact type of the variable yet.

## Function pointers

Function pointers allow you to store a call to a function inside a variable.
A function pointer is a very flexible way of re-using and selecting code inside
a function. Although a SWITCH or IF statement can often do the job, a function
pointer allows you to build code which will also work with new, unforeseen
cases.

You can use two different names for the function pointer: either `FUNCTION PTR`
or `MACRO PTR`. These type names are considered equivalent by the HareScript
compiler. All examples here will use the `FUNCTION PTR` type name.

A function pointer value is generated by the PTR keyword, which must be followed
by the name of the function, and optionally, any arguments which will be passed
to that function. If no arguments list is passed (not even `( )`), a function
pointer is generated which takes just as many arguments as the original
function.

When declaring a function pointer, _argument placeholders_ can be used to
indicate that the arguments passed in a function pointer call should be passed
to that function. An argument placeholder consists of a math symbol (#) followed
by the argument number. The leftmost argument is #1.

Instead of using an argument placeholder, you can also specify a value for an
argument. This value will then be passed to the function pointer when it is
invoked. Specifying a value for an argument (often called _binding_) allows you
to build function pointers which take a different number of arguments than the
function they refer to.

A function pointer is called by simply referring to the variable (or record
cell) as if it were a function. If the function pointer is declared to not
accept any arguments, a call to it must still have an empty argument list,
just like a normal function would require. A couple of examples of function
pointers follow:

```harescript
//A pointer to the Left function, which takes two values and
//passes these to Left
FUNCTION PTR MyLeftFunction := PTR Left(#1, #2);
//This function pointer could be invoked as follows:
Print("The left 3 characters of abcdef are: "
   || MyLeftFunction("abcdef",3));

//The same function pointer, now using the default argument list
FUNCTION PTR MyLeftFunction := PTR Left;
//This function pointer could be invoked as follows:
Print("The left 3 characters of abcdef are: "
   || MyLeftFunction("abcdef", 3));

//A pointer to the Left function, swapping both parameters
FUNCTION PTR MyLeftFunction := PTR Left(#2, #1);
//This function pointer could be invoked as follows:
Print("The left 3 characters of abcdef are: "
    || MyLeftFunction(3, "abcdef"));

//A pointer to the Left function, which always takes the left 3 charcters
FUNCTION PTR MyLeftFunction := PTR Left(#1, 3);
//This function pointer could be invoked as follows:
Print("The left 3 characters of abcdef are: " || MyLeftFunction("abcdef"));

//An example of an incorrect pointer: missing one argument to Left
FUNCTION PTR MyLeftFunction := PTR Left(#1);
//An example of an incorrect pointer: no arguments at all,
//but Left requires 2
FUNCTION PTR MyLeftFunction := PTR Left();
```

Default argument values are necessarily disabled by function pointers. For
example, the _ToInteger_ function takes either two or three arguments. A
function pointer to the _ToInteger_ function would always require three
arguments, unless one of the arguments is bound.

## Objects

The _object_ type is used to hold a reference to an object instance. An instance
is a grouping of data and related functionality, and has a pre-defined
structure (its [object type](structure#object-types)).

The data and methods of an object instances can be accessed using the
arrow (`->`) operator.

Objects are garbage collected, via manual calls to `CollectGarbage()`.

### WEAK objects
A _weakobject_ is a weak reference to an object instance that. In contrast
to normal references, this reference does not prevent garbage collection of the
referenced instance. When the instance is collected, the weak reference is
reset.

To use this reference, convert it to a normal reference using a cast to
_object_.

```harescript

OBJECT o := NEW MyObjectType;

WEAKOBJECT w := WEAKOBJECT(o);

// w is still a valid reference at this point
OBJECT(w)->DoStuff();
o->DoStuff();

// This will collect the instance
CollectGarbage();

// This fails if no additional references to the object were made.
OBJECT(w)->DoStuff();

```
