#ifndef blex_webhare_dbase_dbase_lockmanager
#define blex_webhare_dbase_dbase_lockmanager

#include <blex/threads.h>
#include "dbase_types.h"

namespace Database
{

class Connection;
class BackendTransaction;

/** The lockmanager is the one entity that controls (or should anyway) all
    the locks in the database, and adminitrates who is waiting on who.
    If deadlocks would occur, the lockmanager would detect them, and kill
    someone whose death would prevent the deadlock.

    Currently the lockmanager is quite dumb when preventing deadlocks, it kills
    the transaction that is the last chain in the deadlock circle. It might
    be worth while to check out which transactions is the least worthy (priority,
    number of records changed etc. )

    The lockmanager has been designed for single locks, nested locks are not
    supported.

    When a transaction has been registred to wait for another transaction, and
    that transaction commits (or rolls back), the function AsyncSignal() is called
    on the connection of that transaction (if set!). Look out, if the connection
    is not set, there is no way to resume that transaction!

    MT considerations: all public functions are multi-thread safe */
class LockManager
{
    public:
        /// Register a new transactions to track
        void RegisterTransaction(BackendTransaction *trans);

        /** Set the connection of the transaction. When called, this transaction gets under the power
            of the lockmanager to be killed */
        void SetTransactionConnection(BackendTransaction *trans, Connection *conn);

        /// Call this when transaction locks become impossible (or before trans is destroyed)
        void UnregisterTransaction(BackendTransaction *trans);

        /** Indicates that a transaction A is has tried and failed to lock a row, currently
            expired by an uncommitted transaction B. Throws an exception if this
            wait would cause a deadlock.
            @param trans The transactions that has to wait
            @param waiting_for The transactions that lockes the row.
            @param must_signal Indicates whether the locking manager must signal the connection
                   when a the transaction 'waiting_for' has finished. If not, the caller is
                   responsible for calling IndicateWaitEnd when waiting has ended */
        void IndicateWait(TransId trans, TransId waiting_for, bool must_signal, TableId tableid, RecordId recordid);

        /** Indicates that a transaction A is succeeded to lock a row, while it has previously
            failed and idicated it was waiting.
            @param trans The transactions that is not waiting anymore */
        void IndicateWaitEnd(TransId trans);

        /** Returns for which transaction this transaction is waiting, 0 for not waiting at all
            @param trans The transactions to query
        */
        TransId IsTransactionWaiting(TransId trans);

    private:
        /** Keeps all data the lockmanager needs about a transaction */
        struct Trans
        {
                /** Constructor
                    @param _trans Transaction that is described */
                Trans(BackendTransaction *_trans);

                /// Id of transaction
                TransId trans_id;

                /// Pointer to transaction
                BackendTransaction *trans;

                /// Optional pointer to connection for this transaction
                Connection *conn;

                /// Optional pointer to data for transaction this transaction is waiting for, 0 if not waiting.
                Trans *waiting_for;

                /// Indicates whether the connection may be signalled if the transaction this one waits for has finished
                bool must_signal;

                /// Less operator for ordering
                bool operator <(Trans const &rhs) const { return trans_id < rhs.trans_id; }

            private:
                /** Constructor that builds an object with only the trans_id member set, for to
                    be able to quickly find a transaction with a given id. */
                inline Trans(TransId _trans_id) : trans_id(_trans_id) {}

                /// Lockmanager is friend to be able to use the trans_id constructor
                friend class LockManager;
        };

        /** Data kept by the lock manager, is a set of all active (non-committed) transactions */
        struct Data
        {
                /// List of active (non-committed) transactions
                std::set< Trans > active_list;
        };
        typedef Blex::InterlockedData< Data, Blex::Mutex > LockedData;

        /// Data, protected by lock
        LockedData lockeddata;

        /// Finds transaction data from a transaction_id, returns 0 if not found
        Trans * Find(Data &data, TransId trans_id);
        /// Finds transaction data from a pointer to a transaction object, throws if not found
        Trans & Find(Data &data, BackendTransaction *trans);
};

} // End of namespace Database

#endif // Sentry

