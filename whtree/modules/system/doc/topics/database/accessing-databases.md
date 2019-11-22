# Acessing database and tables

Before you can access a tables in a database, you will have to define and bind them. Defining explains HareScript what a table looks like, and binding associates a table with an open transaction.

## Table definitions

Defining a table allows you to abstract from the actual database and transaction systems used to store the data, and allows the HareScript compiler to validate your code without having to log on to any database. A table is defined by creating a table variable, and specifying the table layout.

For example, consider the following SQL table
```harescript
CREATE TABLE test1 ( id INTEGER PRIMARY KEY AUTONUMBER 1 NOT NULL
                   , textdata VARCHAR(256)
                   , test BOOLEAN)
```

This table can be accessed using the following table definition:
```
TABLE < INTEGER id
      , STRING textdata
      , BOOLEAN test > test1;
```
As the above example shows, column attributes (such as primary key, not null) do not need to be specified in the table definition statement. The HareScript compiler does not validate these constraints - it is left up to the database. You may also notice that the HareScript type string was used for the varchar column. A table definition must always specify HareScript types, not the database types.

In practice, you're not required to define all columns of a table definition, or to give the table variable the same name as the table in the database. However, the names of the columns should match. More detailed information about the syntax of a table definition statement can be found in the [HareScript language reference: the table type](http://www.webhare.net/harescript/langref/language_reference.doc/table.html).

## Transactions in HareScript

To access a database in HareScript, you will first have to open a connection to the database you want to access. The connection to a database is called a transaction. Changes you make within your transaction are not permanent, unless you commit the transaction. A transaction commit only succeeds if no errors occurred. If one of the changes you made caused a database error (e.g. a not null constraint violation), nothing will be changed at all. To close the database connection without making any changes to the database, you rollback the transaction.

>>>
NOTE: After a script finishes, all transactions that are still open (not committed or rolled back) are automatically rolled back, so remember to commit any transaction that changes data in the database, or your changes will be lost
>>>

Each database type has its own functions to open, commit and rollback transactions. For example, to open an anonymous connection to the WebHare database, you can use the following code:

```harescript
LOADLIB "wh::dbase/whdb.whlib";

INTEGER transaction := OpenWHDBTransaction(",");
IF (transaction <= 0)
  ABORT("Could not open WebHare database transaction!");
```

To commit the changes you have made to the database, you can use the following code:
```
RECORD ARRAY errors := CommitWHDBTransaction(transaction);
IF (Length(errors) > 0)
  ABORT("Some errors occurred while committing database changes!");
```

Other database types use other functions. For example, to open an anonymous connection to an LDAP server on a local network as a database, you can use the following code:
```
LOADLIB "wh::dbase/ldap.whlib";

INTEGER transaction := OpenLDAPConnection("192.168.1.1", 0, ",
                                          ", FALSE);
IF (transaction <= 0)
  ABORT("Could not open LDAP connection!");
```

Because we do not support changing LDAP data, there is no function to commit LDAP changes, so any LDAP connection is automatically rolled back at the end of the script.

# Binding tables to transactions

Table definitions only describe the layout of the tables, but do not yet associate the table with any transaction. This is done at run-time by using the BindTransactionToTable function, which associates a table with a WebHare transaction or an external database.

Before a table can be bound, a transaction needs to be set-up. The following source codes shows how to setup a transaction using the sysop account, and then binding it to the aforementioned test1 table:

```harescript
LOADLIB "wh::dbase/whdb.whlib";

TABLE < INTEGER id, STRING textdata, BOOLEAN test > test1;

// Use username "sysop" and password "secret"
INTEGER transid := OpenWHDBTransaction("sysop","secret");

test1 := BindTransactionToTable(transid, "test1");
```

The first parameter to the BindTransactionToTable function is the transaction identifier, and the second is the actual table name as known to the database. The actual table name does not have to match the name of the table variable (for example, Access databases permit spaces in table names, but a variable name containing spaces would be illegal in HareScript).

After the table is bound, you can use it in HareScript SQL statements, like SELECT and UPDATE.

# Database libraries in modules

To simplify the task of defining and binding tables every time you need them, it is often more convenient to set up a HareScript library that provides the table definitions, and offers functions to bind multiple tables at once. Most modules follow the convention of setting up a HareScript library called database.whlib, which does one or more of the following:

- Creating PUBLIC table variables for every module table.
- Setting up a function which binds all tables to a specified transaction.
- Automatically binding the tables to the primary transaction, if available.

The following code is an excerpt of the Publisher database library _module::publisher/database.whlib_, which demonstrates the all the above actions. Not all actually existing tables and columns have been listed in this excerpt:

```harescript
<?wh

//GetPrimaryWebHareTransaction()
LOADLIB "module::system/database.whlib";

// Creating the table definitions
PUBLIC TABLE <INTEGER "id", INTEGER "parent", STRING "name"> FOLDERS;
PUBLIC TABLE <INTEGER "id", INTEGER "parent", STRING "name"> FILES;

// The table binding function
PUBLIC MACRO BindPublisherTables(INTEGER transaction)
{
  FOLDERS := BindTransactionToTable(transaction, "FOLDERS");
  FILES := BindTransactionToTable(transaction, "FILES");
}

// Automatically bind the tables to the primary transaction, if available
IF (GetPrimaryWebhareTransaction() != 0)
  BindPublisherTables(GetPrimaryWebhareTransaction());
```

This library provides table definitions for the publisher tables (in this excerpt, the FOLDERS and FILES tables) and a function to bind a transaction to these tables. If a primary WebHare transaction is available, this transaction is automatically bound to the publisher tables. More information about the primary WebHare transaction is provided later on in the article.

# Examples of using databases

In this section you will find some examples of using different kinds of databases.

## The WebHare database


The following script will open a transaction, bind it to the table and then make some database queries:
```harescript
<?wh
LOADLIB "wh::dbase/whdb.whlib";

// Table definition
TABLE < INTEGER id, STRING textdata, BOOLEAN test > test1;

// Use username "sysop" and password "secret"
INTEGER transid := OpenWHDBTransaction("sysop","secret");
IF (transid <= 0)
  ABORT("Could not open database transaction!");

// Bind the opened transaction to the table
test1 := BindTransactionToTable(transid, "test1");

// Select data from the table
RECORD ARRAY all\_data := SELECT \* FROM test1;

// Update some information
UPDATE test1 SET test := textdata != " WHERE id > 50;

// Commit our database changes!
RECORD ARRAY errors := CommitWHDBTransaction(transaction);
IF (Length(errors) > 0)
  FOREVERY (RECORD error FROM errors)
    PRINT("Database error: " || error.message || "\n");
```

## An LDAP server

You can use an LDAP server as a normal (read-only) database. Like with any other database you will have to define a table, specifying which data you want from the server, open a transaction (LDAP connection) and bind it to the table:

```harescript
<?wh
LOADLIB "wh::dbase/ldap.whlib";

// Table definition
TABLE < STRING dn, STRING cn, STRING o, STRING c > test1;

// Open an anonymous connection to a local LDAP server
INTEGER transid := OpenLDAPConnection("192.168.1.1", 0, ",");
IF (transid <= 0)
  ABORT("Could not open LDAP connection!");

// Bind the opened transaction to the table
test1 := BindTransactionToTable(transid, "test1");

// Set search scope
SetLDAPSearchScope(transid, "o=B-lex,c=NL", 2);

// Select data from the table
RECORD ARRAY all\_data := SELECT dn
                           FROM test1
                          WHERE cn LIKE "Simp\*";

Because you cannot make any changes to LDAP tables, you do not have to commit the transaction.
```
