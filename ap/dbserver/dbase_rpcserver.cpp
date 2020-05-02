//

#include <ap/libwebhare/allincludes.h>


#include "dbase_rpcserver.h"
#include <blex/logfile.h>
#include "dbase_transaction.h"
#include <blex/path.h>
#include <iostream>
#include "dbase_backend.h"
#include "scanlocate.h"

#ifdef DEBUG
 #include <iomanip>
#endif

//#pragma option -vi-

//Turn on this define to allow debugging of RPC network I/O
//#define IODEBUGGING
//#define IORPCDEBUGGING

#if (defined(IODEBUGGING) || defined(IORPCDEBUGGING)) && defined(DEBUG)
#include <blex/utils.h>
struct AutoTimer
{
        std::ostringstream debugdata;
        Blex::FastTimer timerlen;
        ~AutoTimer();
};
AutoTimer::~AutoTimer()
{
        timerlen.Stop();
        DEBUGPRINT(debugdata.str() << " * " << timerlen);
}
#define IODEBUG(trans, x) AutoTimer autotimer; autotimer.debugdata << GetConnectionName(trans) << ": " << x; autotimer.timerlen.Start();
#define IODEBUGONLYARG(x) x
#else
#define IODEBUG(trans, x)
#define IODEBUGONLYARG(x)
#endif
#if defined(IODEBUGGING) && defined(DEBUG)
#define IOTASKDEBUG(task, x) AutoTimer autotimer; autotimer.debugdata << (task)->GetConnectionName(0) << ": " << x; autotimer.timerlen.Start();
#define IODEBUGPRINT(x) autotimer.debugdata << x;
#define IODEBUGPRINTSO(x) DEBUGPRINT(x);
#define IODEBUGONLY(x) x
#else
#define IOTASKDEBUG(task, x) BLEX_NOOP_STATEMENT
#define IODEBUGPRINT(x) BLEX_NOOP_STATEMENT
#define IODEBUGPRINTSO(x) BLEX_NOOP_STATEMENT
#define IODEBUGONLY(x) BLEX_NOOP_STATEMENT
#endif

/* FIXMEs and ADDMEs
    - Pick the number of worker threads based upon the # of processors available
    - When Writes fail, the database should start some sort of 'recovery' mode,
      ie: locking out all transactions and attempt to remedy the problems.
    - When a transaction has failed, no more writes should be done for that
      transaction
*/

/* Timeouts:
   The RPC server has only one timeout: transaction timeout (ADDME: ask timeouts?)
   If any transaction is open, the connection will time out at the time the oldest
   transaction is one hour old (to avoid janitor stalls).
*/

namespace Database
{

/** Paranoid timeout limits */
static const bool ParanoidTimeouts = false;
/** The approx. limit for bytes sent in a fase1 block. Sending of rows is stopped
    after first row that exceeds this limit */
static const unsigned MaxBytesPerBlock = 10000;
/** Maximum number of cached open blobs */
static const unsigned BlobCacheSize = 8;
/** Maximum number of seconds a normal transaction may be open: 1 hour */
static const unsigned MaxTransactionTime =      ParanoidTimeouts ? 30 : 3600;

//--------------------------------------------------------------------------
//
// RPC / Marshalling functions
//
//--------------------------------------------------------------------------
void EncodeColumnInIObuffer(ColumnDef const &coldef,IOBuffer *outbuf)
{
        outbuf->Write<bool>(true);
        outbuf->Write(coldef.name);
        outbuf->Write<uint16_t>(coldef.column_id);
        outbuf->Write<uint32_t>(coldef.external_type);
        outbuf->Write<bool>(coldef.internal);
}

void EncodeTableInIObuffer(TableDef const &table,std::string const &schemaname, IOBuffer *outbuf)
{
        //ADDME: More efficient to send Schema names before Table names, and match on id
        outbuf->Write<bool>(true);
        outbuf->Write(schemaname);
        outbuf->Write(table.name);
        outbuf->Write<int32_t>(table.object_id);

        for (TableDef::ColumnCItr citr = table.GetColumns().begin(); citr != table.GetColumns().end(); ++citr)
          if (!citr->second.name.empty()) //skip deleted columns
            EncodeColumnInIObuffer(citr->second,outbuf);
        outbuf->Write<bool>(false); //terminate column list
}

void EncodeMetadataInIObuffer(Metadata const &metadata,IOBuffer *outbuf)
{
        outbuf->Write<Blex::DateTime>(metadata.GetStartTimeStamp());
        outbuf->Write<uint32_t>(metadata.GetVersionId());

        for (Metadata::TableCItr titr = metadata.GetTables().begin(); titr != metadata.GetTables().end(); ++titr)
        {
                ObjectDef const *schema = titr->second.parent_object;
                EncodeTableInIObuffer(titr->second, schema->name, outbuf);
        }
        outbuf->Write<bool>(false); //terminate table list

        for (Metadata::SchemaCItr sitr = metadata.GetSchemas().begin(); sitr != metadata.GetSchemas().end(); ++sitr)
        {
                outbuf->Write<bool>(true); //prefix
                outbuf->Write(sitr->second.name);
                for (PrivilegeChecker::RoleCItr ritr = metadata.Privs().GetRoles().begin(); ritr != metadata.Privs().GetRoles().end(); ++ritr)
                    if (ritr->second.schema == &sitr->second)
                    {
                            outbuf->Write<bool>(true); //prefix
                            outbuf->Write(ritr->second.role_id);
                            outbuf->Write(ritr->second.name);
                    }
                outbuf->Write<bool>(false); //terminate roles
        }
        outbuf->Write<bool>(false); //terminate scheams
}

void EncodeException(IOBuffer *store, Exception const &except, BackendTransaction */*trans*/)
{
        //Signal failure to the caller
        store->ResetForSending();
        store->Write<uint32_t>(except.errorcode);
        store->WriteBinary(strlen(except.what()), (uint8_t const *)except.what());

        store->Write(except.tablename);
        store->Write(except.columnname);
        store->Write(except.clientname);

        store->FinishForReplying(true); //exception!
}

template <> void IOBuffer::ReadIn< NotificationRequests >(NotificationRequests *out)
{
        out->requests.resize(Read<uint32_t>());

        for (unsigned i=0;i<out->requests.size();++i)
        {
                out->requests[i].schema = Read<std::string>();
                out->requests[i].table = Read<std::string>();
                out->requests[i].columns.resize(Read<uint32_t>());
                for (unsigned j=0;j<out->requests[i].columns.size();++j)
                    out->requests[i].columns[j] = Read<std::string>();
        }
}

//--------------------------------------------------------------------------
//
// DB Manager
//
//--------------------------------------------------------------------------
ConnectionManager::ConnectionManager (Backend &backend, bool logtransactions)
: logtransactions(logtransactions)
, backend(backend)
{
        DEBUGONLY(connmgrdata.SetupDebugging("connmgrdata"));

        if(ParanoidTimeouts)
             Blex::ErrStream() << "WARNING! Aggressive timeouts have been enabled, transactions may suffer disconnects";
}

ConnectionManager::~ConnectionManager() throw()
{
        //FIXME: Crash if connections are still open
}

void ConnectionManager::UnregisterConnection(Connection *conn)
{
        //Remove any questions
        IODEBUGPRINTSO("Unregister transaction " << conn->GetClientName());

        LockedData::WriteRef locked(connmgrdata);

        for (std::vector< std::pair< Connection *, TransId > >::iterator itr = locked->commitqueue.begin(); itr != locked->commitqueue.end(); ++itr)
            if (itr->first == conn)
            {
                    // This transaction is on the commit queue. Get it off!
                    bool was_running = itr == locked->commitqueue.begin();
                    locked->commitqueue.erase(itr);

                    if (was_running && !locked->commitqueue.empty())
                    {
                            IODEBUGPRINTSO("**** Tell next transaction to GO commit: " << locked->commitqueue.front().first);
                            locked->commitqueue.front().first->AsyncSignal();
                    }
                    return;
            }

        // FIXME: evaluate whether outstanding tasks are handled correctly (disregarded)
}

//--------------------------------------------------------------------------
//
// Connection class
//
//--------------------------------------------------------------------------

Connection::Connection(ConnectionManager &mgr, void *dispatcher, std::string const &connectionsource)
: RPCConnection(dispatcher)
, mgr(mgr)
, logtransactions(mgr.logtransactions)
, connectionsource(connectionsource)
, blobuser(mgr.backend.GetBlobMgr())
{
        IODEBUGPRINTSO("Created connection " << this);
        ResetConnection(true);
}


Connection::~Connection()
{
        IODEBUGPRINTSO("Destroyed connection " << this);
        ResetConnection(false);
}

void Connection::ResetConnection(bool first_time)
{
        // If we were waiting for a commit, cancel it now.
        if (!first_time && scheduled_commit)
            mgr.FinishedCommit(this, false);

        KillAllResultSets(NULL); //destroy ALL open result sets
        openblobs.clear();
        transactions.clear();
        blobuser.Reset();

        if(logtransactions)
        {
                if(!clientname.empty())
                    Blex::ErrStream() << "Connection closed: source " << clientname << " time: " << conn_rpctimer;

                conn_rpctimer = Blex::FastTimer(); //reset..
        }
        clientname.clear();
        mgr.UnregisterConnection(this);
        upload.reset();

        hooksignal = nullptr;
        scheduled_commit = false;
        connectionsource = "(unknown)";

        connstate = ConnectionState::JustConnected;

        // Disble timeouts, so the connection stays intact (for reuse and stuff)
        ReSetTimeouts();
}

void Connection::ReadAndCheckVersion(IOBuffer *iobuf)
{
        /* Note: the associated Writing code is in IOBuffer::WriteVersionData() in dbase.cpp */
         if (iobuf->Read<uint8_t>() != RequestOpcode::_max
             || iobuf->Read<uint8_t>() != ResponseOpcode::_max
             || iobuf->Read<uint8_t>() != IOBuffer::ProtRevision)
            throw Exception(ErrorProtocol,"Invalid protocol version");
}

void Connection::LogConnectionFailure(const char *reason)
{
        Blex::ErrStream() << "Refused connection from " << GetRemoteAddress() << ": " << reason;
}

void Connection::CheckBlobAccessible(BlobUser *blobuser, BlobId blobid)
{
        if (blobid != 0 && !blobuser->IsInuse(blobid))
            throw Exception(ErrorProtocol,"Accessing a blob whose existence was never known to this transaction");
}

RPCResponse::Type Connection::RemoteBeginConnection(IOBuffer *iobuf)
{
        IODEBUG(0, "BeginConnection connstate:" << Blex::AnyToString(connstate));

        connectionsource = GetRemoteAddress();

        switch (connstate)
        {
        case ConnectionState::JustConnected:
                {
                        //First verify that we accept this connection. The first packet is a dummy
                        if (iobuf->GetDataLength() != 0)
                        {
                                connstate = ConnectionState::ShuttingDown;
                                LogConnectionFailure("Incorrect database 'greeting' message");
                                throw Exception(Database::ErrorProtocol,"Invalid connection request");
                        }

                        iobuf->ResetForSending();
                        iobuf->Write<uint32_t>(1);
                        connstate = ConnectionState::SentChallenge;
                        return RPCResponse::Respond;
                }
        case ConnectionState::SentChallenge:
        case ConnectionState::LastChangeChallenge:
                {
                        connstate = ConnectionState::Ready;
                        iobuf->ResetForSending();
                        iobuf->Write<uint32_t>(2);
                        iobuf->Write< bool >(true);
                        return RPCResponse::Respond;
                }
        case ConnectionState::Ready:
                {
                        ProcessGreeting(iobuf);
                        connstate = ConnectionState::Approved;
                        iobuf->ResetForSending();
                        iobuf->Write<uint32_t>(4);
                        return RPCResponse::Respond;
                }
        default:
            throw Exception(Database::ErrorInternal,"Illegal connection state encountered");
        }
}

RPCResponse::Type Connection::HandleException(IOBuffer *iobuf, Exception &e, unsigned trans_id)
{
        TransData *trans = GetTransaction(trans_id, false);

        if (e.errorcode != ErrorWrongMetadataVersion && e.errorcode != ErrorNotYetReady)
        {
                Blex::ErrStream() << GetConnectionName(trans) << " failure for " << clientname << ": " << e.what();
        }

        // Encode response, default non-fatal response
        RPCResponse::Type responsetype = RPCResponse::Respond;
        EncodeException(iobuf, e);

        // No waiting for hooks anymore
        hooksignal = nullptr;

        switch (e.errorcode)
        {
        // No problem at all, or not so fatal
        case ErrorNone:
        case ErrorWrongMetadataVersion:
                break;

        // Fatal
        case ErrorInternal:
        case ErrorInvalidArg:
        case ErrorProtocol:
        case ErrorDisconnect:
//        case ErrorConnectionRefused:
        case ErrorTimeout:
                responsetype = RPCResponse::Disconnect; break;

        // Switch transaction to read-only
        case ErrorMetadataBad:
        case ErrorIO:
        case ErrorConstraint:
        case ErrorConstraintUnique:
        case ErrorConstraintReference:
        case ErrorConstraintNotNull:
        case ErrorReadAccessDenied:
        case ErrorWriteAccessDenied:
        case ErrorIllegalSQLCommand:
        case ErrorConflict:
        case ErrorDeadlock:
            {
                    // Set the transaction to readonly after this
                    if (trans && trans->transref.get() && trans->transref->GetState() == TransactionState::Normal)
                    {
                            IODEBUGPRINTSO(GetConnectionName(trans) << ": Switching transaction to read-only after error");
                            trans->transref->SwitchToState(TransactionState::ReadOnlyAfterError);
                    }
            }
        default: ;
        }
        return responsetype;
}


RPCResponse::Type Connection::HookHandleMessage(IOBuffer *iobuf)
{
        RPCResponse::Type responsetype;

        uint32_t transid = 0;

        if(logtransactions)
            conn_rpctimer.Start();

        try
        {
                // Get the opcode
                RequestOpcode::Type opcode = (RequestOpcode::Type)iobuf->GetOpcode();
                if (iobuf->GetRawLength()<IOBuffer::HeaderSize
                    || opcode >= RequestOpcode::_max)
                    throw Exception(ErrorProtocol,"Invalid RPC call");

                iobuf->ResetReadPointer();

                if (hooksignal)
                {
                        // Currently waiting for a signal that we can retry an operation
                        if (opcode != RequestOpcode::ResetConnection)
                            throw Exception(ErrorProtocol, "Waiting for other transaction to finish, no requests are accepted right now.");
                }

                if (connstate != ConnectionState::Approved && opcode != RequestOpcode::BeginConnection)
                {
                        LogConnectionFailure("Incorrect database 'greeting' message");
                        IODEBUGPRINTSO("Expected 'BeginConnection' rpc in connection state " << Blex::AnyToString(connstate));
                        throw Exception(Database::ErrorProtocol,"Invalid connection request");
                }
                if (opcode != RequestOpcode::BeginConnection)
                {
                        // Read in the trans-id
                        transid = iobuf->Read< uint32_t >();
                }

                TransData *trans = transid != 0 ? GetTransaction(transid, true) : NULL;
                if (logtransactions && trans)
                    trans->trans_rpctimer.Start();

                if (trans && trans->transref.get())
                    GetBackend().SetTransactionInfoCurrentRPC(trans->transref.get(), RequestOpcode::GetName((uint8_t)opcode));

                switch (opcode)
                {
                case RequestOpcode::TransactionStart:                   responsetype = RemoteTransactionStart(iobuf, trans); break;
                case RequestOpcode::TransactionExplicitOpen:            responsetype = RemoteTransactionExplicitOpen(iobuf, trans); break;
                case RequestOpcode::TransactionCommitRollbackClose:     responsetype = RemoteTransactionCommitRollbackClose(iobuf, trans); break;
                case RequestOpcode::ResultSetAdvance:                   responsetype = RemoteResultSetAdvance(iobuf, trans); break;
                case RequestOpcode::ResultSetLock:                      responsetype = RemoteResultSetLock(iobuf, trans); break;
                case RequestOpcode::ResultSetUnlock:                    responsetype = RemoteResultSetUnlock(iobuf, trans); break;
                case RequestOpcode::ResultSetUpdate:                    responsetype = RemoteResultSetUpdate(iobuf, trans); break;
                case RequestOpcode::ResultSetDelete:                    responsetype = RemoteResultSetDelete(iobuf, trans); break;
                case RequestOpcode::ResultSetFase2:                     responsetype = RemoteResultSetFase2(iobuf, trans); break;
                case RequestOpcode::ResultSetGetInfo:                   responsetype = RemoteResultSetGetInfo(iobuf, trans); break;
                case RequestOpcode::ResultSetClose:                     responsetype = RemoteResultSetClose(iobuf, trans); break;
                case RequestOpcode::RecordInsert:                       responsetype = RemoteRecordInsert(iobuf, trans); break;
                case RequestOpcode::ScanStart:                          responsetype = RemoteScanStart(iobuf, trans); break;
                case RequestOpcode::MetadataGet:                        responsetype = RemoteMetadataGet(iobuf, trans); break;
                case RequestOpcode::AutonumberGet:                      responsetype = RemoteAutonumberGet(iobuf, trans); break;
                case RequestOpcode::BlobUpload:                         responsetype = RemoteBlobUpload(iobuf, trans); break;

                case RequestOpcode::BlobRead:                           responsetype = RemoteBlobRead(iobuf, trans); break;
                case RequestOpcode::BlobMarkPersistent:                 responsetype = RemoteBlobMarkPersistent(iobuf, trans); break;
                case RequestOpcode::BlobDismiss:                        responsetype = RemoteBlobDismiss(iobuf, trans); break;
                case RequestOpcode::SQLCommand:                         responsetype = RemoteSQLCommand(iobuf, trans); break;
                case RequestOpcode::ResetConnection:                    responsetype = RemoteResetConnection(iobuf, trans); break;
                case RequestOpcode::BeginConnection:                    responsetype = RemoteBeginConnection(iobuf); break;
                default:
                    throw Exception(ErrorInternal, "Could not find handler for RPC " + GetName(opcode));
                }

                trans = transid != 0 ? GetTransaction(transid, false) : NULL;
                if (trans && trans->transref.get())
                    GetBackend().SetTransactionInfoCurrentRPC(trans->transref.get(), "");

                // Finish the iobuffer for responds
                if (responsetype != RPCResponse::DontRespond && responsetype != RPCResponse::Retry && responsetype != RPCResponse::RespondAsync)
                    iobuf->FinishForReplying(false); //all went ok

                // Is a retry requested?
                if (responsetype == RPCResponse::Retry)
                {
                        if (!hooksignal) // No hook function set?
                            throw Exception(ErrorInternal, "Action retry requested without setting hook signal handler");
                }
        }
        catch (Exception &e)
        {
                TransData *trans = transid != 0 ? GetTransaction(transid, false) : NULL;
                if (trans)
                {
                        if (trans->transref.get())
                            GetBackend().SetTransactionInfoCurrentRPC(trans->transref.get(), "");
                        e.clientname = trans->clientname;
                }
                responsetype = HandleException(iobuf, e, transid);
        }
        if (logtransactions)
        {
                TransData *trans = transid != 0 ? GetTransaction(transid, false) : NULL;
                if(trans)
                    trans->trans_rpctimer.Stop();
                conn_rpctimer.Stop();
        }
        return responsetype;
}


unsigned Connection::SendResultSetStart(IOBuffer *iobuf, ResultSet &resultset, bool send_info)
{
        // Send the query-id
        iobuf->Write<uint32_t>(resultset.query_id);

        /* FIXME: Misschien minder efficient, maar de ownership problemen zijn
           anders iets te scary. Afgezien van expliciete shutdowneisen zouden
           fixes zijn om niet transacties te destroyen vanuit scanners of een
           refcounting principe erop na te houden voor TransData destruction. (Waarbij
           een expliciet geopende transactie ook gewoon een reference is die
           de transactie in stand houdt na het verdwijnen van cursors? ) */

        // Send description of the resultset
        ResultSetBase::Description const &d = resultset.set->GetDescription();
        iobuf->Write<uint8_t>(d.has_fase2_data);
        iobuf->Write<uint8_t>(d.can_update);
        iobuf->Write<uint32_t>(d.max_rows_per_block);
        iobuf->Write<uint8_t>(send_info);
        if (send_info)
            SendResultSetColumnInfo(iobuf, *resultset.set);

        return SendBlock(iobuf, resultset);
}

void Connection::SendResultSetColumnInfo(IOBuffer *iobuf, ResultSetBase &resultset)
{
        ColumnInfos infos;
        resultset.FillTypeInfo(&infos);

        iobuf->Write<uint16_t>((uint16_t)infos.size());
        for (ColumnInfos::const_iterator it = infos.begin(); it != infos.end(); ++it)
        {
                iobuf->Write(it->name);
                iobuf->Write<uint16_t>(0);
                iobuf->Write<uint32_t>(it->type);
                iobuf->Write<bool>(false); // FIXME: find something better for internal
        }
}


void Connection::SendEmptyResultSet(IOBuffer *iobuf)
{
        // Write 0 as query_id (signals empty set)
        iobuf->Write<uint32_t>(0);
}

RPCResponse::Type Connection::RemoteResultSetAdvance(IOBuffer *iobuf, TransData *IODEBUGONLYARG(trans))
{
        uint32_t query_id = iobuf->Read<uint32_t>();
        ResultSet &resultset = GetResultSet(query_id);

        Blex::DateTime stats_start = resultset.statsqueryid ? Blex::DateTime::Now() : Blex::DateTime::Invalid();

        iobuf->ResetForSending();

        IODEBUG(trans, "ResultSetAdvance q:" << query_id);

#ifndef IODEBUGGING
        SendBlock(iobuf, resultset);
#else
        unsigned result_count =SendBlock(iobuf, resultset);
        IODEBUGPRINT(" Results: " << result_count);
#endif

        if (resultset.statsqueryid)
        {
                uint32_t diff = (Blex::DateTime::Now() - stats_start).GetMsecs();
                GetBackend().ModifyTransactionInfoQueryData(resultset.statsqueryid, 0, diff);
        }

        if (resultset.is_finished)
        {
                IODEBUGPRINT(" (Query ended)");
                RemoveResultSet(resultset.query_id);
        }

        return RPCResponse::Respond;
}

RPCResponse::Type Connection::RemoteResultSetLock(IOBuffer *iobuf, TransData *IODEBUGONLYARG(trans))
{
        uint32_t query_id = iobuf->Read<uint32_t>();
        ResultSet &resultset = GetResultSet(query_id);

        uint16_t row = iobuf->Read<uint16_t>();

        IODEBUG(trans, "ResultSetLock q:" << query_id << " Row: " << row << " Result: ");

        if ((unsigned)row >= resultset.set->CurrentRowCount())
            throw Exception(ErrorInvalidArg,"Invalid row requested");

        // Are we allowed to lock?
        if (resultset.trans)
        {
                TransData const &data = *resultset.trans;
                if ((data.type == DBTransactionType::Normal) ||
                    (data.type == DBTransactionType::Auto && data.is_explicitly_started))
                {
                        RPCResponse::Type result = TryLock(iobuf, *resultset.set, row);
                        if (result == RPCResponse::Retry)
                            hooksignal = std::bind(&Connection::TryLock, this, std::placeholders::_1, std::ref(*resultset.set), row);
                        return result;
                }
        }

        iobuf->ResetForSending();
        iobuf->Write<uint8_t>(DBLRGone);
        IODEBUGPRINT("Lock attempt ignored, locking not allowed here");
        return RPCResponse::Respond;
}

RPCResponse::Type Connection::TryLock(IOBuffer *iobuf, ResultSetBase &resultset, uint16_t row)
{
        DBLockResult result = resultset.LockRow(row);

        // Send no response for retry
        if (result == DBLRRetry)
        {
                IODEBUGPRINTSO("TryLock: Retry");
                return RPCResponse::Retry;
        }

        iobuf->ResetForSending();
        iobuf->Write<uint8_t>((uint8_t)result);

        switch (result)
        {
        case DBLRLocked:
                {
                        CellSender sender(*iobuf, blobuser, resultset.GetBlobContext());

                        iobuf->Write<uint16_t>(row);
                        resultset.SendRow(row, DBRSTFase2, sender);

                        IODEBUGPRINTSO("TryLock: Locked");
                } break;
        case DBLRLockedModified:
                {
                        CellSender sender(*iobuf, blobuser, resultset.GetBlobContext());

                        iobuf->Write<uint16_t>(row);
                        resultset.SendRow(row, DBRSTBoth, sender);

                        IODEBUGPRINTSO("TryLock: Updated");
                } break;
        case DBLRGone:
                {
                        IODEBUGPRINTSO("TryLock: Deleted");
                } break;
        default: ;
        }

//        iobuf->FinishForReplying(false);
        return RPCResponse::Respond;
}

RPCResponse::Type Connection::RemoteResultSetUnlock(IOBuffer *iobuf, TransData *IODEBUGONLYARG(trans))
{
        uint32_t query_id = iobuf->Read<uint32_t>();
        ResultSet &resultset = GetResultSet(query_id);

        unsigned row = iobuf->Read<uint16_t>();

        IODEBUG(trans, "ResultSetUnlock q:" << query_id << " Row: " << row);

        if (row >= resultset.set->CurrentRowCount())
            throw Exception(ErrorInvalidArg,"Invalid row requested");

        iobuf->ResetForSending();

        resultset.set->UnlockRow(row);
        return RPCResponse::DontRespond;
}

RPCResponse::Type Connection::RemoteResultSetUpdate(IOBuffer *iobuf, TransData *IODEBUGONLYARG(trans))
{
        uint32_t query_id = iobuf->Read<uint32_t>();
        ResultSet &resultset = GetResultSet(query_id);

        unsigned row = iobuf->Read<uint16_t>();
        if (row >= resultset.set->CurrentRowCount())
            throw Exception(ErrorInvalidArg,"Invalid row requested");

        iobuf->ReadIn(&scratch_record);
        iobuf->ResetForSending();

        IODEBUG(trans, "ResultSetUpdate q:" << query_id << " Row: " << row);

        resultset.set->UpdateRow(row, scratch_record, std::bind(&Connection::CheckBlobAccessible, &blobuser, std::placeholders::_1));
        return RPCResponse::Respond;
}

RPCResponse::Type Connection::RemoteResultSetDelete(IOBuffer *iobuf, TransData *IODEBUGONLYARG(trans))
{
        uint32_t query_id = iobuf->Read<uint32_t>();
        ResultSet &resultset = GetResultSet(query_id);

        unsigned row = iobuf->Read<uint16_t>();
        if (row >= resultset.set->CurrentRowCount())
            throw Exception(ErrorInvalidArg,"Invalid row requested");

        iobuf->ResetForSending();

        IODEBUG(trans, "ResultSetDelete q:" << query_id << " Row: " << row);

        resultset.set->DeleteRow(row);
        return RPCResponse::Respond;
}

RPCResponse::Type Connection::RemoteResultSetFase2(IOBuffer *iobuf, TransData *IODEBUGONLYARG(trans))
{
        uint32_t query_id = iobuf->Read<uint32_t>();
        ResultSet &resultset = GetResultSet(query_id);

        uint16_t rows[Scanner::CacheSize];
        unsigned rows_in_block = resultset.set->CurrentRowCount();
        unsigned row_count = iobuf->Read<uint16_t>();

        assert(rows_in_block <= Scanner::CacheSize);
        if (row_count > rows_in_block)
            throw Exception(ErrorInvalidArg,"Too much rows requested");

        unsigned idx = 0;
        for (; idx < row_count; ++idx)
            rows[idx] = iobuf->Read<uint16_t>();

        bool allow_direct_close = iobuf->Read<uint8_t>();

        // Build a block with
        iobuf->ResetForSending();

        IODEBUG(trans, "ResultSetFase2 q:" << query_id << " Rows: ");

        unsigned sent_total = 0;
        bool all_sent = true;
        for (idx = 0; idx < row_count; ++idx)
        {
                if ((unsigned)rows[idx] >= rows_in_block)
                    throw Exception(ErrorInvalidArg,"Invalid row requested");

                // Check if we may send more
                if (sent_total > MaxBytesPerBlock)
                {
                        all_sent = false;
                        break;
                }

                CellSender sender(*iobuf, blobuser, resultset.set->GetBlobContext());
                iobuf->Write<uint16_t>(rows[idx]);
                resultset.set->SendRow(rows[idx], DBRSTFase2, sender);
                sent_total += sender.GetBytesSent();

                IODEBUGPRINT((idx != 0 ? ", " : ""));
                IODEBUGPRINT(rows[idx]);
        }

        // Calculate exit code. If not all fase 2 data has been sent, send DBBRCEndOfBlock.
        uint16_t exitcode;
        if (resultset.set->AreRowsAvailable() || !all_sent)
            exitcode = DBBRCEndOfBlock;
        else
        {
                bool is_auto_trans = false;
                if (resultset.trans)
                {
                        TransData const &data = *resultset.trans;
                        if (data.type == DBTransactionType::Auto && !data.is_explicitly_started)
                            is_auto_trans = true;
                }

                ResultSetBase::Description const &description = resultset.set->GetDescription();

                if (!all_sent || description.can_update || !allow_direct_close || is_auto_trans)
                    exitcode = DBBRCEndOfResults;
                else
                    exitcode = DBBRCEndOfQuery;
        }

        iobuf->Write<uint16_t>(exitcode);
        if (exitcode == DBBRCEndOfQuery)
        {
                IODEBUGPRINT(" (Query ended)");
                RemoveResultSet(query_id);
        }

        return RPCResponse::Respond;
}

RPCResponse::Type Connection::RemoteResultSetGetInfo(IOBuffer *iobuf, TransData *IODEBUGONLYARG(trans))
{
        uint32_t query_id = iobuf->Read<uint32_t>();
        ResultSet &resultset = GetResultSet(query_id);

        IODEBUG(trans, "ResultSetGetInfo q:" << query_id);
        iobuf->ResetForSending();

        SendResultSetColumnInfo(iobuf, *resultset.set);
        return RPCResponse::Respond;
}

RPCResponse::Type Connection::RemoteResultSetClose(IOBuffer *iobuf, TransData *IODEBUGONLYARG(trans))
{
        uint32_t qid = iobuf->Read<uint32_t>() - 1;
        if (qid >= resultsets.size() || !resultsets[qid].set.get())
            throw Exception(ErrorInvalidArg,"Invalid query id transmitted");

        // iobuf->ResetForSending();

        IODEBUG(trans, "ResultSetClose q:" << (qid+1));

        RemoveResultSet(qid+1);

        return RPCResponse::DontRespond; //nothing to send..
}

unsigned Connection::SendBlock(IOBuffer *iobuf, ResultSet &resultset)
{
        uint16_t rows = 0;
        if (resultset.set->NextBlock())
        {
                unsigned sent_total = 0;
                do
                {
                        CellSender sender(*iobuf, blobuser, resultset.set->GetBlobContext());

                        iobuf->Write<uint16_t>(rows);
                        resultset.set->SendRow(rows, DBRSTFase1, sender);
                        ++rows;
                        sent_total += sender.GetBytesSent();
                        if (sent_total > MaxBytesPerBlock)
                            break;
                }
                while (resultset.set->TryAddRowToBlock());
        }

        if (resultset.statsqueryid)
            GetBackend().ModifyTransactionInfoQueryData(resultset.statsqueryid, rows, 0);

        uint16_t exitcode;
        if (resultset.set->AreRowsAvailable())
        {
                // More rows: end of this block, more follow
                exitcode = DBBRCEndOfBlock;
        }
        else
        {
                ResultSetBase::Description const &description = resultset.set->GetDescription();

                bool is_auto_trans = false;
                if (resultset.trans)
                {
                        TransData const &data = *resultset.trans;
                        if (data.type == DBTransactionType::Auto && !data.is_explicitly_started)
                            is_auto_trans = true;
                }

                // No more rows available.
                // If no rows sent in this block: close query. Not updating and no fase 2 data: close query
                if ((rows == 0 || (!description.can_update && !description.has_fase2_data)) && !is_auto_trans)
                    exitcode = DBBRCEndOfQuery;
                else
                    exitcode = DBBRCEndOfResults;
        }

        iobuf->Write<uint16_t>(exitcode);
        if (exitcode == DBBRCEndOfQuery)
            resultset.is_finished = true;

        return rows;
}

Connection::ResultSet & Connection::RegisterResultSet(std::shared_ptr< ResultSetBase > const &resultset, TransData *trans)
{
//        IODEBUGPRINTSO("Adding resultset " << resultset.get());

        uint32_t i = 0;
        for (; i != resultsets.size() && resultsets[i].set.get(); ++i)
            /*repeat*/ ;
        if (i == resultsets.size())
            resultsets.push_back(ResultSet());

        resultsets[i].query_id = i + 1;
        resultsets[i].is_finished = false;
        resultsets[i].set = resultset;
        resultsets[i].trans = trans;

        return resultsets[i];
}

Connection::ResultSet & Connection::GetResultSet(uint32_t query_id)
{
        if (query_id == 0)
            throw Exception(ErrorInvalidArg,"Invalid query id transmitted");

        unsigned normalized_id = query_id - 1;
        if (normalized_id >= resultsets.size() || !resultsets[normalized_id].set.get())
            throw Exception(ErrorInvalidArg,"Invalid query id transmitted");

        return resultsets[normalized_id];
}

void Connection::RemoveResultSet(unsigned query_id)
{
//        IODEBUGPRINTSO("Removing resultset " << resultsets[query_id - 1].set.get());
        TransData *trans = resultsets[query_id - 1].trans;

        // Release resources
        if (resultsets[query_id - 1].set.get())
            resultsets[query_id - 1].set->Close();
        resultsets[query_id - 1].set.reset();
        resultsets[query_id - 1].trans = 0;

        if (trans && !AnyResultSetsActive(trans))
        {
                // Last resultset closed; finish updates to make everything visible (not for notification transactions!)
                trans->transref->FinishCommand();

                // Deactivate auto transactions
                if (trans->type == DBTransactionType::Auto && !trans->is_explicitly_started)
                {
                        IODEBUGPRINTSO("Deactivating transaction after last resultset closed");
                        DeactivateTransaction(trans);
                }
        }
}

void Connection::KillAllResultSets(TransData *trans)
{
        for (ResultSets::iterator it = resultsets.begin(), end = resultsets.end(); it != end; ++it)
            if (it->set.get() && (it->trans == trans || trans == 0))
            {
//                    IODEBUGPRINTSO("Removing resultset " << it->set.get());
                    it->set->Close();
                    it->set.reset();
                    it->trans = 0;
            }
}

bool Connection::AnyResultSetsActive(TransData *trans)
{
        for (ResultSets::iterator it = resultsets.begin(), end = resultsets.end(); it != end; ++it)
            if (it->set.get() && (it->trans == trans || trans == 0))
                return true;
        return false;
}

RPCResponse::Type Connection::HookSignalled(IOBuffer *iobuf)
{
        RPCResponse::Type responsetype;

        /* If no hooksignal is set this is a spurious signal. Signal ordering is tightly controlled, this is only
            possible when disconnecting within a wait. If so, it ain't fatal */

        if (!hooksignal)
        {
                if (connstate == ConnectionState::JustConnected)
                    return RPCResponse::DontRespond;
                throw Exception(ErrorInternal, "Got retry signal without retry available");
        }

        try
        {
                responsetype = hooksignal(iobuf);
                if (responsetype != RPCResponse::DontRespond && responsetype != RPCResponse::Retry)
                    iobuf->FinishForReplying(false); //all went ok

                if (responsetype != RPCResponse::Retry)
                    hooksignal = nullptr;
                else if (!hooksignal)
                    throw Exception(ErrorInternal, "Action retry requested without setting hook signal handler");
        }
        catch (Exception &e)
        {
                responsetype = HandleException(iobuf, e, 0);
        }
        return responsetype;
}

RPCResponse::Type Connection::HookTimeOut(IOBuffer *iobuf, bool fatal)
{
        if (fatal)
        {
                // FIXME: this used to be a transaction-based close; verify that the client sees this as connection close
                if (AnyTimeoutableTransactionActive())
                {
                        Database::Exception e(ErrorTimeout, "Connection closed because a transaction has been running too long");
                        if (logtransactions)
                            Blex::ErrStream() << GetConnectionName(0) << " failure for " << clientname << ": " << e.what();
                        EncodeException(iobuf, e);
                }
                else
                {
                        Database::Exception e(ErrorTimeout, "Connection closed due to inactivity");
                        if (logtransactions)
                            Blex::ErrStream() << GetConnectionName(0) << " failure for " << clientname << ": " << e.what();
                        EncodeException(iobuf, e);
                }

                return RPCResponse::Disconnect;
        }

        ReSetTimeouts();
        return RPCResponse::Respond;
}

void Connection::HookPrepareForUse()
{
        // Using for another connection, go back to JustConnected
        ResetConnection(false);
}

void Connection::HookIncomingConnection()
{
        // No initialization needed
}

void Connection::HookDisconnectReceived(Blex::Dispatcher::Signals::SignalType /*signal*/)
{
        // Do nothing, everything is handled in connectionclosed
}

TransData * Connection::AllocateTransaction()
{
        unsigned id = 1;
        for (Transactions::iterator it = transactions.begin(), end = transactions.end(); it != end; ++it, ++id)
            if (it->first != id)
                break;
        TransData &trans = transactions.insert(std::make_pair(id, TransData())).first->second;
        trans.external_id = id;
        IODEBUGPRINTSO("Allocated new trans with external id " << id);
        return &trans;
}

TransData * Connection::GetTransaction(uint32_t trans_id, bool throw_if_not_found)
{
        std::map< unsigned, TransData >::iterator it = transactions.find(trans_id);

        if (it == transactions.end())
        {
                if (throw_if_not_found)
                    throw Exception(ErrorInvalidArg,"Invalid id of transaction specified");
                return NULL;
        }

        if (!it->second.IsValid())
        {
                if (throw_if_not_found)
                    throw Exception(ErrorInvalidArg,"Invalid id of transaction specified (transaction has already been closed)");
                return NULL;
        }
        return &it->second;
}

void Connection::SaveSecurityData(BackendTransaction &trans, TransSecurityData &data)
{
        data.base_roles = trans.GetBaseRoleList();
}

void Connection::RestoreSecurityData(BackendTransaction &trans, TransSecurityData &data, bool skip_security)
{
        trans.SetBaseRoles(data.base_roles, skip_security);
}

void Connection::ActivateTransaction(TransData *trans, bool explicit_start)
{
        if (trans->username == "~internal")
          throw Database::Exception(Database::ErrorReadAccessDenied,"Logging in with user '~internal' is not allowed");

        trans->transref =
                GetBackend().BeginTransaction(
                        trans->username,
                        trans->password,
                        connectionsource,
                        trans->clientname);

        trans->transref->SetAbortFlag(GetAbortFlag());

        if (trans->is_readonly)
        {
                // Put transaction in read-only mode
                trans->transref->SwitchToState(TransactionState::ReadOnly);
        }
        else
        {
                // Set transaction connection in lockmanager (readonly won't lock)
                GetBackend().lockmanager.SetTransactionConnection(&*trans->transref, this);
        }
        trans->is_explicitly_started = explicit_start;
        trans->trans_started = Blex::DateTime::Now();

        Metadata const &metadata = trans->transref->GetMetadata();

        // Check all extra roles for existance, and just erase it when gone (aborting gives too much problems)
        for (std::vector< RoleId >::iterator it = trans->extra_base_roles.begin(); it != trans->extra_base_roles.end();)
        {
                if (!metadata.Privs().GetRoleDef(*it))
                    it = trans->extra_base_roles.erase(it);
                else
                    ++it;
        }

        // Check all base roles for existance, and just erase it when gone  (aborting gives too much problems)
        for (std::vector< RoleId >::iterator it = trans->saved_security_data.base_roles.begin(); it != trans->saved_security_data.base_roles.end();)
        {
            if (!metadata.Privs().GetRoleDef(*it))
                    it = trans->saved_security_data.base_roles.erase(it);
            else
                ++it;
        }

        for (std::vector< RoleId >::const_iterator it = trans->extra_base_roles.begin(); it != trans->extra_base_roles.end(); ++it)
            trans->transref->AddBaseRole(*it);

        if (trans->is_initialized)
             RestoreSecurityData(*trans->transref, trans->saved_security_data, false);

        trans->is_initialized = true;
}

void Connection::DeactivateTransaction(TransData *trans)
{
        assert(trans->IsValid());

        KillAllResultSets(trans);
        SaveSecurityData(*trans->transref, trans->saved_security_data);
        blobuser.DestroyContext(trans);

        trans->transref.reset();
        ReSetTimeouts();
}

void Connection::DeleteTransaction(TransData *trans)
{
        assert(trans->IsValid());

        KillAllResultSets(trans);
        if (trans->transref.get())
        {
                 trans->transref->SetAbortFlag(0);
                 trans->transref.reset();
        }
        blobuser.DestroyContext(trans);

        transactions.erase(trans->external_id);

        ReSetTimeouts();
}

bool Connection::AnyTimeoutableTransactionActive() const
{
        if (transactions.empty())
            return false;
        for (Transactions::const_iterator it = transactions.begin(), end = transactions.end(); it != end; ++it)
            if (it->second.IsValid() && it->second.transref.get() && it->second.transref->MayTimeout())
                return true;

        return false;
}


void Connection::EnsureTransactionExists(TransData *trans)
{
        if (!trans)
            throw Exception(ErrorProtocol,"No trans id was sent, while one is explicitly needed for this command");
}

void Connection::EnsureTransactionOpened(TransData *trans)
{
        if (!trans)
            throw Exception(ErrorProtocol,"No trans id was sent, while one is explicitly needed for this operation");
        if (!trans->transref.get())
            throw Exception(ErrorInvalidArg,"This operation requires a transaction, you may need to 'BeginWork'");
}

std::pair< Blex::DateTime, bool > Connection::CalculateTimeouts()
{
        // Default is max; a listening connection may be held indefinately
        Blex::DateTime timeout = Blex::DateTime::Max();

        // Check if any transactions are outstanding (MaxTransactionTime timeout from the start of the earliest started trans)
        for (Transactions::const_iterator it = transactions.begin(); it != transactions.end(); ++it)
            if (it->second.IsValid() && it->second.transref.get() && it->second.transref->MayTimeout())
            {
                    Blex::DateTime this_timeout = it->second.trans_started + Blex::DateTime::Seconds(MaxTransactionTime);
                    if (this_timeout < timeout)
                        timeout = this_timeout;
            }

        return std::make_pair(timeout, true);
}

void Connection::ReSetTimeouts()
{
        std::pair< Blex::DateTime, bool > timeouts = CalculateTimeouts();

        IODEBUGONLY(
                if (timeouts.first == Blex::DateTime::Invalid() || timeouts.first == Blex::DateTime::Max())
                {
                        IODEBUGPRINTSO(GetConnectionName(0) << ": Disabling timeout");
                }
                else
                {
                        IODEBUGPRINTSO(GetConnectionName(0) << ": Setting " << (timeouts.second ? "fatal" : "non-fatal") << " timeout to " << Blex::AnyToString(timeouts.first));
                }
        );

        SetTimeOut(timeouts.first, timeouts.second);
}

void Connection::ProcessGreeting(IOBuffer *iobuf)
{
        ReadAndCheckVersion(iobuf);
        clientname = iobuf->Read<std::string>();

        IODEBUG(0, "ConnectionGreeting: source " << clientname);

//        settimeoutfunction(Blex::DateTime::Now() + Blex::DateTime::Seconds(MaxTransactionTime));
}

RPCResponse::Type Connection::RemoteTransactionStart(IOBuffer *iobuf, TransData */*trans*/)
{
        TransData *trans(0);
        try
        {
                std::vector< std::string > extra_base_roles;

                std::string username = iobuf->Read<std::string>();

                if(username == "~webhare")
                {
                        if (GetBackend().GetIndexSystem() && !GetBackend().GetIndexSystem()->IsFirstLiveFillDone())
                            throw Database::Exception(Database::ErrorNotYetReady,"Index is not yet available");
                }

                trans = AllocateTransaction();
                trans->username = username;
                trans->password = iobuf->Read<std::string>();
                trans->clientname = iobuf->Read<std::string>();
                trans->type = iobuf->Read<uint8_t>() == 0 ? DBTransactionType::Normal : DBTransactionType::Auto;
                trans->is_readonly = iobuf->Read<uint8_t>() != 0;
                trans->is_explicitly_started = trans->type == DBTransactionType::Normal;
                trans->is_initialized = false;
                unsigned extra_role_count = iobuf->Read< uint32_t >();
                for (unsigned idx = 0; idx < extra_role_count; ++idx)
                    extra_base_roles.push_back(iobuf->Read< std::string >());

                if (!extra_base_roles.empty())
                {
                        MetadataManager::Ref current_meta_ref(GetBackend().GetMetadataManager());

                        for (std::vector< std::string >::iterator it = extra_base_roles.begin(); it != extra_base_roles.end(); ++it)
                        {
                                std::string &rolename = *it;
                                Blex::ToUppercase(rolename.begin(), rolename.end());

                                std::string::iterator schema_separator = std::find(rolename.begin(), rolename.end(), '.');
                                if (schema_separator==rolename.end())
                                    throw Database::Exception(Database::ErrorInvalidArg, "Invalid role name '" + rolename + "'");

                                Database::ObjectId schemaid = current_meta_ref->GetRootObject().GetObjectId(std::string(rolename.begin(), schema_separator));
                                if (!schemaid)
                                    throw Database::Exception(Database::ErrorInvalidArg, "No such schema '" + std::string(rolename.begin(), schema_separator) + "' for role '" + rolename + "'");

                                Database::RoleId roleid = current_meta_ref->Privs().GetRoleId(schemaid, std::string(schema_separator+1, rolename.end()));
                                if (!roleid)
                                    throw Database::Exception(Database::ErrorInvalidArg, "No such role '" + std::string(schema_separator+1, rolename.end()) + "' for role '" + rolename + "'");

                                trans->extra_base_roles.push_back(roleid);
                        }
                }

                IODEBUG(0, "TransactionGreeting: user " << trans->username << " pwd " << trans->password << " client " << trans->clientname << " auto: " << (trans->type == DBTransactionType::Auto ? "yes" : "no"));

                iobuf->ResetForSending();
                iobuf->Write<uint32_t>(trans->external_id);

                IODEBUGPRINTSO("Created new trans: " << trans->external_id << " (" << ((long)trans) << ")");

                if (trans->type == DBTransactionType::Normal)
                {
                        ActivateTransaction(trans, true);
                        iobuf->Write<Blex::DateTime>(trans->transref->GetMetadataRef()->GetStartTimeStamp());
                        iobuf->Write<uint32_t>(trans->transref->GetMetadataRef()->GetVersionId());
                }
                else
                {
                        MetadataManager::Ref ref(GetBackend().GetMetadataManager());
                        iobuf->Write<Blex::DateTime>(ref->GetStartTimeStamp());
                        iobuf->Write<uint32_t>(ref->GetVersionId());
                }
                iobuf->Write< bool >(GetBackend().GetParamRPCInfo());

                // Re-set the timeout
                ReSetTimeouts();
        }
        catch (Exception &)
        {
                if (trans)
                    DeleteTransaction(trans);
                throw;
        }
        return RPCResponse::Respond;
}

RPCResponse::Type Connection::RemoteTransactionExplicitOpen(IOBuffer *iobuf, TransData *trans)
{
        IODEBUG(trans, "TransactionExplicitOpen");
        EnsureTransactionExists(trans);

        if (trans->type != DBTransactionType::Auto || trans->transref.get())
            throw Exception(ErrorInvalidArg,"Explicit open may only be done for closed auto-transactions");

        ActivateTransaction(trans, true);

        iobuf->ResetForSending();
        iobuf->Write< bool >(GetBackend().GetParamRPCInfo());

        return RPCResponse::Respond;
}


// Transaction-specific
RPCResponse::Type Connection::RemoteMetadataGet(IOBuffer *iobuf, TransData *trans)
{
        IODEBUG(trans, "DownloadMetadata");
        EnsureTransactionExists(trans);

        iobuf->ResetForSending();
        if (trans->transref.get())
        {
                EncodeMetadataInIObuffer(trans->transref->GetMetadata(),iobuf);
                IODEBUGPRINTSO("Sending metadata version " << trans->transref->GetMetadata().GetVersionId());
        }
        else
        {
                MetadataManager::Ref ref(GetBackend().GetMetadataManager());
                EncodeMetadataInIObuffer(*ref, iobuf);
                IODEBUGPRINTSO("Sending metadata version " << ref->GetVersionId());
        }
        return RPCResponse::Respond;
}

// Connection-specific
RPCResponse::Type Connection::RemoteBlobUpload(IOBuffer *iobuf, TransData *trans)
{
        bool is_eof = iobuf->Read<bool>();
        std::pair<const uint8_t*, const uint8_t*> filedata = iobuf->ReadBinary();

        IODEBUG(0, "Remote blob upload " << (filedata.second - filedata.first) << " EOF: " << (is_eof ? "yes" : "no"));
        EnsureTransactionOpened(trans);

        // Empty blob? Then we can take a shortcut.
        if (filedata.first == filedata.second && is_eof && !upload.get())
        {
                // No data sent, end of blob and no data sent already? Return blob id 0.
                BlobId uploadedfile = BlobId(0);
                iobuf->Write(uploadedfile);

                return RPCResponse::Respond;
        }

        //ADDME: If transaction commit fails, delete our uploaded blobs immediately, instead of waiting for garbage collector
        if (!upload.get())
        {
                uploadedfile = trans->transref->StartUploadBlob(&upload);
                IODEBUGPRINT(" new id: " << uploadedfile);
        }

        if (upload->Write(filedata.first,filedata.second-filedata.first) != unsigned(filedata.second-filedata.first))
            throw Exception(ErrorIO,"I/O error storing blob data (disk full?)");

        iobuf->ResetForSending();

        if (is_eof) //got the last bit!
        {
                upload.reset();
                iobuf->Write(uploadedfile);
                blobuser.MarkAsInuse(uploadedfile, trans);
        }
        return RPCResponse::Respond;
}

RPCResponse::Type Connection::RemoteBlobMarkPersistent(IOBuffer *iobuf, TransData *)
{
        IODEBUG(0, "Remote blob mark persistent");

        uint32_t count = iobuf->Read<uint32_t>();
        for (unsigned i = 0; i < count; ++i)
        {
                BlobId blob = iobuf->Read<uint32_t>();
                IODEBUGPRINT(", " << blob);
                blobuser.MarkAsInuse(blob, this);
        }
        iobuf->ResetForSending();
        return RPCResponse::DontRespond;
}

RPCResponse::Type Connection::RemoteBlobDismiss(IOBuffer *iobuf, TransData *)
{
        IODEBUG(0, "Remote blob dismiss");

        uint32_t count = iobuf->Read<uint32_t>();
        for (unsigned i = 0; i < count; ++i)
        {
                BlobId blob = iobuf->Read<uint32_t>();
                IODEBUGPRINT(", " << blob);
                blobuser.MarkAsUnused(blob, this);

                for (unsigned j=0;j<openblobs.size();++j)
                  if (openblobs[j].blobid == blob)
                  {
                    openblobs.erase(openblobs.begin()+j);
                    break;
                  }
        }
        iobuf->ResetForSending();
        return RPCResponse::DontRespond;
}

// Connection-specific
RPCResponse::Type Connection::RemoteAutonumberGet(IOBuffer *iobuf, TransData *trans)
{
        EnsureTransactionOpened(trans);

        TableId tableid = iobuf->Read<int32_t>();
        ColumnId columnid = iobuf->Read<uint16_t>();

        const TableDef *tabledef=trans->transref->GetMetadata().GetTableDef(tableid);
        if (!tabledef)
            throw Exception(ErrorInvalidArg,"Table #" + Blex::AnyToString(tableid) + " does not exist");

        ColumnDef const *columndef=tabledef->GetColumnDef(columnid);
        if (!columndef)
            throw Exception(ErrorInvalidArg,"No such column #" + Blex::AnyToString(columnid) + " in table " + tabledef->name);

        IODEBUG(trans, "GetAutonumber " << tabledef->name << ":" << columndef->name);

        int32_t newnum;
        if(columndef->autonumber_start)
            newnum=trans->transref->GetAutonumberKey(*tabledef,*columndef);
        else
            newnum=0; //no autonumbering available

        iobuf->ResetForSending();
        iobuf->Write(newnum);
        return RPCResponse::Respond;
}

//ADDME: Move this into the lock manager?!
TransId ConnectionManager::CanCommit(Connection *conn, TransId transid)
{
        IODEBUGPRINTSO("**** CanCommit commit request for " << conn << " ("  << conn->GetClientName() << ")");
        LockedData::WriteRef lock(connmgrdata);
        std::pair< Connection *, TransId > entry(conn, transid);
        std::vector< std::pair< Connection *, TransId > >::iterator itr = std::find(lock->commitqueue.begin(), lock->commitqueue.end(), entry);
        if (itr != lock->commitqueue.end())
        {
                if (itr == lock->commitqueue.begin())
                {
                        IODEBUGPRINTSO("**** CanCommit is GO for commit of a pending one: " << itr->second);
                        return 0; //we are GO for commit!
                }
                IODEBUGPRINTSO("**** CanCommit called twice for transaction that still cannot commit");
                return (itr - 1)->second;
        }
        // Get id of previous transaction (0 if we're the only one one queue, ok!)
        TransId wait_transid = lock->commitqueue.empty() ? 0 : lock->commitqueue.back().second;

        lock->commitqueue.push_back(entry);
        if (wait_transid == 0)
        {
                IODEBUGPRINTSO("**** CanCommit says GO!, your position is " << lock->commitqueue.size() << " (id: " << transid << ")");
        }
        else
        {
                IODEBUGPRINTSO("**** CanCommit says wait for " << wait_transid << ", your position is " << lock->commitqueue.size() << " (id: " << transid << ")");
        }

        return wait_transid;
}
void ConnectionManager::FinishedCommit(Connection *conn, bool really_finished)
{
        IODEBUGPRINTSO("**** FinishedCommit for " << conn << " (" << conn->GetClientName() << ") really_finished " << (really_finished ? "true":"false"));
        LockedData::WriteRef lock(connmgrdata);
        std::vector< std::pair< Connection *, TransId > >::iterator itr = lock->commitqueue.begin();
        for (; itr != lock->commitqueue.end(); ++itr)
            if (itr->first == conn)
                break;
        if (itr == lock->commitqueue.end())
        {
                if (really_finished)
                    IODEBUGPRINTSO("**** Trying to unregister a connection from the commit queue that never was on that queue");
                return;
        }
        bool was_running = itr == lock->commitqueue.begin();
        if (!was_running)
            IODEBUGPRINTSO("**** Trying to unregister a connection from the commit queue that was not at the front");
        lock->commitqueue.erase(itr);

        if (was_running && !lock->commitqueue.empty())
        {
                IODEBUGPRINTSO("**** Tell next transaction to GO (id: " << lock->commitqueue.front().second << ") " << lock->commitqueue.front().first);
                lock->commitqueue.front().first->AsyncSignal();
        }
}
//*/
// Transaction-specific
RPCResponse::Type Connection::DoCommit(IOBuffer *iobuf, TransData *trans, bool close)
{
        TransId waitfor = mgr.CanCommit(this, trans->transref->GetTransId());
        if (waitfor != 0)
        {
                trans->transref->SetStage("C:WAITING");
                GetBackend().lockmanager.IndicateWait(trans->transref->GetTransId(), waitfor, false, 0, 0);

                IODEBUGPRINTSO("**** Database rejected commit, someone else is already committing!");
                hooksignal = std::bind(&Connection::DoCommit, this, std::placeholders::_1, trans, close);
                scheduled_commit = true;
                return RPCResponse::Retry;
        }

        scheduled_commit = false;
        GetBackend().lockmanager.IndicateWaitEnd(trans->transref->GetTransId());

        //We're may be doing big I/O, so tell the dispatcher not to wait for us
        MarkAsSleeping();

        //Commit it in the database
        try
        {
                GetBackend().FinishTransaction(trans->transref.get(),true);
        }
        catch (std::exception &)
        {
                if (close)
                    DeleteTransaction(trans);
                else
                    DeactivateTransaction(trans);

                mgr.FinishedCommit(this, true);
                throw;
        }
        mgr.FinishedCommit(this, true);

        if (logtransactions)
        {
                // ADDME: time per transaction, not per connection
                Blex::ErrStream() << "Transaction committed: " << trans->transref->GetTransId() << /*" source " << clientname <<*/
                        " name: " << trans->clientname << " time: " << trans->trans_rpctimer;
        }

        if (close)
            DeleteTransaction(trans);
        else
            DeactivateTransaction(trans);

        iobuf->ResetForSending();
        iobuf->Write<bool>(close);
        return RPCResponse::Respond;
}


RPCResponse::Type Connection::RemoteTransactionCommitRollbackClose(IOBuffer *iobuf, TransData *trans)
{
        EnsureTransactionExists(trans);

        bool commit = iobuf->Read<bool>();
        bool close = iobuf->Read<bool>();

        IODEBUG(trans, "TransactionCommitRollbackClose " << (commit ? "commit" : "rollback") << " close: " << (close ? "yes" : "no"));

        if (!trans->transref.get() && commit)
            throw Exception(ErrorInvalidArg,"Trying to commit a transaction that hasn't been explicitly opened");

        if (trans->type == DBTransactionType::Normal)
            close = true;
        if (AnyResultSetsActive(trans))
            throw Exception(ErrorInvalidArg,"A query using this transaction is still active");

        // Kill all existing resultsets (they hold references to the current transaction)
        KillAllResultSets(trans);

        if (commit)
        {
                // Check the state
                switch (trans->transref->GetState())
                {
                case TransactionState::Normal:
                    break;
                case TransactionState::ReadOnly:
                   throw Exception(ErrorInvalidArg,"May not commit a read-only transaction");
                case TransactionState::ReadOnlyAfterError:
                   throw Exception(ErrorWriteAccessDenied,"May not commit a transaction that has been put in read-only mode due to an earlier failure");
                }

                if (!trans->transref->GetIdentifiedTrans().HasWritten())
                {
                        IODEBUGPRINTSO("Turning COMMIT into ROLLBACK as transaction didn't really write");
                        commit=false;
                }

                if (commit)
                {
                        // Execute the pre-commit checks; don't forget to close/deactivate if that fails
                        try
                        {
                                GetBackend().PrepareTransactionForCommit(trans->transref.get());
                        }
                        catch (std::exception &)
                        {
                                if (close)
                                    DeleteTransaction(trans);
                                else
                                    DeactivateTransaction(trans);
                                throw;
                        }
                }
        }
        if (commit)
            return DoCommit(iobuf, trans, close);

        if (logtransactions && trans->transref.get())
        {
                Blex::ErrStream() << "Transaction rolled back: " << trans->transref->GetTransId() << /*" source " << clientname <<*/
                        " name: " << trans->clientname << " time: " << trans->trans_rpctimer;
        }

        if (close)
            DeleteTransaction(trans);
        else if (trans->transref.get())
            DeactivateTransaction(trans);
        else
            IODEBUGPRINTSO("Completely unneccesary RPC!");

        iobuf->ResetForSending();
        iobuf->Write<bool>(close);
        return RPCResponse::Respond;
}

// Connection-specific
Blex::RandomStream & Connection::GetBlobStream(BlobId blob, bool is_backup_transaction)
{
        for (unsigned i=0;i<openblobs.size();++i)
          if (openblobs[i].blobid == blob)
        {
                if (i != openblobs.size()-1) //move the blob to the end of the stack if necessary
                {
                        OpenBlob saveblob = openblobs[i];
                        openblobs.erase(openblobs.begin()+i);
                        openblobs.push_back(saveblob);
                }
                return *openblobs[openblobs.size()-1].stream;
        }

        CheckBlobAccessible(&blobuser, blob);

        //Close any excess blobs
        if (openblobs.size() >= BlobCacheSize)
            openblobs.erase(openblobs.begin());

        //This is a new blob, so open it
        OpenBlob newblob;
        newblob.blobid=blob;
        newblob.stream.reset(Blex::FileStream::OpenRead(blobuser.GetBlobFilename(blob)));
        if (!newblob.stream.get())
            throw Exception(ErrorIO,"Cannot open requested blob #" + Blex::AnyToString(blob));
        if(is_backup_transaction)
            newblob.stream->AssumeReadOnce();

        openblobs.push_back(newblob);
        return *newblob.stream;
}

// Connection-specific
RPCResponse::Type Connection::RemoteBlobRead(IOBuffer *iobuf, TransData *IODEBUGONLYARG(trans))
{
        uint32_t blobid = iobuf->Read<uint32_t>();
        uint64_t offset = iobuf->Read<uint64_t>();
        uint32_t len = iobuf->Read<uint32_t>();
        bool is_backup_transaction = iobuf->Read<uint8_t>() == 1;

        IODEBUG(trans, "ReadBlob blob " << blobid << " offset " << offset << " len " << len);

        if (len>MaxBlobReadSize)
            throw Exception(ErrorProtocol,"Trying to read too much data in a single RPC");

        iobuf->ResetForSending();

        //Get the blob and read the requested data
        Blex::RandomStream &blob = GetBlobStream(blobid, is_backup_transaction);
        uint8_t *databuf = iobuf->Reserve(len+4); //4 bytes for the data length
        std::size_t bytesread = blob.DirectRead(offset,databuf+4,len);
        Blex::putu32lsb(databuf,bytesread);
        iobuf->Unreserve(len-bytesread);
        return RPCResponse::Respond;
}

// Connection-specific
RPCResponse::Type Connection::RemoteResetConnection(IOBuffer *iobuf, TransData *IODEBUGONLYARG(trans))
{
        IODEBUG(trans, "Reset connection");
        ResetConnection(false);
        iobuf->ResetForSending();

        // ResetConnection puts us back in JustConnected, but we need to be in Ready (handshake won't be repeated anymore)
        connstate = ConnectionState::Ready;
        iobuf->FinishForRequesting(ResponseOpcode::Reset);

        return RPCResponse::RespondAsync;
}

RPCResponse::Type Connection::RemoteSQLCommand(IOBuffer *iobuf, TransData *trans)
{
        EnsureTransactionOpened(trans);

//        TransView &tview = trans.GetTransView();
        std::pair<uint8_t const*,uint8_t const *> msg = iobuf->ReadBinary();
        std::string cmd(reinterpret_cast<char const*>(msg.first), msg.second-msg.first);
        IODEBUG(trans, "SQLCommand " << cmd);

        if (AnyResultSetsActive(trans))
            throw Exception(ErrorInvalidArg,"SQL commands may not be given within a SELECT, UPDATE or DELETE.");

        if (GetBackend().GetParamRPCInfo())
            GetBackend().SetTransactionInfoRPCInfo(trans->transref.get(), cmd);

        RPCServerConnControl conncontrol(trans);

        std::shared_ptr<TempResultSet> sql_results;
        sql_results.reset(new TempResultSet(trans->transref.get()));
        bool reload_metadata = trans->transref->DoSQLCommand(cmd,sql_results.get(), &conncontrol);
        ResultSet &query = RegisterResultSet(sql_results, trans);

        iobuf->ResetForSending();
        iobuf->Write<bool>(reload_metadata);

        sql_results.reset(); //just drop our reference to make sure that any destruction can take place

#ifndef IODEBUGGING
        SendResultSetStart(iobuf, query, true); //ADDME: Why specify the sql_results gain? I just registered it?
#else
        unsigned result_count = SendResultSetStart(iobuf, query, true);
        IODEBUGPRINT(" Results: " << result_count);
#endif
        if (query.is_finished)
        {
                IODEBUGPRINT(" (Query ended)");
                RemoveResultSet(query.query_id);
        }

        return RPCResponse::Respond;
}

RPCResponse::Type Connection::RemoteScanStart(IOBuffer *iobuf, TransData *trans)
{
        //Start parsing the query itself
        uint32_t metadata_version = iobuf->Read<uint32_t>();
        bool for_updating = iobuf->Read<uint8_t>();
        bool require_info = iobuf->Read<uint8_t>();
        std::string origin = iobuf->Read< std::string >();

        IODEBUG(trans, "ScanStart metadataversion: " << metadata_version << " for_updating: " << for_updating << " require_info: " << require_info << " origin: " << origin);

        EnsureTransactionExists(trans);

        if (for_updating)
        {
                if (trans->is_readonly)
                    throw Exception(ErrorInvalidArg, "UPDATE or DELETE issued in a readonly-transaction");
                if (!trans->transref.get())
                    throw Exception(ErrorInvalidArg,"This operation requires a transaction, you may need to 'BeginWork'");
        }
        else if (!trans->transref.get())
        {
                IODEBUGPRINTSO("Reactivating transaction");
                ActivateTransaction(trans, false);
        }

        if (trans->transref->GetMetadata().GetVersionId() != metadata_version)
          throw Exception(ErrorWrongMetadataVersion, "Wrong metadata version specified in a scan; retrieve the current version");

        // Get a reference to the transaction (make sure it won't be destroyed during this
        BackendTransactionRef btrans = trans->transref;

        std::shared_ptr< ScannerResultSet > scanner;
        scanner.reset(new ScannerResultSet(*btrans, for_updating, trans));

        bool need_rpcinfo = GetBackend().GetParamRPCInfo();
        Blex::DateTime stats_start = need_rpcinfo ? Blex::DateTime::Now() : Blex::DateTime::Invalid();

        ResultSet &query = RegisterResultSet(scanner, trans);

        try
        {
                scanner->query.max_returned_rows = std::min<uint32_t>(Scanner::CacheSize, iobuf->Read<uint32_t>());
                if (scanner->query.max_returned_rows == 0)
                    throw Exception(ErrorInvalidArg,"Illegal number of maximum returned rows");

                DecodeQuery(iobuf, scanner->query, trans->transref.get());

                // Optimize
                OptimizeFase2(scanner->query);

                // Check whether the selected columns are all selectable; all other checks are done by the scanner.
                for (std::vector< NeededColumn >::iterator it = scanner->query.columns.begin(); it != scanner->query.columns.end(); ++it)
                {
                        if (it->columnselected && !btrans->HasPrivilege(it->columnselected->object_id, Privilege::Column_Select))
                            throw Exception(ErrorReadAccessDenied, "Not sufficient privileges to select " + it->columnselected->GetPrettyName());
                }

                // Initialize query
                scanner->query.scanner.NextRow();

                if (need_rpcinfo)
                {
                        Backend::QueryInfo queryinfo;
                        queryinfo.transid = trans->transref->GetTransId();
                        queryinfo.starttime = stats_start;
                        queryinfo.plan = scanner->query.scanner.DumpPlan();
                        queryinfo.origin = origin;

                        query.statsqueryid = GetBackend().SetTransactionInfoRPCQuery(trans->transref.get(), queryinfo);
                }

                iobuf->ResetForSending();

                //BCB bug; declarations AFTER a throw location may mess stuff up
                {
                        IODEBUG(trans, "ScanStart q:" << query.query_id << " (type: "<< (for_updating ? "UPDATE" : "SCAN") << ")");

                        /* Release our reference to the scanner, to make sure no references to the
                           underlying transaction are kept until RemoveResultSet is called */
                        scanner.reset();

#ifndef IODEBUGGING
                        SendResultSetStart(iobuf, query, require_info);
#else
                        unsigned result_count = SendResultSetStart(iobuf, query, require_info);
                        IODEBUGPRINT(" Results: " << result_count);
#endif
                        if (need_rpcinfo)
                        {
                                uint32_t diff = (Blex::DateTime::Now() - stats_start).GetMsecs();
                                GetBackend().ModifyTransactionInfoQueryData(query.statsqueryid, 0, diff);
                        }

                        if (query.is_finished)
                        {
                                IODEBUGPRINT(" (Query ended)");
                                RemoveResultSet(query.query_id); // May close the underlying transaction.
                        }
                }
        }
        catch (Exception &)
        {
                RemoveResultSet(query.query_id); // May close the underlying transaction.
                throw;
        }

        return RPCResponse::Respond;
}

RPCResponse::Type Connection::RemoteRecordInsert(IOBuffer *iobuf, TransData *trans)
{
        EnsureTransactionOpened(trans);

        TableId tableid;

        iobuf->ReadIn(&tableid);

        BackendTransaction &ttrans = *trans->transref;

        const TableDef *tabledef=ttrans.GetMetadata().GetTableDef(tableid);
        if (!tabledef)
            throw Exception(ErrorInvalidArg,"Table does not exist");

        IODEBUG(trans, "InsertRecord " << tabledef->name);

        iobuf->ReadIn(&scratch_record);
        iobuf->ResetForSending();

        switch (trans->transref->GetState())
        {
        case TransactionState::Normal:
                {
                        // Check all cells if they really exist (and check blobs for accessibility)
                        unsigned cellcount = scratch_record.GetNumCells();
                        for (unsigned idx = 0; idx < cellcount; ++idx)
                        {
                                ColumnId col_id = scratch_record.GetColumnIdByNum(idx);
                                ColumnDef const *coldef = tabledef->GetColumnDef(col_id);
                                if (!coldef)
                                    throw Exception(ErrorInvalidArg,"Column does not exist");

                                if (coldef->type == TBlob)
                                    CheckBlobAccessible(&blobuser, scratch_record.GetCell(col_id).Blob());
                        }

                        ttrans.InsertRecord(*tabledef,scratch_record,false,false);
                        if (!AnyResultSetsActive(trans))
                            trans->transref->FinishCommand();
                } break;
        case TransactionState::ReadOnlyAfterError:    return RPCResponse::Respond; // ignore
        case TransactionState::ReadOnly:              throw Exception(ErrorInvalidArg,"INSERT issued in a readonly-transaction");
        }

        return RPCResponse::Respond;
}

void Connection::DecodeQuery(IOBuffer *src, ScannerQuery &query, BackendTransaction *trans)
{
        //FIXME: This is extremely dangerous! Reading in search2 without validating can cause clients to crash us!
        uint32_t limit = src->Read<uint32_t>();
        if (limit)
            query.scanner.SetLimit(limit);

        unsigned numtables=src->Read<uint32_t>();
        if (numtables==0)
            throw Exception(ErrorInvalidArg,"No tables inside searchdata structure");

        //ADDME: Code could be somewhat simplified (and immediate validation possible) by merging needed_columns with AddTable call

        // Read in the requested tables
        for (unsigned i=0;i<numtables;++i)
        {
                TableId tableid = src->Read<int32_t>();

                TableDef const *table = trans->GetMetadata().GetTableDef(tableid);
                if (!table)
                    throw Exception(ErrorInvalidArg,"No such table #" + Blex::AnyToString(tableid));

                query.scanner.AddTable(table);
        }

        query.has_table_select_right.resize(numtables);

        unsigned numitems=src->Read<uint32_t>();
        for (unsigned i=0;i<numitems;++i)
        {
                uint32_t tableindex = src->Read<uint32_t>();
                uint32_t right_tableindex = src->Read<uint32_t>();
                uint8_t searchtype = src->Read<uint8_t>();
                SearchRelationType relationtype = SearchRelationType (src->Read<uint8_t>());
                bool case_sensitive = src->Read<bool>();
                uint16_t columnid = src->Read<uint16_t>();

                if (tableindex >= numtables)
                    throw Exception(ErrorInvalidArg,"First tableindex in search structure is out of range");
                if (right_tableindex >= numtables)
                    throw Exception(ErrorInvalidArg,"Second tableindex in search structure is out of range");
                if (!columnid)
                    throw Exception(ErrorInvalidArg,"Invalid column id");
                if (searchtype == 0) //Single item
                {
                        std::pair<const uint8_t*, const uint8_t*> searchdata = src->ReadBinary();
                        uint32_t searchsize = std::distance(searchdata.first, searchdata.second);
                        if (searchsize >= MaxColumnSize)// && relationtype != SearchIn) // SearchIn sends multiple items, and can easily overflow max column size
                            throw Exception(ErrorInvalidArg,"Search data exceeds maximum size");

                        query.scanner.AddRawSearch(tableindex,columnid,searchsize,searchdata.first,relationtype,case_sensitive);
                }
                else if (searchtype==1) //join
                {
                        uint16_t columnid2 = ColumnId(src->Read<uint16_t>());
                        if (!columnid2)
                            throw Exception(ErrorInvalidArg,"Invalid column id");
                        query.scanner.AddJoin(tableindex,columnid,false, right_tableindex,columnid2,false, relationtype,case_sensitive);
                }
                else
                {
                        throw Exception(ErrorInvalidArg,"Invalid search type");
                }
        }

        //ADDME: Reorganizing the transmitted format would allow us to skip one of the for loops
        uint32_t columns_num = src->Read<uint32_t>();
        query.columns.resize(columns_num);
        for (unsigned idx = 0; idx < columns_num; ++idx)
        {
                unsigned tableindex = src->Read<uint32_t>();
                ColumnId columnid = src->Read<uint16_t>();
                query.columns[idx].fases = (DBRecordSendType)src->Read<uint8_t>();

                TableDef const *table = query.scanner.GetTable(tableindex);
                ColumnDef const *column = NULL;
                if(columnid != 0)
                {
                        column = table->GetColumnDef(columnid);
                        if (!column)
                            throw Exception(ErrorInvalidArg,"No such column");
                }

                query.columns[idx].tableindex = tableindex;
                query.columns[idx].columnselected =column;
        }
}

void Connection::OptimizeFase2(ScannerQuery &query)
{
        /** Optimize unneeded fase2 stuff away; if we can send it all (cheaply) and save
            rpc's we like it

            Strategy: if not updating we send max 3 columns extra (only non-dynamics!) */
        if (query.scanner.CanUpdate())
            return;

        unsigned fase2_cols = 0;
        for (std::vector< NeededColumn >::iterator it = query.columns.begin(); it != query.columns.end(); ++it)
        {
                if (it->fases & DBRSTFase2)
                {
                        if (++fase2_cols > 3)
                            return;

                        // Only non-dynamics
                        if (it->columnselected && TypeIsDynamic(it->columnselected->type))
                            return;
                }
        }

        // We may optimize; remove fase2 stuff, put them in fase1
        for (std::vector< NeededColumn >::iterator it = query.columns.begin(); it != query.columns.end(); ++it)
            if (it->fases & DBRSTFase2)
                it->fases = DBRSTFase1;
}


std::string Connection::GetConnectionName(TransData *trans)
{
        std::string str = "Connection " + Blex::AnyToString(this);
        if (trans)
            str += "-" + Blex::AnyToString(trans->external_id);
        return str;
}

//--------------------------------------------------------------------------
//
// Cell sender
//
//--------------------------------------------------------------------------

CellSender::~CellSender()
{
        // Check if all reported cells have been sent (throwing an exception is acceptable however)
//        assert(std::uncaught_exception() || cellcount == 0); /* FIXME: metadata integrity tests hit this assertion once, why? Missing internal column also triggers it */
}

void CellSender::ReportCellCount(unsigned count)
{
        cellcount = count;
        iobuf.Write<uint32_t>(cellcount);
        bytessent += 4;
}

void CellSender::SendRaw(unsigned datalen, uint8_t const *data, uint16_t columnnr)
{
        assert(cellcount > 0);

        iobuf.Write<uint16_t>(columnnr);
        iobuf.WriteBinary(datalen, data);
        bytessent += datalen;
        bytessent += 4;

        --cellcount;
}

void CellSender::SendCell(Cell const &cell, ColumnTypes type, uint16_t columnnr, void *blobcontext)
{
        if (type == TBlob)
        {
                if(cell.Blob() != 0)
                {
                        blobuser.MarkAsInuse(cell.Blob(), blobcontext);
                        if(cell.Size() == 4 || cell.Size()==8 || cell.Size()==12) //this blob needs an upgrade (FIXME: Verwijder case 12, voor arnold's database)
                        {
                                IODEBUGPRINTSO("Upgrading blob data in transit");
                                uint8_t upgraded_blobdata[16];
                                Blex::putu32lsb(upgraded_blobdata, cell.Blob());
                                memset(upgraded_blobdata+4, 0, 4);
                                Blex::putu64lsb(upgraded_blobdata+8, blobuser.GetBlobLength(cell.Blob()));
                                SendRaw(16, upgraded_blobdata, columnnr);
                                return;
                        }
                }
                else if(cell.Size()==4 || cell.Size()==8)
                {
                        IODEBUGPRINTSO("Correcting 4/8-byte 0 blob");
                        SendRaw(0, NULL, columnnr);
                        return;
                }
        }

        SendRaw(cell.Size(), cell.Begin(), columnnr);
}

void CellSender::SendInteger(int32_t value, uint16_t columnnr)
{
        uint8_t buf[4];
        Blex::puts32lsb(&buf, value);

        SendRaw(4, buf, columnnr);
}

//--------------------------------------------------------------------------
//
// Transdata
//
//--------------------------------------------------------------------------
TransData::TransData()
: type(DBTransactionType::Normal)
, is_readonly(false)
, is_explicitly_started(false)
, is_initialized(false)
{
}

//--------------------------------------------------------------------------
//
// Transdata
//
//--------------------------------------------------------------------------
RPCServerConnControl::RPCServerConnControl(TransData *_transdata)
: transdata(_transdata)
{
}

void RPCServerConnControl::SetTransactionClientName(std::string const &name)
{
        transdata->clientname = name;
}


} //end namespace Database

namespace Blex
{
template <> void AppendAnyToString(Database::ConnectionState::Type const &in, std::string *appended_string)
{
        using namespace Database::ConnectionState;
        switch(in)
        {
        case JustConnected:             *appended_string="justconnected"; break;
        case SentChallenge:             *appended_string="sentchallenge"; break;
        case LastChangeChallenge:       *appended_string="lastchangechallenge"; break;
        case Ready:                     *appended_string="ready"; break;
        case Approved:                  *appended_string="approved"; break;
        case ShuttingDown:              *appended_string="shuttingdown"; break;
        }
}
} // End namespace Blex
