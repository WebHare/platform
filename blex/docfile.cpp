#include <blex/blexlib.h>


#include "docfile.h"
#include "unicode.h"
#include "docfile_impl.h"

/*
OLE file format documentation was found at: http://snake.cs.tu-berlin.de:8081/~schwartz/pmh/index.html
and will be mirrored in X:/webhare/fileformats. The extended fat code is not
documented there, is not documented anywhere on the web as far as I know, and
I haven't gotten around to document it very well here.

A viewer for OLE files can be found on the MSDN PLATFORM SD CDs
(you need the 'Tools', 'Platform SDK tools' - it's called DocFile viewer)

Basically, when the above documented links-to-fat pages are full (after about
7MB of data), a chained list of pages with links-to-fats is scattered throughout
the document. Each of these pages contains 127 block numbers of FAT pages, and
then the block number in to the next page in the extended FAT chain.

A major consideration when reading OLE documents: tolerate errors as much as
possible. It seems that a lot of errors easily sneak into generated OLE docs,
but MS' code often ignores these errors. So, to accept at least as much documents
as MS does, we must attempt to tolerate errors as much as possible. For example,
we don't freak out at some illegal data in the FAT if it is never referenced
anyway.

Note that word 2000 seems to do a fairly good job of checking whether an OLE
document is corrupted, but word 97 often happily reads in a corrupted document,
and crashes later on.

OLE files contain special files called 'property files', which store all the
stuff you see on the property sheets when right-clicking a word document inside
the explorer. An explaination of this data can be found in the document
'OLE Property Sets Exposed' which, at this moment, is at:
http://msdn.microsoft.com/library/default.asp?url=/library/en-us/dnolegen/html/msdn_propset.asp
*/

namespace Blex
{

namespace DocfileDetail
{

//-----------------------------------------------------------------------------
//
// OLE directory entries
//
//
Entry::Entry(Pps const &p)
{
        firstblock = p.GetStartBlock();
        size=p.GetSize();
        std::copy(p.GetCLSID(),p.GetCLSID() + sizeof(clsid),clsid);
}

//-----------------------------------------------------------------------------
//
// OLE base FAT support (functions common to small and big FATs)
//
//

Fat::~Fat()
{
}

//assumes validated ole_fat
unsigned Fat::LengthInBlocks (int32_t blocknumber) const
{
        unsigned counter=0;
        while (blocknumber >= 0)
        {
                ++counter;
                blocknumber=NextBlock(blocknumber);
        }
        return counter;
}

int32_t Fat::Advance(int32_t start, unsigned numblocks) const
{
        while (numblocks>0)
        {
                start=AdvanceOne(start);
                --numblocks;
        }
        return start;
}

void Fat::BadBlockNumber(int32_t blocknumber) const
{
        throw DocfileException( "Fat block "
                              + Blex::AnyToString(blocknumber)
                              + " points to block "
                              + Blex::AnyToString(fat[blocknumber])
                              + " which does not exist.");
}

void Fat::ParseFat(int32_t cur_block,const uint8_t *fatdata,unsigned fatelements)
{
        //Read the fat members themselves
        int32_t fat_size=fat.size();
        for (unsigned i=0; i<fatelements && cur_block<fat_size;++i,++cur_block)
        {
                fat[cur_block] = gets32lsb(fatdata+i*4);
                if (fat[cur_block]>=fat_size
                    /* || fat[cur_block]<-4 */) //-4 is a new kind of special block!
                {
                        throw DocfileException( "Bad block numbers in OLE fat. pagesize: "
                                              + Blex::AnyToString(fatelements)
                                              + " block: "
                                              + Blex::AnyToString(cur_block)
                                              + " points to "
                                              + Blex::AnyToString(fat[cur_block]));
                }
        }
}

void Fat::Validate() const
{
        //validate the fat, walk through all blocks
        int32_t fat_size=(int32_t)fat.size();

        //detect circulars and unlinked blocks
        std::vector<bool> references(fat_size,false);

        for (int32_t i=0;i<fat_size;++i)
        {
                //We have already verified that all fat blocks are in range of the file.

                if (fat[i]<0)
                    continue; // special block. no need for checks

                //Detect cross-linking (which should also catch an indirect circular reference)
                if (references[fat[i]] || i==fat[i])
                    throw DocfileException( "Circular reference in FAT, block "
                                          + Blex::AnyToString(i)
                                          + " points to block "
                                          +  Blex::AnyToString(fat[i])
                                          + " which was already referenced by a previous block");

                references[ fat[i] ]=true;
        }
}



//-----------------------------------------------------------------------------
//
// OLE Small FAT support
//
//

SmallFat::SmallFat(BigFat &_bigfat)
: bigfat(_bigfat)
{
}

void SmallFat::LoadFat(int32_t _startblock, int32_t _smallsize)
{
        startblock=_startblock;
        fat.resize(_smallsize / BlockSize);
        ReadFat();
}

unsigned SmallFat::GetBlockSize() const
{
        return BlockSize;
}

const uint8_t * SmallFat::ReadBlock(int32_t blocknumber)
{
        /* The small blocks are stored in a file called the 'small blocks depot'.
           This file is the file pointed to by the OLE root entry'.
           As Ole_BigBlockSize/Ole_SmallBlockSize (8) blocks fit in each
           big block, we first need to track down the containing big block,
           and then return a pointer to the contained small block */
        int32_t containing_bigblock = bigfat.Advance(startblock, blocknumber / SmallBocksPerBigBlock);
        uint8_t const *blockptr = bigfat.ReadBlock(containing_bigblock);
        return blockptr ? blockptr + BlockSize * (blocknumber % SmallBocksPerBigBlock) : 0;
}

void SmallFat::ReadFat()
{
        uint8_t const *header = bigfat.ReadBlock(-1);
        if (!header)
            throw DocfileException( "I/O error reading docfile small fat");

        int32_t smallfat_block = gets32lsb(header+0x3C);
        if (smallfat_block < 0) //I guess there is no small fat...
            return;

        //Read the small block depot (smallblocks' FAT)
        //Used to be: for (a=0,b=0;a<=(maxsmallblock+1)/128;++a) probably compensating for other bugs

        for (unsigned current_fat_part = 0; current_fat_part < unsigned((fat.size()+127)/128); ++current_fat_part)
        {
                if (current_fat_part>0)
                    smallfat_block = bigfat.Advance(smallfat_block,1);

                uint8_t const *block = bigfat.ReadBlock(smallfat_block);
                if (!block)
                    throw DocfileException( "I/O error reading docfile small fat");

                ParseFat(current_fat_part * 128,block,128);
        }
}

//-----------------------------------------------------------------------------
//
// OLE Big FAT support
//
//
BigFat::BigFat(Docfile::Data &_olefile, unsigned numbigblockdepots)
: olefile(_olefile)
, cache_size(0)
{
        fat.resize(uint32_t(olefile.sourcefile.GetFileLength() / BlockSize)-1,0);

        if (numbigblockdepots!= ((fat.size()+127)/128) )
        {
                //DEBUGPRINT("Number of blocks in depots:" << (numbigblockdepots*128) << " file size in blocks: " << fat.size());

                //MS is tolerant for this, so we had to remove the ERROR-ABORT here.
                //We will compensate, and see how things turn out later on.
                fat.resize( std::min<int32_t>(numbigblockdepots* 128,fat.size() ));
        }

        ReadFat();
}

uint8_t const * BigFat::ReadBlock(int32_t bigblockno)
{
        //Round the bigblockno down to which multiple?
        static const unsigned MakeMultipleOf = sizeof datacache / BlockSize;

        //Special handling of bigblockno - 1 - we always have the header in memory
        if (bigblockno==-1)
            return olefile.oleheader;

        //Calculate the beginning point of a multiple. bigblockno==-1 is the beginning of the file
        int32_t cache_start_block = ((bigblockno+1)/MakeMultipleOf)*MakeMultipleOf -1;
        Blex::FileOffset required_cache_start = (cache_start_block+1) * BlockSize;
        DEBUGPRINT("readblock " << bigblockno << " current cachestart " << cache_start << " cachestartblock " << cache_start_block << " required_cache_start " << required_cache_start);

        //Do we have to move our 'cache window' ?
        if (cache_size == 0 || cache_start != required_cache_start)
        {
                cache_start = required_cache_start;
                DEBUGPRINT("Read more into cache " << cache_start);
                //Fill the cache
                cache_size = olefile.sourcefile.DirectRead(cache_start,datacache,sizeof datacache);
                DEBUGPRINT("Cache size " << cache_size);
        }
        else
        {
                DEBUGPRINT("Reusing cache? " << cache_start_block);
        }

        //Is the block in the cache?
        if ((cache_size / BlockSize) > unsigned(bigblockno-cache_start_block))
        {
                DEBUGPRINT("Cache size " << cache_size << " returning " << (void*)(datacache + (bigblockno-cache_start_block) * BlockSize));
                return datacache + (bigblockno-cache_start_block) * BlockSize;
        }
        else
        {
                DEBUGPRINT("Block is outside file, returning NULL");
                return NULL; //block is outside file
        }
}

unsigned BigFat::GetBlockSize() const
{
        return BlockSize;
}

void BigFat::ReadFat()
{
        const uint8_t *header=ReadBlock(-1); //-1 is a special case, so 'header' is never invalidated
        if (!header)
            throw DocfileException( "I/O error reading header for extended fat");

        int32_t fat_size=(int32_t)fat.size();

        uint8_t extendedfatdata[BlockSize]; //store for extended fats
        int32_t extendedfat_blocknum = getu32lsb(header+0x44); //current extended fat block. header contains pointer to first link in extended fat chain

        for (unsigned current_fat_part = 0; current_fat_part < unsigned((fat_size+127)/128); ++current_fat_part)
        {
                //Locate this fat part first
                int32_t fatpart_blocknum;

                if (current_fat_part < 109)
                {
                        //the first 109 blocks have their locations in the header
                        fatpart_blocknum = gets32lsb(header+0x4C+current_fat_part*4);
                }
                else
                {
                        //Should we switch to the next entended fat page?
                        //(every extended fat page holds 127 entries)
                        if (((current_fat_part - 109)%127) == 0)
                        {
                                if (current_fat_part > 109) //a reference to the next part is in the last doubleword of the current part
                                    extendedfat_blocknum = getu32lsb(extendedfatdata + 127*4);

                                //DEBUGPRINT("OLE reader: At part " << current_fat_part << " switching to page " << extendedfat_blocknum);
                                if (extendedfat_blocknum < 0 || extendedfat_blocknum >= fat_size)
                                    throw DocfileException( "Extended fat block points outside the file");

                                uint8_t const *fatblock = ReadBlock(extendedfat_blocknum);
                                if (!fatblock)
                                    throw DocfileException( "I/O error reading extended fat");
                                memcpy(extendedfatdata, fatblock, sizeof extendedfatdata);
                        }

                        fatpart_blocknum = gets32lsb(extendedfatdata + 4*((current_fat_part-109)%127));
                }

                if (fatpart_blocknum<0 || fatpart_blocknum>=fat_size)
                    throw DocfileException( "Big block depot list points out of file");

                //Parse the fat (128 elements per part)
                uint8_t const *curfatblock = ReadBlock(fatpart_blocknum);
                if (!curfatblock)
                    throw DocfileException( "I/O error reading extended fat");
                ParseFat(current_fat_part * 128, curfatblock, 128);
        }

        Validate();
}

FileOffset BigFat::GetBlockOffset(int32_t blocknumber) const
{
        //First block in file is '-1', not '0'.
        //assert(blocknumber < int32_t(fat.size()));
        return (blocknumber+1) * BlockSize;
}

//-----------------------------------------------------------------------------
//
// OLE short stream (for small files)
//
//
ShortStream::ShortStream(Docfile::Data &olearc,const Docfile::File &myfile)
: Blex::Stream(false)
, Stream(myfile)
{
        //Read the file contents immediately!
        data.resize(uint32_t(myfile.entry.size));

        //Configure ourselves for reading from the smallblocks or bigblocks space
        const unsigned blocksize = DocfileDetail::SmallFat::BlockSize;
        int32_t curblock = myfile.entry.firstblock;
        unsigned bytesread = 0;

        DEBUGPRINT("startblock " << curblock << " toread " << myfile.entry.size);

        //Loop through the FAT, reading the data associated with the file
        while (bytesread < myfile.entry.size)
        {
                //How much to read?
                size_t to_read = std::min<std::size_t>(blocksize,(std::size_t)myfile.entry.size - bytesread);
                DEBUGPRINT("toread " << to_read);

                //Get the data
                uint8_t const *sourcedata = olearc.smallfat->ReadBlock(curblock);
                if(!sourcedata)
                        throw DocfileException( "I/O error reading docfile smallblock #" + Blex::AnyToString(curblock));

                std::copy(sourcedata, sourcedata + to_read, &data[bytesread]);

                //Advance to the next block
                bytesread += blocksize;
                if (bytesread < myfile.entry.size)
                {
                        curblock = olearc.smallfat->Advance(curblock,1);
                        DEBUGPRINT("Advanced to " << curblock);
                }
       }
}

std::size_t ShortStream::DirectRead (FileOffset startread, void *buffer, std::size_t length)
{
        //Correct file pointers
        startread = std::min<Blex::FileOffset>(startread,data.size());
        length = std::min<std::size_t>(length,(unsigned)(data.size()-startread));

        std::memcpy(buffer,&data[(unsigned)startread],length);
        return length;
}

//-----------------------------------------------------------------------------
//
// OLE long streams
//
//
LongStream::LongStream(Docfile::Data &olearc,const Docfile::File &myfile)
: Blex::Stream(false)
, Stream(myfile)
, olearc(olearc)
{
        assert(myfile.entry.size >= 0x1000);

        //Generate the fileoffset to memptr map, so that we can rapidly access
        //data without going through the FAT
        const unsigned BlockSize = DocfileDetail::BigFat::BlockSize;
        int32_t blocknum = myfile.entry.firstblock;
        unsigned long bytesscanned=BlockSize;
        FileOffset startptr = olearc.bigfat->GetBlockOffset(blocknum);

        while (bytesscanned < myfile.entry.size)
        {
                //Find the next block (return -1 if at EOF)
                int32_t nextblock = olearc.bigfat->Advance(blocknum,1);

                //Is the next block consecutive?
                if (nextblock != blocknum + 1)
                {
                        //No! Close this part
                        //std::cerr << "Part last byte at " << std::hex << (bytesscanned) << " startptr " << std::hex << (int)startptr << "\n";
                        filemap.PushBack(std::make_pair(bytesscanned,startptr));
                        startptr = olearc.bigfat->GetBlockOffset(nextblock);
                }
                blocknum = nextblock;
                bytesscanned += BlockSize;
        }
        //Close the last part
        filemap.PushBack(std::make_pair(myfile.entry.size,startptr));
}

std::pair<FileOffset, std::size_t> LongStream::GetBlockRange(uint32_t pos) const
{
        //Find this position in the filemap
        FileMap::const_iterator itr = filemap.LowerBound(pos+1);

        if (itr == filemap.End())
            return std::make_pair(0,0); //tried to search past the end!

        //Calculate the start offset and length of this block
        unsigned long block_startoffset,block_length;

        if (itr == filemap.Begin())
        {
                block_startoffset=0;
                block_length=itr->first;
        }
        else
        {
                block_startoffset = itr[-1].first;
                block_length = itr->first - block_startoffset;
        }

        return std::make_pair(itr->second + (pos-block_startoffset), block_length - (pos-block_startoffset));
}

std::size_t LongStream::DirectRead (FileOffset startread, void *buffer, std::size_t length)
{
        //Correct file pointers
        startread = std::min(startread,GetFileLength());
        length = std::min<std::size_t>(length,(std::size_t)(GetFileLength()-startread));

        unsigned long bytesread=0;

        //Loop until we have all the data
        while (length > 0)
        {
                //Get a pointer to as much data as possible
                std::pair<FileOffset,std::size_t> data = GetBlockRange((uint32_t)startread);
                if (data.second == 0)
                    break; //EOF

                //Copy as much as we can
                std::size_t to_read = std::min(data.second, length);
                std::size_t have_read = olearc.sourcefile.DirectRead(data.first,
                                                                      static_cast<uint8_t*>(buffer) + bytesread,
                                                                      to_read);
                //Advance the output pointers
                length -= have_read;
                bytesread += have_read;
                startread += have_read;

                if (have_read<to_read)
                    break; //I/O error, so stop reading now.
        }
        return bytesread;
}

//-----------------------------------------------------------------------------
//
// OLE stream
//
//
Stream::Stream(const Docfile::File &myfile)
: Blex::Stream(false)
, size(myfile.entry.size)
{
}

std::size_t Stream::DirectWrite (FileOffset,const void *,size_t)
{
        throw DocfileException("OleStream::Write(): OLE files are read-only");
}

bool Stream::SetFileLength(FileOffset)
{
        throw DocfileException("OleStream::SetFilelength(): OLE files are read-only");
}

FileOffset Stream::GetFileLength()
{
        return size;
}


} //end namespace ::Blex::DocfileDetail

DocfileException::DocfileException(std::string const & what_arg) : std::runtime_error(what_arg)
{
}
DocfileException::~DocfileException() throw()
{
}

//-----------------------------------------------------------------------------
//
// OLE (sub)directories
//
//
Docfile::Directory::Directory(DocfileDetail::Pps const &p)
: entry(p)
{
}

Docfile::File const * Docfile::FindFile (Directory const *dir, std::string const &name)
{
        Directory::SubFiles::const_iterator itr=dir->subfiles.find(name);
        if (itr==dir->subfiles.end())
            return NULL;
        return &itr->second;
}

std::vector<std::string> Docfile::GetFiles(Directory const *dir)
{
        std::vector<std::string> retval;
        for (Directory::SubFiles::const_iterator itr=dir->subfiles.begin(); itr!=dir->subfiles.end(); ++itr)
            retval.push_back(itr->first);

        return retval;
}

uint8_t const * Docfile::GetCLSID(Directory const *dir)
{
        return dir->entry.clsid;
}

const Docfile::Directory* Docfile::FindDirectory (Directory const *dir, std::string const &name)
{
        Directory::SubDirs::const_iterator itr=dir->subdirs.find(name);
        if (itr==dir->subdirs.end())
            return NULL;
        return itr->second.get();
}

std::vector<std::string> Docfile::GetDirectories(Directory const *dir)
{
        std::vector<std::string> retval;
        for (Directory::SubDirs::const_iterator itr=dir->subdirs.begin(); itr!=dir->subdirs.end(); ++itr)
            retval.push_back(itr->first);

        return retval;
}

void Docfile::Directory::Dump (std::ostream &output, std::string const &yourname, unsigned int currentlevel) const
{
        for (unsigned i=0;i<currentlevel;++i)
            output << "  ";

        output << yourname << " starting at block " << entry.firstblock << " and " << entry.size << " bytes long" << std::endl;

        for (SubFiles::const_iterator ptr=subfiles.begin();ptr!=subfiles.end();++ptr)
            ptr->second.Dump(output,ptr->first,currentlevel+1);
        for (SubDirs::const_iterator ptr=subdirs.begin();ptr!=subdirs.end();++ptr)
            ptr->second->Dump(output,ptr->first,currentlevel+1);
}


//-----------------------------------------------------------------------------
//
// OLE files
//
//
Docfile::File::File(const DocfileDetail::Pps &p)
: entry(p)
{
}

void Docfile::File::Dump (std::ostream &output, std::string const &yourname, unsigned int currentlevel) const
{
        for (unsigned i=0;i<currentlevel;++i)
            output << "  ";

        output << yourname
               << " starting at block " << entry.firstblock
               << " and " << entry.size
               << " bytes long" << std::endl;
}



//-----------------------------------------------------------------------------
//
// OLE internals
//
//
Docfile::Data::Data(RandomStream &infile)
 : sourcefile ( infile )
{
        TryPreprocessFile();
}

Docfile::Data::~Data()
{
}

void Docfile::Data::ProcessDir(Directory *currentdir,unsigned which,const std::vector<DocfileDetail::Pps> &pps,std::vector<bool> &touched)
{
        //Basic sanity checks
        if (which>=pps.size())
        {
                //DEBUGPRINT("Directories referring to non-existing files");
                return;
        }
        if (!pps[which].IsStorage() && !pps[which].IsStream() && !pps[which].IsRoot())
        {
                //DEBUGPRINT("Ignoring unknown OLE stream type");
                return;
        }
        if (!currentdir && pps[which].IsStream())
            throw DocfileException( "Root directory is not a directory");

        //Circular reference checks
        if (touched[which]) //Microsoft doesn't seem to care about this...
        {
                //DEBUGPRINT("Cyclic link in directory");
                return;
        }
        touched[which]=true;

        //Try to obtain the new name
        std::string name;
        if (pps[which].GetRawNameLength()<=0
            || pps[which].GetRawNameLength()>=pps[which].MaxRawNameLength())
        {
                //DEBUGPRINT("File with no name in OLE directory");
                return;
        }
        Blex::UTF8Encode(pps[which].GetRawNamePtr(),
                        pps[which].GetRawNamePtr()+std::min<int>(pps[which].GetRawNameLength()-1,pps[which].MaxRawNameLength()),
                        std::back_inserter(name));

        //DEBUGPRINT("File = " << StringConvert<std::string>(name) << " (" << name.size() << ")");
        if (pps[which].IsStream()) //it's a file
        {
                //assert(currentdir);
                currentdir->subfiles.insert(make_pair(name,File(pps[which])));
        }
        else
        {
                Directory *newdir=new Directory(pps[which]);
                //DEBUGPRINT("Entering directory");

                //Now process the directory
                if (pps[which].GetDir()>=0)
                    ProcessDir(newdir,pps[which].GetDir(),pps,touched);

                if (currentdir)
                {
                        std::shared_ptr< Blex::Docfile::Directory > ptr(newdir);
                        currentdir->subdirs.insert(make_pair(name, ptr));
                }
                else
                    root.reset(newdir);

                //DEBUGPRINT("Leaving directory");
        }

        //pps-s are ugly things, both the prev and the next pointer can point to
        //a new pps - and they too, can have a prev and a next pointer pointing
        //a whole new direction. prepare for mile-deep recursions

        //if this pps has a directory, let's do that first

        //process the previous pointer
        if (pps[which].GetPrev()>=0)
        {
                //it will concatenate itself to the end
                ProcessDir(currentdir,pps[which].GetPrev(),pps,touched);
        }

        //process the next pointer
        if (pps[which].GetNext()>=0)
        {
                //it will concatenate itself to the end
                ProcessDir(currentdir,pps[which].GetNext(),pps,touched);
        }
}

void Docfile::Data::TryReadDirectories()
{
        unsigned const EntriesPerBlock = bigfat->GetBlockSize() / sizeof(DocfileDetail::Pps);

        int32_t root_startblock = gets32lsb(oleheader+0x30);
        if (root_startblock<0)
           throw DocfileException( "Cannot find the OLE root directory");

        unsigned max_num_entries = bigfat->LengthInBlocks(root_startblock) * EntriesPerBlock;
        std::vector<DocfileDetail::Pps> pps(max_num_entries);

        for (unsigned i=0;i<max_num_entries;++i)
        {
                //Extract direntries from the root file.
                DocfileDetail::Pps const *dirdata = reinterpret_cast<const DocfileDetail::Pps*>(bigfat->ReadBlock(bigfat->Advance(root_startblock,i/EntriesPerBlock) ));
                if (!dirdata)
                        throw DocfileException( "I/O error reading a directory block");
                dirdata += (i%EntriesPerBlock);
                pps[i]=*dirdata;
        }

        //Find the root directory
        unsigned root_entry;
        for (root_entry=0; root_entry<max_num_entries; ++root_entry)
          if (pps[root_entry].IsRoot())
            break;

        if (root_entry >= max_num_entries)
           throw DocfileException( "Cannot find the OLE root directory");

        std::vector<bool> touched(max_num_entries,false);

        ProcessDir(NULL,root_entry,pps,touched);
        if (root.get()==NULL)
           throw DocfileException( "Cannot find the OLE root directory");
}

void Docfile::Data::TryPreprocessFile()
{
        if (sourcefile.DirectRead(0,oleheader,sizeof oleheader) != sizeof oleheader
            || !IsDocfileSignature(oleheader))
            throw DocfileException( "File is not an OLE document");

        // check if we actually know this format
        if (getu16lsb(oleheader+0x1c) != 0xFFFE)
            throw DocfileException( "OLE document uses an unsupported byte ordering");
        if (gets16lsb(oleheader+0x1e) != 9)
            throw DocfileException( "OLE document uses an unsupported large sector size");
        if (gets16lsb(oleheader+0x20) != 6)
            throw DocfileException( "OLE document uses an unsupported small sector size");
        if (gets16lsb(oleheader+0x38) != 0x1000)
            throw DocfileException( "OLE document uses an unsupported small stream maximum size");

        int32_t num_bigblock_depots = gets32lsb(oleheader+0x2c);

        if (num_bigblock_depots <= 0)
            throw DocfileException( "No big block depots");

        bigfat.reset(new DocfileDetail::BigFat(*this,num_bigblock_depots));
        smallfat.reset(new DocfileDetail::SmallFat(*bigfat));
        TryReadDirectories();
        smallfat->LoadFat(root->entry.firstblock,root->entry.size);
}

void Docfile::Data::DumpOleFile (std::ostream &output)
{
        output << "OLE Header:\n";
        output << "Number of big block depots: " << gets32lsb(oleheader+0x2C) << '\n';
        output << "Root starting block: " << gets32lsb(oleheader+0x30) << '\n';
        output << "SBD starting block: " << gets32lsb(oleheader+0x3C) << '\n';
//        output << "File contains " << smallfat.fat.size() << " small blocks and " << bigfat.fat.size() << " big blocks\n";

        //for (unsigned a=0;a<getu32lsb(header+0x2C) && a<109;++a)
        //    Debug::Msg("Start block of bbd #%d: %ld",a,(signed long)gets32lsb(header+0x4C+4*a));

        if (getu32lsb(oleheader+0x2c)>=109)
            output << "Additional big block depots are spread throughout their file, but their position has not been recorded\n";

        root->Dump(output,"OLE root",0);
}

//-----------------------------------------------------------------------------
//
// OLE archive functions
//
//
Docfile::Docfile(Blex::RandomStream &infile)
: data(new Data(infile))
{
}

Docfile::~Docfile()
{
        delete data;
}

/*
        struct ole_header
            {
                uint8_t      signature[8];           //0000 D0 CF 11 E0 A1 B1 1A E1
                uint32_t     unused_1[9];            //0008
                LSBS32  num_of_bbd_blocks;      //002C
                LSBS32  root_startblock;        //0030
                uint32_t     unused_2[2];            //0034
                LSBS32  sbd_startblock;         //003C
                uint32_t     unused_3[3];            //0040
                44: first extended fat block
                48: number of extended fat blocks
                LSBS32  bbd_list[109];          //004C
            };
        struct ole_header OLE_HEADER;
*/
bool Docfile::IsDocfileSignature(const uint8_t sig[])
{
        return getu32lsb(sig) == 0xE011CFD0 && getu32lsb(sig+4) == 0xE11AB1A1;
}

RandomStream* Docfile::OpenOleFile(const File *file)
{
        if (!file)
            throw std::logic_error("Docfile::OpenOleFile: Passing NULL pointer as file argument");

        if (file->entry.size < 0x1000)
            return new DocfileDetail::ShortStream(*data,*file);
        else
            return new DocfileDetail::LongStream(*data,*file);
}


Docfile::Directory const * Docfile::GetRoot () const
{
        return data->root.get();
}

std::ostream& operator<<(std::ostream &str, Blex::Docfile const &arc)
{
        arc.data->DumpOleFile(str);
        return str;
}

StreamOwningDocfile::StreamOwningDocfile(Blex::RandomStream *adopt_infile)
: Docfile(*adopt_infile)
, adoptedfile(adopt_infile)
{

}

StreamOwningDocfile::~StreamOwningDocfile()
{
}

///////////////////////////////////////////////////////////////////////////////
//
// OLE property set parser
OlePropertySet::OlePropertySet()
{
}

OlePropertySet::~OlePropertySet()
{
}

bool OlePropertySet::ParseProperties(Blex::Stream &str)
{
        std::vector<uint8_t> propdata;
        ReadStreamIntoVector(str,&propdata);

        if (propdata.size() < 0x30)
            return false; //not a proper file

        /*
        typedef struct PROPERTYSETHEADER
        {
             // Header
             WORD    wByteOrder      // 0x00: Always 0xFFFE
             WORD    wFormat;        // 0x02: Always 0
             DWORD   dwOSVer;        // 0x04: System version
             CLSID   clsid;          // 0x08: Application CLSID
             DWORD   dwReserved;     // 0x18: Should be 1 (Actually, this appears to be the # of sections
        } PROPERTYSETHEADER;
        */
        is_little_endian = Blex::getu16lsb(&propdata[0]) == 0xFFFE;
        if (!is_little_endian && Blex::getu16msb(&propdata[0]) != 0xFFFE)
            return false; //not a proper file (invalid property set indicator)

        if (Blex::getu16lsb(&propdata[2]) != 0)
            return false; //unrecognized format

        unsigned numsections = Blex::getu32lsb(&propdata[0x18]);
        if (0x1C + (numsections * (16+4)) > propdata.size())
            return false; //not a proper file (not enough headers for the specified # of sections)

        //Analyze the sections
        sections.resize(numsections);
        for (unsigned i=0;i<sections.size();++i)
        {
                unsigned start_section_info = 0x1C + i * (16+4);
                memcpy(sections[i].format_id, &propdata[start_section_info], 16);
                if (!is_little_endian)
                    std::reverse(sections[i].format_id, sections[i].format_id+16);

                sections[i].startoffset = MyGet<uint32_t>(&propdata[start_section_info + 16]);
        }

        //And start loading them
        for (unsigned i=0;i<sections.size();++i)
        {
                unsigned sectstart = sections[i].startoffset;
                unsigned sectlimit = i==sections.size()-1 ? propdata.size() : sections[i+1].startoffset;
                if(sectlimit > propdata.size() || sectlimit < sectstart)
                    return false; //out of bound

                if (!ParseSection(&sections[i], &propdata[sectstart], sectlimit-sectstart))
                    return false; //load error
        }
        return true;
}

/*
 * VARENUM usage key,
 *
 * * [V] - may appear in a VARIANT
 * * [T] - may appear in a TYPEDESC
 * * [P] - may appear in an OLE property set
 * * [S] - may appear in a Safe Array
 *
 *
 *  VT_EMPTY            [V]   [P]     nothing
 *  VT_NULL             [V]   [P]     SQL style Null
 *  VT_I2               [V][T][P][S]  2 byte signed int
 *  VT_I4               [V][T][P][S]  4 byte signed int
 *  VT_R4               [V][T][P][S]  4 byte real
 *  VT_R8               [V][T][P][S]  8 byte real
 *  VT_CY               [V][T][P][S]  currency
 *  VT_DATE             [V][T][P][S]  date
 *  VT_BSTR             [V][T][P][S]  OLE Automation string
 *  VT_DISPATCH         [V][T]   [S]  IDispatch *
 *  VT_ERROR            [V][T][P][S]  SCODE
 *  VT_BOOL             [V][T][P][S]  True=-1, False=0
 *  VT_VARIANT          [V][T][P][S]  VARIANT *
 *  VT_UNKNOWN          [V][T]   [S]  IUnknown *
 *  VT_DECIMAL          [V][T]   [S]  16 byte fixed point
 *  VT_RECORD           [V]   [P][S]  user defined type
 *  VT_I1               [V][T][P][s]  signed char
 *  VT_UI1              [V][T][P][S]  unsigned char
 *  VT_UI2              [V][T][P][S]  unsigned short
 *  VT_UI4              [V][T][P][S]  unsigned long
 *  VT_I8                  [T][P]     signed 64-bit int
 *  VT_UI8                 [T][P]     unsigned 64-bit int
 *  VT_INT              [V][T][P][S]  signed machine int
 *  VT_UINT             [V][T]   [S]  unsigned machine int
 *  VT_VOID                [T]        C style void
 *  VT_HRESULT             [T]        Standard return type
 *  VT_PTR                 [T]        pointer type
 *  VT_SAFEARRAY           [T]        (use VT_ARRAY in VARIANT)
 *  VT_CARRAY              [T]        C style array
 *  VT_USERDEFINED         [T]        user defined type
 *  VT_LPSTR               [T][P]     null terminated string
 *  VT_LPWSTR              [T][P]     wide null terminated string
 *  VT_FILETIME               [P]     FILETIME
 *  VT_BLOB                   [P]     Length prefixed bytes
 *  VT_STREAM                 [P]     Name of the stream follows
 *  VT_STORAGE                [P]     Name of the storage follows
 *  VT_STREAMED_OBJECT        [P]     Stream contains an object
 *  VT_STORED_OBJECT          [P]     Storage contains an object
 *  VT_VERSIONED_STREAM       [P]     Stream with a GUID version
 *  VT_BLOB_OBJECT            [P]     Blob contains an object
 *  VT_CF                     [P]     Clipboard format
 *  VT_CLSID                  [P]     A Class ID
 *  VT_VECTOR                 [P]     simple counted array
 *  VT_ARRAY            [V]           SAFEARRAY*
 *  VT_BYREF            [V]           void* for local use
 *  VT_BSTR_BLOB                      Reserved for system use
 */

enum VARENUM
{       VT_EMPTY        = 0,
        VT_NULL = 1,
        VT_I2   = 2,
        VT_I4   = 3,
        VT_R4   = 4,
        VT_R8   = 5,
        VT_CY   = 6,
        VT_DATE = 7,
        VT_BSTR = 8,
        VT_DISPATCH     = 9,
        VT_ERROR        = 10,
        VT_BOOL = 11,
        VT_VARIANT      = 12,
        VT_UNKNOWN      = 13,
        VT_DECIMAL      = 14,
        VT_I1   = 16,
        VT_UI1  = 17,
        VT_UI2  = 18,
        VT_UI4  = 19,
        VT_I8   = 20,
        VT_UI8  = 21,
        VT_INT  = 22,
        VT_UINT = 23,
        VT_VOID = 24,
        VT_HRESULT      = 25,
        VT_PTR  = 26,
        VT_SAFEARRAY    = 27,
        VT_CARRAY       = 28,
        VT_USERDEFINED  = 29,
        VT_LPSTR        = 30,
        VT_LPWSTR       = 31,
        VT_RECORD       = 36,
        VT_FILETIME     = 64,
        VT_BLOB = 65,
        VT_STREAM       = 66,
        VT_STORAGE      = 67,
        VT_STREAMED_OBJECT      = 68,
        VT_STORED_OBJECT        = 69,
        VT_BLOB_OBJECT  = 70,
        VT_CF   = 71,
        VT_CLSID        = 72,
        VT_VERSIONED_STREAM     = 73,
        VT_BSTR_BLOB    = 0xfff,
        VT_VECTOR       = 0x1000,
        VT_ARRAY        = 0x2000,
        VT_BYREF        = 0x4000,
        VT_RESERVED     = 0x8000,
        VT_ILLEGAL      = 0xffff,
        VT_ILLEGALMASKED        = 0xfff,
        VT_TYPEMASK     = 0xfff
};

/*first=storeid, second=len*/
std::pair<unsigned, unsigned> OlePropertySet::ParseSingleProperty(uint16_t codepage, uint32_t proptype, uint8_t const *data, unsigned len)
{
        if (proptype & VT_VECTOR)
        {
                if (len<4) return std::make_pair(0,0);
                unsigned numelements = MyGet<uint32_t>(data);
                unsigned bytesparsed = 4;

                std::vector<unsigned> array_propids;
                array_propids.reserve(numelements);
                while(numelements && bytesparsed<len)
                {
                        /*re-align to a 32-bit boundary
                        while(len>0 && (data%4) != 0)
                            --len,++data;*/

                        std::pair<unsigned, unsigned> elementparse;
                        elementparse = ParseSingleProperty(codepage,proptype & VT_TYPEMASK, data+bytesparsed, len-bytesparsed);
                        if (elementparse.second==0)
                            return std::make_pair(0,0); //parse failure

                        //insert into our array
                        array_propids.push_back(elementparse.first); //store storeid of new element
                        if (bytesparsed + elementparse.second > len)
                            return std::make_pair(0,0); //parse failure

                        bytesparsed += elementparse.second;
                        --numelements;
                }
                if (numelements>0) //elements left
                    return std::make_pair(0,0); //parse failure

                return std::make_pair(AddArray(array_propids),bytesparsed);
        }

        uint32_t subsize;
        switch(proptype)
        {
        case VT_I2:
                if (len<2) return std::make_pair(0,0);
                return std::make_pair(AddSigInteger(MyGet<int16_t>(data)),2);
        case VT_I4:
                if (len<4) return std::make_pair(0,0);
                return std::make_pair(AddSigInteger(MyGet<int32_t>(data)),4);
        case VT_I8:
                if (len<8) return std::make_pair(0,0);
                return std::make_pair(AddSigInteger(MyGet<int64_t>(data)),8);
        case VT_UI1:
                if (len<1) return std::make_pair(0,0);
                return std::make_pair(AddUnsInteger(MyGet<uint8_t>(data)),1);
        case VT_BOOL:
        case VT_UI2:
                if (len<2) return std::make_pair(0,0);
                return std::make_pair(AddUnsInteger(MyGet<uint16_t>(data)),2);
        case VT_UI4:
        case VT_ERROR:
                if (len<4) return std::make_pair(0,0);
                return std::make_pair(AddUnsInteger(MyGet<uint32_t>(data)),4);
        case VT_UI8:
                if (len<8) return std::make_pair(0,0);
                return std::make_pair(AddUnsInteger(MyGet<uint64_t>(data)),8);
        /* case VT_R4: //FIXME - need a F32 reader */
        case VT_R8:
                if (len<8) return std::make_pair(0,0);
                return std::make_pair(AddFloat(MyGet<F64>(data)),8);
        case VT_CY:
                if (len<8) return std::make_pair(0,0);
                return std::make_pair(AddFloat(MyGet<int64_t>(data) / 10000.0),8);
        case VT_DATE:
                if (len<8) return std::make_pair(0,0);
                return std::make_pair(AddDateTime(DateTime(MyGet<F64>(data) + 693595 /*31-dec-1899*/,0)),8);
        case VT_BSTR:
        case VT_LPSTR:
                if (len<4) return std::make_pair(0,0);
                subsize = MyGet<uint32_t>(data);
                if (subsize < 1 || len<4+subsize) return std::make_pair(0,0);
                return std::make_pair(AddString(codepage,data+4,subsize), subsize+4);
        case VT_LPWSTR:
                if (len<4) return std::make_pair(0,0);
                subsize = MyGet<uint32_t>(data);
                if (subsize < 1 || len<4+subsize*2) return std::make_pair(0,0);
                return std::make_pair(AddUCS16String(data+4,subsize), subsize*2+4);
        case VT_FILETIME:
                if (len<8) return std::make_pair(0,0);
                return std::make_pair(AddFileTime(data),8);
        case VT_BLOB:
                if (len<4) return std::make_pair(0,0);
                subsize = MyGet<uint32_t>(data);
                if (len<4+subsize) return std::make_pair(0,0);
                return std::make_pair(AddRawData(data+4,subsize),subsize+4);
        case VT_VARIANT:
                if (len<4) return std::make_pair(0,0);
                {
                        std::pair<unsigned,unsigned> retval;
                        retval = ParseSingleProperty(codepage,MyGet<uint32_t>(data), data+4, len-4);
                        if (retval.second != 0) //add space for the Variant type id
                            retval.second += 4;
                        return retval;
                }
        default:
                DEBUGPRINT("Uninterpreted property " << proptype);
                return std::make_pair(0,0);
        }
}

unsigned OlePropertySet::ParseProperty(uint16_t codepage,uint8_t const *data, unsigned len)
{
        uint32_t proptype = MyGet<uint32_t>(data);

        std::pair<unsigned,unsigned> parseresult = ParseSingleProperty(codepage,proptype,data+4,len-4);
        if (parseresult.first == 0) //nothing parsed!
            return 0; //abort the parse
        else
            return parseresult.first;
}

void OlePropertySet::ParseDictionary(uint16_t codepage, Section *sect, uint8_t const *data, unsigned len)
{
        unsigned numentries = Blex::GetLsb<uint32_t>(data);
        unsigned pos=4;
        while(numentries && pos+8<len)
        {
                unsigned propid = Blex::GetLsb<uint32_t>(data+pos);
                unsigned cb = Blex::GetLsb<uint32_t>(data+pos+4);
                if(pos+8+cb > len)
                    break;
                if(len<=1)
                    continue;

                std::string propname;

                //ADDME: Support other codepages
                if (codepage == 65001) //UTF-8 codepage
                    propname.assign(data+pos+8, data+pos+8+cb-1);
                else //assume Latin-1 codepage, recode into UTF-8
                    Blex::UTF8Encode(data+pos+8, data+pos+8+cb-1, std::back_inserter(propname));

                sect->dictionary.insert(std::make_pair(propid, propname));
                pos += 8 + cb;
                --numentries;
        }
}

bool OlePropertySet::ParseSection(Section *sect, uint8_t const *data, unsigned len)
{
        /* typedef struct tagPROPERTYSECTIONHEADER
        {
            DWORD              cbSection ;         // Size of section
            DWORD              cProperties ;      // Count of properties in section
            PROPERTYIDOFFSET   rgPropIDOffset[];    // Array of property locations
        } PROPERTYSECTIONHEADER
        typedef struct PROPERTYIDOFFSET
        {
            DWORD        propid;     // name of a property
            DWORD        dwOffset;   // offset from the start of the section to that
                                     // property type/value pair
        } PROPERTYIDOFFSET;
        */

        if (len < 8) //incorrect header
            return false;
        if (((std::size_t)data%4) != 0)
            throw DocfileException("ParseSection incorrectly aligned");

        unsigned reallen = MyGet<uint32_t>(data);
        if (reallen > len)
            return false;
        len = reallen;

        unsigned numprops = MyGet<uint32_t>(data+4);
        if (len < 8 + numprops*8) //incomplete PROPERTYSECTIONHEADER
            return false;

        uint16_t codepage=0;
        //Store the individual properties
        for (unsigned i=0;i<numprops;++i)
        {
                uint32_t id = MyGet<uint32_t>(data + 8 + i*8);
                uint32_t offset = MyGet<uint32_t>(data + 12 + i*8);

                if (offset+4 > len)
                    return false; //corrupt property..

                if(id==0)
                {
                        ParseDictionary(codepage, sect, data+offset, len-offset); //FIXME: Cannot interpret this before interpreting 'codepage' !
                        continue;
                }

                unsigned propvalue = ParseProperty(codepage,data+offset,len-offset);
                if (propvalue != 0)
                    sect->props[id]=propvalue;

                if (id==1) //got a codepage!
                    codepage = uint16_t(GetSigInteger(propvalue));
        }
        return true;
}

unsigned OlePropertySet::AddUnsInteger(uint64_t value)
{
        variants.push_back(Variant());
        variants.back().type=V_UnsignedInteger;
        variants.back().data.val_integer=value;
        return variants.size();
}

unsigned OlePropertySet::AddSigInteger(int64_t value)
{
        variants.push_back(Variant());
        variants.back().type=V_SignedInteger;
        variants.back().data.val_integer=uint64_t(value);
        return variants.size();
}

unsigned OlePropertySet::AddFloat(F64 value)
{
        variants.push_back(Variant());
        variants.back().type=V_Float;
        variants.back().data.val_float=uint64_t(value);
        return variants.size();
}

unsigned OlePropertySet::AddDateTime(Blex::DateTime value)
{
        variants.push_back(Variant());
        variants.back().type=V_DateTime;
        variants.back().data_time=value;
        return variants.size();
}

unsigned OlePropertySet::AddString(uint16_t codepage, void const *firstbyte, unsigned len)
{
        DEBUGPRINT("AddString cp " << codepage << " fb " <<  firstbyte << " len " << len);
        const uint8_t *ptr = static_cast<const uint8_t*>(firstbyte);

        variants.push_back(Variant());
        variants.back().type=V_String;
        variants.back().data.sptr.pos = extrastore.size();

        //ADDME: Support other codepages
        if (codepage == 65001) //UTF-8 codepage
            extrastore.insert(extrastore.end(),ptr,ptr+len);
        else //assume Latin-1 codepage, recode into UTF-8
            Blex::UTF8Encode(ptr, ptr+len, std::back_inserter(extrastore));

        variants.back().data.sptr.len = extrastore.size() - variants.back().data.sptr.pos;

        //remove null termination (it may be multibyte)
        while(variants.back().data.sptr.len > 0 && extrastore[variants.back().data.sptr.pos + variants.back().data.sptr.len - 1] == 0)
            --variants.back().data.sptr.len;

        return variants.size();
}

unsigned OlePropertySet::AddUCS16String(void const *firstbyte, unsigned len)
{
        const char *ptr = static_cast<const char*>(firstbyte);

        variants.push_back(Variant());
        variants.back().type=V_String;
        variants.back().data.sptr.pos = extrastore.size();

        UTF8Encoder<std::back_insert_iterator<std::vector<char> > > myencoder(std::back_inserter(extrastore));
        for (unsigned i=0;i<len;++i)
            myencoder(MyGet<uint16_t>(ptr+i*2));

        variants.back().data.sptr.len = extrastore.size() - variants.back().data.sptr.pos;

        //remove null termination (it may be multibyte)
        while(variants.back().data.sptr.len > 0 && extrastore[variants.back().data.sptr.pos + variants.back().data.sptr.len - 1] == 0)
            --variants.back().data.sptr.len;

        return variants.size();
}

unsigned OlePropertySet::AddRawData(void const *firstbyte, unsigned len)
{
        const uint8_t *ptr = static_cast<const uint8_t*>(firstbyte);

        variants.push_back(Variant());
        variants.back().type=V_String;
        variants.back().data.sptr.pos = extrastore.size();
        variants.back().data.sptr.len = len;
        extrastore.insert(extrastore.end(), ptr, ptr+len);
        return variants.size();
}

//stolen from blex/lib/path.cpp..
unsigned OlePropertySet::AddFileTime(void const *filetime)
{
        /* A MyGet<uint64_t> would have worked, but BCB completely screws up code generation */
        uint64_t thetime = is_little_endian ? Blex::getu64lsb(filetime) : Blex::getu64msb(filetime);

        if ( (thetime/10000000L) >= BIGU64NUM(11644473600))
        {
                std::time_t unixtime = static_cast<std::time_t>((thetime/10000000L) - BIGU64NUM(11644473600));
                return AddDateTime(Blex::DateTime::FromTimeT(unixtime));
        }
        else
        {
                return AddDateTime(Blex::DateTime(0,0));
        }
}

unsigned OlePropertySet::AddArray(std::vector<unsigned> const &propids)
{
        variants.push_back(Variant());
        variants.back().type=V_Array;
        variants.back().data.sptr.pos = arraystore.size();
        variants.back().data.sptr.len = propids.size();
        arraystore.insert(arraystore.end(), propids.begin(), propids.end());
        return variants.size();
}

OlePropertySet::Type OlePropertySet::GetType(unsigned storeid) const
{
        if (storeid<1 || storeid>variants.size())
            throw std::domain_error("storeid out of range");
        return variants[storeid-1].type;
}

/** Get the int64_t value of a store */
int64_t OlePropertySet::GetSigInteger(unsigned storeid) const
{
        if (GetType(storeid) != V_SignedInteger) return -1;
        return int64_t(variants[storeid-1].data.val_integer);
}

/** Get the uint64_t value of a store */
uint64_t OlePropertySet::GetUnsInteger(unsigned storeid) const
{
        if (GetType(storeid) != V_UnsignedInteger) return -1;
        return variants[storeid-1].data.val_integer;
}

/** Get the floating point value of a store */
F64 OlePropertySet::GetFloat(unsigned storeid) const
{
        if (GetType(storeid) != V_Float) return -1;
        return variants[storeid-1].data.val_float;
}

/** Get the datetime value of a store */
Blex::DateTime OlePropertySet::GetDateTime(unsigned storeid) const
{
        if (GetType(storeid) != V_DateTime) return Blex::DateTime(0,0);
        return variants[storeid-1].data_time;
}

/** Get the string value of a store */
std::string OlePropertySet::GetString(unsigned storeid) const
{
        if (GetType(storeid) != V_String) return std::string();
        Variant::Data const &value = variants[storeid-1].data;
        return std::string(extrastore.begin() + value.sptr.pos,
                           extrastore.begin() + value.sptr.pos + value.sptr.len);
}

unsigned OlePropertySet::GetArrayLength(unsigned storeid) const
{
        if (GetType(storeid) != V_Array) return 0;
        Variant::Data const &value = variants[storeid-1].data;
        return value.sptr.len;
}

unsigned OlePropertySet::GetArrayElement(unsigned storeid, unsigned which) const
{
        if (GetType(storeid) != V_Array) return 0;
        Variant::Data const &value = variants[storeid-1].data;
        if (which >= value.sptr.len) return 0;
        return arraystore[value.sptr.pos + which];
}

int OlePropertySet::FindSectionByFormatId(uint8_t const *format_id) const
{
        for (unsigned i=0;i<sections.size();++i)
          if (std::equal(sections[i].format_id, sections[i].format_id+16, format_id))
            return i;

        return -1;
}

unsigned OlePropertySet::Section::FindPropertyByName(std::string const &name) const
{
        //ADDME probably need to swap first/second in dictionary
        for(Dictionary::const_iterator itr = dictionary.begin(); itr != dictionary.end(); ++itr)
          if(itr->second == name)
            return FindProperty(itr->first);
        return 0;
}

unsigned OlePropertySet::Section::FindProperty(unsigned id) const
{
        PropertyMap::const_iterator prop;
        prop = props.find(id);
        return prop != props.end() ? prop->second : 0;
}

} //end of namespace ::Blex

