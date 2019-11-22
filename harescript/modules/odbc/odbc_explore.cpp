#include <harescript/vm/allincludes.h>


#include <harescript/vm/hsvm_context.h>
#include "hsvm_odbcprovider.h"
#include "odbc_base.h"

namespace HareScript
{
namespace SQLLib
{
namespace ODBC
{

void GetDataSources(HareScript::VirtualMachine &vm, ODBCProviderContextData &context, HareScript::VarId id_set, int32_t source_type, Blex::Charsets::Charset charset)
{
        HareScript::StackMachine &varmem = vm.GetStackMachine();
        varmem.ArrayInitialize(id_set,0,VariableTypes::RecordArray);

        ColumnNameId colname = vm.columnnamemapper.GetMapping("NAME");
        ColumnNameId coldriver = vm.columnnamemapper.GetMapping("DRIVER");

        SQLWCHAR namebufW[SQL_MAX_DSN_LENGTH+1], driverbufW[1024];
        char namebufA[SQL_MAX_DSN_LENGTH+1], driverbufA[1024];
        SQLSMALLINT namelen, driverlen;
        SQLUSMALLINT direction = SQL_FETCH_FIRST;
        if (source_type==1) //user only
            direction = SQL_FETCH_FIRST_USER;
        else if (source_type==2) //system only
            direction = SQL_FETCH_FIRST_SYSTEM;

        while (true)
        {
                SQLRETURN retval;

                if (charset != Blex::Charsets::Unicode)
                {
                        retval = SQLDataSourcesA(context.henv,
                                           direction,
                                           reinterpret_cast< SQLCHAR * >(namebufA),
                                           sizeof namebufA - sizeof *namebufA,
                                           &namelen,
                                           reinterpret_cast< SQLCHAR * >(driverbufA),
                                           sizeof driverbufA - sizeof *driverbufA,
                                           &driverlen);
                }
                else
                {
                        retval = SQLDataSourcesW(context.henv,
                                           direction,
                                           namebufW,
                                           sizeof namebufW - sizeof *namebufW,
                                           &namelen,
                                           driverbufW,
                                           sizeof driverbufW - sizeof *driverbufW,
                                           &driverlen);
                }

                ODBCDEBUGPRINT("GetDataSources: context.henv " << context.henv << ",retval=" << retval);

                if (retval == SQL_NO_DATA)
                    return; //end of data
                if (IsError(retval))
                    ThrowDBError("Could not execute ODBC query: "+ GetDiagnostics(SQL_HANDLE_STMT, context.henv));

                HareScript::VarId new_source = varmem.ArrayElementAppend(id_set);
                varmem.RecordInitializeEmpty(new_source);
                if (charset != Blex::Charsets::Unicode)
                {
                        std::string name, driver;
                        Blex::ConvertCharsetToUTF8(namebufA, namebufA + namelen, charset, &name);
                        Blex::ConvertCharsetToUTF8(driverbufA, driverbufA + driverlen, charset, &driver);
                        ODBCDEBUGPRINT(name);
                        varmem.SetSTLString(varmem.RecordCellCreate(new_source,colname), name);
                        varmem.SetSTLString(varmem.RecordCellCreate(new_source,coldriver), driver);
                }
                else
                {
                        ODBCDEBUGPRINT(std::string((char*)namebufW, (char*)(namebufW+namelen)));
                        varmem.SetUTF16String(varmem.RecordCellCreate(new_source,colname),
                                              reinterpret_cast<uint16_t*>(namebufW),
                                              reinterpret_cast<uint16_t*>(namebufW)+namelen);
                        varmem.SetUTF16String(varmem.RecordCellCreate(new_source,coldriver),
                                              reinterpret_cast<uint16_t*>(driverbufW),
                                              reinterpret_cast<uint16_t*>(driverbufW)+driverlen);
                }

                direction = SQL_FETCH_NEXT;
        }
}

void ODBCTransactionDriver::GetTables(VarId id_set)
{
        SQLHSTMT stmt;
        SQLRETURN retval;
        retval = SQLAllocHandle(SQL_HANDLE_STMT, hdbc, &stmt);
        CheckRetval(hdbc, retval, "Could not alloc statement");
        try
        {
                SQLRETURN retval;

                StackMachine &stackm = vm->GetStackMachine();
                stackm.ArrayInitialize(id_set, 0, VariableTypes::RecordArray);

                retval = SQLTables(
                        stmt,
                        NULL, 0,
                        NULL, 0,
                        NULL, 0,
                        NULL, 0);

                ODBCDEBUGPRINT("SQLTablesW executed " << retval);

                CheckRetval(stmt, retval, "Could not retrieve table list");
                ResultSet(vm, capabilities, stmt, charset, workarounds).ReturnTotalSet(id_set);
        }
        catch (std::exception &)
        {
                SQLFreeHandle(SQL_HANDLE_STMT, stmt); //ADDME: Auto-Handles for SQL
                throw;
        }
        SQLFreeHandle(SQL_HANDLE_STMT, stmt); //ADDME: Auto-Handles for SQL
}

void ODBCTransactionDriver::GetColumns(VarId id_set, Blex::UTF16String const &schema, Blex::UTF16String const &table)
{
        SQLHSTMT stmt;
        SQLRETURN retval;
        retval = SQLAllocHandle(SQL_HANDLE_STMT, hdbc, &stmt);
        CheckRetval(hdbc, retval, "Could not alloc statement");

        try
        {
                SQLRETURN retval;

                StackMachine &stackm = vm->GetStackMachine();
                stackm.ArrayInitialize(id_set, 0, VariableTypes::RecordArray);

                if (charset != Blex::Charsets::Unicode)
                {
                        std::string table_utf8, schema_utf8;
                        Blex::UTF8Encode(table.begin(), table.end(), std::back_inserter(table_utf8));
                        Blex::UTF8Encode(schema.begin(), schema.end(), std::back_inserter(schema_utf8));
                        std::string table_ansi, schema_ansi;
                        Blex::ConvertUTF8ToCharset(table_utf8.c_str(), table_utf8.c_str() + table_utf8.size(), charset, &table_ansi);
                        Blex::ConvertUTF8ToCharset(schema_utf8.c_str(), schema_utf8.c_str() + schema_utf8.size(), charset, &schema_ansi);

                        retval = SQLColumnsA(
                                stmt,
                                NULL, 0,
                                const_cast<SQLCHAR*>(reinterpret_cast<const SQLCHAR*>(&schema_ansi[0])), (SQLSMALLINT)schema_ansi.size(),
                                const_cast<SQLCHAR*>(reinterpret_cast<const SQLCHAR*>(&table_ansi[0])), (SQLSMALLINT)table_ansi.size(),
                                NULL, 0);
                }
                else
                {
                        retval = SQLColumnsW(
                                stmt,
                                NULL, 0,
                                const_cast<SQLWCHAR*>(reinterpret_cast<const SQLWCHAR*>(&schema[0])), (SQLSMALLINT)schema.size(),
                                const_cast<SQLWCHAR*>(reinterpret_cast<const SQLWCHAR*>(&table[0])), (SQLSMALLINT)table.size(),
                                NULL, 0);
                }

                CheckRetval(stmt, retval, "Could not retrieve column list");
                ResultSet(vm, capabilities, stmt, charset, workarounds).ReturnTotalSet(id_set);
        }
        catch (std::exception &)
        {
                SQLFreeHandle(SQL_HANDLE_STMT, stmt); //ADDME: Auto-Handles for SQL
                throw;
        }
        SQLFreeHandle(SQL_HANDLE_STMT, stmt); //ADDME: Auto-Handles for SQL
}


} // End of namespace ODBC
} // End of namespace SQLLib
} // End of namespace HareScript
