#include "utils.h"
#include "mapvector.h"

#include <vector>
#include <stdexcept>
#include <map>


namespace Blex
{

namespace DocfileDetail
{

//-----------------------------------------------------------------------------
//
// OLE property sets (the OLE file system)
//
//
struct Pps
{
        public:
        const uint16_t *GetRawNamePtr() const        { return reinterpret_cast<const uint16_t*>(data); }
        int16_t     GetRawNameLength() const        { return static_cast<int16_t>(gets16lsb(data+0x40)/2); }
        int16_t     MaxRawNameLength() const        { return 64; }

        enum PpsType
        {
                //Plain directory
                Storage=1,
                //Plain stream
                Stream=2,
                //Root directory
                Root=5
        };

        enum PpsType GetType() const            { return static_cast<enum PpsType>(data[0x42]); }
        bool    IsStorage() const               { return GetType()==Storage; }
        bool    IsStream() const                { return GetType()==Stream; }
        bool    IsRoot() const                  { return GetType()==Root; }

        int32_t     GetPrev() const                 { return gets32lsb(data+0x44); }
        int32_t     GetNext() const                 { return gets32lsb(data+0x48); }
        int32_t     GetDir() const                  { return gets32lsb(data+0x4C); }

        int32_t     GetStartBlock() const           { return gets32lsb(data+0x74); }
        int32_t     GetSize() const                 { return gets32lsb(data+0x78); }
        uint8_t const* GetCLSID() const                { return data+0x50; }

        private:
        uint8_t      data[0x80];

        /*
        uint8_t      rawname[64];            // 0000
        LSBS16  sizeofname;             // 0040 length of the name above
        uint8_t      type;                   // 0042 type of pps (1=storage|2=stream|5=root)
        uint8_t      uk0;
        LSBS32  prev;                   // 0044 previous pps
        LSBS32  next;                   // 0048 next pps
        LSBS32  dir;                    // 004C directory pps
        int32_t     unused_1[5];
        LSBS32  ts1s;                   // 0064 timestamp 1: seconds
        LSBS32  ts1d;                   // 0068 timestamp 1: days
        LSBS32  ts2s;                   // 006C timestamp 2: seconds
        LSBS32  ts2d;                   // 0070 timestamp 2: days
        LSBS32  sb;                     // 0074 starting bloc of property
        LSBS32  size;                   // 0078 size of property
        int32_t     unused_2;
        */
};

struct Entry
{
        public:
        explicit Entry(const Pps &p);

        int32_t firstblock;                 // first block (formerly start)
        uint32_t size;                // size of the file (in bytes)
        uint8_t clsid[16];
};

class Fat
{
        public:
        enum BlockTypes
        {
                FreeBlock = -1,
                EndOfChain = -2,
                SpecialBlock = -3,
                FatExtension = -4
        };

        /** Get the physical location of a block */
        //virtual Blex::FileOffset GetBlockOffset(int32_t blocknumber) const=0;

        /** Get the block size of this fat */
        virtual unsigned GetBlockSize() const = 0;

        /** Advance a fat pointer by the specified number of blocks */
        int32_t Advance(int32_t start, unsigned numblocks) const;

        /** Get the length of a file in blocks */
        unsigned LengthInBlocks(int32_t start) const;

        /** Validate entries in the FAT (check for illegal references and circulars) */
        void Validate() const;

        unsigned GetDescribedNumBlocks() const
        { return fat.size(); }

        virtual ~Fat();

        protected:
        /** Register bad block number and throw an execption */
        void BadBlockNumber(int32_t blocknumber) const;

        /** Parse in a FAT section */
        void ParseFat(int32_t start,const uint8_t *fatdata,unsigned fatelements);

        /** Get the next fat pointer */
        inline int32_t NextBlock(int32_t currentblock) const
        {
                return fat[currentblock];
        }

        /** Advance a fat pointer one single block */
        inline int32_t AdvanceOne(int32_t currentblock) const
        {
                int32_t nextblock = NextBlock(currentblock);
                if (nextblock < 0 || static_cast<unsigned>(nextblock) >= fat.size())
                    BadBlockNumber(currentblock);
                return nextblock;
        }

        std::vector<int32_t> fat;
};

/** The 'big fat' is the locator and reader of big blocks */
class BigFat : public Fat
{
        public:
        static unsigned const BlockSize = 512;

        BigFat(Docfile::Data &olefile, unsigned numbigblockdepots);

        unsigned GetBlockSize() const;

        virtual Blex::FileOffset GetBlockOffset(int32_t blocknumber) const;

        /** Return a pointer to the specified block, or NULL if an error occured.
            This pointer is invalidated after the next ReadBlock */
        uint8_t const * ReadBlock(int32_t bigblockno);

        private:
        void ReadFat();

        Docfile::Data &olefile;

        ///Start offset of cached data
        Blex::FileOffset cache_start;
        ///Number of bytes of cached data
        std::size_t cache_size;
        ///Cached data
        uint8_t datacache[4096];

};

class SmallFat : public Fat
{
        public:
        static unsigned const BlockSize = 64;
        static unsigned const SmallBocksPerBigBlock = BigFat::BlockSize/SmallFat::BlockSize;

        /** Small fast constructor
            @param bigfat Big fat
            @param startblock root->startblock (beginning of small fat)
            @param smallsize Size of the small blocks container */
        SmallFat(BigFat &bigfat);

        /** Load the fat (can't be done until the directories are read) */
        void LoadFat(int32_t startblock, int32_t smallsize);

        unsigned GetBlockSize() const;

        /** Return a pointer to the specified block, or NULL if an error occured.
            This pointer is invalidated after the next ReadBlock */
        const uint8_t* ReadBlock(int32_t blocknumber);

        private:
        void ReadFat();

        BigFat &bigfat;

        int32_t startblock;
};

} //end of namespace ::Blex::DocfileDetail

struct Docfile::File
{
        explicit File(DocfileDetail::Pps const &p);

        void    Dump (std::ostream &output, std::string const &yourname, unsigned currentlevel) const;

        DocfileDetail::Entry entry;
};

struct Docfile::Directory
{
        typedef std::map<std::string, std::shared_ptr<Directory>, StrCaseLess<std::string> > SubDirs;

        typedef std::map<std::string, File, StrCaseLess<std::string> > SubFiles;

        explicit Directory(DocfileDetail::Pps const &p);

        void Dump (std::ostream &output, std::string const &yourname, unsigned int currentlevel) const;

        SubDirs subdirs;
        SubFiles subfiles;

        DocfileDetail::Entry entry;
};

class Docfile::Data
{
        public:
        Data(RandomStream &infile);

        ~Data();

        void TryPreprocessFile();

        void TryReadDirectories();

        void DumpOleFile (std::ostream &output);

        /** Process an OLE directory entry
            @param currentdir Directory to add entries to (add yourself as file or folder)
            @param which Entry to process
            @param olepps OLE directory data
            @param tocuhed Bitset of OLE directories already processed*/
        void ProcessDir(Directory *currentdir,
                                 unsigned which,
                                 const std::vector<DocfileDetail::Pps> &pps,
                                 std::vector<bool> &touched);

        RandomStream &sourcefile;

        std::unique_ptr<Directory> root;
        std::unique_ptr<DocfileDetail::BigFat> bigfat;
        std::unique_ptr<DocfileDetail::SmallFat> smallfat;

        uint8_t oleheader[DocfileDetail::BigFat::BlockSize];
};

namespace DocfileDetail
{

/** Base class for OLE streams, defining the things small and large files
    have in common */
class Stream : public RandomStream_InternalFilePointer
{
        public:
        virtual std::size_t DirectWrite(FileOffset startpos,const void *buf,std::size_t bufsize) ;

        bool SetFileLength (FileOffset newsize);
        FileOffset GetFileLength (void) ;

        protected:
        Stream(const Docfile::File &myfile);

        private:
        //The spec limits them to 4GB
        uint32_t size;
};

/** Short ole streams (those stored in smallblocks) are very tricky
    to handle, and we're better off just caching them entirely in
    memory as they're limited to 1k in size anyway*/
class ShortStream : public Stream
{
        public:
        ShortStream(Docfile::Data &olearc,const Docfile::File &myfile);

        virtual std::size_t DirectRead(FileOffset startpos,void *buf,std::size_t maxbufsize) ;

        private:
        std::vector<uint8_t> data;
};

class LongStream : public Stream
{
        public:
        LongStream(Docfile::Data &olearc,Docfile::File const &myfile);

        virtual std::size_t DirectRead(FileOffset startpos,void *buf,std::size_t maxbufsize) ;

        private:
        typedef MapVector<unsigned long,uint32_t> FileMap;

        Docfile::Data &olearc;

        /** Get the starting block and number of remaining consequtive bytes for a given file offset */
        std::pair<FileOffset, std::size_t> GetBlockRange(uint32_t pos) const;

        /** Map file positions to block numbers */
        FileMap filemap;
};

} //end of namespace ::Blex::DocfileDetail

} //end of namespace ::Blex
