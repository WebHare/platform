#include <blex/blexlib.h>

/* ADDME:
     There is a room for some optimization by providing streamed Read(), Write()
     for RandomStream-derived classes, as RandomStream's default implementation
     is often much heavier than needed. */
/* ADDME: Could optimize offset-Read and offset-Write by implementing them
          directly, and thus skipping the continuous GetOffset/SetOffset
          imposed by RandomStream */

#include "stream.h"
#include <fcntl.h>
#include <stdexcept>
#include <algorithm>
#include <vector>
#include "logfile.h"

namespace Blex {

Stream::Stream(bool accesses_are_costly)
: accesses_are_costly(accesses_are_costly)
{
}

Stream::~Stream()
{
}

std::size_t Stream::LimitedSendTo(std::size_t numbytes,Stream &where, std::size_t buffersize)
{
        std::unique_ptr<uint8_t[]> storage(new uint8_t[buffersize]);
        std::size_t bytessent = 0;

        while (bytessent < numbytes)
        {
                std::size_t toread = (std::size_t)std::min< FileOffset >(buffersize,numbytes - bytessent);

                std::size_t inbuf = Read(&storage[0],toread);

                if (inbuf==0) //EOF
                    break;

                while (inbuf)
                {
                        std::size_t written=where.Write(&storage[0],inbuf);
                        bytessent += written;

                        if (written < inbuf)
                            return bytessent;
                        inbuf -= written;
                }
        }
        return bytessent;
}

FileOffset Stream::SendAllTo(Stream &where,std::size_t buffersize)
{
        //Use new directly to save on null-initialize cost
        std::unique_ptr<uint8_t[]> storage(new uint8_t[buffersize]);
        FileOffset bytessent=0;

        while (true)
        {
                std::size_t inbuf = Read(&storage[0],buffersize);
                if (inbuf==0) //EOF
                    break;

                while (inbuf)
                {
                        std::size_t written=where.Write(&storage[0],inbuf);
                        bytessent += written;

                        if (written < inbuf)
                            return bytessent;
                        inbuf -= written;
                }
        }
        return bytessent;
}

bool Stream::MoveForward (std::size_t howmuch)
{
        if (howmuch<=0)
            return true;

        //Inefficient but always working implementation
        std::unique_ptr<uint8_t[]> buffer(new uint8_t[(std::size_t)std::min<Blex::FileOffset>(howmuch, 16384)]);
        while(howmuch>0)
        {
                std::size_t toread = (std::size_t)std::min<Blex::FileOffset>(howmuch, 16384);
                std::size_t bytesread = Read(&buffer[0], toread);
                if (bytesread < toread)
                    return false;
                howmuch -= bytesread;
        }
        return true;
}

bool RandomStream::MoveForward (std::size_t howmuch)
{
        return SetOffset(GetOffset()+howmuch);
}

bool RandomStream::MoveBack (std::size_t howmuch)
{
        return SetOffset(GetOffset()-howmuch);
}

RandomStream_InternalFilePointer::RandomStream_InternalFilePointer()
: Stream(false)
, filepointer(0)
{
}
RandomStream_InternalFilePointer::~RandomStream_InternalFilePointer()
{
}

bool RandomStream_InternalFilePointer::EndOfStream()
{
        return GetOffset()==GetFileLength();
}

std::size_t RandomStream_InternalFilePointer::Read(void *buf,std::size_t maxbufsize)
{
        FileOffset  offset=GetOffset();
        std::size_t bytes=DirectRead(offset,buf,maxbufsize);
        SetOffset  (offset+bytes);
        return bytes;
}

std::size_t RandomStream_InternalFilePointer::Write(const void *buf, std::size_t bufsize)
{
        FileOffset  offset=GetOffset();
        std::size_t bytes=DirectWrite(offset,buf,bufsize);
        SetOffset   (offset+bytes);
        return bytes;
}

FileOffset RandomStream_InternalFilePointer::GetOffset()
{
        return filepointer;
}

bool RandomStream_InternalFilePointer::SetOffset(FileOffset newoffset)
{
        filepointer=newoffset;
        return true;
}

MemoryReadStream::MemoryReadStream(const void *start, std::size_t length)// throw()
  : Stream(false)
  , mem_start(static_cast<const uint8_t*>(start))
  , mem_length(length)
{
}
MemoryReadStream::~MemoryReadStream()
{
}

std::size_t MemoryReadStream::DirectRead(FileOffset startpos,void *buf,std::size_t maxbufsize)
{
        startpos   = std::min<FileOffset>(startpos,mem_length);
        maxbufsize = (std::size_t)std::min<FileOffset>(maxbufsize,mem_length-startpos);

        if (maxbufsize)
            memcpy(buf,mem_start+uint32_t(startpos),maxbufsize);
        return maxbufsize;
}

std::size_t MemoryReadStream::DirectWrite(FileOffset ,const void *,std::size_t )
{
        throw std::logic_error("MemoryReadStream::DirectWrite(): MemoryReadStream is read-only");
}

bool MemoryReadStream::SetFileLength(FileOffset )
{
        throw std::logic_error("MemoryReadStream::SetFileLength(): MemoryReadStream is read-only");
}
FileOffset MemoryReadStream::GetFileLength()
{
        return mem_length;
}

MemoryRWStream::MemoryRWStream()
: Stream(false)
{
}
MemoryRWStream::~MemoryRWStream()
{
}

std::size_t MemoryRWStream::DirectRead (FileOffset startpos, void *buf, std::size_t maxbufsize)
{
        ProtectedData::ReadRef storage(protected_storage);

        startpos   = std::min<FileOffset>(startpos,storage->size());
        maxbufsize = (std::size_t)std::min<FileOffset>(maxbufsize,storage->size()-startpos);

        if (maxbufsize)
            memcpy(buf,&*(storage->begin()+(uint32_t)startpos),maxbufsize);
        return maxbufsize;
}
std::size_t MemoryRWStream::DirectWrite(FileOffset startpos, const void *buf, std::size_t bufsize)
{
        ProtectedData::WriteRef storage(protected_storage);

        startpos  = std::min<FileOffset>(startpos, std::numeric_limits<std::size_t>::max());
        bufsize = (std::size_t)std::min<FileOffset>(bufsize,std::numeric_limits<std::size_t>::max()-startpos);

        if (startpos + bufsize > storage->size())
            storage->resize((std::size_t)(startpos+bufsize));

        memcpy(&*(storage->begin()+(std::size_t)startpos), buf, bufsize);
        return bufsize;
}

bool MemoryRWStream::SetFileLength(FileOffset newlength)
{
        try
        {
                if (newlength > std::numeric_limits<std::size_t>::max())
                    return false;

                ProtectedData::WriteRef storage(protected_storage);
                storage->resize((std::size_t)newlength);
        }
        catch (std::bad_alloc &)
        {
                return false;
        }
        return true;
}

FileOffset MemoryRWStream::GetFileLength()
{
        return ProtectedData::ReadRef(protected_storage)->size();
}


LimitedStream::LimitedStream(FileOffset _start,FileOffset _limit,LimitedStream &originalstream)
: Stream(originalstream.DoSmallAccessesNeedBuffering())
{
        //We can just connect directly to the original limited stream
        str = originalstream.str;
        start = originalstream.start + std::min(_start,originalstream.limit-originalstream.start);
        limit = originalstream.start + std::min(_limit,originalstream.limit-originalstream.start);
}

LimitedStream::LimitedStream(FileOffset _start,FileOffset _limit,RandomStream &originalstream)
: Stream(originalstream.DoSmallAccessesNeedBuffering())
{
        LimitedStream *limited_stream = dynamic_cast<LimitedStream*>(&originalstream);
        if (limited_stream)
        {
                //We can just connect directly to the original limited stream
                str = limited_stream->str;
                start = limited_stream->start + std::min(_start,limited_stream->limit-limited_stream->start);
                limit = limited_stream->start + std::min(_limit,limited_stream->limit-limited_stream->start);
        }
        else
        {
                Blex::FileOffset origlength = originalstream.GetFileLength();
                str = &originalstream;
                start = std::min(_start,origlength);
                limit = std::min(_limit,origlength);
        }
}

std::size_t LimitedStream::DirectRead(FileOffset startpos,void *buf,std::size_t maxbufsize)
{
        if (startpos>limit-start) //Cannot start past the end
            return 0;

        maxbufsize=(std::size_t)std::min<FileOffset>(maxbufsize,limit-start-startpos);

        return str->DirectRead(start+startpos,buf,maxbufsize);
}

std::size_t LimitedStream::DirectWrite(FileOffset startpos,const void *buf,std::size_t bufsize)
{
        if (startpos>limit-start) //cannot start past the end;
            return 0;

        //cannot extend a limited file
        bufsize=(std::size_t)std::min<FileOffset>(bufsize,limit-start-startpos);

        return str->DirectWrite(start+startpos,buf,bufsize);
}

bool LimitedStream::SetFileLength(FileOffset )
{
        throw std::logic_error("LimitedStream::SetFilelength(): Length of a LimitedStream cannot be changed");
}
FileOffset LimitedStream::GetFileLength()
{
        return limit-start;
}
LimitedStream::~LimitedStream()
{
}

StreamBuffer::StreamBuffer(unsigned _buffersize)
: Stream(false)
, eof(false)
, lastwaswrite(false)
, buffersize(_buffersize)
, bytes_read_into_buffer(0)
, bufferpos(0)
, buffer(new uint8_t[_buffersize])
{
}
StreamBuffer::~StreamBuffer()
{
        //Cannot put a FlushBuffer here - would cause a pure virtual function call
}
std::size_t StreamBuffer::Read(void *readbuf,std::size_t maxreadsize)
{
        if (!buffersize)
            return StreamRead(readbuf, maxreadsize);

        std::size_t readsofar=0;

        //See how much of the read we can serve from our buffer
        if (maxreadsize==0)
            return 0;

        if (lastwaswrite)
            FlushBuffer();

        if (bytes_read_into_buffer)
        {
                std::size_t toread = (std::size_t)std::min<FileOffset>(bytes_read_into_buffer-bufferpos, maxreadsize);
                std::memcpy(readbuf,&buffer[bufferpos],(std::size_t)toread);

                bufferpos+=toread;
                readsofar+=toread;
                readbuf=static_cast<uint8_t*>(readbuf) + toread;
                maxreadsize-=toread;

                //Do we still have a buffer left now?
                if (bufferpos>=bytes_read_into_buffer)
                {
                        bytes_read_into_buffer=0; //no, apparently
                        bufferpos=0;
                }
        }

        if (maxreadsize>=buffersize) //people still want data that's even too much for buffering?
        {
                //Give it to them directly, then
                readsofar += StreamRead(readbuf,maxreadsize);
        }
        else if (maxreadsize)
        {
                //They want more data, but not necessarily a full buffer
                //We will grab a full buffer though, and serve it to them
                //via a recursive call
                bytes_read_into_buffer = StreamRead(&buffer[0],buffersize);
                bufferpos=0;

                if (bytes_read_into_buffer)
                    readsofar += Read(readbuf,maxreadsize);
        }

        if (readsofar<maxreadsize)
            eof=true;
        return readsofar;
}
std::size_t StreamBuffer::Write(const void *writebuf,std::size_t writesize)
{
        if (!buffersize)
            return StreamWrite(writebuf, writesize);

        uint32_t writtensofar=0;

        if (writesize==0)
            return 0;

        if (!lastwaswrite)
            FlushBuffer();
        lastwaswrite=true;

        //Write, whilst attempting to use an outbound buffer....
        //See how much we can still fit in our outbound buffer
        if (bufferpos<buffersize)
        {
                uint32_t towrite=std::min(buffersize-bufferpos,writesize);

                //Add data to buffer
                memcpy(&buffer[bufferpos],writebuf,towrite);
                bufferpos += towrite;
                writtensofar+=towrite;
                writebuf=static_cast<const uint8_t*>(writebuf)+towrite;
                writesize-=towrite;
        }

        //Flush buffer if large enough
        if (bufferpos>=buffersize)
        {
                if (!StreamWrite(&buffer[0],bufferpos))
                    return 0;
                bufferpos=0;
        }

        //Write any remaining data
        if (writesize)
        {
                writtensofar += StreamWrite(writebuf,writesize);
        }

        return writtensofar;
}
bool StreamBuffer::EndOfStream()
{
        return eof;
}
bool StreamBuffer::FlushBuffer()
{
        if (lastwaswrite)
        {
                bool success = bufferpos==0 || StreamWrite(&buffer[0],bufferpos) == bufferpos;
                bufferpos=0;
                lastwaswrite=false;
                return success;
        }
        else
        {
                bytes_read_into_buffer=0;
                bufferpos=0;
                eof=false;
                return true;
        }
}
RandomStreamBuffer::RandomStreamBuffer(unsigned buffersize)
: Stream(false)
, StreamBuffer(buffersize)
, offset(0)
{
}
RandomStreamBuffer::~RandomStreamBuffer()
{
}

FileOffset RandomStreamBuffer::GetOffset()
{
        return offset - bytes_read_into_buffer + bufferpos;
}
bool RandomStreamBuffer::SetOffset(FileOffset newoffset)
{
        if (!buffersize)
            return true;

        if (lastwaswrite)
        {
                // Last a write? Flush and invalidate buffer
                if (!FlushBuffer())
                    return false;
        }
        else
        {
                FileOffset buffer_end = offset;
                FileOffset buffer_start = offset - bytes_read_into_buffer;

                // Seeking to position outside of buffer? Flush buffer
                if (buffer_start <= newoffset && newoffset < buffer_end)
                {
                        bufferpos = static_cast<std::size_t>(newoffset - buffer_start);
                        eof = false;
                        return true;
                }

                if(!FlushBuffer())
                    return false;
        }
        offset = newoffset;
        eof = false;
        return true;
}
std::size_t RandomStreamBuffer::DirectRead (FileOffset startpos, void *buf, std::size_t maxbufsize)
{
        if (!buffersize)
            return RawDirectRead(startpos, buf, maxbufsize);

        if (lastwaswrite && !FlushBuffer())
            return 0;

        std::size_t totalbytesread = 0;
        Blex::FileOffset bufferstart = offset - bytes_read_into_buffer; //FileOffset at which the buffer starts

        //Can we satisfy the read from the buffer? (ADDME: Also handle the case when only the 'last few' bytes are in buffer )
        if (bufferstart < startpos && startpos < offset && maxbufsize>0)
        {
                std::size_t toread = (std::size_t)std::min<Blex::FileOffset>(maxbufsize, offset - startpos);
                memcpy(buf, &buffer[static_cast<unsigned>(startpos - bufferstart)], toread);

                totalbytesread = totalbytesread + toread;
                startpos = startpos + toread;
                buf = static_cast<uint8_t*>(buf) + toread;
                maxbufsize = maxbufsize - toread;
        }
        if (maxbufsize<=0)
            return totalbytesread; //No more reading to do

        //If the remainder to read is larger or equal to the buffersize, return
        //it directly
        if (maxbufsize >= buffersize)
            return totalbytesread + RawDirectRead(startpos,buf,maxbufsize);

        //The remainder fits in buffer, so reposition the buffer to read it
        bytes_read_into_buffer = RawDirectRead(startpos, &buffer[0], buffersize);
        offset = startpos + bytes_read_into_buffer;
        bufferpos = 0;
        if (bytes_read_into_buffer)
        {
                std::size_t toread=std::min<std::size_t>(maxbufsize,bytes_read_into_buffer);
                memcpy(buf, &buffer[0], maxbufsize);
                totalbytesread += toread;
        }
        return totalbytesread;
}
std::size_t RandomStreamBuffer::DirectWrite(FileOffset startpos, const void *buf, std::size_t bufsize)
{
        if (!buffersize)
            return RawDirectWrite(startpos,buf,bufsize);

        if (lastwaswrite && !FlushBuffer())
            return 0;
        return RawDirectWrite(startpos,buf,bufsize);
}
std::size_t RandomStreamBuffer::StreamRead(void *buf,std::size_t maxbufsize)
{
        std::size_t bytesread = RawDirectRead(offset, buf, maxbufsize);
        offset+=bytesread;
        return bytesread;
}
std::size_t RandomStreamBuffer::StreamWrite(void const *buf,std::size_t bufsize)
{
        std::size_t byteswritten = RawDirectWrite(offset, buf, bufsize);
        offset+=byteswritten;
        return byteswritten;
}

BufferedStream::BufferedStream(Stream &_stream, unsigned _buffersize)
: Stream(_stream.DoSmallAccessesNeedBuffering())
, StreamBuffer(_stream.DoSmallAccessesNeedBuffering() ? _buffersize : 0)
, str(_stream)
{
}

std::size_t BufferedStream::StreamWrite(const void *writebuf,std::size_t maxbufsize)
{
        return str.Write(writebuf,maxbufsize);
}

std::size_t BufferedStream::StreamRead(void *readbuf,std::size_t maxbufsize)
{
        return str.Read(readbuf,maxbufsize);
}

BufferedStream::~BufferedStream()
{
        FlushBuffer();
}

BufferedRandomStream::BufferedRandomStream(std::shared_ptr<Blex::RandomStream> mystream, unsigned buffersize)
: Stream(mystream->DoSmallAccessesNeedBuffering())
, RandomStreamBuffer(mystream->DoSmallAccessesNeedBuffering() ? buffersize : 0)
, str(mystream)
{
}
BufferedRandomStream::~BufferedRandomStream()
{
}

bool BufferedRandomStream::SetFileLength(Blex::FileOffset newlength)
{
        return str->SetFileLength(newlength);
}
Blex::FileOffset BufferedRandomStream::GetFileLength()
{
        return str->GetFileLength();
}
std::size_t BufferedRandomStream::RawDirectRead(Blex::FileOffset startpos,void *buf,std::size_t maxbufsize)
{
        return str->DirectRead(startpos, buf, maxbufsize);
}
std::size_t BufferedRandomStream::RawDirectWrite(Blex::FileOffset startpos,void const *buf,std::size_t bufsize)
{
        return str->DirectWrite(startpos, buf, bufsize);
}

NullStream::NullStream()
: Stream(false)
{
}
NullStream::~NullStream()
{
}
std::size_t NullStream::Read(void *,std::size_t)
{
        return 0;
}
bool NullStream::EndOfStream()
{
        return true;
}
std::size_t NullStream::Write(void const *, std::size_t bufsize)
{
        return bufsize;
}

namespace
{
template <class VectorType>
  unsigned StreamToVec(Blex::Stream &str, std::vector<VectorType> *vec)
{
        Blex::RandomStream *randomstream = dynamic_cast<Blex::RandomStream*>(&str);
        if (randomstream)
        {
                std::size_t cursize = vec->size();
                FileOffset toread = randomstream->GetFileLength() - randomstream->GetOffset();
                if (cursize + toread >= std::numeric_limits<std::size_t>::max())
                    return 0; //can't safely read that much

                vec->resize((std::size_t)(cursize + toread));
                std::size_t bytesread = str.Read(&(*vec)[cursize], (std::size_t)toread);
                vec->resize(cursize + bytesread);

                return bytesread;
        }
        else
        {
                std::size_t totalbytesread = 0;
                std::size_t bytesread;

                do
                {
                        std::size_t cursize = vec->size();
                        vec->resize(cursize+8192);

                        bytesread = str.Read(&(*vec)[cursize],8192);

                        vec->resize(cursize+bytesread);
                        totalbytesread += bytesread;
                }
                while (bytesread > 0);

                return totalbytesread;
        }
}
} //end anonymous namespace

unsigned ReadStreamIntoVector(Blex::Stream &str, std::vector<uint8_t> *vec)
{
        return StreamToVec(str,vec);
}

unsigned ReadStreamIntoVector(Blex::Stream &str, std::vector<char> *vec)
{
        return StreamToVec(str,vec);
}

std::string ReadStreamAsString(Stream &str)
{
        std::vector< char > vec;
        StreamToVec(str, &vec);
        return std::string(vec.begin(), vec.end());
}


} //end of namespace Blex
