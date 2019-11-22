#include <blex/blexlib.h>


#include "parityfile.h"

namespace Blex
{

//Random bytes, which we hope are uncommon enough to be a safe block marker
static const uint8_t parityblockstart[8] = { 0xF4, 0xB1, 0x2C, 0x67, 0xFA, 0x0E, 0xA3, 0xBC };
static const unsigned Version = 1;
static const unsigned HeaderBytes = 24;
static const unsigned ChecksumBytes = sizeof(uint32_t); //CRC-32
static const unsigned FooterBytes = ChecksumBytes+2; //First the number of bytes used in sector...
static const unsigned SectorOverhead = HeaderBytes + FooterBytes;

/* A parityfile consists of segments, segments consist of data and parity blocks, blocks consist of sectors

   File: <segment> <segment...>
   Segment: <datablock> <datablock....> <parityblock>
   Block: <sector> <sector...>

   Sector format: <header> <data> <footer>
   <header>: BlockHeader
   <footer>: <bytes_used:uint16_t> <crc:uint32_t>
   if bytes_used == 0xFFFF, this is not the final block
   if bytes_used < 0xFFFF, only that amount of data bytes of this block are part of the file, and this is the final block

   Sectors are combined in blocks to create distance between sectors participating in a parity stripe
   (every first sector of each block in a semgent is a stripe, every second sector, etc...)
   large block sizes decrease the chance of a data hole hitting two sectors in the same stripe
*/

struct BlockHeader
{
        /*  0: header */
        /*  8: */ uint16_t sectorsize;
        /* 10: */ uint8_t blocksize;
        /* 11: */ uint8_t datablocks;
        /* 12: */ uint8_t parityblocks;
        /* 13: */ uint8_t block;
        /* 14: */ uint16_t sector;
        /* 16: */ uint16_t segment;
        /* 18: */ uint16_t file;
        /* 20: */ uint16_t version;
        /* 22: */ uint16_t segmentsperfile;
        /* 24: data */

        void HeaderToBuffer(uint8_t *buffer);
        bool HeaderFromBuffer(uint8_t const *buffer);
};

void BlockHeader::HeaderToBuffer(uint8_t *blockstart)
{
        memcpy(blockstart, parityblockstart, 8);
        Blex::putu16lsb(&blockstart[8], sectorsize);
        Blex::putu8(&blockstart[10], blocksize);
        Blex::putu8(&blockstart[11], datablocks);
        Blex::putu8(&blockstart[12], parityblocks);
        Blex::putu8(&blockstart[13], block);
        Blex::putu16lsb(&blockstart[14], sector);
        Blex::putu16lsb(&blockstart[16], segment);
        Blex::putu16lsb(&blockstart[18], file);
        Blex::putu16lsb(&blockstart[20], version);
        Blex::putu16lsb(&blockstart[22], segmentsperfile);
}
bool BlockHeader::HeaderFromBuffer(uint8_t const *blockstart)
{
        if(!std::equal(parityblockstart, parityblockstart + sizeof(parityblockstart), blockstart))
            return false;

        sectorsize = Blex::getu16lsb(&blockstart[8]);
        blocksize = Blex::getu8(&blockstart[10]);
        datablocks = Blex::getu8(&blockstart[11]);
        parityblocks = Blex::getu8(&blockstart[12]);
        block = Blex::getu8(&blockstart[13]);
        sector = Blex::getu16lsb(&blockstart[14]);
        segment = Blex::getu16lsb(&blockstart[16]);
        file = Blex::getu16lsb(&blockstart[18]);
        version = Blex::getu16lsb(&blockstart[20]);
        segmentsperfile = Blex::getu16lsb(&blockstart[22]);

        return true;
}

ParityFile::ParityFile()
: Stream(false)
, curfile(0)
, writefailed(false)
, totalinbytes(0)
{
}

ParityFile::~ParityFile()
{
}

inline unsigned ParityFile::BlockBytes() const
{
        return sectorsize*blocksize;
}
inline unsigned ParityFile::BlocksPerSegment() const
{
        return datablocks+parityblocks;
}
inline unsigned ParityFile::SegmentBytes() const
{
        return BlockBytes() * BlocksPerSegment();
}
inline unsigned ParityFile::CalcSegmentOffset(unsigned byte, unsigned sector, unsigned block) const
{
        return block*BlockBytes() + sector * sectorsize + byte;
}
inline unsigned ParityFile::GetSegmentOffset() const
{
        return CalcSegmentOffset(curbyte,cursector,curblock);
}
inline unsigned ParityFile::GetBytesInCurrentSector() const
{
        uint16_t lenval = Blex::getu16lsb(&segmentbuffer[CalcSegmentOffset(sectorsize - FooterBytes,cursector,curblock)]);
        if(lenval == 0xFFFF)
            return sectorsize - SectorOverhead;
        else
            return lenval;
}
inline bool ParityFile::IsEOFBlock() const
{
        uint16_t lenval = Blex::getu16lsb(&segmentbuffer[CalcSegmentOffset(sectorsize - FooterBytes,cursector,curblock)]);
        return lenval != 0xFFFF;
}

void ParityFile::MoveToNextSectorRead()
{
        if (IsEOFBlock())
        {
                curstream.reset();
                return;
        }

        curbyte=0;
        if(++cursector==blocksize)
        {
                cursector=0;
                if(++curblock==datablocks)
                {
                        curblock=0;
                        if(++cursegment == segmentsperfile)
                            OpenNextFile();
                        if(curstream.get())
                            ReadSegmentFromDisk();
                }
        }
        curbyte = HeaderBytes;
}

void ParityFile::FinishSectorWrite(bool is_eof)
{
        unsigned bytes_in_block = curbyte - HeaderBytes;
        if(curbyte < sectorsize - FooterBytes)
        {
                assert(is_eof);

                //Zero out any remaining bytes
                unsigned topad = sectorsize - FooterBytes - curbyte;
                memset(&segmentbuffer[GetSegmentOffset()], 0, topad);
                sector_crc.Do(&segmentbuffer[GetSegmentOffset()], topad);
                curbyte += topad;
        }

        //Write number of real bytes used
        Blex::putu16lsb(&segmentbuffer[GetSegmentOffset()], is_eof ? (uint16_t)bytes_in_block : (uint16_t)0xFFFF);
        sector_crc.Do(&segmentbuffer[GetSegmentOffset()], sizeof(uint16_t));
        curbyte+=2;

        //And write the final CRC!
        Blex::putu32lsb(&segmentbuffer[GetSegmentOffset()], sector_crc.GetValue());

        curbyte=0;
        if (++cursector == blocksize)
        {
                cursector=0;
                if(++curblock == datablocks)
                {
                        //Create the parity blocks
                        while(curblock < BlocksPerSegment())
                            GenerateParityBlock();

                        curblock=0;
                        WriteSegmentToDisk();
                        ++cursegment;
                }
        }
}

void ParityFile::GenerateHeader(unsigned sector, unsigned block, unsigned segment, unsigned file)
{
        BlockHeader hdr;
        hdr.sectorsize = (uint16_t)sectorsize;
        hdr.blocksize = (uint8_t)blocksize;
        hdr.datablocks = (uint8_t)datablocks;
        hdr.parityblocks = (uint8_t)parityblocks;
        hdr.block = (uint8_t)block;
        hdr.sector = (uint16_t)sector;
        hdr.segment = (uint16_t)segment;
        hdr.file = (uint16_t)file;
        hdr.version = (uint16_t)Version;
        hdr.segmentsperfile = (uint16_t)segmentsperfile;

        uint8_t *blockstart = &segmentbuffer[CalcSegmentOffset(0,sector,block)];
        hdr.HeaderToBuffer(blockstart);
        sector_crc.Do(&blockstart[0], HeaderBytes);
}

void ParityFile::GenerateParityBlock()
{
        DEBUGPRINT("parity block");
        //Copy the first block to the parity block (datablocks is the block# of the parity block too)
        memcpy(&segmentbuffer[CalcSegmentOffset(0,0,curblock)]
              ,&segmentbuffer[CalcSegmentOffset(0,0,0)]
              ,BlockBytes());

        //XOR the other blocks for proper parity
        for(unsigned block=1;block<datablocks;++block)
        {
                uint8_t const *readptr = &segmentbuffer[CalcSegmentOffset(HeaderBytes,0,block)];
                uint8_t *xorptr = &segmentbuffer[CalcSegmentOffset(HeaderBytes,0,curblock)];
                unsigned numbytes = BlockBytes() - HeaderBytes;

                while(--numbytes>0)
                   *xorptr++ ^= *readptr++;
        }

        //Create the headers and CRCs for the parity block
        for(unsigned i=0;i<blocksize;++i)
        {
                sector_crc = Crc32();
                GenerateHeader(i, curblock, cursegment, curfile); //this function already CRCs the header
                sector_crc.Do(&segmentbuffer[CalcSegmentOffset(HeaderBytes,i,curblock)], sectorsize - ChecksumBytes - HeaderBytes);

                uint8_t *crcloc = &segmentbuffer[CalcSegmentOffset(sectorsize - ChecksumBytes,i,curblock)];
                Blex::putu32lsb(crcloc, sector_crc.GetValue());
        }
        ++curblock;
}

void ParityFile::ReadSegmentFromDisk()
{
        //Read the next data block
        if (curstream->Read(&segmentbuffer[0], segmentbuffer.size()) != segmentbuffer.size())
            throw std::runtime_error("I/O error on segment"); //FIXME: Explain _which_ segment. ADDME: Read as much as possible from the broken segment (perhaps we only lost parity?)
        ValidateSegment();
}

void ParityFile::WriteSegmentToDisk()
{
        if(!curstream.get() || writefailed)
            return;

        if (curstream->Write(&segmentbuffer[0],SegmentBytes())!=SegmentBytes())
        {
                writefailed=true;
                throw std::runtime_error("Cannot write segment to disk (disk full?)");
        }
        else if (md5hash)
            md5_sofar.Process(&segmentbuffer[0],SegmentBytes());
}

void ParityFile::InitNextWriteSector()
{
        assert(curbyte==0 || curbyte==sectorsize - FooterBytes);

        if(curbyte>0) //We already wrote data to this file. Must finish that first
            FinishSectorWrite(false);

        //Open new file if needed
        if(cursegment == segmentsperfile)
        {
                if (!OpenNextFile())
                    throw std::runtime_error("Cannot create next parity file");
        }

        //Prepare the new sector
        sector_crc = Crc32();
        GenerateHeader(cursector, curblock, cursegment, curfile);
        curbyte = HeaderBytes;
}

std::size_t ParityFile::Read(void *buf,std::size_t maxbufsize)
{
        std::size_t read=0;
        while(maxbufsize>0 && curstream.get())
        {
                //Anything left to read from this sector ?
                unsigned sectorlimit = GetBytesInCurrentSector() + HeaderBytes;
                unsigned canread = (unsigned)std::min<std::size_t>(maxbufsize, sectorlimit - curbyte);

                if(canread>0)
                {
                        memcpy(buf, &segmentbuffer[GetSegmentOffset()], canread);
                        curbyte += canread;
                        read += canread;
                        buf = static_cast<char *>(buf) + canread;
                        maxbufsize -= canread;
                }

                //That was it?
                if(maxbufsize==0)
                    break;

                if(curbyte == sectorlimit) //reached end of sector
                    MoveToNextSectorRead();
        }
        totalinbytes += read;
        return read;
}
bool ParityFile::EndOfStream()
{
        return curstream.get() == NULL;
}
std::size_t ParityFile::Write(void const *buf, std::size_t bufsize)
{
        std::size_t written = 0;
        while(bufsize>0 && !writefailed && writing)
        {
                if(curbyte == sectorsize - FooterBytes)
                    FinishSectorWrite(false);
                if(curbyte==0) //init header first?
                    InitNextWriteSector();

                //Anything left to write to this sector ?
                unsigned canwrite = (unsigned)std::min<std::size_t>(sectorsize - curbyte - FooterBytes, bufsize);
                if(canwrite>0)
                {
                        memcpy(&segmentbuffer[GetSegmentOffset()], buf, canwrite);
                        sector_crc.Do(buf,canwrite);
                        curbyte += canwrite;
                        written += canwrite;
                        buf = static_cast<char const*>(buf) + canwrite;
                        bufsize -= canwrite;
                }

                //That was it?
                if(bufsize==0)
                    break;
        }
        totalinbytes += written;
        return written;
}

bool ParityFile::Finalize()
{
        if(!writing)
            return false;

        while(!writefailed && (curbyte>0 || cursector!=0 || curblock!=0)) //There is pending data
        {
                if(curbyte==0)
                    InitNextWriteSector();
                FinishSectorWrite(true);
        }
        if(curstream.get())
            FinalizeFile();

        if (md5hash && !writefailed)
        {
                //Write the MD5 hash file, but only if write hasn't failed until now
                std::unique_ptr<Blex::Stream> md5file(Blex::FileStream::OpenWrite(path+".md5", true, true, filemode));
                if(!md5file.get() || md5file->Write(&md5_digests[0], md5_digests.size()) != md5_digests.size())
                {
                        throw std::runtime_error("Error writing md5 file to disk (disk full?)");
                        writefailed=true;
                }
        }

        return !writefailed;
}

ParityFile* ParityFile::OpenRead(std::string const &path, ErrorCallback const &onerror)
{
        std::unique_ptr<ParityFile> retval(new ParityFile);
        retval->writing = false;
        retval->onerror = onerror;
        retval->path = path;

        /* Open the file and parse its header first */
        if (!retval->OpenNextFile())
            throw std::runtime_error("Cannot open initial parity file");

        //ADDME: Error recovery when headers are corrupt!
        uint8_t header[HeaderBytes];
        if(retval->curstream->Read(&header, HeaderBytes) != HeaderBytes)
            throw std::runtime_error("Cannot read the parity file header");

        //ADDME: Verify header stats with other headers, the the block with the most plausible values!
        BlockHeader hdr;
        if (!hdr.HeaderFromBuffer(header))
            throw std::runtime_error("Parity file header has an incorrect header");

        retval->sectorsize = hdr.sectorsize;
        retval->blocksize = hdr.blocksize;
        retval->datablocks = hdr.datablocks;
        retval->parityblocks = hdr.parityblocks;
        retval->segmentsperfile = hdr.segmentsperfile;

        //Now read the remainder of the first buffer
        retval->segmentbuffer.resize(retval->sectorsize * retval->blocksize * (retval->datablocks + retval->parityblocks));
        if(retval->segmentbuffer.size() <= HeaderBytes)
            throw std::runtime_error("Parity file first header is corrupted or truncated");

        memcpy(&retval->segmentbuffer[0], header, HeaderBytes);
        if (retval->curstream->Read(&retval->segmentbuffer[HeaderBytes], retval->segmentbuffer.size() - HeaderBytes) != retval->segmentbuffer.size() - HeaderBytes)
            throw std::runtime_error("I/O error on first segment");

        retval->ValidateSegment();
        retval->curbyte = HeaderBytes;
        return retval.release();
}

void ParityFile::ValidateSegment()
{
        BlockHeader hdr;
        std::vector< std::vector<bool> > isvalid(datablocks + parityblocks, std::vector<bool>(blocksize, false) );

        for(unsigned block=0; block < datablocks + parityblocks; ++block) //for all datablocks
        {
                for(unsigned sector=0; sector<blocksize; ++sector) //for all sectors in this block
                {
                        uint8_t const *blockstart = &segmentbuffer[CalcSegmentOffset(0,sector,block)];

                        //Validate the CRC for this block
                        if(Crc32::CrcBuffer(blockstart, sectorsize - ChecksumBytes) != Blex::getu32lsb(blockstart + (sectorsize - ChecksumBytes)))
                        {
                                AddError(sector, block, cursegment, curfile, "CRC error");
                                continue;
                        }

                        //Validate this block's internal consistency
                        if (!hdr.HeaderFromBuffer(blockstart))
                        {
                                AddError(sector, block, cursegment, curfile, "Invalid header (cannot read signature)");
                                continue;
                        }

                        //Validate the header's format values
                        if(hdr.sectorsize != (uint16_t)sectorsize || hdr.blocksize!=(uint8_t)blocksize || hdr.datablocks != (uint8_t)datablocks || hdr.parityblocks != (uint8_t)parityblocks || hdr.segmentsperfile != (uint16_t)segmentsperfile)
                        {
                                AddError(sector, block, cursegment, curfile, "Invalid header (constants are incorrect)");
                                continue;
                        }
                        if(hdr.block != (uint8_t)block)
                        {
                                AddError(sector, block, cursegment, curfile, "Invalid header (position information is incorrect - block=" + Blex::AnyToString(hdr.block) + ", expected=" + Blex::AnyToString((uint8_t)block) + ")");
                                continue;
                        }
                        if(hdr.sector != (uint16_t)sector)
                        {
                                AddError(sector, block, cursegment, curfile, "Invalid header (position information is incorrect - sector=" + Blex::AnyToString(hdr.sector) + ", expected=" + Blex::AnyToString((uint16_t)sector) + ")");
                                continue;
                        }
                        if(hdr.segment != (uint16_t)cursegment)
                        {
                                AddError(sector, block, cursegment, curfile, "Invalid header (position information is incorrect - segment=" + Blex::AnyToString(hdr.segment) + ", expected=" + Blex::AnyToString((uint16_t)cursegment) + ")");
                                continue;
                        }
                        if(hdr.file != (uint16_t)curfile)
                        {
                                AddError(sector, block, cursegment, curfile, "Invalid header (position information is incorrect - segment=" + Blex::AnyToString(hdr.file) + ", expected=" + Blex::AnyToString((uint16_t)curfile));
                                continue;
                        }
                        isvalid[block][sector]=true;
                }
        }

        // Check the sectors stripe by stripe
        for(unsigned sector=0; sector<blocksize; ++sector) //for all sectors stripes
        {
                unsigned invalid_data(0);
                unsigned invalid_all(0);

                for(unsigned block=0; block < datablocks + parityblocks; ++block) //for all datablocks
                {
                        if(!isvalid[block][sector])
                        {
                                if (block < datablocks)
                                    ++invalid_data;
                                ++invalid_all;
                        }
                }

                // Data not invalid: don't care
                if (invalid_data == 0)
                    continue;

                // With the current parity scheme, we can survive 1 erroneous block, no more.
                if (invalid_all > 1)
                    throw std::runtime_error("Too little information to reconstruct backup file");

                SectorValidityList sectors;
                for(unsigned block=0; block < datablocks + parityblocks; ++block) //for all datablocks
                {
                        uint8_t *sectorstart = &segmentbuffer[CalcSegmentOffset(0,sector,block)];
                        sectors.push_back(std::make_pair(sectorstart, isvalid[block][sector]));
                }

                CorrectErrorsByParity(sectors);
        }
}

void ParityFile::CorrectErrorsByParity(SectorValidityList &sectors)
{
        uint8_t *error_block(0);

        SectorValidityList valid_list;

        for (SectorValidityList::const_iterator it = sectors.begin(); it != sectors.end(); ++it)
        {
                if (!it->second)
                    error_block = it->first;
                else
                    valid_list.push_back(*it);
        }
        if (valid_list.size() != sectors.size() - 1)
            throw std::runtime_error("Too little information to reconstruct backup file");

        SectorValidityList::const_iterator valid_end = valid_list.end();
        SectorValidityList::const_iterator valid_begin = valid_list.begin();
        SectorValidityList::const_iterator valid_it = valid_begin;

        // Go correct!
        for (unsigned byte_idx = 0, byte_end = sectorsize; byte_idx < byte_end; ++byte_idx)
        {
                uint8_t byte = 0;

                for (valid_it = valid_begin; valid_it != valid_end; ++valid_it)
                    byte ^= valid_it->first[byte_idx];

                error_block[byte_idx] = byte;
        }
}

unsigned ParityFile::GetNumFilesWritten()
{
        return writing ? curfile : 0;
}
void ParityFile::AddError(unsigned sector, unsigned block, unsigned segment, unsigned file, std::string const &error)
{
        std::string totalerror = "File #" + AnyToString(file);
        if(block<datablocks)
            totalerror += " data block";
        else
            totalerror += " parity block";
        totalerror += "(" + AnyToString(segment) + "," + AnyToString(block) + "," + AnyToString(sector) + "): " + error;
        onerror(totalerror);
}

ParityFile* ParityFile::OpenWrite
  (std::string const &path, Blex::FilePermissions::AccessFlags filemode, unsigned sectorsize,
   unsigned blocksize, unsigned datablocks, unsigned parityblocks, unsigned segmentsperfile, bool md5hash)
{
        if( sectorsize<=SectorOverhead || blocksize<=0 || datablocks<=0 || segmentsperfile<=0)
            throw std::logic_error("Invalid parity file size constraints (too small)");
        if( sectorsize>=65535 || blocksize>=256 || datablocks>=256 || parityblocks>=256 || (datablocks+parityblocks)>=256 || segmentsperfile>=65536)
            throw std::logic_error("Invalid parity file size constraints (out of bounds)");
        if ( Blex::FileOffset(sectorsize) * blocksize * datablocks * parityblocks * segmentsperfile >= BIGU64NUM(2)*1024*1024*1024) //2GB
            throw std::logic_error("Invalid parity file size constraints (too large)");
        if( parityblocks>1)
            throw std::logic_error("Multpile parity blocks not yet supported");

        std::unique_ptr<ParityFile> retval(new ParityFile);
        retval->path=path;
        retval->filemode=filemode;
        retval->sectorsize = sectorsize;
        retval->blocksize = blocksize;
        retval->datablocks = datablocks;
        retval->parityblocks = parityblocks;
        retval->segmentsperfile = segmentsperfile;
        retval->md5hash = md5hash;
        retval->writing = true;

        retval->segmentbuffer.resize(retval->sectorsize * retval->blocksize * (retval->datablocks + retval->parityblocks));
        if (!retval->OpenNextFile())
            return 0;
        return retval.release();
}

std::string ParityFile::GetFilePathByNumber(unsigned filenum)
{
        std::string filepath = path + ".bk";
        if(filenum>=999)
        {
                filepath += Blex::AnyToString(filenum);
        }
        else
        {
                std::string number("000" + Blex::AnyToString(filenum));
                filepath += std::string(number.end()-3,number.end());
        }
        return filepath;
}

bool ParityFile::OpenNextFile()
{
        if(writefailed)
            return false;

        if(curstream.get() && writing) //flush current file first..
            FinalizeFile();

        std::string filepath = GetFilePathByNumber(curfile);
        curstream.reset(writing ? Blex::FileStream::OpenWrite(filepath, true, true, filemode) : Blex::FileStream::OpenRead(filepath));

        curbyte=0;
        cursector=0;
        curblock=0;
        cursegment=0;
        ++curfile;
        return curstream.get();
}

unsigned ParityFile::GetSectorDataSize() const
{
        return sectorsize - SectorOverhead;
}

void ParityFile::FinalizeFile()
{
        if (md5hash)
        {
                // Transform to hex
                std::string digest;

                uint8_t const *digestu8s = md5_sofar.Finalize();
                Blex::EncodeBase16(digestu8s, digestu8s+16, std::back_inserter(digest));
                Blex::ToLowercase(digest.begin(), digest.end()); //for md5sum compatibility

                md5_digests += digest;
                md5_digests += "  ";
                md5_digests += GetNameFromPath(GetFilePathByNumber(curfile-1));
                md5_digests += "\n";
                md5_sofar = Blex::MD5();
        }
        if(!curstream->OSFlush())
        {
                writefailed=true;
                throw std::runtime_error("I/O error flushing data to disk");
        }
        curstream.reset();
}

Blex::FileOffset ParityFile::GetTotalInputBytes() const
{
        return totalinbytes;
}

} //end namespace Blex
