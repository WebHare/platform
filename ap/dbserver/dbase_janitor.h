#ifndef blex_webhare_dbase_dbase_willie
#define blex_webhare_dbase_dbase_willie

#include <ctime>
#include <blex/threads.h>
#include <ap/libwebhare/dbase.h>
#include <ap/dbserver/dbase_diskio.h>

namespace Database
{

class RawDatabase;
class Backend;

struct WillieState
{
        unsigned numhints;
        Blex::DateTime waituntil;
        std::string nexttask;
        unsigned maxwait;
};

/** Willie, the database janitor, runs in a separate thread and performs
    regular maintenance on the database files, which mostly consists of
    cleaning up old records, blobs and transactions. Although the database
    backend is capable of running without a clean-up thread, it would grow
    without bounds and soonly grow too huge to manage, or worse: it could run
    out of available transaction IDs.

    On the surface, Groundskeeper Willie is a surly, gruff, hot-tempered sort
    of a fella, and what you see is what you get. As far as this shaggy-haired,
    thickly-accented Scotsman is concerned, manners are for bath-taking,
    underpants-wearing, lily-huggers. Willie would rather wrestle a wild Alaskan
    timber wolf than set down to a high tea. At the faintest sign of trouble,
    Willie rips off his shirt and hurls his rippling muscular body into the
    fray. Crediting his remarkable build in part to his diet, Willie vigorously
    promotes the eating of haggis.

    While Willie regards Principal Skinner as nothing more than a "silk-wearin'
    croquet-playin' buttercup," he takes pride in performing the tasks Skinner
    sets for him. In addition to his regular groundskeeping at Springfield
    Elementary, these include chasing stray dogs through the air vents,
    watering down the orange drink for extra profits at school functions, and
    substitute-teaching French class in his own sensitive way: "Bonjour, you
    cheese-eatin' surrender-monkeys."

    Willie's personal life is as rocky and desolate as his native land. While
    it is true that his was once engaged to magical British nanny, Shary
    Bobbins, she dumped him immediately when her eyesight returned. Since then,
    he has spent the bulk of his private time secretly videotaping couples in
    their cars. */

class Willie
{
    public:
        typedef std::vector<ColumnId> ColumnList;
        typedef std::pair<TableId, ColumnList> TableColumnPair;

        ///Assign a backend to the janitor
        Willie(RawDatabase &_rawdb, Backend &_backend, unsigned _janitor_maxwait);

        ///Willie destructor
        ~Willie();

        ///Signal the janitor thread to stop its thread and exit ThreadCode()
        void Stop();

        ///Create a list of tables and columns to destroy
        void DiscoverDestroyableTables();

        ///Add a hint for a section that could use a good cleaning
        void HintSectionsCleaning(unsigned const *sections, unsigned count);

        void GetWillieState(WillieState *state);

        void SetWillieMaxWait(unsigned maxwait);

    private:
        ///Next janitor task
        enum Chores
        {
                ///Cleanup permanent transaction id's
                InitCleanup,
                ///We are intending to switch transaction ranges
                RangeSwitch,
                ///We are waiting for the transaction range switch to be complete
                RangeSwitchComplete,
                ///Clean up deleted tables and columns
                CleanupTablesColumns
        };

        /// Locked administration data, used for communication
        struct Admin
        {
                inline Admin() : abortflag(false), skipnextchorewait(false) {}

                /// Set to true when janitor should abort
                bool abortflag;

                /// List of sections that need cleaning
                std::set< unsigned > section_clean_hints;

                /// Time until which we're waiting
                Blex::DateTime waituntil;

                /// Next task to execute
                std::string nexttask;

                /// If true, skip the wait for the next chore
                bool skipnextchorewait;

                ///Maximum time the janitor may wait between tasks. Decreased to allow 'Busy' or 'Insane' janitors
                unsigned maxwait;

                bool HaveImmediateChore() const { return !section_clean_hints.empty(); }
        };

#ifdef DEBUG
        typedef Blex::InterlockedData<Admin,Blex::DebugConditionMutex> LockedAdmin;
#else
        typedef Blex::InterlockedData<Admin,Blex::ConditionMutex> LockedAdmin;
#endif

        ///Janitor main code
        void ThreadCode();

        void DoRangeSwitch();
        void DoRangeSwitchComplete();
        void DoCleanupTablesColumns();
        void DoFullFlush();

        void InitDatabaseCleanup();
        void DatabaseCleanup();
        bool ColumnsCleanup();
        bool ColumnCleanup(TableId to_clean, ColumnList const &columns);
        bool ClearColumnMetadata(BackendTransaction &trans, TableId tableid, ColumnId columnid);


        void DestroyHintedRecords(std::vector< uint8_t > *currentblobdata);
        void DoImmediateChores();

        /// Set the file modification timestamps to now for all files that are opened (except for the index)
        void DoSetFileTimeStamps();

        /// Flush unused sections, free them if necessary
        void GenerationalCleanupUnusedSections();

        unsigned GetMaxWait(LockedAdmin::ReadRef const &lock);
        unsigned GetMaxWait(LockedAdmin::WriteRef &lock);

        /** Willy wait for a few seconds, while watching the abort flag
         *  @param seconds Number of seconds to wait
         *  @param nexttask Next task that will be executed
         */
        void Delay(unsigned seconds, std::string const &nexttask);

        /** Mark all blobs in a list of records as used
            @param tabledef Table definition of all the records
            @param recs List of records to look at
            @param currentblobdata Blob data
        */
        void MarkUsedBlobs(DatabaseLocker &db_locker, TableDef const *tabledef, std::vector< RecordId > const &recs, std::vector< uint8_t > *currentblobdata);

        ///Administration and communication structure
        LockedAdmin admin;

        ///When will we execute the next task?
        Blex::DateTime next_time;

        ///Next task
        Chores next_chore;

        ///When will we execute the next task?
        Blex::DateTime next_section_clean;

        ///When will we execute database/index flush?
        Blex::DateTime next_full_flush;

        ///Did we abandon the low transaction range?
        RangeId abandoned_range;

        ///Columns to destroy during the next 'destroy' run
        std::vector<TableColumnPair> columns_to_destroy;

        RawDatabase &rawdb;
        Backend &backend;
        Blex::Thread threadrunner;
        uint32_t volatile_abortflag;
};


}

#endif
