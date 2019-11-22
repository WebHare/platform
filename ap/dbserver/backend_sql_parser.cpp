#include <ap/libwebhare/allincludes.h>


//---------------------------------------------------------------------------
#include "backend_sql_parser.h"
#include <blex/lexer.h>
#include <ap/libwebhare/dbase.h>
#include "dbase_transaction.h"

//Alle ::Execute functies bevinden zich in backend_sql.cpp

namespace Database {
namespace SQL {

void ParseError(SQL::Lexer &lexer, std::string expected = "")
{
        std::string str("SQL parse error at");
        if (lexer.GetToken() == Lexer::Eof)
            str += " end of command";
        else
            (str += ": ") += lexer.GetTokenSTLString();
        if (!expected.empty())
            str += ", expected " + expected;
        throw Exception(ErrorIllegalSQLCommand, str);
}

void Expect(SQL::Lexer &lexer, SQL::Lexer::Type type)
{
        if (lexer.GetToken() != type)
            ParseError(lexer, lexer.GetKeyWord(type));
        lexer.MovetoNextToken();
}


/// Checks a name if it is valid. All names are valid, except those with control characters, and those with dots ('.')
void CheckName(std::string const &name)
{
        for (std::string::const_iterator it = name.begin(); it != name.end(); ++it)
            if (*it < 32 || *it == '.')
                throw Exception(ErrorIllegalSQLCommand,"Name \"" + name + "\" contains illegal characters");
}

/** Parse a name, optionally a raw identifier or a string. Used at almost every
    place where we would expect a name, but allows escaping using strings.. */
std::string ParseName(SQL::Lexer &lexer)
{
        if (!lexer.IsName())
        {
                ParseError(lexer);
                return std::string(); //Never reached
        }
        if (lexer.GetToken() == Lexer::ConstantString)
        {
                std::string colname = Blex::Lexer::ParseTokenString(lexer.GetTokenSTLString());
                if (colname.empty())
                    ParseError(lexer);
                CheckName(colname);
                lexer.MovetoNextToken();
                Blex::ToUppercase(colname);
                return colname;
        }

        std::string colname = lexer.GetTokenSTLString();
        lexer.MovetoNextToken();
        CheckName(colname);
        Blex::ToUppercase(colname);
        return colname;
}

std::string ParseSchemaName(SQL::Lexer &lexer)
{
        std::string schema;
        if (lexer.GetToken() == Lexer::Public)
        {
                schema = "PUBLIC";
                lexer.MovetoNextToken();
        }
        else
        {
                schema = ParseName(lexer);
        }
        return schema;
}

SchemaTableName ParseTableNameSep(SQL::Lexer &lexer)
{
        std::string schema = ParseSchemaName(lexer);
        std::string name;
        if (lexer.GetToken() != Lexer::OpDot)
        {
                name = schema;
                schema = "";
        }
        else
        {
                Expect(lexer, Lexer::OpDot);
                name = ParseName(lexer);
        }
        return std::make_pair(schema, name);
}

SchemaRoleName ParseRoleName(SQL::Lexer &lexer)
{
        std::string schema;
        if (lexer.GetToken() == Lexer::Public)
        {
                schema = "PUBLIC";
                lexer.MovetoNextToken();
        }
        else if (lexer.GetToken() == Lexer::_system)
        {
                lexer.MovetoNextToken();
                return std::make_pair("DEFINITION_SCHEMA", "_SYSTEM");
        }
        else if (lexer.GetToken() == Lexer::User)
        {
                //ADDME: Want separate namespaces for users?
                lexer.MovetoNextToken();
                return std::make_pair("DEFINITION_SCHEMA", ParseName(lexer));
        }
        else
        {
                schema = ParseName(lexer);
        }

        if (lexer.GetToken() != Lexer::OpDot)
        {
                if (schema == "PUBLIC" || schema=="_SYSTEM")
                    return std::make_pair("DEFINITION_SCHEMA", schema);
                else // no schema name specified, assume public schema
                    return std::make_pair("PUBLIC", schema);
        }

        Expect(lexer, Lexer::OpDot);

        if (lexer.GetToken() == Lexer::Public)
        {
                if (schema != "DEFINITION_SCHEMA")
                    ParseError(lexer);
                lexer.MovetoNextToken();
                return std::make_pair("DEFINITION_SCHEMA", "PUBLIC");
        }
        else if (lexer.GetToken() == Lexer::_system)
        {
                if (schema != "DEFINITION_SCHEMA")
                    ParseError(lexer);
                lexer.MovetoNextToken();
                return std::make_pair("DEFINITION_SCHEMA", "_SYSTEM");
        }
        std::string name = ParseName(lexer);
        return std::make_pair(schema, name);
}

/** Parse an integer, fail if whatever we're getting is not an integer */
int32_t ParseInteger(SQL::Lexer &lexer)
{
        bool negative=false;
        if (lexer.GetToken() == Lexer::OpAdd)
        {
                lexer.MovetoNextToken();
        }
        else if (lexer.GetToken() == Lexer::OpSubtract)
        {
                negative=true;
                lexer.MovetoNextToken();
        }

        if (lexer.GetToken() != Lexer::ConstantInteger)
            ParseError(lexer);
        int32_t retval = lexer.GetTokenInteger();
        lexer.MovetoNextToken();
        return negative ? -retval : retval;
}

bool ParseDefault(SQL::Lexer &lexer, ParsedColumn *newcol)
{
        if(lexer.GetToken() == Lexer::ConstantInteger || lexer.GetToken() == Lexer::OpSubtract || lexer.GetToken() == Lexer::OpAdd)
        {
                newcol->coldef.defaultval.resize(4,0);
                newcol->defaulttype = Database::TInteger;
                Blex::puts32lsb(&newcol->coldef.defaultval[0],ParseInteger(lexer));
                return true;
        }
        if(lexer.GetToken() == Lexer::True || lexer.GetToken()==Lexer::False)
        {
                newcol->defaulttype = Database::TBoolean;
                newcol->coldef.defaultval.resize(1, 0);
                Blex::putu8(&newcol->coldef.defaultval[0],lexer.GetToken()==Lexer::True);
                lexer.MovetoNextToken();
                return true;
        }
        if(lexer.GetToken()==Lexer::ConstantString)
        {
                newcol->defaulttype = Database::TText;
                std::string defval( Blex::Lexer::ParseTokenString(lexer.GetTokenSTLString()) );
                newcol->coldef.defaultval.assign(defval.begin(),defval.end());
                lexer.MovetoNextToken();
                return true;
        }

        return false;
}

bool ParseColumnAttribute(SQL::Lexer &lexer, ParsedColumn *newcol, bool *specified_null)
{
        switch (lexer.GetToken())
        {
        case Lexer::NoCirculairs:
                //PARSERULE("P_ColumnAttribute: NOCIRCULAIRS");
                lexer.MovetoNextToken();
                newcol->coldef.nocirculairs=1;
                return true;
        case Lexer::NoUpdate:
                //PARSERULE("P_ColumnAttribute: NOUPDATE");
                lexer.MovetoNextToken();
                newcol->coldef.noupdate=1;
                return true;
        case Lexer::Unique:
                //PARSERULE("P_ColumnAttribute: UNIQUE");
                lexer.MovetoNextToken(); //eat primary
                newcol->coldef.unique=1;
                return true;
        case Lexer::Primary:
                //PARSERULE("P_ColumnAttribute: PRIMARY KEY");
                lexer.MovetoNextToken(); //eat primary
                Expect(lexer,Lexer::Key);
                newcol->coldef.unique=1;
                newcol->coldef.noupdate=1;
                newcol->make_primary=1;
                return true;
        case Lexer::References:
                //PARSERULE("P_ColumnAttribute: REFERENCES tablename");
                lexer.MovetoNextToken(); //eat references

                if (lexer.GetToken() == Lexer::By)
                {
                        lexer.MovetoNextToken(); //eat by
                        Expect(lexer, Lexer::Column);

                        newcol->foreignreferencesbycolumn = ParseName(lexer);
                        newcol->coldef.ondelete = ForeignIllegal;
                }
                else
                {
                        newcol->foreignreference = ParseTableNameSep(lexer);
                        newcol->coldef.ondelete = ForeignIllegal;
                }
                return true;
        case Lexer::On: //FIXME: Accept "ON" only immediately AFTER "REFERENCES"
                //PARSERULE("P_ColumnAttribute: ON DELETE (CASCADE | SET DEFAULT)");
                lexer.MovetoNextToken(); //eat ON
                Expect(lexer,Lexer::Delete);

                if (newcol->foreignreference.second.empty() && newcol->foreignreferencesbycolumn.empty())
                    ParseError(lexer);

                if (lexer.GetToken()==Lexer::Cascade)
                {
                        lexer.MovetoNextToken(); //eat cascade
                        newcol->coldef.ondelete=ForeignCascade;
                }
                else if (lexer.GetToken()==Lexer::Set)
                {
                        lexer.MovetoNextToken(); //eat SET
                        Expect(lexer,Lexer::Default);
                        newcol->coldef.ondelete=ForeignSetDefault;
                }
                else
                {
                        ParseError(lexer);
                }
                return true;
        case Lexer::Null:
                //PARSERULE("P_ColumnAttribute: NULL");
                lexer.MovetoNextToken(); //Eat NULL

                //check for NULL/NOT NULL conflict
                if (*specified_null)
                    ParseError(lexer);

                *specified_null=true;
                return true;
        case Lexer::Not:
                //PARSERULE("P_ColumnAttribute: NOT NULL");
                lexer.MovetoNextToken(); //eat NOT
                Expect(lexer, Lexer::Null);
                newcol->coldef.notnull=1;

                //check for NULL/NOT NULL conflict
                if (*specified_null)
                    ParseError(lexer);

                *specified_null=true;
                return true;
        case Lexer::Autonumber:
                //PARSERULE("P_ColumnAttribute: __AUTONUMBER Expression");
                lexer.MovetoNextToken(); //eat AUTONUMBER
                newcol->coldef.autonumber_start=ParseInteger(lexer);
                if (newcol->coldef.autonumber_start<1)
                    ParseError(lexer);
                return true;
        case Lexer::Default:
                //PARSERULE("P_ColumnAttribute: DEFAULT Expression");
                lexer.MovetoNextToken(); //eat DEFAULT
                return ParseDefault(lexer, newcol);

        case Lexer::Internal:
                //PARSERULE("P_ColumnAttribute: INTERNAL Name");
                lexer.MovetoNextToken(); //eat INTERNAL
                newcol->coldef.internalcolumn_name=ParseName(lexer);
                return true;

        default:
                return false;
        }
}

void ParseColumnType(SQL::Lexer &lexer, ParsedColumn *newcol)
{
        //Parse column type
        switch (lexer.GetToken())
        {
        case Lexer::Varchar:
                //PARSERULE("P_ColumnTypeSize: VARCHAR `(`Expression`)`");
                newcol->coldef.type = TText;
                lexer.MovetoNextToken(); //eat the type
                Expect(lexer,Lexer::OpenParenthesis);
                newcol->coldef.maxsize=ParseInteger(lexer);
                Expect(lexer,Lexer::CloseParenthesis);
                return;

        case Lexer::Integer:
                //PARSERULE("P_ColumnTypeSize: INTEGER");
                lexer.MovetoNextToken(); //eat the type
                newcol->coldef.type = TInteger;
                newcol->coldef.maxsize=4;
                return;
        case Lexer::Boolean:
                //PARSERULE("P_ColumnTypeSize: BOOLEAN");
                lexer.MovetoNextToken(); //eat the type
                newcol->coldef.type=TBoolean;
                newcol->coldef.maxsize=1;
                return;
        case Lexer::Blob:
                //PARSERULE("P_ColumnTypeSize: BLOB");
                lexer.MovetoNextToken(); //eat the type
                newcol->coldef.type=TBlob;
                newcol->coldef.maxsize=8;
                return;
        case Lexer::DateTime:
                //PARSERULE("P_ColumnTypeSize: DATETIME");
                lexer.MovetoNextToken(); //eat the type
                newcol->coldef.type=TDateTime;
                newcol->coldef.maxsize=8;
                return;
        case Lexer::Money:
                //PARSERULE("P_ColumnTypeSize: MONEY");
                lexer.MovetoNextToken(); //eat the type
                newcol->coldef.type=TMoney;
                newcol->coldef.maxsize=8;
                return;
        case Lexer::Integer64:
                //PARSERULE("P_ColumnTypeSize: INTEGER64");
                lexer.MovetoNextToken(); //eat the type
                newcol->coldef.type=TInteger64;
                newcol->coldef.maxsize=8;
                return;
        case Lexer::Float:
                //PARSERULE("P_ColumnTypeSize: FLOAT");
                lexer.MovetoNextToken(); //eat the type
                newcol->coldef.type=TFloat;
                newcol->coldef.maxsize=8;
                return;
        case Lexer::Table:
                //PARSERULE("P_ColumnTypeSize: Table");
                lexer.MovetoNextToken(); //eat the type
                newcol->coldef.type=TTable;
                newcol->coldef.maxsize=4;
                return;
        case Lexer::Role:
                //PARSERULE("P_ColumnTypeSize: Table");
                lexer.MovetoNextToken(); //eat the type
                newcol->coldef.type=TRole;
                newcol->coldef.maxsize=4;
                return;
        default:
                ParseError(lexer);
        }
}

void ParseColumn(SQL::Lexer &lexer, ParsedColumn *newcol)
{
        //PARSERULE("P_ColumnDefinition: Name ColumnTypeSize (ColumnAttributes)*");
        newcol->coldef.name=ParseName(lexer);
        if (newcol->coldef.name.empty() || newcol->coldef.name[0]=='*')
            throw Exception(ErrorIllegalSQLCommand,"Illegal column name");

        ParseColumnType(lexer,newcol);

        bool already_had_null=false; //did we already have a NULL or NOT NULL ?
        while (ParseColumnAttribute(lexer,newcol,&already_had_null))
            /* just repeat */;
}

void ParsePrivilege(SQL::Lexer &lexer, PrivilegeDescriptor &desc)
{
        switch (lexer.GetToken())
        {
        case Lexer::Select:
                desc.AddPrivilege(Privilege::Column_Select, false); break;
        case Lexer::Update:
                desc.AddPrivilege(Privilege::Column_Update, false); break;
        case Lexer::Insert:
                desc.AddPrivilege(Privilege::Column_Insert, false); break;
        case Lexer::Delete:
                desc.AddPrivilege(Privilege::Table_Delete, false); break;
        case Lexer::References:
                desc.AddPrivilege(Privilege::Column_References, false); break;
        default:
                ParseError(lexer);
        }
        lexer.MovetoNextToken(); //eat the type
}

bool ParsePrivileges(SQL::Lexer &lexer, PrivilegeDescriptor &desc)
{
        if (lexer.GetToken() == Lexer::All)
        {
                lexer.MovetoNextToken();
                Expect(lexer, Lexer::Privileges);

                desc.AddPrivilege(Privilege::Column_Select, false);
                desc.AddPrivilege(Privilege::Column_Update, false);
                desc.AddPrivilege(Privilege::Column_Insert, false);
                desc.AddPrivilege(Privilege::Table_Delete, false);
                desc.AddPrivilege(Privilege::Column_References, false);
                return true;
        }
        else
            while (true)
            {
                    ParsePrivilege(lexer, desc);

                    if (lexer.GetToken() != Lexer::Comma)
                        break;
                    Expect(lexer, Lexer::Comma);
            }
        return false;
}

SQLCreateTableStatement::SQLCreateTableStatement(SQL::Lexer &lexer)
{
        //CREATE TABLE tablename columns [READACCESSMANAGER Name] [WRITEACCESSMANAGER Name]
        SchemaTableName names = ParseTableNameSep(lexer);

        schema = names.first;
        newtable.name = names.second;
        newtable.object_id=0; // ID is created during entering

        //parse the columns
        ParseColumns(lexer);

        //parse table attributes
        ParseAttributes(lexer);
}

void SQLCreateTableStatement::ParseColumns(SQL::Lexer &lexer)
{
        //PARSERULE("P_CreateColumns: `(` ColumnDefinition ( `,` ColumnDefinition )* `)`");
        Expect(lexer, Lexer::OpenParenthesis);

        while (true) //right recursive
        {
                coldefs.push_back(ParsedColumn());
                ParseColumn(lexer,&coldefs.back());


                if (lexer.GetToken()!=Lexer::Comma)
                    break;
                lexer.MovetoNextToken(); //eat the comma
        }
        Expect(lexer, Lexer::CloseParenthesis);
}

void SQLCreateTableStatement::ParseAttributes(SQL::Lexer &lexer)
{
        while(true)
        {
                switch(lexer.GetToken())
                {
                case Lexer::ReadAccessManager:
                        if (!newtable.readaccess_name.empty()) //dupe mgr
                            ParseError(lexer);

                        lexer.MovetoNextToken(); //eat AccessManager
                        newtable.readaccess_name=ParseName(lexer);
                        break;
                case Lexer::WriteAccessManager:
                        if (!newtable.writeaccess_name.empty()) //dupe mgr
                            ParseError(lexer);

                        lexer.MovetoNextToken(); //eat AccessManager
                        newtable.writeaccess_name=ParseName(lexer);
                        break;
                default:
                        return;
                }
        }
}

SQLCreateSchemaStatement::SQLCreateSchemaStatement(SQL::Lexer &lexer)
{
        newschema.name = ParseName(lexer);
        Expect(lexer, Lexer::Authorization);
        admin = ParseRoleName(lexer);
}

SQLAlterSchemaRenameStatement::SQLAlterSchemaRenameStatement(std::string const &schemaname, SQL::Lexer &lexer)
: schemaname(schemaname)
{
        newschemaname = ParseName(lexer);
}

SQLAlterSchemaOwnerStatement::SQLAlterSchemaOwnerStatement(std::string const &schemaname, SQL::Lexer &lexer)
: schemaname(schemaname)
{
        newowner = ParseRoleName(lexer);
}

SQLAlterTableRenameColumnStatement::SQLAlterTableRenameColumnStatement(SchemaTableName  const &tablename, SQL::Lexer &lexer)
: tablename(tablename)
{
        columnname = ParseName(lexer);

        Expect(lexer, Lexer::To);

        newcolumnname = ParseName(lexer);
}

SQLAlterTableAddColumnStatement::SQLAlterTableAddColumnStatement(SchemaTableName  const &tablename, SQL::Lexer &lexer)
: tablename(tablename)
{
        //PARSERULE("P_AlterStatement: ALTER TABLE TableName (ADD COLUMN ColumnDefinition)");
        ParseColumn(lexer, &newcol);
}

SQLAlterTableAlterColumnStatement::SQLAlterTableAlterColumnStatement(SchemaTableName const &tablename, SQL::Lexer &lexer, bool is_drop_column)
: tablename(tablename)
, bypass_rights(false)
{
        colinfo.coldef.name = ParseName(lexer);

        if (is_drop_column)
        {
                type = DropColumn;
                return;
        }
        else if (lexer.GetToken() == Lexer::Set)
        {
                lexer.MovetoNextToken();
                if (lexer.GetToken() == Lexer::Maxlength)
                {
                        lexer.MovetoNextToken();

                        colinfo.coldef.maxsize = ParseInteger(lexer);
                        type = SetMaxLength;
                        return;
                }
                else if (lexer.GetToken() == Lexer::Default)
                {
                        lexer.MovetoNextToken();
                        type = UpdateDefault;
                        if(!ParseDefault(lexer, &colinfo))
                            ParseError(lexer);
                        return;
                }
                else if (lexer.GetToken() == Lexer::NoUpdate)
                {
                        lexer.MovetoNextToken();
                        type = SetNoupdate;
                        return;
                }
                else if (lexer.GetToken() == Lexer::Unique)
                {
                        lexer.MovetoNextToken();
                        type = SetUnique;
                        return;
                }
                else if (lexer.GetToken() == Lexer::Not)
                {
                        Expect(lexer, Lexer::Not);
                        Expect(lexer, Lexer::Null);
                        type = SetNotNull;
                        return;
                }
                if (lexer.GetToken() == Lexer::Autonumber)
                {
                        lexer.MovetoNextToken();
                        type = AddAutonumber;

                        colinfo.coldef.autonumber_start = ParseInteger(lexer);
                        if (colinfo.coldef.autonumber_start <= 0)
                            ParseError(lexer);
                        return;
                }

                Expect(lexer, Lexer::References);

                colinfo.foreignreference = ParseTableNameSep(lexer);
                type = AddReference;

                if (lexer.GetToken()==Lexer::On)
                {
                        //PARSERULE("P_ColumnAttribute: ON DELETE (CASCADE | SET DEFAULT)");
                        lexer.MovetoNextToken(); //eat ON
                        Expect(lexer,Lexer::Delete);

                        if (lexer.GetToken()==Lexer::Cascade)
                        {
                                lexer.MovetoNextToken(); //eat cascade
                                colinfo.coldef.ondelete=ForeignCascade;
                        }
                        else if (lexer.GetToken()==Lexer::Set)
                        {
                                lexer.MovetoNextToken(); //eat SET
                                Expect(lexer,Lexer::Default);
                                colinfo.coldef.ondelete=ForeignSetDefault;
                        }
                        else
                        {
                                ParseError(lexer);
                        }
                }
                else
                {
                        colinfo.coldef.ondelete=ForeignIllegal;
                }
                return;
        }
        Expect(lexer, Lexer::Drop);
        if (lexer.GetToken() == Lexer::Unique)
        {
                lexer.MovetoNextToken();
                type=DropUnique;
                return;
        }
        else if (lexer.GetToken() == Lexer::Autonumber)
        {
                lexer.MovetoNextToken();
                type=DropAutonumber;
                colinfo.coldef.autonumber_start=0;
                return;
        }
        else if (lexer.GetToken() == Lexer::References)
        {
                lexer.MovetoNextToken();
                type=DropReference;
                return;
        }
        else if (lexer.GetToken() == Lexer::NoUpdate)
        {
                lexer.MovetoNextToken();
                type=DropNoupdate;
                return;
        }
        else if (lexer.GetToken() == Lexer::Default)
        {
                lexer.MovetoNextToken();
                type=UpdateDefault;
                return;
        }

        Expect(lexer, Lexer::Not);
        Expect(lexer, Lexer::Null);
        type = DropNotNull;
        return;
}

SQLAlterTableAlterColumnStatement::SQLAlterTableAlterColumnStatement(SchemaTableName  const &tablename, std::string const &columnname, Type _type)
: tablename(tablename)
, bypass_rights(true)
{
        colinfo.coldef.name = columnname;
        type = _type;
}

SQLDropTableStatement::SQLDropTableStatement(SQL::Lexer &lexer)
: SQLDropStatementExecutor(false)
{
        //PARSERULE("P_DropStatement: DROP TABLE TableName");
        tablename = ParseTableNameSep(lexer);

        if (lexer.GetToken() == Lexer::Cascade || lexer.GetToken() == Lexer::Restrict)
        {
                cascade = lexer.GetToken() == Lexer::Cascade;
                lexer.MovetoNextToken();
        }
}

SQLDropSchemaStatement::SQLDropSchemaStatement(SQL::Lexer &lexer)
{
        //PARSERULE("P_DropSchemaStatement: DROP SCHEMA TableName");
        schemaname = ParseName(lexer);
}

SQLAlterTableModifyMgrStatement::SQLAlterTableModifyMgrStatement(SchemaTableName const &tablename, bool is_set, bool is_readaccess, SQL::Lexer &lexer)
: tablename(tablename)
, is_readaccess(is_readaccess)
{
        if (is_set)
        {
                newmgr=ParseName(lexer);
                lexer.MovetoNextToken();
        }
}

///////////////////////////////////////////////////////////////////////////////
// CREATE ROLE
SQLCreateRoleStatement::SQLCreateRoleStatement(SQL::Lexer &lexer)
{
        rolename = ParseRoleName(lexer);
}
///////////////////////////////////////////////////////////////////////////////
// CREATE USER name
SQLCreateUserStatement::SQLCreateUserStatement(SQL::Lexer &lexer)
{
        username = ParseName(lexer);
}

///////////////////////////////////////////////////////////////////////////////
// ALTER ROLE ... RENAME TO ...
SQLAlterRoleRenameStatement::SQLAlterRoleRenameStatement(SQL::Lexer &lexer)
{
        rolename = ParseRoleName(lexer);

        Expect(lexer, Lexer::Rename);
        Expect(lexer, Lexer::To);

        new_name = ParseName(lexer);
}

///////////////////////////////////////////////////////////////////////////////
// CREATE INDEX
SQLCreateIndexStatement::SQLCreateIndexStatement(SQL::Lexer &lexer)
: unique(false)
, uppercase(false)
, nonullstores(false)
{
        //CREATE [NONULLSTORES] [UNIQUE] [UPPERCASE] INDEX indexname ON tablename(column [ '[' maxlen ']' ] [ , column [ '[' maxlen ']' ] ... ]);
        while (lexer.GetToken() != Lexer::Index)
        {
                switch(lexer.GetToken())
                {
                case Lexer::Unique:
                        if (unique)
                            ParseError(lexer);
                         unique=true;
                        break;
                case Lexer::NoNullStores:
                        if (nonullstores)
                            ParseError(lexer);
                         nonullstores=true;
                        break;
                case Lexer::Uppercase:
                        if (uppercase)
                            ParseError(lexer);
                         uppercase=true;
                         break;
                default:
                        ParseError(lexer);
                }
                lexer.MovetoNextToken();
        }
        lexer.MovetoNextToken(); //skip INDEX

        indexname = ParseName(lexer);
        Expect(lexer, Lexer::On);
        tablename = ParseTableNameSep(lexer);
        Expect(lexer, Lexer::OpenParenthesis);

        while (true)
        {
                IndexedColumn nextcol;
                nextcol.colname = ParseName(lexer);
                if (lexer.GetToken() == Lexer::OpenSubscript)
                {
                        lexer.MovetoNextToken();
                        nextcol.maxlength = ParseInteger(lexer);
                        if (nextcol.maxlength <= 0 || nextcol.maxlength >= 64)
                            throw Exception(ErrorIllegalSQLCommand,"Invalid maximum length for indexed column");
                        Expect(lexer, Lexer::CloseSubscript);
                }

                columns.push_back(nextcol);
                if (lexer.GetToken() == Lexer::CloseParenthesis)
                    break;

                Expect(lexer,Lexer::Comma);
        }
        lexer.MovetoNextToken(); //skip close parenthesis
}

///////////////////////////////////////////////////////////////////////////////
// DROP INDEX
SQLDropIndexStatement::SQLDropIndexStatement(SQL::Lexer &lexer)
{
        //DROP INDEX indexname ON tablename
        indexname = ParseName(lexer);
        Expect(lexer, Lexer::On);
        tablename = ParseTableNameSep(lexer);
}

///////////////////////////////////////////////////////////////////////////////
// DROP ROLE
SQLDropRoleStatement::SQLDropRoleStatement(SQL::Lexer &lexer)
{
        //DROP ROLE rolename
        role = ParseRoleName(lexer);
}
///////////////////////////////////////////////////////////////////////////////
// DROP USER
SQLDropUserStatement::SQLDropUserStatement(SQL::Lexer &lexer)
{
        //DROP USER rolename
        username = ParseName(lexer);
}

///////////////////////////////////////////////////////////////////////////////
// SHOW
SQLShowStatement::SQLShowStatement(SQL::Lexer &lexer)
: headersonly(false)
{
        what = lexer.GetTokenSTLString();
        lexer.MovetoNextToken();
//        what = ParseName(lexer);
        Blex::ToUppercase(what.begin(),what.end());
        if (what == "SECTION")
        {
                sectionid = ParseInteger(lexer);
        }
        if (what == "SECTIONHEADERS")
        {
                sectionid = ParseInteger(lexer);
                headersonly = true;
        }
        if (what == "INDEX")
            indexid = ParseInteger(lexer);
        if (what == "PARAMETER")
            param = ParseName(lexer);
        Blex::ToUppercase(param.begin(), param.end());
}
///////////////////////////////////////////////////////////////////////////////
// WAIT INDEX
SQLWaitStatement::SQLWaitStatement(SQL::Lexer &lexer)
{
        Expect(lexer, Lexer::Index);
}

///////////////////////////////////////////////////////////////////////////////
// GRANT privileges
SQLGrantRevokePrivilegesStatement::SQLGrantRevokePrivilegesStatement(SQL::Lexer &lexer, bool is_grant)
: is_grant(is_grant)
, grant_option(false)
{
        if(!is_grant && lexer.GetToken() == Lexer::Grant) //revoke
        {
                lexer.MovetoNextToken();
                Expect(lexer, Lexer::Option);
                Expect(lexer, Lexer::For);
                grant_option = true;
        }
        all_privileges = ParsePrivileges(lexer, privileges);

        Expect(lexer, Lexer::On);

        if (lexer.GetToken() == Lexer::Schema)
        {
                lexer.MovetoNextToken();
                schema = ParseSchemaName(lexer);
                object_type = MetaObjectType::Schema;
        }
        else
        {
                bool force_table = lexer.GetToken() == Lexer::Table;
                if (force_table)
                    lexer.MovetoNextToken();

                // Parse table name
                SchemaTableName tbl = ParseTableNameSep(lexer);
                schema = tbl.first;
                table = tbl.second;

                if (lexer.GetToken() != Lexer::OpenParenthesis)
                {
                        object_type = MetaObjectType::Table;
                }
                else
                {
                        if (force_table)
                            ParseError(lexer);

                        lexer.MovetoNextToken();

                        while (true)
                        {
                                std::string column = ParseName(lexer);
                                columns.push_back(column);

                                if (lexer.GetToken() != Lexer::CloseParenthesis)
                                    Expect(lexer, Lexer::Comma);
                                else
                                    break;
                        }
                        lexer.MovetoNextToken();
                        object_type = MetaObjectType::Column;
                }
        }

        Expect(lexer, is_grant ? Lexer::To : Lexer::From);
        grantee = ParseRoleName(lexer);

        if (is_grant && lexer.GetToken() == Lexer::With)
        {
                lexer.MovetoNextToken();
                Expect(lexer, Lexer::Grant);
                Expect(lexer, Lexer::Option);
                privileges.AddGrantOptions();
                grant_option = true;
        }

        //ADDME: GRANTED BY ... Should be optional
        Expect(lexer, Lexer::Granted);
        Expect(lexer, Lexer::By);

        grantor = ParseRoleName(lexer);
}


///////////////////////////////////////////////////////////////////////////////
// GRANT role
SQLGrantRevokeRoleStatement::SQLGrantRevokeRoleStatement(SQL::Lexer &lexer, bool is_grant)
: is_grant(is_grant)
, admin_option(false)
{
        if (!is_grant && lexer.GetToken() == Lexer::Admin)
        {
                lexer.MovetoNextToken();
                Expect(lexer, Lexer::Option);
                Expect(lexer, Lexer::For);
                admin_option = true;
        }

        while (true)
        {
                roles.push_back(ParseRoleName(lexer));

                if (lexer.GetToken() != Lexer::Comma)
                    break;
                Expect(lexer, Lexer::Comma);
        }

        Expect(lexer, is_grant ? Lexer::To : Lexer::From);
        grantee = ParseRoleName(lexer);

        if (is_grant && lexer.GetToken() == Lexer::With)
        {
                lexer.MovetoNextToken();
                Expect(lexer, Lexer::Admin);
                Expect(lexer, Lexer::Option);
                admin_option = true;
        }

        //ADDME: GRANTED BY ... Should be optional
        Expect(lexer, Lexer::Granted);
        Expect(lexer, Lexer::By);

        grantor = ParseRoleName(lexer);
}

///////////////////////////////////////////////////////////////////////////////
// MOVE table
SQLMoveTableStatement::SQLMoveTableStatement(SQL::Lexer &lexer)
{
        Expect(lexer, Lexer::Table);

        old_tablename = ParseTableNameSep(lexer);

        Expect(lexer, Lexer::To);

        new_table.first = ParseSchemaName(lexer);
        if (lexer.GetToken() == Lexer::As)
        {
                lexer.MovetoNextToken();
                new_table.second = ParseName(lexer);
        }
}

///////////////////////////////////////////////////////////////////////////////
// SET statement
SQLSetStatement::SQLSetStatement(SQL::Lexer &lexer)
{
        if (lexer.GetToken() != Lexer::Global && lexer.GetToken() != Lexer::Local)
            throw Exception(ErrorIllegalSQLCommand,"Expected GLOBAL or LOCAL after SET");

        isglobal = lexer.GetToken() == Lexer::Global;
        lexer.MovetoNextToken();

        param = ParseName(lexer);

        if (lexer.GetToken() == Lexer::OpEquality)
            lexer.MovetoNextToken();
        else
            Expect(lexer, Lexer::To);

        if (!lexer.IsReservedWord())
        {
                if (lexer.GetToken() == Lexer::ConstantString)
                {
                        std::string colname = Blex::Lexer::ParseTokenString(lexer.GetTokenSTLString());
                        if (colname.empty())
                            ParseError(lexer);
                        lexer.MovetoNextToken();
                        value = colname;
                }
                else
                {
                        value = lexer.GetTokenSTLString();
                        lexer.MovetoNextToken();
                }
        }
        else
        {
                value = lexer.GetTokenIdentifier();
                lexer.MovetoNextToken();
        }
}

///////////////////////////////////////////////////////////////////////////////
// The parsers
//
bool PAE_AlterSchema(BackendTransaction &trans,SQL::Lexer &lexer)
{
        std::string schemaname = ParseSchemaName(lexer);

        switch (lexer.GetToken())
        {
        case Lexer::Rename:
                lexer.MovetoNextToken();
                Expect(lexer,Lexer::To);
                return SQL::SQLAlterSchemaRenameStatement(schemaname,lexer).Execute(trans);
        case Lexer::Set:
                lexer.MovetoNextToken();
                Expect(lexer,Lexer::Authorization);
                Expect(lexer,Lexer::To);
                return SQL::SQLAlterSchemaOwnerStatement(schemaname,lexer).Execute(trans);
        default:
                ParseError(lexer);
        }
        return false;
}

bool PAE_AlterTable(BackendTransaction &trans,SQL::Lexer &lexer)
{
        SchemaTableName tablename = ParseTableNameSep(lexer);

        switch (lexer.GetToken())
        {
        case Lexer::Rename:
                lexer.MovetoNextToken();
                Expect(lexer,Lexer::Column);
                return SQL::SQLAlterTableRenameColumnStatement(tablename,lexer).Execute(trans);
        case Lexer::Add:
                lexer.MovetoNextToken();
                Expect(lexer,Lexer::Column);
                return SQL::SQLAlterTableAddColumnStatement(tablename,lexer).Execute(trans);
        case Lexer::Alter:
                lexer.MovetoNextToken();
                Expect(lexer,Lexer::Column);
                return SQL::SQLAlterTableAlterColumnStatement(tablename,lexer,false).Execute(trans);
        case Lexer::Drop:
                lexer.MovetoNextToken();
                switch (lexer.GetToken())
                {
                case Lexer::Column:
                        lexer.MovetoNextToken();
                        return SQL::SQLAlterTableAlterColumnStatement(tablename,lexer,true).Execute(trans);
                case Lexer::ReadAccessManager:
                        lexer.MovetoNextToken();
                        return SQL::SQLAlterTableModifyMgrStatement(tablename,false,true,lexer).Execute(trans);
                case Lexer::WriteAccessManager:
                        lexer.MovetoNextToken();
                        return SQL::SQLAlterTableModifyMgrStatement(tablename,false,false,lexer).Execute(trans);
                default:
                        ParseError(lexer);
                        return false;
                }
        case Lexer::Set:
                lexer.MovetoNextToken();
                switch(lexer.GetToken())
                {
                case Lexer::ReadAccessManager:
                        lexer.MovetoNextToken();
                        return SQL::SQLAlterTableModifyMgrStatement(tablename,true,true,lexer).Execute(trans);
                case Lexer::WriteAccessManager:
                        lexer.MovetoNextToken();
                        return SQL::SQLAlterTableModifyMgrStatement(tablename,true,false,lexer).Execute(trans);
                default:
                        ParseError(lexer);
                        return false;
                }
        default:
                ParseError(lexer);
        }
        return false;
}

bool PAE_Alter(BackendTransaction &trans,SQL::Lexer &lexer)
{
        switch (lexer.GetToken())
        {
        case Lexer::Schema:
                lexer.MovetoNextToken();
                return PAE_AlterSchema(trans,lexer);
        case Lexer::Table:
                lexer.MovetoNextToken();
                return PAE_AlterTable(trans,lexer);
        case Lexer::Role:
                SQLAlterRoleRenameStatement(lexer).Execute(trans);
                return true;
        default:
                ParseError(lexer);
        }
        return false;
}

bool ParseAndExecuteCommand(BackendTransaction &trans,std::string const &cmd, TempResultSet *storage, bool allow_modifications, ConnectionControl *conncontrol)
{
        std::vector<uint8_t> mycmd(cmd.begin(),cmd.end());
        mycmd.push_back(0); //FIXME: ugly workaround for Lexer expecting a NULL termination

        SQL::Lexer lexer;
        lexer.StartLexer(&mycmd[0],mycmd.size()-1);
        lexer.MovetoNextToken();

        bool update_metadata=false;

        switch(lexer.GetToken())
        {
        case SQL::Lexer::Create:
                if (!allow_modifications)
                    return false;
                lexer.MovetoNextToken();
                if (lexer.GetToken() == SQL::Lexer::Table)
                {
                        lexer.MovetoNextToken();
                        update_metadata=SQL::SQLCreateTableStatement(lexer).Execute(trans);
                        break;
                }
                else if (lexer.GetToken() == SQL::Lexer::Schema)
                {
                        lexer.MovetoNextToken();
                        update_metadata=SQL::SQLCreateSchemaStatement(lexer).Execute(trans);
                        break;
                }
                else if (lexer.GetToken() == SQL::Lexer::Role)
                {
                        lexer.MovetoNextToken();
                        update_metadata=SQL::SQLCreateRoleStatement(lexer).Execute(trans, storage);
                        break;
                }
                else if (lexer.GetToken() == SQL::Lexer::User)
                {
                        lexer.MovetoNextToken();
                        update_metadata=SQL::SQLCreateUserStatement(lexer).Execute(trans, storage);
                        break;
                }
                else
                {
                        update_metadata=SQL::SQLCreateIndexStatement(lexer).Execute(trans);
                }
                break;
        case SQL::Lexer::Alter:
                if (!allow_modifications)
                    return false;
                lexer.MovetoNextToken();
                update_metadata=PAE_Alter(trans,lexer);
                break;
        case SQL::Lexer::Drop:
                if (!allow_modifications)
                    return false;
                lexer.MovetoNextToken();
                if (lexer.GetToken() == SQL::Lexer::Table)
                {
                        lexer.MovetoNextToken();
                        update_metadata=SQL::SQLDropTableStatement(lexer).Execute(trans);
                        break;
                }
                else if (lexer.GetToken() == SQL::Lexer::Schema)
                {
                        lexer.MovetoNextToken();
                        update_metadata=SQL::SQLDropSchemaStatement(lexer).Execute(trans);
                        break;
                }
                else if (lexer.GetToken() == SQL::Lexer::Index)
                {
                        lexer.MovetoNextToken();
                        update_metadata=SQL::SQLDropIndexStatement(lexer).Execute(trans);
                        break;
                }
                else if (lexer.GetToken() == SQL::Lexer::Role)
                {
                        lexer.MovetoNextToken();
                        update_metadata=SQL::SQLDropRoleStatement(lexer).Execute(trans);
                        break;
                }
                else if (lexer.GetToken() == SQL::Lexer::User)
                {
                        lexer.MovetoNextToken();
                        update_metadata=SQL::SQLDropUserStatement(lexer).Execute(trans);
                        break;
                }
                else
                {
                        ParseError(lexer);
                }
                break;
        case Lexer::Wait:
                lexer.MovetoNextToken();
                update_metadata=SQL::SQLWaitStatement(lexer).Execute(trans);
                break;
        case Lexer::Show:
                lexer.MovetoNextToken();
                SQL::SQLShowStatement(lexer).Execute(trans, storage);
                update_metadata=false;
                break;
        case Lexer::Grant:
                if (!allow_modifications)
                    return false;
                lexer.MovetoNextToken();
                // Role names
                if (lexer.IsName() || lexer.GetToken() == Lexer::Public)
                {
                        SQLGrantRevokeRoleStatement(lexer,true).Execute(trans);
                        update_metadata=true;
                }
                else
                {
                        SQLGrantRevokePrivilegesStatement(lexer,true).Execute(trans);
                        update_metadata=true;
                }
                break;
        case Lexer::Revoke:
                if (!allow_modifications)
                    return false;
                lexer.MovetoNextToken();
                // Role names
                if (lexer.IsName() || lexer.GetToken() == Lexer::Public || lexer.GetToken() == Lexer::Admin)
                {
                        SQLGrantRevokeRoleStatement(lexer,false).Execute(trans);
                        update_metadata=true;
                }
                else
                {
                        SQLGrantRevokePrivilegesStatement(lexer,false).Execute(trans);
                        update_metadata=true;
                }
                break;
        case Lexer::Move:
                if (!allow_modifications)
                    return false;
                lexer.MovetoNextToken();
                update_metadata = SQLMoveTableStatement(lexer).Execute(trans);
                break;
        case Lexer::Set:
                if (!allow_modifications)
                    return false;
                lexer.MovetoNextToken();
                update_metadata = SQLSetStatement(lexer).Execute(trans, conncontrol);
                break;
        case Lexer::Refresh_Metadata:
                lexer.MovetoNextToken();
                update_metadata = SQLRefreshMetadata(lexer).Execute(trans);
                break;
        default:
                ParseError(lexer);
        }
        if (lexer.GetToken() != SQL::Lexer::Eof)
            throw Exception(ErrorIllegalSQLCommand,"Garbage at end of SQL statement: " + lexer.GetTokenSTLString());
        if (update_metadata) //ADDME: Should just listen to actual table updates!
            trans.NotifyMetadataModification();

        return update_metadata;
}

} // end of namespace SQL
} // end of namespace Database
