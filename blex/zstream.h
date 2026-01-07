#if !defined(blex_zstream)
#define blex_zstream

#ifndef blex_stream
#include "stream.h"
#endif
#ifndef blex_crc
#include "crc.h"
#endif

#include <ctime>

namespace Blex
{

/** A ZlibDecompressStream adopts an existing stream and returns decompressed
    data */
class BLEXLIB_PUBLIC ZlibDecompressStream : public Stream
{
        public:

        /** Destroy the decompressing stream, and the stream it is based upon */
        virtual ~ZlibDecompressStream();

        //Basic I/O functions. They return the # of bytes read or written,
        //or 0 upon error or EOF
        bool EndOfStream();
        std::size_t Read(void *buf,std::size_t maxbufsize);
        std::size_t Write(const void *buf, std::size_t bufsize);

        /** Use an existing stream containing GZIP data as a source, and decompress its contents */
        static ZlibDecompressStream* OpenGzip(Stream &originalstream);

        /** Use an existing RAW stream as a source, and decompress its contents */
        static ZlibDecompressStream* OpenRaw(Stream &originalstream, FileOffset filelength);

        /** Use an existing Zlib (used in pdf) stream as a source, and decompress its contents */
        static ZlibDecompressStream* OpenZlib(Stream &originalstream);

        /** Has the datastream gotten corrupted somehow? */
        inline bool IsCorrupted() const
        {
                return corrupted;
        }

        protected:

        ///Compressed file data type
        enum FileType
        {
                ///Raw, compressed data
                Raw,
                ///Zlib, compressed data (used in pdf)
                Zlib,
                ///Gzip file
                Gzip
        };

        static ZlibDecompressStream* Open(Stream &originalstream, FileType filetype, FileOffset filelength);

        private:

        struct Data;

        /** Construct a decompressing stream */
        ZlibDecompressStream();
        /** Strip Gzip header from stream
            @return false if the gzip header was invalid */

        bool StripGzipHeader();
        /** Read a single byte from the buffer, refilling the buffer if necessary
            @return the byte, or -1 on EOF */

        signed ReadSingleByte();

        /** Fill the internal buffers as much as possible and update Zlib's
            data pointers to the start of the buffer*/
        void FillReadBuffers();

        /** Get a loadful of decompressed data*/
        void DecompressData();

        /** Our internal, private data. We use an undefined structure so that
            our callers don't need to include the Zlib headers (which are messy
            and screw up the namespace with tons of #defines) */
        Data* data;

        bool corrupted;
        bool eof;
};

/** A ZlibCompressStream adopts an existing stream and writes compressed data to it */
class BLEXLIB_PUBLIC ZlibCompressStream : public Stream
{
        public:
        ///Compressed file data type
        enum FileType
        {
                ///Raw, compressed data
                Raw,
                ///Gzip file
                Gzip,
                ///Zip file
                Zip
        };

        /** Create a compressing stream on top of a normal stream
            @param true_data Output stream
            @param filetype Type of the file (raw or gzip)
            @param compress_factor Compression factor (0=no compress, 1=high speed, 2..8, 9=small size)*/
        ZlibCompressStream(Stream &true_data, FileType filetype, unsigned compress_factor);

        /** Destroy the decompressing stream, and the stream it is based upon */
        virtual ~ZlibCompressStream();

        //Basic I/O functions. They return the # of bytes read or written,
        //or 0 upon error or EOF
        bool EndOfStream();
        std::size_t Read(void *buf,std::size_t maxbufsize);
        std::size_t Write(const void *buf, std::size_t bufsize);

        inline FileType GetFileType() { return filetype; }
        inline uint32_t GetCRC32() { return input_crc.GetValue(); }

        private:
        struct Data;

        ///Crc32 of the input data (needed for Zip/Gzip files)
        Crc32 input_crc;

        ///Type of the compressed file
        FileType filetype;

        /** Our internal, private data. We use an undefined structure so that
            our callers don't need to include the Zlib headers (which are messy
            and screw up the namespace with tons of #defines) */
        Data* data;
};

} //end namespace Blex

#endif //Sentry
