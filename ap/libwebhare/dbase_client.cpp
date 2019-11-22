#include <ap/libwebhare/allincludes.h>


//#define SHOW_ACTIVITY

#if defined(SHOW_ACTIVITY) && defined(DEBUG)
 #define DBC_PRINT(x) DEBUGPRINT(x)
#else
 #define DBC_PRINT(x)
#endif

#include <ap/libwebhare/dbase_client.h>
#include <blex/logfile.h>
#include <blex/path.h>
#include <iostream>

/* FIXME
   RPC errors gemeld door IOBuffer zouden ook de connectie onbruikbaar moeten
   maken maar kunnen dat momenteel niet omdat IOBuffer de connectie niet kent

   Indien gefixt, check alle checks op ErrorDisconnect of die misschien ook
   niet op de 'oplossing' van bovenstaand probleem moeten checken (zoals bv
   PopCachedConn die met rauwe connecties werkt)
*/
namespace Database
{


static const unsigned MaxCacheSize=5;

template <> void IOBuffer::Write< NotificationRequests >(NotificationRequests const &in)
{
        Write<uint32_t>(static_cast<uint32_t>(in.requests.size()));

        for (unsigned i=0;i<in.requests.size();++i)
        {
                Write(in.requests[i].schema);
                Write(in.requests[i].table);
                Write<uint32_t>(static_cast<uint32_t>(in.requests[i].columns.size()));
                for (unsigned j=0;j<in.requests[i].columns.size();++j)
                    Write(in.requests[i].columns[j]);
        }
}



TCPConnection *TCPFrontend::EstablishConnection(IOBuffer *iobuf)
{
        DBC_PRINT("Establishing connection to database");

        std::unique_ptr<TCPConnection> newconn;
        IOBuffer temp;

        while(true)
        {
                temp = *iobuf;
                bool isfresh;
                newconn.reset( NewConnection(&isfresh) );
                try
                {
                        Blex::DateTime timeout = Blex::DateTime::Now() + Blex::DateTime::Seconds(newconn->io_timeout);
                        newconn->SendPacket(temp, timeout);
                        // Receive the answer
                        while (true)
                        {
                                newconn->ReceivePacket(&temp, timeout);
                                switch (temp.GetOpcode())
                                {
                                case ResponseOpcode::Answer:
                                        if (temp.Read<uint32_t>() != 4)
                                        {
                                                DBC_PRINT("Connection " << newconn.get() << " RPC failure: Received wrong reply to connection establishing request");
                                                throw Exception(ErrorProtocol,"Received wrong reply to connection establishing request");
                                        } break;
                                default:
                                    Blex::ErrStream() << "Received unexpected asynchronous message during connection setup, opcode: " << Database::ResponseOpcode::GetName((Database::ResponseOpcode::Type)temp.GetOpcode());
                                    throw Exception(ErrorDisconnect, "Connection didn't behave as expected during setup");
                                }
                                break;
                        }
                        *iobuf=temp;

                        DBC_PRINT("Established connection to database: " << newconn.get());
                        return newconn.release();
                }
                catch(Database::Exception &e)
                {
                        if (isfresh || (e.errorcode != ErrorDisconnect && e.errorcode != ErrorTimeout))
                            throw; //this is not an error we can safely handle
                        DBC_PRINT("Cached connection failed: " << e.what());
                }
        }
}

void TCPFrontend::DropMetadataRef(Client::CachedMetadata *metadata)
{
        LockedSharedData::WriteRef lock(shareddata);
        if (--metadata->refcount == 0)
        {
                DBC_PRINT("Deleting metadata");
                delete metadata;
        }
}

//ADDME: Guarantee MT-safety on this function, deny MT-safety on TransactConnection
TransactConnection * TCPFrontend::BeginTransactConnection(std::string const &_clientname)
{
        std::string clientname;
        if (_clientname.empty())
            clientname = defaultclientname;
        else
            clientname = _clientname;

        IOBuffer iobuf;
        iobuf.ResetForSending();
        iobuf.WriteVersionData();
        iobuf.Write(clientname.empty() ? defaultclientname : clientname);
        iobuf.FinishForRequesting(RequestOpcode::BeginConnection);

        // Setup a new connection
        std::unique_ptr< TCPConnection > conn;
        std::unique_ptr< TransactConnection > new_transconn;
        conn.reset(EstablishConnection(&iobuf));

        // Connection established, hand over to a new transaction connection object
        new_transconn.reset( new TransactConnection(*this, clientname) );
        new_transconn->dbconn.reset(conn.release()); //hand over the connection

        DBC_PRINT("Opened TC " << new_transconn.get() << " for client " << clientname);

        return new_transconn.release();
}

// -----------------------------------------------------------------------------
//
// TransactConnection
//
// -----------------------------------------------------------------------------

TransactConnection::TransactConnection(TCPFrontend &dbase, std::string const &_clientname)
: dbase(dbase)
, expect_advance_response(false)
, advance_blob(0)
, advance_iterator(0)
, notifications_opened(false)
, clientname(_clientname)
{
}

TransactConnection::~TransactConnection()
{
        dbase.ReturnMyConnection(dbconn.release());

        for (std::set<RemoteBlob*>::iterator itr=openblobs.begin();itr!=openblobs.end();++itr)
            (*itr)->conn=NULL; //allows blobs and transactions to be deleted out-of-order

        DBC_PRINT("Closed TC " << this);
}
void TransactConnection::SetIOTimeout(unsigned seconds)
{
        if(dbconn.get())
            dbconn->io_timeout = seconds;
}

void TransactConnection::RemoteAdvanceRequest(IOBuffer *iobuf)
{
        Blex::DateTime timeout = Blex::DateTime::Now() + Blex::DateTime::Seconds(dbconn->io_timeout);
        dbconn->SendPacket(*iobuf, timeout);
        expect_advance_response=true;
}
void TransactConnection::FinishAdvanceRequest()
{
        advance_blob = 0;

        if(expect_advance_response)
        {
                Blex::DateTime timeout = Blex::DateTime::Now() + Blex::DateTime::Seconds(dbconn->io_timeout);
                while (true)
                {
                        IOBuffer *iobuffer = advance_iterator ? &advance_iterator->advance_iobuf : &advance_blob_iobuf;

                        dbconn->ReceivePacket(iobuffer, timeout);

                        if (iobuffer->GetOpcode() & ResponseOpcode::AsyncMask)
                            async_packets.push_back(*iobuffer);
                        else
                        {
                                if (advance_iterator)
                                {
                                        DBC_PRINT("Finished advance read for iterator " << advance_iterator);
                                        advance_iterator->have_advance_read = true;
                                        advance_iterator = 0;
                                }
                                break; //got the right response
                        }
                }
                expect_advance_response=false;
        }
}
void TransactConnection::RemoteInform(IOBuffer *iobuf)
{
        Blex::DateTime timeout = Blex::DateTime::Now() + Blex::DateTime::Seconds(dbconn->io_timeout);
        dbconn->SendPacket(*iobuf, timeout);
}

void TransactConnection::RemoteRequest(IOBuffer *iobuf)
{
        // Timeout for request
        Blex::DateTime timeout = Blex::DateTime::Now() + Blex::DateTime::Seconds(dbconn->io_timeout);
        dbconn->SendPacket(*iobuf, timeout);

        while (true)
        {
                IOBuffer *curbuffer = expect_advance_response
                        ? (advance_iterator ? &advance_iterator->advance_iobuf : &advance_blob_iobuf)
                        : iobuf;
                dbconn->ReceivePacket(curbuffer, timeout);

                if (curbuffer->GetOpcode() & ResponseOpcode::AsyncMask)
                    async_packets.push_back(*curbuffer);
                else if(expect_advance_response)
                {
                        if (advance_iterator)
                        {
                                DBC_PRINT("Received advance read for iterator " << advance_iterator);
                                advance_iterator->have_advance_read = true;
                                advance_iterator = 0;
                        }
                        expect_advance_response=false;
                }
                else
                    break; //got the right response
        }
}

TransFrontend * TransactConnection::BeginFullyPrivilegedTransaction(bool readonly, bool autotrans)
{
        return BeginTransaction("~webhare", "", "", readonly, autotrans);
}

TransFrontend * TransactConnection::BeginTransaction(std::string const &username, std::string const &password, std::string const &trans_clientname, bool readonly, bool autotrans)
{
        iobuf.ResetForSending();
        iobuf.Write<uint32_t>(0);
        iobuf.Write(username);
        iobuf.Write(password);
        if (trans_clientname.empty())
            iobuf.Write(clientname);
        else
            iobuf.Write(trans_clientname);
        iobuf.Write<uint8_t>(uint8_t(autotrans?1:0));
        iobuf.Write<uint8_t>(uint8_t(readonly?1:0));
        iobuf.Write< uint32_t >(0); //extra_roles

        iobuf.FinishForRequesting(RequestOpcode::TransactionStart);

        RemoteRequest(&iobuf);
        int32_t primary_view_id = iobuf.Read<int32_t>();

        std::unique_ptr< TransFrontend > new_trans;
        new_trans.reset(new TransFrontend(dbase, *this, primary_view_id, autotrans, username=="~backup"));
        DBC_PRINT("Opening trans " << new_trans.get() << " on conn " << this);

        Blex::DateTime metadataclock = iobuf.Read<Blex::DateTime>();
        uint32_t metadataversion = iobuf.Read<uint32_t>();
        DBC_PRINT("Metadata version: " << metadataversion);

        GetMetadata(new_trans.get(), metadataversion, metadataclock);

        new_trans->wantrpcinfo = iobuf.Read< bool >();

        DBC_PRINT("Want RPC info: " << new_trans->wantrpcinfo);

        return new_trans.release();
}

void TransactConnection::GetMetadata(TransFrontend *trans, uint32_t metadataversion, Blex::DateTime metadataclock)
{
        //Can we get metadata out of the cache?
        {
                TCPFrontend::LockedSharedData::WriteRef lock(dbase.shareddata);

                if (lock->lastmetadata && lock->lastmetadata->GetVersion() == metadataversion && lock->lastmetadata->GetClock() ==metadataclock)
                {
                        // Replace the cached metadata, but allow for the case that the current metadata is already correct
                        Client::CachedMetadata *old_metadata = trans->cached_metadata;

                        trans->cached_metadata = lock->lastmetadata;
                        ++trans->cached_metadata->refcount;
                        if (old_metadata && --old_metadata->refcount == 0)
                            delete old_metadata;

                        return;
                }
        }

        // Not in cache: cached metadata isn't important anymore. Drop it.
        if (trans->cached_metadata)
            dbase.DropMetadataRef(trans->cached_metadata);
        trans->cached_metadata = NULL;

        //Download new metadata
        trans->DownloadMetadata();

        if (!metadataversion)
        {
                metadataversion = trans->cached_metadata->GetVersion();
                metadataclock = trans->cached_metadata->GetClock();
        }

        //Store it in the cache, if it's newer
        {
                TCPFrontend::LockedSharedData::WriteRef lock(dbase.shareddata);
                if (!lock->lastmetadata || lock->lastmetadata->GetVersion() < metadataversion || lock->lastmetadata->GetClock() < metadataclock)
                {
                        //Upgrade metadata
                        if (lock->lastmetadata)
                        {
                                if (--lock->lastmetadata->refcount == 0)
                                    delete lock->lastmetadata;
                                lock->lastmetadata=NULL;
                        }

                        //Take over the reference
                        lock->lastmetadata = trans->cached_metadata;
                        ++trans->cached_metadata->refcount;
                }
        }
}

Blex::RandomStream * TransactConnection::OpenBlob(BlobId blob, Blex::FileOffset cached_length, bool backup_transaction)
{
        if (blob == 0) //the 'empty' blob
            return new Blex::MemoryReadStream(NULL,0);

        std::unique_ptr< TransactConnection::RemoteBlob > newblob(new RemoteBlob(*this, blob, cached_length, backup_transaction));
        openblobs.insert(newblob.get());
        return newblob.release();
}

AsyncEventType::Type TransactConnection::GetNextAsyncEventType(bool block)
{
        if (expect_advance_response)
        {
                DBC_PRINT("Swallowing superfluous FinishAdvanceRequest (we are waiting for an async event)");
                FinishAdvanceRequest(); //just kill it
        }

        if (async_packets.empty())
        {
                try
                {
                        if (!dbconn->ReceivePacket(&iobuf, block ? Blex::DateTime::Max() : Blex::DateTime::Invalid()))
                            return AsyncEventType::None;
                }
                catch (Exception &e)
                {
                        // Disconnects and timeouts can be viewed as disconnects.
                        if (e.errorcode == ErrorDisconnect || e.errorcode == ErrorTimeout)
                            return AsyncEventType::Disconnected;
                        else
                            throw;
                }
                if (!(iobuf.GetOpcode() & ResponseOpcode::AsyncMask))
                {
                        throw Exception(ErrorInternal, "Received a synchronous reply when waiting on an asynchronous one! ("+ResponseOpcode::GetName(ResponseOpcode::Type(iobuf.GetOpcode())) + ")");
                }

                async_packets.push_back(iobuf);
        }

        switch (async_packets[0].GetOpcode())
        {
        case ResponseOpcode::Ask:       return AsyncEventType::Ask;
        case ResponseOpcode::Notify:    return AsyncEventType::Notify;
        case ResponseOpcode::Message:   return AsyncEventType::Message;
        default:
            throw Exception(ErrorProtocol, "Received illegal asynchronous RPC code");
        }
}

/*
AsyncEventType::Type TransactConnection::GetAsyncEvent(IOBuffer *iobuf)
{
        AsyncEventType::Type type = IsAsyncEventAvailable();
        if (type == AsyncEventType::None)
        {
                dbconn->ReceivePacket(iobuf);
                if (!(iobuf->GetOpcode() & ResponseOpcode::AsyncMask))
                {
                        throw Exception(ErrorInternal, "Received a synchronous reply when waiting on an asynchronous one! ("+ResponseOpcode::GetName(ResponseOpcode::Type(iobuf->GetOpcode())) + ")");
                }

                // FIXME: code duplication with IsAsyncEventAvailable
                switch (iobuf->GetOpcode())
                {
                case ResponseOpcode::Ask:       return AsyncEventType::Ask;
                case ResponseOpcode::Notify:    return AsyncEventType::Notify;
                case ResponseOpcode::Message:   return AsyncEventType::Message;
                default:
                    throw Exception(ErrorProtocol, "Received illegal asynchronous RPC code");
                }
        }

        *iobuf = async_packets[0]; // FIXME: swap!
        async_packets.erase(async_packets.begin());
        return type;
} */

void TransactConnection::AsyncSendReply(uint32_t msgid, Record const &reply)
{
        IOBuffer mybuf;

        mybuf.ResetForSending();
        mybuf.Write<uint32_t>(0);
        mybuf.Write(msgid);
        mybuf.Write(reply);
        mybuf.FinishForReplying(false);

        // Send the packet, but we don't care if it has been sent, we just want to return.
        dbconn->SendPacket(mybuf, Blex::DateTime::Invalid());
}

void TransactConnection::SubscribeAsListener(std::string const &name, NotificationRequests const &notes, std::string const &login, std::string const &passwd)
{
        iobuf.ResetForSending();
        iobuf.Write<uint32_t>(0); //View
        iobuf.Write(name);
        iobuf.Write(notes);
        iobuf.Write(login);
        iobuf.Write(passwd);
        iobuf.FinishForRequesting(RequestOpcode::SubscribeAsListener);
        RemoteRequest(&iobuf);

        current_notifs = notes;
}

void TransactConnection::MakeBlobsPersistent(std::vector< BlobId > const &blobs)
{
        unsigned current = 0;
        unsigned size = blobs.size();
        while (current != size)
        {
                unsigned max = std::min(current + 256, size);

                iobuf.ResetForSending();
                iobuf.Write<uint32_t>(0); //View
                iobuf.Write<uint32_t>(max - current); //Number of blobs
                for (; current != max; ++current)
                    iobuf.Write<uint32_t>(blobs[current]);
                iobuf.FinishForRequesting(RequestOpcode::BlobMarkPersistent);
                RemoteInform(&iobuf);
        }
}

void TransactConnection::MakeBlobsUnused(std::vector< BlobId > const &blobs)
{
        unsigned current = 0;
        unsigned size = blobs.size();
        while (current != size)
        {
                unsigned max = std::min(current + 256, size);

                iobuf.ResetForSending();
                iobuf.Write<uint32_t>(0); //View
                iobuf.Write<uint32_t>(max - current); //Number of blobs
                for (; current != max; ++current)
                    iobuf.Write<uint32_t>(blobs[current]);
                iobuf.FinishForRequesting(RequestOpcode::BlobDismiss);
                RemoteInform(&iobuf);
        }
}

bool TransactConnection::AddToWaiterRead(Blex::PipeWaiter &waiter)
{
        if (GetNextAsyncEventType(false) != AsyncEventType::None)
            return true;

        dbconn->AddToWaiterRead(waiter);
        return false;
}

bool TransactConnection::IsReadSignalled(Blex::PipeWaiter &waiter)
{
        return dbconn->IsReadSignalled(waiter);
}

void TransactConnection::ReceiveAsk(uint32_t *messageid, WritableRecord *rec, std::unique_ptr< TransFrontend > *trans)
{
        assert(!async_packets.empty() && async_packets[0].GetOpcode() == ResponseOpcode::Ask);
        if (notifications_opened)
            throw Exception(ErrorInvalidArg, "Notifications must be closed before accepting another asynchronous event");

        *messageid = async_packets[0].Read<uint32_t>();
        async_packets[0].ReadIn(rec);

        int32_t view_id = rec->GetCell(65533).Integer();
        Blex::DateTime metadataclock = rec->GetCell(65534).DateTime();
        uint32_t metadataversion = rec->GetCell(65535).Integer();
        if (trans)
        {
                trans->reset(new TransFrontend(dbase, *this, view_id, false, false));
                GetMetadata(trans->get(), metadataversion, metadataclock);
        }

        async_packets.erase(async_packets.begin());
}

void TransactConnection::ReceiveMessage(WritableRecord *rec)
{
        assert(!async_packets.empty() && async_packets[0].GetOpcode() == ResponseOpcode::Message);
        if (notifications_opened)
            throw Exception(ErrorInvalidArg, "Notifications must be closed before accepting another asynchronous event");

        async_packets[0].ReadIn(rec);

        async_packets.erase(async_packets.begin());
}

void TransactConnection::ReceiveNotify(std::vector< bool > *changed_tables)
{
        assert(!async_packets.empty() && async_packets[0].GetOpcode() == ResponseOpcode::Notify);
        if (notifications_opened)
            throw Exception(ErrorInvalidArg, "Notifications must be closed before accepting another asynchronous event");

        // Read number of changed tables
        uint32_t tablecount = async_packets[0].Read<uint32_t>();

        changed_tables->resize(tablecount);
        for (unsigned idx = 0; idx < tablecount; ++idx)
            (*changed_tables)[idx] = async_packets[0].Read<uint8_t>() != 0;

        async_packets.erase(async_packets.begin());

        iobuf.ResetForSending();
        iobuf.Write<uint32_t>(0);
        iobuf.FinishForRequesting(RequestOpcode::NotifyOpen);
        RemoteRequest(&iobuf);

        notifications_opened = true;
}

void TransactConnection::ReceiveAsyncEvent()
{
        assert(!async_packets.empty());
        if (async_packets[0].GetOpcode() == ResponseOpcode::Notify)
            throw Exception(ErrorInvalidArg, "Notifications must be processed using ReceiveNotify!");
        if (notifications_opened)
            throw Exception(ErrorInvalidArg, "Notifications must be closed before accepting another asynchronous event");

        async_packets.erase(async_packets.begin());
}

std::unique_ptr< ResultSetScanner > TransactConnection::GetNotifications(std::string const &schema, std::string const &table)
{
        if (!notifications_opened)
            throw Exception(ErrorInvalidArg, "Notifications cannot be received until a notification has been opened");

        std::unique_ptr< ResultSetScanner > scanner;

        for (unsigned idx = 0, end = current_notifs.requests.size(); idx < end; ++idx)
            if (Blex::StrCaseCompare(current_notifs.requests[idx].schema, schema) == 0 &&
                Blex::StrCaseCompare(current_notifs.requests[idx].table, table) == 0)
            {
                    iobuf.ResetForSending();
                    iobuf.Write<uint32_t>(0);
                    iobuf.Write((uint32_t)idx);
                    iobuf.FinishForRequesting(RequestOpcode::NotifyScan);
                    RemoteRequest(&iobuf);

                    scanner.reset(new ResultSetScanner(new RawScanIterator(iobuf, *this, 0)));
                    break;
            }
        return scanner;
}

void TransactConnection::CloseNotifications()
{
        if (!notifications_opened)
            throw Exception(ErrorInvalidArg, "Notifications transactions cannot be closed when not opened first");

        iobuf.ResetForSending();
        iobuf.Write<uint32_t>(0);
        iobuf.FinishForRequesting(RequestOpcode::NotifyClose);
        RemoteRequest(&iobuf);

        notifications_opened = false;
}

bool TransactConnection::CheckLiveness()
{
        try
        {
                // Check if an async event is in queue. Will detect a broken connection
                AsyncEventType::Type type = GetNextAsyncEventType(false);

                // If a disconnect was received then the connectionsly obviously ain't alive anymore
                if (type == AsyncEventType::Disconnected)
                    return false;
        }
        catch (Database::Exception &)
        {
                // If any exceptions here, the connection must be dead.
                return false;
        }

        // No disconnect, requested pings are satisfied; the connection seems alive.
        return true;
}

bool TransactConnection::HasConnectionFailed()
{
        return !dbconn.get() || dbconn->HasFailed();
}


///////////////////////////////////////////////////////////////////////////////
//
// TransactConnection::RemoteBlob
//

TransactConnection::RemoteBlob::RemoteBlob(TransactConnection &conn, BlobId blobid, Blex::FileOffset filelength, bool backup_transaction)
: Stream(false)
, Blex::RandomStreamBuffer(MaxBlobReadSize)
, conn(&conn)
, backup_transaction(backup_transaction)
, blobid(blobid)
, filelength(filelength)
{
}
TransactConnection::RemoteBlob::~RemoteBlob()
{
        if (conn)
            conn->openblobs.erase(this);
}

std::size_t TransactConnection::RemoteBlob::ReadFromDbase(Blex::FileOffset startpos,void *buf,std::size_t maxbufsize)
{
        return conn->ReadBlobFromDbase(blobid, startpos, buf, maxbufsize, backup_transaction);
}

std::size_t TransactConnection::ReadBlobFromDbase(BlobId blobid, Blex::FileOffset startpos,void *buf,std::size_t maxbufsize,bool backup_transaction)
{
        //(ADDME: Handle cases where startpos and bufsize are 'close enough')
        std::size_t haveread;

        if (advance_blob == blobid && advance_startpos == startpos && advance_maxbufsize == maxbufsize)
        {
                //DBC_PRINT("Satisfy ReadFromDbase from advance read");
                FinishAdvanceRequest();

                std::pair<uint8_t const*,uint8_t const *> data = advance_blob_iobuf.ReadBinary();
                haveread = data.second-data.first;
                memcpy(buf, data.first, haveread);
        }
        else //Do a new request
        {
                //Request the bytes (FIXME: Combine code with Advance read packet code below)
                iobuf.ResetForSending();
                iobuf.Write<uint32_t>(0);
                iobuf.Write(blobid);
                iobuf.Write< uint64_t >(startpos);
                iobuf.Write< uint32_t >(maxbufsize);
                iobuf.Write<uint8_t>(backup_transaction ? 1 : 0);
                iobuf.FinishForRequesting(RequestOpcode::BlobRead);
                RemoteRequest(&iobuf);

                //Store the received bytes
                std::pair<uint8_t const*,uint8_t const *> data = iobuf.ReadBinary();
                haveread = data.second-data.first;
                memcpy(buf, data.first, haveread);
        }

        //If we did the maximum possible read, speculate that we'll do another
        if (maxbufsize == MaxBlobReadSize && haveread == maxbufsize)
        {
                if (advance_blob != 0)
                {
                        DBC_PRINT("Killing superfluous FinishAdvanceRequest (we wasted it)");
                        FinishAdvanceRequest(); //just kill it
                }

                advance_blob = blobid;
                advance_startpos = startpos + MaxBlobReadSize;
                advance_maxbufsize = MaxBlobReadSize;

                advance_blob_iobuf.ResetForSending();
                advance_blob_iobuf.Write<uint32_t>(0);
                advance_blob_iobuf.Write(blobid);
                advance_blob_iobuf.Write<uint64_t>(advance_startpos);
                advance_blob_iobuf.Write<uint32_t>(advance_maxbufsize);
                advance_blob_iobuf.Write<uint8_t>(backup_transaction ? 1 : 0);
                advance_blob_iobuf.FinishForRequesting(RequestOpcode::BlobRead);
                RemoteAdvanceRequest(&advance_blob_iobuf);
        }

        return haveread;
}

std::size_t TransactConnection::RemoteBlob::RawDirectRead(Blex::FileOffset startpos,void *buf,std::size_t maxbufsize)
{
        char *bufptr = static_cast<char*>(buf);
        if (!conn)
            throw Exception(ErrorIO,"Transaction is closed - blobs inside this transaction can no longer be read");

        maxbufsize = std::size_t(std::min<Blex::FileOffset>(maxbufsize, filelength - startpos));

        std::size_t totalbytesread=0;
        while(totalbytesread<maxbufsize) //read in MaxBlobReadSize chunks
        {
                std::size_t toread=std::min<unsigned>(maxbufsize-totalbytesread, MaxBlobReadSize);
                std::size_t bytesread=ReadFromDbase(startpos, bufptr, toread);

                startpos+=bytesread;
                bufptr+=bytesread;
                totalbytesread+=bytesread;
                if (bytesread<toread)
                    break;
        }
        return totalbytesread;
}

Blex::FileOffset TransactConnection::RemoteBlob::GetFileLength()
{
        return filelength;
}

std::size_t TransactConnection::RemoteBlob::RawDirectWrite(Blex::FileOffset ,const void *,std::size_t )
{
        throw Database::Exception(ErrorInternal,"Database blobs are read-only");
}

bool TransactConnection::RemoteBlob::SetFileLength(Blex::FileOffset )
{
        throw Database::Exception(ErrorInternal,"Database blobs are read-only");
}

// -----------------------------------------------------------------------------
//
// AsyncThread
//
// -----------------------------------------------------------------------------


AsyncThread::AsyncThread(NotificationRequests const &notes,std::string const &_listener,TCPFrontend &dbase)
: dbase(dbase)
, reqs(notes)
, listenername(_listener)
, threadrunner(std::bind(&AsyncThread::ThreadCode,this))
{
        //DEBUGONLY(state.SetupDebugging("AsyncThread::stopflag"));
        LockedState::WriteRef lock(state);
        lock->must_stop=false;
        lock->is_connected=false;
}

AsyncThread::~AsyncThread() //throw()
{
        Stop(true);
}

void AsyncThread::StartConnecting()
{
        if (!threadrunner.Start())
            throw Exception(ErrorInternal,"Cannot spawn thread for asynchronous notifications");
}

void AsyncThread::Stop(bool wait_for_finish)
{
        {
                LockedState::WriteRef lock(state);
                lock->must_stop=true;
                if (lock->is_connected)
                    dbconn->dbconn->AsyncClose();
        }
        state.SignalAll();
        if (wait_for_finish)
            threadrunner.WaitFinish();
}


void AsyncThread::ProcessNotify(IOBuffer &)
{
        dbconn->ReceiveNotify(&changed_tables);

        NotifyTableChange();

        dbconn->CloseNotifications();
}

void AsyncThread::ProcessMessage(IOBuffer &)
{
        WritableRecord indata; //ADDME: Scratch buffer for async threads?

        dbconn->ReceiveMessage(&indata);
        ReceiveTell(indata);
}

void AsyncThread::ProcessAsk(IOBuffer &)
{
        uint32_t messageid;
        WritableRecord indata; //ADDME: Scratch buffer for async threads?

        dbconn->ReceiveAsk(&messageid, &indata, 0);
        ReceiveAsk(messageid,indata);
}

std::unique_ptr< NotificationScanner > AsyncThread::GetNotifications(unsigned tableidx)
{
        std::unique_ptr< NotificationScanner > scanner;
        if (tableidx < changed_tables.size() && !changed_tables[tableidx])
            return scanner;

//        DBC_PRINT("Querying notifications for " << reqs.requests[tableidx].table);

        IOBuffer mybuf;
        mybuf.ResetForSending();
        mybuf.Write<uint32_t>(0);
        mybuf.Write((uint32_t)tableidx);
        mybuf.FinishForRequesting(RequestOpcode::NotifyScan);
        dbconn->RemoteRequest(&mybuf);
        scanner.reset(new NotificationScanner(*dbconn, mybuf));
        return scanner;
}

void AsyncThread::SendReply(uint32_t msgid, Database::Record reply)
{
/*        IOBuffer mybuf;

        mybuf.ResetForSending();
        mybuf.Write<uint32_t>(0);
        mybuf.Write(msgid);
        mybuf.Write(reply);
        mybuf.FinishForReplying(false);*/

        {
                LockedState::WriteRef lock(state);
                if (!lock->is_connected)
                    return;
        }
        dbconn->AsyncSendReply(msgid, reply);
//        AsyncSendPacket(mybuf);
}

//*
void AsyncThread::AsyncLoop()
{
        IOBuffer iobuf;

        DBC_PRINT("AsyncThread: have database connection");

        while (true)
        {
                // FIXME: what happens on disconnect?
                AsyncEventType::Type type = dbconn->GetNextAsyncEventType(true);
                switch (type)
                {
                case AsyncEventType::Disconnected:
                        return;
                case AsyncEventType::Notify:
                        ProcessNotify(iobuf);
                        break;
                case AsyncEventType::Message:
                        ProcessMessage(iobuf);
                        break;
                case AsyncEventType::Ask:
                        ProcessAsk(iobuf);
                        break;
                default:
                        throw Database::Exception(ErrorProtocol,"Unknown notification type");
                }
        }
}//*/
//*
void AsyncThread::ThreadCode()
{
        while (true)
        {
                if (LockedState::ReadRef(state)->must_stop)
                    return; //we should disconnect...

                //Connect to the database
                try
                {
                        {
                                LockedState::WriteRef lock(state);

                                dbconn.reset(dbase.BeginTransactConnection(listenername/*,reqs*/));
                                dbconn->SubscribeAsListener(listenername, reqs, "~webhare", "");

                                //There is a race condition - we will miss a TCP abort
                                if (lock->must_stop)
                                    return; //we should disconnect...

                                lock->is_connected=true;
                        }

                        NotifyConnected();
                        AsyncLoop();

                        {
                                LockedState::WriteRef lock(state);
                                lock->is_connected=false;
                        }
                        NotifyDisconnected();
                }
                catch (Exception &e)
                {
                        DBC_PRINT("AsyncThread: Failed to connect to the database:" << e.what());
                        LockedState::ReadRef stoplock(state);

                       if (stoplock->must_stop)
                            return;

                        stoplock.TimedWait(Blex::DateTime::Now() + Blex::DateTime::Seconds(5)); //wait 5 seconds before reconnection
//                        continue; //retry to connect
                }
                catch (std::exception &e)
                {
                        DBC_PRINT("Exception in async thread: " << e.what());
                        LockedState::ReadRef stoplock(state);

                        if (stoplock->must_stop)
                            return;

                        stoplock.TimedWait(Blex::DateTime::Now() + Blex::DateTime::Seconds(5)); //wait 5 seconds before reconnection
//                        continue;
                }
        }
}

void AsyncThread::NotifyTableChange()
{
        DBC_PRINT("Database connection: Thread dropped notification");
}
void AsyncThread::NotifyConnected()
{
        DBC_PRINT("Database connection: Thread dropped connection message");
}
void AsyncThread::NotifyDisconnected()
{
        DBC_PRINT("Database connection: Thread dropped disconnection message");
}

void AsyncThread::ReceiveTell(Database::Record )
{
        DBC_PRINT("Database connection: Thread dropped tell message");
}

void AsyncThread::ReceiveAsk(uint32_t,Database::Record)
{
        DBC_PRINT("Database connection: Thread dropped ask message");
} //*/

///////////////////////////////////////////////////////////////////////////////
//
// ViewFrontend
//


bool TransFrontend::Tell(std::string const &name, WritableRecord const &inout)
{
        if (remoteconn==NULL)
            throw Exception(ErrorInternal,"Trying to use a closed transaction");

        iobuf.ResetForSending();
        iobuf.Write<uint32_t>(trans_dbid);
        iobuf.Write(name);
        iobuf.Write(inout);
        iobuf.FinishForRequesting(RequestOpcode::Tell);
        remoteconn->RemoteRequest(&iobuf);

        ///\todo Report listener not found errors
        return iobuf.Read<bool>();
}

bool TransFrontend::Ask(std::string const &name, WritableRecord *inout)
{
        if (remoteconn==NULL)
            throw Exception(ErrorInternal,"Trying to use a closed transaction");

        iobuf.ResetForSending();
        iobuf.Write<uint32_t>(trans_dbid);
        iobuf.Write(name);
        iobuf.Write(*inout);
        iobuf.FinishForRequesting(RequestOpcode::Ask);
        remoteconn->RemoteRequest(&iobuf);

        if (!iobuf.Read<bool>())
            return false;

        iobuf.ReadIn(inout);
        return true;
}

void TransFrontend::SetRoles(std::vector<RoleId> const &roles)
{
        if (remoteconn==NULL)
            throw Exception(ErrorInternal,"Trying to use a closed transaction");

        iobuf.ResetForSending();
        iobuf.Write< uint32_t >(trans_dbid);
        iobuf.Write< int32_t >(roles.size());
        for (unsigned i=0; i<roles.size(); ++i)
            iobuf.Write(roles[i]);
        iobuf.FinishForRequesting(RequestOpcode::TransactionSetRoles);

        remoteconn->RemoteRequest(&iobuf);
}

//ADDME: I want this to return an auto_ptr, but BCB crashes on exceptions
SQLResultScanner * TransFrontend::SendSQLCommand(std::string const &cmd)
{
        if (remoteconn==NULL)
            throw Exception(ErrorInternal,"Trying to use a closed transaction");

        iobuf.ResetForSending();
        iobuf.Write<uint32_t>(trans_dbid);
        iobuf.WriteBinary(cmd.size(),reinterpret_cast<const uint8_t*>(&cmd[0]));
        iobuf.FinishForRequesting(RequestOpcode::SQLCommand);
        remoteconn->RemoteRequest(&iobuf);
        bool update_metadata = iobuf.Read<bool>();

        std::unique_ptr <SQLResultScanner> scanner;
        scanner.reset(new SQLResultScanner(*remoteconn, iobuf, *this));

        if (update_metadata)
        {
                dbase.DropMetadataRef(cached_metadata);
                cached_metadata=NULL;
                //update it from the server
                DownloadMetadata();
        }
        return scanner.release();
}

void TransFrontend::InsertRecord(Blex::StringPair const &tablename, const char **columns, WritableRecord const &recupdate)
{
        const TableInfo *tabledef=GetConfig().GetTableInfo(tablename);
        if (!tabledef)
            throw Exception(ErrorInvalidArg,"No such table " + tablename.stl_str());

        std::vector< ClientColumnInfo const * > columninfos;

        unsigned count = 0;
        while (columns[count])
          ++count;

        columninfos.reserve(count);

        for (unsigned idx = 0; idx < count; ++idx)
        {
                ClientColumnInfo const *column = tabledef->GetClientColumnInfo(columns[idx], false);
                if (!column)
                    throw Exception(ErrorInvalidArg,"No such column " + std::string(columns[idx]) + " in table " + tabledef->name);

                columninfos.push_back(column);
        }

        InsertRecord(tabledef, count, &columninfos[0], recupdate);
}

void TransFrontend::InsertRecord(TableInfo const *tableinfo, unsigned column_count, ClientColumnInfo const *columns[], WritableRecord const &recupdate)
{
        WritableRecord recupdate_copy(recupdate);

        if (remoteconn==NULL)
            throw Exception(ErrorInternal,"Trying to use a closed transaction");

        iobuf.ResetForSending();
        iobuf.Write<uint32_t>(trans_dbid);
        iobuf.Write<int32_t>(tableinfo->db_id);

        unsigned db_ids[65536];

        for (unsigned idx = 0; idx < column_count; ++idx)
            db_ids[idx] = columns[idx]->db_id;

        unsigned rec_size = recupdate_copy.GetNumCells();
        for (unsigned idx = 0; idx < rec_size; ++idx)
        {
                unsigned colid = recupdate_copy.GetColumnIdByNum(idx);
                if (colid >= column_count)
                    throw Exception(ErrorInvalidArg,"Invalid record passed");
                recupdate_copy.SetColumnIdByNum(static_cast< uint16_t >(idx), static_cast< uint16_t >(db_ids[colid]));
        }

        iobuf.Write(recupdate_copy);
        iobuf.FinishForRequesting(RequestOpcode::RecordInsert);
        remoteconn->RemoteRequest(&iobuf);
}


//*****************************************************************************
// General transaction stuff
//*****************************************************************************

TransFrontend::TransFrontend(TCPFrontend &dbase, TransactConnection &conn, int32_t trans_dbid, bool _autotrans, bool _backup_transaction)
: cached_metadata(NULL)
, remoteconn(&conn)
, trans_dbid(trans_dbid)
, dbase(dbase)
, is_autotrans(_autotrans)
, is_explicitly_opened(!_autotrans)
, rollback_on_destruction(true)
, wantrpcinfo(false)
, backup_transaction(_backup_transaction)
{
//        ViewPtr primary_view(new ViewFrontend(*this, 0, primary_view_dbid));
//        views.push_back(primary_view);
}

TransFrontend::~TransFrontend()
{
        DBC_PRINT("Closing trans " << this);
#if defined(PROFILE) || defined(DEBUG)
        DBC_PRINT("Transaction frontend " << transtimer);
//        if (remoteconn.get())
//            Blex::ErrStream() << "I/O-only part of trx: " << remoteconn->iotimer;
#endif

        // Not committed or rolled back?
        if (remoteconn && rollback_on_destruction)
        {
                try
                {
                        FinishInternal(false, true);
                }
                catch (std::exception &)
                {
                        // Ignore the error from the rollback; we don't want to crash
                }
        }

        if (cached_metadata)
            dbase.DropMetadataRef(cached_metadata);
}

void TransFrontend::DisableRollbackOnDestruction()
{
        rollback_on_destruction = false;
}

bool TransFrontend::CheckLiveness()
{
        return remoteconn->CheckLiveness();
}

//ViewFrontend &TransFrontend::GetView(int32_t viewid)
//{
//        if(static_cast<unsigned>(viewid) >= views.size())
//            throw Exception(ErrorInternal,"No such view " +Blex::AnyToString(viewid));
//        return *views[viewid];
//}

void TransFrontend::RefreshMetadata()
{
        remoteconn->GetMetadata(this, 0, Blex::DateTime::Invalid());
}

BlobId TransFrontend::UploadBlob(Blex::RandomStream &infile)
{
        infile.SetOffset(0);

        Blex::PodVector<uint8_t> buffer(16384);
        Blex::FileOffset bytesleft = infile.GetFileLength();
        while (true)
        {
                unsigned bytesread = infile.Read(&buffer[0],buffer.size());
                if (bytesread < std::min<Blex::FileOffset>(buffer.size(),bytesleft))
                    throw Exception(ErrorIO,"Error transmitting local file");

                bool eof = bytesleft==bytesread;

                iobuf.ResetForSending();
                iobuf.Write<uint32_t>(trans_dbid);
                iobuf.Write(eof);
                iobuf.WriteBinary(bytesread,&buffer[0]);
                iobuf.FinishForRequesting(RequestOpcode::BlobUpload);
                remoteconn->RemoteRequest(&iobuf);

                if (eof)
                {
                        return iobuf.Read<uint32_t>();
                }
                else
                {
                        bytesleft -= bytesread;
                }
        }
}

int32_t TransFrontend::GetAutonumber(Blex::StringPair const &tablename, Blex::StringPair const &columnname)
{
        if (remoteconn==NULL)
            throw Exception(ErrorInternal,"Trying to use a closed transaction");

        TableInfo const *table = GetConfig().GetTableInfo(tablename);
        if (!table)
            throw Exception(ErrorInternal,"No such table " +tablename.stl_str());

        ClientColumnInfo const *column = table->GetClientColumnInfo(columnname, false);
        if (!column)
            throw Exception(ErrorInternal,"No such column " +columnname.stl_str() + " in table " + tablename.stl_str());

        iobuf.ResetForSending();
        iobuf.Write<uint32_t>(trans_dbid);
        iobuf.Write<int32_t>(table->db_id);
        iobuf.Write<uint16_t>(static_cast< uint16_t >(column->db_id));
        iobuf.FinishForRequesting(RequestOpcode::AutonumberGet);

        remoteconn->RemoteRequest(&iobuf);

        int32_t autonum = iobuf.Read<int32_t>();
//        DBC_PRINT("Requested autonumber for " << tablename << "(" << columnname << "): " << autonum);
        return autonum;
}

Blex::RandomStream* TransFrontend::OpenBlob (BlobId blob, Blex::FileOffset cached_length)
{
        return remoteconn->OpenBlob(blob, cached_length, backup_transaction);
}

void TransFrontend::BeginWork()
{
        if (remoteconn==NULL)
            throw Exception(ErrorInternal,"Trying to use a closed transaction");

        DBC_PRINT("Sending RPC BeginWork");

        iobuf.ResetForSending();
        iobuf.Write<uint32_t>(trans_dbid);
        iobuf.FinishForRequesting(RequestOpcode::TransactionExplicitOpen);
        remoteconn->RemoteRequest(&iobuf);

        wantrpcinfo = iobuf.Read< bool >();
        DBC_PRINT("Want RPC info: " << wantrpcinfo);

        is_explicitly_opened = true;
}

void TransFrontend::FinishInternal(bool commit, bool close)
{
        if (remoteconn==NULL)
            throw Exception(ErrorInternal,"Trying to use a closed transaction");

        is_explicitly_opened = false;

        iobuf.ResetForSending();
        iobuf.Write<uint32_t>(trans_dbid);
        iobuf.Write<bool>(commit);
        iobuf.Write<bool>(close);
        iobuf.FinishForRequesting(RequestOpcode::TransactionCommitRollbackClose);
        try
        {
                if (commit || !remoteconn->HasConnectionFailed())
                    remoteconn->RemoteRequest(&iobuf);
        }
        catch (Exception &)
        {
                // Don't forget to close on exception
                if (close)
                    remoteconn = 0;
                throw;
        }
        if (close)
            remoteconn = 0;
}

void TransFrontend::Finish(bool commit)
{
        FinishInternal(commit, !is_autotrans);
}

void TransFrontend::DownloadMetadata()
{
        assert(cached_metadata==NULL);
        if (remoteconn==NULL)
            throw Exception(ErrorInternal,"Trying to use a closed transaction");

        //Just request the data
        iobuf.ResetForSending();
        iobuf.Write<uint32_t>(trans_dbid);
        iobuf.FinishForRequesting(RequestOpcode::MetadataGet);
        remoteconn->RemoteRequest(&iobuf);

        /* ADDME: Instead of reparsing metadata all the time, we should cache
                  it, keep some data about whether it is valid, and reuse
                  the cached data! (it does not yet seem to be a bottleneck though) */

        //DBConfig can parse it by itself
        cached_metadata=new Client::CachedMetadata;
        cached_metadata->GetFromIOBuffer(&iobuf);
}

void IOBuffer::WriteVersionData()
{
        Write<uint8_t>(RequestOpcode::_max);
        Write<uint8_t>(ResponseOpcode::_max);
        Write<uint8_t>(ProtRevision);
}

ClientColumnInfo::ClientColumnInfo()
:db_id(0)
{
}
ClientColumnInfo::ClientColumnInfo(IOBuffer *src)
{
        src->ReadIn(&name);
        db_id = src->Read<uint16_t>();
        type = (ColumnTypes)src->Read<uint32_t>();
        internal = src->Read<bool>();
}

ClientColumnInfo ClientColumnInfo::RecordIdColumn()
{
        ClientColumnInfo retval;
        retval.name = "__INTERNAL_RECORDID";
        retval.type = TInteger;
        retval.internal = true;
        return retval;
}

TableInfo::TableInfo(IOBuffer *src)
{
        std::string schema,table;
        src->ReadIn(&schema);
        src->ReadIn(&table);

        name=schema+"."+table;
        db_id = src->Read<uint32_t>();

        while(src->Read<bool>()) //every column is preceeded by a TRUE value
        {
                ClientColumnInfo col(src);

                columns.push_back(col);
                column_names.Insert(std::make_pair(columns.back().name,columns.size() - 1));
        }

        ClientColumnInfo col_whdbrecordid;
        col_whdbrecordid.name = "WHDB_RECORDID";
        col_whdbrecordid.type = TInteger;
        col_whdbrecordid.internal = true;

        columns.push_back(col_whdbrecordid);
        column_names.Insert(std::make_pair(columns.back().name,columns.size() - 1));
}

ClientColumnInfo TableInfo::recordid_column = ClientColumnInfo::RecordIdColumn();

//*****************************************************************************
// New scanner interface
//****************************************************************************


RawScanIterator::RawScanIterator(TransFrontend &trans, Client::SearchData const &searchfor, unsigned _max_rows_in_block, bool for_updating, bool require_info, std::string const &origin)
: iobuf(trans.iobuf)
, conn(*trans.remoteconn)
, trans_dbid(trans.trans_dbid)
, has_fase2_data(_max_rows_in_block)
, max_rows_in_block(_max_rows_in_block)
, current_rows(0)
, has_fase2_columns(false)
, got_more_blocks(false)
, query_id(0)
, got_info(false)
, have_advance_read(false)
{
        if (!max_rows_in_block)
            throw Exception(ErrorInternal,"Illegal number of maximum rows in a query");

        // Get the results array from the stored instance in the transfrontend, to avoid (de)alloc costs
        std::swap(results, conn.cache_results);
        results.resize(_max_rows_in_block);

        DBC_PRINT("Sending origin: >>" << std::endl << origin << "<<");

        iobuf.ResetForSending();
        iobuf.Write<uint32_t>(trans_dbid); // FIXME: add metadata version, to check!
        iobuf.Write<uint32_t>(trans.GetConfig().GetVersion());
        iobuf.Write<uint8_t>(for_updating);
        iobuf.Write<uint8_t>(require_info);
        iobuf.Write<std::string>(origin);
        iobuf.Write<uint32_t>(max_rows_in_block);

        searchfor.EncodeIOBuffer(&iobuf);
        iobuf.FinishForRequesting(RequestOpcode::ScanStart);

        //Retrieve immediately sent block
        conn.RemoteRequest(&iobuf);
        InitializeFromIobuf();
}

RawScanIterator::RawScanIterator(IOBuffer &_iobuf, TransactConnection &_conn, TransFrontend *trans)
: iobuf(_iobuf)
, conn(_conn)
, trans_dbid(trans ? trans->trans_dbid : 0)
, current_rows(0)
, got_more_blocks(false)
, got_info(false)
, have_advance_read(false)
{
        std::swap(results, conn.cache_results);
        InitializeFromIobuf();
}

void RawScanIterator::InitializeFromIobuf()
{
        iobuf.ReadIn(&query_id);

        // Check for empty resultset
        if (query_id)
        {
                has_fase2_columns = iobuf.Read<uint8_t>();
                can_update = iobuf.Read<uint8_t>();
                max_rows_in_block = iobuf.Read<uint32_t>();
                if (iobuf.Read<uint8_t>())
                    ReadInfoFromIobuf();
                got_more_blocks = RetrieveBlock(iobuf, true, 0);
        }
        TryScheduleSpeculativeAdvance();
}

void RawScanIterator::Close()
{
        if (FinishSpeculativeAdvance())
        {
                // Process advance block, it might contain an end-of-query marker
                RetrieveBlock(advance_iobuf, true, 0);
        }

        if (query_id)
        {
                iobuf.ResetForSending();
                iobuf.Write<uint32_t>(trans_dbid);
                iobuf.Write(query_id);
                query_id = 0;
                got_more_blocks = false;
                iobuf.FinishForRequesting(RequestOpcode::ResultSetClose);
                conn.RemoteInform(&iobuf);
        }

        // If our results array is larger than the cached one, save it for reuse
        if (conn.cache_results.size() < results.size())
            std::swap(results, conn.cache_results);
}

RawScanIterator::~RawScanIterator()
{
        try
        {
                if (query_id)
                    Close();
        }
        catch (Exception &e) // Swallow exception; we're probably called due to another throw...
        {
        }
}

void RawScanIterator::RetrieveRowData(IOBuffer &buf, WritableRecord &row, bool clear)
{
        if (clear)
            row.Clear();

        uint32_t col_count = buf.Read<uint32_t>();
        for (uint32_t idx = 0; idx < col_count; ++idx)
        {
                uint16_t columnid = buf.Read<uint16_t>();
                std::pair<uint8_t const*,uint8_t const *> data = buf.ReadBinary();
                row.SetColumn(columnid, data.second - data.first, data.first);
        }
}

void RawScanIterator::ReadInfoFromIobuf()
{
        unsigned count = iobuf.Read<uint16_t>();

        for (unsigned idx = 0; idx < count; ++idx)
            info.push_back(ClientColumnInfo(&iobuf));

        got_info = true;
}

bool RawScanIterator::RetrieveBlock(IOBuffer &buf, bool new_block, unsigned *received_row_count)
{
        unsigned new_rows_count = 0;
        unsigned row_count = 0;
        uint32_t rowid;
        unsigned results_size = results.size();
        if (new_block)
        {
                for (unsigned idx = 0; idx < current_rows; ++idx)
                    results[idx].Clear();
        }
        while (true)
        {
                rowid = buf.Read<uint16_t>();
                if (rowid >= DBBRCEndOfBlock )
                    break;
                if (rowid >= new_rows_count)
                    new_rows_count = rowid + 1;
                ++row_count;

                if (results_size < new_rows_count)
                {
                        results.resize(new_rows_count);
                        has_fase2_data.resize(new_rows_count);
                        results_size = new_rows_count;
                }

                RetrieveRowData(buf, results[rowid], new_block);
                if (!new_block)
                    has_fase2_data[rowid] = true;
        }

        // Clear data for new blocks
        if (new_block)
        {
                std::fill(has_fase2_data.begin(), has_fase2_data.end(), false);
                current_rows = new_rows_count;
        }

        // Set row count if requested
        if (received_row_count)
            *received_row_count = row_count;

        // Check for end of query
        if (rowid == DBBRCEndOfQuery)
            query_id = 0;

        // Return whether more blocks are available
        return rowid == DBBRCEndOfBlock;
}

unsigned RawScanIterator::GetCurrentRowsNum()
{
        return current_rows;
}

unsigned RawScanIterator::GetNextBlock()
{
        DBC_PRINT("Getting next block for iterator " << this);
        current_rows = 0;
        if (got_more_blocks)
        {
                for (unsigned idx = 0; idx < current_rows; ++idx)
                    results[idx].Clear();
                if (query_id)
                {
                        IOBuffer *answer = &advance_iobuf;

                        // If an advance request is outstanding, wait for it!
                        FinishSpeculativeAdvance();

                        if (!have_advance_read)
                        {
                                iobuf.ResetForSending();
                                iobuf.Write<uint32_t>(trans_dbid);
                                iobuf.Write(query_id);
                                iobuf.FinishForRequesting(RequestOpcode::ResultSetAdvance);
                                conn.RemoteRequest(&iobuf);

                                answer = &iobuf;
                        }
                        got_more_blocks = RetrieveBlock(*answer, true, 0);
                        have_advance_read = false;
                }
                TryScheduleSpeculativeAdvance();
        }
        DBC_PRINT("Finished getting next block for iterator " << this);
        return current_rows;
}

void RawScanIterator::TryScheduleSpeculativeAdvance()
{
        if (got_more_blocks && !can_update && !has_fase2_columns && !conn.expect_advance_response)
        {
                DBC_PRINT("Scheduling advance read for iterator " << this);

                advance_iobuf.ResetForSending();
                advance_iobuf.Write<uint32_t>(trans_dbid);
                advance_iobuf.Write(query_id);
                advance_iobuf.FinishForRequesting(RequestOpcode::ResultSetAdvance);
                conn.RemoteAdvanceRequest(&advance_iobuf);
                conn.advance_iterator = this;
        }
        else
        {
                DBC_PRINT("Failed scheduling advance read for iterator " << this << ", more: " << got_more_blocks << ", updatable: " << can_update << ", fase2: " << has_fase2_columns);
        }
}

bool RawScanIterator::FinishSpeculativeAdvance()
{
        if (conn.expect_advance_response && conn.advance_iterator == this)
        {
                // If an advance request is outstanding, wait for it!
                conn.FinishAdvanceRequest();
        }
        return have_advance_read;
}



Record const & RawScanIterator::GetRow(unsigned row)
{
        if (row >= current_rows)
            throw Exception(ErrorInternal,"Row number out of range");
        return results[row];
}

DBLockResult RawScanIterator::LockRow(unsigned row)
{
        if (row >= current_rows)
            throw Exception(ErrorInternal,"Row number out of range");

        while (true)
        {
                iobuf.ResetForSending();
                iobuf.Write<uint32_t>(trans_dbid);
                iobuf.Write(query_id);
                iobuf.Write<uint16_t>((uint16_t)row);
                iobuf.FinishForRequesting(RequestOpcode::ResultSetLock);
                conn.RemoteRequest(&iobuf);
                DBLockResult lockres = static_cast<DBLockResult>(iobuf.Read<uint8_t>());
                switch (lockres)
                {
                case DBLRLocked:
                    {
                            // Record was locked; retrieve fase2 data
                            row = iobuf.Read<uint16_t>();
                            RetrieveRowData(iobuf, results[row], false);
                            has_fase2_data[row] = true;
                            return DBLRLocked;
                    }
                case DBLRLockedModified:
                    {
                            // Record was modified; get the new data (fase1 and fase2)
                            row = iobuf.Read<uint16_t>();
                            RetrieveRowData(iobuf, results[row], false);
                            has_fase2_data[row] = true;
                            return DBLRLockedModified;
                    }
                case DBLRGone:
                        return DBLRGone;
                default:
                        throw Exception(ErrorInternal,"Invalid response from database.");
                }
        }
}

void RawScanIterator::UnlockRow(unsigned row)
{
        if (row >= current_rows)
            throw Exception(ErrorInternal,"Row number out of range");

        iobuf.ResetForSending();
        iobuf.Write<uint32_t>(trans_dbid);
        iobuf.Write(query_id);
        iobuf.Write<uint16_t>((uint16_t)row);
        iobuf.FinishForRequesting(RequestOpcode::ResultSetUnlock);
        conn.RemoteInform(&iobuf);
}

void RawScanIterator::DeleteRow(unsigned row)
{
        if (row >= current_rows)
            throw Exception(ErrorInternal,"Row number out of range");

        iobuf.ResetForSending();
        iobuf.Write<uint32_t>(trans_dbid);
        iobuf.Write(query_id);
        iobuf.Write<uint16_t>((uint16_t)row);
        iobuf.FinishForRequesting(RequestOpcode::ResultSetDelete);
        conn.RemoteRequest(&iobuf);
}

void RawScanIterator::UpdateRow(unsigned row, WritableRecord const &recupdate)
{
        if (row >= current_rows)
            throw Exception(ErrorInternal,"Row number out of range");

        iobuf.ResetForSending();
        iobuf.Write<uint32_t>(trans_dbid);
        iobuf.Write(query_id);
        iobuf.Write<uint16_t>((uint16_t)row);
        iobuf.Write(recupdate);
        iobuf.FinishForRequesting(RequestOpcode::ResultSetUpdate);

        conn.RemoteRequest(&iobuf);
}

void RawScanIterator::RetrieveFase2Data(unsigned const *row, unsigned count, bool allow_direct_close)
{
        if (has_fase2_columns)
        {
                if (query_id == 0 && count != 0)
                    throw Exception(ErrorInternal,"Fase 2 data requested when query was already closed");

                // Repeat until all fase 2 data has arrived
                while (true)
                {
                        // Count number of rows that are don't have fase2 yet
                        unsigned new_count = 0;
                        unsigned const *row_copy = row;
                        for (unsigned count_copy = count; count_copy != 0; --count_copy, ++row_copy)
                            if (!has_fase2_data[*row_copy])
                                ++new_count;

                        // All fase 2 stuff already there? we're done!
                        if (!new_count)
                            break;

                        // Build a request for remaining fase 2 data
                        iobuf.ResetForSending();
                        iobuf.Write<uint32_t>(trans_dbid);
                        iobuf.Write(query_id);

                        iobuf.Write<uint16_t>((uint16_t)new_count);
                        row_copy = row;
                        for (;new_count != 0; --new_count)
                        {
                                while (has_fase2_data[*row_copy])
                                    ++row_copy;
                                iobuf.Write<uint16_t>((uint16_t)*(row_copy++));
                        }
                        iobuf.Write<uint8_t>(allow_direct_close);

                        // Send the request, and receive the data
                        unsigned received_rows = 0;
                        iobuf.FinishForRequesting(RequestOpcode::ResultSetFase2);
                        conn.RemoteRequest(&iobuf);
                        RetrieveBlock(iobuf, false, &received_rows);

                        // Check if all requested rows have arrived, break if not
                        if (received_rows == new_count)
                            break;
                }
        }
}

std::vector< ClientColumnInfo > const & RawScanIterator::GetClientColumnInfo()
{
        if (!got_info)
        {
                if (query_id == 0)
                    throw Exception(ErrorInternal,"Resultset has already closed, too late to get resultset info");

                iobuf.ResetForSending();
                iobuf.Write<uint32_t>(trans_dbid);
                iobuf.Write(query_id);
                iobuf.FinishForRequesting(RequestOpcode::ResultSetGetInfo);
                conn.RemoteRequest(&iobuf);

                ReadInfoFromIobuf();
        }
        return info;
}

ResultSetScanner::ResultSetScanner(RawScanIterator *_iterator)
: iterator(_iterator)
, current_row(-1)
{
}

ResultSetScanner::ResultSetScanner()
: current_row(-1)
{
}

ResultSetScanner::~ResultSetScanner()
{
}


ClientScanner::ClientScanner(TransFrontend &_trans, bool _updating_scanner, std::string const &_origin)
: trans(_trans)
, updating_scanner(_updating_scanner)
, require_info(false)
, origin(_origin)
{
}

bool ClientScanner::InitializeScan()
{
        iterator.reset(new RawScanIterator(trans, to_search, 8 /* FIXME: why blocksize of 8? */, updating_scanner, require_info, origin));
        return true;
}

ClientColumnInfo const * ClientScanner::GetClientColumnInfo(unsigned tableindex, const char *columnname) const
{
        if (tableindex>to_search.tables.size())
            throw Exception(ErrorInvalidArg,"Tableindex out of range");

        TableInfo const *tableinfo = to_search.tables[tableindex];
        ClientColumnInfo const *col = tableinfo->GetClientColumnInfo(columnname, true);
        if (col == 0)
            throw Exception(ErrorInvalidArg,"No such column " + std::string(columnname));

        return col;
}

void ClientScanner::AddTable(TableInfo const *tableinfo, const char **columnnames)
{
        to_search.tables.push_back(tableinfo);
        if (columnnames)
            RequestColumns(to_search.tables.size()-1,columnnames);
}

void ClientScanner::AddTable(std::string const &tablename, const char **columnnames)
{
        Blex::StringPair tablenamepair(tablename.begin(), tablename.end());
        TableInfo const *tableinfo = trans.GetConfig().GetTableInfo(tablenamepair);
        if (tableinfo==0)
            throw Exception(ErrorInvalidArg,"No such table " + tablename);

        AddTable(tableinfo, columnnames);
}
void ClientScanner::AddTable(const char *tablename, const char **columnnames)
{
        // FIXME: require stringpair as argument to this function
        Blex::StringPair tablenamepair = Blex::StringPair::FromStringConstant(tablename);

        TableInfo const *tableinfo = trans.GetConfig().GetTableInfo(tablenamepair);
        if (tableinfo==0)
            throw Exception(ErrorInvalidArg,"No such table " + std::string(tablename));

        AddTable(tableinfo, columnnames);
}

void ClientScanner::SetLimit(unsigned newlimit)
{
        to_search.limit=newlimit;
}

void ClientScanner::AddJoin(uint32_t left_tableindex, ClientColumnInfo const *leftcolumn, uint32_t right_tableindex, ClientColumnInfo const *rightcolumn, SearchRelationType searchtype, bool case_sensitive)
{
        to_search.AddJoinCriterium(left_tableindex, right_tableindex,
                Client::Search::Relation(leftcolumn, rightcolumn, case_sensitive, searchtype));
}

void ClientScanner::RequestAllColumns(unsigned tableindex)
{
        if (tableindex >= to_search.tables.size())
            throw Exception(ErrorInvalidArg,"Tableindex out of range");

        TableInfo const *tableinfo = to_search.tables[tableindex];
        TableInfo::Columns const &columns = tableinfo->GetColumns();
        for (TableInfo::Columns::const_iterator it = columns.begin(); it != columns.end(); ++it)
          if(it->Deprecated_GetId()!=0) //not col 0, the recordid column
            to_search.AddNeededColumn(tableindex, &*it, DBRSTFase1);
}

void ClientScanner::RequestColumns(unsigned tableindex, const char **columnnames)
{
        if (tableindex >= to_search.tables.size())
            throw Exception(ErrorInvalidArg,"Tableindex out of range");

        TableInfo const *tableinfo = to_search.tables[tableindex];
        while (*columnnames)
        {
                ClientColumnInfo const *column = tableinfo->GetClientColumnInfo(*columnnames, true);
                if (!column)
                    throw Exception(ErrorInvalidArg,"Column " + std::string(*columnnames) + " does not exist in table " + tableinfo->name);
                to_search.AddNeededColumn(tableindex, column, DBRSTFase1);
                columnnames++;
        }
}

void ClientScanner::RequestColumns(unsigned tableindex, unsigned column_count, const ClientColumnInfo *columninfos[])
{
        if (tableindex >= to_search.tables.size())
            throw Exception(ErrorInvalidArg,"Tableindex out of range");

        for (unsigned idx = 0; idx < column_count; ++idx)
            to_search.AddNeededColumn(tableindex, columninfos[idx], DBRSTFase1);
}

void ClientScanner::RequireInfo()
{
        if (iterator.get())
            throw Exception(ErrorInvalidArg,"Info can only be required before a query has started");
        require_info = true;
}

bool ResultSetScanner::InitializeScan()
{
        throw Exception(ErrorInvalidArg,"ResultSetScanner instantiated without needed InitializeScan");
}

Record const & ResultSetScanner::GetRowRecord()
{
        return iterator->GetRow(current_row);
}

Cell ResultSetScanner::GetCell(uint16_t cellindex)
{
//        if (cellindex >= to_search.GetNumNeededColumns())
//            throw Exception(ErrorInvalidArg,"Cellindex out of range");

        //ADDME: Tracking requested columns etc would be unnecessary if the
        //       RPC layers just provided the records in merged form.
        return iterator->GetRow(current_row).GetCell(cellindex);
}

bool ResultSetScanner::NextRow()
{
        if (!iterator.get())
        {
                if (current_row >= 0)
                    throw Exception(ErrorInvalidArg,"Re-trying to iterate after closing cursor");

                //still need to initialize!
                if (!InitializeScan() || !iterator.get())
                    return false;

                current_row=0;
        }
        else
            ++current_row;

        if ((uint32_t)current_row == iterator->GetCurrentRowsNum()) //end of block?
        {
                current_row = 0;
                if (iterator->GetNextBlock() == 0)
                {
                        // Don't kill the iterator if it still holds info
                        if (!iterator->GotInfo())
                        {
                                iterator->Close();
                                iterator.reset();
                        }
                        return false;
                }
        }
        return true;
}

void ResultSetScanner::Close()
{
        if (iterator.get())
        {
                iterator->Close();
                iterator.reset();
        }
}

DBLockResult ResultSetScanner::LockRow()
{
        return iterator->LockRow(current_row);
}

void ResultSetScanner::UnlockRow()
{
        iterator->UnlockRow(current_row);
}

void ResultSetScanner::DeleteRow()
{
        iterator->DeleteRow(current_row);
}

void ResultSetScanner::UpdateRow(WritableRecord const &recupdate)
{
        iterator->UpdateRow(current_row, recupdate);
}

std::vector< ClientColumnInfo > const & ResultSetScanner::GetInfo()
{
        if (!iterator.get())
            throw Exception(ErrorInvalidArg,"Resultset not open, impossible to get info");

        return iterator->GetClientColumnInfo();
}

void ResultSetScanner::DumpCurrentRow()
{
#ifdef DEBUG
        std::stringstream str;
        if (!iterator.get())
            throw Exception(ErrorInvalidArg,"No valid row to dump");

        std::vector< ClientColumnInfo > const & info = iterator->GetClientColumnInfo();
        str << "[";
        uint16_t idx = 0;
        for (std::vector< ClientColumnInfo >::const_iterator it = info.begin(); it != info.end(); ++it, ++idx)
        {
                if (it != info.begin())
                    str << ", ";

                str << it->name << ": ";
                Cell cell = GetCell(idx);
                switch (it->type)
                {
                case TInteger:          str << cell.Integer(); break;
                case TText:             str << cell.String(); break;
                case TDateTime:         str << cell.DateTime(); break;
                case TBoolean:          str << cell.Boolean(); break;
                default:
                   str << "*type:" << it->type << "*"; break;
                }
        }
        str << "]" << std::endl;

        DBC_PRINT(str.str());
#endif
}

SQLResultScanner::SQLResultScanner(TransactConnection &conn, IOBuffer &initial_buffer, TransFrontend &trans)
: ResultSetScanner(new RawScanIterator(initial_buffer, conn, &trans))
{

}


NotificationScanner::NotificationScanner(TransactConnection &conn, IOBuffer const &initial_buffer)
: iobuf(initial_buffer)
, scanner(new RawScanIterator(iobuf, conn, /*trans=*/0))
, action_cell(0)
{
}

bool NotificationScanner::Next()
{
        if (!scanner.NextRow())
            return false;

        if (action_cell == 0)
            action_cell = static_cast< uint16_t >(scanner.GetRowRecord().GetNumCells() - 1);

        current_action = (Actions)scanner.GetCell(action_cell).Integer();
        if (current_action == (ActionUpdate | ActionInsert))
        {
                record_copy = scanner.GetRowRecord();
                current_action = ActionUpdate;
                if (!scanner.NextRow() || (Actions)scanner.GetCell(action_cell).Integer() != (ActionUpdate | ActionDelete))
                    throw Exception(ErrorInternal,"Illegal notification sending order");

                return true;
        }
        return true;
}

Actions NotificationScanner::GetAction()
{
        return current_action;
}

Record const & NotificationScanner::GetAddedRow()
{
        if (current_action == ActionUpdate)
            return record_copy;
        else
            return scanner.GetRowRecord();
}

Record const & NotificationScanner::GetDeletedRow()
{
        return scanner.GetRowRecord();
}

void NotificationScanner::Close()
{
        scanner.Close();
}

namespace Client
{

CachedMetadata::CachedMetadata()
: refcount(1)
{
}
CachedMetadata::~CachedMetadata()
{
}
void CachedMetadata::GetFromIOBuffer(IOBuffer *src)
{
        meta_clock = src->Read<Blex::DateTime>();
        meta_version = src->Read<uint32_t>();
        while(src->Read<bool>()) //every table is preceded by a TRUE
        {
                TableInfo table(src);
                tables.push_back(table);
                table_names.Insert(std::make_pair(tables.back().name,tables.size() - 1));
        }
        while(src->Read<bool>()) //now every schema is preceded by a TRUE
        {
                std::string schemaname;
                src->ReadIn(&schemaname);
                while(src->Read<bool>()) //and every role is preceded by a TRUE
                {
                        std::string rolename;
                        RoleId roleid;
                        src->ReadIn(&roleid);
                        src->ReadIn(&rolename);

                        roles.insert(std::make_pair(schemaname + "." + rolename,roleid));
                }
        }
}
RoleId CachedMetadata::GetRoleByName(std::string const &name) const
{
        Roles::const_iterator itr=roles.find(name);
        return itr == roles.end() ? 0 : itr->second;
}
const TableInfo* CachedMetadata::GetTableInfo(Blex::StringPair const &name) const
{
        TableNames::const_iterator itr = table_names.Find(name);
        if (itr==table_names.End())
        {
                std::string public_name = "PUBLIC.";
                public_name += name.stl_str();
                itr = table_names.Find(public_name.c_str());
                if (itr==table_names.End())
                    return NULL;
        }
        return &tables[itr->second];
}


void SearchData::EncodeIOBuffer(IOBuffer *dest) const
{
        dest->Write(limit);
        dest->Write<uint32_t>(tables.size());
        for (unsigned i=0;i<tables.size();++i)
            dest->Write<int32_t>(tables[i]->db_id);

        dest->Write<uint32_t>(items.size());
        for (unsigned i=0;i<items.size();++i)
        {
                dest->Write(items[i].tableindex);
                dest->Write(items[i].tableindex2);
                items[i].search.EncodeIOBuffer(dest);
        }

        unsigned columns_count = needed_columns.size();
        dest->Write<uint32_t>(columns_count);
        for (unsigned i=0;i<columns_count;++i)
        {
                dest->Write<uint32_t>(needed_columns[i].tableindex);
                dest->Write<uint16_t>(static_cast< uint16_t >(needed_columns[i].columninfo->db_id));
                dest->Write<uint8_t>(static_cast< uint8_t >(needed_columns[i].sendtype));
        }
}

void Search::EncodeIOBuffer(IOBuffer *dest) const
{
        dest->Write<uint8_t>(static_cast<uint8_t>(type));
        dest->Write<uint8_t>(static_cast<uint8_t>(relationtype));
        dest->Write(casesensitive);
        dest->Write<uint16_t>(static_cast< uint16_t >(GetColumn()->db_id));

        switch (type)
        {
        case JoinTwoColumns:
                dest->Write<uint16_t>(static_cast< uint16_t >(column2->db_id));
                break;

        case SingleColumn:
                dest->WriteBinary(GetData().Size(),GetData().Begin());
                break;
        }
}

/** Constructor for single column search */
Search::Search(SearchRelationType _relationtype, ClientColumnInfo const *_column,
                bool _casesensitive, uint32_t _searchsize, const uint8_t* _searchfor)
  : type(SingleColumn), relationtype(_relationtype)
  , column(_column)
  , column2(0), casesensitive(_casesensitive)
{
        _searchsize = static_cast<uint16_t>(std::min<uint32_t>(_searchsize, MaxColumnSize));
        SetCellSize(data_to_searchfor,static_cast<uint16_t>(_searchsize)); //set searchfor size

        if (_searchsize)
        {
                memcpy(data_to_searchfor+Cell::HdrSize, _searchfor, _searchsize);

                search_is_null=true;
                //FIXME imperfect null check, this would also incorrectly consider a TText containing only null bytes to be null
                for (const uint8_t *ptr=_searchfor;ptr!=_searchfor+_searchsize;++ptr)
                  if (*ptr!=0)
                {
                        search_is_null=false;
                        break;
                }
        }
}

/** Constructor for a column relation search */
Search::Search(SearchRelationType _relationtype, ClientColumnInfo const *_column, ClientColumnInfo const *_column2,
                bool _casesensitive)
  : type(JoinTwoColumns), relationtype(_relationtype)
  , column(_column)
  , column2(_column2), casesensitive(_casesensitive)
{
        SetCellSize(data_to_searchfor,0); //set searchfor size
}

SearchData::SearchData(unsigned _limit, unsigned table_count, TableInfo const *_tables[])
: limit(_limit)
, tables(_tables, &_tables[table_count])
, has_fase2_data(false)
{
}

SearchData::SearchData()
: limit(0)
, has_fase2_data(false)
{
}

void SearchData::AddNeededColumn(uint32_t tableindex, ClientColumnInfo const *columninfo, DBRecordSendType sendtype)
{
        needed_columns.push_back(NeededColumn(tableindex, columninfo, sendtype));
        if (!has_fase2_data && (sendtype & DBRSTFase2))
            has_fase2_data = true;
}

} //end namespace Client

// -----------------------------------------------------------------------------
//
// TCPFrontend
//
// -----------------------------------------------------------------------------

TCPFrontend::TCPFrontend(Blex::SocketAddress const &connectto, std::string const &clientname)
: defaultclientname(clientname)
, serveraddress(connectto)
{
        //DEBUGONLY(connections.SetupDebugging("TCPFrontend::connections"));
        LockedData::WriteRef(data)->cached_connections.reserve(MaxCacheSize);
        LockedSharedData::WriteRef(shareddata)->lastmetadata=0;
}

TCPFrontend::~TCPFrontend()
{
        {
                LockedData::WriteRef lock(data);
                for (unsigned i=0;i<lock->cached_connections.size();++i)
                    delete lock->cached_connections[i];
        }

        LockedSharedData::WriteRef lock(shareddata);
        if (lock->lastmetadata)
        {
                if (lock->lastmetadata->refcount > 1)
                {
                        Blex::ErrStream() << "Still " << lock->lastmetadata->refcount << " references to shared database metadata on termination";
                        _exit(0);
                }
                delete lock->lastmetadata;
        }
        //ADDME: Kill all connections!
}

void TCPFrontend::ReturnMyConnection(TCPConnection *conn)
{
        /* ADDME: Implement our own link-level SHUTDOWN so we don't have to
           rely on clients invoking us properly. The only reason we ask
           an upper class to do this is because 'we' don't know for sure
           when we're in protocol sync

           (Geen idee hoe relevant bovestaande code is met whrpc ombouw) */

        std::unique_ptr<TCPConnection> myconn(conn);
        if(myconn->rpcfailed)
            return;

        //Reset the connection - FIXME: Do reset asynchronously
        try
        {
                IOBuffer handshake;
                handshake.ResetForSending();
                handshake.Write<uint32_t>(0); //dummy view
                handshake.FinishForRequesting(RequestOpcode::ResetConnection);

                Blex::DateTime timeout = Blex::DateTime::Now() + Blex::DateTime::Seconds(1);
                myconn->SendPacket(handshake, timeout);
        }
        catch(std::exception &e)
        {
                IOCLIENTDEBUGPRINT("Preparing connection for recycling failed: " << e.what());
                return; //too bad - let the connection fall
        }

        //Retain the socket for later connections, if possible
        TCPFrontend::LockedData::WriteRef lock(data);
        if(lock->cached_connections.size() < MaxCacheSize)
        {
                //Make sure the pipe is empty
                //ADDME really needed? myconn->FlushPipe();
                lock->cached_connections.push_back(myconn.release());
        }
}

TCPConnection* TCPFrontend::PopCachedConn()
{
        //First grab the connection
        LockedData::WriteRef lock(data);
        if (lock->cached_connections.empty())
            return NULL;

        TCPConnection*last = lock->cached_connections.back();
        lock->cached_connections.pop_back();
        return last;
}


TCPConnection *TCPFrontend::NewConnection(bool *isfresh)
{
        *isfresh = false;
        while(true)
        {
                std::unique_ptr<TCPConnection> cached_conn;
                cached_conn.reset(PopCachedConn());

                if(!cached_conn.get())
                    break;

                if(cached_conn->CompleteConnectionReset())
                    return cached_conn.release();
        }

        std::unique_ptr< TCPConnection > newconn(new TCPConnection);
        *isfresh = true;

        //Open a connection to the database (ADDME: Should be a non-blocking timed connect)
        if (newconn->sock.Connect(serveraddress) != Blex::SocketError::NoError)
        {
                newconn->rpcfailed=true;
                IOCLIENTDEBUGPRINT("Cannot connect to database");
                throw Exception(ErrorConnectionRefused,"Cannot connect to database");
        }

        //Make the socket non-blocking
        newconn->sock.SetBlocking(false);
        newconn->sock.SetNagle(false);
        DoHandshake(newconn.get());

        return newconn.release();
}

void TCPFrontend::DoHandshake(TCPConnection *conn)
{
        //Greeting first
        IOBuffer handshake;
        handshake.ResetForSending();
        handshake.FinishForRequesting(RequestOpcode::BeginConnection);

        Blex::DateTime timeout = Blex::DateTime::Now() + Blex::DateTime::Seconds(conn->io_timeout);

        try
        {
                conn->SendPacket(handshake, timeout);
                conn->ReceivePacket(&handshake, timeout);
                if (handshake.GetOpcode() != ResponseOpcode::Answer)
                {
                        IOCLIENTDEBUGPRINT("TCP conn " << this << " RPC failure: Received asynchronous answer to connection challenge request");
                        throw Exception(ErrorProtocol,"Received wrong reply to challenge request");
                }

                if (handshake.Read<uint32_t>() != 1)
                {
                        IOCLIENTDEBUGPRINT("TCP conn " << this << " RPC failure: Received wrong reply to connection challenge request");
                        throw Exception(ErrorProtocol,"Received wrong reply to challenge request");
                }

                handshake.ResetForSending();
                handshake.FinishForRequesting(RequestOpcode::BeginConnection);

                conn->SendPacket(handshake, timeout);
                conn->ReceivePacket(&handshake, timeout);
                if (handshake.GetOpcode() != ResponseOpcode::Answer)
                {
                        IOCLIENTDEBUGPRINT("TCP conn " << this << " RPC failure: Received asynchronous answer to connection challenge response");
                        throw Exception(ErrorProtocol,"Received wrong reply to challenge response");
                }

                if (handshake.Read<uint32_t>() != 2)
                {
                        IOCLIENTDEBUGPRINT("TCP conn " << this << " RPC failure: Received wrong reply to connection challenge response");
                        throw Exception(ErrorProtocol,"Received wrong reply to challenge response");
                }
                if (handshake.Read<bool>() == false)
                         throw Exception(ErrorProtocol,"Unable to complete challenge request");
        }
        catch (Exception &)
        {
                conn->rpcfailed=true;
                throw;
        }
}


} //end namespace Database
