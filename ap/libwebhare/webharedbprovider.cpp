#include <ap/libwebhare/allincludes.h>


//---------------------------------------------------------------------------
#include "webharedbprovider.h"

#include <harescript/compiler/utilities.h>
#include <harescript/vm/hsvm_context.h>
#include <harescript/vm/errors.h>
#include <harescript/vm/baselibs.h>
#include <ap/libwebhare/whcore_hs3.h>
#include <harescript/vm/hsvm_dllinterface_blex.h>
#include <blex/logfile.h>

namespace HareScript
{
namespace SQLLib
{
namespace WHDB
{

class Connection;


/** Listener outputobject (used to be able to wait on connections, for
    notifications, asks and tells)
*/
class ListenWaiter : public HareScript::OutputObject
{
    public:
        inline ListenWaiter(HSVM *vm, Connection *conn) : OutputObject(vm, "WHDB listener"), conn(conn) { }

        virtual bool AddToWaiterRead(Blex::PipeWaiter &waiter);
        virtual SignalledStatus IsReadSignalled(Blex::PipeWaiter *waiter);

    private:
        Connection *conn;
};

class WHDBBlobData
{
    public:
        WHDBBlobData();
        ~WHDBBlobData();

        void Register(Connection *myconn, Database::BlobId blobid, Blex::FileOffset bloblength);

        Connection *myconn;
        Database::BlobId blobid;
        Blex::FileOffset bloblength;

    private:
        void DeRegister();
};


/** This class holds all data that is associated with a transact connection
    to the database
*/
class Connection
{
    public:
        /** Constructor
        */
        Connection(VirtualMachine *vm);

        /** Destructor
        */
        ~Connection();

        /** Marks a blob as persistent
            @param id Blob to mark persistent
        */
        void MarkBlobPersistent(Database::BlobId id);

        /** Marks a blob as persistent
            @param id Blob to mark persistent
        */
        void MarkBlobUnused(Database::BlobId id);

        /** Flushes all pending markings. Call before committing or rolling back
            a transaction (and before ending work).
        */
        void FlushPendingBlobMarkings();

        /** Virtual machine for this connection
        */
        VirtualMachine *vm;

        /** Physical transaction connection to the database; always set.
        */
        std::unique_ptr< Database::TransactConnection > dbconn;

        /** List of open transactions; automatically administered by
            transaction object constructors and destructors
        */
        std::set< WebHareDBTransaction * > open_transactions;

        /** Output object used for listeners. Always set with a valid object.
        */
        std::unique_ptr< ListenWaiter > listener;

        /** Blobs associated with this connection
        */
        std::set< WHDBBlobData * > blobs;

        /** Client name for this connection
        */
        std::string clientname;

        /** Translates a database cell to a corresponding HareScript value
            @param id_set Variable that will contain the resulting variable
            @param cell Cell to translate
            @param type Type of the data in the cell
        */
        void SetFromField(VirtualMachine *vm, VarId id_set, Database::Cell const &cell, Database::ColumnTypes type);

        void SetToField (VirtualMachine *vm, Database::WritableRecord *rec, VarId id, Database::ColumnTypes type, Database::ColumnId columnid, Database::TransFrontend *dbtrans);

    private:
        /** Schedules to send  marking for a blob (either persistent or as unused)
            to the database at the next closing of a transaction
            @param blobid Id of the blob to mark
            @param persistent If true, mark blob as persistent, if false mark as unused
        */
        void ScheduleBlobMarking(Database::BlobId blobid, bool persistent);

        /** Reference counters for blobs
        */
        std::map< Database::BlobId, unsigned > blob_refcounts;

        /** Pending markings as persistent or as unused
        */
        std::map< Database::BlobId, bool > pending_markings;
};

/** This class describes a direct cursor query
*/
class DirectCursorQuery
{
    private:
        /// Associated connection
        Connection *conn;

        /// Associated webhare transaction
        WebHareDBTransaction *driver;

        /// Used scanner
        std::shared_ptr< Database::ResultSetScanner > scan;

        /// Did we already receive information about the contents in the resultset
        bool got_info;

        /// If got_info is true, this contains info about the resultset contents
        std::vector< std::pair< Database::ClientColumnInfo, ColumnNameId > > info;

        /// Current row is active?
        bool is_active;

        /// Current row was deleted?
        bool is_deleted;

        /// Is this an updating query?
        bool is_update;

    public:
        void Open(WebHareDBTransaction *_driver, std::string const &table, std::vector< std::string > const &columns, bool all_columns, bool for_updating);
        void OpenForNotifications(Connection *_conn, std::unique_ptr< Database::ResultSetScanner > *scanner);
        void OpenEmpty();
        bool Next();
        void GetRow(VarId record);
        void Update(VarId record);
        void Delete();
        void Close();
        void NoteTransactionClose(WebHareDBTransaction *driver);
        static void Insert(WebHareDBTransaction *driver, std::string const &table, VarId record);
};

/** The context data structure contains all the data that needs to be stored
    for a single VM instance
*/
class WHDBProviderContextData
{
        public:
        /// Construct new provider context data
        WHDBProviderContextData();
        ~WHDBProviderContextData();

        /// Associated virtual machine
        VirtualMachine *vm;

        /// Remote database structure, used to setup new connections (this means we can't have connections to multiple whdb databases, hmm).
        Database::TCPFrontend *remotedb;

        typedef IdMapStorage< DirectCursorQuery > DCQueries;

        /// List of direct cursor queries
        DCQueries dcqueries;

        /// Primary connection to thedatabase
        std::unique_ptr< Connection > primary_conn;

        /// Default client name used to construct new connections
        std::string defaultclientname;

        /** Kills all transactions associated with the current connection
            (except keep_this_transaction)
            @param keep_this_transaction The transaction with this id ain't killed.
        */
        void KillConnectionTransactions(signed keep_this_transaction);

        /** Construct a new primary connections; fails if one already exists (unless old_conn is set; then
            the old connection is stored there.
        */
        void ConstructNewConnection(std::string const &clientname, std::unique_ptr< Connection > *old_conn);
};

typedef Blex::Context< WHDBProviderContextData, 3, void > WHDBProviderContext;
static const unsigned WHDBBlobContextId = 17;

/* Webhare internal database blob */
class WHDBBlob : public BlobBase
{
    private:
        Database::BlobId blobid;
        Blex::FileOffset bloblength;

        class MyOpenedBlob: public OpenedBlobBase< WHDBBlob >
        {
            public:
                MyOpenedBlob(WHDBBlob &_blob) : OpenedBlobBase< WHDBBlob >(_blob) {}

                std::size_t DirectRead(Blex::FileOffset startoffset, std::size_t numbytes, void *buffer);
        };

    public:
        /** Constructor */
        WHDBBlob(VirtualMachine *_vm, Database::BlobId blobid, Blex::FileOffset bloblength);
        ~WHDBBlob();

        std::unique_ptr< OpenedBlob > OpenBlob();
        Blex::FileOffset GetCacheableLength();
        Blex::DateTime GetModTime();
        std::string GetDescription();
};

WHDBBlob::WHDBBlob(VirtualMachine *vm, Database::BlobId _blobid, Blex::FileOffset _bloblength)
: BlobBase(vm)
, blobid(_blobid)
, bloblength(_bloblength)
{
}

WHDBBlob::~WHDBBlob()
{
}

std::size_t WHDBBlob::MyOpenedBlob::DirectRead(Blex::FileOffset startoffset, std::size_t numbytes, void *buffer)
{
        WHDBBlobData *blobinfo = static_cast< WHDBBlobData * >(blob.keeper.GetContext(WHDBBlobContextId, false));
        if (!blobinfo || !blobinfo->myconn)
            throw VMRuntimeError (Error::DatabaseException, "Database error: Blob from closed transaction connection used");

        return blobinfo->myconn->dbconn->ReadBlobFromDbase(blob.blobid, startoffset, buffer, std::min<unsigned>(numbytes,Database::MaxBlobReadSize), false);
}

std::unique_ptr< OpenedBlob > WHDBBlob::OpenBlob()
{
        WHDBBlobData *blobinfo = static_cast< WHDBBlobData * >(keeper.GetContext(WHDBBlobContextId, false));
        if (!blobinfo || !blobinfo->myconn)
            throw VMRuntimeError (Error::DatabaseException, "Database error: Blob from closed transaction connection used");

        return std::unique_ptr< OpenedBlob >(new MyOpenedBlob(*this));
}

Blex::DateTime WHDBBlob::GetModTime()
{
        return Blex::DateTime::Invalid();
}

Blex::FileOffset WHDBBlob::GetCacheableLength()
{
        return bloblength;
}

std::string WHDBBlob::GetDescription()
{
        return "whdb blob " + Blex::AnyToString(blobid);
}

// -----------------------------------------------------------------------------
//
// DBRuntimeError
//
// -----------------------------------------------------------------------------

DBRuntimeError::DBRuntimeError(DBError::Type _code,std::string const &_message,std::string const &_table,std::string const &_column)
: code(_code)
, table(_table)
, column(_column)
, message(_message)
{
}


// -----------------------------------------------------------------------------
//
// ListenWaiter
//
// -----------------------------------------------------------------------------

bool ListenWaiter::AddToWaiterRead(Blex::PipeWaiter &waiter)
{
        return conn->dbconn->AddToWaiterRead(waiter);
}

OutputObject::SignalledStatus ListenWaiter::IsReadSignalled(Blex::PipeWaiter *waiter)
{
        if (!waiter)
            return Unknown;

        return conn->dbconn->IsReadSignalled(*waiter) ? Signalled : NotSignalled;
}


// -----------------------------------------------------------------------------
//
// Connection
//
// -----------------------------------------------------------------------------

// Constructor; doesn't need to much work
Connection::Connection(VirtualMachine *_vm)
: vm(_vm)
{
}

// Destructor; needs to de-associate all blobs
Connection::~Connection()
{
        for (std::set< WHDBBlobData * >::iterator it = blobs.begin(); it != blobs.end(); ++it)
            (*it)->myconn = NULL;

        if (!open_transactions.empty())
        {
                Blex::SafeErrorPrint("Shutdown ordering error; webhare db connection deleted before all transaction objects were deleted\n");
                Blex::FatalAbort();
        }
}

void Connection::ScheduleBlobMarking(Database::BlobId blobid, bool persistent)
{
        std::map< Database::BlobId, bool >::iterator it = pending_markings.find(blobid);
        if (it == pending_markings.end()) // No pending mark
        {
                pending_markings.insert(std::make_pair(blobid, persistent));
                if (open_transactions.empty())
                    FlushPendingBlobMarkings();
        }
        else
        {
                assert(it->second == !persistent);
                pending_markings.erase(it); // This cancels the current pending mark
        }
}

void Connection::MarkBlobPersistent(Database::BlobId blobid)
{
        if (blob_refcounts[blobid]++ == 0)
            ScheduleBlobMarking(blobid, true);
}

void Connection::MarkBlobUnused(Database::BlobId blobid)
{
        if (--blob_refcounts[blobid] == 0)
            ScheduleBlobMarking(blobid, false);
}

void Connection::FlushPendingBlobMarkings()
{
        if (!pending_markings.empty() && dbconn.get())
        {
                try
                {
                        std::vector< Database::BlobId > blobids;
                        blobids.reserve(pending_markings.size());

                        for (std::map< Database::BlobId, bool >::const_iterator it = pending_markings.begin(), end = pending_markings.end(); it != end; ++it)
                            if (it->second)
                                blobids.push_back(it->first);
                        if (!blobids.empty())
                            dbconn->MakeBlobsPersistent(blobids);

                        blobids.clear();
                        for (std::map< Database::BlobId, bool >::const_iterator it = pending_markings.begin(), end = pending_markings.end(); it != end; ++it)
                            if (!it->second)
                                blobids.push_back(it->first);
                        if (!blobids.empty())
                            dbconn->MakeBlobsUnused(blobids);
                }
                catch (Database::Exception &)
                {
                        // ADDME: check if swallowing exceptions is the right thing to do here
                }
                pending_markings.clear();
        }
}


// -----------------------------------------------------------------------------
//
// WHDBProviderContextData
//
// -----------------------------------------------------------------------------

WHDBProviderContextData::WHDBProviderContextData()
: vm(0)
, remotedb(0)
{
}

WHDBProviderContextData::~WHDBProviderContextData()
{
}

void WHDBProviderContextData::KillConnectionTransactions(signed keep_this_transaction)
{
        // Only kill the connection if one is present
        if (primary_conn.get())
        {
                // Disable all direct cursor queroes
                for (WHDBProviderContextData::DCQueries::iterator it = dcqueries.begin(); it != dcqueries.end(); ++it)
                    it->NoteTransactionClose(0);

                // We need to destroy every transaction of this connection (except keep_this_transaction)
                bool any_killed;
                do
                {
                        any_killed = false;
                        for (std::set< WebHareDBTransaction * >::iterator it = primary_conn->open_transactions.begin(); it != primary_conn->open_transactions.end(); ++it)
                        {
                                if ((*it)->sqllib_transid != keep_this_transaction)
                                {
                                        WebHareDBTransaction::Unregister(vm->GetSQLSupport(), *it);
                                        any_killed = true;
                                        break;
                                }
                        }
                }
                while (any_killed);
        }
}

void WHDBProviderContextData::ConstructNewConnection(std::string const &clientname, std::unique_ptr< Connection > *old_conn)
{
        if (primary_conn.get() && old_conn == 0)
            throw VMRuntimeError (Error::DatabaseException, "Database error: Cannot set a new primary connection when already one exists");

        /// Buildup a new connection, set it when it fully finished
        std::unique_ptr< Connection > new_conn;
        new_conn.reset(new Connection(vm));
        new_conn->dbconn.reset(remotedb->BeginTransactConnection(clientname.empty() ? defaultclientname : clientname));
        new_conn->listener.reset(new ListenWaiter(*vm, new_conn.get()));
        new_conn->clientname = clientname;

        if (old_conn)
            old_conn->reset(primary_conn.release());

        primary_conn.reset(new_conn.release());
}

void SetWHDBProviderDefaultClientName(HSVM *vm, std::string const &name)
{
        WHDBProviderContext context(HareScript::GetVirtualMachine(vm)->GetContextKeeper());
        context->defaultclientname = name;
}

// -----------------------------------------------------------------------------
//
//   WHDBBlob
//
// -----------------------------------------------------------------------------

WHDBBlobData::WHDBBlobData()
: myconn(NULL)
{
}

void WHDBBlobData::DeRegister()
{
        myconn->blobs.erase(this);
        myconn->MarkBlobUnused(blobid);
}

void WHDBBlobData::Register(Connection *newconn, Database::BlobId newblobid, Blex::FileOffset newbloblength)
{
        if(myconn)
            DeRegister();

        blobid = newblobid;
        bloblength = newbloblength;

        myconn = newconn;
        myconn->blobs.insert(this);
        myconn->MarkBlobPersistent(blobid);
}

WHDBBlobData::~WHDBBlobData()
{
        // This blob may have been de-associated
        if (myconn)
            DeRegister();
}

/*void WHDBBlob::OpenTheStream(std::unique_ptr< Blex::RandomStream > *stream)
{
        if (!conn)
            throw VMRuntimeError (Error::DatabaseException, "Database error: Blob from closed transaction connection used");

        try
        {
                stream->reset(conn->dbconn->OpenBlob(blobid, len));
        }
        catch (Database::Exception &e)
        {
                throw VMRuntimeError (Error::DatabaseException, std::string("Database error: ") + e.what());
        }
}
Blex::FileOffset WHDBBlob::GetLength()
{
        return len;
}
  */

// -----------------------------------------------------------------------------
//
//   Database type conversion functions
//
//
Database::SearchRelationType GetSearchRelation(DBConditionCode::_type code)
{
        switch (code)
        {
        case DBConditionCode::Less:               return Database::SearchSmaller;
        case DBConditionCode::LessEqual:          return Database::SearchSmallerEqual;
        case DBConditionCode::Equal:              return Database::SearchEqual;
        case DBConditionCode::BiggerEqual:        return Database::SearchBiggerEqual;
        case DBConditionCode::Bigger:             return Database::SearchBigger;
        case DBConditionCode::UnEqual:            return Database::SearchUnEqual;
        case DBConditionCode::Like:               return Database::SearchLike;
        case DBConditionCode::In:                 return Database::SearchIn;
        default:
            throw VMRuntimeError (Error::DatabaseException, "Database error: Invalid search relation type");
        }
}


// -----------------------------------------------------------------------------
//
//   WebHareDBTransaction
//
//

WebHareDBTransaction::WebHareDBTransaction(Connection *conn, std::unique_ptr< Database::TransFrontend > &trans)
: DatabaseTransactionDriverInterface(conn->vm)
, whdbconn(conn)
, dbase_trans(std::move(trans))
{
        description.supports_block_cursors = true;
        description.max_joined_tables = 32;
        description.supports_single = true;
        description.supports_data_modify = true;
        description.supports_nulls = false;
        description.needs_locking_and_recheck = true;
        description.needs_uppercase_names = true;

        //DEBUGPRINT("Creating WHDB transaction " << this);
        conn->open_transactions.insert(this);
}

WebHareDBTransaction::~WebHareDBTransaction()
{
        //DEBUGPRINT("Destroying WHDB transaction " << this);

        WHDBProviderContext context(vm->GetContextKeeper());
        for (WHDBProviderContextData::DCQueries::iterator it = context->dcqueries.begin(); it != context->dcqueries.end(); ++it)
            it->NoteTransactionClose(this);

        // Kill all outstanding queries, they don't handle their transaction disappearing very well.
        queries.Clear();

        whdbconn->open_transactions.erase(this);
        whdbconn->FlushPendingBlobMarkings();
}

void WebHareDBTransaction::SetVirtualMachine(VirtualMachine *_vm)
{
        vm = _vm;
}

void Connection::SetFromField (VirtualMachine *vm, VarId id_set, Database::Cell const &cell, Database::ColumnTypes type)
{
        VarMemory &varmem = vm->GetStackMachine();
        switch (type)
        {
        case Database::TInteger:
                varmem.SetInteger(id_set, cell.Integer());
                break;

        case Database::TMoney:
                varmem.SetMoney(id_set, cell.Money());
                break;

        case Database::TInteger64:
                varmem.SetInteger64(id_set, cell.Integer64());
                break;

        case Database::TFloat:
                varmem.SetFloat(id_set, cell.Float());
                break;

        case Database::TBoolean:
                varmem.SetBoolean(id_set, cell.Boolean());
                break;

        case Database::TText:
                varmem.SetString(id_set, reinterpret_cast<const char *>(cell.Begin()), reinterpret_cast<const char *>(cell.End()));
                break;

        case Database::TBlob:
                {
                        if (cell.Size()!=0 && cell.Size()!=16)
                            throw VMRuntimeError (Error::DatabaseException, "Database error: Should not receive " + Blex::AnyToString(cell.Size()) + " -byte database blobs");

                        Database::BlobId dbblobid = cell.Blob();

                        if (dbblobid && cell.BlobLength())
                        {
                                varmem.SetBlob(id_set, BlobRefPtr(new WHDBBlob(vm, dbblobid, cell.BlobLength())));
                                WHDBBlobData * blobdata = static_cast<WHDBBlobData * >(HSVM_BlobContext(*vm, id_set, WHDBBlobContextId, true));
                                blobdata->Register(this, dbblobid, cell.BlobLength());
                        }
                        else
                        {
                                vm->GetStackMachine().InitVariable(id_set,VariableTypes::Blob);
                        }
                }
                break;

        case Database::TDateTime:
                varmem.SetDateTime(id_set, cell.DateTime());
                break;

        case Database::TTable:
                varmem.SetInteger(id_set, cell.Integer());
                break;

        case Database::TRole:
                varmem.SetInteger(id_set, cell.Integer());
                break;

        default:
            throw VMRuntimeError (Error::DatabaseException, "Database error: Cannot convert database column type " + Blex::AnyToString<int>(type) + " into a HareScript type");
        }
}

void Connection::SetToField (VirtualMachine *vm, Database::WritableRecord *rec, VarId id, Database::ColumnTypes type, Database::ColumnId columnid, Database::TransFrontend *dbtrans)
{
        StackMachine &varmem = vm->GetStackMachine();
        switch (type)
        {
        case Database::TInteger:
                varmem.CastTo(id,VariableTypes::Integer);
                rec->SetInteger(columnid,varmem.GetInteger(id));
                break;

        case Database::TMoney:
                varmem.CastTo(id,VariableTypes::Money);
                rec->SetMoney(columnid,varmem.GetMoney(id));
                break;

        case Database::TInteger64:
                varmem.CastTo(id,VariableTypes::Integer64);
                rec->SetInteger64(columnid,varmem.GetInteger64(id));
                break;

        case Database::TFloat:
                varmem.CastTo(id,VariableTypes::Float);
                rec->SetFloat(columnid,varmem.GetFloat(id));
                break;

        case Database::TBoolean:
                varmem.CastTo(id, VariableTypes::Boolean);
                rec->SetBoolean(columnid,varmem.GetBoolean(id));
                break;

        case Database::TText:
                {
                        varmem.CastTo(id,VariableTypes::String);
                        Blex::StringPair text(varmem.GetString(id));

                        if (text.size() > Database::MaxColumnSize)
                            throw VMRuntimeError (Error::DatabaseException, "Database error: Cannot write strings longer than 4096 characters into database records");

                        rec->SetColumn(columnid,text.size(),reinterpret_cast<const uint8_t*>(text.begin));
                        break;
                }

        case Database::TBlob:
                {
                        varmem.CastTo(id,VariableTypes::Blob);

                        WHDBBlobData * blobdata = static_cast<WHDBBlobData * >(HSVM_BlobContext(*vm, id, WHDBBlobContextId, true));
                        if (blobdata && blobdata->myconn != this) //blob needs to be uploaded to the database first
                        {
                                HareScript::Interface::InputStream instr(*vm, id);
                                Blex::FileOffset len = instr.GetFileLength();
                                if (len > 0) // Don't send empty blob
                                {
                                        if (!dbtrans)
                                            throw VMRuntimeError (Error::DatabaseException, "Database error: Blobs can only be uploaded within a transaction");

                                        try
                                        {
                                                blobdata->Register(this, dbtrans->UploadBlob(instr), len);
                                        }
                                        catch (Database::Exception &e)
                                        {
                                                throw VMRuntimeError (Error::DatabaseException, std::string("Database error: ") + e.what());
                                        }
                                }
                                else
                                {
                                        blobdata=NULL;
                                }
                        }
                        rec->SetBlob(columnid, blobdata ? blobdata->blobid : 0);
                }
                break;

        case Database::TDateTime:
                {
                        varmem.CastTo(id,VariableTypes::DateTime);
                        rec->SetDateTime(columnid,varmem.GetDateTime(id));
                }
                break;

        case Database::TTable:
        case Database::TRole:
                varmem.CastTo(id,VariableTypes::Integer);
                rec->SetInteger(columnid,varmem.GetInteger(id));
                break;

        default:
                throw VMRuntimeError (Error::InternalError, "Database error: No harescript type for column type '" + Blex::AnyToString((int)type));
        }
}

void WebHareDBTransaction::TranslateException(Database::Exception const &e)
{
        std::string clientname = GetClientNamePostfix(&e);

        DBError::Type errorcode;
        int type = 0;
        switch (e.errorcode)
        {
        case Database::ErrorConstraintUnique:       type = 1; errorcode = DBError::UniqueError; break;
        case Database::ErrorConstraintReference:    type = 1; errorcode = DBError::ReferenceError; break;
        case Database::ErrorConstraintNotNull:      type = 1; errorcode = DBError::NotNullError; break;
        case Database::ErrorWriteAccessDenied:      type = 1; errorcode = DBError::AccessError; break;
        case Database::ErrorDeadlock:               type = 1; errorcode = DBError::DeadlockError; break;

        case Database::ErrorIO:
        case Database::ErrorConstraint:
        case Database::ErrorIllegalSQLCommand:
        case Database::ErrorMetadataBad:
            type = 1; errorcode = DBError::OtherError;
            break;

        case Database::ErrorReadAccessDenied:       type = 0; errorcode = DBError::AccessError; break;

        //ADDME: Allow 'safe' handling of Timeout and Disconnect errors

        // Fatal errors
        default:
            type = 0; errorcode = DBError::OtherError;
        }

        DEBUGPRINT("WHDB exception " << e.what() << clientname);

        // to_catch may be empty, default value is WRITE (catch write errors, throw read errors)
        std::string const &to_catch = parameters["CATCH_ERRORS"];

        if ((type == 0 && to_catch != "ALL") || (type == 1 && to_catch == "NONE"))
            throw VMRuntimeError(Error::DatabaseException, e.what() + clientname);

        errors.push_back(DBRuntimeError(
                errorcode,
                e.what(),
                e.tablename,
                e.columnname));
}

bool WebHareDBTransaction::Finish(bool commit)
{
        whdbconn->FlushPendingBlobMarkings();

        if (AnyErrors())
            commit=false;

        if (!dbase_trans.get())
            throw VMRuntimeError (Error::DatabaseException, "Database error: Accessing an already closed transaction" + GetClientNamePostfix(0));

        try
        {
                dbase_trans->Finish(commit);
        }
        catch (Database::Exception &e)
        {
                TranslateException(e);
                commit=false;
        }
        return commit;
}

// -----------------------------------------------------------------------------
//
//   Database query building helpers
//

bool ConstructSingle(VirtualMachine *vm, Database::Client::SearchData &data, SingleCondition const &cond, uint32_t tableindex, Database::ClientColumnInfo const *column)
{
        if (cond.condition == DBConditionCode::In)
        {
                StackMachine &stackm = vm->GetStackMachine();

                if (stackm.GetType(cond.value) != VariableTypes::IntegerArray)
                    return false;

                if (column->type != Database::TInteger)
                    return false;

                unsigned size = stackm.ArraySize(cond.value);
                if (size >= 1024)
                   return false;

                Blex::PodVector< uint8_t > storage;
                storage.resize(4*size);
                uint8_t *begin = storage.begin();

                for (unsigned idx = 0; idx < size; ++idx)
                {
                        Blex::putu32lsb(begin, stackm.GetInteger(stackm.ArrayElementGet(cond.value, idx)));
                        begin+= 4;
                }

                Database::Client::SearchData::Item item = Database::Client::SearchData::Item(
                        tableindex,
                        0,
                        Database::Client::Search::Single(
                                column,
                                std::string(storage.begin(), storage.end()),
                                GetSearchRelation(cond.condition)));
                data.AddSingleCriterium(item.tableindex, item.search);
                return true;
        }

        VariableTypes::Type type = (vm->GetStackMachine().GetType(cond.value));

        switch (type)
        {
        case VariableTypes::Integer:
                {
                        if (column->type != Database::TInteger)
                            return false;

                        Database::Client::SearchData::Item item = Database::Client::SearchData::Item(
                                tableindex,
                                0,
                                Database::Client::Search::Single(
                                        column,
                                        vm->GetStackMachine().GetInteger(cond.value),
                                        GetSearchRelation(cond.condition)));
                        data.AddSingleCriterium(item.tableindex, item.search);
                        return true;
                };
        case VariableTypes::String:
                {
                        if (column->type != Database::TText)
                            return false;

                        Blex::StringPair str = vm->GetStackMachine().GetString(cond.value);
                        Database::Client::SearchData::Item item = Database::Client::SearchData::Item(
                                tableindex,
                                0,
                                Database::Client::Search::SingleString(
                                        column,
                                        str.begin,
                                        str.end,
                                        cond.casesensitive,
                                        GetSearchRelation(cond.condition)));
                        data.AddSingleCriterium(item.tableindex, item.search);
                        return true;
                };
        case VariableTypes::Boolean:
                {
                        if (column->type != Database::TBoolean)
                            return false;

                        bool value = vm->GetStackMachine().GetBoolean(cond.value);
                        Database::Client::SearchData::Item item = Database::Client::SearchData::Item(
                                tableindex,
                                0,
                                Database::Client::Search::Single(
                                        column,
                                        value,
                                        GetSearchRelation(cond.condition)));
                        data.AddSingleCriterium(item.tableindex, item.search);
                        return true;
                };
        case VariableTypes::DateTime:
                {
                        if (column->type != Database::TDateTime)
                            return false;

                        Database::Client::SearchData::Item item = Database::Client::SearchData::Item(
                                tableindex,
                                0,
                                Database::Client::Search::Single(column, vm->GetStackMachine().GetDateTime(cond.value),
                                GetSearchRelation(cond.condition)));
                        data.AddSingleCriterium(item.tableindex, item.search);
                        return true;
                };
        default:
                return false;
        }
}

// -----------------------------------------------------------------------------
//
//   Transaction driver helper functions
//
//
void WebHareDBTransaction::InternalTranslateRecord(SQLQueryData &querydata, Database::Record rec, unsigned tableindex, VarId storageloc, Fase fase, bool clear)
{
        WHDBProviderContext context(vm->GetContextKeeper());
        VarMemory &varmem = querydata.vm->GetStackMachine();

        if (clear)
            varmem.RecordInitializeEmpty(storageloc);

        std::pair< unsigned, unsigned > const &data = querydata.tabledata[tableindex];

        for (unsigned idx = data.first; idx < data.second; ++idx)
        {
                SQLQueryData::Column const &column = querydata.columns[idx];
                if ((column.fases & fase) != 0)
                {
                        Database::Cell thiscell = rec.GetCell(static_cast< uint16_t >(idx));

                        whdbconn->SetFromField(
                                     vm,
                                     varmem.RecordCellCreate(storageloc, column.hs_nameid),
                                     thiscell,
                                     column.type);
                }
        }
}

void WebHareDBTransaction::FillUpdateRecord(SQLQueryData const &querydata, Database::WritableRecord &dbrec, VarId hsrec)
{
        VarMemory &varmem = vm->GetStackMachine();

        for (unsigned idx = 0; idx < varmem.RecordSize(hsrec); ++idx)
        {
                ColumnNameId nameid = varmem.RecordCellNameByNr(hsrec, idx);

                std::map< ColumnNameId, Database::ColumnId >::const_iterator cit = querydata.update_trans.find(nameid);
                if (cit == querydata.update_trans.end())
                    throw VMRuntimeError (Error::DatabaseException, "Database error: Column " + vm->columnnamemapper.GetReverseMapping(nameid).stl_str() + " not found in update list"); // FIXME: better error

                SQLQueryData::Column const &column = querydata.columns[cit->second];

                //ADDME: use field info from tabledef
                whdbconn->SetToField(vm, &dbrec, varmem.RecordCellRefByName(hsrec, nameid), column.type, cit->second, &GetDBTrans());
        }
}

Database::TableInfo const * WebHareDBTransaction::FillInsertRecord(DatabaseQuery const &query, Database::WritableRecord &dbrec, VarId hsrec, std::vector< Database::ClientColumnInfo const * > *columns)
{
        VarMemory &stackm = vm->GetStackMachine();

        columns->clear();

        std::string tablename = query.tables[0].name;
        Blex::ToUppercase(tablename.begin(), tablename.end());

        DBTypeInfo const *typeinfo = query.tables[0].typeinfo;
        Database::TableInfo const *tableinfo = GetDBTrans().GetConfig().GetTableInfo(Blex::StringPair(tablename.begin(), tablename.end()));
        if (tableinfo == 0)
            throw VMRuntimeError (Error::DatabaseException, "Database error: No such table " + query.tables[0].name);

        unsigned size = stackm.RecordSize(hsrec);
        std::string dbase_name;
        for (unsigned idx = 0; idx < size; ++idx)
        {
                ColumnNameId nameid = stackm.RecordCellNameByNr(hsrec, idx);

                DBTypeInfo::Column const *typeinfo_column(0);
                for (auto it = typeinfo->columnsdef.begin(); it != typeinfo->columnsdef.end(); ++it)
                    if (it->nameid == nameid)
                    {
                            typeinfo_column = &*it;
                            break;
                    }

                if (typeinfo_column)
                    dbase_name = typeinfo_column->dbase_name;
                else
                {
                        dbase_name = "__INTERNAL_RECORDID";
                        if (vm->columnnamemapper.GetReverseMapping(nameid).stl_str() != dbase_name)
                            throw VMRuntimeError (Error::DatabaseException, "Database error: No such column " + vm->columnnamemapper.GetReverseMapping(nameid).stl_str() + " in table " + query.tables[0].name + " in table definition");
                }

                Blex::ToUppercase(dbase_name.begin(), dbase_name.end());
                Database::ClientColumnInfo const *columninfo = tableinfo->GetClientColumnInfo(dbase_name, true);
                if (!columninfo)
                    throw VMRuntimeError (Error::DatabaseException, "Database error: No such column " + vm->columnnamemapper.GetReverseMapping(nameid).stl_str() + " in table " + query.tables[0].name + " in the database (table definition is incorrect)");

                //ADDME: use field info from tabledef
                whdbconn->SetToField(vm, &dbrec, stackm.RecordCellRefByName(hsrec, nameid), columninfo->type, (Database::ColumnId)columns->size(), &GetDBTrans());
                columns->push_back(columninfo);
        }
        return tableinfo;
}


void WebHareDBTransaction::Unregister(SQLSupport &sqlsupport, WebHareDBTransaction *trans)
{
        sqlsupport.DeleteTransaction(trans->sqllib_transid);
}

void WebHareDBTransaction::ReconnectDBTransaction(Connection *new_conn)
{
        if (!dbase_trans.get())
            throw VMRuntimeError (Error::DatabaseException, "Database error: Accessing an already closed transaction" + GetClientNamePostfix(0));

        if (whdbconn != new_conn)
        {
                WHDBProviderContext context(vm->GetContextKeeper());
                for (WHDBProviderContextData::DCQueries::iterator it = context->dcqueries.begin(); it != context->dcqueries.end(); ++it)
                    it->NoteTransactionClose(this);

                // Kill all outstanding queries, they don't handle their transaction disappearing very well.
                queries.Clear();

                whdbconn->open_transactions.erase(this);
                new_conn->open_transactions.insert(this);
                whdbconn = new_conn;
        }

        if (!restoredata.is_auto)
            throw VMRuntimeError (Error::DatabaseException, "Database error: Can only reconnect auto-transactions" + GetClientNamePostfix(0));
        if (dbase_trans->IsExplicitlyOpened())
            throw VMRuntimeError (Error::DatabaseException, "Database error: Can not reconnect auto transaction: work has been opened" + GetClientNamePostfix(0));

        dbase_trans.reset(whdbconn->dbconn->BeginTransaction(restoredata.username, restoredata.password, restoredata.clientname, restoredata.readonly, restoredata.is_auto));
}

std::string WebHareDBTransaction::GetClientNamePostfix(Database::Exception const *e)
{
        std::string clientname;
        if (e)
            clientname = e->clientname;
        if (clientname.empty())
            clientname = restoredata.clientname;
        if (!clientname.empty())
            clientname = " (client: " + clientname + ")";

        return clientname;
}

void WebHareDBTransaction::ExecuteInsert(DatabaseQuery const &query, VarId newrecord)
{
        if (!dbase_trans.get())
            throw VMRuntimeError (Error::DatabaseException, "Database error: Accessing an already closed transaction" + GetClientNamePostfix(0));

//        CheckAccess();

        Database::WritableRecord rec;
        std::vector< Database::ClientColumnInfo const * > columns;

        Database::TableInfo const *tableinfo = FillInsertRecord(query, rec, newrecord, &columns);

        // Failed insert is not THAT fatal.
        try
        {
               GetDBTrans().InsertRecord(tableinfo, columns.size(), &columns[0], rec);
        }
        catch (Database::Exception &e)
        {
                TranslateException(e);
        }
}

void WebHareDBTransaction::BuildResultRow(SQLQueryData &query, DatabaseQuery const &dbquery)
{
        unsigned idx = 0;
        unsigned tableidx = 0;
        for (DatabaseQuery::TableSources::const_iterator it = dbquery.tables.begin(); it != dbquery.tables.end(); ++it, ++idx)
        {
                Database::TableInfo const *td = query.sources[idx];

                const DBTypeInfo *typeinfo = it->typeinfo;
                if (!typeinfo)
                    throw VMRuntimeError (Error::DatabaseException, "Database error: Typeinfo for tables needed, but not available");

                unsigned first = query.columns.size();

                for (unsigned idx = 0;  idx < typeinfo->columnsdef.size(); ++idx)
                    if (it->columns[idx].fase & (Fases::Fase1 | Fases::Fase2 | Fases::Updated | Fases::Recheck))
                    {
                            DBTypeInfo::Column const *it2 = &typeinfo->columnsdef[idx];

                            std::string name = it2->dbase_name;
                            Blex::ToUppercase(name.begin(), name.end());

                            Database::ClientColumnInfo const *def = td->GetClientColumnInfo(name, true);
                            if (!def)
                                throw VMRuntimeError (Error::DatabaseException, "Database error: No such column " + it2->dbase_name + " in table " + td->name);

                            SQLQueryData::Column col(tableidx, name, it2->nameid, def->type, it->columns[idx].fase);

                            if (it == dbquery.tables.begin() && it->columns[idx].fase & Fases::Updated)
                                query.update_trans[it2->nameid] = (Database::ColumnId)query.columns.size();

                            query.columns.push_back(col);
                    }

                query.tabledata.push_back(std::make_pair(first, query.columns.size()));
                ++tableidx;
        }
}

DatabaseTransactionDriverInterface::CursorId
                WebHareDBTransaction::OpenCursor(
                                DatabaseQuery &query,
                                CursorType cursortype)
{
        if (!dbase_trans.get())
            throw VMRuntimeError (Error::DatabaseException, "Database error: Accessing an already closed transaction" + GetClientNamePostfix(0));

//        CheckAccess();

        CursorId id = queries.Set(SQLQueryData());
        SQLQueryData &querydata = *queries.Get(id);

//        Blex::ErrStream() << "OPEN CURSOR " << &querydata;

        querydata.cursortype = cursortype;

        // Retry until we got the right metadata version
        unsigned maxtries = 10;
        while (--maxtries != 0)
        {
                Database::Client::CachedMetadata const &metadata = GetDBTrans().GetConfig();

                // Add the table sources
                for (DatabaseQuery::TableSources::iterator it = query.tables.begin(); it != query.tables.end(); ++it)
                {
                        Database::TableInfo const *tableinfo = metadata.GetTableInfo(Blex::StringPair(it->name.begin(), it->name.end()));
                        if (tableinfo == 0)
                            throw VMRuntimeError (Error::DatabaseException, "Database error: cannot find table " + it->name);

                        querydata.sources.push_back(tableinfo);
                }

                // Allocate searchdata
                Database::Client::SearchData data(query.limit < 0 ? /*nolimit*/0 : query.limit, querydata.sources.size(), &querydata.sources[0]);

                // Add all single conditions to searchdata
                for (std::vector<SingleCondition>::iterator it = query.singleconditions.begin(); it != query.singleconditions.end(); ++it)
                {
                        std::string name = query.tables[it->table].ColType(it->column).dbase_name;
                        Blex::ToUppercase(name.begin(), name.end());

                        Database::TableInfo const *tableinfo = querydata.sources[it->table];
                        Database::ClientColumnInfo const *colid = tableinfo->GetClientColumnInfo(name, false);

                        if (colid == 0)
                            throw VMRuntimeError (Error::DatabaseException, "Database error: cannot find column " + name + " in table " + tableinfo->name);

                        if (ConstructSingle(vm, data, *it, it->table, colid))
                        {
        //                        query.tables[it->table].columns[it->column].fase |= Fases::Recheck;
                                it->handled = true;
                        }
                        else
                        {
                                query.tables[it->table].columns[it->column].fase |= Fases::Fase1 | Fases::Recheck;
                                it->handled = false;
                                data.limit = 0;
                        }
                }

                // Add all join conditions to searchdata
                for (std::vector<JoinCondition>::iterator it = query.joinconditions.begin(); it != query.joinconditions.end(); ++it)
                {
                        DBTypeInfo::Column const &lcol = query.tables[it->table1].ColType(it->column1);
                        DBTypeInfo::Column const &rcol = query.tables[it->table2].ColType(it->column2);
                        std::string name1 = lcol.dbase_name;
                        std::string name2 = rcol.dbase_name;

                        Blex::ToUppercase(name1.begin(), name1.end());
                        Blex::ToUppercase(name2.begin(), name2.end());

                        Database::TableInfo const *tableinfo1 = querydata.sources[it->table1];
                        Database::ClientColumnInfo const *colid1 = tableinfo1->GetClientColumnInfo(name1, false);

                        if (colid1 == 0)
                            throw VMRuntimeError (Error::DatabaseException, "Database error: cannot find column " + name1 + " in table " + tableinfo1->name);

                        Database::TableInfo const *tableinfo2 = querydata.sources[it->table2];
                        Database::ClientColumnInfo const *colid2 = tableinfo2->GetClientColumnInfo(name2, false);

                        if (colid2 == 0)
                            throw VMRuntimeError (Error::DatabaseException, "Database error: cannot find column " + name2 + " in table " + tableinfo2->name);

                        data.AddJoinCriterium(it->table1, it->table2, Database::Client::Search::Relation(
                                colid1,
                                colid2,
                                it->casesensitive,
                                GetSearchRelation(it->condition)));

                        it->handled = true;
                }

                BuildResultRow(querydata, query);

                for (std::vector< SQLQueryData::Column >::const_iterator it = querydata.columns.begin(); it != querydata.columns.end(); ++it)
                {
                        Database::TableInfo const *tableinfo = querydata.sources[it->tableidx];
                        Database::ClientColumnInfo const *columninfo = tableinfo->GetClientColumnInfo(it->dbase_name, true);

                        Database::DBRecordSendType sendtype = (Database::DBRecordSendType)0;
                        if (it->fases & Fases::Fase1)
                            sendtype = Database::DBRSTFase1;
                        if (it->fases & Fases::Fase2)
                            sendtype = (Database::DBRecordSendType)(sendtype|Database::DBRSTFase2);

                        data.AddNeededColumn(it->tableidx, columninfo, sendtype);
                }

                querydata.vm = vm;
                if (cursortype != Select)
                {
                        //BCB BUG: Work around unnecessary codeguard warning on operator=
                        querydata.query.singleconditions.reserve(query.singleconditions.size());
                        querydata.query.joinconditions.reserve(query.joinconditions.size());
                        querydata.query.tables.reserve(query.tables.size());
                        querydata.query = query;
                }
        //        querydata.max_block_size = std::min<int>(8, query.maxblockrows); // FIXME: fix to allow higher sizes

                try
                {
                        std::string origin;
//                        DEBUGPRINT("Want RPC info: " << GetDBTrans().WantRPCInfo());
                        if (GetDBTrans().WantRPCInfo())
                            HSVM_GetStackTrace(*vm, &origin);

                        querydata.scan.reset(new Database::RawScanIterator(GetDBTrans(), data, query.maxblockrows, cursortype != Select, false, origin));
                        querydata.scan_used = false;
                }
                catch (Database::Exception &e)
                {
                        if (e.errorcode == Database::ErrorWrongMetadataVersion)
                        {
                                GetDBTrans().RefreshMetadata();
                                querydata = SQLQueryData();
                                continue;
                        }

                        TranslateException(e);
                        return id;
                }

                return id;
        }
        throw VMRuntimeError(Error::DatabaseException, "Could not retrieve up to date metadata, it changed too quick");
}

unsigned WebHareDBTransaction::RetrieveNextBlock(CursorId id, VarId recarr)
{
        VarMemory &varmem = vm->GetStackMachine();
        SQLQueryData &querydata = *queries.Get(id);

        // If opening the scan failed, return 0 records.
        if (!querydata.scan.get())
            return 0;

        if (querydata.scan_used)
        {
                try
                {
                        querydata.scan->GetNextBlock();
                }
                catch (Database::Exception &e)
                {
                        TranslateException(e);
                }
        }
        querydata.scan_used = true;

        unsigned blocksize = querydata.scan->GetCurrentRowsNum();
        unsigned tablecount = querydata.sources.size();

        unsigned elt_count = blocksize * tablecount;
        varmem.ArrayInitialize(recarr, elt_count, VariableTypes::RecordArray);
        for (unsigned idx = 0; idx < elt_count; ++idx)
            varmem.RecordInitializeEmpty(varmem.ArrayElementRef(recarr, idx));

        unsigned loc = 0;
        for (unsigned row = 0; row < blocksize; ++row)
            for (unsigned table = 0; table < tablecount; ++table, ++loc)
                InternalTranslateRecord(querydata, querydata.scan->GetRow(row), table, varmem.ArrayElementRef(recarr, loc), Fase1, true);

        return blocksize;
}

void WebHareDBTransaction::RetrieveFase2Records(CursorId id, VarId recarr, Blex::PodVector< unsigned > const &rowlist, bool allow_direct_close)
{
        VarMemory &varmem = vm->GetStackMachine();
        SQLQueryData &querydata = *queries.Get(id);

        try
        {
                querydata.scan->RetrieveFase2Data(&rowlist[0], rowlist.size(), allow_direct_close);
        }
        catch (Database::Exception &e)
        {
                TranslateException(e);
        }

        unsigned blocksize = querydata.scan->GetCurrentRowsNum();
        unsigned tablecount = querydata.sources.size();
        unsigned loc = 0;
        for (unsigned row = 0; row < blocksize; ++row)
            for (unsigned table = 0; table < tablecount; ++table, ++loc)
                InternalTranslateRecord(querydata, querydata.scan->GetRow(row), table, varmem.ArrayElementRef(recarr, loc), Fase2, false);
}

LockResult WebHareDBTransaction::LockRow(CursorId id, VarId recarr, unsigned row)
{
        StackMachine &stackm = vm->GetStackMachine();
        SQLQueryData &querydata = *queries.Get(id);

        Database::DBLockResult lockres;
        try
        {
                lockres = querydata.scan->LockRow(row);
        }
        catch (Database::Exception &e)
        {
                TranslateException(e);
                return LockResult::Removed;
        }
        switch (lockres)
        {
        case Database::DBLRGone:          return LockResult::Removed;
        case Database::DBLRLocked:
                {
                        unsigned tablecount = querydata.sources.size();
                        unsigned loc = row * tablecount;
                        for (unsigned table = 0; table < tablecount; ++table, ++loc)
                             InternalTranslateRecord(querydata, querydata.scan->GetRow(row), table, stackm.ArrayElementRef(recarr, loc), Fase2, false);
                        return LockResult::Unchanged;
                }
        case Database::DBLRLockedModified:
                {
                        unsigned tablecount = querydata.sources.size();
                        unsigned loc = row * tablecount;
                        for (unsigned table = 0; table < tablecount; ++table, ++loc)
                        {
                                 InternalTranslateRecord(querydata, querydata.scan->GetRow(row), table, stackm.ArrayElementRef(recarr, loc), Fase1, true);
                                 InternalTranslateRecord(querydata, querydata.scan->GetRow(row), table, stackm.ArrayElementRef(recarr, loc), Fase2, false);
                        }
                }
        default: ;
        }
        return LockResult::Changed;
}

void WebHareDBTransaction::UnlockRow(CursorId id, unsigned row)
{
        SQLQueryData &querydata = *queries.Get(id);

        querydata.scan->UnlockRow(row);
}

void WebHareDBTransaction::DeleteRecord(CursorId id, unsigned row)
{
        SQLQueryData &querydata = *queries.Get(id);

//        DEBUGPRINT("WHDBTD: delete row " << row);
        try
        {
                querydata.scan->DeleteRow(row);
        }
        catch (Database::Exception &e)
        {
                TranslateException(e);
        }
}
void WebHareDBTransaction::UpdateRecord(CursorId id, unsigned row, VarId newfields)
{
        SQLQueryData &querydata = *queries.Get(id);

        Database::WritableRecord rec;
        FillUpdateRecord(querydata, rec, newfields);

        try
        {
                querydata.scan->UpdateRow(row, rec);
        }
        catch (Database::Exception &e)
        {
                TranslateException(e);
        }
}

void WebHareDBTransaction::CloseCursor(CursorId id)
{
        SQLQueryData &querydata = *queries.Get(id);
        try
        {
                if (querydata.scan.get())
                {
                        if (dbase_trans.get() && dbase_trans->IsAutoTransaction() && queries.Size() == 1)
                            whdbconn->FlushPendingBlobMarkings();

                        querydata.scan->Close();
                }
        }
        catch (Database::Exception &e)
        {
                TranslateException(e);
        }
        queries.Erase(id);
}

//ADDME: Want this to be auto_ptr, but BCB exception bugs intervene
Database::SQLResultScanner* WebHareDBTransaction::SQL(std::string const &command)
{
        if (!dbase_trans.get())
            throw VMRuntimeError (Error::DatabaseException, "Database error: Accessing an already closed transaction" + GetClientNamePostfix(0));

        if (command.size() >= 11)
        {
                const char set_name[]="SET CLIENT ";
                const char *command_cstr = command.c_str();
                if (Blex::StrCaseCompare(command_cstr, command_cstr + 11, set_name, set_name + 11) == 0)
                    return ExecuteClientSet(command_cstr + 11, command_cstr + command.size());
        }
        if (command.size() >= 10)
        {
                const char set_name[]="SET LOCAL ";
                const char *command_cstr = command.c_str();
                if (Blex::StrCaseCompare(command_cstr, command_cstr + 10, set_name, set_name + 10) == 0)
                {
                        Database::SQLResultScanner *scanner = ExecuteLocalSet(command_cstr + 10, command_cstr + command.size());
                        if (scanner)
                            return scanner;
                }
        }

        try
        {
                return GetDBTrans().SendSQLCommand(command);
        }
        catch (Database::Exception &e)
        {
                TranslateException(e);
                return NULL; //never reached!
        }
}

void ParseSet(const char *command, const char *command_end, std::string const &type, std::string *param, std::string *value)
{
        const char *space = std::find(command, command_end, ' ');

        *param = std::string(command, space);
        Blex::ToUppercase(*param);

        while (space != command_end && *space == ' ')
            ++space;

        if (space == command_end)
            throw VMRuntimeError(Error::DatabaseException, "Missing value for SET " + type + " " + *param);

        if (*space != '=' && (space+1 == command_end || (*space != 't' && *space != 'T') || (*(space+1) != 'o' && *(space+1) != 'O')))
            throw VMRuntimeError(Error::DatabaseException, "Syntax error in SET " + type + " " + *param + ", expected '=' or TO");

        if (*space == '=')
            ++space;
        else
            space += 2;

        while (space != command_end && *space == ' ')
            ++space;

        if (space == command_end)
            throw VMRuntimeError(Error::DatabaseException, "Missing value for SET " + type + " " + *param);

        *value = std::string(space, command_end);

        if (value->size() >= 2 && ((*value)[0] == '\'' || (*value)[0] == '"') && (*value)[0] == value->end()[-1])
            *value = std::string(value->begin() + 1, value->end() -1);

        return;
}

Database::SQLResultScanner* WebHareDBTransaction::ExecuteClientSet(const char *command, const char *command_end)
{
        std::string param_name, value;
        ParseSet(command, command_end, "CLIENT", &param_name, &value);

        if (param_name == "CATCH_ERRORS")
        {
                Blex::ToUppercase(value);
                if (value == "ALL" || value == "WRITE" || value == "NONE")
                    parameters[param_name] = value;
                else
                    throw VMRuntimeError(Error::DatabaseException, "Illegal value for SET CLIENT CATCH_ERRORS, allowed are: ALL, WRITE, NONE");
                return NULL;
        }
        else  if (param_name == "TIMEOUT")
        {
                std::pair<unsigned, std::string::iterator> res = Blex::DecodeUnsignedNumber<unsigned>(value.begin(),value.end());
                if(value.empty() || res.second != value.end() || res.first<=0)
                    throw VMRuntimeError(Error::DatabaseException, "Illegal value for SET CLIENT TIMEOUT");

                this->whdbconn->dbconn->SetIOTimeout(res.first);
                return NULL;
        }
        else
        {
                throw VMRuntimeError(Error::DatabaseException, "Unknown parameter " + param_name);
        }
}

Database::SQLResultScanner* WebHareDBTransaction::ExecuteLocalSet(const char *command, const char *command_end)
{
        std::string param_name, value;
        ParseSet(command, command_end, "LOCAL", &param_name, &value);

        if (param_name == "CLIENTNAME")
        {
                restoredata.clientname = value;
                return 0;
        }

        return 0;
}

int32_t WebHareDBTransaction::GetTableId(std::string const &_tablename)
{
        if (!dbase_trans.get())
            throw VMRuntimeError (Error::DatabaseException, "Database error: Accessing an already closed transaction" + GetClientNamePostfix(0));

        std::string tablename(_tablename);

        Blex::ToUppercase(tablename.begin(),tablename.end());

        Database::TableInfo const *info = GetDBTrans().GetConfig().GetTableInfo(Blex::StringPair(tablename.begin(), tablename.end()));
        return info ? info->Deprecated_GetId() : 0;
}

int32_t WebHareDBTransaction::InsertAutoNumber(std::string const &_tablename, std::string const &_columnname)
{
        if (!dbase_trans.get())
            throw VMRuntimeError (Error::DatabaseException, "Database error: Accessing an already closed transaction" + GetClientNamePostfix(0));

//        CheckAccess();

        std::string tablename(_tablename);
        std::string columnname(_columnname);

        Blex::ToUppercase(tablename.begin(),tablename.end());
        Blex::ToUppercase(columnname.begin(),columnname.end());

        try
        {
                return GetDBTrans().GetAutonumber(Blex::StringPair(tablename.begin(), tablename.end()),Blex::StringPair(columnname.begin(), columnname.end()));
        }
        catch(Database::Exception &e)
        {
                TranslateException(e);
                return 0;
        }
}

// -----------------------------------------------------------------------------
//
//   Direct cursor api functions
//
//
void DirectCursorQuery::Open(WebHareDBTransaction *_driver, std::string const &table, std::vector< std::string > const &columns, bool all_columns, bool for_updating)
{
        conn = _driver->whdbconn;
        driver = _driver;
        // FIXME: check
//        if (!driver->dbase_trans.get())
//            throw VMRuntimeError (Error::DatabaseException, "Database error: Accessing an already closed transaction");

        is_active = false;
        is_deleted = false;
        is_update = for_updating;
        got_info = false;

        try
        {
                scan.reset();
                std::unique_ptr< Database::ClientScanner > new_scan;
                std::string origin;

                if (driver->GetDBTrans().WantRPCInfo())
                    HSVM_GetStackTrace(*driver->vm, &origin);

                new_scan.reset(new Database::ClientScanner(driver->GetDBTrans(), for_updating, origin));
                new_scan->AddTable(table, 0);

                if (all_columns)
                    new_scan->RequestAllColumns(0);
                else
                {
                        std::vector< std::string > columns_copy(columns);

                        std::vector< const char * > colnames;
                        colnames.reserve(columns.size() + 1);
                        for (std::vector< std::string >::iterator it = columns_copy.begin(); it != columns_copy.end(); ++it)
                        {
                                Blex::ToUppercase(it->begin(), it->end());
                                colnames.push_back(it->c_str());
                        }
                        colnames.push_back(0);
                        new_scan->RequestColumns(0, &colnames[0]);
                }
                new_scan->RequireInfo();
                scan.reset(new_scan.release());
        }
        catch (Database::Exception &e)
        {
                if (driver)
                    driver->TranslateException(e);
        }
}

void DirectCursorQuery::OpenForNotifications(Connection *_conn, std::unique_ptr< Database::ResultSetScanner > *_scanner)
{
        conn = _conn;
        driver = 0;

        is_active = true;
        is_deleted = false;
        is_update = false;
        got_info = false;

        scan.reset(_scanner->release());
}

void DirectCursorQuery::OpenEmpty()
{
        conn = 0;
        driver = 0;

        is_active = false;
        is_deleted = false;
        is_update = false;
        got_info = false;
}

bool DirectCursorQuery::Next()
{
        is_deleted = false;
        is_active = false;

        // Auto-close automatically kills the scan
        if (!scan.get())
            return false;

        try
        {
                while (true)
                {
                        is_active = scan->NextRow();

                        if (!is_update || !is_active)
                            break;
                        if (scan->LockRow() != Database::DBLRGone)
                            break;
                }
                if (!got_info)
                {
                        std::vector< Database::ClientColumnInfo > const &new_info = scan->GetInfo();
                        info.clear();
                        info.reserve(new_info.size());
                        for (std::vector< Database::ClientColumnInfo >::const_iterator it = new_info.begin(); it != new_info.end(); ++it)
                        {
                                ColumnNameId id = conn->vm->columnnamemapper.GetMapping(it->name);
                                info.push_back(std::make_pair(*it, id));
                        }
                }
        }
        catch (Database::Exception &e)
        {
                if (driver)
                    driver->TranslateException(e);
        }

        return is_active;
}

void DirectCursorQuery::GetRow(VarId record)
{
        if (!is_active)
            throw VMRuntimeError (Error::DatabaseException, "Database error: Query not active");
        if (is_deleted)
            throw VMRuntimeError (Error::DatabaseException, "Database error: Row has been deleted");
        if (!scan.get())
            throw VMRuntimeError (Error::DatabaseException, "Database error: Associated transaction already closed" + driver->GetClientNamePostfix(0));

        WHDBProviderContext context(conn->vm->GetContextKeeper());
        VarMemory &varmem = conn->vm->GetStackMachine();

        try
        {
                Database::Record const &db_record = scan->GetRowRecord();

                varmem.RecordInitializeEmpty(record);
                unsigned idx = 0;
                for (std::vector< std::pair< Database::ClientColumnInfo, ColumnNameId > >::const_iterator it = info.begin(); it != info.end(); ++it, ++idx)
                {
                        conn->SetFromField(
                                     conn->vm,
                                     varmem.RecordCellCreate(record, it->second),
                                     db_record.GetCell(static_cast< uint16_t >(idx)),
                                     it->first.type);
                }
        }
        catch (Database::Exception &e)
        {
                if (driver)
                    driver->TranslateException(e);
        }
}

void DirectCursorQuery::Update(VarId hsrec)
{
        if (!is_active)
            throw VMRuntimeError (Error::DatabaseException, "Database error: Query not active");
        if (is_deleted)
            throw VMRuntimeError (Error::DatabaseException, "Database error: Row has been deleted");
        if (!is_update)
            throw VMRuntimeError (Error::DatabaseException, "Database error: Query is not flagged for updating");
        if (!scan.get())
            throw VMRuntimeError (Error::DatabaseException, "Database error: Associated transaction already closed" + driver->GetClientNamePostfix(0));

        Database::WritableRecord dbrec;

        VarMemory &varmem = conn->vm->GetStackMachine();

        try
        {
                Database::TransFrontend *dbtrans = 0;
                if (driver)
                    dbtrans = &driver->GetDBTrans();

                for (unsigned idx = 0; idx < varmem.RecordSize(hsrec); ++idx)
                {
                        ColumnNameId nameid = varmem.RecordCellNameByNr(hsrec, idx);

                        Database::ColumnId cidx = 0;
                        std::vector< std::pair< Database::ClientColumnInfo, ColumnNameId > >::const_iterator it = info.begin();
                        while (it != info.end() && it->second != nameid)
                            ++it, ++cidx;
                        if (it == info.end())
                            throw VMRuntimeError (Error::DatabaseException, "Database error: Column " + driver->vm->columnnamemapper.GetReverseMapping(nameid).stl_str() + " not found in column list");

                        conn->SetToField(conn->vm, &dbrec, varmem.RecordCellRefByName(hsrec, nameid), it->first.type, cidx, dbtrans);
                }

                scan->UpdateRow(dbrec);
        }
        catch (Database::Exception &e)
        {
                if (driver)
                    driver->TranslateException(e);
        }
}

void DirectCursorQuery::Delete()
{
        if (!is_active)
            throw VMRuntimeError (Error::DatabaseException, "Database error: Query not active");
        if (!is_update)
            throw VMRuntimeError (Error::DatabaseException, "Database error: Query is not flagged for updating");
        if (!scan.get())
            throw VMRuntimeError (Error::DatabaseException, "Database error: Associated transaction already closed" + driver->GetClientNamePostfix(0));

        try
        {
                if (!is_deleted)
                {
                        is_deleted = true;
                        scan->DeleteRow();
                }
        }
        catch (Database::Exception &e)
        {
                if (driver)
                    driver->TranslateException(e);
        }
}

void DirectCursorQuery::Close()
{
        if (!scan.get())
            return;
        try
        {
                if (!scan.get())
                    return;

                scan->Close();
                scan.reset();
        }
        catch (Database::Exception &e)
        {
                if (driver)
                    driver->TranslateException(e);
        }
}

void DirectCursorQuery::Insert(WebHareDBTransaction *driver, std::string const &table, VarId hsrec)
{
        if (!driver)
            throw VMRuntimeError (Error::DatabaseException, "Database error: Associated transaction already closed" + driver->GetClientNamePostfix(0));

        VarMemory &varmem = driver->vm->GetStackMachine();
        Database::WritableRecord dbrec;

        try
        {
                Database::TransFrontend *dbtrans;
                if (driver)
                    dbtrans = &driver->GetDBTrans();

                Database::Client::CachedMetadata const &metadata = driver->GetDBTrans().GetConfig();
                Database::TableInfo const *tabledata = metadata.GetTableInfo(Blex::StringPair(table.begin(), table.end()));
                if (!tabledata)
                    throw VMRuntimeError (Error::DatabaseException, "Database error: Table " + table + " does not exist");

                std::vector< Database::ClientColumnInfo const * > columns;

                for (Database::ColumnId idx = 0; (unsigned)idx < varmem.RecordSize(hsrec); ++idx)
                {
                        ColumnNameId nameid = varmem.RecordCellNameByNr(hsrec, idx);

                        std::string name = driver->vm->columnnamemapper.GetReverseMapping(nameid).stl_str();
                        Blex::ToUppercase(name.begin(), name.end());

                        Database::ClientColumnInfo const *info = tabledata->GetClientColumnInfo(name, false);
                        if (!info)
                            throw VMRuntimeError (Error::DatabaseException, "Database error: Column " + name + " does not exist in table "+ table);

                        columns.push_back(info);

                        driver->whdbconn->SetToField(driver->vm, &dbrec, varmem.RecordCellRefByName(hsrec, nameid), info->type, idx, dbtrans);
                }

                driver->GetDBTrans().InsertRecord(tabledata, columns.size(), &columns[0], dbrec);
        }
        catch (Database::Exception &e)
        {
                driver->TranslateException(e);
        }
}

void DirectCursorQuery::NoteTransactionClose(WebHareDBTransaction *closeddriver)
{
        if(driver==closeddriver || closeddriver == 0)
        {
                scan.reset();
                conn=NULL;
                driver=NULL;
        }
}

// -----------------------------------------------------------------------------
//
//   Transaction driver c++ control functions
//

WHDB::WebHareDBTransaction * IsWHDBTransaction(VirtualMachine *vm, DatabaseTransactionDriverInterface *trans)
{
        WHDB::WebHareDBTransaction *driver = dynamic_cast< WHDB::WebHareDBTransaction * >(trans);
        if (!driver)
            HSVM_ThrowException(*vm, "This operation can only be executed on WHDB transactions");
//        driver->CheckAccess();
        return driver;
}

// -----------------------------------------------------------------------------
//
//   HareScript transaction control functions
//
//

void HS_SQL_WHDB_StartTransaction (VarId id_set, VirtualMachine *vm)
{
        WHDBProviderContext context(vm->GetContextKeeper());

        HSVM_VariableId var_user = HSVM_RecordGetRef(*vm, HSVM_Arg(0), HSVM_GetColumnId(*vm, "USER"));
        HSVM_VariableId var_passwd  = HSVM_RecordGetRef(*vm, HSVM_Arg(0), HSVM_GetColumnId(*vm, "PASSWD"));
        HSVM_VariableId var_clientname = HSVM_RecordGetRef(*vm, HSVM_Arg(0), HSVM_GetColumnId(*vm, "CLIENTNAME"));
        HSVM_VariableId var_readonly = HSVM_RecordGetRef(*vm, HSVM_Arg(0), HSVM_GetColumnId(*vm, "READONLY"));
        HSVM_VariableId var_auto = HSVM_RecordGetRef(*vm, HSVM_Arg(0), HSVM_GetColumnId(*vm, "AUTO"));
        HSVM_VariableId var_bindto = HSVM_RecordGetRef(*vm, HSVM_Arg(0), HSVM_GetColumnId(*vm, "BINDTO"));

        //FIXME: Check the types of incoming variables!
        std::string username, passwd, clientname;
        bool readonly=false, is_auto=false;
        unsigned bindto = 0;
        if (var_user)
            username = HSVM_StringGetSTD(*vm, var_user);
        if (var_passwd)
            passwd = HSVM_StringGetSTD(*vm, var_passwd);
        if (var_clientname)
            clientname = HSVM_StringGetSTD(*vm, var_clientname);
        if (var_readonly)
            readonly = HSVM_BooleanGet(*vm, var_readonly);
        if (var_auto)
            is_auto = HSVM_BooleanGet(*vm, var_auto);
        if (var_bindto)
            bindto = HSVM_IntegerGet(*vm, var_bindto);

        if (username=="~backup")
        {
                // We don't allow ~backup to be opened from HareScript
                HSVM_IntegerSet(*vm, id_set, 0);
                return;
        }

        // Old connection to keep the old transactions alive until we have done the rebinding
        std::unique_ptr< Connection > old_conn;

        /* Open the transaction */
        std::unique_ptr< Database::TransFrontend > trans;
        try
        {
                // If we already have a transaction connection, ue it to open the transaction
                if (context->primary_conn.get())
                    trans.reset(context->primary_conn->dbconn->BeginTransaction(username, passwd, clientname, readonly, is_auto));
        }
        catch (Database::Exception &e)
        {
                // Survive the first disconnection, try to rebuild the transaction connection
                if (e.errorcode != Database::ErrorDisconnect && e.errorcode != Database::ErrorTimeout)
                {
                        HSVM_IntegerSet(*vm, id_set, 0);
                        return;
                }
        }
        if (!trans.get())
        {
                try
                {
                        // A login with ~webhare failed; we may assume the connection is done for. Kill it!
                        context->KillConnectionTransactions(bindto);

                        // Rebuild the transaction connection and open the transaction on the new connection
                        context->ConstructNewConnection(clientname, &old_conn);

                        trans.reset(context->primary_conn->dbconn->BeginTransaction(username, passwd, clientname, readonly, is_auto));
                }
                catch (Database::Exception &e)
                {
                        // Error building new connection? We need to kill all old transactions
                        if (!context->primary_conn.get() && old_conn.get())
                        {
                                // Put the old connection back, to be able to kill the rest of the transaction objects, if present
                                context->primary_conn.reset(old_conn.release());
                                context->KillConnectionTransactions(0);
                                context->primary_conn.reset();
                        }
                        HSVM_IntegerSet(*vm, id_set, 0);
                        return;
                }
        }

        // Build our transaction object
        std::unique_ptr< WebHareDBTransaction > whdb_trans(new WebHareDBTransaction(context->primary_conn.get(), trans));

        whdb_trans->restoredata.username = username;
        whdb_trans->restoredata.password = passwd;
        whdb_trans->restoredata.clientname = clientname.empty() ? context->defaultclientname : clientname;
        whdb_trans->restoredata.readonly = readonly;
        whdb_trans->restoredata.is_auto = is_auto;

        int32_t trans_id = vm->GetSQLSupport().RegisterTransaction(std::move(whdb_trans), bindto);

        // Don't need the old connection object anymore, kill it explicitly
        old_conn.reset();

        HSVM_IntegerSet(*vm, id_set, trans_id);
}

void HS_SQL_WHDB_GetErrors (VarId id_set, VirtualMachine *vm)
{
        unsigned transid = HSVM_IntegerGet(*vm, HSVM_Arg(0));
        WebHareDBTransaction *driver = IsWHDBTransaction(vm, vm->GetSQLSupport().GetTransaction(transid));
        if (!driver)
            return;

        DBRuntimeErrors const& errors = driver->GetErrors();

        HSVM_SetDefault(*vm, id_set, HSVM_VAR_RecordArray);
        HSVM_ColumnId code = HSVM_GetColumnId(*vm, "CODE");
        HSVM_ColumnId message = HSVM_GetColumnId(*vm, "MESSAGE");
        HSVM_ColumnId tablename = HSVM_GetColumnId(*vm, "TABLENAME");
        HSVM_ColumnId columnname = HSVM_GetColumnId(*vm, "COLUMNNAME");

        for (std::vector<DBRuntimeError>::const_iterator it = errors.begin(); it != errors.end(); ++it)
        {
                HSVM_VariableId recid = HSVM_ArrayAppend(*vm, id_set);
                HSVM_IntegerSet  (*vm, HSVM_RecordCreate(*vm, recid, code), it->code);
                HSVM_StringSetSTD(*vm, HSVM_RecordCreate(*vm, recid, message), it->message);
                HSVM_StringSetSTD(*vm, HSVM_RecordCreate(*vm, recid, tablename), it->table);
                HSVM_StringSetSTD(*vm, HSVM_RecordCreate(*vm, recid, columnname), it->column);
        }
}

void HS_SQL_WHDB_Commit (VarId id_set, VirtualMachine *vm)
{
        unsigned transid = HSVM_IntegerGet(*vm, HSVM_Arg(0));

        WebHareDBTransaction *driver = IsWHDBTransaction(vm, vm->GetSQLSupport().GetTransaction(transid));
        if (!driver)
            return;

        // Commit
        driver->Finish(true);
        HS_SQL_WHDB_GetErrors(id_set, vm);

        if (!driver->GetDBTrans().IsAutoTransaction())
        {
                // Kill the transaction
                WebHareDBTransaction::Unregister(vm->GetSQLSupport(), driver);
        }
}

void HS_SQL_WHDB_Rollback (VirtualMachine *vm)
{
        unsigned transid = HSVM_IntegerGet(*vm, HSVM_Arg(0));

        WebHareDBTransaction *driver = IsWHDBTransaction(vm, vm->GetSQLSupport().GetTransaction(transid));
        if (!driver)
            return;

        // Rollback
        driver->Finish(false);

        // Kill the transaction
        if (!driver->GetDBTrans().IsAutoTransaction())
            WebHareDBTransaction::Unregister(vm->GetSQLSupport(), driver);
}

void HS_SQL_WHDB_GetTableId(VarId id_set, VirtualMachine *vm)
{
        VarMemory &varmem = vm->GetStackMachine();

        //ADDME: A nice typedef or something like that would be useful ;)
        auto binding = vm->GetSQLSupport().GetBindingInfo(varmem.GetTable(HSVM_Arg(0)));

        WebHareDBTransaction *driver = IsWHDBTransaction(vm, binding.driver);
        if (!driver)
            return;

        HSVM_IntegerSet(*vm, id_set, driver->GetTableId(binding.dbasename));
}

void HS_SQL_WHDB_BeginWork(VirtualMachine *vm)
{
        unsigned basetransid = HSVM_IntegerGet(*vm, HSVM_Arg(0));
        WebHareDBTransaction *driver = IsWHDBTransaction(vm, vm->GetSQLSupport().GetTransaction(basetransid));
        if (!driver)
            return;

        // Clear the error list
        driver->ClearErrors();
        driver->GetDBTrans().BeginWork();
}

void HS_SQL_WHDB_Close(VirtualMachine *vm)
{
        unsigned basetransid = HSVM_IntegerGet(*vm, HSVM_Arg(0));
        WebHareDBTransaction *driver = IsWHDBTransaction(vm, vm->GetSQLSupport().GetTransaction(basetransid));
        if (!driver)
            return;

        WebHareDBTransaction::Unregister(vm->GetSQLSupport(), driver);
}

// -----------------------------------------------------------------------------
//
//   HareScript direct SQL functions
//
//

void HS_SQL_WHDB_SQL(VarId id_set, VirtualMachine *vm)
{
        WHDBProviderContext context(vm->GetContextKeeper());
        VarMemory &varmem = vm->GetStackMachine();

        unsigned transid = varmem.GetInteger(HSVM_Arg(0));
        std::string to_send = varmem.GetString(HSVM_Arg(1)).stl_str();

        WebHareDBTransaction *driver = IsWHDBTransaction(vm, vm->GetSQLSupport().GetTransaction(transid));
        if (!driver)
            return;

        const std::unique_ptr<Database::SQLResultScanner> scanner(driver->SQL(to_send));

        HSVM_SetDefault(*vm, id_set, HSVM_VAR_RecordArray);
        if (scanner.get() && scanner->NextRow())
        {
                std::vector< Database::ClientColumnInfo > const &colinfo = scanner->GetInfo();

                do
                {
                        HSVM_VariableId newrec = HSVM_ArrayAppend(*vm, id_set);
                        for (Database::ColumnId i=0;(unsigned)i<colinfo.size();++i)
                        {
                                HSVM_ColumnId newcol = HSVM_GetColumnId(*vm, colinfo[i].name.c_str());
                                HSVM_VariableId newcell = HSVM_RecordCreate(*vm, newrec, newcol);
                                driver->whdbconn->SetFromField (vm, newcell, scanner->GetCell(i), colinfo[i].type);
                        }
                }
                while (scanner->NextRow());
        }
}

// -----------------------------------------------------------------------------
//
//   HareScript content control functions
//
//

// int32_t FUNCTION HS_SQL_InsertAutoNumber(TABLE id, STRING columnname);
void HS_SQL_WHDB_InsertAutoNumber(VarId id_set, VirtualMachine *vm)
{
        VarMemory &varmem = vm->GetStackMachine();

        //ADDME: A nice typedef or something like that would be useful ;)
        auto binding = vm->GetSQLSupport().GetBindingInfo(varmem.GetTable(HSVM_Arg(0)));

        WebHareDBTransaction *driver = IsWHDBTransaction(vm, binding.driver);
        if (!driver)
            return;

        int32_t number = driver->InsertAutoNumber(binding.dbasename, varmem.GetSTLString(HSVM_Arg(1)));
        if (!number)
            throw VMRuntimeError (Error::DatabaseException, "Database error: Column is not an autonumber column");

        vm->GetStackMachine().SetInteger(id_set, number);
}

void HS_SQL_WHDB_GetWHDBBlobId(VarId id_set, VirtualMachine *vm)
{
        WHDBBlobData *blobdata = static_cast<WHDBBlobData * >(HSVM_BlobContext(*vm, HSVM_Arg(0), WHDBBlobContextId, false));
        int32_t blobid = blobdata && blobdata->myconn ? blobdata->blobid : 0;
        HSVM_IntegerSet(*vm, id_set, blobid);
}

// -----------------------------------------------------------------------------
//
//   HareScript direct cursoring functions
//
//

void DC_Open(VarId id_set, VirtualMachine *vm)
{
        VarMemory &varmem = vm->GetStackMachine();

        std::vector< std::string > columns;

        unsigned transid = varmem.GetInteger(HSVM_Arg(0));
        std::string table = varmem.GetSTLString(HSVM_Arg(1));
        unsigned size = varmem.ArraySize(HSVM_Arg(2));
        for (unsigned idx = 0; idx < size; ++idx)
            columns.push_back(varmem.GetSTLString(varmem.ArrayElementRef(HSVM_Arg(2), idx)));
        bool all_columns = varmem.GetBoolean(HSVM_Arg(3));
        bool for_updating = varmem.GetBoolean(HSVM_Arg(4));

        WebHareDBTransaction *driver = IsWHDBTransaction(vm, vm->GetSQLSupport().GetTransaction(transid));
        if (!driver)
            return;

        Blex::ToUppercase(table.begin(), table.end());

        WHDBProviderContext context(vm->GetContextKeeper());
        unsigned id = context->dcqueries.Set(DirectCursorQuery());
        DirectCursorQuery *query = context->dcqueries.Get(id);
        if (!query)
            throw VMRuntimeError(Error::DatabaseException, "Database error: Used an illegal direct cursor query id");

        query->Open(driver, table, columns, all_columns, for_updating);

        varmem.SetInteger(id_set, id);
}

void DC_NextRow(VarId id_set, VirtualMachine *vm)
{
        VarMemory &varmem = vm->GetStackMachine();

        unsigned id = varmem.GetInteger(HSVM_Arg(0));

        WHDBProviderContext context(vm->GetContextKeeper());
        DirectCursorQuery *query = context->dcqueries.Get(id);
        if (!query)
            throw VMRuntimeError(Error::DatabaseException, "Database error: Used an illegal direct cursor query id");

        varmem.SetBoolean(id_set, query->Next());
}

void DC_GetRow(VarId id_set, VirtualMachine *vm)
{
        VarMemory &varmem = vm->GetStackMachine();

        unsigned id = varmem.GetInteger(HSVM_Arg(0));

        WHDBProviderContext context(vm->GetContextKeeper());
        DirectCursorQuery *query = context->dcqueries.Get(id);
        if (!query)
            throw VMRuntimeError(Error::DatabaseException, "Database error: Used an illegal direct cursor query id");

        query->GetRow(id_set);
}

void DC_Update(VirtualMachine *vm)
{
        VarMemory &varmem = vm->GetStackMachine();

        unsigned id = varmem.GetInteger(HSVM_Arg(0));

        WHDBProviderContext context(vm->GetContextKeeper());
        DirectCursorQuery *query = context->dcqueries.Get(id);
        if (!query)
            throw VMRuntimeError(Error::DatabaseException, "Database error: Used an illegal direct cursor query id");

        query->Update(HSVM_Arg(1));
}

void DC_Delete(VirtualMachine *vm)
{
        VarMemory &varmem = vm->GetStackMachine();

        unsigned id = varmem.GetInteger(HSVM_Arg(0));

        WHDBProviderContext context(vm->GetContextKeeper());
        DirectCursorQuery *query = context->dcqueries.Get(id);
        if (!query)
            throw VMRuntimeError(Error::DatabaseException, "Database error: Used an illegal direct cursor query id");

        query->Delete();
}

void DC_Close(VirtualMachine *vm)
{
        VarMemory &varmem = vm->GetStackMachine();

        unsigned id = varmem.GetInteger(HSVM_Arg(0));

        WHDBProviderContext context(vm->GetContextKeeper());
        DirectCursorQuery *query = context->dcqueries.Get(id);
        if (!query)
            throw VMRuntimeError(Error::DatabaseException, "Database error: Used an illegal direct cursor query id");

        query->Close();

        context->dcqueries.Erase(id);
}

void DC_Insert(VirtualMachine *vm)
{
        VarMemory &varmem = vm->GetStackMachine();

        std::vector< std::string > columns;

        unsigned transid = varmem.GetInteger(HSVM_Arg(0));
        std::string table = varmem.GetSTLString(HSVM_Arg(1));
        Blex::ToUppercase(table.begin(), table.end());

        WebHareDBTransaction *driver = IsWHDBTransaction(vm, vm->GetSQLSupport().GetTransaction(transid));
        if (!driver)
            return;

        DirectCursorQuery::Insert(driver, table, HSVM_Arg(2));
}

// -----------------------------------------------------------------------------
//
//   HareScript other services
//
//

//PUBLIC BOOLEAN FUNCTION WHDBColumnExistsInternal(TABLE atable, STRING tablename, STRING columnname)
void WHDBColumnExistsInternal(VarId id_set, VirtualMachine *vm)
{
        auto binding = vm->GetSQLSupport().GetBindingInfo(vm->GetStackMachine().GetTable(HSVM_Arg(0)));

        WebHareDBTransaction *driver = IsWHDBTransaction(vm, binding.driver);
        if (!driver)
            return;

        // Get tablename and column name
        std::string tablename = HSVM_StringGetSTD(*vm, HSVM_Arg(1));
        std::string columnname = HSVM_StringGetSTD(*vm, HSVM_Arg(2));

        Blex::ToUppercase(tablename.begin(), tablename.end());
        Blex::ToUppercase(columnname.begin(), columnname.end());

        std::string::iterator dotpos = std::find(tablename.begin(), tablename.end(), '.');
        if (dotpos == tablename.end())
            tablename = "PUBLIC." + tablename;

        bool found = false;
        Database::TableInfo const *tinfo = driver->GetDBTrans().GetConfig().GetTableInfo(Blex::StringPair(tablename.begin(), tablename.end()));
        if (tinfo)
        {
                Database::ClientColumnInfo const *cinfo = tinfo->GetClientColumnInfo(columnname, false);
                if (cinfo)
                    found = true;
        }
        HSVM_BooleanSet(*vm, id_set, found);
}

void HS_SQL_WHDB_IsConnectionAlive(VarId id_set, VirtualMachine *vm)
{
        WHDBProviderContext context(vm->GetContextKeeper());
        VarMemory &varmem = vm->GetStackMachine();

        varmem.SetBoolean(id_set, context->primary_conn.get());
}


void HS_SQL_WHDB_IsWorkOpen(VarId id_set, VirtualMachine *vm)
{
        VarMemory &varmem = vm->GetStackMachine();

        unsigned basetransid = HSVM_IntegerGet(*vm, HSVM_Arg(0));
        WebHareDBTransaction *driver = IsWHDBTransaction(vm, vm->GetSQLSupport().GetTransaction(basetransid));
        if (!driver)
            return;

        varmem.SetBoolean(id_set, driver->GetDBTrans().IsExplicitlyOpened());
}

void HS_SQL_WHDB_ReconnectAllTransactions(VirtualMachine *vm)
{
        WHDBProviderContext context(vm->GetContextKeeper());

        if(!context->primary_conn.get()) //It's likely there never were any transactions
            return;
//        VarMemory &varmem = vm->GetStackMachine();

        std::set< WebHareDBTransaction * > current_transactions = context->primary_conn->open_transactions;
        std::unique_ptr< Connection > old_conn;

        // Rebuild the transaction connection and open the transaction on the new connection
        context->ConstructNewConnection(context->primary_conn->clientname, &old_conn);

        try
        {
                for (std::set< WebHareDBTransaction * >::iterator it = current_transactions.begin(); it != current_transactions.end(); ++it)
                    (*it)->ReconnectDBTransaction(context->primary_conn.get());
        }
        catch (std::exception &)
        {
                // Any exception? Kill all the old transactions while their old connection object still exists
                for (std::set< WebHareDBTransaction * >::iterator it = current_transactions.begin(); it != current_transactions.end(); ++it)
                    WebHareDBTransaction::Unregister(vm->GetSQLSupport(), *it);
                throw;
        }

        // Kill old connection object
        old_conn.reset();
}

// -----------------------------------------------------------------------------
//
//   Transaction driver registration and initialisation
//
//

extern "C"
{
        static void* CreateBlobContext(void *)
        {
                return new WHDBBlobData;
        }
        static void DestroyBlobContext(void*, void *context_ptr)
        {
                delete static_cast<WHDBBlobData*>(context_ptr);
        }
        static void CleanupHandler(HSVM *hsvm)
        {
                auto vm = GetVirtualMachine(hsvm);
                WHDBProviderContext context(vm->GetContextKeeper());

                if (!context->primary_conn.get()) //It's likely there never were any transactions
                    return;

                context->primary_conn->FlushPendingBlobMarkings();
        }
}

void Register(Environment &env)
{
        BuiltinFunctionsRegistrator &bifreg = env.GetBifReg();
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__STARTWHDBTRANSACTION::I:R", HS_SQL_WHDB_StartTransaction));
//        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("SETWHDBHANDLEALLOWEDLIBS:::ISA", HS_SQL_WHDB_SetAllowedLibs));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETWHDBTRANSACTIONERRORS::RA:I", HS_SQL_WHDB_GetErrors));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__COMMITWHDBTRANSACTION::RA:I", HS_SQL_WHDB_Commit));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__ROLLBACKWHDBTRANSACTION:::I", HS_SQL_WHDB_Rollback));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("MAKEWHDBAUTONUMBER::I:TS", HS_SQL_WHDB_InsertAutoNumber));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__SENDWHDBCOMMAND::RA:IS", HS_SQL_WHDB_SQL));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__GETWHDBBLOBINTERNALID::I:X", HS_SQL_WHDB_GetWHDBBlobId));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETWHDBTABLEID::I:T", HS_SQL_WHDB_GetTableId));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__WHDBDCOPEN::I:ISSABB", DC_Open));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__WHDBDCNEXTROW::B:I", DC_NextRow));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__WHDBDCGETROW::R:I", DC_GetRow));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__WHDBDCUPDATE:::IR", DC_Update));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__WHDBDCDELETE:::I", DC_Delete));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__WHDBDCCLOSE:::I", DC_Close));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__WHDBDCINSERT:::ISR", DC_Insert));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("WHDBCOLUMNEXISTSINTERNAL::B:TSS", WHDBColumnExistsInternal));

        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__BEGINWHDBWORK:::I", HS_SQL_WHDB_BeginWork));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__COMMITWHDBWORK::RA:I", HS_SQL_WHDB_Commit));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__ROLLBACKWHDBWORK:::I", HS_SQL_WHDB_Rollback));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__CLOSEWHDBAUTOTRANSACTION:::I", HS_SQL_WHDB_Close));

        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("ISWHDBCONNECTIONALIVE::B:", HS_SQL_WHDB_IsConnectionAlive));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("ISWHDBWORKOPEN::B:I", HS_SQL_WHDB_IsWorkOpen));

        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("RECONNECTALLWHDBTRANSACTIONS:::", HS_SQL_WHDB_ReconnectAllTransactions));

        WHDBProviderContext::Register(env.GetContextReg());
        HSVM_RegisterContext(env.GetHSVMRegData(), WHDBBlobContextId, NULL, &CreateBlobContext, &DestroyBlobContext);
        HSVM_RegisterGarbageCollectionCallback(env.GetHSVMRegData(), &CleanupHandler);
}

void InitializeContext(VirtualMachine *vm, Database::TCPFrontend *remotedb)
{
        WHDBProviderContext context(vm->GetContextKeeper());
        context->vm = vm;
        context->remotedb = remotedb;
}



} // End of namespace WHDB
} // End of namespace SQLLib
} // End of namespace HareScript
