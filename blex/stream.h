#ifndef blex_stream
#define blex_stream

#ifndef blex_threads
#include "threads.h"
#endif

namespace Blex
{

/** This function limits an offset to an integer value. Although it's not
    a clean solution to handle 64bit offsets, at least you can search for the
    occurrences :-) */
inline int LimitOffsetToInt(Blex::FileOffset off)
{
        return (int)std::min<Blex::FileOffset>(std::numeric_limits<int>::max(), off);
}

/** Stream I/O baseclass. A stream implements streaming I/O, but no
    file pointer repositioning. A stream is not copyable. */
class BLEXLIB_PUBLIC Stream
{
        private:
        // Non-copyable, so make the copy constructor inaccessable, as well as the assignment operator
        Stream(Stream const &);
        Stream & operator =(Stream &);

        bool accesses_are_costly;

        public:
        Stream(bool accesses_are_costly);

        /** Virtual destructor so we can safely derive from this class */
        virtual ~Stream();

        /** Read bytes from the stream, at the current file pointer
            @param buf Location to store read data
            @param maxbufsize Maximum number of bytes to read
            @return Number of bytes read. If the returned value is less than
                    'maxbufsize', not enough bytes were available */
        virtual std::size_t Read(void *buf,std::size_t maxbufsize)=0;

        /** Did we hit the permanent end of stream? */
        virtual bool EndOfStream() = 0;

        /** Write bytes to the stream, at the current file pointer
            @param buf Location to read data from
            @param bufsize Number of bytes to write
            @return Number of bytes written. If the returned value is less than
                    'bufsize', not enough output space was available */
        virtual std::size_t Write(void const *buf, std::size_t bufsize)=0;

        /** Write a STL string to the stream
            @param s Data to write
            @return Number of bytes written*/
        std::size_t WriteString (std::string const &s)
        {
                return Write(&s[0],s.size());
        }

        /** Write to the stream in LSB order
            @param WriteType Type of data to write
            @param data Data to write
            @return Number of bytes written */
        template <typename WriteType> std::size_t WriteLsb (WriteType const &data);

        /** Write to the stream in MSB order
            @param WriteType Type of data to write
            @param data Data to write
            @return Number of bytes written */
        template <typename WriteType> std::size_t WriteMsb (WriteType const &data);

        /** Read from the stream in LSB order, to the specified byte
            @param ReadType Type of data to read
            @param store Location to store read data
            @return True on a successful read, false on failure */
        template <typename ReadType> bool ReadLsb (ReadType *store)
        {
                uint8_t localstore[sizeof(ReadType)];
                if (Read(localstore,sizeof(ReadType))!=sizeof(ReadType))
                    return false;

                *store = GetLsb<ReadType>(localstore);
                return true;
        }

        /** Read from the stream in MSB order, to the specified byte
            @param ReadType Type of data to read
            @param store Location to store read data
            @return True on a successful read, false on failure */
        template <typename ReadType> bool ReadMsb (ReadType *store)
        {
                uint8_t localstore[sizeof(ReadType)];
                if (Read(localstore,sizeof(ReadType))!=sizeof(ReadType))
                    return false;

                *store = GetMsb<ReadType>(localstore);
                return true;
        }

        /** Read from the stream in LSB order
            @param ReadType Type of data to read
            @return Number of bytes read */
        template <typename ReadType> ReadType ReadLsb ()
        {
                ReadType temp;
                return ReadLsb(&temp) ? temp : ReadType();
        }

        /** Read from the stream in MSB order
            @param ReadType Type of data to read
            @return Number of bytes read */
        template <typename ReadType> ReadType ReadMsb ()
        {
                ReadType temp;
                return ReadMsb(&temp) ? temp : ReadType();
        }

        /** Send a part of the data from the current stream to the specified stream
            @param where Destination stream
            @param numbytes Maximum number of bytes to send
            @param buffersize Size for our local buffer
            @return The number of bytes written */
        virtual std::size_t LimitedSendTo(std::size_t  numbytes, Stream &where,std::size_t buffersize=16384);

        /** Send all data from the current stream to the specified stream
            @param where Destination stream
            @param buffersize Size for our local buffer
            @return The number of bytes written */
        virtual FileOffset SendAllTo(Stream &where,std::size_t buffersize=16384);

        /** Move the file pointer forward */
        virtual bool MoveForward (std::size_t  howmuch);

        /** Returns whether small accesses will profit from buffering
        */
        bool DoSmallAccessesNeedBuffering() { return accesses_are_costly; }
};

/** Random stream I/O baseclass. This class implements a stream, but extends
    it to provide file pointers, and direct position I/O. */
class BLEXLIB_PUBLIC RandomStream : public virtual Stream
{
        public:
        RandomStream() : Stream(false) { }

        /** Read data directly from a specific location. This function may
            reset the file pointer to an indeterminate location.
            @param buf Buffer to read into
            @param startpos Position in the input stream to read from
            @param bufsize The number of bytes to tread
            @return The number of bytes succesfully read */
        virtual std::size_t DirectRead(FileOffset startpos,void *buf,std::size_t maxbufsize)=0;

        /** Write data directly to a specific location. This function may
            reset the file pointer to an indeterminate location
            @param buf Buffer to write
            @param startpos Position in the output stream to write to
            @param bufsize The number of bytes to write
            @return The number of bytes succesfully written */
        virtual std::size_t DirectWrite(FileOffset startpos,const void *buf,std::size_t bufsize)=0;

        /** Change the length of the file, truncating or zero-extending as
            needed. This function does not modify the file pointer */
        virtual bool SetFileLength(FileOffset newlength) =0;

        /** Returns the total length of the file */
        virtual FileOffset GetFileLength()=0;

        /** Returns the current file pointer */
        virtual FileOffset GetOffset()=0;

        /** Moves the file pointer forward
            @param howmuch Number of bytes to move the file offset forward
            @return Whether the operation was succesfull */
        virtual bool MoveForward (std::size_t  howmuch);

        /** Moves the file pointer backward
            @param howmuch Number of bytes to move the file offset backward
            @return Whether the operation was succesfull */
        virtual bool MoveBack (std::size_t  howmuch);

        /** Sets the file pointer to a new place. Allows the file pointer to be
            set beyond the end of file. Warning: when writing to a file where the
            file pointer is set beyond the eof, the way of filling the missing
            space is unspecified (can be garbage).
            @param newoffset New offset to place the file pointer at
            @return Whether the operation was succesfull */
        virtual bool SetOffset(FileOffset newoffset)=0;

        /** Write a STL string to the stream
            @param startpos Position in the input stream to write to
            @param s Data to write
            @return Number of bytes written*/
        std::size_t DirectWriteString (FileOffset startpos,std::string const &s)
        {
                return DirectWrite(startpos, &s[0],s.size());
        }

        /** Write a single byte to the stream in LSB order
            @param WriteType Type of data to write
            @param startpos Position in the input stream to write to
            @param data Data to write
            @return Number of bytes written */
        template <typename WriteType> std::size_t DirectWriteLsb (FileOffset startpos,WriteType const &data)
        {
                uint8_t store[sizeof(WriteType)];
                PutLsb<WriteType>(store,data);
                return DirectWrite(startpos,store,sizeof(WriteType));
        }

        /** Write a single byte to the stream in MSB order
            @param WriteType Type of data to write
            @param startpos Position in the input stream to write to
            @param data Data to write
            @return Number of bytes written */
        template <typename WriteType> std::size_t DirectWriteMsb (FileOffset startpos,WriteType const &data)
        {
                uint8_t store[sizeof(WriteType)];
                PutMsb<WriteType>(store,data);
                return DirectWrite(startpos,store,sizeof(WriteType));
        }

        /** Read a single byte from the stream in LSB order
            @param ReadType Type of data to read
            @param startpos Position in the input stream to read from
            @return Number of bytes read */
        template <typename ReadType> ReadType DirectReadLsb (FileOffset startpos)
        {
                uint8_t store[sizeof(ReadType)];
                if (DirectRead(startpos,store,sizeof(ReadType))!=sizeof(ReadType))
                    return ReadType();

                return GetLsb<ReadType>(store);
        }

        /** Read a single byte from the stream in MSB order
            @param ReadType Type of data to read
            @param startpos Position in the input stream to read from
            @return Number of bytes read */
        template <typename ReadType> ReadType DirectReadMsb (FileOffset startpos)
        {
                uint8_t store[sizeof(ReadType)];
                if (DirectRead(startpos,store,sizeof(ReadType))!=sizeof(ReadType))
                    return ReadType();

                return GetMsb<ReadType>(store);
        }
};

/* A randomstream baseclass providing an internal filepointer, and implementing
   GetOffset, SetOffset, and the Read/Write/EndOfStream operations in their
   terms */
class BLEXLIB_PUBLIC RandomStream_InternalFilePointer : public RandomStream
{
        public:
        RandomStream_InternalFilePointer();
        ~RandomStream_InternalFilePointer();

        virtual std::size_t Read(void *buf,std::size_t maxbufsize);

        virtual std::size_t Write(const void *buf,std::size_t bufsize);

        virtual bool EndOfStream();

        virtual FileOffset GetOffset();
        virtual bool SetOffset(FileOffset newoffset);

        private:
        FileOffset filepointer;
};

/** A class that represents a user-allocated piece of memory as a stream.
    This class is useful to supply regions of memory to functions expecting a stream */
class BLEXLIB_PUBLIC MemoryReadStream : public RandomStream_InternalFilePointer
{
        public:
        /** Create a random stream that reads a piece of memory
            @param start Start of the memory to read
            @param length Length of the memory to read */
        MemoryReadStream(const void *start, std::size_t length);// throw();

        ~MemoryReadStream();

        std::size_t DirectRead (FileOffset startpos, void *buf,       std::size_t maxbufsize);
        std::size_t DirectWrite(FileOffset startpos, const void *buf, std::size_t bufsize);

        bool SetFileLength(FileOffset newlength);
        FileOffset GetFileLength();

        private:
        const uint8_t *mem_start;
        std::size_t mem_length;
};

/** A class that represents a file in memory.
    This class is useful for collecting lots of writes to a random stream */
class BLEXLIB_PUBLIC MemoryRWStream : public RandomStream_InternalFilePointer
{
        public:
        /// Create a memory write stream
        MemoryRWStream();
        ~MemoryRWStream();

        std::size_t DirectRead (FileOffset startpos, void *buf,       std::size_t maxbufsize) ;
        std::size_t DirectWrite(FileOffset startpos, const void *buf, std::size_t bufsize) ;

        bool SetFileLength(FileOffset newlength);
        FileOffset GetFileLength() ;

        private:
        typedef std::vector<uint8_t> Data;
        typedef InterlockedData<Data, Mutex> ProtectedData;
        mutable ProtectedData protected_storage;
};


/** A class that limits an existing randomaccess stream, and only allows the specified
    number of bytes of its parent stream to be accessed */
class BLEXLIB_PUBLIC LimitedStream : public RandomStream_InternalFilePointer
{
        public:
        /** Create a random stream that is allowed to see only a limited
            part of an existing stream. This simplifies some algorithms, as
            they can be fed a 'normal' stream contained in another file */
        LimitedStream(FileOffset start,FileOffset limit,RandomStream &originalstream);

        /** Create a random stream that is allowed to see only a limited
            part of an existing stream. This simplifies some algorithms, as
            they can be fed a 'normal' stream contained in another file */
        LimitedStream(FileOffset start,FileOffset limit,LimitedStream &originalstream);

        ~LimitedStream();

        std::size_t DirectRead (FileOffset startpos, void *buf,       std::size_t maxbufsize) ;
        std::size_t DirectWrite(FileOffset startpos, const void *buf, std::size_t bufsize) ;

        bool SetFileLength(FileOffset newlength);
        FileOffset GetFileLength() ;

        private:
        FileOffset start,limit;
        RandomStream *str;
};

/** Make a Blex::Stream derivate buffered. We need _virtual_ to ensure that we
    are accessing the same Blex::Stream base as does the class that invokes us
    as a helper. Derivates of this class should put a FlushBuffer() in their
    destructor to ensure flushing on destruction */
class BLEXLIB_PUBLIC StreamBuffer : public virtual Stream
{
        public:
        StreamBuffer(unsigned buffersize);
        virtual ~StreamBuffer();

        std::size_t Read(void *buf,std::size_t maxbufsize);
        std::size_t Write(const void *buf, std::size_t bufsize);

        bool FlushBuffer();
        bool EndOfStream();

        protected:
        unsigned GetBufferSize() const { return buffersize; }

        virtual std::size_t StreamRead(void *buf,std::size_t maxbufsize)=0;
        virtual std::size_t StreamWrite(void const *buf,std::size_t bufsize)=0;

        bool eof;
        bool lastwaswrite;

        private:
        ///Allocated buffer size
        const unsigned buffersize;
        ///Number of bytes currently read into the buffer (0 during writes)
        unsigned bytes_read_into_buffer;
        ///Read/Write position in buffer
        std::size_t bufferpos;

        std::unique_ptr<uint8_t[]> buffer;
        friend class RandomStreamBuffer;
};

/** Make a Blex::RandomStream derivate buffered. Derivates of this class should put a FlushBuffer() in their
    destructor to ensure flushing on destruction*/
class BLEXLIB_PUBLIC RandomStreamBuffer : public StreamBuffer, public virtual RandomStream
{
        public:
        RandomStreamBuffer(unsigned buffersize);
        virtual ~RandomStreamBuffer();

        std::size_t DirectRead (FileOffset startpos, void *buf,       std::size_t maxbufsize) ;
        std::size_t DirectWrite(FileOffset startpos, const void *buf, std::size_t bufsize) ;
        virtual std::size_t RawDirectRead(FileOffset startpos,void *buf,std::size_t maxbufsize) =0;
        virtual std::size_t RawDirectWrite(FileOffset startpos,void const *buf,std::size_t bufsize) =0;
        FileOffset GetOffset();
        bool SetOffset(FileOffset offset);

        private:
        std::size_t StreamRead(void *buf,std::size_t maxbufsize);
        std::size_t StreamWrite(void const *buf,std::size_t bufsize);
        ///Current file position for 'stream' reads.
        Blex::FileOffset offset;
};

/** A bufferedstream turns an existing stream into a buffered stream.
    This stream can be used to easily wrap existing objects that are accessed
    inefficiently */
class BLEXLIB_PUBLIC BufferedStream : public virtual Stream, public StreamBuffer
{
        public:
        /** Attach a buffer to an existing stream
            @param mystream Stream to buffer */
        explicit BufferedStream(Stream &mystream,unsigned buffersize=16384);
        ~BufferedStream();

        /** Get the buffer relative offset
            @return 0 or a negative value, which can be added to the GetOffset of the underlying stream
                    to find the actual buffer position
        int GetBufferOffset() const { return GetPosition(); }
        */

        private:
        std::size_t StreamRead(void *buf,std::size_t maxbufsize);
        std::size_t StreamWrite(void const *buf,std::size_t bufsize);

        Stream &str;
};

class BLEXLIB_PUBLIC BufferedRandomStream : public virtual RandomStream, public RandomStreamBuffer
{
public:
        explicit BufferedRandomStream(std::shared_ptr<Blex::RandomStream> mystream, unsigned buffersize=16384);
        ~BufferedRandomStream();
        bool SetFileLength(Blex::FileOffset newlength);
        Blex::FileOffset GetFileLength();

private:
        std::size_t RawDirectRead(Blex::FileOffset startpos,void *buf,std::size_t maxbufsize);
        std::size_t RawDirectWrite(Blex::FileOffset startpos,void const *buf,std::size_t bufsize);
        std::shared_ptr<Blex::RandomStream> str;
};


/** The null stream returns EOF on read and drops all written bytes, without
    ever reporting an error */
class BLEXLIB_PUBLIC NullStream : public Stream
{
        public:
        NullStream();
        ~NullStream();
        std::size_t Read(void *buf,std::size_t maxbufsize);
        bool EndOfStream();
        std::size_t Write(void const *buf, std::size_t bufsize);
};

/** Append a stream to a vector of uint8_t. This function will read all data from
    the specified stream until Read returns 0, and append it to the specified
    vector
    @param str Stream to read
    @param vec Vector in which to store the data
    @return Number of bytes read */
unsigned BLEXLIB_PUBLIC ReadStreamIntoVector(Stream &str, std::vector<uint8_t> *vec);
unsigned BLEXLIB_PUBLIC ReadStreamIntoVector(Stream &str, std::vector<char> *vec);
std::string BLEXLIB_PUBLIC ReadStreamAsString(Stream &str);

// Specialize Read?SB and Write?SB to work with strings
template <> inline
  std::size_t Stream::WriteLsb<std::string> (std::string const &data)
{
        std::size_t total = WriteLsb<uint32_t>(data.size());
        total += WriteString(data);
        return total;
}
template <> inline
  std::size_t Stream::WriteMsb<std::string> (std::string const &data)
{
        std::size_t total = WriteMsb<uint32_t>(data.size());
        total += WriteString(data);
        return total;
}
template<> inline
  bool Stream::ReadLsb<std::string>(std::string *store)
{
        uint32_t len;
        if (!ReadLsb(&len))
            return false;
        store->resize(len);
        return Read(&(*store)[0],len)==len;
}
template<> inline
  bool Stream::ReadMsb<std::string>(std::string *store)
{
        uint32_t len;
        if (!ReadMsb(&len))
            return false;
        store->resize(len);
        return Read(&(*store)[0],len)==len;
}

template <typename WriteType>
  inline std::size_t Stream::WriteLsb (WriteType const &data)
{
        uint8_t store[sizeof(WriteType)];
        PutLsb<WriteType>(store,data);
        return Write(store,sizeof(WriteType));
}
template <typename WriteType>
  inline std::size_t Stream::WriteMsb (WriteType const &data)
{
        uint8_t store[sizeof(WriteType)];
        PutMsb<WriteType>(store,data);
        return Write(store,sizeof(WriteType));
}


} //end namespace Blex
#endif //Sentry
