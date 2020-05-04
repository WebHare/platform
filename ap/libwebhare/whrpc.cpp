#include <ap/libwebhare/allincludes.h>


#include <iomanip>
#include "whrpc.h"

namespace Database
{

void IOBuffer::InvalidRPCData()
{
        DEBUGPRINT("Invalid RPC data, in a packet with opcode: " << (int)GetOpcode());
        throw Exception(ErrorProtocol,"Invalid RPC data");
}

void IOBuffer::WriteBinary(unsigned len, uint8_t const *indata)
{
        uint8_t *outdata=Reserve(len+4);
        Blex::putu32lsb(outdata,len);
        std::copy(indata,indata+len,outdata+4);
}

IOBuffer::IOBuffer()
{
}
IOBuffer::~IOBuffer()
{
}

void IOBuffer::ThrowException()
{
        assert(IsException());
        ErrorCodes exception_code = static_cast<ErrorCodes>(Read<uint32_t>());
        std::string exception_text = Read<std::string>();
        std::string exception_table = Read<std::string>();
        std::string exception_column  = Read<std::string>();
        std::string exception_clientname  = Read<std::string>();

        DEBUGPRINT("Throwing database exception: " << exception_code << ": " << exception_text);
        throw Exception(exception_code,exception_text, exception_table, exception_column);
}

std::pair<uint8_t const*,uint8_t const *> IOBuffer::ReadBinary()
{
        unsigned len = Read<uint32_t>();

        //Verify that the data is there
        if (&iobuffer[readpos] + len > GetRawLimit())
            InvalidRPCData();

        readpos += len;
        return std::make_pair(&iobuffer[readpos]-len,&iobuffer[readpos]);
}

std::ostream& operator<<(std::ostream &lhs, IOBuffer const &rhs)
{
        if (rhs.iobuffer.size() < IOBuffer::HeaderSize)
            return lhs << "[Corrupted IOBUffer len " << rhs.iobuffer.size() << " readpos " << rhs.readpos << "]";
        lhs << "[IOBuffer len " << rhs.iobuffer.size() << " claimedlen " << rhs.GetClaimedLength() << " opcode " << (int)rhs.GetOpcode() << " data ";
        for (unsigned i=4;i<rhs.iobuffer.size();++i)
        {
                if (i%4==0)
                   lhs << ' ';
                lhs << std::hex << std::setfill('0') << std::setw(2) << unsigned(rhs.iobuffer[i]);
        }
        lhs << std::dec << "]";
        return lhs;
}

// -----------------------------------------------------------------------------
//
// TCPConnection
//
// -----------------------------------------------------------------------------


TCPConnection::TCPConnection()
: io_timeout(300)
, sock(Blex::Socket::Stream)
, rpcfailed(false) //ADDM Move to dbase
, buffer_all(true)
{
        trigger.GetReadEnd().SetBlocking(false);
        trigger.GetWriteEnd().SetBlocking(false);
        waiter.AddReadPipe(trigger.GetReadEnd());
}

TCPConnection::~TCPConnection()
{
}

bool TCPConnection::IsComplete(Blex::PodVector< uint8_t > *data)
{
        if (data->size() < 4)
            return false;
        return data->size() >= GetFirstBufferLength(data);
}

unsigned TCPConnection::GetFirstBufferLength(Blex::PodVector< uint8_t > *data)
{
        if (data->size() < 4)
            return 0;
        uint32_t lensofar = Blex::getu32lsb(&*data->begin())&0xFFFFFF;
        if (lensofar > 512*1024 || lensofar < 4) //more than 512K ?
        {
                rpcfailed=true;
                IOCLIENTDEBUGPRINT("TCP conn " << this << ": Received broken buffer length from database: " << Blex::AnyToString(lensofar));
                throw Exception(ErrorProtocol, "Received broken buffer length from database: " + Blex::AnyToString(lensofar));
        }
        return lensofar;
}

bool TCPConnection::HasFailed()
{
        return rpcfailed;
}

void TCPConnection::TrySendOutgoing(LockedAData::WriteRef &lock)
{
        // Still outgoing data?
        if (lock->outgoing.empty())
            return;

        // Send over the socket
        int32_t retval = sock.Send(&lock->outgoing[0], lock->outgoing.size());

        if (retval <= 0 && retval != Blex::SocketError::WouldBlock)
        {
                // Sending has failed, the send-side of our tcp connection is dead. Receive everything we can. If ex
                rpcfailed=true;

                // Empty receive queue and pop all packets, there might be an exception packet.

                IOBuffer iobuf;
                while (true)
                {
                        while (IsComplete(&lock->incoming))
                            PopPacket(lock, &iobuf); // Pop all packets, throw on exception.

                        // No complete packet in the queue, try and get more data
                        if (TryReceiveIncoming(lock) == 0)
                            break;
                }

                IOCLIENTDEBUGPRINT("Lost connection to database when trying to send");
                throw Exception(ErrorDisconnect,"Lost connection to database");
        }

        if (retval > 0)
            lock->outgoing.erase(lock->outgoing.begin(), lock->outgoing.begin() + retval);
}

unsigned TCPConnection::TryReceiveIncoming(LockedAData::WriteRef &lock)
{
        unsigned curbuflen = lock->incoming.size();
        unsigned newbufsize;

        if (buffer_all)
        {
                signed datalen = signed(GetFirstBufferLength(&lock->incoming)) - signed(curbuflen);

                // Try to double the data buffer with incoming data (but min 2048 bytes and max 512kb)
                unsigned minread = std::min(std::max(2048u, curbuflen), 512u*1024u);
                if (datalen < 2048)
                    datalen = minread;

                newbufsize = curbuflen + datalen;
        }
        else
        {
                newbufsize = GetFirstBufferLength(&lock->incoming);
                if (newbufsize)
                    newbufsize += 4096;
                else
                    newbufsize = 32768;
        }

        if (newbufsize <= curbuflen)
            return 0;

        lock->incoming.resize(newbufsize); //ADDME: Use read-ahead estimation from the buffer length prefixing the message!
        int32_t retval = sock.Receive(&lock->incoming[curbuflen], newbufsize - curbuflen);
        if (retval > 0 && GetFirstBufferLength(&lock->incoming) > newbufsize)
        {
                // got data, but it is a partial packet - try to get the rest of the packet too
                curbuflen += retval;
                newbufsize = GetFirstBufferLength(&lock->incoming) + 4096;
                lock->incoming.resize(newbufsize);
                retval = sock.Receive(&lock->incoming[curbuflen], newbufsize - curbuflen);
        }

        if(retval == Blex::SocketError::WouldBlock)
        {
                retval=0;
        }
        else if (retval <= 0)
        {
                IOCLIENTDEBUGPRINT("Lost connection to database when trying to receive");
                // Kill added buffer length
                lock->incoming.resize(curbuflen);
                rpcfailed=true;
                while (IsComplete(&lock->incoming))
                {
                        IOBuffer iobuf;
                        PopPacket(lock, &iobuf); // Pop all packets, throw on exception.
                }
                throw Exception(ErrorDisconnect,"Lost connection to database");
        }

        IOCLIENTDEBUGPRINT("TCP conn " << this << ": Received " << retval << " bytes");
        lock->incoming.resize(curbuflen + retval);
        return retval;
}

void TCPConnection::PopPacket(LockedAData::WriteRef &lock, IOBuffer *iobuf)
{
        assert(IsComplete(&lock->incoming));

        //Pop a message into the I/O buffer
        unsigned msglen = Blex::getu32lsb(&lock->incoming[0])&0xFFFFFF;
        iobuf->GetInternalIOBuffer()->assign(&lock->incoming[0],&lock->incoming[msglen]);
        lock->incoming.erase(lock->incoming.begin(), lock->incoming.begin() + msglen);

        IOCLIENTDEBUGPRINT("TCP conn " << this << ": Received packet " << ResponseOpcode::GetName((ResponseOpcode::Type)iobuf->GetOpcode()) << ", len: " << iobuf->GetRawLength());

        iobuf->ResetReadPointer();
        if (iobuf->IsException())
        {
                try
                {
                        iobuf->ThrowException();
                }
                catch (Exception &e)
                {
                        IOCLIENTDEBUGPRINT("TCP conn " << this << ": Throwing exception " << e.what());
                        switch (e.errorcode)
                        {
                        case ErrorInternal:
                        case ErrorInvalidArg:
                        case ErrorProtocol:
                        case ErrorDisconnect:
                        case ErrorTimeout:
                            rpcfailed = true; // Fallthrough
                        default: ;
                        }
                        throw;
                }
        }
}

bool TCPConnection::SendPacket (IOBuffer const &buf, Blex::DateTime timeout)
{
        // If an RPC failed earlier, don't even try send.
        if (rpcfailed)
            throw Exception(ErrorDisconnect,"Connection has already failed on RPC-level, sending not permitted.");

        {
                IOCLIENTDEBUGPRINT("TCP conn " << this << ": Queueing packet " << RequestOpcode::GetName((RequestOpcode::Type)buf.GetOpcode()) << ", len: " << buf.GetRawLength());
                LockedAData::WriteRef lock(adata);
                lock->outgoing.insert(lock->outgoing.end(), buf.GetRawBegin(), buf.GetRawLimit());

                TrySendOutgoing(lock);
                if (lock->outgoing.empty() || timeout == Blex::DateTime::Invalid())
                    return lock->outgoing.empty();
        }
        Loop(true, 0, timeout);
        return true;
}

bool TCPConnection::AsyncSendPacket (IOBuffer const &buf)
{
        // If an RPC failed earlier, don't even try send.
        if (rpcfailed)
            throw Exception(ErrorDisconnect,"Connection has already failed on RPC-level, sending not permitted.");

        {
                IOCLIENTDEBUGPRINT("TCP conn " << this << ": Async queueing packet " << RequestOpcode::GetName((RequestOpcode::Type)buf.GetOpcode()) << ", len: " << buf.GetRawLength());
                LockedAData::WriteRef lock(adata);
                lock->outgoing.insert(lock->outgoing.end(), buf.GetRawBegin(), buf.GetRawLimit());

                TrySendOutgoing(lock);
                return lock->outgoing.empty();
        }
        return false;
}

bool TCPConnection::RetryAsyncSend()
{
        // If an RPC failed earlier, don't even try send.
        if (rpcfailed)
            throw Exception(ErrorDisconnect,"Connection has already failed on RPC-level, sending not permitted.");

        {
                IOCLIENTDEBUGPRINT("TCP conn " << this << ": Async send retry");
                LockedAData::WriteRef lock(adata);

                TrySendOutgoing(lock);
                return lock->outgoing.empty();
        }
        return false;
}

bool TCPConnection::ReceivePacket(IOBuffer *iobuf, Blex::DateTime timeout)
{
        {
                LockedAData::WriteRef lock(adata);

                if (!IsComplete(&lock->incoming))
                {
                        // Can't hurt to empty socket buffers.
                        TryReceiveIncoming(lock);
                }

                if (IsComplete(&lock->incoming))
                {
                        // Don't forget to try to send outgoing data (if available); this isn't done through other
                        TrySendOutgoing(lock);

                        PopPacket(lock, iobuf);
                        return true;
                }
                if (timeout == Blex::DateTime::Invalid())
                     return false;
        }
        Loop(false, iobuf, timeout);
        return true;
}

void TCPConnection::Loop(bool send, IOBuffer *receive, Blex::DateTime timeout)
{
        bool completed = false;
        bool read = true;
        while (!completed)
        {
                waiter.AddSocket(sock, /*read=*/read, /*write=*/send);

                if (!waiter.Wait(timeout) && timeout != Blex::DateTime::Invalid())
                {
                        rpcfailed=true;
                        IOCLIENTDEBUGPRINT("TCP conn " << this << " RPC failure: Timeout waiting for " << (send ? "send" : "receive") << " completion");
                        throw Exception(ErrorTimeout,"Timeout waiting for response");
                }

                LockedAData::WriteRef lock(adata);

                if (waiter.GotRead(trigger.GetReadEnd()))
                {
                        uint8_t errorcode;
                        trigger.GetReadEnd().Read(&errorcode, 1);
                        if (lock->abort)
                            throw Exception(ErrorInternal, "Client requested its own abort");
//                        return false; //have parent deal with the signal
                }

                if (waiter.GotRead(sock))
                    TryReceiveIncoming(lock);

                if (waiter.GotWrite(sock))
                    TrySendOutgoing(lock);

                if (send && lock->outgoing.empty())
                    completed = true;

                if (receive && IsComplete(&lock->incoming))
                {
                        PopPacket(lock, receive);
                        completed = true;
                }

                // If we got a complete packet but we're not receiving, don't wait the next time
                read = receive && !IsComplete(&lock->incoming);
        }
        return;
}

void TCPConnection::SignalConnection()
{
        // Write true to trigger
        bool byte = true;
        trigger.GetWriteEnd().Write(&byte,1);
}

void TCPConnection::AsyncClose()
{
        LockedAData::WriteRef (adata)->abort=true;
        SignalConnection();
}

void TCPConnection::AddToWaiterRead(Blex::PipeWaiter &extwaiter)
{
        extwaiter.AddSocket(sock, true, false);
}

void TCPConnection::AddToWaiterReadWrite(Blex::PipeWaiter &extwaiter)
{
        extwaiter.AddSocket(sock, true, true);
}

bool TCPConnection::IsReadSignalled(Blex::PipeWaiter &extwaiter)
{
        return extwaiter.GotRead(sock);
}

bool TCPConnection::IsWriteSignalled(Blex::PipeWaiter &extwaiter)
{
        return extwaiter.GotWrite(sock);
}

bool TCPConnection::HasOutgoingData()
{
        LockedAData::ReadRef lock(adata);
        return !lock->outgoing.empty();
}

//FIXME Move to dbase
bool TCPConnection::CompleteConnectionReset()
{
        //Clear any 'old' messages - we did a ResetConnection when pushing the connection which should have responded
        Blex::DateTime timeout = Blex::DateTime::Now() + Blex::DateTime::Seconds(3);
        IOBuffer temp; //ADDME: Scratch buffer would be nice
        while (true)
        {
                try
                {
                        ReceivePacket(&temp, timeout);
                        if(temp.GetOpcode() == ResponseOpcode::Reset)
                            return true;
                        DEBUGPRINT("PopCachedConn - dropped packet " << ResponseOpcode::GetName((ResponseOpcode::Type)temp.GetOpcode()) << " while waiting for Reset");
                }
                catch(Database::Exception &e)
                {
                        if(e.errorcode == ErrorDisconnect || e.errorcode == ErrorTimeout) //ADDME: Deze combi komt meerdere keren voor, samenvoegen als state flag van de connectie zelf misschien ofzo?
                           break;
                }
        }
        return false;
}


} //end namespace Database
