//---------------------------------------------------------------------------
#include <harescript/vm/allincludes.h>

//---------------------------------------------------------------------------

#include "oci_dbprovider.h"
#include "oci_base.h"

#include <harescript/vm/errors.h>
#include <harescript/vm/hsvm_dllinterface.h>
#include <harescript/vm/hsvm_sqlinterface.h>
#include <harescript/vm/hsvm_sqllib.h>

//#include <harescript/vm/baselibs/baselibs.h>

//#include <windows.h>
//#include <sql.h>
//#include <sqlext.h>

namespace HareScript
{

namespace OCIDBProvider
{

// -----------------------------------------------------------------------------
//
//   Context
//
//

OCIContext::OCIContext()
: myenvhp(NULL)
, myerrhp(NULL)
{
        ub4 mode = OCI_THREADED | OCI_OBJECT | OCI_NO_MUTEX;
        CheckRetval(NULL, "OCIEnvCreate",
                    OCIEnvNlsCreate(&myenvhp, mode, (dvoid *)0, 0, 0, 0, (size_t) 0, (dvoid **)0, OCI_UTF16ID, OCI_UTF16ID));

        CheckRetval(NULL, "OCIHandleAlloc errorhandle",
                    OCIHandleAlloc(myenvhp,(void**)&myerrhp,OCI_HTYPE_ERROR,0,NULL));

}

OCIContext::~OCIContext()
{
        for(ServerHandles::iterator itr = serverhandles.begin();itr != serverhandles.end();++itr)
        {
                if(itr->second==NULL)
                    continue;
                if (OCIServerDetach(itr->second, myerrhp, OCI_DEFAULT) != OCI_SUCCESS)
                    DEBUGPRINT("OCIServerDetach failed");
                if (OCIHandleFree(itr->second, OCI_HTYPE_SERVER)  != OCI_SUCCESS)
                    DEBUGPRINT("OCIHandleFree failed");
        }

        OCIHandleFree(myerrhp, OCI_HTYPE_ERROR);
        serverhandles.clear();
        OCIHandleFree(myenvhp,OCI_HTYPE_ENV);
}

void GetHSErrors(HSVM *hsvm, HSVM_VariableId recarr, ErrorList const &errorlist)
{
        // List with errors
        HSVM_ColumnId error_codeid = HSVM_GetColumnId(hsvm, "CODE");
        HSVM_ColumnId error_messageid = HSVM_GetColumnId(hsvm, "MESSAGE");

        HSVM_SetDefault(hsvm, recarr, HSVM_VAR_RecordArray);

        for (std::vector<ErrorType>::const_iterator it = errorlist.begin();
                it != errorlist.end();
                ++it)
        {
                // Append record to record array
                VarId nextrecord = HSVM_ArrayAppend(hsvm, recarr);
                VarId code_cell = HSVM_RecordCreate(hsvm, nextrecord, error_codeid);
                VarId message_cell = HSVM_RecordCreate(hsvm, nextrecord, error_messageid);

                // Fill record with data
                HSVM_IntegerSet(hsvm, code_cell, it->first);
                HSVM_StringSet(hsvm, message_cell, it->second.data(), it->second.data()+it->second.size());
        }
}

OCIServer* OCIContext::GetServer(Blex::UTF16String const &dbasename, ErrorList *errorlist)
{
        OCIServer*& srvhandle = serverhandles[dbasename];
        if(srvhandle!=NULL)
            return srvhandle;

        //Create server handle (ADDME: Allow users to request 'persistent' handles which we will then put in OCIGlobal?)
        CheckRetval(NULL, "OCIHandleAlloc server", OCIHandleAlloc(GetEnvhp(), (dvoid**)&srvhandle, OCI_HTYPE_SERVER, 0, NULL));

        if (OCIServerAttach(srvhandle, GetErrhp(), reinterpret_cast<text const*>(&dbasename[0]), dbasename.size()*2, OCI_DEFAULT) != OCI_SUCCESS)
        {
                ParseErrors(GetErrhp(), errorlist);
                OCIHandleFree(srvhandle, OCI_HTYPE_SERVER);
                srvhandle=NULL;
        }
        return srvhandle;
}

Blex::UTF16String GetHSVMStringUTF16(HSVM *hsvm, HSVM_VariableId varid)
{
        Blex::UTF16String retval;
        GetVirtualMachine(hsvm)->GetStackMachine().GetUTF16String(varid, &retval);
        return retval;
}

/** INTEGER __HS_OCI_Connect(STRING database, STRING username, STRING passowrd)
    @param database Name of database
    @param username Username
    @param passwd Password*/
void HS_OCI_Connect (HSVM *hsvm, HSVM_VariableId id_set)
{
        OCIContext *context = static_cast<OCIContext*>(HSVM_GetContext(hsvm,OCIContextId,true));
        if (!context) //can happen, then OCI threw!
            return; //give up

        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_Record);
        HSVM_VariableId cell_database = HSVM_RecordGetRef(hsvm, HSVM_Arg(0), HSVM_GetColumnId(hsvm, "DATABASE"));
        HSVM_VariableId cell_username = HSVM_RecordGetRef(hsvm, HSVM_Arg(0), HSVM_GetColumnId(hsvm, "USERNAME"));
        HSVM_VariableId cell_password = HSVM_RecordGetRef(hsvm, HSVM_Arg(0), HSVM_GetColumnId(hsvm, "PASSWORD"));
        if (cell_database == 0 || cell_username == 0 || cell_password == 0)
            return; //give up now

        // Retrieve data (database name, username. password)
        Blex::UTF16String database = GetHSVMStringUTF16(hsvm,cell_database);
        Blex::UTF16String username = GetHSVMStringUTF16(hsvm,cell_username);
        Blex::UTF16String password = GetHSVMStringUTF16(hsvm,cell_password);

        HSVM_VariableId cell_errors = HSVM_RecordCreate(hsvm, id_set, HSVM_GetColumnId(hsvm, "ERRORS"));
        HSVM_VariableId cell_transid = HSVM_RecordCreate(hsvm, id_set, HSVM_GetColumnId(hsvm, "TRANSID"));

        HSVM_SetDefault(hsvm, cell_errors, HSVM_VAR_RecordArray);

        int32_t transid=-1;

        ErrorList errorlist;
        OCIServer *spath = context->GetServer(database, &errorlist);
        if(spath==NULL)
        {
                GetHSErrors(hsvm, cell_errors, errorlist);
        }
        else
        {
                std::unique_ptr<OCITransaction> trans;
                trans.reset(new OCITransaction(hsvm, *context));

                // Log on to the database
                if (!trans->Connect(spath,username,password))
                {
                        GetHSErrors(hsvm, cell_errors, trans->GetHSErrorList());
                }
                else
                {
                        context->translist.insert(trans.get());
                        transid = GetVirtualMachine(hsvm)->GetSQLSupport().RegisterTransaction(std::move(trans));
                }
        }
        HSVM_IntegerSet(hsvm, cell_transid, transid);
}

void HS_OCI_GetBindInfo(HSVM *hsvm, HSVM_VariableId id_set)
{
        OCIContext *context = static_cast<OCIContext*>(HSVM_GetContext(hsvm,OCIContextId,true));
        int32_t transid = HSVM_IntegerGet(hsvm, HSVM_Arg(0));
        OCITransaction* trans= context->GetTrans(hsvm, transid);
        if (!trans)
            ThrowDBError(-1, "Used a non-OCI transaction");

        trans->GetBindInfo(GetHSVMStringUTF16(hsvm, HSVM_Arg(1)),
                           hsvm,
                           id_set);

}

void HS_OCI_CallCommand(HSVM *hsvm, HSVM_VariableId id_set)
{
        OCIContext *context = static_cast<OCIContext*>(HSVM_GetContext(hsvm,OCIContextId,true));
        int32_t transid = HSVM_IntegerGet(hsvm, HSVM_Arg(0));
        OCITransaction* trans= context->GetTrans(hsvm, transid);
        if (!trans)
            ThrowDBError(-1, "Used a non-OCI transaction");

        trans->SQLCall(GetHSVMStringUTF16(hsvm, HSVM_Arg(1)),
                          hsvm,
                          HSVM_Arg(2),
                          id_set);
}

void HS_OCI_SendCommand(HSVM *hsvm, HSVM_VariableId id_set)
{
        OCIContext *context = static_cast<OCIContext*>(HSVM_GetContext(hsvm,OCIContextId,true));
        int32_t transid = HSVM_IntegerGet(hsvm, HSVM_Arg(0));
        OCITransaction* trans= context->GetTrans(hsvm, transid);
        if (!trans)
            ThrowDBError(-1, "Used a non-OCI transaction");

        trans->SQLCommand(GetHSVMStringUTF16(hsvm, HSVM_Arg(1)),
                          hsvm,
                          id_set,
                          NULL);
}

void HS_OCI_SendTypedCommand(HSVM *hsvm, HSVM_VariableId id_set)
{
        std::vector<HSVM_VariableType> typelist;

        int32_t transid = HSVM_IntegerGet(hsvm, HSVM_Arg(0));
        typelist.resize(HSVM_ArrayLength(hsvm, HSVM_Arg(2)));
        for (unsigned i=0;i<typelist.size();++i)
            typelist[i] = HSVM_IntegerGet(hsvm, HSVM_ArrayGetRef(hsvm, HSVM_Arg(2), i));

        OCIContext *context = static_cast<OCIContext*>(HSVM_GetContext(hsvm,OCIContextId,true));
        OCITransaction* trans= context->GetTrans(hsvm, transid);
        if (!trans)
            ThrowDBError(-1, "Used a non-OCI transaction");

        trans->SQLCommand(GetHSVMStringUTF16(hsvm, HSVM_Arg(1)),
                          hsvm,
                          id_set,
                          &typelist);
}

void HS_OCI_Commit(HSVM *hsvm, HSVM_VariableId id_set)
{
        OCIContext *context = static_cast<OCIContext*>(HSVM_GetContext(hsvm,OCIContextId,true));
        int32_t transid = HSVM_IntegerGet(hsvm, HSVM_Arg(0));
        OCITransaction* trans= context->GetTrans(hsvm, transid);
        if (!trans)
            ThrowDBError(-1, "Used a non-OCI transaction");

        trans->Commit(id_set);
        context->translist.erase(trans);
        VirtualMachine *vm= GetVirtualMachine(hsvm);
        vm->GetSQLSupport().DeleteTransaction(transid);
}


void HS_OCI_Rollback(HSVM *hsvm)
{
        OCIContext *context = static_cast<OCIContext*>(HSVM_GetContext(hsvm,OCIContextId,true));
        int32_t transid = HSVM_IntegerGet(hsvm, HSVM_Arg(0));
        OCITransaction* trans= context->GetTrans(hsvm, transid);
        if (!trans)
            ThrowDBError(-1, "Used a non-OCI transaction");

        //Rollback is automatic on unclean transaction delete, so just do that..
        trans->Rollback();
        context->translist.erase(trans);
        VirtualMachine *vm= GetVirtualMachine(hsvm);
        vm->GetSQLSupport().DeleteTransaction(transid);
}

/** RECORD ARRAY __HS_OCI_GetOCIErrors(INTEGER transid)
    @param transid ID of the transaction to use */
void HS_OCI_GetOCIErrors (HSVM *hsvm, HSVM_VariableId id_set)
{
        int32_t transid = HSVM_IntegerGet(hsvm, HSVM_Arg(0));
        OCIContext *context = static_cast<OCIContext*>(HSVM_GetContext(hsvm,OCIContextId,true));
        OCITransaction* trans= context->GetTrans(hsvm, transid);
        if (!trans)
            ThrowDBError(-1, "Used a non-OCI transaction");

        GetHSErrors(hsvm, id_set, trans->GetHSErrorList());
}

/** __HS_OCI_ClearOCIErrors(INTEGER transid)
    @param transid ID of the transaction to use */
void HS_OCI_ClearOCIErrors (HSVM *hsvm)
{
        int32_t transid = HSVM_IntegerGet(hsvm, HSVM_Arg(0));
        OCIContext *context = static_cast<OCIContext*>(HSVM_GetContext(hsvm,OCIContextId,true));
        OCITransaction* trans= context->GetTrans(hsvm, transid);
        if (!trans)
            ThrowDBError(-1, "Used a non-OCI transaction");

        trans->ClearHSErrors();
}

/** __HS_OCI_TRANSHACK(INTEGER transid, INTEGER stringpiecesize, INTEGER blobpiecesize)
    @param transid ID of the transaction to use
    @param stringpiecesize Length of one piece in the piecewise fetching of strings
    @param blobpiecesize Length of one piece in the piecewise fetching of blobs */
void HS_OCI_TRANSHACK (HSVM *hsvm)
{
        int32_t transid = HSVM_IntegerGet(hsvm, HSVM_Arg(0));
        OCIContext *context = static_cast<OCIContext*>(HSVM_GetContext(hsvm,OCIContextId,true));
        OCITransaction* trans= context->GetTrans(hsvm, transid);
        if (!trans)
            ThrowDBError(-1, "Used a non-OCI transaction");

        int32_t stringpiecesize = HSVM_IntegerGet(hsvm, HSVM_Arg(1));
        int32_t blobpiecesize = HSVM_IntegerGet(hsvm, HSVM_Arg(2));
        trans->SetTransferChunkSizes(stringpiecesize < 0 ? 0 : stringpiecesize, blobpiecesize < 0 ? 0 : blobpiecesize);
}

/** ColumnList(INTEGER transid, STRING tablename)
    @param transid ID of the transaction to use
    @param tablename Name of the table to get the list with columns from */
void HS_OCI_ColumnList(HSVM *hsvm, HSVM_VariableId id_set)
{
        int32_t transid = HSVM_IntegerGet(hsvm, HSVM_Arg(0));
        OCIContext *context = static_cast<OCIContext*>(HSVM_GetContext(hsvm,OCIContextId,true));
        OCITransaction* trans= context->GetTrans(hsvm, transid);
        if (!trans)
            ThrowDBError(-1, "Used a non-OCI transaction");

        trans->GetColumnList(GetHSVMStringUTF16(hsvm,HSVM_Arg(1)), id_set);
}

/** OCIDescribe(INTEGER transid, STRING type, STRING name)
    @param transid ID of the transaction to use
    @param type Type of object to describe
    @param name Name of object to describe */
void HS_OCI_Describe(HSVM *hsvm, HSVM_VariableId id_set)
{
        int32_t transid = HSVM_IntegerGet(hsvm, HSVM_Arg(0));
        OCIContext *context = static_cast<OCIContext*>(HSVM_GetContext(hsvm,OCIContextId,true));
        OCITransaction* trans = context->GetTrans(hsvm, transid);
        if (!trans)
            ThrowDBError(-1, "Used a non-OCI transaction");

        std::string type = HSVM_StringGetSTD(hsvm,HSVM_Arg(1));
        std::string object = HSVM_StringGetSTD(hsvm,HSVM_Arg(2));
        trans->Describe(type,object,id_set);
}


OCITransaction* OCIContext::GetTrans(HSVM *hsvm, int32_t transid)
{
        HareScript::SQLLib::DatabaseTransactionDriverInterface *itf = GetVirtualMachine(hsvm)->GetSQLSupport().GetTransaction(transid);
        if (translist.count(static_cast<OCITransaction*>(itf)))
            return static_cast<OCITransaction*>(itf);

        return 0;
}


} // End of namespace OCIDBProvider
} // End of namespace HareScript

//---------------------------------------------------------------------------
extern "C"
{

static void* CreateContext(void *)
{
        return new HareScript::OCIDBProvider::OCIContext;
}
static void DestroyContext(void*, void *context_ptr)
{
        delete static_cast<HareScript::OCIDBProvider::OCIContext*>(context_ptr);
}

BLEXLIB_PUBLIC int HSVM_ModuleEntryPoint(HSVM_RegData *regdata,void*)
{
        HSVM_RegisterFunction(regdata, "__OCI_STARTTRANSACTION:WH_OCI:R:R", HareScript::OCIDBProvider::HS_OCI_Connect);
        HSVM_RegisterFunction(regdata, "CALLOCICOMMAND:WH_OCI:R:ISR", HareScript::OCIDBProvider::HS_OCI_CallCommand);
        HSVM_RegisterFunction(regdata, "SENDOCICOMMAND:WH_OCI:RA:IS", HareScript::OCIDBProvider::HS_OCI_SendCommand);
        HSVM_RegisterFunction(regdata, "SENDOCITYPEDCOMMAND:WH_OCI:RA:ISIA", HareScript::OCIDBProvider::HS_OCI_SendTypedCommand);

        HSVM_RegisterFunction(regdata, "GETOCIERRORS:WH_OCI:RA:I", HareScript::OCIDBProvider::HS_OCI_GetOCIErrors);
        HSVM_RegisterMacro   (regdata, "CLEAROCIERRORS:WH_OCI::I", HareScript::OCIDBProvider::HS_OCI_ClearOCIErrors);

        HSVM_RegisterFunction(regdata, "GETOCICOLUMNS:WH_OCI:RA:IS", HareScript::OCIDBProvider::HS_OCI_ColumnList);

        HSVM_RegisterMacro   (regdata, "__OCI_TRANSHACK:WH_OCI::III", HareScript::OCIDBProvider::HS_OCI_TRANSHACK);

        HSVM_RegisterFunction(regdata, "COMMITOCITRANSACTION:WH_OCI:RA:I", HareScript::OCIDBProvider::HS_OCI_Commit);
        HSVM_RegisterMacro   (regdata, "ROLLBACKOCITRANSACTION:WH_OCI::I", HareScript::OCIDBProvider::HS_OCI_Rollback);
        HSVM_RegisterFunction(regdata, "GETOCIBINDINFO:WH_OCI:RA:IS", HareScript::OCIDBProvider::HS_OCI_GetBindInfo);

        HSVM_RegisterContext (regdata, HareScript::OCIDBProvider::OCIContextId, NULL, &CreateContext, &DestroyContext);

        return 1;
}

} //end extern "C"

/* Possible command lines

   R:\final\runscript.exe
   with
   --moduledir R:\final M:\beta\test\oci\test_bindings.whscr ah@10.8.3.4 scott tiger

   R:\final\webserver-cg.exe
   with
   --moduledir R:\final
*/






