#include <harescript/vm/allincludes.h>


#include "oci_base.h"

namespace HareScript
{
namespace OCIDBProvider
{

std::string UTF16toUTF8(Blex::UTF16String const &str)
{
        std::string retstr;
        Blex::UTF8Encode(str.begin(), str.end(), std::back_inserter(retstr));
        return retstr;
}

Blex::UTF16String UTF8toUTF16(std::string const &in)
{
        Blex::UTF16String retval;

        Blex::UTF8DecodeMachine decoder;
        for(unsigned i=0;i<in.size();++i)
        {
                //add the character itself, decoding if necessary
                uint32_t nextunicodebyte = decoder(in[i]);
                if (nextunicodebyte != Blex::UTF8DecodeMachine::NoChar && nextunicodebyte != Blex::UTF8DecodeMachine::InvalidChar)
                    retval.push_back((char)nextunicodebyte);
        }
        return retval;
}

void ThrowDBError(const int code, const std::string str)
{
        throw VMOCIError (code, str);
}
void ThrowDBError(ErrorType const &err)
{
        throw VMOCIError (err.first, err.second);
}

ErrorType ParseError(OCIError *errhp)
{
        //FIXME: Support errorws of unlimited length
        static const unsigned ErrorBufSize=512;
        uint16_t errbuf[ErrorBufSize];
        sb4 errcode = 0;
        memset(errbuf, 0, sizeof(errbuf));

        OCIErrorGet (errhp, (ub4) 1, (text *) NULL, &errcode, reinterpret_cast<text*>(errbuf), (ub4) ErrorBufSize, OCI_HTYPE_ERROR);
        unsigned errlen = std::find(errbuf, errbuf+ErrorBufSize, '\0') - &errbuf[0];

        std::string errmessage;
        Blex::UTF8Encode(errbuf, errbuf+errlen, std::back_inserter(errmessage));
        DEBUGPRINT("OCI: error " << errcode << ":" << errmessage);
        return std::make_pair(errcode, errmessage);
}

void ParseErrors(OCIError *errhp, ErrorList *errors)
{
        errors->push_back(ParseError(errhp));
}

void CheckRetval(OCIError *errhp, const char *DEBUGONLYARG(context), sword status)
{
        switch (status)
        {
        case OCI_SUCCESS:
//                DEBUGPRINT("OCI: success (" << context << ")");
                break;
        case OCI_SUCCESS_WITH_INFO:
                //DEBUGPRINT("OCI: success with info (" << context << ")");
                break;
        case OCI_NEED_DATA:
//                DEBUGPRINT("OCI: need data (" << context << ")");
                break;
        case OCI_NO_DATA:
//                DEBUGPRINT("OCI: no data (" << context << ")");
                break;
        case OCI_ERROR:
                ThrowDBError(ParseError(errhp));
                break;
        case OCI_INVALID_HANDLE:
                DEBUGPRINT("OCI: invalid handle (" << context << ")");
                ThrowDBError(-1, "OCI invalid handle");
                break;
        case OCI_STILL_EXECUTING:
                DEBUGPRINT("OCI: still execute (" << context << ")");
                break;
        default:
                DEBUGPRINT("OCI: unexpected status code(" << context << ")");
                ThrowDBError(-1,"OCI unexpected error");
        }
        /*if (retval != SQL_SUCCESS)
        {
                std::string stl_error = error;
                stl_error = stl_error + " (" + ErrorCodeString(retval) + ")";
                if (retval == SQL_SUCCESS_WITH_INFO)
                    DEBUGPRINT("SuccessWithInfo: "<< stl_error << ": " << GetDiagnostics(SQL_HANDLE_STMT, stmt));
                else
                    ThrowStatementError(stmt, stl_error.c_str());
        }*/
}

VMOCIError::VMOCIError(const int code, const std::string &msg)
  : VMRuntimeError(Error::DatabaseException, msg.c_str())
{
  errcode = code;
  errmsg = msg;
}

VMOCIError::~VMOCIError() throw()
{
}

std::string GetOCITypename(ub2 ocitype)
{
        switch (ocitype)
        {
                case 1:
                        return "VARCHAR2";
                case 2:
                        return "NUMBER";
                case 8:
                        return "LONG";
                case 11:
                        return "ROWID";
                case 12:
                        return "DATE";
                case 23:
                        return "RAW";
                case 24:
                        return "LONG RAW";
                case 96:
                        return "CHAR";
                case 108:
                        return "User-Defined";
                case 111:
                        return "REF";
                case 112:
                        return "CLOB";
                case 113:
                        return "BLOB";
                case 114:
                        return "BFILE";
                case 208:
                        return "UROWID";
                default:
                        return "Unknown";
        }
}

Blex::DateTime ReadOCIDate(uint8_t const *datetime)
{
        /*
        Table 3–4 Format of the DATE Datatype
        Byte 1 2 3 4 5 6 7
        Meaning Century Year Month Day Hour Minute Second
        Example (for 30-NOV-1992, 3:17 PM)
                119 192 11 30 16 18 1 */

        struct std::tm return_tm;
        return_tm.tm_year = (datetime[0]-119)*100 + datetime[1]-100;
        return_tm.tm_mon = datetime[2]-1;
        return_tm.tm_mday = datetime[3];
        return_tm.tm_hour = datetime[4]-1;
        return_tm.tm_min = datetime[5]-1;
        return_tm.tm_sec = datetime[6]-1;

        return Blex::DateTime::FromTM(return_tm);
}

/** Get the OCI I/O type to use for a given HareScript type */
std::pair<unsigned,ub2> GetOCITransfer(ub2 ocitype, VariableTypes::Type hstype)
{
        switch(hstype)
        {
        case VariableTypes::Boolean:
        case VariableTypes::Integer:
                return std::make_pair(sizeof (int32_t),SQLT_INT);

        case VariableTypes::Money:
                return std::make_pair(22,SQLT_VNU);

        case VariableTypes::Float:
                return std::make_pair(sizeof (int64_t),SQLT_FLT);

        case VariableTypes::String:
                if (ocitype == SQLT_CLOB) /* CLOB Type */
                        return std::make_pair(0,SQLT_CLOB);

                if (ocitype == SQLT_BLOB) /* BLOB Type */
                        return std::make_pair(0,SQLT_BLOB);
                if (ocitype == SQLT_LNG)
                        return std::make_pair(0,SQLT_CHR);

                if (ocitype == SQLT_BIN || ocitype == SQLT_LBI)
//                    ThrowDBError(-1,"String columns cannot be bound to LONG or BINARY types");
                    return std::make_pair(0,SQLT_LBI);

                /* Normal string type */
                return std::make_pair(0,SQLT_CHR);

        case VariableTypes::DateTime:
                return std::make_pair(7,SQLT_DAT);

        case VariableTypes::Blob:
                if (ocitype == SQLT_LNG || ocitype == SQLT_BIN || ocitype == SQLT_LBI)
                    return std::make_pair(0,SQLT_LBI);
                //if (ocitype == 0 /unknown/ || ocitype == 113) //BLOB type*/
                    return std::make_pair(0,SQLT_BLOB);

                //fallthrough
        default:
                ThrowDBError(-1,"Unsupported database type");
        }
        // Stop borland from whining
        return std::make_pair(sizeof (int32_t),SQLT_INT);
}

} // End of namespace OCIDBProvider
} // End of namespace HareScript
