#ifndef blex_webhare_dbase_dbase_types
#define blex_webhare_dbase_dbase_types

#include "../libwebhare/dbase.h"
#include <map>
#include <ostream>
#include <string>
#include <blex/context.h>

namespace Database
{

//Global forward definitions
class BackendTransaction;       //dbase_tranasction
//class TransView;                //dbase_tranasction
class CellSender;               //dbase_rpcserver
class Metadata;                 //dbase_meta
class RawTable;                 //dbase_diskio
class TableDef;                 //dbase_meta
struct TableMods;
class TempResultSet;            //resultsets

/** Maximum length of any database name */
const unsigned MaxNameLen = 64;

/** A recordnumber in the database, referring to individual records in a database */
typedef uint32_t RecordId;

/** A transaction ID */
typedef uint32_t TransId;

///The record _before_ the first possible record (needed for ranges)
const RecordId LimitLowestRecordId = 0;
///The record _after_ the last possible record (needed for ranges)
const RecordId LimitHighestRecordId = 0xFFFFFFFF;

inline bool TypeIsDynamic(ColumnTypes type)
{ return type >= BaseDynamicType; }

///Showing mode for scans
enum ShowMode
{
        /** Show the database state as this transaction would see it (normal scope),
            considering access checks */
        ShowNormal,
        /** Like ShowNormal, but include records that the client isn't
            allowed to see due to access checks */
        ShowNormalSkipAccess,
        /** Show the database as it would appear if the current transaction
            committed now (don't filter the committed transactions that
            started before us), not considering the access checks */
        ShowAfterCommit
};

/// Types of metadata objects
namespace MetaObjectType
{
enum _type
{
        Root = 0,       ///< The top level metadata root
        Schema = 1,     ///< Designates a schema
        Table  = 2,     ///< Designates a table
        Column = 3,     ///< Designates a column
        Index  = 4      ///< Designates an index
};
} // End of namespace MetaObjectType

#ifdef DEBUG
typedef Blex::InterlockedData<int32_t, Blex::DebugMutex> AutoseqTop;
#else
typedef Blex::InterlockedData<int32_t, Blex::Mutex> AutoseqTop;
#endif

std::ostream& operator <<(std::ostream &out, SearchRelationType data);
std::ostream& operator <<(std::ostream &out, const Record &rec);
std::ostream& operator <<(std::ostream &out, const Cell &cell);

/** Check whether no cells outside a specific set of columns have been modified
    @param oldrec Original record for comparison
    @param newrec New record for comparison
    @param numcolids Number of column ids passed to this function
    @param columnids The actual column ids to allow modifications for
    @return false if any cell has been modified whose column id is not in the list of allowed column ids*/
bool HasOnlyModified(Database::Record oldrec, Database::Record newrec, unsigned numcolids, Database::ColumnId const columnids[]);

/** Is a cell, considering its type, considered to be empty or 'null' ? */
bool IsCellNull(Cell celldata, ColumnTypes celltype);

/** Are two cells, considering their type, considered to be equal ? */
bool IsCellEqual(Cell lhs, Cell rhs, ColumnTypes celltype);

/** Generic cell comparions considering their type, considered to be equal ? */
bool IsCellMatch(Cell lhs, Cell rhs, ColumnTypes coltype, SearchRelationType searchtype, bool case_sensitive);

/** Plguins offers an interface to supply plugins to the database and allows to
    register the external handlers the database requires */
class Plugins
{
        public:
        /** Record permission callback function.
            @param view Transaction backend that requested access
            @param action Type of access that was requested
            @param currentrecord Old record data (deleted rec for Delete&Update, new record for Insert)
            @param newrecord New record data (only for Insert and Update) */
        typedef void (*RecordWriteAccess)(BackendTransaction *trans, TableDef const &table,Actions action, Record oldrecord,Record newrecord);

        /** Record permission callback function.
            @param view Transaction backend that requested access
            @param rec Old record data (only for Delete and Update)
            @param accessible_columns Which columns can we access? (read access can delete columns from this list)
            @return false to completely deny the existence of the record*/
        typedef bool (*RecordReadAccess)(BackendTransaction *trans,TableDef const &table,Record rec);

        /** Internal field callback function.
            @param store Storage for the return data
            @param maxsize Maximum size for the return data
            @param view Transaction backend that requested this data
            @param recptr Record for which the data was requested
            @return Number of bytes actually stored*/
        typedef unsigned (*InternalColumn)(void *store,unsigned maxsize, BackendTransaction *trans, Record recptr);

        /** Metadata context update services. Called when metadata is updated.
            @param metadata Updated metadata
            @param keeper Keeper where new derived context can be stored in */
        typedef void (*MetadataContextUpdater)(Metadata const &metadata, Blex::ContextKeeper &keeper);

        /** Metadata context registrator, used to registrate contexts for a new metadatamanager
            @param reg ContextRegistrator where contexts may be registrated */
        typedef void (*MetadataContextRegistrator)(Blex::ContextRegistrator &reg);

        struct RAPtr
        {
                inline RAPtr(RecordReadAccess readfunc,
                             RecordWriteAccess writefunc,
                             std::string const &restrictedtable)
                  : readfunc(readfunc),
                    writefunc(writefunc),
                    restrictedtable(restrictedtable)
                {
                }

                RecordReadAccess readfunc;
                RecordWriteAccess writefunc;
                std::string restrictedtable;
//                TableId restrictedtable;
        };

        struct ICPtr
        {
                inline ICPtr(InternalColumn func,
                               std::string const &restrictedtable)
                  : func(func), restrictedtable(restrictedtable)
                {
                }
                InternalColumn func;
                std::string restrictedtable;
//                TableId restrictedtable;
        };

        /** Create a plugin object and register the internal plugins */
        Plugins();

        ~Plugins();

        /** Find a read access function by name */
        RecordReadAccess GetReadAccess(const std::string &name, std::string const &tablename) const;

        /** Find a write access function by name */
        RecordWriteAccess GetWriteAccess(const std::string &name, std::string const &tablename) const;

        /** Find an internal column function by name */
        InternalColumn GetInternalColumn(const std::string &name, std::string const &tablename) const;


        /** Register all metadata contexts with a metadata contextregistrator */
        void RegisterMetadataContexts(Blex::ContextRegistrator &reg) const;

        /** Execute metadata context updaters */
        void OnMetadataUpdate(Metadata const &metadata, Blex::ContextKeeper &keeper) const;

        /** Register an access function
            @param name Name of the access function, as it can be referred to in CREATE TABLE
            @param func The access function itself
            @param restrictedtable If non-zero, the access function may only be applied to the specified table */
        void RegisterAccessPlugin(const std::string &name,const RAPtr &recordaccess);

        /** Register an internal column function
            @param name Name of the column function, as it can be referred to in CREATE TABLE
            @param func The column function itself
            @param restrictedtable If non-zero, the access function may only be applied to the specified table */
        void RegisterInternalPlugin(const std::string &name,const ICPtr &columnfunc );

        /** Register a metadata context registrator
            @param func The metadata context registrator function itself */
        void RegisterMetadataContextRegistrator(MetadataContextRegistrator func);

        /** Register a metadata update
            @param func The metadata update function itself */
        void RegisterMetadataContextUpdater(MetadataContextUpdater metadatacontextupdater);

        /** Returns an internal column handler that throws on evaluation */
        InternalColumn GetErrorInternalColumn() const;

        private:
        typedef std::multimap<std::string, RAPtr> AccessFuncs;

        typedef std::multimap<std::string, ICPtr> ColumnFuncs;

        typedef std::vector< MetadataContextRegistrator > MetadataContextRegistrators;

        typedef std::vector< MetadataContextUpdater > MetadataContextUpdaters;

        struct PluginData
        {
                ///A list of all Access plugins
                AccessFuncs accessfuncs;
                ///A list of all InternalColumn plugins
                ColumnFuncs columnfuncs;
                ///A list of all metadata context registrators
                MetadataContextRegistrators metadatacontextregistrators;
                ///A list of all metadata updaters
                MetadataContextUpdaters metadatacontextupdaters;
        };
#ifdef DEBUG
        typedef Blex::InterlockedData<PluginData, Blex::DebugMutex> PluginList;
#else
        typedef Blex::InterlockedData<PluginData, Blex::Mutex> PluginList;
#endif
        /** Find an access function by name */
        const RAPtr* FindAccessFunc(const std::string &name,
                                             std::string const &tablename) const;

        /** Find an internal column function by name */
        const ICPtr* FindColumnFunc(const std::string &name,
                                             std::string const &tablename) const;

        PluginList plugins;
};

namespace Index {

enum StorageType
{
        ///Store this cell as raw data (allows ordered search of Text, Boolean. allows equality search of any other type)
        StoreRaw,
        ///Store this cell in uppercase (allows case-insensitive ordered Text searches. allows equality search for plain Text)
        StoreUppercase,
        ///Store this cell as a signed integer (allows ordered search of Integer, allows further composition of an index)
        StoreS32,
        ///Store this cell as a date time
        StoreDateTime
};

const unsigned MaxCellsPerIndex = 4;

/** Descriptor, describes visible properties of an index. */
struct Descriptor
{
        public:
        /** Table that this index operates on */
        TableId table;

        /** Number of columns indexed by this index (1 to MaxCellsPerIndex) */
        uint32_t num_indexed_columns;

        /** Columns stored in this index */
        ColumnId columns[MaxCellsPerIndex];

        /** Store method per columns */
        StorageType storage[MaxCellsPerIndex];

        /** True column type per column */
        ColumnTypes coltype[MaxCellsPerIndex];

        /** Length of data to store per column */
        unsigned storesize[MaxCellsPerIndex];

        /** Whether to ignore records when one of the stored columns is NULL */
        bool nonullstores;

        /** Read a descriptor from a file (throw a Database::Exception on failure)*/
        void ReadFromStream(Blex::Stream &str);

        /** Write a descriptor to a file (throw a Database::Exception on failure)*/
        void WriteToStream(Blex::Stream &str);

        inline bool operator==(const struct Descriptor &rhs) const
        {
                return num_indexed_columns == rhs.num_indexed_columns
                       && table == rhs.table
                       && nonullstores == rhs.nonullstores
                       && std::equal(columns,columns+num_indexed_columns,rhs.columns)
                       && std::equal(storage,storage+num_indexed_columns,rhs.storage)
                       && std::equal(storesize,storesize+num_indexed_columns,rhs.storesize);
        }
        inline bool operator!=(const struct Descriptor &rhs) const
        {
                return !(*this==rhs);
        }

        Descriptor();
        void Initialize(TableId _table, ColumnId _firstcolumn, StorageType _storetype, ColumnTypes _coltype, unsigned _storesize, bool _nonullstores);
        void Append(ColumnId _column, StorageType _storetype, ColumnTypes _coltype, unsigned _storesize);
        std::string GetName() const;
};
} // End of namespace Index

/** CostResults holds a number of results, and the cost to get that results */
struct CostResults
{
        /// Number of results
        double results;

        /// Cost to achieve that results (in disk-accesses)
        double cost;

        CostResults(double cost, double results)
        : results(results)
        , cost(cost)
        {
        }

        CostResults()
        : results(0)
        , cost(0)
        {
        }
};

namespace RecordOverride
{
enum _type
{
Normal =                0x00,
NormalLocked =          0x01,
ForcedVisible =         0x02,
ForcedVisibleLocked =   0x03,
Expired =               0x04,
ExpiredLocked =         0x05,
ForcedInvisible =       0x06,
NewRecord =             0x07,
IntroducedByChase =     0x08
};
} // End of namespace RecordOverride


namespace Backup
{
unsigned const FileVersion = 4U; // Increment by 4
unsigned const CompressedFlag = 1U;
unsigned const ExternalBlobFlag = 2U;

unsigned const StrBBeg = 0x47544242U;
unsigned const StrTabl = 0x5441624CU;
unsigned const StrBlob = 0x424F4C42U;
unsigned const StrRecd = 0x44434552U;
unsigned const StrBEnd = 0x4E444542U;
} //end namespace Backup

} //end namespace Database

#endif /* sentry */

