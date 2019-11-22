#include <harescript/vm/allincludes.h>

#include "oci_base.h"
#include "oci_dbprovider.h"
#include "oci_binder.h"

namespace HareScript
{
namespace OCIDBProvider
{

unsigned GetObjectType(std::string const &type)
{
        if (Blex::StrCaseCompare(type,"TABLE")==0)
             return OCI_PTYPE_TABLE;
        if (Blex::StrCaseCompare(type,"VIEW")==0)
             return OCI_PTYPE_VIEW;
        if (Blex::StrCaseCompare(type,"PROC")==0)
             return OCI_PTYPE_PROC;
        if (Blex::StrCaseCompare(type,"FUNC")==0)
             return OCI_PTYPE_FUNC;
        if (Blex::StrCaseCompare(type,"PKG")==0)
             return OCI_PTYPE_PKG;
        if (Blex::StrCaseCompare(type,"TYPE")==0)
             return OCI_PTYPE_TYPE;
        if (Blex::StrCaseCompare(type,"SYN")==0)
             return OCI_PTYPE_SYN;
        if (Blex::StrCaseCompare(type,"SEQ")==0)
             return OCI_PTYPE_SEQ;
        if (Blex::StrCaseCompare(type,"SCHEMA")==0)
             return OCI_PTYPE_SCHEMA;
        if (Blex::StrCaseCompare(type,"DATABASE")==0)
             return OCI_PTYPE_DATABASE;
        return OCI_PTYPE_UNK;
}

void OCITransaction::Describe(std::string const &type, std::string const &object, VarId /*id_set*/)
{
        unsigned typecode = GetObjectType(type);

        // Allocate a describe handle
        OCIDescribe *dschp = AllocOCIHandle<OCIDescribe *>(GetErrhp(), "Describe.OCIHandleAlloc", GetEnvhp(),(ub4) OCI_HTYPE_DESCRIBE, (size_t) 0, (dvoid **) 0);

        // Call the describe function
        CheckRetval(GetErrhp(), "DescribeTableColumns.OCIDescribeAny",
                    OCIDescribeAny(mysvchp, GetErrhp(), (void *)object.c_str(),
                    (ub4)object.length(), OCI_OTYPE_NAME, 0, GetObjectType(type), dschp));

        if(typecode==OCI_PTYPE_PKG)
        {
                //Describe package contents
        }
        ThrowDBError(-1, "Describe not implemented");

}


void OCITransaction::DescribeTableColumns(Blex::UTF16String const &tablename, std::vector<OCIColumnType> &columns)
{
        // Allocate a describe handle
        OCIDescribe *dschp = AllocOCIHandle<OCIDescribe *>(GetErrhp(), "Describe.OCIHandleAlloc", GetEnvhp(),(ub4) OCI_HTYPE_DESCRIBE, (size_t) 0, (dvoid **) 0);

                                    /* Doesn't help :-(
        sb4 setdesc=-1;
        CheckRetval(GetErrhp(), "DescribeTableColumns.SetPublic",
                      OCIAttrSet(dschp, OCI_HTYPE_DESCRIBE,
                            (dvoid *) &setdesc, (ub4) 4, OCI_ATTR_DESC_PUBLIC, GetErrhp()));
                                                       */
        // Call the describe function
        if (OCIDescribeAny(mysvchp, GetErrhp(), (void *)&tablename[0], (ub4)tablename.size()*2, OCI_OTYPE_NAME, 0, OCI_PTYPE_TABLE, dschp) != OCI_SUCCESS)
        {
                CheckRetval(GetErrhp(), "DescribeTableColumns.OCIDescribeAny",
                    OCIDescribeAny(mysvchp, GetErrhp(), (void *)&tablename[0], (ub4)tablename.size()*2, OCI_OTYPE_NAME, 0, OCI_PTYPE_VIEW, dschp));
        }

        // Get the parameter descriptor
        OCIParam *parmp;
        CheckRetval(GetErrhp(), "DescribeTableColumns.OCIAttrGet",
                        OCIAttrGet((dvoid *)dschp, (ub4)OCI_HTYPE_DESCRIBE,
                         (dvoid *)&parmp, (ub4 *)0, (ub4)OCI_ATTR_PARAM,
                         (OCIError *)GetErrhp()));

        // Get the number of columns in this table
        ub2 numcols;
        CheckRetval(GetErrhp(), "DescribeTableColumns.OCIAttrGet",
                        OCIAttrGet((dvoid*) parmp, (ub4) OCI_DTYPE_PARAM,
                         (dvoid*) &numcols, (ub4 *) 0,
                         (ub4) OCI_ATTR_NUM_COLS, (OCIError *)GetErrhp()));

        // Get the column list of the table
        OCIParam *collst;
        CheckRetval(GetErrhp(), "DescribeTableColumns.OCIAttrGet",
                        OCIAttrGet((dvoid*) parmp, (ub4) OCI_DTYPE_PARAM,
                         (dvoid*) &collst, (ub4 *) 0,
                         (ub4) OCI_ATTR_LIST_COLUMNS, (OCIError *)GetErrhp()));


        // Now loop through the columns, and determine names and types
        for (ub4 pos = 1; pos <= numcols; ++pos)
        {
                OCIParam *parmdp;
                ub2 ocitype;
                ub4 name_sizep = 0;
                uint16_t *name_namep;
                ub1 precision;
                sb1 scale;
                ub2 collen;
                ub1 null_allowed;
                ub2 charset;


                // Get the parameter descriptor for each column
                CheckRetval(GetErrhp(), "DescribeTableColumns.OCIParamGet",
                        OCIParamGet((dvoid *)collst, (ub4)OCI_DTYPE_PARAM, GetErrhp(),
                       (dvoid **)&parmdp, (ub4) pos));

                // Get the column name
                CheckRetval(GetErrhp(), "DescribeTableColumns.OCIAttrGet",
                        OCIAttrGet((dvoid*) parmdp, (ub4) OCI_DTYPE_PARAM,
                            (dvoid*) &name_namep, (ub4 *) &name_sizep,
                            (ub4) OCI_ATTR_NAME, (OCIError *)GetErrhp()));

                // Get the datatype
                CheckRetval(GetErrhp(), "DescribeTableColumns.OCIAttrGet",
                        OCIAttrGet((dvoid*) parmdp, (ub4) OCI_DTYPE_PARAM,
                            (dvoid*) &ocitype, (ub4 *) 0,
                            (ub4) OCI_ATTR_DATA_TYPE, (OCIError *)GetErrhp()));

                // Get the precision
                CheckRetval(GetErrhp(), "DescribeTableColumns.OCIAttrGet",
                        OCIAttrGet ((dvoid*) parmdp, (ub4) OCI_DTYPE_PARAM,
                          (dvoid*) &precision, (ub4 *) 0,
                          (ub4) OCI_ATTR_PRECISION, (OCIError *)GetErrhp()));

                // Get the scale
                CheckRetval(GetErrhp(), "DescribeTableColumns.OCIAttrGet",
                        OCIAttrGet ((dvoid*) parmdp, (ub4) OCI_DTYPE_PARAM,
                        (dvoid*) &scale, (ub4 *) 0,
                        (ub4) OCI_ATTR_SCALE, (OCIError *)GetErrhp()));

                // Get the column length
                CheckRetval(GetErrhp(), "DescribeTableColumns.OCIAttrGet",
                        OCIAttrGet((dvoid*) parmdp, (ub4) OCI_DTYPE_PARAM,
                        (dvoid*) &collen, (ub4 *) 0,
                        (ub4) OCI_ATTR_DATA_SIZE, (OCIError *)GetErrhp()));

                // Check if null values are allowed
                CheckRetval(GetErrhp(), "DescribeTableColumns.OCIAttrGet",
                        OCIAttrGet((dvoid*) parmdp, (ub4) OCI_DTYPE_PARAM,
                        (dvoid*) &null_allowed, (ub4 *) 0,
                        (ub4) OCI_ATTR_IS_NULL, (OCIError *)GetErrhp()));

                // Get the character set
                CheckRetval(GetErrhp(), "DescribeTableColumns.OCIAttrGet",
                        OCIAttrGet((dvoid*) parmdp, (ub4) OCI_DTYPE_PARAM,
                        (dvoid*) &charset, (ub4 *) 0,
                        (ub4) OCI_ATTR_CHARSET_ID, (OCIError *)GetErrhp()));

                // Add to the list of columns
                std::string name;
                Blex::UTF8Encode(name_namep, name_namep+name_sizep/2, std::back_inserter(name));
                DEBUGPRINT("Column name [" << name << "]");
                columns.push_back(OCIColumnType(name,
                        ocitype, precision, scale, collen, null_allowed, charset));
        }

        // Free the handle
        OCIHandleFree((dvoid *) dschp, (ub4) OCI_HTYPE_DESCRIBE);
}

void OCITransaction::GetColumnList(Blex::UTF16String const &tablename, VarId id_set)
{
        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_RecordArray);

        std::vector<OCIColumnType> columns;
        DescribeTableColumns(tablename, columns);
        for (std::vector<OCIColumnType>::const_iterator it = columns.begin();
                it != columns.end(); ++it)
        {
                // Initialize record
                VarId nextrecord = HSVM_ArrayAppend(hsvm, id_set);
                VarId name_cell = HSVM_RecordCreate(hsvm, nextrecord, vm->columnnamemapper.GetMapping("NAME"));
                VarId datatype_cell = HSVM_RecordCreate(hsvm, nextrecord, vm->columnnamemapper.GetMapping("DATATYPE"));
                VarId datatype_name_cell = HSVM_RecordCreate(hsvm, nextrecord, vm->columnnamemapper.GetMapping("DATATYPE_NAME"));
                VarId columnsize_cell = HSVM_RecordCreate(hsvm, nextrecord, vm->columnnamemapper.GetMapping("COLUMNSIZE"));
                VarId precision_cell = HSVM_RecordCreate(hsvm, nextrecord, vm->columnnamemapper.GetMapping("PRECISION"));
                VarId scale_cell = HSVM_RecordCreate(hsvm, nextrecord, vm->columnnamemapper.GetMapping("SCALE"));
                VarId is_null_cell = HSVM_RecordCreate(hsvm, nextrecord, vm->columnnamemapper.GetMapping("HAS_NULL"));
                VarId charset_cell = HSVM_RecordCreate(hsvm, nextrecord, vm->columnnamemapper.GetMapping("CHARSET"));

                // Fill record with data
                HSVM_StringSetSTD(hsvm, name_cell, it->name);
                HSVM_IntegerSet(hsvm, datatype_cell, it->ocitype);
                HSVM_StringSetSTD(hsvm, datatype_name_cell, GetOCITypename(it->ocitype));
                HSVM_IntegerSet(hsvm, columnsize_cell, it->collen);
                HSVM_IntegerSet(hsvm, precision_cell, it->precision);
                HSVM_IntegerSet(hsvm, scale_cell, it->scale);
                HSVM_BooleanSet(hsvm, is_null_cell, it->null_allowed);
                HSVM_IntegerSet(hsvm, charset_cell, it->charset);
        }
}

void OCITransaction::GetBindInfo(Blex::UTF16String const &sqlcommand, HSVM *hsvm, VarId id_set)
{
        //Build the returned record
        HSVM_SetDefault(hsvm, id_set,HSVM_VAR_RecordArray);

        HSVM_ColumnId col_bindname      = HSVM_GetColumnId(hsvm, "BINDNAME");
        HSVM_ColumnId col_indicatorname = HSVM_GetColumnId(hsvm, "INDICATORNAME");
        HSVM_ColumnId col_duplicate     = HSVM_GetColumnId(hsvm, "DUPLICATE");

        //Prepare the statement
        DEBUGPRINT("GetBindInfo OCI query string: " << UTF16toUTF8(sqlcommand));
        OCIStmt *stmthp=AllocOCIHandle<OCIStmt*>(GetErrhp(), "SQLCommand.OCIHandleAlloc",GetEnvhp(),OCI_HTYPE_STMT,0,NULL);

        CheckRetval(GetErrhp(), "SQLCommand.OCIStmtPrepare",
                    OCIStmtPrepare(stmthp, GetErrhp(), (const text*)&sqlcommand[0], sqlcommand.size()*2, OCI_NTV_SYNTAX, OCI_DEFAULT));

        std::vector<uint8_t> returninfo(3*sizeof(text*) + 3*sizeof(ub1));

        //Get bind information (we cannot pass NULL pointers to OCIStmtGetBindInfo for some stupid reason...)
        sb4 found=0;
        CheckRetval(GetErrhp(), "GetBindInfo.OCIStmtGetBindInfo",
                    OCIStmtGetBindInfo(stmthp, GetErrhp(), 0, 1, &found,
                                       (text**)&returninfo[0],&returninfo[0],(text**)&returninfo[0],
                                       &returninfo[0],&returninfo[0],(OCIBind**)&returninfo[0]));

        //Resize our containers and arrange space for the returned arrays
        returninfo.resize( std::abs(found) * (3*sizeof(text*) + 3*sizeof(ub1)));
        text** bvnp =     (text**)   &returninfo[0];
        ub1* bvnl =                  &returninfo[std::abs(found) * (sizeof(text*))                 ];
        text** invp =     (text**)   &returninfo[std::abs(found) * (sizeof(text*)+sizeof(ub1))     ];
        ub1* inpl =                  &returninfo[std::abs(found) * (2*sizeof(text*)+sizeof(ub1))   ];
        ub1* dupl =                  &returninfo[std::abs(found) * (2*sizeof(text*)+2*sizeof(ub1)) ];
        OCIBind **hndl =  (OCIBind**)&returninfo[std::abs(found) * (2*sizeof(text*)+3*sizeof(ub1)) ];

        CheckRetval(GetErrhp(), "GetBindInfo.OCIStmtGetBindInfo",
                    OCIStmtGetBindInfo(stmthp, GetErrhp(), found, 1, &found,
                                       bvnp, bvnl, invp, inpl, dupl, hndl));

        for (signed i=0;i<std::abs(found);++i)
        {
                HSVM_VariableId currecord = HSVM_ArrayAppend(hsvm, id_set);
                HSVM_StringSet(hsvm, HSVM_RecordCreate(hsvm, currecord, col_bindname), (char*)bvnp[i], (char*)bvnp[i]+bvnl[i]);
                HSVM_StringSet(hsvm, HSVM_RecordCreate(hsvm, currecord, col_indicatorname), (char*)invp[i], (char*)invp[i]+inpl[i]);
                HSVM_BooleanSet(hsvm, HSVM_RecordCreate(hsvm, currecord, col_duplicate), dupl[i]);
        }

        OCIHandleFree(stmthp, OCI_HTYPE_STMT);
}

void OCITransaction::SQLCall(Blex::UTF16String const &statement, HSVM *hsvm, VarId id_send, VarId id_return)
{
        //Build the returned record
        HSVM_SetDefault(hsvm, id_return, HSVM_VAR_Record);

        try
        {
                DEBUGPRINT("SQLCall query string: " << UTF16toUTF8(statement));
                //Prepare the statement
                OCIStmt *stmthp=AllocOCIHandle<OCIStmt*>(GetErrhp(), "SQLCommand.OCIHandleAlloc",GetEnvhp(),OCI_HTYPE_STMT,0,NULL);

                CheckRetval(GetErrhp(), "SQLCommand.OCIStmtPrepare",
                            OCIStmtPrepare(stmthp, GetErrhp(), (const text*)&statement[0], statement.size()*2, OCI_NTV_SYNTAX, OCI_DEFAULT));

                //Enumerate the cells in the id_set record to set up the bindings
                unsigned numcells = HSVM_RecordLength(hsvm, id_send);
                std::vector<HSVM_ColumnId> colids;
                std::vector<HSVM_ColumnId> nullcolids;

                InputBinder inputs(hsvm, this);
                for (unsigned i=0;i<numcells;++i)
                {
                        bool is_null=false;

                        //Get the column itself
                        char colname[HSVM_MaxColumnName];
                        HSVM_ColumnId thiscol = HSVM_RecordColumnIdAtPos(hsvm, id_send, i);
                        HSVM_GetColumnName(hsvm, thiscol, colname);

                        unsigned colnamelen=strlen(colname);
                        if (colnamelen > 5 && strcmp(colname + colnamelen - 5, "_NULL")==0)
                            continue; //skip null columns

                        colids.push_back(thiscol);
                        nullcolids.push_back(0);

                        //Look for a NULL version of this column
                        if (colnamelen < HSVM_MaxColumnName-6)/* 6:_NULL\0 */
                        {
                                char nullcolname[HSVM_MaxColumnName];
                                strcpy(nullcolname,colname);
                                strcat(nullcolname,"_NULL");
                                HSVM_ColumnId nullid = HSVM_GetColumnId(hsvm, nullcolname);
                                HSVM_VariableId nullvarid = HSVM_RecordGetRef(hsvm, id_send, nullid);
                                if (nullvarid != 0) //it exists
                                {
                                        nullcolids.back() = nullid;
                                        is_null = HSVM_BooleanGet(hsvm, nullvarid);
                                }
                        }
                        HSVM_VariableId celldata = HSVM_RecordGetRef(hsvm, id_send, thiscol);
                        inputs.AddNamedBinding(colname,
                                               GetVirtualMachine(hsvm)->GetStackMachine().GetType(celldata),
                                               is_null ? 0 : celldata);
                }
                inputs.FinishBindings(stmthp);

                inputs.ExecuteAndCompletePieces(mysvchp);

                /* Retrieve returned values */
                for (unsigned i=0;i<colids.size();++i)
                {
                        HSVM_VariableId nullvarid=0;
                        if (nullcolids[i] != 0)
                            nullvarid = HSVM_RecordCreate(hsvm, id_return, nullcolids[i]);
                        inputs.RetrieveBoundVariable(i, HSVM_RecordCreate(hsvm, id_return, colids[i]), nullvarid);
                }

                OCIHandleFree(stmthp, OCI_HTYPE_STMT);
        }
        catch (VMOCIError const &e)
        {
                errorlist.push_back(ErrorType(e.GetCode(), e.GetMsg()));
        }

}

}
}
