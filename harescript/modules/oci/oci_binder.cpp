#include <harescript/vm/allincludes.h>

#include <harescript/vm/hsvm_dllinterface_blex.h>
#include "oci_binder.h"

namespace HareScript
{
namespace OCIDBProvider
{

InputBinder::InputBinder(HSVM *hsvm, OCITransaction *trans)
: trans(trans)
, hsvm(hsvm)
, stmtp(NULL)
{
        envhp = trans->GetEnvhp();
        errhp = trans->GetErrhp();
        svchp = trans->GetSvchp();
        transfer = trans->GetTransfer();
}

InputBinder::~InputBinder()
{
        // Free all temporary LOBLocators
        for (std::vector<Column>::const_iterator it = cols.begin(); it != cols.end(); ++it)
        {
                if (it->loblocator != NULL && !it->is_resultset_column)
                        OCILobFreeTemporary(svchp, errhp, it->loblocator);
                if(it->piecewise_fetch && it->varstore)
                    HSVM_DeallocateVariable(hsvm, it->varstore);
        }
}

//ADDME: Should prolly be: RetrieveBufferVariable
bool InputBinder::RetrieveBoundVariable(unsigned colnum, VarId cell, VarId indicator_id)
{
        Column const &colinfo = cols[colnum];
        uint8_t const *dataptr = &inputbuf[colinfo.data_offset];
        StackMachine &stackm=HareScript::GetVirtualMachine(hsvm)->GetStackMachine();

        if (indicator_id)
            HSVM_BooleanSet(hsvm, indicator_id, colinfo.indicator == -1);

        if (colinfo.indicator == -1) //NULL
        {
                //Initialize variable to default
                stackm.InitVariable(cell, colinfo.hstype);
                return false;
        }

        if (colinfo.piecewise_fetch) //This was fetched piecewise
        {
                if (colinfo.column_touched)
                    stackm.CopyFrom(cell, colinfo.varstore);
                else
                    HSVM_SetDefault(hsvm, cell, colinfo.hstype);
                return true;
        }

        //Truncation should never happen!
        if (colinfo.indicator == -2 || colinfo.indicator > 0)
            ThrowDBError(-1, "OCI: Unexpected data truncation");

        //Do the conversion!
        switch(colinfo.hstype)
        {
        case VariableTypes::Boolean:
                stackm.SetBoolean(cell, *(int32_t*)dataptr != 0);
                return true;

        case VariableTypes::Integer:
                stackm.SetInteger(cell, *(int32_t*)dataptr);
                return true;

        case VariableTypes::Money:
                // Shift value to the left, to position the comma
                CheckRetval(errhp, "GetSingleColumn.OCINumberShift",
                        OCINumberShift(errhp, (OCINumber *)dataptr, 5, (OCINumber *)dataptr));

                // Extract the value
                int64_t money_value;
                CheckRetval(errhp, "GetSingleColumn.OCINumberToInt",
                        OCINumberToInt(errhp, (OCINumber *)dataptr, sizeof(int64_t), OCI_NUMBER_SIGNED, &money_value));

                stackm.SetMoney(cell, money_value);
                return true;

        case VariableTypes::Float:
                stackm.SetFloat(cell, *(F64*)(dataptr));
                return true;

        case VariableTypes::DateTime:
                stackm.SetDateTime(cell,ReadOCIDate(dataptr));
                return true;

        case VariableTypes::String: /* This is a LOB locator */
        {
                stackm.InitVariable(cell, VariableTypes::String);

                unsigned totallength = 0;
                ub4 last_read;
                ub4 loblen;
                sword status;
                std::pair<char *, char *> buf;
                CheckRetval(errhp, "RetreiveBoundVariable.OCILobGetLength",
                                OCILobGetLength(svchp, errhp, cols[colnum].loblocator, &loblen));
                last_read = loblen;

                while ((status = OCILobRead(svchp, errhp, cols[colnum].loblocator, &last_read, 1, (dvoid *) &inputbuf[start_piecewise_buffer],
                                      transfer->BlobPieceSize, (dvoid *)0,
                                      /*(sb4 (*)(dvoid *, const dvoid *, ub4 *, ub1 *)) */ NULL,
                                      0, 0)) == OCI_NEED_DATA)
                {
                        buf = stackm.ResizeString(cell, totallength + last_read);
                        memcpy(buf.first+totallength, &inputbuf[start_piecewise_buffer], last_read);
                        totallength += last_read;
                        loblen -= last_read;
                        last_read = 0;
                }

                if (last_read)
                {
                        buf = stackm.ResizeString(cell, totallength + last_read);
                        memcpy(buf.first+totallength, &inputbuf[start_piecewise_buffer], last_read);
                }

                CheckRetval(errhp, "RetreiveBoundVariable.OCILobRead", status);
                return true;
        }
        case VariableTypes::Blob:
        {
                int32_t outstream = HSVM_CreateStream(hsvm);
                ub4 last_read;
                ub4 loblen;
                sword status;
                CheckRetval(errhp, "RetreiveBoundVariable.OCILobGetLength",
                                OCILobGetLength(svchp, errhp, cols[colnum].loblocator, &loblen));
                last_read = loblen;

                while ((status = OCILobRead(svchp, errhp, cols[colnum].loblocator, &last_read, 1, (dvoid *) &inputbuf[start_piecewise_buffer],
                                      transfer->BlobPieceSize, (dvoid *)0,
                                      /*(sb4 (*)(dvoid *, dvoid *, ub4 *, ub1 *))*/ NULL,
                                      0, 0)) == OCI_NEED_DATA)
                {
                        HSVM_PrintTo(hsvm, outstream, last_read, &inputbuf[start_piecewise_buffer]);
                        loblen -= last_read;
                        last_read = 0;
                }

                if (last_read)
                    HSVM_PrintTo(hsvm, outstream, last_read, &inputbuf[start_piecewise_buffer]);

                CheckRetval(errhp, "RetreiveBoundVariable.OCILobRead", status);

                HSVM_MakeBlobFromStream(hsvm, cell, outstream);
                return true;
        }
        default:
            ThrowDBError(-1, "Unsupported database type");
        }
        return true;
}

void InputBinder::StoreBoundVariable(unsigned colnum, VarId value)
{
        Column &colinfo = cols[colnum];
        uint8_t *dataptr = &inputbuf[colinfo.data_offset];

        colinfo.rlen = (ub2)colinfo.data_size;
        colinfo.rcode = 0;

        if (value == 0) //NULL
        {
                memset(dataptr, 0, colinfo.data_size);
                return;
        }

        switch(colinfo.hstype)
        {
        case VariableTypes::Integer:
                *(sb4 *)dataptr = HSVM_IntegerGet(hsvm, value);
                break;
        case VariableTypes::Float:
                *(F64 *)dataptr = HSVM_FloatGet(hsvm, value);
                break;
        case VariableTypes::Boolean:
                dataptr[0] = (uint8_t)(HSVM_BooleanGet(hsvm, value) ? 1 : 0);
                break;
        case VariableTypes::DateTime:
        {
                if (HSVM_DateTimeGetTimeT(hsvm, value) == 2147483647)
                    colinfo.indicator = -1; // Set not inialized datetime to NULL

                // Fill in the date
                tm c_time;
                HSVM_DateTimeGetTm(hsvm, value, &c_time);
                dataptr[0] = (ub1)(119 + c_time.tm_year/100); // Century (base 100)
                dataptr[1]  = (ub1)(100 + c_time.tm_year%100); // Year
                dataptr[2]  = (ub1)(c_time.tm_mon+1); // Month
                dataptr[3]  = (ub1)(c_time.tm_mday); // Day of month
                dataptr[4]  = (ub1)(c_time.tm_hour+1); // Hour
                dataptr[5]  = (ub1)(c_time.tm_min+1); // Minute
                dataptr[6]  = (ub1)(c_time.tm_sec+1); // Second
                break;
        }
        case VariableTypes::Money:
        {
                // Get the money variable
                int64_t numvalue = GetVirtualMachine(hsvm)->GetStackMachine().GetMoney(value);

                OCINumber *oci_numvalue = (OCINumber *)dataptr;
                CheckRetval(errhp, "FillBuffer.OCINumberFromInt",
                        OCINumberFromInt(errhp, &numvalue, sizeof(int64_t), OCI_NUMBER_SIGNED, oci_numvalue));

                // Shift value to the right, to position the comma
                CheckRetval(errhp, "FillBuffer.OCINumberFromInt",
                        OCINumberShift(errhp, oci_numvalue, -5, oci_numvalue));

                break;
        }
        case VariableTypes::String: /* This is a LOB locator */
        {
                Blex::StringPair strptr;
                HSVM_StringGet(hsvm, value, &strptr.begin, &strptr.end);

                unsigned totallen = (strptr.end-strptr.begin);
                ub4 to_send = totallen;
                unsigned totalsend = 0;
                ub4 now_send;
                ub1 piece = (ub1)(totallen > transfer->BlobPieceSize ? OCI_FIRST_PIECE : OCI_ONE_PIECE);

                while (to_send)
                {
                        now_send = to_send>transfer->BlobPieceSize ? transfer->BlobPieceSize : to_send;
                        to_send -= now_send;

                        if (piece != OCI_ONE_PIECE && !to_send)
                                piece = OCI_LAST_PIECE;

                        CheckRetval(errhp, "StoreBoundVariable.OCILobWrite",
                                   OCILobWrite(svchp, errhp, cols[colnum].loblocator, &totallen, 1, (dvoid *) &strptr.begin[totalsend],
                                              (ub4) now_send, piece, (dvoid *)0,
                                              (sb4 (*)(dvoid *, dvoid *, ub4 *, ub1 *)) 0,
                                              (ub2) 0, (ub1) SQLCS_IMPLICIT));

                        if (piece == OCI_FIRST_PIECE)
                                piece = OCI_NEXT_PIECE;
                        totalsend += now_send;
                }
                break;
        }
        case VariableTypes::Blob:
        {
                HareScript::Interface::InputStream instr(hsvm, value);
                ub4 totallen = (ub4)instr.GetFileLength();
                ub4 to_send = totallen;
                ub4 now_send;
                ub1 piece = (ub1)(totallen > transfer->BlobPieceSize ? OCI_FIRST_PIECE : OCI_ONE_PIECE);

                while (to_send)
                {
                        now_send = to_send>transfer->BlobPieceSize ? transfer->BlobPieceSize : to_send;
                        to_send -= now_send;
                        instr.Read(&inputbuf[start_piecewise_buffer], now_send);

                        if (piece != OCI_ONE_PIECE && !to_send)
                                piece = OCI_LAST_PIECE;

                        CheckRetval(errhp, "StoreBoundVariable.OCILobWrite",
                                   OCILobWrite(svchp, errhp, cols[colnum].loblocator, &totallen, 1, (dvoid *) &inputbuf[start_piecewise_buffer],
                                              (ub4) now_send, piece, (dvoid *)0,
                                              (sb4 (*)(dvoid *, dvoid *, ub4 *, ub1 *)) 0,
                                              (ub2) 0, (ub1) SQLCS_IMPLICIT));

                        if (piece == OCI_FIRST_PIECE)
                                piece = OCI_NEXT_PIECE;
                }
                break;
        }
        default:
                ThrowDBError(-1, "OCI unsupported variable type " + HareScript::GetTypeName(colinfo.hstype));
        }
}

bool InputBinder::FillBuffer(VariableTypes::Type hstype, VarId value, ub2 ocitype)
{
        AllocateColumn(hstype, ocitype, 0 /*ADDME: Use?*/, false/*not resultset*/);
        cols.back().inputvar = value;

        if (!value)
            cols.back().indicator = -1; //Set to NULL

        return true;
}

void InputBinder::AddNamedBinding(const char *name, VariableTypes::Type hstype, VarId value)
{
        FillBuffer(hstype, value, 0 /*unknown*/);
        cols.back().bindhp = NULL;
        cols.back().boundname=name;
}

void InputBinder::AddRowid(OCIRowid *rowid)
{
        Column newcol;

        newcol.bindhp = NULL;
        newcol.indicator = 0;
        newcol.rlen = 0;
        newcol.rcode = 0;

        cols.push_back(newcol);

        CheckRetval(errhp, "AddRowID.OCIBindByPos",
                    OCIBindByPos(stmtp, &cols.back().bindhp, errhp, cols.size(),
                                 &rowid, sizeof(OCIRowid *), SQLT_RDD,
                                 0, 0, 0, 0, 0, OCI_DEFAULT));
}

void InputBinder::PrepareBindings(std::vector<Param> const &paramlist)
{
        for (std::vector<Param>::const_iterator it = paramlist.begin();
                it != paramlist.end(); ++it)
        {
                FillBuffer(it->hstype, it->varid, it->ocitype);
                cols.back().bindhp = NULL;
        }
}

void InputBinder::FinishBindings(OCIStmt *_stmtp)
{
        stmtp=_stmtp;

        ub4 rowfetch = 64; /* ADDME: Dynamically set prefetch, perhaps fetch multiple into our buffers with OCIFetch ?*/
        CheckRetval (errhp,"FinishBindings.OCIAttrSet",
                     OCIAttrSet(stmtp,OCI_HTYPE_STMT, &rowfetch, 0, OCI_ATTR_PREFETCH_ROWS, errhp));

        /* Allocate space for all columns, and mark all piecewise-fetched columns as untouched */
        bool any_piecewise_columns=false;
        unsigned totalsize=0;
        for (unsigned i=0;i<cols.size();++i)
        {
                if (cols[i].piecewise_fetch)
                {
                        any_piecewise_columns=true;
                        cols[i].column_touched=false;
                }
                if (cols[i].useloblocator)
                        any_piecewise_columns=true;

                cols[i].data_offset = totalsize;
                totalsize += cols[i].data_size;
                //Ensure 8-byte alignment
                totalsize = ((totalsize+7)/8)*8;
        }

        if (any_piecewise_columns)
        {
                start_piecewise_buffer = totalsize;
                totalsize += transfer->StringPieceSize > transfer->BlobPieceSize ? transfer->StringPieceSize : transfer->BlobPieceSize;
        }

        /* Allocate the physical buffer */
        inputbuf.resize(totalsize);

        /* Bind or define parameters */
        unsigned current_bind_pos = 1;
        unsigned current_define_pos = 1;
        for (unsigned i=0;i<cols.size();++i)
        {
                Column &col=cols[i];

                // Get the value and datatype
                void *inputptr;
                sb4 value_sz;
                ub4 mode;
                sb2 *indicator = &col.indicator;
                ub2 *rcode = &col.rcode;
                if (col.useloblocator)
                {
                        /* Init LOBLocator */
                        CheckRetval(errhp, "FinishBindings.OCIDescriptorAlloc",
                                               OCIDescriptorAlloc(envhp, (dvoid **) &col.loblocator,
                                               (ub4) OCI_DTYPE_LOB, (size_t) 0, (dvoid **) 0));

                        /* When we have to write BLOB data, create a temporary LOBLocator */
                        if (!col.is_resultset_column)
                        {
                                CheckRetval(errhp, "FinishBindings.OCILobCreateTemporary",
                                                       OCILobCreateTemporary(svchp, errhp, col.loblocator,
                                                       OCI_DEFAULT, OCI_DEFAULT, OCI_TEMP_BLOB, FALSE, OCI_DURATION_SESSION));

                        }

                        inputptr = &col.loblocator;
                        value_sz = -1;
                        mode = OCI_DEFAULT;
                }
                else
                {
                        inputptr = col.piecewise_fetch ? NULL : &inputbuf[col.data_offset];
                        // We are not allowed to specify a value higher than 4000 here in case
                        // of piecewise fetches when using non LONG columns
                        value_sz = col.piecewise_fetch ? (col.is_long ? 0x7FFFFFFF : 4000) : col.data_size;
                        mode = col.piecewise_fetch ? OCI_DATA_AT_EXEC : OCI_DEFAULT;
                }

                if (col.is_resultset_column)
                {
                          CheckRetval(errhp, "FinishBindings.OCIDefineByPos",
                                      OCIDefineByPos(stmtp,&col.defnp,errhp,/*position=*/current_define_pos,
                                                     inputptr, value_sz, col.ocitype,
                                                     indicator, &col.rlen, rcode, mode));
                }
                else if (cols[i].boundname.empty())
                {
                        CheckRetval(errhp, "FinishBindings.OCIBindByPos",
                                    OCIBindByPos(stmtp, &col.bindhp, errhp, current_bind_pos,
                                                 inputptr, value_sz, col.ocitype,
                                                 indicator, &col.rlen, rcode, 0, 0, mode));
                }
                else
                {
                        // Do the binding
                        Blex::UTF16String colname = UTF8toUTF16(col.boundname);
                        CheckRetval(errhp, "FinishBindings.OCIBindByName",
                                    OCIBindByName(stmtp, &col.bindhp, errhp, (const text*)&colname[0], colname.size()*2,
                                                 inputptr, value_sz, col.ocitype,
                                                 indicator, &col.rlen, rcode, 0, 0, mode));
                }

                //Switch to UCS-2/UTF-16 format
                //FIXME: This causes problems when converting from non character database
                // columns to character types
/*                if (col.utf16_encoded)
                {
                        ub2 newformat = OCI_UTF16ID;
                        CheckRetval (errhp,"FinishBindings.OCIAttrSet",
                                     OCIAttrSet(col.is_resultset_column ? (void*)col.defnp : (void*)col.bindhp,
                                                col.is_resultset_column ? OCI_HTYPE_DEFINE : OCI_HTYPE_BIND,
                                                &newformat,
                                                0,
                                                OCI_ATTR_CHARSET_ID,
                                                errhp));

                        // FIXME: The following code (used in NCHAR columns), generates an error
/ *                        ub1 charset_form = SQLCS_NCHAR;
                        CheckRetval (errhp,"FinishBindings.OCIAttrSet",
                                     OCIAttrSet(col.is_resultset_column ? (void*)col.defnp : (void*)col.bindhp,
                                                col.is_resultset_column ? OCI_HTYPE_DEFINE : OCI_HTYPE_BIND,
                                                &charset_form,
                                                0,
                                                OCI_ATTR_CHARSET_FORM,
                                                errhp));* /
                }
*/
                //Allocate storage for piecewise fetching?
                if (col.piecewise_fetch)
                {
                        col.varstore = HSVM_AllocateVariable(hsvm);
                        if (col.is_resultset_column)
                        {
                                CheckRetval(errhp,"FinishBindings.OCIDefineDynamic",
                                            OCIDefineDynamic(col.defnp, errhp, this, &OCIDefineCallback));
                        }
                        else
                        {
                                CheckRetval(errhp,"FinishBindings.OCIBindDynamic",
                                            OCIBindDynamic(col.bindhp, errhp, this, &OCIBindInCallback, this, &OCIBindOutCallback));
                        }
                }

                if (col.is_resultset_column)
                {
                        ++current_define_pos;
                }
                else
                {
                        if (!col.piecewise_fetch)
                        {
                                StoreBoundVariable(i, col.inputvar); //Store the current value (IN columns only)
                        }
                        else if (col.hstype == VariableTypes::Blob && !col.useloblocator)
                        {
                                col.istream.reset(new HareScript::Interface::InputStream (hsvm, col.inputvar));
                        }
                        ++current_bind_pos;
                }

        }
}

sword InputBinder::ExecuteAndCompletePieces(OCISvcCtx *mysvchp)
{
        piecewise.col = NULL;
        sword status;

        if (mysvchp)
        {
                //Is this a select?
                ub2 fntype;
                CheckRetval(errhp, "SQLCommand.OCIAttrGet",
                            OCIAttrGet(stmtp,OCI_HTYPE_STMT,&fntype,NULL,OCI_ATTR_STMT_TYPE,errhp));

                bool is_select = fntype == OCI_STMT_SELECT;

                status = OCIStmtExecute(mysvchp,stmtp,errhp,is_select?0:1,0,NULL,NULL,OCI_DEFAULT);
        }
        else
            status = OCIStmtFetch(stmtp, errhp, 1, OCI_FETCH_NEXT, OCI_DEFAULT);

        DEBUGONLYARG(bool last_was_in=false;)

        while (status == OCI_NEED_DATA)
        {
                //We need to start reading pieces!
                ub4 type;
                ub4 iter;
                ub4 idx;
                ub1 piece;
                CheckRetval(errhp, "FetchResult.OCIStmtGetPieceInfo",
                            OCIStmtGetPieceInfo(stmtp, errhp, &piecewise.hndlp,
                                                &type, &piecewise.in_out, &iter, &idx,
                                                &piece));

                //Find the column for which we are receiving data
                unsigned colid=0;
                for (;colid<cols.size();++colid)
                  if (piecewise.hndlp == cols[colid].bindhp || piecewise.hndlp == cols[colid].defnp)
                    break;

                if (colid>=cols.size())
                    ThrowDBError(-1,"OCI error: Cannot locate column for which piece data is being offered");

                //Moved on to the next column?
                if (piecewise.col != &cols[colid])
                {
                        if (piecewise.col)
                            FinishPiece();
                        piecewise.col = &cols[colid];
                }

                DEBUGPRINT("GetPiece: [" << piecewise.col->boundname << "] type " << type << " in? " << last_was_in << " row# " << iter << " idx " << idx << " piece " << (int)piece);

                SetupForPiece(piece);

                /* get the next piece */
                if (mysvchp)
                    status = OCIStmtExecute(mysvchp,stmtp,errhp,1/*get 1 */,0,NULL,NULL,OCI_DEFAULT);
                else
                    status = OCIStmtFetch(stmtp, errhp, /*nrows=*/1, OCI_FETCH_NEXT, OCI_DEFAULT);

                DEBUGPRINT("Fetch: status " << status << " p.len " << piecewise.len << " p.indic " << piecewise.col->indicator << " p.rcode " << piecewise.col->rcode);
        }
        CheckRetval(errhp,"InputBinder.ExecuteAndCompletePieces",status);

        if (piecewise.col)
            FinishPiece();

        return status;
}

bool ResultSet::FetchResult(unsigned nrows)
{
        for (unsigned i = 0; i < nrows; ++i)
        {
                sword status = mybinder.ExecuteAndCompletePieces(NULL);
                if (status == OCI_NO_DATA) //NO_DATA means EOF
                    return false;

                // Get the current rowid
                CheckRetval(mybinder.errhp,"FetchResult.OCIAttrGet",
                        OCIAttrGet (stmtp,
                                    OCI_HTYPE_STMT,
                                    rowid[i],
                                    0,
                                    OCI_ATTR_ROWID,
                                    mybinder.errhp));
        }
        return true; //got (more) results
}

void InputBinder::AllocateColumn(VariableTypes::Type hstype, ub2 ocitype,HSVM_ColumnId colname, bool is_resultset_column)
{
        Column newcol;

        newcol.hstype = hstype;

        /* For OCI columns that contain utf16 encoded data
        newcol.utf16_encoded =
                ocitype == SQLT_CHR || ocitype == SQLT_STR ||
                ocitype == SQLT_VCS || ocitype == SQLT_LVC ||
                ocitype == SQLT_LVB || ocitype == SQLT_CLOB ||
                ocitype == SQLT_LNG || ocitype == SQLT_LBI ||
                ocitype == SQLT_BIN || ocitype == SQLT_VBI ||
                ocitype == 0 && hstype == VariableTypes::String;
*/
        /* Detect LONG columns */
        newcol.is_long =
                ocitype == SQLT_LNG || ocitype == SQLT_LBI ||
                ocitype == SQLT_LVC || ocitype == SQLT_LVB ||
                ocitype == 0 /* In an SQLCall we don't detect ocitype and can have more than one LONG bind */;

        /* Determine data size and retrieve type */
        std::pair<unsigned,ub2> ocitransfer = GetOCITransfer(ocitype, newcol.hstype);
        newcol.data_size = ocitransfer.first;
        newcol.ocitype = ocitransfer.second;

        /* STRINGs are piecewise fetched */
        newcol.piecewise_fetch =
                newcol.ocitype == SQLT_CHR || newcol.ocitype == SQLT_STR ||
                newcol.ocitype == SQLT_VCS || newcol.ocitype == SQLT_VBI ||
                newcol.ocitype == SQLT_BIN || newcol.ocitype == SQLT_LBI ||
                newcol.ocitype == SQLT_LVC || newcol.ocitype == SQLT_LVB;

        /* BLOBS, CLOBS and NCLOBS are fetched with a LOBLocator */
        newcol.useloblocator =
                newcol.ocitype == SQLT_BLOB || newcol.ocitype == SQLT_CLOB;

        newcol.nameid = colname;
        newcol.is_resultset_column=is_resultset_column;
        newcol.rcode = 0;
        newcol.indicator = 0;
        newcol.loblocator = NULL;

        cols.push_back(newcol);
}

ResultSet::ResultSet(HSVM *vm, OCITransaction *trans)
: mybinder(vm, trans)
{
}

ResultSet::~ResultSet()
{
}

void ResultSet::SetupStatement(OCIStmt *_stmtp)
{
        stmtp = _stmtp;
}

ColumnNameId ResultSet::GenerateColumnNameId(OCIParam *pard)
{
        uint16_t *col_name;
        ub4 col_name_len;

        /* Retrieve the column name attribute */
        CheckRetval(mybinder.errhp, "SQLCommand.OCIAttrGet.OCI_ATTR_NAME",
                    OCIAttrGet((dvoid*) pard, OCI_DTYPE_PARAM,
                               (dvoid**) &col_name,
                               (ub4 *) &col_name_len,
                               (ub4) OCI_ATTR_NAME,
                               mybinder.errhp));

        std::string colname;
        Blex::UTF8Encode(col_name, col_name+col_name_len/2, std::back_inserter(colname));

        //ADDME: Truncate at maxcolsize. unique-ify name
        return HSVM_GetColumnId(mybinder.hsvm, colname.c_str());
}

void ResultSet::AddResultSetColumn(unsigned pos, VariableTypes::Type hstype, ColumnNameId colnameid)
{
        ub2 dtype;
        OCIParam *mypard;
        CheckRetval(mybinder.errhp, "AddColumn.OCIParamGet",
                    OCIParamGet(stmtp, OCI_HTYPE_STMT, mybinder.errhp, (void**)&mypard, pos));
        CheckRetval(mybinder.errhp, "AddColumn.OCIAttrGet.OCI_ATTR_DATA_TYPE",
                    OCIAttrGet((dvoid*) mypard, OCI_DTYPE_PARAM,
                               (dvoid*) &dtype,
                               (ub4 *) 0,
                               (ub4) OCI_ATTR_DATA_TYPE,mybinder.errhp));

        /* When data type is uninialized, use the OCI data type */
        if (hstype == VariableTypes::Uninitialized)
            hstype = GetBestHSType(dtype, mypard) ;
        if (colnameid == 0)
            colnameid = GenerateColumnNameId(mypard);

        mybinder.AllocateColumn(hstype, dtype, colnameid, true/*resultset*/);
}

unsigned ResultSet::CountResultColumns() const
{
        ub4 parmcnt;
        CheckRetval(mybinder.errhp, "SQLCommand.OCIAttrGet.OCI_ATTR_PARAM_COUNT",
                    OCIAttrGet((dvoid*)stmtp, OCI_HTYPE_STMT,
                               (dvoid*)&parmcnt, NULL,
                               OCI_ATTR_PARAM_COUNT, mybinder.errhp));
        return parmcnt;
}

void ResultSet::DescribeColumns()
{
        unsigned paramcnt = CountResultColumns();
        for (unsigned param = 1;param <= paramcnt; ++param)
            AddResultSetColumn(param, VariableTypes::Uninitialized, 0);

        mybinder.FinishBindings(stmtp);
}

int InputBinder::OCIBindInCallback(void*ictxp, OCIBind *bindp, ub4 DEBUGONLYARG(iter), ub4 DEBUGONLYARG(index), void **bufpp, ub4 *alenp, ub1 *piecep, void **indpp)
{
        InputBinder *binder = static_cast<InputBinder*>(ictxp);

        unsigned colid=0;
        for (;colid<binder->cols.size();++colid)
          if (bindp == binder->cols[colid].bindhp)
            break;

        if (colid==binder->cols.size())
            return OCI_ERROR; //ARGH!

        DEBUGPRINT("OCIBindInCallback " << binder->cols[colid].boundname << " iter " << iter << " index " << index);

        if (binder->piecewise.col && binder->piecewise.col!= &binder->cols[colid])
            binder->FinishPiece(); //finish the previous piece

        binder->piecewise.col=&binder->cols[colid];
        binder->piecewise.last_was_in=true;

        if (*piecep==OCI_FIRST_PIECE)
            binder->piecewise.curpos=0; //Reset our read position (ADDME: Should flush UTF8 Decoder)

        *indpp = &binder->piecewise.col->indicator;

        if (binder->piecewise.col->inputvar==0) // NULL value
        {
                //Oracle must die, I alone am best! Since version 10 or so,
                //oracle will ignore our NULL indicator and still query us about
                //NULL strings
                binder->piecewise.col->indicator=-1;
                binder->piecewise.col->rcode=0;
                *piecep = OCI_LAST_PIECE;
        }
        else if (binder->piecewise.col->hstype == VariableTypes::String && binder->piecewise.col->ocitype != SQLT_LBI && binder->piecewise.col->ocitype != SQLT_BIN && binder->piecewise.col->ocitype != SQLT_LVB)
        {
                /* Move our characters into the UTF8 Decoder  (ADDME: Optimize if we can get a copying iterator, not a foreaching iterator) */
                Blex::StringPair strptr;
                HSVM_StringGet(binder->hsvm, binder->piecewise.col->inputvar, &strptr.begin, &strptr.end);

                // Copy each character (ADDME: Proper UTF16 recoding)
                unsigned numread = 0;
                while (numread < binder->transfer->StringPieceSize/2 && binder->piecewise.curpos < (unsigned)(strptr.end-strptr.begin))
                {
                        uint32_t ch = binder->piecewise.utf8decoder(strptr.begin[binder->piecewise.curpos++]);
                        if (ch != Blex::UTF8DecodeMachine::NoChar && ch != Blex::UTF8DecodeMachine::InvalidChar)
                        {
                                Blex::putu16lsb( &binder->inputbuf[binder->start_piecewise_buffer + numread*2], (uint16_t)ch);
                                ++numread;
                        }
                }

                if (numread < binder->transfer->StringPieceSize/2) //end of data?
                    *piecep = OCI_LAST_PIECE;

                *bufpp = &binder->inputbuf[binder->start_piecewise_buffer];
                *alenp = numread*2;

                binder->piecewise.col->indicator=0;
                binder->piecewise.col->rcode=0;
        }
        else if (binder->piecewise.col->hstype == VariableTypes::String)
        {
                *bufpp = &binder->inputbuf[binder->start_piecewise_buffer];

                //ADDME: Really need a common "independent blob/string reader" facility
                Blex::StringPair strptr;
                HSVM_StringGet(binder->hsvm, binder->piecewise.col->inputvar, &strptr.begin, &strptr.end);

                //Just copy the raw UTF-8 data into the LONG RAW column
                unsigned tocopy = std::min<unsigned>(strptr.size() - binder->piecewise.curpos, binder->transfer->StringPieceSize);
                *alenp = tocopy;
                memcpy(*bufpp, strptr.begin + binder->piecewise.curpos, tocopy);

                binder->piecewise.curpos += tocopy;
                if(tocopy < binder->transfer->StringPieceSize)
                    *piecep = OCI_LAST_PIECE;

                binder->piecewise.col->indicator=0;
                binder->piecewise.col->rcode=0;
        }
        else if (binder->piecewise.col->hstype == VariableTypes::Blob)
        {
                //This code is invoked when transferring HS Blob columns to OCI non-blob types
                *bufpp = &binder->inputbuf[binder->start_piecewise_buffer];

                uint32_t bytesread = (uint32_t)binder->piecewise.col->istream->Read(*bufpp,  binder->transfer->BlobPieceSize);
                *alenp = bytesread;
                if( bytesread < binder->transfer->BlobPieceSize)
                    *piecep = OCI_LAST_PIECE;

                binder->piecewise.col->indicator=0;
                binder->piecewise.col->rcode=0;
        }
        else
        {
                ThrowDBError(-1,"OCI error: Cannot handle pieces for non-String types");
        }

        DEBUGPRINT("Finished: iter " << iter << " index " << index << " len " << *alenp << " piece " << (int)*piecep);
        return OCI_CONTINUE;
}

void InputBinder::OCIOutCallback(Column *col, ub4 /*iter*/,void **bufpp, ub4 **alenpp, ub1 *piecep, void **indpp, ub2 **rcodep)
{
        if (piecewise.col && col != piecewise.col)
            FinishPiece(); //finish the previous piece

        piecewise.col=col;
        piecewise.col->indicator=0;
        piecewise.col->rcode=0;
        piecewise.col->rlen=0;
        piecewise.last_was_in=false;

        *bufpp=&inputbuf[start_piecewise_buffer];
        *alenpp=&piecewise.len;
        *indpp=&piecewise.col->indicator;
        *rcodep=&piecewise.col->rcode;

        if (*piecep == OCI_FIRST_PIECE || *piecep == OCI_ONE_PIECE)
        {
                piecewise.col->column_touched=true;
                *piecep = OCI_FIRST_PIECE;
        }
        else
        {
                DEBUGPRINT("Incoming: len " << (int)**alenpp << " piecep " << (int)*piecep << " indpp " << (*(int*)*indpp) << " rcodep " << (int)**rcodep);
        }

        if (piecewise.col->hstype == VariableTypes::String)
        {
                if (*piecep == OCI_FIRST_PIECE || *piecep == OCI_ONE_PIECE)
                {
                        piecewise_string.clear();
                }
                else
                {
                        unsigned len = std::min<unsigned>(transfer->StringPieceSize,piecewise.len);
/*                        if (col->utf16_encoded)*/
                        {
                                //Decode the part we already had
                                /* Add it to the string! (ADDME: is this portable? is OCI endian-dependent?) */
                                Blex::UTF8Encode((const uint16_t*)&inputbuf[start_piecewise_buffer],
                                                 (const uint16_t*)&inputbuf[start_piecewise_buffer + len],
                                                 std::back_inserter(piecewise_string));
                        }
/*                        else
                                piecewise_string.append((char *)&inputbuf[start_piecewise_buffer], len);*/
                }

                piecewise.len = transfer->StringPieceSize; //prepare to receive 'StringPieceSize' bytes again

                //DEBUGPRINT("Piece " << piece << ", string was: " << std::string(newdata.first,newdata.second-StringPieceSize));
                //DEBUGPRINT("Piece " << piece << ", enlarge with " << StringPieceSize << " bytes, length now " << newlen << " bytes");
        }
        else if (piecewise.col->hstype == VariableTypes::Blob)
        {
                if(!piecewise.blobstream)
                    piecewise.blobstream = HSVM_CreateStream(hsvm);

                if (*piecep != OCI_FIRST_PIECE && *piecep != OCI_ONE_PIECE) //write previous piece to blobstore
                    HSVM_PrintTo(hsvm, piecewise.blobstream, piecewise.len, &inputbuf[piecewise.col->data_offset]);

                //Write previous piece, if any
                piecewise.len = transfer->BlobPieceSize;
        }
        else
        {
                ThrowDBError(-1,"OCI error: Cannot handle pieces for non-Blob and non-String types");
        }
}

int InputBinder::OCIDefineCallback(void*octxp, OCIDefine *defnp, ub4 iter, void **bufpp, ub4 **alenpp, ub1 *piecep, void **indpp, ub2 **rcodep)
{
        InputBinder *binder = static_cast<InputBinder*>(octxp);

        unsigned colid=0;
        for (;colid<binder->cols.size();++colid)
          if (defnp == binder->cols[colid].defnp)
            break;

        if (colid==binder->cols.size())
            return OCI_ERROR; //ARGH!

        DEBUGPRINT("OCIDefineCallback " << binder->cols[colid].boundname << " iter " << iter);
        binder->OCIOutCallback(&binder->cols[colid], iter, bufpp, alenpp, piecep, indpp, rcodep);
        return OCI_CONTINUE;
}
int InputBinder::OCIBindOutCallback(void*octxp, OCIBind *bindp, ub4 iter, ub4 DEBUGONLYARG(index), void **bufpp, ub4 **alenpp, ub1 *piecep, void **indpp, ub2 **rcodep)
{
        InputBinder *binder = static_cast<InputBinder*>(octxp);

        unsigned colid=0;
        for (;colid<binder->cols.size();++colid)
          if (bindp == binder->cols[colid].bindhp)
            break;

        if (colid==binder->cols.size())
            return OCI_ERROR; //ARGH!

        DEBUGPRINT("OCIBindOutcallback " << binder->cols[colid].boundname << " iter " << iter << " index " << index);
        binder->OCIOutCallback(&binder->cols[colid], iter, bufpp, alenpp, piecep, indpp, rcodep);
        return OCI_CONTINUE;
}

/* Binding and piecewise fetching:
     for blobs: we set up a memoryrwstream, read all data into the rowbuffer
                first (in which we already allocated space) and then stream it
                into the memoryrwstream. when we finish the pieces for a blob,
                we convert it to a BlobRefPtr using the localblobhandler
     for strings: we read it directly into a harescript string, piece by piece
                  and shrink it to its final size after reading the last piece
     others: directly read into the rowbuffer, and then read from the rowbuffer and stored */

void InputBinder::SetupForPiece(unsigned piece)
{
        if (piecewise.in_out == OCI_PARAM_IN) //We must PROVIDE data
        {
                if (piece==OCI_FIRST_PIECE)
                    piecewise.curpos=0; //Reset our read position (ADDME: Should flush UTF8 Decoder)

                if (piecewise.col->hstype == VariableTypes::String)
                {
                        /* Move our characters into the UTF8 Decoder  (ADDME: Optimize if we can get a copying iterator, not a foreaching iterator) */
                        Blex::StringPair strptr;
                        HSVM_StringGet(hsvm, piecewise.col->inputvar, &strptr.begin, &strptr.end);

                        // Copy each character (ADDME: Proper UTF16 recoding)
                        unsigned numread = 0;
                        while (numread < transfer->StringPieceSize/2 && piecewise.curpos < (unsigned)(strptr.end-strptr.begin))
                        {
                                uint32_t ch = piecewise.utf8decoder(strptr.begin[piecewise.curpos++]);
                                if (ch != Blex::UTF8DecodeMachine::NoChar && ch != Blex::UTF8DecodeMachine::InvalidChar)
                                {
                                        Blex::putu16lsb( &inputbuf[start_piecewise_buffer + numread*2], (uint16_t)ch);
                                        ++numread;
                                }
                        }

                        if (numread < transfer->StringPieceSize/2) //end of data?
                            piece = OCI_LAST_PIECE;

                        piecewise.len=numread*2;
                        piecewise.col->indicator=0;
                        piecewise.col->rcode=0;
                }
                else
                {
                        ThrowDBError(-1,"OCI error: Cannot handle pieces for non-String types");
                }
        }
        else //We must RECEIVE data
        {
                piecewise.col->indicator=0;
                piecewise.col->rcode=0;
                piecewise.col->rlen=0;

                if (piece == OCI_FIRST_PIECE || piece == OCI_ONE_PIECE)
                {
                        piecewise.col->column_touched=true;
                        piece = OCI_FIRST_PIECE;
                }

                if (piecewise.col->hstype == VariableTypes::String)
                {
                        if (piece == OCI_FIRST_PIECE || piece == OCI_ONE_PIECE)
                        {
                                piecewise_string.clear();
                        }
                        else
                        {
                                //Decode the part we already had
                                /* Add it to the string! (ADDME: is this portable? is OCI endian-dependent?) */
                                unsigned len = std::min<unsigned>(transfer->StringPieceSize,piecewise.len);
                                Blex::UTF8Encode((const uint16_t*)&inputbuf[start_piecewise_buffer],
                                                 (const uint16_t*)&inputbuf[start_piecewise_buffer + len],
                                                 std::back_inserter(piecewise_string));
                        }

                        piecewise.len = transfer->StringPieceSize; //prepare to receive 'StringPieceSize' bytes again

                        //DEBUGPRINT("Piece " << piece << ", string was: " << std::string(newdata.first,newdata.second-StringPieceSize));
                        //DEBUGPRINT("Piece " << piece << ", enlarge with " << StringPieceSize << " bytes, length now " << newlen << " bytes");
                }
                else if (piecewise.col->hstype == VariableTypes::Blob)
                {
                        piecewise.blobstream = HSVM_CreateStream(hsvm);
                        if (piece != OCI_FIRST_PIECE && piece != OCI_ONE_PIECE) //write previous piece to blobstore
                            HSVM_PrintTo(hsvm, piecewise.blobstream, piecewise.len, &inputbuf[piecewise.col->data_offset]);

                        //Write previous piece, if any
                        piecewise.len=transfer->BlobPieceSize;
                }
                else
                {
                        ThrowDBError(-1,"OCI error: Cannot handle pieces for non-Blob and non-String types");
                }
        }
        CheckRetval(errhp, "FetchResult.OCIStmtSetPieceInfo",
                    OCIStmtSetPieceInfo(piecewise.hndlp,
                                        piecewise.col->is_resultset_column ? OCI_HTYPE_DEFINE : OCI_HTYPE_BIND,
                                        errhp,
                                        &inputbuf[start_piecewise_buffer],
                                        &piecewise.len,
                                        (ub1)piece,
                                        &piecewise.col->indicator,
                                        &piecewise.col->rcode));
}

void InputBinder::FinishPiece() //this function processes data from OCI to us (SELECT)
{
        if(piecewise.last_was_in)
             return; //nothing to do..

        if (piecewise.col->hstype==VariableTypes::String && piecewise.col->ocitype != SQLT_LBI)
        {
                //DEBUGPRINT("Finish, string was: [" << stackm.GetSTLString(piecewise.col->varstore) << "]");
                DEBUGPRINT("Finish, piecewise.len = " << piecewise.len);

                /* Add it to the string! (ADDME: is this portable? is OCI endian-dependent?) */
                unsigned len = std::min<unsigned>(transfer->StringPieceSize,piecewise.len);
/*                if (piecewise.col->utf16_encoded)*/
                {
                        piecewise_string.reserve(piecewise_string.size() + len);
                        if( (len%2) != 0)
                        {
                                DEBUGPRINT("Odd sized length! Data corrupted?!");
                                --len; //otherwise UTF8Encode will never finish
                        }
                        Blex::UTF8Encode((const uint16_t*)&inputbuf[start_piecewise_buffer],
                                         (const uint16_t*)&inputbuf[start_piecewise_buffer + len],
                                         std::back_inserter(piecewise_string));
                }
/*                else
                {
                        piecewise_string.append((char *)&inputbuf[start_piecewise_buffer], len);
                }*/

                HSVM_StringSetSTD(hsvm, piecewise.col->varstore, piecewise_string);
                return;
        }
        if (piecewise.col->hstype==VariableTypes::String)
        {
                //Put it directly into the string
                HSVM_StringSet(hsvm, piecewise.col->varstore, (char*)&inputbuf[piecewise.col->data_offset], (char*)&inputbuf[piecewise.col->data_offset + piecewise.len]);
        }
        if (piecewise.col->hstype==VariableTypes::Blob && piecewise.col->is_resultset_column)
        {
                //write previous piece to blobstore
                if(!piecewise.blobstream)
                    piecewise.blobstream = HSVM_CreateStream(hsvm);

                HSVM_PrintTo(hsvm, piecewise.blobstream, piecewise.len, &inputbuf[piecewise.col->data_offset]);
                HSVM_MakeBlobFromStream(hsvm, piecewise.col->varstore, piecewise.blobstream);
                piecewise.blobstream=0;
                return;
        }
}

void ResultSet::GetResult(VarId recordid)
{
        for (unsigned i=0;i<mybinder.cols.size();++i)
            GetSingleColumn(recordid,i);
}

bool ResultSet::GetSingleColumn(VarId recordid, unsigned colnum)
{
        VarId cell = HSVM_RecordCreate(mybinder.hsvm, recordid, mybinder.cols[colnum].nameid);
        return mybinder.RetrieveBoundVariable(colnum, cell, 0);
}

/** Given an OCI type, return a suitable HareScript type */
VariableTypes::Type ResultSet::GetBestHSType(ub2 ocitype, OCIParam *pard)
{

        /* Determine how to retrieve this column (we only need to handle Internal datatypes */
        switch (ocitype)
        {
        case 1: //VARCHAR2, NVARCHAR2
        case 8: //LONG
        case 96: //CHAR
                return VariableTypes::String;

        case 2: //NUMBER: fixed-size number
                /* Here we should distinguish between floating point and integers
                   by checking the scale and precision */

                // FIXME: These types should be 1 byte long, but that doesn't work
                // it generates a crash
                ub2 dprecision;
                sb1 dscale;

                CheckRetval(mybinder.errhp, "SQLCommand.OCIAttrGet.OCI_ATTR_PRECISION",
                    OCIAttrGet(pard, OCI_DTYPE_PARAM,
                               &dprecision,
                               0,
                               OCI_ATTR_PRECISION,mybinder.errhp));
                CheckRetval(mybinder.errhp, "SQLCommand.OCIAttrGet.OCI_ATTR_SCALE",
                    OCIAttrGet(pard, OCI_DTYPE_PARAM,
                               &dscale,
                               0,
                               OCI_ATTR_SCALE,mybinder.errhp));

                  if (dscale==-127 || dscale>5 || dprecision>64)
                        return VariableTypes::Float;

                  if (dscale!=0)
                        return VariableTypes::Money;

                  return VariableTypes::Integer;

        case 23: //RAW: Convert to a blob
        case 24: //LONG RAW: Convert to a blob
        case 113: //Binary LOB: Convert to a blob
                return VariableTypes::Blob;

        case 12: //DATE: Convert to a datetime
                return VariableTypes::DateTime;

        case 11: //ADDME: ROWID: No clue?
        case 111: //ADDME: OCI REF: No clue?
        case 112: //ADDME: Character LOB: Convert to a blob
        case 114: //ADDME: Binary file: Convert to a blob
        case 208://ADDME: UROWD
                ThrowDBError(-1,"Cannot convert type in result set");
                break;

        default:
                ThrowDBError(-1,"Don't understand type in result set");
                break;
        }
        return VariableTypes::Uninitialized;
}

} // End of namespace OCIDBProvider
} // End of namespace HareScript

