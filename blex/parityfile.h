#ifndef blex_parityfile
#define blex_parityfile

#ifndef blex_crypto
#include "crypto.h"
#endif
#ifndef blex_crc
#include "crc.h"
#endif
#ifndef blex_path
#include "path.h"
#endif
#ifndef blex_podvector
#include "podvector.h"
#endif
#include <list>

namespace Blex
{

/** A parity file offers a robust storage for eg. backups that can tolerate
    storage errors (because noone ever looks at backups or makes sure they
    actually survived a network transfer). It has built-in support for
    splitting and MD5 hash generation (the hash is generated over the generated
    data, not over the original data). The parity features are similair to
    eg. RAID-5

    On read, recoverable errors are reported through the error callback. Irrecoverable
    errors are reported through std::runtime_error */
class BLEXLIB_PUBLIC ParityFile : public Stream
{
        public:
        typedef std::function< void(std::string const &) > ErrorCallback;

        /** Open a parity file for reading
            @param path Base path of parity file to open
            @param onerror Function to invoke for every recoverable errors
            @return An opened parity file. Never returns NULL */
        static ParityFile* OpenRead(std::string const &path, ErrorCallback const &onerror);

        /** Create a new parity file
            @long The various parameters determine the size of the eventual file blocks
            Each file will be up to sectorsize*blocksize*(datablocks+parityblocks)*segmentsperfile bytes
            @param path Base path of parity file to open
            @param filemode File mode
            @param sectorsize Size of each sector (minimum unit over which a CRC-32 is calculated)
            @param blocksize Number of sectors in a block
            @param datablocks Number of data blocks in a segment
            @param parityblocks Number of parity blocks in a segment
            @param segmentsperfile Number of segments per file
            @param md5hash Generate a MD5 hash file at finalization ? */

        static ParityFile* OpenWrite( std::string const &path
                                    , Blex::FilePermissions::AccessFlags filemode
                                    , unsigned sectorsize
                                    , unsigned blocksize
                                    , unsigned datablocks
                                    , unsigned parityblocks
                                    , unsigned segmentsperfile
                                    , bool md5hash
                                    );

        ~ParityFile();

        /** Read parity file data. */
        virtual std::size_t Read(void *buf,std::size_t maxbufsize);
        virtual bool EndOfStream();
        virtual std::size_t Write(void const *buf, std::size_t bufsize);

        ///Finish and close the file
        bool Finalize();
        ///Get the number of files written
        unsigned GetNumFilesWritten();
        ///Get a file's path by its number
        std::string GetFilePathByNumber(unsigned filenum);
        ///Add an error message
        void AddError(unsigned sector, unsigned block, unsigned segment, unsigned file, std::string const &error);
        ///How many data bytes can we actually fit in a sector?
        unsigned GetSectorDataSize() const;
        ///How many bytes did we already see ?
        Blex::FileOffset GetTotalInputBytes() const;

        private:
        ParityFile();

        inline unsigned BlockBytes() const;
        inline unsigned BlocksPerSegment() const;
        inline unsigned SegmentBytes() const;
        inline unsigned CalcSegmentOffset(unsigned byte, unsigned sector, unsigned block) const;
        inline unsigned GetSegmentOffset() const;
        inline unsigned GetBytesInCurrentSector() const;
        inline bool IsEOFBlock() const;


        void MoveToNextSectorRead();
        void FinishSectorWrite(bool eof);
        void GenerateHeader(unsigned sector, unsigned block, unsigned segment, unsigned file);
        void GenerateParityBlock();
        void ReadSegmentFromDisk();
        void WriteSegmentToDisk();
        void InitNextWriteSector();
        bool OpenNextFile();
        void ValidateSegment();
        void FinalizeFile();

        typedef std::vector< std::pair< uint8_t *, bool > > SectorValidityList;

        /** Correct the errors within a sector strip set
            @param sectors List of sectors and whether they are valid
        */
        void CorrectErrorsByParity(std::vector< std::pair< uint8_t *, bool > > &sectors);

        std::string path;
        Blex::FilePermissions::AccessFlags filemode;
        unsigned sectorsize; //number of bytes in a sector
        unsigned blocksize; //number of sectors in a block
        unsigned datablocks; //number of data blocks in a segment
        unsigned parityblocks; //number of parity blocks in a segment
        unsigned segmentsperfile;
        bool md5hash;

        Blex::PodVector<uint8_t> segmentbuffer;
        unsigned curbyte;
        unsigned cursector;
        unsigned curblock;
        unsigned cursegment;
        unsigned curfile;
        bool writing;
        bool writefailed;
        ErrorCallback onerror;

        std::unique_ptr<Blex::FileStream> curstream;

        Crc32 sector_crc;
        std::string md5_digests;
        Blex::MD5 md5_sofar;

        Blex::FileOffset totalinbytes;

};

} //end namespace Blex

#endif //sentry
