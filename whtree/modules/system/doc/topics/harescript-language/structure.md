# Language structure

This section shows the basic building blocks of a HareScript file, and introduces
some of the terms that will be used throughout this manual.

## HareScript code and comments

HareScript code is always placed between `<?wh` and `?>` tags. Text outside these
tags is treated as a `PRINT` of that text. A shebang (`#!interpreter`) line at
the start of the file is ignored.

Inside HareScript code, comments can be added by prefixing them with `/*` or `//`.
Any comment starting with `/*` must be terminated by `*/`, and any comment starting
with `//` automatically ends at the end of the line.

Some of the above character sequences are interpreted differently when they are
contained inside a _string constant_. A string constant is a sequence of characters
contained between either single `'` or double `"` quotes, which is not part of a
comment. In other words, a single or double quote appearing after a `//` character
sequence, is not interpreted as a real string constant. Inside string constants,
HareScript close tags (`?>`) and comment starting characters (`/*` and `//`) are
not recognized.

The following code fragments show the interactions between end tags, comments and
string constants:

```harescript
<?wh /* This is a valid way to start and end a comment */ ?>
<?wh /* Closing tags inside comments are ignored ?> so this is still part of the comment */ ?>

<?wh // The following statement is never executed: PRINT("Hello, World!");
?>

<?wh PRINT("// This text is printed, and not recognized as a comment"); ?>
<?wh PRINT("/* This text is printed, and not recognized as a comment */"); ?>
<?wh PRINT("The closing tag ?> is printed, and does not end this code block"); ?>
```

It's not required to close the last block of HareScript code with a `?>`. Omitting
the closing tag can be useful when writing libraries, as some editors may append
empty lines to the end of a library. If these empty lines would appear outside a
HareScript code block, they may appear as empty lines at the top of the HareScript
output.

## HareScript statements and blocks

In HareScript, a semicolon (`;`) is used to terminate statements. Statements can
be grouped together into blocks using curly braces (`{` and `}`). Grouping
statements can be used to add structure to a block of code, and to use multiple
statements with control statements such as IF and FOREVERY. The following code
fragments demonstrates the use of semicolons and statement blocks:

```harescript
/* The first PRINT is not executed, the second one is,
   because the first semicolon terminates the IF statement */
IF (false) PRINT("Not displayed"); PRINT("Displayed");

/* Both PRINT statements are executed when curly braces are used */
IF (false) { PRINT("Not displayed"); PRINT("Not displayed either"); }

/* Even in statement blocks, the last statement must
   be terminated by a semicolon: the following code is illegal: */
{ PRINT("Illegal code") }

/* A statement block `counts` as a single statement, so it shouldn`t
   be followed by a semicolon in a context where only one
   statement is permitted.
   This makes the following code legal: */
IF (true) { PRINT ("True"); } ELSE { PRINT ("False"); }

/* But the following code is illegal, because only one statement or block may
appear between IF and ELSE: */
IF (true) { PRINT ("True"); }; ELSE { PRINT ("False"); }
```

A HareScript close tag is always interpreted as a semicolon. This is important to
realize when a HareScript close tag is immediately used after a WHILE or IF
statement. As the following example shows, you'll often want to use a semicolon
block in that case:

```harescript
<?wh
/* The following code is illegal, it looks to the compiler as:
  `IF; (false)`, and the semicolon after the IF is illegal: */
IF ?><?wh (false) PRINT("false");

/* The following text is always printed, it looks to the compiler as:
   `IF (false); PRINT("This is printed"); - the semicolon terminates the IF */
IF (false) ?>This is printed<?wh ;

/* The following text is not printed, it looks to the compiler as:
   `IF (false) { PRINT ("This is printed"); }  */
IF (false) { ?>This is printed<?wh }
```

## Identifiers

An `identifier` is a name for a variable, function, macro, object type or cell
in HareScript. All identifiers have the same common rules determining how they
can be named, and which names are considered identical.

An identifier name may be up to 64 characters in length, and must start with
either a letter or an underscore. An identifier name may contain only letters,
numbers and underscores.

All identifier names are case-insensitive - the identifiers "myint" and "MyInt"
are considered equal. The reserved keywords, listed in [Appendix 1](keywords),
may never be used as an identifier name.

Cell names have fewer restrictions than identifier names, so it may be necessary
to 'escape' a column name by using a string constant. This is only permitted in
contexts where the HareScript compiler can unambiguously determine that a column
is being referred, as shown in the following example:

```harescript
// Access cell "column data" from record rec;
STRING mystr := rec."column data";

// Select the cell "column data", renaming it to coldata, from table MYTABLE
SELECT mytable."column data" AS coldata FROM mytable;

/* Illegal: the compiler isn`t sure whether you`re trying to
   create a column with the contents "column data", or selecting
   the column "column data" */
SELECT "column data" FROM mytable;

// Select the column named "column data"
SELECT COLUMN "column data" FROM mytable;
```

## Variables
```
[ PUBLIC ] <type> <variablename> [ := value ]
              [ , <variablename> [ := value ] .... ];

[ PUBLIC ] TABLE <table-specification> <variablename> [:= value];

[ PUBLIC ] SCHEMA <schema-specification> <variablename> [:= value];
```

A variable is defined in HareScript by specifying its type, its name, and
optionally assigning it a value and an external visibility specifier.

The external visibility specifier, PUBLIC or PRIVATE, is optional and defaults
to PRIVATE if not specified. This specifier is explained in the libraries
section. The external visibility specifier may only be used for global
variables. For tables, an table specification must be provided.

The initial value for a variable is also optional. Every type has its own default
value that will be used when no value is specified at its point of definition.
Except when defining TABLE or SCHEMA variables, more than one variable of the
same type can be defined in one statement by separating the definitions by a
comma.

### Global variables

A variable that is defined outside any statement block (a block delimited by `{`
and `}`) is considered a _global_ variable. A _global_ public variable is shared
between libraries if both libraries are loaded (directly or indirectly) by a
single script. For example, in the code below, there is only one variable `i`,
even though library lib1 is loaded twice.

```harescript
// Contents of library 1:
PUBLIC INTEGER i := 1;

// Contents of library 2:
LOADLIB "library 1";
i := i + 1;

// Contents of library 3:
LOADLIB "library 1";
i := i + 1;

// Contents of the HareScript that is being executed
LOADLIB "library 2";
LOADLIB "library 3";
LOADLIB "library 1";
PRINT("i = " || i); // this will print `3`.
```

### Local variables

A variable that is defined inside a statement block (a block delimited by `{`
and `}`) is considered a _local_ variable. It is only visible inside the block
in which it was defined, and any blocks contained in that block. If a variable
is defined inside a function, it is created for every call to the function.
For example, in the following code, each call to function Faculty has its 'own'
variable `i` - they cannot see each other's variable and `i` will never have a
value higher than `1`:

```harescript
INTEGER FUNCTION Faculty(INTEGER value)
{
  INTEGER i;
  i := i + 1;
  PRINT ("i is now " || i || "\n");
  IF (value<=1) RETURN 1;
  RETURN value * Faculty(value-1);
}

INTEGER faculty\_of\_5 := Faculty(5);
```

### Visibility rules and name conflicts

It is illegal to define two variables with the same name inside the same
statement block. It is allowed to define a local variable with a name
that is already used in an eclosing scope, but the compiler will issue a warning
in that case. When an expression refers to a variable, it will always use the
'closest' variable definition, as demonstrated in the following example:

```harescript
INTEGER i := 1;
MACRO MyMacro()
{
  INTEGER i := 2;
  {
    INTEGER i := 3;
    PRINT("i is now " || i || "\n"); //prints `3`
  }
  PRINT("i is now " || i || "\n"); //prints `2`
}
PRINT("i is now " || i || "\n"); //prints `1` (the global variable `i`)
```

It is illegal to define a global identifier (variable, function or macro) with
the same name as another global identifier defined or exported by the same
library.

### Ordering of definitions

In contrast to functions and macros, all variables must be defined before they
are first used. All variables receive their initial value, if any, at the point
of their definition. If a variable is read before the code at its point of
definition has been executed, the reader will see the variable's default value,
as shown in the following code:

```harescript
///This will print `0`, because variable i is not yet initialized
///at this point
PRINT (GetVarI() || "\n");

INTEGER i := 5;

///This will now print `5`
PRINT (GetVarI() || "\n");

INTEGER FUNCTION GetVarI()
{
  RETURN i;
}
```

## Functions and Macros
```
[ PUBLIC ] <type> [ AGGREGATE ] FUNCTION <name> ( [arguments] ) [attributes] { <code> }

[ PUBLIC ] MACRO <name> ( [arguments] ) [attributes] { <code> }
```

Functions and macros allow you to reuse code and organise HareScript code into
logical portions. Some functions and macros also allow you to interface with the
'external world', such as printing HTML code, opening a file, or committing a
database transaction.

A function can optionally take one or more arguments, and must always return a
value using the keyword RETURN. A macro can also take arguments, but never
returns a value.

All functions and macros must be defined at the `top level`, after any LOADLIB
statement. They cannot be defined inside another function or macro, or inside any
statement block delimited by curly braces.

The external visibility specifier, PUBLIC or PRIVATE, is optional and defaults
to PRIVATE if not specified. This specifier is explained in the libraries
section.

The `<type>` before the keyword FUNCTION specifies the type of data the function
returns. The argument lists and attributes are explained in the following
sections. The function definition must follow immediately, between curly braces,
unless the function has been marked as an external function in its attribute
list.

The AGGREGATE keyword converts a function into an aggregate function.

Function names must follow the same rules as other identifiers. It is not
allowed to define a function or macro with the same name as any other global
identifier defined or exported by the same library.

### Argument lists

A function or macro can take one or more arguments. For every argument a
function takes, it must define a name and an expected type, and it can optionally
define a `default` value if the argument is omitted by using the _defaultsto_
keyword. In an argument list, no arguments without a default value may follow an
argument with a default value.

To create a function that accepts a variable number of arguments, the last
argument can be converted to a variable-length argument by using `...`. That
variable MUST have the type `VARIANT ARRAY`. When calling such a function, all
arguments that don't have a corresponding 'normal' paremeter will be put into
an array which is passed to the function in the variable-length argument.

The following code gives some examples of legal and illegal argument lists:

```harescript
// A function returning an integer, and taking two integers
INTEGER FUNCTION Multiply(INTEGER left, INTEGER right)
{ RETURN left * right; }

// A function returning a money value, and taking one or two money values
MONEY FUNCTION ExchangeMoney(MONEY orginalamount, MONEY rate DEFAULTSTO 2.20371)
{ RETURN originalamount * rate; }

// Illegal: all arguments must have a type and a name
MACRO badmacro(firstarg, INTEGER)

// Illegal: all arguments following a default value must also have
// a default value
INTEGER FUNCTION badfunc(INTEGER firstarg DEFAULTSTO 2, INTEGER secondarg)

// A function accepting a variable number of arguments
MACRO vararg(INTEGER arg1, VARIANT ARRAY ...rest)
```
### Asynchronous functions

```
[ PUBLIC ] ASYNC FUNCTION <name> ( [arguments] ) { <code> }
[ PUBLIC ] ASYNC MACRO <name> ( [arguments] ) { <code> }
```

Using `ASYNC` with a function converts the function to an asynchronous function
which returns a promise. For an `ASYNC FUNCTION` this this promise will be
resolved to the value passed to `RETURN <expression>;`, for an `ASYNC MACRO`
the promise will be resolved with a `DEFAULT RECORD`. If the function throws
an exception, the promise will be rejected with the throw exception object.

Initially an asynchronous function is executed synchronously, until the first
encountered AWAIT-expression. The expression passed to `AWAIT` is first
converted to a promise. Later on, when that promise is resolved with a value,
the AWAIT-expression returns with that value. However, if the promise is
rejected (with an exception) that exception is thrown from the expression.

```harescript
ASYNC FUNCTION AsyncFunc()
{
  PRINT("Started\n");

  /* Converts the return value of OtherCall() to a promise, waits for
     that promise to resolve, and puts the resolved value into retval */

  INTEGER retval := AWAIT OtherCall();

  RETURN retval + 1;
}

// Runs AsyncFunc until the first AWAIT (so 'Started' is printed)
OBJECT p := AsyncFunc();

/* Can't use AWAIT outside of asynchronous functions, so we need to use
   WaitForPromise to wait (and handle events and promise fulfillment
   while waiting) */
PRINT(`Result = ${WaitForPromise(p)}\n`);
```

### Generator functions

```
[ PUBLIC ] FUNCTION *<name> ( [arguments] ) { <code> }

YIELD <expression>
YIELD* <iterator-expression>
```

A generator function is a function that can return a value and can be continued
afterwards, while keeping their local variables intact.

When a generator is called, its body isn't executed. Instead a iterator object
is returned. This object has 3 methods: `Next`, `SendThrow` and `SendReturn`.

The generator can be started by calling `Next()` on the iterator object. After
that, the generator runs until one of the following happens:
- the code returns with a value with a `RETURN` statement. The generator is
  marked as completed, and the value `[ done :=
  TRUE, value := <returned value> ]` is returned to the calling function.
- the code throws an exception (which isn't caught inside the generator). The
  generator is then marked as completed, and the exception is passed to the
  caller.
- a YIELD expression is encountered. The caller will receive the value
  `[ done := FALSE, value := <yielded value> ]`.

When calling `Next()` on the iterator object again, the value passed to `Next()`
is used as the value of the YIELD-expression, and execution of the generator
is resumed. After that, the same steps as after starting the generator are used.
If the generator has already completed, the value `[ done := TRUE, value :=
DEFAULT RECORD ]` is returned.

When `SendReturn()` is called and the generator is inside a YIELD-expression,
execution of the generator is resumed as if the YIELD-expression was a
`RETURN <value>` statement. The return value is then the same as after a
`Next()` call. If the generator hasn't started yet or wass already completed,
the value `[ done := TRUE, value := <passed value> ]` is returned.

When `SendThrow()` is called and the generator is inside a YIELD-expression,
execution of the generator is resumed, and the passed exception object is thrown
immediately. The return value is then the same as after a `Next()` call. If the
generator hasn't started yet or is already completed, the value `[ done := TRUE,
value := <passed value> ]` is returned.

The `YIELD*` statement repeatedly calls `Next()` on the passed iterator. While
the returned record has a cell `done` with value `false`, the value cell is
yielded.

Example:
```harescript
FUNCTION* Doubler()
{
  INTEGER v := 0;
  WHILE (TRUE)
    v := YIELD v * 2;
}

OBJECT gen := Doubler();
PRINT(`Number: ${gen->Next().value}\n`); // Always 0
PRINT(`Number: ${gen->Next(2).value}\n`); // 4
PRINT(`Number: ${gen->Next(3).value}\n`); // 6
PRINT(`Number: ${gen->Next(-1).value}\n`); // -2
```

### Asynchronous generator functions
```
[ PUBLIC ] FUNCTION *<name> ( [arguments] ) { <code> }
```

An asynchronous generator function is a combination of a normal generator
and an asynchronous function. Using `AWAIT` in the function body is allowed,
and iistead of using records, the `Next()`, `SendReturn()` and `SendThrow()`
  functions return promises for those records.

Using `YIELD*` inside of asynchronous generators is not (yet) allowed.

Example:
```harescript
ASYNC FUNCTON *AsyncGen()
{
  YIELD 10;
  INTEGER v := AWAIT AsyncCall(); //
  YIELD 20 + v;
  RETURN 30;
}

OBJECT g := AsyncGen();

// Prints 10
PRINT(`Value 1: ${WaitForPromise(g->Next()).value}\n`);
// Prints 20 + the return value of AsyncCall()
PRINT(`Value 2: ${WaitForPromise(g->Next()).value}\n`);
// Returns [ done := TRUE, value := 30 ];
WaitForPromise(g->Next())
```

### Aggregate functions

An aggregate function is a special function that can be used inside a grouped
SELECT expression. It must be of a special format: it must have exactly one
parameter, that must either be an array type or type VARIANT.

Aggregate functions must be called with a non-array argument inside the select.
For every record in a group, the arguments are collected into an array, and then
the aggregate function is invoked with that array.

Outside of SELECT statements, the function can be called with the syntax
`<functionname>[]([ value, value, ... ])`.

```harescript
// Define an aggregate function SUM, that returns the integer sum of the array argument
INTEGER AGGREGATE FUNCTION SUM(INTEGER ARRAY values)
{
  INTEGER total := 0;
  FOREVERY (INTEGER value FROM values)
    total := total + value;
  RETURN total;
}

// Invokes the SUM function with array [1, 2], the result is 3.
SELECT AS INTEGER SUM(x) FROM [[x  := 1], [x := 2]];

// Usage of SUM outside a SELECT statement.
INTEGER a := SUM[]([ 1, 2 ]);
```

### Attributes

A function can also have one or more attributes, which tell the compiler how to
handle this function. Most attributes are only relevant for external functions,
but the _deprecated_ attribute may also be useful for library designers.

The _deprecated_ attribute will tell the compiler to give a warning whenever the
marked function is used. The function can still be called normally, but the
attribute can be used as an advance warning that the function will disappear in
the future:

```harescript
MACRO OldCode(INTEGER i) __ATTRIBUTES__(DEPRECATED "Please use NewCode")
{
}

/* This line will now give the warning:
   `OldCode` has been deprecated: Please use NewCode */
OldCode(1);
```

- The _constant_ attribute tells the compiler to assume that this function will
  not change global variables or the general 'state' of the HareScript system.
  In other words, as long as no global variable or external factor is changed,
  this function will always give the same results when called with the same
  arguments. An example of such a function would be a simple multiplication
  function, but _DeleteDiskFile_ would definitely not be constant.

  You're unlikely to ever need to specify the _constant_ attribute for HareScript
  functions you write yourself, because the compiler will generally be able to
  figure out itself whether a function is constant. This attribute is mostly
  useful for external functions.

- The _skiptrace_ attribute tells the compiler that this function may not appear
  in a stack trace or an error. This attribute is useful for functions that are
  called to generate errors (like _Abort_). External functions have this attribute
  implied.

- The _external_ attribute, optionally followed by a string constant specifying
  the module name, tells the compiler that the function is not a regular
  HareScript function. External functions are explained in the following section.

- The _executesharescript_ attribute can only be used in conjunction with the
  external attribute, and tells the compiler that the external function can call
  other HareScript functions.

- The _special_ attribute is used for to signal the compiler that this function
  needs special handling (internal to the compiler.)

- The _terminates_ attribute tells the compiler that this function terminates
  execution of the current script. It can only be used for macros.

### External functions

External functions are written in a foreign language (such as C++), and are used to communicate with the `outside world` or to access built-in features of the language. External functions can be built into the HareScript virtual machine (or an extended virtual machine, such as WebHare), or contained in an external library (a .DLL or .so file)

You cannot just call any function in any DLL using the external attribute, as the function needs to be prepared to support HareScript function calls. Details on how to do this can be found in the module development section of [http://www.webhare.net/](http://www.webhare.net/)

For illustration, an example external function definition follows. Note that you will probably not be able to actually run this code in a HareScript library, as the example function names will not be available (you will get a `function not registered` error).

```harescript
//Define function `GetExampleValue`, which should already be
//available to the VM
INTEGER FUNCTION GetExampleValue() ATTRIBUTES(EXTERNAL);

//Load external module "windowsui" and lookup the MessageBox macro in it.
MACRO MessageBox(STRING text, STRING title) ATTRIBUTES(EXTERNAL "windowsui");
```
## Object types
```
[ PUBLIC ] [ STATIC ] OBJECTTYPE <object type name> [ EXTEND <typename> ]
<
  <object type structure>
>;

Objecttype members, properties and methods:
  [ PUBLIC ] <type> <variablename> ;
  [ UPDATE ] [ PUBLIC ] PROPERTY <propertyname> ( <read-expresssion> or '-', <write-expresssion> or '-' ) ;
  [ PUBLIC ] MACRO NEW ( <arguments> ) { <code> }
  [ UPDATE ] [ PUBLIC ] <type> FUNCTION <functionname> ( <arguments> ) { <code> }
  [ UPDATE ] [ PUBLIC ] [ ASYNC ] MACRO <macroname> ( <arguments> ) { <code> }
```

An object is a wrapper of data and related functions. An objecttype declaration
describes the structure of that data and the related functions. The following
items can be part of that structure:
- Members (roughly equivalent to variables)
- Properties
- A constructor (macro that initializes the new object)
- Methods (functions and macros)

A new object can be constructed using the `NEW <objecttype>` syntax. This creates
a new object using the blueprint provided by the objecttype specification and
returns a reference to that object. This object will exist until the last
reference to it is gone. Copying the reference will not copy the object itself,
the new reference will point to the original object.

```harescript
OBJECTTYPE MyType
< PUBLIC STRING value;
>;

OBJECT myobject := NEW MyType;
myobject->value := "value";

/// Prints 'value'
OBJECT copy := myobject;
PRINT(copy->value || "\n");

myobject->value := "value2";

// Prints 'value2'
PRINT(copy->value || "\n");
```


The items in an objecttype can be either private (the default) or public. Public
items can be accessed from all references to that object, but the private
items can only be accessed from within the object (using the special `this`
variable that contains a reference to the current object within methods), or
via a special privileged reference.

### Accessing the contents of an object
Within methods of the object, the items within that object can be accessed using
the `this` variable. Example:

```harescript
OBJECTTYPE MyType
< INTEGER _counter;
  MACRO IncrementCounter()
  {
    PRINT("Counter was: " || this->counter || "\n");
    this->counter := this->counter + 1;
  }
>;
```

### Properties
From the outside, properties behave like member values. The difference is
that getting and setting values can be rerouted to specific members.

The access method for properties can be one of the following types:
1. a member variable (using `<membername>`).
2. a simple expression (using `this->name.value`). The expression must start with
   `this->`, and only object references and record cell references are allowed.
3. a method call (using `<methodname>`).
4. not available (using `-`).

For the getter, methods will be called without arguments, and the return value
of that method is returned to the caller. For the setter, the method will be
called with the set value as single argument, and the return value is discarded.

Example:
```harescript
OBJECTTYPE MyType
< INTEGER _value;
  OBJECT _otherobject;

  /// Provide readonly access to the _value member
  PROPERTY readonly(value, -);

  /// Access the value member of a private memeber object
  PROPERTY passthrough(this->_otherobject->value, this->_otherobject->value);

  /// Use access function to convert value from 0-based to 1-based
  PROPERTY gettersetter(_GetValue, _SetValue);

  INTEGER FUNCTION _GetValue() { RETURN this->value + 1; }
  MACRO _SetValue(INTEGER newval) { this->value := newval - 1; }
>;
```

The special hat-property (`PROPERTY ^`) is used when accessing objects items with
a name starting with `^`. If a member value with that name is present, that will
member value will be used for access. Otherwise, that hat property is evaluated.
Method calls executed for this property will have the name of the item added as
first argument.

Example:
```harescript
OBJECTTYPE MyObjectType
<
  PUBLIC STRING _cache;
  PUBLIC PROPERTY ^(Getter, Setter);

  STRING FUNCTION Getter(STRING propname) { RETURN this->_cache; }
  MACRO Setter(STRING propname, STRING value) { this->_cache := propname || ":" || value; }

  PUBLIC MACRO InsertProp(STRING propname, STRING value)
  {
    MemberInsert(this, propname, FALSE, value);
  }
>;

OBJECT myobj := NEW MyObjectType;
PRINT(myobj->^a || "\n"); // prints ""
myobj->^a := "2"; // sets myobj->_cache to "^a:2"
PRINT(myobj->^a || "\n"); // prints "^a:2"
myobj->InsertProp("^a", "direct"); // insert directly into the object
PRINT(myobj->^a || "\n"); // now prints "direct"
```

### Inheritance

An objecttype can extend another objecttype using inheritance, using
`EXTEND <parent-objecttype>`. The resulting objecttype will have all the members,
properties and methods of the parent objecttype, plus all items defined in the
objecttype contents.

Properties and methods can be updated by the new contents by using the `UPDATE`
keyword. Members cannot be updated. An updated method must have the same
signature as the method it updates.

If the constructor of the parent objecttype has parameters, the constructor
of the new objecttype must call the parent constructor using the following
syntax:

```harescript
OBJECTTYPE MyObjectType EXTEND ParentObjectType
<
  MACRO NEW(INTEGER value)
  : ParentObjectType(value)
  {
  }
>;
```

When updating a method, the overridden method can be called explicitly using
`<parent-objecttype>::<methodname>`. Example:

```harescript
OBJECTTYPE MyObjectType EXTEND ParentObjectType
<
  UPDATE MACRO OverriddenMethod()
  {
    ParentObjectType::OverriddenMethod();
  }
>;
```

## Libraries

A library is a collection of functions, macros and variables, which can be
re-used in other libraries and scripts. When a library is loaded, all PUBLIC
identifiers it contains become available to the script that loads it. A library
is referred to by its name, which consists of a namespace and a path, separated
by a double colon, eg:

```harescript
// Make all public variables, functions and macros in `money.whlib` available
LOADLIB "wh::money.whlib";
```

If you are writing a HareScript library, the symbols in libraries that you load
won't be directly available to scripts that load your library. If you want this,
you need to explicitly re-export any symbols you wish to make available to the
scripts that load your library, as follows:

```harescript
/* Make all public symbols in money.whlib available to our library,
   and make FormatMoney and MoneyToInteger available to all libraries
   that load our library
*/
LOADLIB "wh::money.whlib" EXPORT FormatMoney, MoneyToInteger;
```

An EXPORT can only be used to re-export PUBLIC variables and functions in the
library from which you're exporting them. There's no way to gain access to the
private symbols of a library.

The following example will display the effects of EXPORT in more detail, by
showing which variables are available to which library. Although this example
shows only variables, the same rules apply to functions and macros:

```harescript
// Library 1: defining a few variables
PUBLIC INTEGER i1;
PUBLIC INTEGER i2;

// Library 2: loading library 1, but only exporting i1
LOADLIB "library 1" EXPORT i1;
PRINT("Multiplication: " || i1 * i2); //okay: both i1 and i2 are available

// Library 3: loading library 2
LOADLIB "library 2";
PRINT("i1: " || i1); //okay: i1 from library 1 is available
                     //through library 2
PRINT("i2: " || i2); //illegal: i2 is not visible
```

## Main code

All code that is outside any function and macro, including the initialisation of
any global variables, is considered to be the _main code_ of the script. This
code is executed whenever the script is loaded as a library, or is run directly.
Please note that if a script loads the same library twice, directly or indirectly,
its main code is still executed only once.

The following example explains what is considered the `main code` in every
library. All print statements are executed only once, even though library 1 is
loaded twice by the final script, library 3:

```harescript
//Library 1 - the code that follows is considered the `main code`
Print ("This is library 1\n");

//Library 2 - the code that follows is considered the `main code`
LOADLIB "library 1";
Print("This is library 2\n");

//Library 3
LOADLIB "library 1";
LOADLIB "library 2";

//A function in library 3 - the code it contains is NOT part
//of the `main code`
INTEGER FUNCTION Square(INTEGER i) { RETURN i * i; }

//The following code is considered the `main code`
Print ("This is library 3\n");
```

## Column name lookup rules

Inside SELECT, UPDATE and DELETE expressions special rules apply when looking up
the name of an identifier. These rules apply to all the expressions in this
statement, with the exception of the FROM clause. In such an expression, an
identifier can refer to a variable, a function or a column from one of the source
expressions. The following lookup rules apply to identifiers in such expressions:

1. If the identifier is followed by an opening parenthesis, it is considered to
   refer to a function.
2. If the identifier appears after the cell operator (`.`), it is considered to
   be a cell inside the previously specified record. This record can also be one
   of the source expressions specified in a FROM clause.
3. If the identifier is prefixed with a VAR keyword, it is considered to refer
   to a temporary, local or global variable defined earlier.
4. If the identifier is prefixed with a COLUMN keyword, it is considered to refer
   to a column in one of the source expressions.
5. If no VAR or COLUMN keyword is present, the identifier is considered to refer
   to a temporary, local or global variable, if any variable by that name exists.
   If no identifier exists, the identifier is considered to refer to a column in
   one of the source expressions.

When a looked up column may exist in more than one source expression, the compiler
generates an error. The compiler assumes that a record array contains all possible
column names, so if two or more record arrays are specified as the source
expression for a SELECT, all columns will have to be referred to explicitly.

Note that given the list above, the `VAR` keyword is never required. When neither
of the keywords VAR or COLUMN is used, the compiler will still select an existing
variable instead of a cell. However, the usage of `VAR` can clarify the code, and
may suppress compiler warnings in some cases.

The following examples detail how the column name lookup works in various cases:
```harescript
TABLE files < INTEGER id >;
TABLE folders < INTEGER id, STRING name >;
RECORD ARRAY ra1;
INTEGER id := 5;

//`id` refers to the global variable `id`, NOT to one of the
// sources being selected
SELECT id FROM files, folders;

//Two proper ways to select `id` from table `files`
SELECT files.id FROM files;
SELECT COLUMN id FROM files;

//`test` will be looked up in `ra1`, as `files` won`t contain the cell
SELECT test FROM files, ra1;
```

In the following examples, the lookup rules are insufficient to determine which
source expression or variable to use, and the compiler will generate an error:

```harescript
TABLE files < INTEGER id >;
TABLE folders < INTEGER id, STRING name >;
RECORD ARRAY ra1, ra2;
INTEGER id := 5;

//Ambiguous, because both `files` and `folders` offer a column named `id`
//The `column` keyword ensures that variable `id` is not considered
SELECT COLUMN id FROM files, folders;

//Column `name` is ambiguous, because the compiler
//considers `ra1` to contain all
//possible columns
SELECT name FROM folders, ra1;

//All columns are ambiguous, because more than
//one record array is specified
SELECT name, title FROM ra1, ra2;
```

The examples above only discuss SELECT, but the lookup rules also apply to UPDATE
and DELETE statements. The only difference is that UPDATE and DELETE do not permit
multiple source expressions, so some of the possible ambiguities do not apply
there.
