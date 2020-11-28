# ODBC

## Connecting to MS SQL using ODBC

You need drivers:
- [Linux SQL Server ODBC drivers](https://blogs.msdn.microsoft.com/sqlnativeclient/2016/10/20/odbc-driver-13-0-for-linux-released/)
- [macOS SQL Server ODBC drivers](https://docs.microsoft.com/en-us/sql/connect/odbc/linux-mac/installing-the-microsoft-odbc-driver-for-sql-server)

The SQL Server on windows may still have to open TCP. See: https://technet.microsoft.com/en-us/library/hh231672(v=sql.110).aspx

### Troubleshooting
Troubleshoot using sqlcmd first:

```
sqlcmd -S <serverip> -U <user> -P <password>

# eg:
sqlcmd -S 10.37.129.3 -U sysop -P secret
```

Valid DSN paramaters: https://docs.microsoft.com/en-us/sql/connect/odbc/linux-mac/connection-string-keywords-and-data-source-names-dsns

Connect using isql (to test unixodbc):
```
isql -vk "Driver={ODBC Driver 13 for SQL Server};Server=<serverip>,1433;UID=<user>;PWD=<password>"

# eg:
isql -k "Driver={ODBC Driver 13 for SQL Server};Server=10.37.129.3,1433;UID=sysop;PWD=secret"
```

When connected, find your database
```
select name from sys.databases;

use [sqlserver administratie]; #or another database name
```

### useful tools
- To browse a database: [SqlDbx personal edition](http://www.sqldbx.com/personal_edition.htm)


## Connecting to MySQL using ODBC

The WebHare docker ships with configured pgsql and mysql odbc connectors and the
isql binary.

To connect to a database directly, use isql, eg:

```
isql -k "Driver=MySQL;Server=10.11.12.13;Database=<dbname>;Uid=<uid>;Pwd=<password>;"
```

macOS requires some manual installation. MySQL doesn't appear to have a stable, usable
odbc provider available currently (we can't get the recent online versions to work,
they appear to only work with iodbc and not unixodbc) but MariaDB's ODBC connector should be compatible

- `brew install mariadb-connector-odbc`
(pull request for this package is pending: https://github.com/Homebrew/homebrew-core/pull/10146 )

- Add to /usr/local/etc/odbcinst.ini

```
[MaODBC]
Driver=/usr/local/lib/libmaodbc.dylib
UsageCount=1
```

```
isql -k "Driver=MaODBC;Server=10.11.12.13;Database=<dbname>;Uid=<uid>;Pwd=<password>;"
```

## Testing MariaDB ODBC connector

This section is inteded for developers working on WebHare itself.

```bash
docker run --rm -ti webhare/platform
apt update
apt install -qy mariadb-server
mysqladmin -u root password test
nohup mysqld_safe &
cat > test.whscr << HERE
<?wh
LOADLIB "wh::dbase/odbc.whlib";
OBJECT trans := StartODBCTransaction([ type := "DRIVER", connection_string := "Driver=MariaDB;Server=localhost;Uid=root;Pwd=test" ]);
DumpValue(SendODBCCommand(trans->id, "select user,host from mysql.user"),"boxed");
HERE
wh run test.whscr
```
