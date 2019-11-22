#ifndef blex_webhare_dbase_dbase_rpcserver
#define blex_webhare_dbase_dbase_rpcserver

#include <blex/threads.h>
#include <ap/libwebhare/dbase.h>
#include "dbase_backend.h"
#include "lockmanager.h"
#include "resultsets.h"
#include <blex/dispat.h>
#include <ap/libwebhare/whrpc_server.h>

namespace Database
{

//References
class ConnectionManager;
class BackendTransaction;
class BackendTransactionRef;
class IOBuffer;
class Backend;
class Modifications;
class Scanner2;

namespace DBTransactionType
{
/// Different types of transaction
enum Type
{
Normal=0,               ///< Normal opened transaction (not auto)
Auto,                   ///< This is an auto-transaction
Ask,                    ///< This is a transaction passed for an ask
Notification            ///< This is an already committed transaction that is read for notifications
};
} // End of namespace DBTransactionType

namespace ConnectionState
{
enum Type
{
        JustConnected,          ///< Just connected, waiting for handshake
        SentChallenge,          ///< First message received, sent the challenge
        LastChangeChallenge,    ///< First challenge-response failed, one more try left
        Ready,                  ///< Handshake complete, waiting for new transaction connection
        Approved,               ///< Transaction connection opened
        ShuttingDown
};
} // End of namespace ConnectionState


/** Cellsender. Used for sending rows by resultsets in a consistent way.
*/
class CellSender
{
    private:
        /// Number of cells in the row
        signed cellcount;

        /// IO buffer that is used for sending
        IOBuffer &iobuf;

        /// Reference to a blobuser, which is used to keep the set of acceptable blobs
        BlobUser &blobuser;

        /// Context to use when marking a blob as persistent
        void *blobcontext;

        /// Number of bytes sent
        unsigned bytessent;

        /** Sends the raw data for a specific column
            @param datalen Length of the data
            @param data The actual data
            @param columnnr External column- id of the column
        */
        void SendRaw(unsigned datalen, uint8_t const *data, uint16_t columnnr);

    public:
        /// Constructor
        CellSender(IOBuffer &_iobuf, BlobUser &_blobuser, void *_blobcontext) : cellcount(-1), iobuf(_iobuf), blobuser(_blobuser), blobcontext(_blobcontext), bytessent(0) {}
        ~CellSender();

        /** Reports the number of cells to be sent. MUST be called, before first call to SendCell
            @param count Number of cells that is going to be sent.
        */
        void ReportCellCount(unsigned count);

        /** Sends a cell
            @param cell Cell with value
            @param type Type of the data within the cell
            @param columnnr Nr of column in output
            @param blobcontext Context in which sent blobs must be registered
        */
        void SendCell(Cell const &cell, ColumnTypes type, uint16_t columnnr, void *blobcontext);

        /** Sends an integer value
            @param value Value to send
            @param columnnr Nr of column in output
        */
        void SendInteger(int32_t value, uint16_t columnnr);

        /// Returns number of bytes sent
        unsigned GetBytesSent() const { return bytessent; }
};

/** This structure contains saved security data
*/
struct TransSecurityData
{
        TransSecurityData() {}

        /// List of base roles
        std::vector< RoleId > base_roles;
};

/** Data describing a transaction in the rpcserver
*/
struct TransData
{
        /// Constructor
        TransData();

        /// Id of this transaction for the client to refer to
        unsigned external_id;

        /// Type of this transaction (normal, auto, notification)
        DBTransactionType::Type type;

        /// Backend transaction for this transaction
        BackendTransactionRef transref;

        /// Is this rpc (auto-)transaction readonly (so, must new backendtransactions be opened with readonly?)
        bool is_readonly;

        /// Is this transaction currently explicitly started
        bool is_explicitly_started;

        /// Has this transaction ever been initialized?
        bool is_initialized;

        // If a transaction is active, when was it started?
        Blex::DateTime trans_started;

        /// Username, needed for reinitialization of auto-mode transactions
        std::string username;

        /// Password, needed for reinitialization of auto-mode transactions
        std::string password;

        /// Extra base roles that need to be added
        std::vector< RoleId > extra_base_roles;

        /// Name of the client for this transaction
        std::string clientname;

        /// Saved security data (for auto-transaction restore)
        TransSecurityData saved_security_data;

        /// Timer used to time message handling
        Blex::FastTimer trans_rpctimer;

        /// Are the contents of this structure valid?
        inline bool IsValid() const { return external_id != 0; }

};

class Connection;

/** Ask task: used to implement asks to listeners
*/
class Ask : public RPCTask
{
    public:
        /// Function run to execute the task in the connection that is asked a question
        virtual RPCResponse::Type HookExecuteTask(IOBuffer *iobuf, bool *is_finished);

        /// Function run when the task has finished in the asking connection
        virtual RPCResponse::Type HookTaskFinished(IOBuffer *iobuf, bool success);

        /// Asking connection
        Connection *sender;

        /// Connection that is asked a question
        Connection *receiver;

        /// Record used to transfer the question and the reply
        WritableRecord msg;

        /// Transaction from which the question was asked
        BackendTransactionRef transref;

        /// Original security data of the transaction
        TransSecurityData original_security_data;

        /// Client name of the original transaction
        std::string clientname;

        /// Question id
        unsigned msgid;

        /// Id of the transdata that is newly created in the asked connection
        unsigned trans_external_id;
};

/** Ask task: used to implement tells to listeners
*/
class Tell : public RPCTask
{
    public:
        /// Function run to execute the task in the connection that is told something
        virtual RPCResponse::Type HookExecuteTask(IOBuffer *iobuf, bool *is_finished);

        /// Function run when the task has finished in the telling connection
        virtual RPCResponse::Type HookTaskFinished(IOBuffer *iobuf, bool success);

        /// Record used to transfer the message
        WritableRecord msg;
};

/** Ask task: used to implement sending commit notifications to listeners
*/
class Notification : public RPCTask
{
    public:
        /// Function run to execute the task in the connection that is notified
        virtual RPCResponse::Type HookExecuteTask(IOBuffer *iobuf, bool *is_finished);

        /// Function run when the task has finished in the notifying connection
        virtual RPCResponse::Type HookTaskFinished(IOBuffer *iobuf, bool success);

        /// Notified connection
        Connection *receiver;

        /// Commited transaction
        BackendTransactionRef trans;
};


/** Connection implements a connection from the client to the database, over
    which multiple transactions (normal and listening) may run
*/
class Connection : public RPCConnection
{
    public:
        // Constructor
        Connection(ConnectionManager &mgr, void *dispatcher, std::string const &connectionsource);

        /// Destructor
        virtual ~Connection();

        /// Function called when this connection is going to be used for a new incoming connection
        void HookPrepareForUse();

        /// Function called when the new incoming connection has arrived
        void HookIncomingConnection();

        /// Function called when the client has disconnected
        void HookDisconnectReceived(Blex::Dispatcher::Signals::SignalType signal);

        /** Function to be used by the caller to handle a message
            @param iobuf Input/output buffer for the database request
            @return Type of response
        */
        RPCResponse::Type HookHandleMessage(IOBuffer *iobuf);

        /// Function called when a signal is received (handles restarting of stalled operations)
        RPCResponse::Type HookSignalled(IOBuffer *iobuf);

        /// Returns whether an operation is stalled and waiting for a signal
//        bool HookWaitingForSignal() { return hooksignal; }

        /// Function called when a timeout has been received
        RPCResponse::Type HookTimeOut(IOBuffer *iobuf, bool fatal);

        /** Function to be used on the first packet from the caller
            @param iobuf Input/output buffer for the database request
        */
        void ProcessGreeting(IOBuffer *iobuf);

        /// Returns the name of the client of this connection
        std::string const & GetClientName() { return clientname; }

        /** Returns whether a transaction has notifications the client is interested in */
        bool AnyInterestingNotifications(BackendTransactionRef const &trans) const;

        /// Saves all securitydata in a transaction
        static void SaveSecurityData(BackendTransaction &trans, TransSecurityData &data);

        /// Restores  securitydata in a transaction
        static void RestoreSecurityData(BackendTransaction &trans, TransSecurityData &data, bool skip_security);

    private:
        /// Connection constructor.
//        Connection(ConnectionManager &mgr, void *dispatcher, std::string const &connectionsource);

        /// Query contains a resultset and the transaction it operates on
        struct ResultSet
        {
                inline ResultSet() : query_id(0), is_finished(false), trans(0), statsqueryid(0) {}

                /// Id of this query
                unsigned query_id;

                /// Has this resultset been finished (DBBRCEndOfQuery sent to client)
                bool is_finished;

                /// Resulset from which the results are retrieved
                std::shared_ptr< ResultSetBase > set;

                /// Transdata about the transaction this resultset was opened in.
                TransData *trans;

                /// Query id for stats
                uint64_t statsqueryid;
        };

        /// RPC handler
        struct RPC
        {
                const char *name;
                RPCResponse::Type (Connection::*func)(IOBuffer *buf, TransData *trans);
        };

        /// Get a reference to the database backend
        Backend & GetBackend();

        /** Parse version data and verify that we're compatible. Throws an
            exception if we're not compatible
            @param iobuf I/O buffer to read version data from. The read pointer
                   of this buffer will be moved.
        */
        void ReadAndCheckVersion(IOBuffer *iobuf);

        // Functions that handle resultset rpcs
        RPCResponse::Type RemoteAnswer(IOBuffer *iobuffer, TransData *trans); // For Answer and AnswerException
        RPCResponse::Type RemoteTransactionStart(IOBuffer *iobuffer, TransData *);
        RPCResponse::Type RemoteTransactionExplicitOpen(IOBuffer *iobuffer, TransData *trans);
        RPCResponse::Type RemoteTransactionCommitRollbackClose(IOBuffer *iobuffer, TransData *trans);
        RPCResponse::Type RemoteNotifyOpen(IOBuffer *iobuffer, TransData *);
        RPCResponse::Type RemoteNotifyScan(IOBuffer *iobuffer, TransData *);
        RPCResponse::Type RemoteNotifyClose(IOBuffer *iobuffer, TransData *);
        RPCResponse::Type RemoteTransactionSetRoles(IOBuffer *iobuffer, TransData *trans);
        RPCResponse::Type RemoteResultSetAdvance(IOBuffer *iobuffer, TransData *);
        RPCResponse::Type RemoteResultSetLock(IOBuffer *iobuffer, TransData *);
        RPCResponse::Type RemoteResultSetUnlock(IOBuffer *iobuffer, TransData *);
        RPCResponse::Type RemoteResultSetUpdate(IOBuffer *iobuffer, TransData *);
        RPCResponse::Type RemoteResultSetDelete(IOBuffer *iobuffer, TransData *);
        RPCResponse::Type RemoteResultSetFase2(IOBuffer *iobuffer, TransData *);
        RPCResponse::Type RemoteResultSetGetInfo(IOBuffer *iobuffer, TransData *);
        RPCResponse::Type RemoteResultSetClose(IOBuffer *iobuffer, TransData *);
        RPCResponse::Type RemoteRecordInsert(IOBuffer *iobuffer, TransData *trans);
        RPCResponse::Type RemoteScanStart(IOBuffer *iobuffer, TransData *trans);
        RPCResponse::Type RemoteScanNotificationsStart(IOBuffer *iobuffer, TransData *trans);
        RPCResponse::Type RemoteMetadataGet(IOBuffer *iobuffer, TransData *trans);
        RPCResponse::Type RemoteAutonumberGet(IOBuffer *iobuffer, TransData *trans);
        RPCResponse::Type RemoteBlobUpload(IOBuffer *iobuffer, TransData *);

        RPCResponse::Type RemoteBlobRead(IOBuffer *iobuffer, TransData *);
        RPCResponse::Type RemoteBlobMarkPersistent(IOBuffer *iobuffer, TransData *);
        RPCResponse::Type RemoteBlobDismiss(IOBuffer *iobuffer, TransData *trans);
        RPCResponse::Type RemoteSQLCommand(IOBuffer *iobuffer, TransData *trans);
        RPCResponse::Type RemoteSubscribeAsListener(IOBuffer *iobuffer, TransData *);
        RPCResponse::Type RemoteAsk(IOBuffer *iobuffer, TransData *trans);
        RPCResponse::Type RemoteTell(IOBuffer *iobuffer, TransData *trans);
        RPCResponse::Type RemoteResetConnection(IOBuffer *iobuffer, TransData *trans);
        RPCResponse::Type RemoteBeginConnection(IOBuffer *iobuffer);
        RPCResponse::Type RemoteKeepAlive(IOBuffer *iobuffer, TransData *trans);

        RPCResponse::Type HandleException(IOBuffer *iobuffer, Exception &e, unsigned trans_id);

        void LogConnectionFailure(const char *reason);

        /// Checks whether a specific blob may be accessed by this transaction
        static void CheckBlobAccessible(BlobUser *blobuser, BlobId blobid);

        ///Reset the current notify transaction
        void ResetNotifyTrans();
        ///Reset this connection structure and clear all transaction data
        void ResetConnection(bool first_time);

        /** Tries to lock a row. The response is put in the io-buffer
            @param iobuf io-buffer
            @param resultset Resultset of which a row must be locked
            @param row Number of row within resultset that has to be locked
            @return Retry when the lock is stalled due to another transaction,
                else Respond (the io-buffer then contains a valid response)
        */
        RPCResponse::Type TryLock(IOBuffer *iobuf, ResultSetBase &resultset, uint16_t row);

        /** Tries to commit a transaction. The response is put in the io-buffer.
            @param iobuf io-buffer
            @param trans Transaction to close
            @param close Must the transaction be closed after committing?
            @return Retry when the lock is stalled due to another transaction,
                else Respond (the io-buffer then contains a valid response)
        */
        RPCResponse::Type DoCommit(IOBuffer *iobuf, TransData *trans, bool close);

        /** Sends header+first block of a resultset
            @param send_info If true, immediately send the column info of the resultset
            @return Number of rows returned */
        unsigned SendResultSetStart(IOBuffer *iobuffer, ResultSet &resultset, bool send_info);

        /** Returns GetTableDefAndNotifications for a specific table and schema
            FIXME: params and return values? */
        std::pair< TableDef const *, TableMods const * > GetTableDefAndNotifications(BackendTransactionRef const &trans, std::string const &schemaname, std::string const &tablename) const;

        /** Sends resultset info to an iobuffer */
        void SendResultSetColumnInfo(IOBuffer *iobuffer, ResultSetBase &resultset);

        /** Sends an empty resultset */
        void SendEmptyResultSet(IOBuffer *iobuffer);

        /** Puts a block with rows in an IOBuffer. The current active row will be used in the block;
            if afterwards a row is active it has not been added in the block. Only Fase1 data will be
            sent
            @param buffer Buffer to use
            @param scanner Scanner to get the records from
            @param query_id Id of query (Set to 0 if query is terminated).
            @return Number of records in the sent block (0 if no row was active to start with) */
        unsigned SendBlock(IOBuffer *buffer, ResultSet &resultset);

        /** Determines block exit code (end of block / results / query)
            @return One of DBBRCEndOfBlock, DBBRCEndOfResults, DBBRCEndOfQuery */
//        uint16_t GetBlockExitCode(ResultSetBase &resultset, bool allow_direct_close, bool fase2_data_sent);

        /** Registers a new resultset, returns a query_id */
        ResultSet & RegisterResultSet(std::shared_ptr< ResultSetBase > const &resultset, TransData *trans);

        /** Get the query object for a given query-id. Does error-checking on query-id */
        ResultSet & GetResultSet(uint32_t query_id);

        /** Removes a resultset from the list of resultsets */
        void RemoveResultSet(unsigned query_id);

        /** Removes all ResultSets
            @param trans Transaction to kill sets for (0 for all)*/
        void KillAllResultSets(TransData *trans);

        /// Returns whether any resultsets are still active
        bool AnyResultSetsActive(TransData *trans);

        /** Decodes a query received in an iobuffer into a ScannerQuery object
            @param src IOBuffer with the query (read pointer at start of query data)
            @param query Query object to fill
            @param trans Transaction this query is done on (for metadata)
        */
        void DecodeQuery(IOBuffer *src, ScannerQuery &query, BackendTransaction *trans);

        /** Optimize the sending of fase2 data (if only non-dynamic are queried, send
            them immediately, so no fase2 rpc is needed)
            @param query Query object to optimize
        */
        void OptimizeFase2(ScannerQuery &query);

        /// Allocate a new transaction object
        TransData * AllocateTransaction();

        /// Return a specific transaction object by id
        TransData * GetTransaction(uint32_t trans_id, bool throw_if_not_found);

        /// Reactivates a transaction
        void ActivateTransaction(TransData *trans, bool explicit_start);

        /// Deactivate a transaction
        void DeactivateTransaction(TransData *trans);

        /// Delete a transaction
        void DeleteTransaction(TransData *trans);

        /// Returns whether any timeoutable transaction (not backup) is active
        bool AnyTimeoutableTransactionActive() const;

        /** Recalculates the timeout after the set of running transactions has changed
            @return .first Next timeout
                    .second Is this timeout fatal
        */
        std::pair< Blex::DateTime, bool > CalculateTimeouts();

        /// Sets the timeouts
        void ReSetTimeouts();

        /// Ensures a transaction exists (is not 0), throws an appropriate error if not
        void EnsureTransactionExists(TransData *trans);

        /// Ensures a transaction exists and it is open, throws an appropriate error if not
        void EnsureTransactionOpened(TransData *trans);

        /// Database manager
        ConnectionManager &mgr;

        /// Flag to enable logging of abort/commit/rollback of transactions
        bool const logtransactions;

        /// Contains a name that identifies the source of this connection
        std::string connectionsource;

        // FIXME: add a timeout if the client reacts in time (don't let the queue get too long)
        std::list< BackendTransactionRef > notification_queue;

        /// Timer used to time message handling
        Blex::FastTimer conn_rpctimer;

        /// Scratch record for 'just about anything' - tries to cut back on reallocations
        WritableRecord scratch_record;

        /// Blobuser to record all the blobs in use by the client
        BlobUser blobuser;

        /// Returns a name identifying this connection/transaction
        std::string GetConnectionName(TransData *trans);

        /// Contains a name that identifies the client of this connection
        std::string clientname;

        /// Current transaction opened for notification
        BackendTransactionRef notify_trans;

        /** Function that will be called if a signal is received. This is used to trigger operations
            that have to wait on other transactions (record locks, transaction commits). The function
            tries to re-execute the stalled operation.
            @return Response. If the response is @a Retry, the operation hs stalled again. hooksignal must contain
                a valid function then
        */
        std::function< RPCResponse::Type(IOBuffer *) > hooksignal;

        /** Whether this connection is waiting for a commit to finish
        */
        bool scheduled_commit;

        typedef std::vector< ResultSet > ResultSets;

        /// Open resultsets
        ResultSets resultsets;

        ///Stream for uploaded blobs
        std::unique_ptr< Blex::Stream > upload;
        ///ID reserved for the blob;
        BlobId uploadedfile;

        ///Get an blob stream, opening a blob if necessary
        Blex::RandomStream & GetBlobStream(BlobId blob, bool is_backup_transaction);

        ///Open blobs
        struct OpenBlob
        {
                BlobId blobid;
                std::shared_ptr< Blex::FileStream > stream;
        };

        std::vector< OpenBlob > openblobs;

        typedef std::map< unsigned, TransData > Transactions;
        Transactions transactions;

        std::map< uint32_t, Ask * > pending_asks;

        ///Notifications that listener wants to receive
        NotificationRequests notereqs;

        /// Login for listening transactions
        std::string listen_login;

        /// Password for listening transactions
        std::string listen_passwd;

        ConnectionState::Type connstate;

        friend class Ask;
        friend class Notification;
};

/** The connection manager supports RPC encoding/decoding, manages incoming
    connections, and implements the interfaces which do not affect the database
    itself (such as possible logging, and client-to-client I/O)
*/
class ConnectionManager
{
        public:
        /** Open a database, creating it if necessary. Throws Exception
            on failure
            @param folder Directory containing the database
            @param logroot Directory for logfiles
            @param logname Name for the logfile
        */
        ConnectionManager(Backend &backend, bool logtrans);

        /** Destroy the database, commit all changes, release all files */
        ~ConnectionManager() throw();

        /** Called by the constructor of ListenConnection to add us to the
            internal lists (intended for internal use only)
        */
        void RegisterListener(Connection *conn);

        /** Called by the destructor of TransactConnection to remove us from the
            internal lists (intended for internal use only)
            FIXME: WHAT?
        */
        void UnregisterConnection(Connection *conn);

        /** Inform listeners of modifications made by a committed transaction. Takes ownage
            of the transaction, deletes it when all notifications have been sent
        */
        void InformListeners(BackendTransactionRef &trans, Connection *sender);

        /** One way messaging to a listener, without waiting for confirmation
            @param name Name of the listener to send to
            @param datalen Length of the data to send to the listener
            @param data Data to send to the listener
            @return false if no listener with the specified name could be found
        */
        bool SendMsg(std::string const &name, Record data, Connection *sender);

        bool SendAsk(std::string const &name, std::unique_ptr< Ask > &ask, Connection *replyto);
        void ReceivedReply(uint32_t msgid, Record data, Connection *listener);

        /// Return backend for access to lockmanager (make private???)
        Backend & GetBackend() { return backend; }

        /** Are we allowed to commit now? If yes, return 0, otherwise return transid of transaction to wait for */
        TransId CanCommit(Connection *conn, TransId transid);
        /** Tell we are finished with our commit attempt */
        void FinishedCommit(Connection *conn, bool really_finished);

        const bool logtransactions;

        private:
        /** The database backend */
        Backend &backend;

        typedef std::vector< Connection * > Listeners;

        /** Shared data */
        struct Data
        {
                Listeners listeners;
                unsigned questioncounter;
                std::vector< std::pair< Connection *, TransId > > commitqueue;
        };
#ifdef DEBUG
        typedef Blex::InterlockedData<Data, Blex::DebugMutex> LockedData;
#else
        typedef Blex::InterlockedData<Data, Blex::Mutex> LockedData;
#endif
        LockedData connmgrdata;

        void IncreaseNotificationRef(BackendTransaction *trans);
        void DecreaseNotificationRef(BackendTransaction *trans);

        //-- the data below never changes after the database has been opened --

        friend class RemoteDatabase;
        friend class DBLoopbackDatabase;
        friend class BackendTransaction;
        friend class Connection;
        friend class DBConn;
        friend class DBRPC;

        ConnectionManager(ConnectionManager const &) = delete;
        ConnectionManager& operator=(ConnectionManager const &) = delete;
};

inline Backend& Connection::GetBackend()
{
        return mgr.backend;
}

void EncodeException(IOBuffer *store, Exception const &except, BackendTransaction *trans = 0);

class RPCServerConnControl: public ConnectionControl
{
        TransData *transdata;

    public:
        explicit RPCServerConnControl(TransData *_transdata);

        void SetTransactionClientName(std::string const &name);
};

} // End of namespace Database

namespace Blex
{
template <> void AppendAnyToString(Database::ConnectionState::Type const &in, std::string *appended_string);
}

#endif
