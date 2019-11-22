#ifndef blex_webhare_dbase_sql_parser
#define blex_webhare_dbase_sql_parser

#include <blex/lexer.h>
//#include <blex/decimalfloat.h>
#include "backend_sql_lexer.h"
#include "dbase_types.h"
#include "dbase_meta.h"
#include "dbase_privileges.h"

namespace Database {

class ConnectionControl;

namespace SQL {

typedef std::pair< std::string, std::string > SchemaTableName;
typedef std::pair< std::string, std::string > SchemaRoleName;

struct ParsedColumn
{
        ParsedColumn()
        : defaulttype(Database::TUnusedStatic)
        , make_primary(false)
        {
        }

        ColumnDef coldef;

        Database::ColumnTypes defaulttype;
        SchemaTableName foreignreference;
        std::string foreignreferencesbycolumn;
        bool make_primary;
};

class SQLCreateTableStatement
{
        public:
        SQLCreateTableStatement(SQL::Lexer &lexer);
        bool Execute(BackendTransaction &trans);

        private:
        void ParseColumns(SQL::Lexer &lexer);
        void ParseAttributes(SQL::Lexer &lexer);
        std::string schema;
        TableDef newtable;
        std::vector<ParsedColumn> coldefs;
};

class SQLCreateSchemaStatement
{
        public:
        SQLCreateSchemaStatement(SQL::Lexer &lexer);
        bool Execute(BackendTransaction &trans);

        private:
        SchemaDef newschema;
        SchemaRoleName admin;
};

class SQLAlterSchemaRenameStatement
{
        public:
        SQLAlterSchemaRenameStatement(std::string const &schemaname, SQL::Lexer &lexer);
        bool Execute(BackendTransaction &trans);

        private:
        std::string schemaname;
        std::string newschemaname;
};

class SQLAlterSchemaOwnerStatement
{
        public:
        SQLAlterSchemaOwnerStatement(std::string const &schemaname, SQL::Lexer &lexer);
        bool Execute(BackendTransaction &trans);

        private:
        std::string schemaname;
        SchemaRoleName newowner;
};

class SQLCreateIndexStatement
{
        public:
        SQLCreateIndexStatement(SQL::Lexer &lexer);
        bool Execute(BackendTransaction &trans);

        private:
        struct IndexedColumn
        {
                IndexedColumn() { maxlength=0; }

                std::string colname;
                unsigned maxlength;
        };

        std::string indexname;
        SchemaTableName tablename;
        std::vector<IndexedColumn> columns;
        bool unique;
        bool uppercase;
        bool nonullstores;
};

class SQLDropIndexStatement
{
        public:
        SQLDropIndexStatement(SQL::Lexer &lexer);
        bool Execute(BackendTransaction &trans);

        private:
        std::string indexname;
        SchemaTableName tablename;
};

class SQLDropRoleStatement
{
        public:
        SQLDropRoleStatement(SQL::Lexer &lexer);
        SQLDropRoleStatement(std::string const &schema, std::string const &name) : role(std::make_pair(schema, name)) {}
        bool Execute(BackendTransaction &trans);

        private:
        SchemaRoleName role;
};

class SQLDropUserStatement
{
        public:
        SQLDropUserStatement(SQL::Lexer &lexer);
        bool Execute(BackendTransaction &trans);

        private:

        std::string username;
};


class SQLAlterTableRenameColumnStatement
{
        public:
        SQLAlterTableRenameColumnStatement(SchemaTableName const &tablename, SQL::Lexer &lexer);
        bool Execute(BackendTransaction &trans);

        private:
        SchemaTableName tablename;
        std::string columnname;
        std::string newcolumnname;
};

class SQLAlterTableAddColumnStatement
{
        public:
        SQLAlterTableAddColumnStatement(SchemaTableName const &tablename, SQL::Lexer &lexer);
        bool Execute(BackendTransaction &trans);

        private:
        SchemaTableName tablename;
        ParsedColumn newcol;
};

class SQLAlterTableAlterColumnStatement
{
        public:
        enum Type { DropColumn, SetMaxLength, DropNotNull, SetNotNull, DropUnique, SetUnique, DropNoupdate, SetNoupdate, DropReference, AddReference, DropAutonumber, AddAutonumber, UpdateDefault } type;

        SQLAlterTableAlterColumnStatement(SchemaTableName const &tablename, SQL::Lexer &lexer, bool is_drop_column);
        SQLAlterTableAlterColumnStatement(SchemaTableName const &tablename, std::string const &columnname, Type _type);
        bool Execute(BackendTransaction &trans);

        private:
        ParsedColumn colinfo;
        SchemaTableName tablename;
        bool bypass_rights;
};

//set or drop the read or write acces manager of a table
class SQLAlterTableModifyMgrStatement
{
        public:
        SQLAlterTableModifyMgrStatement(SchemaTableName const &tablename, bool is_set, bool is_readaccess, SQL::Lexer &lexer);
        bool Execute(BackendTransaction &trans);

        private:
        SchemaTableName tablename;
        std::string newmgr;
        bool is_readaccess;
};

class SQLDropStatementExecutor
{
        public:
        SQLDropStatementExecutor(bool _cascade) : cascade(_cascade) {}
        SQLDropStatementExecutor(TableId _tableid, SchemaTableName const &_tablename, bool _cascade) : tableid(_tableid), tablename(_tablename), cascade(_cascade) {}

        bool Execute(BackendTransaction &trans);
        bool ExecuteFromList(BackendTransaction &trans, std::vector<TableId> const &deltables);

        void GatherDeletionList(std::vector<TableId> *currentlist, TableId tocheck, Metadata const &meta);
        void RemoveReferenceConstraints(BackendTransaction &trans, std::vector<TableId> &deletelist);
        void CancelMetaColumnChecks(BackendTransaction &trans, TableId to_cancel);
        void DropMetaTabledef(BackendTransaction &trans, TableId todrop);

        protected:
        TableId tableid;
        SchemaTableName tablename;
        bool cascade;
};

class SQLShowStatement
{
        public:
        SQLShowStatement(SQL::Lexer &lexer);
        bool Execute(BackendTransaction &trans, TempResultSet *storage);

        private:
        void DumpSection(BackendTransaction &trans, TempResultSet *storage);
        void DumpIndex(BackendTransaction &trans, TempResultSet *storage);

        std::string what;
        unsigned sectionid;
        unsigned indexid;
        std::string param;
        bool headersonly;
};

class SQLDropTableStatement : private SQLDropStatementExecutor
{
        public:
        SQLDropTableStatement(SQL::Lexer &lexer);
        bool Execute(BackendTransaction &trans);
};

class SQLDropSchemaStatement
{
        public:
        SQLDropSchemaStatement(SQL::Lexer &lexer);
        bool Execute(BackendTransaction &trans);

        private:
        std::string schemaname;
};

class SQLWaitStatement
{
        public:
        SQLWaitStatement(SQL::Lexer &lexer);
        bool Execute(BackendTransaction &trans);

        private:
};

class SQLCreateRoleStatement
{
    public:
        SQLCreateRoleStatement(SQL::Lexer &lexer);
        SQLCreateRoleStatement(std::string const &schema, std::string const &name) : rolename(std::make_pair(schema, name)) {}
        bool Execute(BackendTransaction &trans, TempResultSet *storage);

    private:
        /// Schema name and role name
        SchemaRoleName rolename;
};

class SQLCreateUserStatement
{
    public:
        SQLCreateUserStatement(SQL::Lexer &lexer);
        bool Execute(BackendTransaction &trans, TempResultSet *storage);

    private:
        std::string username;
};

class SQLAlterRoleRenameStatement
{
    public:
        SQLAlterRoleRenameStatement(SQL::Lexer &lexer);
        bool Execute(BackendTransaction &trans);

    private:
        /// Schema name and role name
        SchemaRoleName rolename;

        /// New name
        std::string new_name;
};

class SQLGrantRevokePrivilegesStatement
{
    public:
        SQLGrantRevokePrivilegesStatement(SQL::Lexer &lexer, bool is_grant);
        bool Execute(BackendTransaction &trans);

    private:
        bool is_grant;
        MetaObjectType::_type object_type;
        std::string schema;
        std::string table;
        std::vector< std::string > columns;

        SchemaRoleName grantee;
        SchemaRoleName grantor;

        PrivilegeDescriptor privileges;
        bool all_privileges;
        bool grant_option;
};

class SQLGrantRevokeRoleStatement
{
    public:
        SQLGrantRevokeRoleStatement(SQL::Lexer &lexer, bool is_grant);
        bool Execute(BackendTransaction &trans);

    private:
        bool is_grant;
        std::vector< SchemaRoleName > roles;
        SchemaRoleName grantee;
        SchemaRoleName grantor;

        bool admin_option;
};

class SQLMoveTableStatement
{
    public:
        SQLMoveTableStatement(SQL::Lexer &lexer);
        bool Execute(BackendTransaction &trans);

    private:
        SchemaTableName old_tablename;
        SchemaTableName new_table;
};

class SQLRefreshMetadata
{
        public:
        SQLRefreshMetadata(SQL::Lexer &lexer);
        bool Execute(BackendTransaction &trans);
};

class SQLSetStatement
{
        public:
        SQLSetStatement(SQL::Lexer &lexer);
        bool Execute(BackendTransaction &trans, ConnectionControl *conncontrol);

        bool isglobal;
        std::string param;
        std::string value;
};


bool ParseAndExecuteCommand(BackendTransaction &trans,std::string const &cmd,TempResultSet *storage, bool allow_modifications, ConnectionControl *conncontrol);

} // end of namespace SQL
} // end of namespace Database

#endif /*sentry */

