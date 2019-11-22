#ifndef blex_webhare_shared_dbase
#define blex_webhare_shared_dbase

#include <blex/crypto.h>
#include <blex/datetime.h>
#include <blex/utils.h>
#include <blex/mapvector.h>
#include <blex/podvector.h>
#include <blex/socket.h> //for blex::SocketAddress
#include <vector>
#include <stdexcept>
#include <ap/libwebhare/whrpc.h>

namespace Database
{

//References
class IOBuffer;
class Record;
class WritableRecord;

std::ostream& operator<<(std::ostream &lhs, IOBuffer const &rhs);

/** An object ID in the database */
typedef int32_t ObjectId;

/** A table ID in the database, which can refer to a local or a disk table */
typedef ObjectId TableId;

/** A column ID in the database */
typedef uint16_t ColumnId;

/** A blob identification (an uint32_t that refers a file in the disk database) */
typedef uint32_t BlobId;

/** A role ID */
typedef int32_t RoleId;

/** Base for dynamic types */
const short BaseDynamicType = 30000;
/** Maximum length of a column data (not the blob limit!) */
const unsigned MaxColumnSize = 4096;
/// End of block; more results will follow
const unsigned DBBRCEndOfBlock = 65533;
/// End of results
const unsigned DBBRCEndOfResults = 65534;
/// End of query (query already closed)
const unsigned DBBRCEndOfQuery = 65535;

/** Maximum length of a blob data read */
const unsigned MaxBlobReadSize = 16384;

/** Acceptable column types (should be integrated with HareScript types) */
enum ColumnTypes
{
        ///marker for obsoleted static columns
        TUnusedStatic=0,
        ///int32_t. static, size = 4
        TInteger=1,
        ///uint32_t. static, size = 4
        TBoolean,
        ///static, size = 4 (note that 'legacy v2.00 blobs' are size 8, but the upper 8 bytes are ignored)
        TBlob,
        ///static, size = 8 (4 bytes for the date, 4 bytes for the time)
        TDateTime,
        ///money, static, size = 8
        TMoney,
        ///(double precision) float, static, size = 8
        TFloat,
        ///table object id, int32_t, static, size = 4.
        TTable,
        ///role object id, int32_t, static, size = 4.
        TRole,
        ///marker for obsoleted dynamic columns
        TUnusedDynamic=BaseDynamicType,
        ///String type. dynamic. the terminating nul is not stored
        TText,
        ///Old password type, type id now reserved and treated as if it were TText
        TText_Reserved,
        ///integer64, static, size = 8
        TInteger64
};



///Search relation type
enum SearchRelationType
{
        SearchSmaller=0,
        SearchSmallerEqual,
        SearchEqual,
        SearchBiggerEqual,
        SearchBigger,
        SearchUnEqual,
        SearchLike,
        SearchIn
};

enum Actions
{
        ActionSelect=0x1,
        ActionInsert=0x2,
        ActionUpdate=0x4,
        ActionDelete=0x8,
        ActionConnected=0x10,
        ActionDisconnected=0x20
};


enum DBLockResult
{
        DBLRLocked=0,           ///< Record was locked (and not modified wrt initially sent version)
        DBLRLockedModified,     ///< Record was locked (and modified wrt initially sent version - ie 'chased')
        DBLRGone,               ///< Record was deleted, or modified and not adhering to the search data anymore
        DBLRRetry               ///< Record was busy, please backoff and retry
};

enum DBRecordSendType
{
        DBRSTFase1=1,
        DBRSTFase2=2,
        DBRSTBoth=3
};

/** Pointer to a single, read-only, database cell */
class Cell
{
        public:
        explicit Cell(const uint8_t *ptr=0) : data(ptr)
        { }

        static const unsigned HdrSize = 2;

        inline unsigned Size() const
        { return data ? Blex::getu16lsb(data) : 0; }

        inline const uint8_t* Begin() const
        { return data ? data+HdrSize : NULL; }

        inline const uint8_t* End() const
        { return data ? data+Blex::getu16lsb(data)+HdrSize : NULL; }

        inline Blex::StringPair StringPair() const
        { return Blex::StringPair(reinterpret_cast<const char*>(Begin()),
                                  reinterpret_cast<const char*>(End())); }

        inline std::string String() const
        {
                if (data)
                    return std::string(reinterpret_cast<const char*>(Begin()),
                                       reinterpret_cast<const char*>(End()));
                else
                    return std::string();
        }
        inline unsigned GetData(void *store,unsigned maxlen) const
        {
                if (!data || maxlen<Size())
                    return 0;
                memcpy(store,Begin(),Size());
                return Size();
        }
        int32_t Integer() const
        { return Size()==4 ? Blex::gets32lsb(data+HdrSize) : 0; }
        Blex::DateTime DateTime() const
        { return Size()==8 ? Blex::GetLsb<Blex::DateTime>(data+HdrSize ) : Blex::DateTime(0,0); }
        bool Boolean() const
        { return Size()==1 ? Blex::getu8(data+HdrSize) : false; }
        BlobId Blob() const
        { return Size()>=4 ? Blex::getu32lsb(data+HdrSize) : BlobId(0); }
        Blex::FileOffset BlobLength() const
        { return Size()>=16 ? Blex::getu64lsb(data+HdrSize+8) : 0; }
        int64_t Money() const
        { return Size()==8 ? Blex::gets64lsb(data+HdrSize) : 0; }
        int64_t Integer64() const
        { return Size()==8 ? Blex::gets64lsb(data+HdrSize) : 0; }
        F64 Float() const
        { return Size()==8 ? Blex::getf64lsb(data+HdrSize) : 0; }
        bool Exists() const
        { return data!=NULL; }

        private:
        const uint8_t* data;
};

/** Overwrite the size of raw cell data */
inline void SetCellSize(uint8_t *celldata, uint16_t new_size)
{ Blex::putu16lsb(celldata,new_size); }

class BLEXLIB_PUBLIC Record
{
        public:
        inline Record()
        : recorddata(NULL)
        , len(0)
        {
        }

        inline Record(const uint8_t *ptr, unsigned len)
        : recorddata(ptr)
        , len(len)
        {
        }

        /** Get a column id by its sequence number (first cell in record is 0, etc)
            @param which The # of the cell to get, in range 0..GetNumCells-1
            @return The cell */
        ColumnId GetColumnIdByNum(unsigned which) const;

        /** Get a cell by its column ID
            @param which The column ID of the cell to get
            @return The requested cell, or 0 if it's not in the list */
        Cell GetCell(ColumnId which) const
        {
                unsigned pos=GetCellPosition(which);
                return pos ? Cell(recorddata+pos+2) : Cell(0);
        }

        /** Get the number of cells
            @return The number of cells */
        unsigned GetNumCells() const;

        /** Get the raw data */
        uint8_t const * GetRawData() const
        { return recorddata; }

        /** Get the raw length */
        unsigned GetRawLength() const
        { return len; }

        bool Exists() const
        { return recorddata!=NULL; }

        protected:
        const uint8_t *recorddata;

        unsigned len;

        /** Get a cell's position by its column ID
            @param which The column ID of the cell to get
            @return The requested cell, or 0 if it's not in the list */
        unsigned GetCellPosition(ColumnId which) const;
};

/** A WriteableRecord records the modifications that are being made to a record,
    so that updates can be processed atomically.

    To update a record, a WriteableRecord structure is created and the
    modifications are stored in it. When the updates are transmitted to
    the database, the structure is destroyed again.
*/
class BLEXLIB_PUBLIC WritableRecord : public Record
{
        public:
        /** Standard writable record constructor. Initializes the record
            to an empty record */
        WritableRecord() : Record(0, 2), recdata(2)
        {
                Blex::putu16lsb(&recdata[0],2);
                recorddata=&recdata[0];
                len=2;
        }
        WritableRecord(const Record &origrec)
        {
                *this = origrec;
        }
        WritableRecord(const WritableRecord &origrec)
        : Record()
        , recdata(origrec.recdata)
        {
                recorddata=&recdata[0];
                len=origrec.GetRawLength();
        }
        WritableRecord& operator= (const Record &rhs)
        {
                if (rhs.Exists())
                {
                        recdata.assign(rhs.GetRawData(),
                                       rhs.GetRawData() + Blex::getu16lsb(rhs.GetRawData()));
                }
                else
                {
                        recdata.resize(2);
                        Blex::putu16lsb(&recdata[0],2);
                }
                recorddata=&recdata[0];
                len=recdata.size();
                return *this;
        }

        /** Clears the the record */
        void Clear();

        void SetColumnIdByNum(unsigned which, ColumnId newid);

        /** Set a column to the specified raw data */
        void SetColumn(ColumnId column, unsigned size, void const * data);

        void SetString(ColumnId column, std::string const &val)
        {
                SetColumn(column,val.size(),&val[0]);
        }
        void SetInteger(ColumnId column, int32_t val)
        {
                uint8_t tmp[4];
                Blex::puts32lsb(tmp,val);
                SetColumn(column,4,tmp);
        }
        void SetBoolean(ColumnId column, bool val)
        {
                uint8_t tmp(uint8_t(val?1:0));
                SetColumn(column,1,&tmp);
        }
        void SetDateTime(ColumnId column, Blex::DateTime const &datetime)
        {
                uint8_t tmp[8];
                Blex::PutLsb (tmp,datetime);
                SetColumn(column,8,tmp);
        }
        void SetBlob(ColumnId column, BlobId blobid)
        {
                uint8_t tmp[4];
                Blex::putu32lsb(tmp,blobid);
                SetColumn(column,4,tmp);
        }
        void SetBlobAndLength(ColumnId column, BlobId blobid, Blex::FileOffset bloblength)
        {
                uint8_t blobinfo[16];
                Blex::putu32lsb(blobinfo + 0, blobid);
                Blex::putu32lsb(blobinfo + 4, 0); //zero out the unused bytes
                Blex::putu64lsb(blobinfo + 8, bloblength);
                SetColumn(column, 16, blobinfo);
        }
        void SetMoney(ColumnId column, int64_t moneyvalue)
        {
                uint8_t tmp[8];
                Blex::PutLsb (tmp,moneyvalue);
                SetColumn(column,8,tmp);
        }
        void SetInteger64(ColumnId column, int64_t i64value)
        {
                uint8_t tmp[8];
                Blex::PutLsb (tmp,i64value);
                SetColumn(column,8,tmp);
        }
        void SetFloat(ColumnId column, F64 floatvalue)
        {
                uint8_t tmp[8];
                Blex::PutLsb (tmp,floatvalue);
                SetColumn(column,8,tmp);
        }

        void DeleteColumn(ColumnId column);

        private:
        Blex::PodVector<uint8_t> recdata;
};

/** Holds cells and their data.
    A CellArray is a simplification of a Database::WritableRecord (which will be
    deprecated for RPC usage) */
class CellArray
{
        public:
        CellArray();

        /** Clears the cell array */
        void Clear();

        /** Get the number of cells currently inside the cell array */
        unsigned Size() const;

        /** Append a raw data cell */
        void AppendRaw(unsigned size, void const * data);

        void AppendString(std::string const &val)
        {
                AppendRaw(val.size(),&val[0]);
        }
        void AppendInteger(int32_t val)
        {
                uint8_t tmp[4];
                Blex::puts32lsb(tmp,val);
                AppendRaw(4,tmp);
        }
        void AppendBoolean(bool val)
        {
                uint8_t tmp(uint8_t(val?1:0));
                AppendRaw(1,&tmp);
        }
        void SetDateTime(Blex::DateTime const &datetime)
        {
                uint8_t tmp[8];
                Blex::PutLsb (tmp,datetime);
                AppendRaw(8,tmp);
        }
        void SetBlob(BlobId blobid)
        {
                uint8_t tmp[4];
                Blex::putu32lsb(tmp,blobid);
                AppendRaw(4,tmp);
        }
        void SetMoney(int64_t moneyvalue)
        {
                uint8_t tmp[8];
                Blex::PutLsb (tmp,moneyvalue);
                AppendRaw(8,tmp);
        }
        void SetInteger64(int64_t i64value)
        {
                uint8_t tmp[8];
                Blex::PutLsb (tmp,i64value);
                AppendRaw(8,tmp);
        }
        void SetFloat(F64 floatvalue)
        {
                uint8_t tmp[8];
                Blex::PutLsb (tmp,floatvalue);
                AppendRaw(8,tmp);
        }

        private:
        Blex::PodVector<uint8_t> arraydata;
};

/** A list of notification requests. These can be set up in advance, and then
    passed to the database connection to indicate which notifications we want.
    No checking on names is done; the user is responsible for giving the right
    names and stuff. Notifications are sent using this data; when a column
    does not exist an empty cell is returned. When a table does not exist
    no notifications are sent; no errors.
*/
class BLEXLIB_PUBLIC NotificationRequests
{
        public:
        /** Add requests for another table
            @param schemaname Name of schema to request notes about
            @param tablename Name of table to request notes about
            @param numcolumns Number of column ids passed
            @param columns Name of columns to request when receiving a note. None to only receive change indications!
            @return Index to notification request (needed to query the response later) */
        unsigned AddRequest(std::string const &schemaname, std::string const &tablename,unsigned numcolumns,const char *columnnames[]);

        /** Add requests for another table
            @param schemaname Name of schema to request notes about
            @param tablename Name of table to request notes about
            @param columns Names of columns to request when receiving a note. None to only receive change indications!
            @return Index to notification request (needed to query the response later) */
        unsigned AddRequest(std::string const &schemaname, std::string const &tablename,std::vector< std::string > const &columns);

        struct Request
        {
                Request()
                {
                }

                /** Construct and fill in request structure
                    @param schemaname Name of schema to request notes about
                    @param tablename Name of table to request notes about
                    @param numcolumns Number of column ids passed
                    @param columns Name of columns to request when receiving a note. None to only receive change indications! */
                Request(std::string const &schemaname, std::string const &tablename,unsigned numcolumns,const char *columnnames[]);

                /** Construct and fill in request structure
                    @param schemaname Name of schema to request notes about
                    @param tablename Name of table to request notes about
                    @param columns Names of columns to request when receiving a note. None to only receive change indications! */
                Request(std::string const &schemaname, std::string const &tablename,std::vector< std::string > const &columns);

                /// Schema
                std::string schema;
                /// Table
                std::string table;

                /// List of columns. No columns: only change indications will be sent!
                std::vector< std::string > columns;
        };

        typedef std::vector< Request > Requests;
        Requests requests;

        inline void Clear() { requests.clear(); }
};

void BLEXLIB_PUBLIC CalculateResponse(uint8_t const *challenge, unsigned challenge_size, std::vector<uint8_t> const &secretkey, uint8_t *response, unsigned response_size);


//template<> void IOBuffer::ReadIn<NotificationRequests>(NotificationRequests *out);
//template<> void IOBuffer::Write<NotificationRequests>(NotificationRequests const &in);
//
//template<> void IOBuffer::ReadIn<WritableRecord>(WritableRecord *out);
//template<> void IOBuffer::Write<Record>(Record const &in);

template<> inline void IOBuffer::ReadIn<WritableRecord>(WritableRecord *out)
{
        //Verify that the length header is there
        if (&iobuffer[readpos] + 2 > GetRawLimit())
            InvalidRPCData();

        uint16_t len = Blex::getu16lsb(&iobuffer[readpos]);
        //Verify that the entire record is there
        if (&iobuffer[readpos] + len > GetRawLimit())
            InvalidRPCData();

        *out = Record(&iobuffer[readpos], len);
        readpos += len;
}
template<> inline void IOBuffer::Write<Record>(Record const &in)
{
        uint8_t *outdata=Reserve(in.GetRawLength());
        std::copy(in.GetRawData(),in.GetRawData()+in.GetRawLength(),outdata);
}
template<> inline void IOBuffer::Write<WritableRecord>(WritableRecord const &in)
{ Write<Record>(in); }

std::string BLEXLIB_PUBLIC GetBlobDiskpath(std::string const &blobfolder, BlobId blobid, bool create_dir);


} //end namespace Database

#endif
