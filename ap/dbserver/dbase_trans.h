#ifndef blex_webhare_dbase_dbase_trans
#define blex_webhare_dbase_dbase_trans

#include <blex/threads.h>
#include <blex/mmapfile.h>
#include <blex/bitmanip.h>
#include "dbase_types.h"

namespace Database
{
//Declared classes
class TransStateMgr;
class IdentifiedTrans;

typedef unsigned RangeId;

/** Transaction log manager
*/
class TransStateMgr
{
        public:
        enum TransStatus
        {
                ///Transaction is still running
                Busy=0,
                ///Transaction has been committed for this transaction
                LocalCommitted,
                ///Transaction has been rolled back to this transaction
                LocalRolledBack,
                ///Transaction has been committed for *any* running transaction
                GlobalCommitted,
                ///Transaction has been rolled back for *any* running transaction
                GlobalRolledBack
        };

        ///Data about a transaction
        struct TransData
        {
                explicit TransData(TransId _id)
                : id(_id), committable(true), active(true), refcount(1)
                {
                }

                ///The id of the transaction
                TransId id;
                ///Is this transaction still running?
                bool committable;
                ///Does this transaction have an associated IdentifiedTrans?
                bool active;
                ///How many other transactions still depend on this transaction's data remaining vailable?
                unsigned refcount;

                ///Transactions that have already unregistered, but are waiting for this one to be deleted to be marked permanent
                std::vector< TransData * > already_finished;
        };

        typedef std::list<TransData> TransPointers;

        /// Number of ranges
        static const unsigned        RangesCount        = 4;

        /// Header pos 0, 4 bytes: Translog version id
        static const unsigned        HeaderVersionId    = 0;
        /// Header pos 4, 4 bytes x 4: last ID per each of the 4 ranges
        static const unsigned        HeaderLastTransactionIds = 4;
        /// Header pos 20, 1 bytes: id of current range
        static const unsigned        HeaderCurrentRange = 20;

        static const unsigned        BlockSize          = 4096;
        static const unsigned        NumHeaderBlocks    = 1;
        static const unsigned        HeaderSize         = NumHeaderBlocks*BlockSize;
        static const unsigned        TransPerBlock      = BlockSize * 8;
        static const unsigned        Version            = 3; //version of the transaction log system

        static const TransId         AlwaysCommitted    = 0;
        static const TransId         NeverCommitted     = 0xFFFFFFFFUL;

        static const TransId         RangeSize          = 0x40000000UL; // Must be power of 2!
        static const TransId         RangeMask          = RangeSize - 1;

        /// Returns first transaction id in range
        static inline TransId GetFirstTransIdInRange(RangeId range) { return RangeSize * range; }
        /// Returns last transaction id in range
        static inline TransId GetLastTransIdInRange(RangeId range) { return RangeSize * range + RangeMask; }
        /// Returns range in which a transaction lies
        static inline RangeId GetRangeFromTransId(TransId trans) { return trans / RangeSize; }

        TransStateMgr(const std::string &folder, bool new_database, bool disallow_cleaning, bool sync_enabled);

        /** Check the status of a transaction
            @param transid Id of the transaction to check the status for
            @param equivalent_id If not 0, will be filled with the id of an equivalent transaction;
                a transaction that will always return the same status as @a transid. If not the
                same as @a transid, it is recommended that the id is replaced
            @return Status of the transaction with id @a transid
        */
        TransStatus GetStatus(TransId transid, TransId *equivalent_id);

        /// Switch the transaction range we're using to the next range
        void SwitchToNextTransactionRange();

        /// Returns if a transaction range is active (cleaning up impossible)
        bool IsRangeUsed(RangeId range) const;

        /// Returns range in which new transactions will be allotted a transaction id
        RangeId GetCurrentRange() const;

        /** Clear a range
            @param range Range to clear */
        void ClearRange(RangeId range);

        /** Get the page on which a specific transaction ID should be */
        static unsigned GetPage(TransId trans)
        {
                RangeId range = GetRangeFromTransId(trans);
                return ((trans & RangeMask) / TransPerBlock) * RangesCount + range + NumHeaderBlocks;
        }

        /** Get the bit# on our page where a specific transaction ID should be */
        static unsigned GetBitNumber(TransId trans)
        {
                return trans % TransPerBlock;
        }

        /** Update the file modification time of the translog file */
        void UpdateFileTimeStamp();

        /** Returns whether a record is permanently invisible (can't be seen
            by a normal transaction. Watch out for chase-locks; these aren't
            checked here!
            @param inserter Inserter transaction
            @param expirer Expirer transaction
        */
        bool IsRecordPermanentlyInvisible(TransId inserter, TransId expirer);

        /** Are we allowed to clean the database */
        inline bool IsCleaningAllowed() const { return disallow_cleaning == false; }

        /// Returns whether the transaction range has almost been exhausted
        bool IsTransactionRangeAlmostExhausted() const;

    private:
        /** Transaction log data that may be concurrently accessed */
        struct LogData
        {
                /** Construct our synchronized data, and open a transaction
                    log file in the specified folder */
                LogData();

                /** Close the transaction log file, and delete any remaining
                    transaction structures. */
                ~LogData() throw();

                /** Get the address of a specific page */
                Blex::IndependentBitmapType* GetPageAddress(unsigned page)
                {
                        return transmap + page * BlockSize;
                }
                Blex::IndependentBitmapType const* GetPageAddress(unsigned page) const
                {
                        return transmap + page * BlockSize;
                }

                /** Returns the last used transaction from a range
                    @param Range to check */
                TransId GetLast(RangeId range) const
                {
                        return Blex::getu32lsb(transmap + HeaderLastTransactionIds + 4*range);
                }

                /** Sets the last used transaction from a range
                    @param Range to check */
                void PutLast(RangeId range, TransId trans) const
                {
                        return Blex::putu32lsb(transmap + HeaderLastTransactionIds + 4*range, trans);
                }

                /** Get the lowest active transaction
                    @param range Range to return the lowest active transaction for */
                TransId GetLowestReferred(RangeId range) const
                {
                        return lowest_referred_id[range];
                }

                /** Is a transaction still running?
                    @param trans Id of the transaction to check
                */
                bool IsCommittable(TransId trans) const;

                /** IS a transaction still active (is there a indentifiedtrans pointing to it)
                    @param trans Id of the transaction to check
                */
                bool IsActive(TransId trans) const;

                void Init(const std::string &folder, bool new_database, bool sync_enabled);

                /** Register and setup a newly created transaction structure.
                    Set up its neighbour-transaction members and add it to the running list */
                void Register(IdentifiedTrans *trans, bool client_trans);

                /** Unregister a transaction structure. This needs to be done
                    just before deleting the transaction
                    @param trans Transaction to remove */
                void Unregister(IdentifiedTrans *trans);

                /** Deletes a unregistered transaction's data */
                void DeleteTransData(TransData *trans);

                /** Finish a transaction, and store its state
                    @param transid Transaction to finish
                    @param commit True to commit, false to roll back */
                void SetFinished(TransId transid, bool commit);

                /// Switch the transaction range we're using
                void SwitchToNextTransactionRange();

                /// Test if a given range is in use
                bool IsRangeUsed(RangeId range) const;

                /// Test whether only the current range is in use
                bool IsTransactionReferred(TransId trans) const;

                /// Returns range in which new transactions will be allotted a transaction id
                RangeId GetCurrentRange() const;

                /** Clear a range
                    @param high_range True to clear the high range */
                void ClearRange(RangeId range);

                /** Update the file modification time of the translog file */
                void UpdateFileTimeStamp();

                /** Returns whether the visibility returned by an inserter and an expirer will always return the same visibility
                    queries from an existing IdentifiedTrans (and is non-trivial, one of inserter and deleter must be
                    a real transid, not AlwaysCommitted or NeverCommitted)
                    @param inserter Inserting transaction
                    @param expirer Expiring transaction
                    @return Returns true if the status of the two transactions is always the same.
                */
                bool IsVisibilityNonTrivialPermanent(TransId inserter, TransId expirer) const;

                /// Returns whether the transaction range has almost been exhausted
                bool IsTransactionRangeAlmostExhausted() const;

            private:
                /** Extend size of transaction log */
                void ExtendLogSize(unsigned requested_page);
                /** Unreserve any reserved transactions */
                void Unreserve();
                /** Reserve new transaction ids */
                void Reserve();

                ///The highest unused transaction IDs
                TransId next_unused_id;

                ///The last reserved transaction ID
                TransId last_reserved_id;

                /** List of currently referenced and running transactions  */
                TransPointers referenced;

                ///The lowest referred transaction ID per range
                TransId lowest_referred_id[RangesCount];

                ///Actual transaction log file
                std::unique_ptr<Blex::MmapFile> logfile;

                ///Number of pages in our transaction log file
                unsigned numpages;

                ///Actual transaction log data
                Blex::IndependentBitmapType *transmap;

                bool sync_enabled;
        };

        bool IsParallelTransaction(TransId trans);

#ifdef DEBUG
        typedef Blex::InterlockedData<LogData, Blex::DebugMutex> Log;
#else
        typedef Blex::InterlockedData<LogData, Blex::Mutex> Log;
#endif
        Log log;

        ///Do we disallow cleaning (no transaction is permanent). Used for recovery mode and nojanitor
        bool disallow_cleaning;

        ///Enable all syncs
        bool const sync_enabled;

        ///IdentifiedTrans needs to eb able to register with us
        friend class IdentifiedTrans;

        TransStateMgr(TransStateMgr const &) = delete;
        TransStateMgr& operator=(TransStateMgr const &) = delete;
};

/** Identified transaction base class. All transactions must be based on this
    class to be able to receive a transaction ID. */
class IdentifiedTrans
{
    public:
        /** Construct a transaction and assign it an unused transaction ID */
        IdentifiedTrans(TransStateMgr &_trans_mgr, bool _client_trans);

        /** Destroy this transaction. If the transaction has not been written
            to yet, it's transaction ID is made available for use again.
            Otherwise, the transaction remains in a rolled back state. */
        ~IdentifiedTrans();

        /** Get the transactions current ID */
        inline TransId GetTransId() const
        {
                return this_trans_id;
        }

        /** Check if a transaction is visible to our transaction
            @param check_trans_id Transaction whose status to check
            @param showmode Which database view to use when scanning
            @return true if the transaction is committed and visible to us*/
        TransStateMgr::TransStatus GetTransVisibility(TransId check_trans_id,ShowMode showmode);

        /** Check if a record is visible to our transaction. Also calculates the equivalent transaction ids.
            It is recommended to replace the old expirer and inserter with the new values.
            @param inserter Current inserter
            @param expirer Current expirer
            @param new_inserter Pointer to place where equivalent expirer will be placed
            @param new_expirer Current expirer
            @param showmode Mode for which to determine visibility
            @return Visibility of the record in the current context */
        bool IsRecordVisible(TransId inserter, TransId expirer, TransId *new_inserter, TransId *new_expirer, ShowMode showmode) const;

        static void ThrowWriteWhileNotCommittable();

        /** Signal that we will write using this transaction FIXME: throw if already rolled back */
        void PrepareForWrite()
        {
                if (!committable)
                    ThrowWriteWhileNotCommittable();
                data_written=true;
        }

        /** Has this transaction written any data? */
        bool HasWritten() const
        {
                return data_written;
        }

        /** Is this transaction still committable? */
        bool IsCommittable() const
        {
                return committable;
        }

        /** Mark this transaction as committed in the log file. This should
            only be done after all checks are performed, as this action cannot
            be reversed. This command is changed in a rollback if the transaction
            hasn't been written to yet */
        void MarkTransactionCommitted();

        /** Marks the transaction as rolled back in the log file. This action
            cannot be reversed, or followed by a commit
        */
        void MarkTransactionRolledBack();

    private:

        /// Returns whether check_trans_id is a parallel transaction from the view of this transaction
        bool IsParallelTransaction(TransId check_trans_id) const;

        /// Returns the status of a transaction for a given showmode, and optional an id of an equivalent transaction
        TransStateMgr::TransStatus GetTransStatus(TransId check_trans_id, TransId *equivalent_id, ShowMode showmode) const;

        ///Are we still committable?
        bool committable;

        ///A flag whether this transaction has written any data yet
        bool data_written;

        ///The transaction manager to which we registered
        TransStateMgr &trans_mgr;

        ///Our unique transaction id
        TransId this_trans_id;

        /** A list of all transactions that were running at the time our
            transaction started and can thus never be considered committed.
            This list is sorted. */
        std::vector< TransId > earlier_running;

        /// Whether this is a client transaction
        bool client_trans;

        ///We are just TransStateMgr's object
        friend struct TransStateMgr::LogData;
};

}

namespace Blex
{
template <> void AppendAnyToString(Database::TransStateMgr::TransStatus const &in, std::string *appended_string);
}

#endif
