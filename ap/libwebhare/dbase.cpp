#include <ap/libwebhare/allincludes.h>

#include <blex/path.h>
#include "whrpc.h"
#include "dbase.h"

#include <iomanip>
#include <sstream>

namespace Database
{

bool reported_record_error = false;

namespace RequestOpcode
{
std::string GetName(uint8_t type)
{
        switch (type)
        {
        case Answer:                            return "Answer";
        case AnswerException:                   return "AnswerException";
        case TransactionStart:                  return "TransactionStart";
        case TransactionExplicitOpen:           return "TransactionExplicitOpen";
        case TransactionCommitRollbackClose:    return "TransactionCommitRollbackClose";
        case NotifyOpen:                        return "NotifyOpen";
        case NotifyScan:                        return "NotifyScan";
        case NotifyClose:                       return "NotifyClose";
        case TransactionSetRoles:               return "TransactionSetRoles";
        case ResultSetAdvance:                  return "ResultSetAdvance";
        case ResultSetLock:                     return "ResultSetLock";
        case ResultSetUnlock:                   return "ResultSetUnlock";
        case ResultSetUpdate:                   return "ResultSetUpdate";
        case ResultSetDelete:                   return "ResultSetDelete";
        case ResultSetFase2:                    return "ResultSetFase2";
        case ResultSetGetInfo:                  return "ResultSetGetInfo";
        case ResultSetClose:                    return "ResultSetClose";
        case RecordInsert:                      return "RecordInsert";
        case ScanStart:                         return "ScanStart";
        case ScanNotificationsStart:            return "ScanNotificationsStart";
        case MetadataGet:                       return "MetadataGet";
        case AutonumberGet:                     return "AutonumberGet";
        case BlobUpload:                        return "BlobUpload";
        case BlobRead:                          return "BlobRead";
        case BlobMarkPersistent:                return "BlobMarkPersistent";
        case BlobDismiss:                       return "BlobDismiss";
        case SQLCommand:                        return "SQLCommand";
        case SubscribeAsListener:               return "SubscribeAsListener";
        case Ask:                               return "Ask";
        case Tell:                              return "Tell";
        case ResetConnection:                   return "ResetConnection";
        case BeginConnection:                   return "BeginConnection";
        case KeepAlive:                         return "KeepAlive";
        default:
                {
                        std::string retval = "Invalid opcode (" + Blex::AnyToString((int)type) + ")";
                        return retval;
                }
        }
}
} // End of namespace RequestOpcode

namespace ResponseOpcode
{
std::string GetName(Database::ResponseOpcode::Type type)
{
        switch (type)
        {
        case Reset:             return "Reset";
        case Answer:            return "Answer";
        case AnswerException:   return "AnswerException";
        case Ask:               return "Ask";
        case Notify:            return "Notify";
        case Message:           return "Message";
        case Ping:              return "Ping";
        default:
//            throw Exception(ErrorInternal, "Attempting to send invalid response");
            return "Invalid (" + Blex::AnyToString((int)type) + ")";
        }
}
} // End of namespace ResponseOpcode

Exception::Exception (ErrorCodes errorcode, const std::string& what_arg, const std::string& what_table, const std::string& what_column, const std::string& what_client)
: std::runtime_error(what_arg)
, errorcode(errorcode)
, tablename(what_table)
, columnname(what_column)
, clientname(what_client)
{
}

Exception::~Exception() throw()
{
}

unsigned Record::GetCellPosition(ColumnId columnid) const
{
        if (!recorddata)
            return 0;

        unsigned pos=2;
        while (pos+4 <= len)
        {
                unsigned nextpos = pos + Blex::getu16lsb(recorddata+pos+2)+4;
                if(nextpos <= pos || nextpos > len) //No forward progress, or cell extends beyond record
                {
                        DEBUGPRINT("This record is corrupted! (backref, pos=" << pos << ", nextpos =" << nextpos << ", len = " << len << ")");
                        if(!reported_record_error)
                        {
                                Blex::ErrStream() << "Record corruption detected: (backref, pos=" << pos << ", nextpos =" << nextpos << ", len = " << len << ")";
                                reported_record_error = true;
                        }
                        return 0; //NO FORWARD PROGRESS
                }

                if (Blex::getu16lsb(recorddata+pos)==columnid)
                    return pos;

                pos = nextpos;
        }
#ifdef DEBUG
        //if (pos != len)
          //  DEBUGPRINT("This record is corrupted! (pos=" << pos << ", real len =" << len << ")");
#endif
        return 0;
}

ColumnId Record::GetColumnIdByNum(unsigned num) const
{
        unsigned pos=2;
        while (pos+4 <= len)
        {
                if (num==0)
                    return (ColumnId)Blex::getu16lsb(recorddata+pos); //return the column id here

                pos+=Blex::getu16lsb(recorddata+pos+2)+4;
                --num;
        }
        return 0;
}

unsigned Record::GetNumCells() const
{
        unsigned count=0,pos=2;
        while (pos+4 <= len)
        {
                pos+=Blex::getu16lsb(recorddata+pos+2)+4;
                ++count;
        }
        return count;
}

void WritableRecord::SetColumn(ColumnId column, unsigned size, void const *data)
{
        //ADDME: Support NULL values

        //See if the column is already in the buffer, and if we can fit our data there
        //Remember cells are stored <ColumnID:2bytes> <Length:2bytes> <Data:length bytes>
        unsigned pos=GetCellPosition(column);
        unsigned origlen=pos ? Blex::getu16lsb(&recdata[pos+2]) : 0;

        if (size > 65535)
            throw Exception(ErrorInternal, "Attempting to send a too large cell (64KB max)");

        if (pos && origlen>=size) //data will fit at original location
        {
                //Store data
                memcpy(&recdata[pos+4],data,size);
                //Store length
                Blex::putu16lsb(&recdata[pos+2],static_cast<uint16_t>(size));
                //Remove remainder of field, if new field is shorter
                if (origlen>size)
                    recdata.erase(recdata.begin() + pos+size+4,
                                  recdata.begin() + pos+4+origlen);
        }
        else //data won't fit, so zap it and append at the end
        {
                if (recdata.size() - origlen + size > 65535)
                    throw Exception(ErrorInternal, "Attempting to construct a too large record (64KB max)");

                if (pos)
                    recdata.erase(recdata.begin() + pos,
                                  recdata.begin() + pos+origlen+4);
                //Append new cell to end
                unsigned startpos=recdata.size();
                recdata.resize(startpos+size+4);
                //Store column id
                Blex::putu16lsb(&recdata[startpos],column);
                //Store size
                Blex::putu16lsb(&recdata[startpos+2],static_cast<uint16_t>(size));
                //Store data
                memcpy(&recdata[startpos+4],data,size);
        }
        //Update record length
        Blex::putu16lsb(&recdata[0],static_cast<uint16_t>(recdata.size()));
        recorddata=&recdata[0];
        len = static_cast<uint16_t>(recdata.size());
}

void WritableRecord::DeleteColumn(ColumnId column)
{
        unsigned pos = GetCellPosition(column);
        if (pos)
        {
                // Data exists, get length and zap the data
                unsigned origlen = Blex::getu16lsb(&recdata[pos+2]);
                recdata.erase(recdata.begin() + pos,
                              recdata.begin() + pos+origlen+4);

                //Update record length
                Blex::putu16lsb(&recdata[0],static_cast<uint16_t>(recdata.size()));
                recorddata=&recdata[0];
                len = static_cast<uint16_t>(recdata.size());
        }
}

void WritableRecord::Clear()
{
        recdata.resize(2);
        Blex::putu16lsb(&recdata[0],2);
        len=2;
}

void WritableRecord::SetColumnIdByNum(unsigned which, ColumnId newid)
{
        unsigned pos=2;
        while (pos+4 <= len)
        {
                if (which==0)
                {
                        Blex::putu16lsb(&recdata[pos], newid);
                        return;
                }

                pos+=Blex::getu16lsb(recorddata+pos+2)+4;
                --which;
        }
}

unsigned NotificationRequests::AddRequest(std::string const &schemaname, std::string const &tablename,unsigned numcolumns,const char *columnnames[])
{
        requests.push_back(Request(schemaname, tablename, numcolumns, columnnames));
        return requests.size()-1;
}

unsigned NotificationRequests::AddRequest(std::string const &schemaname, std::string const &tablename,std::vector< std::string > const &columns)
{
        requests.push_back(Request(schemaname, tablename, columns));
        return requests.size()-1;
}

NotificationRequests::Request::Request(std::string const &schemaname, std::string const &tablename,unsigned numcolumns,const char *columnnames[])
: schema(schemaname)
, table(tablename)
{
        columns.reserve(numcolumns);
        for (unsigned idx = 0; idx < numcolumns; ++idx)
            columns.push_back(columnnames[idx]);
}

NotificationRequests::Request::Request(std::string const &schemaname, std::string const &tablename,std::vector< std::string > const &columns)
: schema(schemaname)
, table(tablename)
, columns(columns)
{
}


void CalculateResponse(uint8_t const *challenge, unsigned challenge_size, std::vector<uint8_t> const &secretkey, uint8_t *response, unsigned response_size)
{
        std::fill(response, response + response_size, 0);

        Blex::MD5 calc;
        calc.Process(challenge, challenge_size);
        calc.Process(&secretkey[0],secretkey.size());
        std::memcpy(response, calc.Finalize(), std::min(response_size, 16U)); // MD5 hash len = 16 bytes
}

std::string GetBlobDiskpath(std::string const &blobfolder, BlobId blobid, bool create_dir)
{
        //ADDME: Cut back on unecessary CreateDirs and ostringstream
        std::ostringstream path;

        //Basically we store a 0x12345678 blob in blob-12/345/678
        path << blobfolder;
        if (blobid >= 0x1000000L) //more than 6 digits
        {
                path << "/blob-" << (blobid>>(6*4)); //remove right 24/4=6 digits
        }
        else
        {
                path << "/blob";
        }

        std::string basedir = path.str();
        path << '/' << ( (blobid & 0xFFFFFFL) >> (3*4)); // last 3 digits
        std::string blobdir = path.str();
        path << '/' << blobid;
        std::string blobpath = path.str();

        if (create_dir && !Blex::PathStatus(blobdir).IsDir())
        {
                //ADDME: we should remember whether we need to do this (perhaps a bitset of all created dirs?)
                if (!Blex::PathStatus(basedir).IsDir() && !Blex::CreateDir(basedir, true) && !Blex::PathStatus(basedir).IsDir())
                    return std::string();

                if (!Blex::CreateDir(blobdir, false) && !Blex::PathStatus(blobdir).IsDir())
                    return std::string();
        }

        return blobpath;
}

} //end namespace Database







