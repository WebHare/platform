#include <ap/libwebhare/allincludes.h>


#include <iostream>
#include "webscon.h"

//#define WEBSCONIODEBUG    //Define to enable debugging

#if defined(WEBSCONIODEBUG) && defined(DEBUG)
 #define WS_PRINT(x) DEBUGPRINT(x)
 #define WS_ONLY(x) DEBUGONLY(x)
#else
 #define WS_PRINT(x) BLEX_NOOP_STATEMENT
 #define WS_ONLY(x) BLEX_NOOP_STATEMENT
#endif


//ADDME: Current SSL code causes many small blocks to be sent, improve that

namespace WebServer
{

const unsigned PersistentConnectTimeout = 75; //maximum number of seconds a connection may be silent after a request, before killing it. 75 matches nginx's default

void Connection::HookDataBlocksSent(unsigned /*numblocks*/)
{
        //WS_PRINT("HookDataBlocksSent: " << numblocks << " blocks sent");

//        if (protocol.async_response)
//            return;

        FinishDataNow();
}

void Connection::HookSignal(Blex::Dispatcher::Signals::SignalType signal)
{
        WS_PRINT("Got HookSignal " << signal);
        switch (signal)
        {
        case Blex::Dispatcher::Signals::GotEOF:
                {
                        WS_PRINT("Incoming EOF on connection " << this);

                        // Don't try to reuse the connection for new requests
                        if (protocol.persistent)
                            request->connected = false;

                        // Current request not finished yet?
                        if (GetRequestParser().IsExpectingData())
                        {
                                // If the requestparser needs more data, it was an incomplete request
                                // Ignore it.
                                if (GetRequestParser().IsRequestStarted())
                                    request->ErrorLog("Received an incomplete request, followed by an EOF");

                                AsyncCloseConnection();
                        }
                        else
                        {
                                // Otherwise, processing is already taking place, connection will be closed
                                // afterwards.

                                if (async_itf.get())
                                    async_itf->SignalHangup();

                                if (!protocol.is_websocket)
                                {
                                        // HTTP 1.1 specs that connection close should abort the request (but a termination should always run to cleanup)
                                        WS_PRINT(" Received EOF on running request");
                                }
                        }
                }
                break;
        case Blex::Dispatcher::Signals::ConnectionClosed:
                {
                        // ResetNewConnection already executed in Signals::Hangup
                        ResetNewConnection();
                } break;
        case Blex::Dispatcher::Signals::Signalled: //we went to sleep; but beware spurious signals
//                assert(is_sleeping && !is_sleeping_for_flush);

                if (is_sleeping_for_signal && IsSignalValidRunPermission())
                {
                        WS_PRINT("WAITSESS: Got a signal!");
                        is_sleeping = false;
                        is_sleeping_for_signal = false;
                        ExecuteRequest();
                }
                break;

        case Blex::Dispatcher::Signals::TimerElapsed:
                {
                        WS_PRINT("Closing connection (client idle too long)");
                        if (ontimerelapsed)
                        {
                                std::function< void() > copy = ontimerelapsed;
                                ontimerelapsed = 0;
                                copy();
                                break;
                        }

                        RequestParser const &reqparser = GetRequestParser();
                        if (!protocol.responded && (reqparser.GetProtocolMajor() > 1 || (reqparser.GetProtocolMajor() == 1 && reqparser.GetProtocolMinor() >= 1)))
                        {
                                protocol.persistent = false;//Force closing connection
                                FailRequest(StatusRequestTimeout,"Client idle too long");
                                ExecuteRequest();
//                                ScheduleOutgoingData();

                                WS_PRINT("Timer elapsed, finishing data");
                                FinishDataNow();
                        }
                        else
                        {
                                AsyncSignal(Blex::Dispatcher::Signals::Hangup);
                        }
                } break;
        case Blex::Dispatcher::Signals::GracePeriodElapsed:
                WS_PRINT("Closing connection (client lost his tongue)");
                AsyncSignal(Blex::Dispatcher::Signals::Hangup); //in the grace period, there can never have been any protocol negotiation, so just close immediately
                break;

        case Blex::Dispatcher::Signals::Hangup:
        case Blex::Dispatcher::Signals::NewConnection:
                break; // shut up compiler
        }
}

void Connection::AsyncHookSignal(Blex::Dispatcher::Signals::SignalType  signal)
{
        if (signal == Blex::Dispatcher::Signals::Hangup)
        {
                WS_PRINT("Asynchronous disconnection");

                //ADDME: access this variable mutex-safe!
                //ADDME: Perhaps the dispatcher can detect ungraceful closes, so that we can destroy the connection anyway
                if (protocol.persistent) //we can only abort if we KNOW the client shouldn't have (don't know the difference between 'normal' and 'failed' close)
                {
                        request->connected=false;
                }
        }
        if (signal == Blex::Dispatcher::Signals::TimerElapsed)
        {
                WS_PRINT("Asynchronous timeout");
        }
}

void Connection::PullFromStream()
{
        //read from the stream what we can
        if (outstream_buffer_length < StreamBufferSize)
        {
                unsigned bytesread = outstream_str->Read(&outstream_buffer[outstream_buffer_length],StreamBufferSize - outstream_buffer_length);
                if (bytesread==0)
                    WS_PRINT("Got EOF on stream we're sending to connection");

                outstream_buffer_length+=bytesread;

                //Blex::ErrStream() << "PullFromStream: outstream_buffer_length " << outstream_buffer_length << " bytesread " << bytesread;
        }
}

void Connection::DropFromStream(unsigned sent)
{
        if (sent>0)
        {
                outstream_buffer_length-=sent;
                if(outstream_buffer_length)
                {
                        std::memmove(&outstream_buffer[0],
                                     &outstream_buffer[sent],
                                     outstream_buffer_length);
                }

                //Blex::ErrStream() << "DropFromStream: outstream_buffer_length " << outstream_buffer_length << " sent " << sent;
        }
}

void Connection::PullFromStreamOrMapping()
{
        //Try if we can find more data to send!
        if (outstream_str.get()) //Send data from our own stream
        {
                DropFromStream(outstream_lastsendsize);

                //remove sent data from our buffers
                PullFromStream();

                //pass data to the sending code..
                if (outstream_buffer_length)
                {
                        WS_PRINT("Scheduling " << outstream_buffer_length << " bytes at " << (void*)&outstream_buffer[0] << " from stream");;
                        final_senddata.push_back(Blex::Dispatcher::SendData(&outstream_buffer[0],
                                                                             outstream_buffer_length));

                        outstream_lastsendsize=outstream_buffer_length;
                }
                else
                {
                        outstream_lastsendsize=0;
                }
        }
        else if (outmmap_file.get())
        {
                //Undo current mapping
                if(outmmap_mapping)
                {
                        WS_PRINT("Unmapping " << outmmap_mappedsize << " bytes at " << (void*)outmmap_mapping);
                        outmmap_file->Unmap(outmmap_mapping, outmmap_mappedsize);
                        outmmap_offset += outmmap_mappedsize;
                        outmmap_mapping = NULL;
                }

                /* We need to decide which bytes to send, but remember
                   the following constraints:
                   - Always map a MmapBufferSize aligned block
                   - But never map in any data beyond EOF.
                   OS may not allow us to do a partial mmap of the last block in the case range_limit < outmmap_length

                   Input:
                   outmmap_offset: Offset of block to map. Initialized to range_start - (range_start % MmapBufferSize)
                   outmmap_length: Output file length
                */

                if (outmmap_offset >= range_limit) //we're done sending
                {
                        outmmap_file.reset();
                }
                else
                {
                        //How much should we map. Always MmapBufferSize, unless at EOF (note that mapping size is independent of range_start)
                        outmmap_mappedsize = outmmap_offset + MmapBufferSize >= outmmap_length ? outmmap_length - outmmap_offset : MmapBufferSize;

                        //Check if this is the sending of an unaligned head.
                        bool unaligned_head = range_start > outmmap_offset;
                        //Send start offset. When sending an unaligned head, range_start - outmmap_offset. 0 otherwise
                        unsigned buffer_start = unaligned_head ? range_start - outmmap_offset : 0;

                        assert(buffer_start < outmmap_mappedsize);

                        /* Calculate amount of data to send. startrangepos = max(outmmap_offset, range_start)
                           We should send up to range_limit - startrangepos bytes, but never more than outmmap_mappedsize - bufferstart */
                        unsigned tosend = std::min<unsigned>(unsigned(range_limit - std::max<Blex::FileOffset>(outmmap_offset, range_start))
                                                            ,outmmap_mappedsize - buffer_start);
                        assert(tosend > 0 && tosend+buffer_start <= outmmap_mappedsize);

                        WS_PRINT("Mapping " << outmmap_mappedsize << " bytes at offset " << outmmap_offset << " - sending " << tosend << " bytes starting at pos " << buffer_start);
                        outmmap_mapping=(const uint8_t*)outmmap_file->MapRO(outmmap_offset, outmmap_mappedsize);
                        if (!outmmap_mapping)
                        {
                                //ADDME: Report filename. Also, this error report is too late to affect the status code sent out, we should set up the initial block to send out before PrepareResponse to catch initial errors
                                FailRequest(StatusInternalError,"I/O error mapping file into memory");
                                AsyncSignal(Blex::Dispatcher::Signals::Hangup); //force disconnect
                                return;
                        }


                        uint8_t const *bufferstart = static_cast<uint8_t const*>(outmmap_mapping) + buffer_start;
                        final_senddata.push_back(Blex::Dispatcher::SendData(bufferstart, tosend));
                }
        }
}

bool Connection::PullAndSendOutgoingData()
{
        if (AnySendsPending())
            return true; // still sending stuff; more may be waiting for use, but we won't check that for now.

        //Handle the last send, if any. we're just sending final_senddata
//        if (got_send_completion)
//            final_senddata.clear();

        //Try if we can find more data to send!
        if (final_senddata.empty() && (outstream_str.get()||outmmap_file.get()))
            PullFromStreamOrMapping();

        if (!final_senddata.empty()) //send all data in final_senddata queue
        {
                AsyncQueueSend(final_senddata.size(),&final_senddata[0]);
                final_senddata.clear();
                //Blex::ErrStream() << "PullOutgoingData: return true";
                return true;
        }
        //Blex::ErrStream() << "PullOutgoingData: return false";
        return false;
}

void Connection::FinishDataNow()
{
        /** FIXME: what is exactly the interaction with FlushResponse here?
        */
        WS_PRINT("FinishDataNow for connection " << this);

        if (PullAndSendOutgoingData())
        {
                return; //there was more data to send..
        }

        if (protocol.responded && !protocol.async_response)
        {
                if (protocol.persistent && request->connected)
                {
                        WS_PRINT("FinishDataNow: reset for a new request (persistent connection)");
                        ResetNewRequest();
                        // ADDME?
                        //is there perhaps already a new request to parse?
                        SetTimer(Blex::DateTime::Now() + Blex::DateTime::Seconds(PersistentConnectTimeout));
                }
                else
                {
                        WS_PRINT("FinishDataNow: hangup " << (protocol.persistent ? "(persistent connection closed)" : "(no persistence)"));
                        AsyncSignal(Blex::Dispatcher::Signals::Hangup); //force disconnect
                }
        }
        else
        {
                // If we are sleeping for a flush in an async generated response, see if we need to call a callback
                if (is_sleeping_for_flush)
                {
                        // Clear output headers and body
                        output_header.Clear();
                        LockedOutputData::WriteRef(lockedoutputdata)->output_body.Clear();

                        is_sleeping_for_flush = false;
                        if (flushcallback)
                        {
                                FlushCallback copy = flushcallback;
                                flushcallback = 0;

                                copy();
                        }
                }
        }
}


void Connection::HookIncomingData(uint8_t const *start, unsigned buflen)
{
        /* If we get here after a response, but not inside a continueing response...
           something messed up (internal error) and is reinvoking us. as double-responding
           is extremely dangerous, abort this connection NOW */
        if(protocol.responded && !protocol.continuing_response)
        {
                FailRequest(StatusInternalError, "Internal error: HookIncomingData call on a responded, not continuing, connection");
                AsyncSignal(Blex::Dispatcher::Signals::Hangup);
                return;
        }

        //Note: we only enter this function if there is no outbound data queued
        if (!connection.binding)
        {
                if (!connection.config) //Re-configure this Connection
                    connection.config = webserver->ObtainConfig(); //ADDME: probably a RefreshConfig would be enough..

                //This must be a new connection!                 //Get the used Binding
                connection.binding=connection.config->FindBinding(GetListeningAddress());
                if (!connection.binding)
                {
                        WS_PRINT("Got a connection on a non-existing binding");
                        AsyncSignal(Blex::Dispatcher::Signals::Hangup); //force disconnect
                        ClearIncomingData(buflen);
                        return;
                }
        }

        if (!request->conndata_set)
        {
                request->conndata_set = true;
                request->localaddress = GetLocalAddress();
                request->remoteaddress = GetRemoteAddress();
                request->is_secure = IsConnectionSecure();
                request->is_client_secure = IsConnectionSecure();
                request->is_virtual_host = connection.binding && connection.binding->virtualhosting;
        }


        uint8_t const *to_return = SubHookIncomingData(start, start + buflen);

        //Mark data as processed
        ClearIncomingData(to_return - start);

        if (!protocol.is_websocket)
        {
                //If we got incoming data, and we're done parsing, start handling the request
                RequestParser const &reqparser = GetRequestParser();
                if(!reqparser.IsExpectingData())
                    ExecuteRequest();
        }
}

bool Connection::HookExecuteTask(Blex::Dispatcher::Task */*task*/)
{
        // Got a task; must be sent by ConnectionAsyncInterface::PushTask
        WS_PRINT("Connection " << this << " HookExTask, async_itf: " << async_itf.get());

        // DoTasks can call ResetConnection, which can destroy the async interface if we don't keep a reference.
        std::shared_ptr< ConnectionAsyncInterface > itf;
        itf = async_itf;

        if (itf.get())
            itf->DoTasks(this, false);
        return true;
}


void Connection::ScheduleOutgoingData()
{
        bool still_sending = PullAndSendOutgoingData();

        if (protocol.responded && !still_sending && !protocol.continuing_response && !protocol.async_response)
        {
                WS_PRINT("ScheduleOutgoingData: No data do schedule anymore, finishing data");

                /* In this case, there was no data to send, so prepare
                   for the next request immediately (otherwise we get
                   in an endless loop, because the expected SEnd Completion
                   never arrives */
                FinishDataNow();
        }
        else //Require more data if we already did our response..
        {
                if (protocol.responded) //We have just prepared a response - rely on TCP/IP timeout mechanisms
                    SetTimer(Blex::DateTime::Invalid() );
                else //still waiting for the request, so reset the user's timeout
                    SetTimer(Blex::DateTime::Now() + Blex::DateTime::Seconds(PersistentConnectTimeout));
        }
}

//-----------------------------------------------------------------------------
//
//
// SegmentedBuffer class
//
//
//-----------------------------------------------------------------------------

SegmentedBuffer::~SegmentedBuffer()
{
        for (Segments::const_iterator it = output_buffers.begin(); it != output_buffers.begin(); ++it)
            WS_PRINT("SegmentedBuffer: Destroying putput buffer " << (void*)it->data);
}

/* ADDME: Future optimizations?
   - centralize the allocation management so that de-allocations can be cached
     and reused
   - allocate data from private mapped memory, not from the central freestore
*/
void SegmentedBuffer::StoreData(const void* start, unsigned length)
{
        const uint8_t *data=static_cast<const uint8_t*>(start);
        while (length>0)
        {
                //create new buffer?
                if (output_buffers.empty() || back_buffer_fill == SegmentSize)
                {
                        output_buffers.push_back(Segment());
                        WS_PRINT("SegmentedBuffer: Allocated buffer " << (void*)output_buffers.back().data);

                        back_buffer_fill=0;
                }

                //copy as much as we can
                unsigned to_copy=std::min(length,SegmentSize - back_buffer_fill);
                memcpy(output_buffers.back().data+back_buffer_fill,data,to_copy);

                back_buffer_fill += to_copy;
                data += to_copy;
                length -= to_copy;
        }
}

void SegmentedBuffer::AddToQueue(Blex::Dispatcher::QueuedSendData *queue)
{
        unsigned num_buffers=output_buffers.size();

        //Send full buffers for all but the last buffer
        if (num_buffers == 0)
            return;

        SegmentedBuffer::Segments::const_iterator itr=output_buffers.begin();
        for (unsigned i=0;i<(num_buffers-1);++i)
        {
                queue->push_back(Blex::Dispatcher::SendData(itr->data,SegmentedBuffer::SegmentSize));
                ++itr;
        }
        //sent only as much as requested for the last segment
        queue->push_back(Blex::Dispatcher::SendData(itr->data,back_buffer_fill));
}

bool SegmentedBuffer::SendToStream(Blex::Stream &stream)
{
        unsigned num_buffers=output_buffers.size();

        //Send full buffers for all but the last buffer
        if (num_buffers == 0)
            return true;

        SegmentedBuffer::Segments::const_iterator itr=output_buffers.begin();
        for (unsigned i=0;i<(num_buffers-1);++i)
        {
                if(stream.Write(itr->data, SegmentedBuffer::SegmentSize) != SegmentedBuffer::SegmentSize)
                        return false;
                ++itr;
        }
        //sent only as much as requested for the last segment
        return stream.Write(itr->data, back_buffer_fill) == back_buffer_fill;
}

} //end namespace WebServer
