#ifndef blex_webhare_shared_dbase_backend
#define blex_webhare_shared_dbase_backend

#include "dbase_types.h"
#include "dbase_index_frontend.h"
#include "dbase_diskio.h"
#include "dbase_meta.h"
#include "dbase_consistency.h"
#include "scanlocate.h"
#include "lockmanager.h"

namespace Database
{

namespace Index
{
class System;
}

class BackendTransaction;
class BackendTransactionRef;
class Backend;
//class TransBackendInterface;
class Willie;
struct WillieState;

class AutoSeqManager
{
        public:
        AutoSeqManager();
        ~AutoSeqManager();

        AutoseqTop *GetAutoseq(TableId tableid, ColumnId columnid, int32_t initialvalue);

        private:
        struct AutoSeq
        {
                TableId tableid;
                ColumnId columnid;
                std::shared_ptr<AutoseqTop> auto_sequencer;
        };

        struct List
        {
                std::vector<AutoSeq> autoseqs;
        };
#ifdef DEBUG
        typedef Blex::InterlockedData<List,Blex::DebugMutex> LockedList;
#else
        typedef Blex::InterlockedData<List,Blex::Mutex> LockedList;
#endif
        LockedList list;
};


/** The Backend */
class Backend
{
        public:
        struct TransactionInfo
        {
                public:
                TransactionInfo();

                TransId transid;
                std::string username;
                std::string source;
                std::string client;
                std::string transstage;
                std::string currentrpc;
                std::string rpcinfo;
                unsigned refcount;
                bool isfinished;
                Blex::DateTime started;
                TransId waitingfor; // Not used within backend, only for external info
        };

        struct QueryInfo
        {
                public:
                QueryInfo() : id(0), transid(0), sentrows(0), time(0) {};

                uint64_t id;
                TransId transid;
                Blex::DateTime starttime;
                std::string plan;
                std::string origin;
                uint32_t sentrows;
                uint32_t time;
        };

        /** Open a database, creating it if necessary. Throws an exception
            on open error
            @param folder Directory containing the database */
        Backend(const std::string &basefolder,
                const std::string &recordfolder,
                const std::string &indexfolder,
                         const Plugins &plugins,
                         unsigned janitor_maxwait,
                         bool new_database,
                         bool recovery_mode,
                         bool no_janitor,
                         bool save_deleted_blobs,
                         bool no_index,
                         bool sync_enabled);

        /** Closes a database, performs necessary cleanup.
            Closing may never fail or cause problems, because those problems
            should have been detected during transaction commits. */
        ~Backend();

        /** Start the backend. Invokes metadata registration etc */
        void Open();

        /** Closes the backend operation. Closing may fail to perform a proper
            shutdown, but that may never cause problems, because those problems
            should have been detected during transaction commits. */
        void Close();

        /** Setup a new transaction for the specified connection
            @param login User opening the transaction
            @param password Password for this user account
            @param is_system For system transactions (like backup, will not get webhare extensions)
            @param full_db Transaction has full database rights
            @return The transcation structure. Will never return NULL */
        BackendTransactionRef BeginTransaction(const std::string &login,
                                                      const std::string &password,
                                                      const std::string &source,
                                                      const std::string &client);

        /** Prepares a transaction for a commit (executes pre-commit checks) DO NOT WRITE
            TO THIS TRANSACTION AFTER CALLING THIS FUNCTION // FIXME: physically prevent writes to transaction after this point
            @param trans Transaction that is going to be committed
        */
        void PrepareTransactionForCommit(BackendTransaction *trans);

        /** End a running transaction, free its resources,
            and cause it to commit or rollback. The final clearing of the
            transaction structures is done using EndTransaction
            @param trans Transaction to cease
            @param commit True to commit the transaction, false to roll it back */
        void FinishTransaction(BackendTransaction *trans,bool commit);

        /** Get access to the metadata manager */
        MetadataManager& GetMetadataManager() { return *metamgr; }

        //FIXME: Ugly hack to allow the janitor to kill records from both index and us..
        void JanitorDestroyRecord(DatabaseLocker &db_locker, ObjectId origtableid, RecordId block, Blex::SectionUpdateHistory &history/*, bool inform_index_too*/);

        /** Get the transaction  context registrator */
        Blex::ContextRegistrator& GetTransRegistrator() { return trans_registrator; }

        /** Get the blob manager */
        BlobManager& GetBlobMgr() { return rawdb.GetBlobMgr(); }

        /** Get the transaction log */
        TransStateMgr& GetTransLog() { return rawdb.GetTransLog(); }

        void GenerateChallenge(uint8_t *store);

        uint32_t WriteNewRecord(IdentifiedTrans &trans, TableDef const &table, Record rec, RecordId locationhint, bool force_new_section, Blex::SectionUpdateHistory &commits);
        void RegisterUpdate(TableId tableid, RecordId origblock,RecordId newblock, Blex::SectionUpdateHistory &commits);

        std::pair<bool, RecordId> TryExpireRecord(IdentifiedTrans &trans, TableId tableid, RecordId recblock, Blex::SectionUpdateHistory &commits, bool must_signal, bool register_waits);
        void UnexpireRecord(IdentifiedTrans &trans, TableId tableid, RecordId recblock, Blex::SectionUpdateHistory &commits);
        RecordId FindAfterCommitVersion(IdentifiedTrans &trans, TableId tableid, RecordId recblock);

        //FIXME: Private?
        const Plugins &plugins;

        LockManager lockmanager;

        Index::System* GetIndexSystem()
        { return indexsystem.get(); }

        /* ADDME: efficiency? */
        void ExportTransactionInfo(std::vector<TransactionInfo> *receiver);
        void ExportQueryInfo(std::vector< QueryInfo > *receiver);

        void UpdateFileTimeStamps();
        void GenerationalCleanupUnusedSections(volatile uint32_t *abortflag);

        inline bool IsInRecoveryMode() const { return recovery_mode; }

        void SetTransactionInfoClientName(BackendTransaction *trans, std::string const &new_name);
        void SetTransactionInfoTransStage(BackendTransaction *trans, const char *transstage);
        void SetTransactionInfoCurrentRPC(BackendTransaction *trans, std::string const &currentrpc);
        void SetTransactionInfoRPCInfo(BackendTransaction *trans, std::string const &rpcinfo);
        uint64_t SetTransactionInfoRPCQuery(BackendTransaction *trans, QueryInfo &queryinfo);
        void ModifyTransactionInfoQueryData(uint64_t statsqueryid, uint32_t sentrows, uint32_t msecs);

        void GetWillieState(WillieState *williestate);
        void SetWillieMaxWait(unsigned maxwait);

        bool GetParamRPCInfo() { return LockedConfig::WriteRef(config)->rpcinfo; }
        void SetParamRPCInfo(bool newval);

        //FIXME: Private?
        RawDatabase rawdb;

        private:

        void IncTransRef(BackendTransaction *trans);
        void DecTransRef(BackendTransaction *trans);

        /// Called when the raw database sees a section that needs cleaning
        void SectionsCleanHint(unsigned const *sections, unsigned count);

        //FIXME: proper metadata protection
        typedef std::map<BackendTransaction*, TransactionInfo> TransMap;
        TransMap translist;
        Blex::Mutex transrefmutex;

        AutoSeqManager autoseq;

        /** The indexing system */
        std::unique_ptr<Index::System> indexsystem;

        std::unique_ptr<MetadataManager> metamgr;

        /** The janitor thread */
        std::unique_ptr<Willie> janitor;

        /** The Commit lock, needed to verify reference */
        Blex::Mutex commitmutex;

        /** The open lock, needed to synchronize transaction starts with metadata updates */
        Blex::Mutex openmutex;

        /** Context registration for transactions */
        Blex::ContextRegistrator trans_registrator;

        std::string const tempdir;

        bool const no_janitor;
        unsigned const janitor_maxwait; // initial maxwait
        bool const recovery_mode;
        bool const sync_enabled;

        friend class Plugins;
        //friend class TransBackendInterface;

        struct ChallengeBuffer
        {
                uint8_t challengebytes[1024];
                unsigned seqcount;
        };
        typedef Blex::InterlockedData<ChallengeBuffer, Blex::Mutex> LockedChallengeBuffer;
        LockedChallengeBuffer challengebuffer;

        struct Config
        {
                Config() : rpcinfo(false) { }
                bool rpcinfo;
        };
        typedef Blex::InterlockedData<Config, Blex::Mutex> LockedConfig;
        LockedConfig config;

        struct StatsData
        {
                StatsData() : queryidcounter(0) {}

                uint64_t queryidcounter;
                std::map< uint64_t, QueryInfo > queries;
        };
        typedef Blex::InterlockedData< StatsData, Blex::Mutex > LockedStatsData;
        LockedStatsData statsdata;

        Blex::DateTime startuptime;

        Backend(Backend const &) = delete;
        Backend& operator=(Backend const &) = delete;

        friend class BackendTransactionRef;
};

class BackendTransactionRef
{
    private:
        BackendTransaction *trans;

    public:
        inline BackendTransactionRef() : trans(0) {}
        BackendTransactionRef(BackendTransaction *_trans);
        BackendTransactionRef(BackendTransactionRef const &rhs);
        ~BackendTransactionRef();

        void reset(BackendTransaction *_trans = 0);
        void swap(BackendTransactionRef &rhs);

        inline BackendTransaction * operator->() { return trans; }
        inline BackendTransaction const * operator->() const { return trans; }
        inline BackendTransaction & operator*() { return *trans; }
        inline BackendTransaction const & operator*() const { return *trans; }

        inline BackendTransaction * get() { return trans; }
        inline BackendTransaction const * get() const { return trans; }

        BackendTransactionRef & operator=(BackendTransactionRef const &rhs);
};

/** Class for controlling connection parameters from the sql commands
*/
class ConnectionControl
{
    public:
        virtual ~ConnectionControl();
        virtual void SetTransactionClientName(std::string const &name) = 0;
};

} // End of namespace Database

#endif
