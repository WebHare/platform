#ifndef blex_zstream
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

class ArchiveReaderBase
{
        public:
        /** The structure returned for every entry in an archive */
        struct Entry
        {
                enum Type
                {
                        Eof,
                        Directory,
                        File
                };

                Entry(Type _type)
                  : type(_type),length(0),modtime(Blex::DateTime::Invalid())
                {
                }
                Entry(Type _type,
                               std::string const &name,
                               Blex::FileOffset length,
                               Blex::DateTime modtime
                               )
                  : type(_type),name(name),length(length),modtime(modtime)
                {
                }

                ///Type of this entry
                Type type;
                ///Name of the current entry
                std::string name;
                ///Size of the current decompressed file, if type==File
                Blex::FileOffset length;
                ///Modtime of the current entry
                Blex::DateTime modtime;
        };

        /** Dummy archive reader destructor, but required because we're a base class */
        virtual ~ArchiveReaderBase();

        /** Get the next entry information (fileobject) in the archive */
        virtual Entry   NextEntryInfo() = 0;

        /** Write the current entry's data to a stream */
        virtual bool    SendFile(Stream &stream) = 0;

        ArchiveReaderBase() {};
        ArchiveReaderBase(ArchiveReaderBase const &) = delete;
        ArchiveReaderBase& operator=(ArchiveReaderBase const &) = delete;
};

class BLEXLIB_PUBLIC ZipArchiveReader : public ArchiveReaderBase
{
        public:
        ~ZipArchiveReader();

        static ZipArchiveReader* Open(RandomStream &stream);

        Entry NextEntryInfo();
        bool  SendFile(Stream &stream);

        /// Get the full list of files
        void GetFilesList(std::vector< Entry > *entries);

        /// Send a file by path to a stream, returns whether the path was found
        bool SendFileByPath(std::string const &path, Stream &stream);

        std::string GetComment() { return comment; }

    private:
        static bool GetCentralDir(RandomStream &stream, Blex::FileOffset *start, std::size_t *len, unsigned *numentries, std::string *comment);

        Entry GetEntryByNr(unsigned filenr);
        bool  SendFileByNr(Stream &stream, unsigned filenr);


        struct ZippedEntry
        {
                std::string org_filename;
                std::string filename;
                Entry::Type type;
                unsigned compression;
                Blex::DateTime modtime;
                unsigned compressedsize;
                unsigned uncompressedsize;
                Blex::FileOffset localheader_offset;
                uint16_t bitflags;
        };

        struct ZipEntryFilePositionLess
        {
                bool operator()(ZippedEntry const &lhs, ZippedEntry const &rhs)
                {
                        return lhs.localheader_offset < rhs.localheader_offset;
                }
        };

        ZipArchiveReader(RandomStream &stream);

        std::vector<ZippedEntry> zippedfiles;

        /// Comment
        std::string comment;

        ///ZIP data container
        RandomStream &archivestream;
        ///Pointer in zippedfiles array for sequential archive reader
        unsigned zippedfiles_ptr;

        ZipArchiveReader(ZipArchiveReader const &) = delete;
        ZipArchiveReader& operator=(ZipArchiveReader const &) = delete;
};

class BLEXLIB_PUBLIC ZipArchiveWriter
{
    public:
        /** Create a zip archive */
        explicit ZipArchiveWriter(RandomStream &dest);

        /** Clean up */
        ~ZipArchiveWriter();

        void AddDir(std::string const &name, DateTime modtime);
        void AddFile(std::string const &name, DateTime modtime, Stream &stream);
        void SetComment(std::string const &comment);
//        void AddCompressedFile(std::string const &name, DateTime modtime, uint16_t compression, Stream &stream);

        void Finalize();

    private:
        bool StoreFilename(std::string *store, std::string const &inname);
        void WriteExtraFields(bool need_utf8, std::string const &utf8name, std::string const &storedname);
        unsigned GetExtraFieldLen(bool need_utf8, std::string const &inname);

        /** List of entries, for the central directory
        */
        struct Entry
        {
                std::string cp437name;
                std::string utf8name;
                bool store_utf8name;
                bool is_directory;

                std::pair< uint16_t, uint16_t > datetime;

                Blex::DateTime modtime;

                Blex::FileOffset headerpos;

                Blex::FileOffset uncompressed_size;
                Blex::FileOffset compressed_size;
                uint32_t crc32;

                bool compressed;
        };

        std::vector< Entry > entries;

        std::string comment;

        RandomStream &dest;

        ZipArchiveWriter(ZipArchiveWriter const &) = delete;
        ZipArchiveWriter& operator=(ZipArchiveWriter const &) = delete;
};

} //end namespace Blex

#endif //Sentry
