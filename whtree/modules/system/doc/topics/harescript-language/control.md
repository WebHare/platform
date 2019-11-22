# Control statements

Control statements alter the flow of code execution, and determines whether,
and how often, statements are executed. HareScript offers all the control
statements you would expect in a programming language.

## IF ... ELSE

```
IF ( <condition> ) <statement if true> [ELSE <statement if false>]
```

The IF statement is one of the most important features of many languages,
including HareScript. It allows for conditional execution of code fragments.

The IF statement takes a boolean expression, and if it evaluates to true,
executes the statement that follows it. Optionally, an ELSE clause can be
specified to indicate a statement that should be executed if the boolean
expression evaluates to false.

A block of statements can be used after the IF or ELSE clause by placing them
between curly braces. An example of a few possible uses of IF and ELSE are:

```harescript
IF (i>5)
  PRINT("i is greater than 5");
ELSE
  PRINT("i is less than 5");

IF (i<2)
{
  PRINT("i is less than 2");
  MyMacroToBeCalledIfIIsLessThan2();
}

IF (i<5)
  PRINT("i is less than 5");
ELSE IF (i>5)
  PRINT("i is greater than 5");
ELSE
  PRINT("i is equal to 5");
```

An IF statement can be nested inside another IF statement. There is no limit to
the number of nested IF statements you can use.

## FOREVERY

```
FOREVERY ( [type] <value variable> FROM <array> ) <statement>
```

The FOREVERY statement loops through all elements in an array, assigns the
current value to a variable, and executes the specified statement for each
element. By prefixing the variable name with a type, a local variable is defined
for the duration of the FOREVERY loop.

Modifications to the value variable have no effect on the array through which
the FOREVERY loop runs. As FOREVERY makes a copy of the array it uses before
it starts the loop, any modifications to the array itself will not affect the
FOREVERY loop either.

Inside the statement or statement block following the FOREVERY statement, the
current element counter (the currently used element) can be retrieved by
prefixing the value variable name with a pound sign (`#`). This value starts at
0, and will be incremented at every loop iteration. It will thus always be less
than the number of elements in the array.

A block of statements can be used after the FOREVERY statement by placing them
between curly braces.  The following code demonstrates a few uses for the
FOREVERY statement:

```harescript
// Print the names of all files contained in the folder
// with id `parentfolderid`
RECORD ARRAY subfiles :=
    SELECT name
      FROM files
     WHERE parent = parentfolderid;

FOREVERY (RECORD subfile FROM subfiles)
  PRINT(subfile.name || "\n");

//Add `1` to every integer in the integer array
INTEGER ARRAY intarray := [ 1, 2, 3, 4, 5, 6, 7 ];
INTEGER current_int;
FOREVERY (current_int FROM intarray)
{
  intarray[#current_int] := current_int + 1;
}
```

A FOREVERY statement can be nested inside another FOREVERY statement. There is
no limit to the number of nested FOREVERY statements you can use. Inside a
statement block following a FOREVERY statement, you can use CONTINUE to stop
the current iteration and run the loop for the next element in the array, or
use BREAK to abort the FOREVERY statement entirely.

## WHILE
```
WHILE ( <boolean expression> ) <statement>
```
The WHILE statement tells HareScript to execute the nested statement(s)
repeatedly, as long as the WHILE expression evaluates to TRUE.

The value of the expression is checked each time at the beginning of the loop.
As long as the expression evaluates to TRUE, execution will continue. Even if
this value changes during the execution of the nested statement(s), execution
will not stop until the end of the iteration (each time HareScript runs the
statements in the loop is one iteration).

A block of statements can be used after the WHILE statement by placing them
between curly braces.  The following code demonstrates the WHILE statement:

```harescript
BOOLEAN finished := FALSE;
// Loop until finished is TRUE, and print
// "Not finished yet" for every iteration
WHILE (NOT finished)
{
  PRINT("Not finished yet!\");
  IF (Check1())
    finished:=TRUE;
}

//Another way to write the above loop is
WHILE (TRUE)
{
  PRINT(`Not finished yet!\n");
  IF (Check1())
    BREAK;

}

/* The above loop always prints "Not finished yet!" at least once. If we don`t
   want that, we might also be able to rewrite the loop as following */
WHILE (NOT Check1())
  PRINT("Not finished yet!\n");
```

A WHILE statement can be nested inside another WHILE statement. There is no
limit to the number of nested WHILE statements you can use. You can use the
BREAK statement to end the execution of the statement(s), or use the CONTINUE
statement to stop the execution of the current statement(s) and start the next
iteration.

## FOR

```
FOR ( <definition | assignment> ; <test expression> ; <step expression> )
  statement
```

The FOR statement tells HareScript to execute the nested statement(s)
repeatedly, as long as the _test expression_ evaluates to TRUE. The _step
expression_ is executed after every loop iteration.

The value of the expression is checked each time at the beginning of the loop.
As long as the expression evaluates to TRUE, execution will continue. Even if
this value changes during the execution of the nested statement(s), execution
will not stop until the end of the iteration (each time HareScript runs the
statements in the loop is one iteration).

A block of statements can be used after the FOR statement by placing them
between curly braces.  The following code demonstrates the FOR statement:

```harescript
//Print the numbers 1 to 10
FOR (INTEGER i := 1; i <= 10; i := i + 1)
  PRINT (i || "\n");

//Loop through the specfied array, checking every other
//element whether its equal
//to `2`, and returning the position of that element (it will return `4`)
INTEGER ARRAY testdata := [1, 2, 3, 3, 2, 1];
INTEGER position;
FOR (position := 0; position < Length(testdata); position := position + 2)
{
  IF (testdata [position] = 2)
    BREAK;
}
```

A FOR statement can be nested inside another FOR statement. There is no
limitation to the number of nested FOR statements you can use. You can use the
BREAK statement to end the execution of the statement(s) and leave the FOR loop.
In this case, the test expression and the step expression are not re-evaluated.
You can also use the CONTINUE statement to stop the execution of the current
statement(s) and start the next iteration. If you use CONTINUE, the step
expression will be rerun, and the test expression re-evaluated, before
starting another iteration of the loop.

## RETURN

```
RETURN [value];
```

The RETURN statement is used to both end the current MACRO or FUNCTION, and to
provide the return value for a function. The RETURN statement can also be used
to abort running the main code for a library. The RETURN statement is required
inside a FUNCTION, and must then specify a return value. The RETURN statement
may never be used with a value inside a MACRO or the main code.

The following example demonstrates valid and invalid uses of the RETURN
statement:

```harescript
INTEGER FUNCTION Square(INTEGER i)
{
  RETURN i*i; //this is the value that will be returned by a call to Square()
  Print("This statement is never executed");
}

MACRO Test(INTEGER i)
{
  IF (i = 5)
    RETURN 123; //Illegal: a MACRO may never return a value

  RETURN; //This return statement is optional, because a macro automatically
          //returns when the end of its code is reached
}
```

## BREAK

```
BREAK;
```

The BREAK statement aborts the current FOR, FOREVERY or WHILE loop, and resumes
execution at the statement that follows the statement or statement block that
was part of the last loop.

A BREAK statement may not be used outside a FOR, FOREVERY or WHILE loop, and
will only break out of one such loop at a time. Eg, when two WHILE loops are
nested, a BREAK statement inside the inner loop will return to the outer loop.

For examples on using the BREAK statement, please refer to the examples of the
loop statements mentioned above.

## CONTINUE

```
CONTINUE;
```

The CONTINUE statement ends the execution of the current FOR, FOREVERY or WHILE
loop, and resumes with the next element or iteration of that loop. If there
were no more elements or iterations to perform, CONTINUE ends the current loop.

A CONTINUE statement may not be used outside a FOR, FOREVERY or WHILE loop, and
will only end one such loop at a time. Eg, when two WHILE loops are nested, a
CONTINUE statement inside the inner loop will only start the next iteration of
that inner loop, and will not affect the outer loop.

For examples on using the CONTINUE statement, please refer to the examples of
the loop statements mentioned above.

## SWITCH, CASE, DEFAULT

```
SWITCH ( <expression> )
{
  [CASE <value> [, <value> ...] { <statements> } ]
  [CASE <value> [, <value> ...] { <statements> } ... ]
  [DEFAULT { <statements> }]
}
```

The SWITCH statement executes a group of statements depending on the result of
an expression. It first evaluates the given expression, and then looks through
all the CASE statements if it contains a value matching the result of the
expression. If one of the CASE statement matches, the group of statements
following that CASE is executed.

The values following a CASE statement must be constant values.

If none of the CASE values match the result of the expression, and a DEFAULT
statement is present, the code following that statement is executed. The DEFAULT
statement, if any, must appear as the last option inside the SWITCH statement.
Each possible value may occur only once inside a SWITCH statement.

The following code examples detail the workings of the SWITCH statement:

```harescript
//Prints `even` or `odd` if the integer is in the range 1-3
INTEGER i := AskUserForValue();
SWITCH (i)
{
  CASE 1,3 { print ("i is odd"); }
  CASE 2   { print ("i is even"); }
  DEFAULT  { print ("i is out of range"); }
}

//Prints `digit` if the number is in range 0-9, does nothing otherwise
SWITCH (i)
{
  CASE 0,1,2,3,4,5,6,7,8,9 { print ("i is a digit"); }
}

//Illegal: duplicate case
SWITCH (i)
{
  CASE 0,1,2 { print ("i <= 2"); }
  CASE 2,3,4 { print ("i >= 2"); }
}
```

## THROW, TRY ... CATCH, TRY ... FINALLY

```
THROW <expression>;

THROW;

TRY
  <trystatement>;
CATCH [ (OBJECT[ `<` <type> `>` ]  e) ]
  <catchstatement>;

TRY
  <trystatement>;
FINALLY [ (OBJECT[ `<` <type> `>` ]  e) ]
  <finallystatement>;
```

Harescript implements exception handing. To throw an exception, use `THROW
<expressionvalue>`. Only objects can be thrown. It is recommended to throw
only object instances that extend the base exception objectttype `Exception`,
which exposes a stack trace facility.

To handle an exception, the `TRY ... CATCH` facility can be used. If an
exception is thrown within the `<trystatement>`, control is transferred to the
`<catchstatement>`. To re-throw the exception there without recording an extra
stack-frame at the THROW statements, use the `THROW;` statment.

With the `TRY ... FINALLY` statement, when the control flow exits the
`<trystatement>`, control is first transferred to the `<finallystatement>`. If
the statement exits normally (not with a control statement), it is transferred
to the original destination.

This can be used to cleanup resources.

```harescript

// Execute an operation, but keep running when it throws
TRY
  OperationThatFailsSometimes();
CATCH (OBJECT e)
{
  // Log and ignore this eror
  LogHarescriptException(e);
}

// Always cleanup browser resources
OBJECT b := NEW WebBowser;
TRY
{
  b->GotoWebPage("https://example.com");
  RETURN ProcessPageContent(b->content);
}
FINALLY
  b->Close();
```
