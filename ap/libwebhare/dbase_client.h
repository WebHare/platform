#ifndef blex_webhare_shared_dbase_client
#define blex_webhare_shared_dbase_client

#include <queue>
#include <list>
#include <blex/threads.h>
#include <blex/stream.h>
#include <blex/pipestream.h>
#include "dbase.h"

namespace Database
{
//forward declarations
class ConnectionBase;
class ConnectionManager;
class TCPFrontend;
class TCPConnection;
class TransactConnection;
class TransFrontend;
class SQLResultScanner;

namespace Client
{
class CachedMetadata;
class Search;
class SearchData;
} // End of namespace Client

/** DBClientColumnInfos hold the metadata of the existing columns */
class ClientColumnInfo
{
        public:
        struct Less;
        friend struct Less;

        struct Less
        {
                bool operator()(const ClientColumnInfo &lhs, const ClientColumnInfo &rhs) const
                { return lhs.db_id < rhs.db_id; }
                bool operator()(const ClientColumnInfo &lhs,unsigned rhs) const
                { return lhs.db_id<rhs; }
                bool operator()(unsigned lhs,const ClientColumnInfo &rhs) const
                { return lhs<rhs.db_id; }
        };

        ClientColumnInfo();
        static ClientColumnInfo RecordIdColumn();

        /** Decode a column from a IOBuffer */
        explicit ClientColumnInfo(IOBuffer *src);

        ///Name of this column
        std::string name;
        ///The type of the column
        ColumnTypes type;
        ///Is this an internal column?
        bool internal;

        // Deprecated thingy for backup.exe
        inline unsigned Deprecated_GetId() const { return db_id; }

        private:
        ///Id of this column (only usable for client structures)
        unsigned db_id;

        friend class TransFrontend;
        friend class Client::Search;
        friend class Client::SearchData;
};

/** DBTableInfos hold the metadata of the existing tables */
class TableInfo
{
        public:
        ///Vector for storing our columns
        typedef std::vector<ClientColumnInfo> Columns;
        ///Constant iteratorf for columns container
        typedef Columns::const_iterator ColumnCItr;
        ///Vector for storing column names
        typedef Blex::MapVector< std::string, unsigned, Blex::StrLess< std::string > > ColumnNames;

        struct Less;
        friend struct Less;

        struct Less
        {
                bool operator()(const TableInfo &lhs, const TableInfo &rhs) const
                { return lhs.db_id <rhs.db_id; }
                bool operator()(const TableInfo &lhs,unsigned rhs) const
                { return lhs.db_id<rhs; }
                bool operator()(unsigned lhs,const TableInfo &rhs) const
                { return lhs<rhs.db_id; }
        };

        TableInfo()
        {
        }

        /** Decode a table and its columns from a IOBuffer */
        explicit TableInfo(IOBuffer *src);

        /** Lookup the definition of a column
            @param  name Name of the column to return. Never NULL!
            @return The requested ClientColumnInfo structure, or NULL.
        */
        template <class T> ClientColumnInfo const *GetClientColumnInfo(T const &name, bool allow_recordid) const
        {
                ColumnNames::const_iterator itr = column_names.Find(name);
                if (itr != column_names.End())
                    return &columns[itr->second];
                if (allow_recordid && name == recordid_column.name)
                    return &recordid_column;
                return nullptr;
        }

        /** Get the column list itself */
        const Columns& GetColumns() const { return columns; }
        Columns& GetColumns() { return columns; }

        std::string name;

        // Deprecated thingy for backup.exe
        inline unsigned Deprecated_GetId() const { return db_id; }

        private:

        unsigned db_id;

        Columns columns;

        ColumnNames column_names;

        static ClientColumnInfo recordid_column;

        friend class TransFrontend;
        friend class Client::CachedMetadata;
        friend class Client::SearchData;
};

namespace Client
{

/** Item to scan a specific table / column using the SearchData structure */
class BLEXLIB_PUBLIC Search
{
        public:
        enum Type
        {
                SingleColumn,
                JoinTwoColumns
        };

        /** Create a simple Equal search from data we know in advance
            @param column Column of the specified table that must be searched
            @param datastart Pointer to start of data
            @param datalimit Pointer to limit if data */
        static Search EqualSingle(ClientColumnInfo const *column, uint8_t const *datastart, uint8_t const *datalimit)
        {
                return Search(SearchEqual, column, true, Blex::PtrDiff(datastart,datalimit), datastart);
        }

        /** Create a single-column search
            @param column Column of the specified table that must be searched
            @param data Data we are searching for
            @param searchtype Search type */

        template<typename DataType> inline Search static Single(ClientColumnInfo const *column,
                                                                         DataType const &data,
                                                                         SearchRelationType searchtype);

        /** Create a Search for a string search
            @param column Column of the specified table that must be searched
            @param strstart Pointer to start of string
            @param strend Pointer to end of string
            @param casesensitive True for a case-sensitve search */
        static Search SingleString(ClientColumnInfo const *column, char const *str_start, char const *str_end, bool casesensitive, SearchRelationType searchtype)
        {
                return Search(searchtype, column, casesensitive,
                              Blex::PtrDiff(str_start,str_end), reinterpret_cast<const uint8_t*>(str_start));
        }

        /** Constructor for a column relation search */
        static Search Relation(ClientColumnInfo const *column, ClientColumnInfo const *column2,
                                        bool casesensitive,
                                        SearchRelationType relationtype)
        {
                return Search(relationtype, column, column2, casesensitive);
        }

        /** Encode a searchitem structure into a IOBuffer */
        void EncodeIOBuffer(IOBuffer *dest) const;

        /** Check if a cell matches our criterium. */
        bool IsMatch(Cell lhs, ColumnTypes coltype) const;

        ClientColumnInfo const * GetRhsColumn() const
        {
                assert(type == JoinTwoColumns);
                return column2;
        }

        Type GetType() const
        { return type; }

        SearchRelationType GetSearchRelationType() const
        { return relationtype; }

        bool GetCaseSensitive() const
        { return casesensitive; }

        Cell GetData() const
        { return Cell(data_to_searchfor); }

        ClientColumnInfo const * GetColumn() const
        { return column; }

        private:
        /** Constructor for single column search */
        Search(SearchRelationType _relationtype, ClientColumnInfo const *_column,
                        bool _casesensitive, uint32_t _searchsize, const uint8_t* _searchfor);

        /** Constructor for a column relation search */
        Search(SearchRelationType _relationtype, ClientColumnInfo const *_column, ClientColumnInfo const *_column2,
                        bool _casesensitive);

        ///Type of search we want
        Type type;
        ///Relation type of search we want
        SearchRelationType relationtype;
        ///First column that must be checked (lhs on columnrelation searches)
        ClientColumnInfo const *column;
        ///Second column that must be checked (rhs on columnrelation searches)
        ClientColumnInfo const *column2;
        ///true when looking for an exact match, false when looking for a match case-insensitively
        bool casesensitive;
        ///The data we're looking for
        uint8_t data_to_searchfor[MaxColumnSize+Cell::HdrSize];
        ///Is the 'searchfor' a NULL?
        bool search_is_null;
};

/** Container of Search structures, and keeper of their table references */
class SearchData
{
        public:
        struct Item
        {
                Item(uint32_t _tableindex,uint32_t _tableindex2,Search const &_search)
                : tableindex(_tableindex), tableindex2(_tableindex2), search(_search)
                {
                }

                uint32_t tableindex;
                uint32_t tableindex2;
                Search search;
        };

        struct NeededColumn
        {
                NeededColumn(uint32_t _tableindex, ClientColumnInfo const *_columninfo, DBRecordSendType _sendtype) : tableindex(_tableindex), columninfo(_columninfo), sendtype(_sendtype) {}
                uint32_t tableindex;
                ClientColumnInfo const *columninfo;
                DBRecordSendType sendtype;
        };

        /** Constructor for empty search data, for more than one table */
        SearchData(unsigned _limit, unsigned table_count, TableInfo const *tables[]);

        /** Constructor for empty search data */
        SearchData();

        /** Constructor reading from IO Buffer*/
        explicit SearchData(IOBuffer *src);

        /** Encode a search structure into a IOBuffer */
        void EncodeIOBuffer(IOBuffer *dest) const;

        /** Get the maximum number of matches we are allowed to return
            @return The current limit, or 0 for no limit */
        unsigned GetLimit() const
        { return limit; }

        /** Get the number of tables this search will search */
        unsigned GetNumTables() const
        { return tables.size(); }

        /** Get a table by index  */
        TableInfo const * GetTable(unsigned whichtable) const
        { return tables[whichtable]; }

        /** Get the number of criteria this search will use */
        unsigned GetNumCriteria() const
        { return items.size(); }

        /** Get a criteria by index */
        Item const& GetCriterium(unsigned index) const
        { return items[index]; }

        /** Add a new criterium for a single search */
        void AddSingleCriterium(uint32_t tableindex, Search const &new_search)
        {
                assert(new_search.GetType()==Search::SingleColumn);
                items.push_back(Item(tableindex,0,new_search));
        }

        /** Add a new criterium for a join search*/
        void AddJoinCriterium(uint32_t left_tableindex, uint32_t right_tableindex, Search const &new_search)
        {
                assert(new_search.GetType()==Search::JoinTwoColumns);
                items.push_back(Item(left_tableindex,right_tableindex,new_search));
        }

        /// Add a list of columns that are needed
        void AddNeededColumn(uint32_t tableindex, ClientColumnInfo const *columninfo, DBRecordSendType sendtype);

        /** Returns number of needed columns */
        unsigned GetNumNeededColumns() const
        { return needed_columns.size(); }

        bool HasFase2Columns() const { return has_fase2_data; }

        //private: // FIXME ?!
        typedef std::vector< Item > Items;

        ///Maximum number of matches to return
        uint32_t limit;

        std::vector< TableInfo const * > tables;

        std::vector< NeededColumn > needed_columns;

        Items items;

        bool has_fase2_data;
};

/** A locally cached metadata piece */
class CachedMetadata
{
    public:
        CachedMetadata();
        ~CachedMetadata();

        ///Vector for storing our tables
        typedef std::vector<TableInfo> Tables;
        ///Vector for storing our tables
        typedef Tables::const_iterator TableCItr;

        ///Storage roles
        typedef std::map<std::string, RoleId, Blex::StrCaseLess<std::string> > Roles;

        /** Lookup the definition of a table
            @param  id  ID of the table to return
            @return The requested TableInfo structure, or NULL.
        */
        const TableInfo* GetTableInfo(Blex::StringPair const &name) const;

        const Tables& GetTables() const { return tables; }

        ///Look up a role id
        RoleId GetRoleByName(std::string const &name) const;

        /** Decode a list of tables from a IOBuffer */
        void GetFromIOBuffer(IOBuffer *src);

        inline Blex::DateTime GetClock() const { return meta_clock; }
        inline uint32_t GetVersion() const { return meta_version; }

        private:
        //no copying..
        CachedMetadata(CachedMetadata const&);
        CachedMetadata& operator=(CachedMetadata const&);

        ///Vector for storing table names
        typedef Blex::MapVector< std::string, unsigned, Blex::StrLess< std::string > > TableNames;


        ///Clock time of this metadata
        Blex::DateTime meta_clock;
        ///Version of this metadata
        uint32_t meta_version;

        Tables tables;
        TableNames table_names;
        Roles roles;

        unsigned refcount; //refocunt is protected by REmoteDatabase's lock
        friend class Database::TCPFrontend;
        friend class Database::TransactConnection;
};

template<> inline Search Search::Single<int32_t>(ClientColumnInfo const *column, int32_t const &data, SearchRelationType searchtype)
{
        uint8_t buf[4];
        Blex::puts32lsb(buf,data);
        return Search(searchtype, column, true, 4, buf);
}

template<> inline Search Search::Single<bool>(ClientColumnInfo const *column, bool const &data, SearchRelationType searchtype)
{
        uint8_t buf[1];
        Blex::putu8(buf,static_cast<uint8_t>(data ? 1 : 0));
        return Search(searchtype, column, true, 1, buf);
}
template<> inline Search Search::Single<std::string>(ClientColumnInfo const *column, std::string const &data, SearchRelationType searchtype)
{
        return SingleString(column,&*data.begin(),&*data.end(),true,searchtype);
}
template<> inline Search Search::Single<Blex::DateTime>(ClientColumnInfo const *column, Blex::DateTime const &data, SearchRelationType searchtype)
{
        uint8_t buf[8];
        Blex::PutLsb<Blex::DateTime>(buf,data);
        return Search(searchtype, column, true, 8, buf);
}

} //end namespace Client

/** The 'front' side of a transaction tandem , a structure which clients get when they
    want to read or write the database (you never read directly, but through
    a transaction)

    Multithreading considerations:
    TransFrontend itself is not threadsafe and every single TransFrontend
    should only be used by one thread a time.
*/
class BLEXLIB_PUBLIC TransFrontend
{
    public:
        explicit TransFrontend(TCPFrontend &dbase, TransactConnection &conn, int32_t trans_dbid, bool autotrans, bool backup_tranasction);

        ~TransFrontend();

        Client::CachedMetadata const & GetConfig() const
        { return *cached_metadata; }

        /** Get the most current metadata (usefull for auto-transactions,
            outside the beginwork/endwork cycle. Use when opening a scan fails
            because of non-up-to-data metadata
        */
        void RefreshMetadata();

        /** Upload a local blob so that it can be inserted into the database */
        BlobId UploadBlob(Blex::RandomStream &infile);

        /// Returns whether this is an auto-transaction
        bool inline IsAutoTransaction() const { return is_autotrans; }

        // Return whether this transaction is explicitly opened
        bool inline IsExplicitlyOpened() const { return is_explicitly_opened; }

        /// Returns whether the dbserver wants origin info
        bool inline WantRPCInfo() const { return wantrpcinfo; }

        /** Get an unused autonumber for an autonumber, that will remain
            reserved for at least the duration of the transaction. We need this
            when doing INSERTs of connected records, and we need to know the
            autonumber beforehand. This 'reservation' only applies for other
            auto-generated IDs for this column, a parallel transaction can
            still steal the ID by explicitily committing with our ID.
            (but this has to be done on purpose, so unlikely to happen in practice)
            @param table Table for which we want to obtain an autonumber
            @param column Autonumber column
            @return An unused and reserved autonumber, or 0 if the column is not an autonumber column */
        int32_t GetAutonumber(Blex::StringPair const &tablename, Blex::StringPair const &columnname);

        /** Open a blob in the database
            @param blobid Blob to open
            @return A stream containing the blob, or NULL on open error */
        Blex::RandomStream * OpenBlob(BlobId blobid, Blex::FileOffset cached_length);

        /** Explicitly opens the an auto transaction for larger actions. After
            this call, all executed functions are gathered within one logical transaction,
            until Finish is called */
        void BeginWork();

        /** Commit or rollback a transaction with the database. Will throw a
            Exception if it fails to commit the data. Although just destroying
            a transaction will cause a rollback as well, this function has the
            advantage of putting the connection on the re-use stack.
            @param commit True to commit the transaction */
        void Finish(bool commit);

        /** Database writing and metadata modifications.
            Functions to create, update and delete records, columns and tables */
        //@{

        /** Send a SQL command to the database */
        SQLResultScanner * SendSQLCommand(std::string const &cmd);

        /** (re)create a view with the specified roles */
//        int32_t CreateView (std::vector<RoleId> const &roles, bool recreate_view);

        /** Inserst a new record in a table
            @param table Table to insert the new record in
            @param columns List of pointers to names of columns to insert (read until first 0)
            @param recupdate New record to write
        */
        void InsertRecord(Blex::StringPair const &tablename, const char **columns, WritableRecord const &recupdate);

        /** Inserst a new record in a table
            @param table Table to insert the new record in
            @param column_count Number of columns to set
            @param columns List of columns to insert
            @param recupdate New record to write
        */
        void InsertRecord(TableInfo const *table, unsigned column_count, ClientColumnInfo const *columns[], WritableRecord const &recupdate);

        //@}

        /** Disables auto-rollback on destruction of the transaction frontend
            (used for transactions passed from an ask)
        */
        void DisableRollbackOnDestruction();

        // Returns the underlying connection
        inline TransactConnection & GetConnection() { return *remoteconn; }

    private:
        TransFrontend(TransFrontend const &);
        TransFrontend& operator=(TransFrontend const &);

        void FinishInternal(bool commit, bool close);

        /** Download or refresh our metadata */
        void DownloadMetadata();

        IOBuffer iobuf;

        /** Store our metadata */
        Client::CachedMetadata *cached_metadata;

        TransactConnection *remoteconn;

        /// External id transaction
        int32_t const trans_dbid;

        friend class TransactConnection;

        TCPFrontend &dbase;
#if defined(PROFILE) || defined(DEBUG)
        ///Timer for measuring total transaction overhead (every TransFrontend function call)
        mutable Blex::FastTimer transtimer;
#endif

        /// Is this an auto-transaction?
        bool const is_autotrans;

        /// Is this transaction explicitly opened?
        bool is_explicitly_opened;

        /// May we rollback on destruction?
        bool rollback_on_destruction;

        /// Does the db server want rpc info?
        bool wantrpcinfo;

        ///Is this a backup transaction?
        const bool backup_transaction;

        friend class RawScanIterator;
};

/** The RawScanIterator iterates over a result-set, without consideration
    how it was made, or what types of columns are available.

    Warning: the database can close a query when it determines that all data has
    already been sent. */
class RawScanIterator
{
        // Undefined copy and assignment to prevent copying
        RawScanIterator(RawScanIterator const &);
        RawScanIterator & operator =(RawScanIterator const &);

        /// IOBuffer to use
        IOBuffer &iobuf;

        TransactConnection &conn;

        /// Relevant transaction (may be 0 for non-transaction specific results)
        int32_t const trans_dbid;

        /// Storage for result block
        std::vector< WritableRecord > results;

        /// Indicates whether fase2 data is present (per row)
        std::vector< bool > has_fase2_data;

        /// Maximum number of rows to retrieve per block
        unsigned max_rows_in_block;

        /// Indicates if the resultset can be updated
        bool can_update;

        /// Number of rows currently in result block
        unsigned current_rows;

        /// Indicates whether fase 2 columns exist
        bool has_fase2_columns;

        /// Indicates whether end of results has been reached
        bool got_more_blocks;

        uint32_t query_id;

        bool got_info;

        /// IO buffer for advance reads
        IOBuffer advance_iobuf;

        bool have_advance_read;

        /// List of columns describing the query
        std::vector< ClientColumnInfo > info;

        /** Initializes rawscanner from sent data */
        void InitializeFromIobuf();

        /** Retrieves a block of row data
            @param buf IOBuffer to read the block from
            @param new_block Set to TRUE if this is a new block, to FALSE for fase 2 data
            @param received_row_count If not 0, filled with number of received rows.
            @return TRUE if more blocks will follow this one. */
        bool RetrieveBlock(IOBuffer &buf, bool new_block, unsigned *received_row_count);

        /** Retrieves all row data for a single row
            @param row_start Pointer to first record of the row
            @param clear Set to true if row must be cleared first */
        void RetrieveRowData(IOBuffer &buf, WritableRecord &row, bool clear);

        /** Reads column info from iobuf */
        void ReadInfoFromIobuf();

        /** Tries to schedule an advance read
        */
        void TryScheduleSpeculativeAdvance();

        /** Finishes a speculative advance if pending
            @return Whether a speculative advance was received
        */
        bool FinishSpeculativeAdvance();

    public:
        /** Build a scan iterator, that automatically sends a query
            @param trans Transaction
            @param searchfor Search to execute
            @param max_rows_in_block Maximum rows to return in a block
            @param for_updating Indicates whether resultset can be modified */
        explicit RawScanIterator(TransFrontend &trans, Client::SearchData const &searchfor, unsigned max_rows_in_block, bool for_updating, bool require_info, std::string const &origin);

        /** Build an iterator
            @param _iobuf IOBuffer to use for communication
            @param _conn Transaction connection
            @param trans Relevant transaction (may be 0 if no transaction is relevant) */
        explicit RawScanIterator(IOBuffer &_iobuf, TransactConnection &_conn, TransFrontend *trans);

        ~RawScanIterator();

        /// Returns number of results in current result-block
        unsigned GetCurrentRowsNum();

        /** Proceeds to next block.
            @return Number of rows in block */
        unsigned GetNextBlock();

        /// Retrieves a row from the current block
        Record const & GetRow(unsigned row);

        /** Locks a row in the current block
            @return Lock result */
        DBLockResult LockRow(unsigned row);

        /// Unlocks a row in the current block
        void UnlockRow(unsigned row);

        /// Deletes first record in a row in the current block (must be locked previously)
        void DeleteRow(unsigned row);

        /// Updates first record in a row in the current block (must be locked previously)
        void UpdateRow(unsigned row, WritableRecord const &recupdate);

        /// Retrieves fase2 data for the designated rows
        void RetrieveFase2Data(unsigned const *row, unsigned count, bool allow_direct_close);

        /** Retrieves column data. Call when the query is still open, or make sure the info is
            automatically sent by the database on query startup. */
        std::vector< ClientColumnInfo > const & GetClientColumnInfo();

        /// Returns if info can be still be gotten
        bool CanGetInfo() { return got_info || query_id != 0; }

        /// Returns if info is already present
        bool GotInfo() { return got_info; }

        /// Closes the query
        void Close();

        friend class TransactConnection;
};

class BLEXLIB_PUBLIC ResultSetScanner
{
    private:
        //not implemented copiers
        ResultSetScanner& operator=(const ResultSetScanner&);
        ResultSetScanner(const ResultSetScanner&);
    protected:
        /// RawScanIterator over the resultset
        std::unique_ptr< RawScanIterator > iterator;

        /// Currently selected row, -1 for not initialized yet
        signed current_row;

    protected:
        ResultSetScanner();
        virtual bool InitializeScan();

    public:
        /** Initializes with an iterator, takes ownage of iterator */
        ResultSetScanner(RawScanIterator *iterator);

        virtual ~ResultSetScanner();

        Record const & GetRowRecord();
        Cell GetCell(uint16_t cellindex);

        bool NextRow();

        DBLockResult LockRow();
        void UnlockRow();
        void DeleteRow();
        void UpdateRow(WritableRecord const &recupdate);

        // Returns if the info can be retrieved.
        inline bool CanGetInfo() { return iterator.get() ? iterator->CanGetInfo() : false; }

        // Retrieve columninfo; only possible when resultset is open, throws otherwise.
        std::vector< ClientColumnInfo > const & GetInfo();

        // Dumps the current row to the screen in debugmode
        void DumpCurrentRow();

        ///End the scanner, finishing any updates
        void Close();
};

class BLEXLIB_PUBLIC ClientScanner : public ResultSetScanner
{
        private:
        TransFrontend &trans;

        ClientColumnInfo const * GetClientColumnInfo(unsigned tableindex, const char *columnname) const;

        Client::SearchData to_search;

        bool updating_scanner;

        bool InitializeScan();

        bool require_info;

        std::string origin;

        public:
        /** Initialize a databse scanner
            @param trans Transaction to scan
            @param for_update True if we intend to update or delete rows */
        ClientScanner(TransFrontend &trans, bool for_update, std::string const &origin);

        /** Requires info to be available through GetClientColumnInfo. Must be called
            before first NextRow() */
        void RequireInfo();

        /** Add a table to the list of tables to scan
            @param tablename Table to add to the scan
            @param columnnames If not null, a pointer to a null-terminated list
                               of the name of the columns to request from this table */
        void AddTable(std::string const &tablename, const char **columnnames);

        /** Add a table to the list of tables to scan
            @param tablename Table to add to the scan
            @param columnnames If not null, a pointer to a null-terminated list
                               of the name of the columns to request from this table */
        void AddTable(const char *tablename, const char **columnnames);

        void AddTable(TableInfo const *tablename, const char **columnnames);

        /** Set a limit on the number of returned results. If this function
            is not called, no limit wil lbe imposed on the number of returned values */
        void SetLimit(unsigned newlimit);

        /** Add a new criterium for a join search*/
        void AddJoin(uint32_t left_tableindex, ClientColumnInfo const *leftcolumn, uint32_t right_tableindex, ClientColumnInfo const *rightcolumn, SearchRelationType searchtype, bool case_sensitive);
        void AddJoin(uint32_t left_tableindex, const char *leftcolumn, uint32_t right_tableindex, const char *rightcolumn, SearchRelationType searchtype, bool case_sensitive)
        {
                AddJoin(left_tableindex,GetClientColumnInfo(left_tableindex,leftcolumn)
                       ,right_tableindex,GetClientColumnInfo(right_tableindex,rightcolumn)
                       ,searchtype,case_sensitive);
        }

        void RequestAllColumns(unsigned tableindex);
        void RequestColumns(unsigned tableindex, const char **columnnames);
        void RequestColumns(unsigned tableindex, unsigned column_count, const ClientColumnInfo *columninfos[]);

        template <class SearchData>
          void AddSearch(uint32_t tableindex, ClientColumnInfo const *column, SearchData const &data, SearchRelationType searchtype)
        {
                to_search.AddSingleCriterium(tableindex,Client::Search::Single<SearchData>(column,data,searchtype));
        }

        template <class SearchData>
          void AddSearch(uint32_t tableindex, const char *columnname, SearchData const &data, SearchRelationType searchtype)
        {
                AddSearch(tableindex,GetClientColumnInfo(tableindex,columnname),data,searchtype);
        }

        void AddStringSearch(uint32_t tableindex, ClientColumnInfo const *column, unsigned strsize, const char *strdata, SearchRelationType searchtype, bool case_sensitive)
        {
                to_search.AddSingleCriterium(tableindex,Client::Search::SingleString(column,strdata,strdata+strsize,case_sensitive,searchtype));
        }
        void AddStringSearch(uint32_t tableindex, const char *columnname, unsigned strsize, const char *strdata, SearchRelationType searchtype, bool case_sensitive)
        {
                AddStringSearch(tableindex, GetClientColumnInfo(tableindex,columnname),strsize, strdata, searchtype, case_sensitive);
        }
};

class SQLResultScanner : public ResultSetScanner
{
    public:
        SQLResultScanner(TransactConnection &conn, IOBuffer &initial_buffer, TransFrontend &trans);

        Record const & GetRecord();
        bool Next();
        void Close();
};


/** A transactconnection is a connection over which multiple transactions can be
    multiplexed.
    FIXME: Coalesce with remoteconnection, we have lost the distinction between
        listening connections and normal transactions
*/
class BLEXLIB_PUBLIC TransactConnection
{
    public:
        TransactConnection(TCPFrontend &dbase, std::string const &clientname);
        ~TransactConnection();

        /** Open a database transaction with full database access privileges.
            Throws an exception if transaction opening fails
            @return A transaction structure that must be deleted by the caller. */
        TransFrontend* BeginFullyPrivilegedTransaction(bool readonly, bool autotrans) ;

        /** Start a transaction with the database. Will throw a Exception on failure
            @param username User to connect
            @param password Password for the user
            @param clientname Name of the client for this transaction (leave empty for default clientname)
            @param readonly Read only transaction
            @return The opened transaction*/
        TransFrontend * BeginTransaction(std::string const &username, std::string const &password, std::string const &clientname, bool readonly, bool autotrans);

        /** Open a blob in the database
            @param blobid Blob to open
            @return A stream containing the blob, or NULL on open error */
        Blex::RandomStream * OpenBlob(BlobId blob, Blex::FileOffset cached_length, bool backup_transaction);

        /** Subscribe as listener
            @param name of the listener
            @param notes List of tables (and columns) the listener is interested in
            @param login Login for transactions temporarily passed through an ask
            @param passwd Password for the login
        */
        void SubscribeAsListener(std::string const &name, NotificationRequests const &notes, std::string const &login, std::string const &passwd);

        /** Marks the given blobs as persistent (guarantee that they will exist
            until this TransactConnection is destroyed, or until they are dismissed)
            @param blobs List of blobs to make persistent
        */
        void MakeBlobsPersistent(std::vector< BlobId > const &blobs);

        /** Marks the passed blobs as not used within this TransactConnection.
            If the transaction from which the id came is gone, they may be
            removed.
            @param blobs List of blobs to mark unused
        */
        void MakeBlobsUnused(std::vector< BlobId > const &blobs);

        /** Add to a waiter (to wait for asynchronous events such as ask, tell and
            notify)
            @param waiter Waiter to add this connection to
            @return Whether any async packets have already arrived
        */
        bool AddToWaiterRead(Blex::PipeWaiter &waiter);

        bool IsReadSignalled(Blex::PipeWaiter &waiter);

        /** Read directly from the database (using the advance buffer where possible). Never read more than 16384 bytes! */
        std::size_t ReadBlobFromDbase(BlobId blobid, Blex::FileOffset startpos,void *buf,std::size_t maxbufsize, bool backup_transaction);

        /** Check whether the connections has already failed (so rollbacks can be ignored)
        */
        bool HasConnectionFailed();

        void SetIOTimeout(unsigned seconds);

    private:
        void RemoteInform(IOBuffer *iobuf);
        void RemoteRequest(IOBuffer *iobuf);

        /** Perform a speculative remote request. This call causes the request
            to be sent out, but the response will not be handled directly - it
            will be stored in the specified IOBuffer. There should never be
            more than one outstanding speculative request.
            @param iobuf IO Buffer containing the speculative request. Must
                   remain valid until the next FinishSpeculativeRequest call */
        void RemoteAdvanceRequest(IOBuffer *iobuf);

        /** Finish up a speculative - completes the read if it hadn't yet. */
        void FinishAdvanceRequest();

        void GetMetadata(TransFrontend *trans, uint32_t metadataversion, Blex::DateTime metadataclock);

         /** A remote database file */
        class RemoteBlob : public virtual Blex::RandomStream, public Blex::RandomStreamBuffer
        {
                public:
                RemoteBlob(TransactConnection &conn, BlobId blobid, Blex::FileOffset filelength, bool backup_transaction);
                ~RemoteBlob();

                std::size_t RawDirectRead(Blex::FileOffset startpos,void *buf,std::size_t maxbufsize) ;
                std::size_t RawDirectWrite(Blex::FileOffset startpos,const void *buf,std::size_t bufsize) ;
                bool SetFileLength(Blex::FileOffset newlength);
                Blex::FileOffset GetFileLength() ;

                private:
                std::size_t ReadFromDbase(Blex::FileOffset startpos,void *buf,std::size_t maxbufsize) ;

                TransactConnection *conn;
                bool backup_transaction;

                BlobId const blobid;
                Blex::FileOffset const filelength;
                friend class TransactConnection;
        };

        /// Remote database
        TCPFrontend &dbase;

        /// The actual connection
        std::unique_ptr< TCPConnection > dbconn;

        /// List of received asynchronous packets
        std::vector< IOBuffer > async_packets;

        /// Buffer used for synchronous messages
        IOBuffer iobuf;

        ///Are we expecting a response to the advance request?
        bool expect_advance_response;

        /** Any opened files */
        std::set< RemoteBlob* > openblobs;

        ///Current blob for which we did an advance read
        BlobId advance_blob;
        ///Current iterator for which we have an advance read
        RawScanIterator *advance_iterator;
        ///IO Buffer for advance reads
        IOBuffer advance_blob_iobuf;
        ///File offset for advance reads
        Blex::FileOffset advance_startpos;
        ///Size for advance read
        std::size_t advance_maxbufsize;

        ///Current notifications
        NotificationRequests current_notifs;

        ///Is a notifications transaction opened?
        bool notifications_opened;

        /// Name of the client for this connection
        std::string clientname;

        /// Cache for raw iterator result block storage
        std::vector< WritableRecord > cache_results;

        TransactConnection(TransactConnection const &) = delete;
        TransactConnection& operator=(TransactConnection const &) = delete;

        friend class AsyncThread;
        friend class RemoteBlob;
        friend class TransFrontend;
        friend class TCPFrontend;
        friend class RawScanIterator;
};

/** The 'front' side of a database connection. */
class BLEXLIB_PUBLIC TCPFrontend
{
        public:
        /** Prepare connections to the database server
            @param connectto Internet address of the dbserver */
        TCPFrontend(Blex::SocketAddress const &connectto, std::string const &clientname);

        virtual ~TCPFrontend();

        /** Establish a new remote connection to the database (without greeting). This function
            needs to be overriden to provide an actual implementation
            @return New, fresh remote connection
        */
        virtual TCPConnection * NewConnection(bool *isfresh);

        /** Starts a new transaction connection
            @param clientname Name that identifies this client (used for database logging). If "", the default client name is used.
        */
        TransactConnection * BeginTransactConnection(std::string const &clientname);

        /** Drop reference to the metadata */
        void DropMetadataRef(Client::CachedMetadata *metadata);

        void DoHandshake(TCPConnection *conn);

        void ReturnMyConnection(TCPConnection *conn);

        std::string const &GetDefaultClientName() const { return defaultclientname; }

        private:
        /// Default client name
        std::string const defaultclientname;

        TCPConnection * PopCachedConn();
        struct Data
        {
                inline Data() : overridden_key(false) { }

                ///Connection cache
                std::vector<TCPConnection*> cached_connections;
                /// Is the key overridden?
                bool overridden_key;
                ///Connection key
                std::vector<uint8_t> securekey;
        };
        typedef Blex::InterlockedData<Data,Blex::Mutex> LockedData;

        LockedData data;

        Blex::SocketAddress const serveraddress;

        friend class TCPConnection;

        /// Cache for metadata
        struct SharedData
        {
                inline SharedData() : lastmetadata(0) {}

                ///Last version of the metadata (0 if none yet)
                Client::CachedMetadata *lastmetadata;
        };

        typedef Blex::InterlockedData<SharedData,Blex::Mutex> LockedSharedData;
        LockedSharedData shareddata;

        /** Establishes a new remote connection, and greets the server
            @param greeting IO buffer containing the greeting RPC (typically version numbers, client name, etc.)
            @return New remote connection (or throw if fails)
        */
        TCPConnection * EstablishConnection(IOBuffer *greeting);

        friend class TransactConnection;
};

} //end namespace Database

#endif /* sentry */
