#ifndef blex_webhare_dbase_information_schema
#define blex_webhare_dbase_information_schema

#include "dbase_meta.h"

namespace Database
{

namespace InformationSchema
{

Database::VirtualTableRecordItr * CreateTablesIterator(Database::BackendTransaction &trans, VirtualTableSource &source);
Database::VirtualTableRecordItr * CreateColumnsIterator(Database::BackendTransaction &trans, VirtualTableSource &source);
Database::VirtualTableRecordItr * CreateSchemataIterator(Database::BackendTransaction &trans, VirtualTableSource &source);
Database::VirtualTableRecordItr * CreateEnabledRolesIterator(Database::BackendTransaction &trans, VirtualTableSource &source);
Database::VirtualTableRecordItr * CreateApplicableRolesIterator(Database::BackendTransaction &trans, VirtualTableSource &source);
Database::VirtualTableRecordItr * CreateUsersIterator(Database::BackendTransaction &trans, VirtualTableSource &source);
Database::VirtualTableRecordItr * CreateSchemaPrivilegesIterator(Database::BackendTransaction &trans, VirtualTableSource &source);
Database::VirtualTableRecordItr * CreateTablePrivilegesIterator(Database::BackendTransaction &trans, VirtualTableSource &source);
Database::VirtualTableRecordItr * CreateColumnPrivilegesIterator(Database::BackendTransaction &trans, VirtualTableSource &source);
Database::VirtualTableRecordItr * CreateRoleSchemaGrantsIterator(Database::BackendTransaction &trans, VirtualTableSource &source);
Database::VirtualTableRecordItr * CreateRoleTableGrantsIterator(Database::BackendTransaction &trans, VirtualTableSource &source);
Database::VirtualTableRecordItr * CreateRoleColumnGrantsIterator(Database::BackendTransaction &trans, VirtualTableSource &source);
Database::VirtualTableRecordItr * CreateIndicesIterator(Database::BackendTransaction &trans, VirtualTableSource &source);
Database::VirtualTableRecordItr * CreateAllRolesIterator(Database::BackendTransaction &trans, VirtualTableSource &source);
Database::VirtualTableRecordItr * CreateAllSchemataIterator(Database::BackendTransaction &trans, VirtualTableSource &source);
Database::VirtualTableRecordItr * CreateExplicitSchemaGrantsIterator(Database::BackendTransaction &trans, VirtualTableSource &source);
Database::VirtualTableRecordItr * CreateExplicitTableGrantsIterator(Database::BackendTransaction &trans, VirtualTableSource &source);
Database::VirtualTableRecordItr * CreateExplicitColumnGrantsIterator(Database::BackendTransaction &trans, VirtualTableSource &source);
Database::VirtualTableRecordItr * CreateExplicitRoleGrantsIterator(Database::BackendTransaction &trans, VirtualTableSource &source);
Database::VirtualTableRecordItr * CreateAllRoleGrantsIterator(Database::BackendTransaction &trans, VirtualTableSource &source);

} //end namespace InformationSchema
} //end namespace Database

#endif
