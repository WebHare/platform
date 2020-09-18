#include <blex/blexlib.h>

/* ADDME: Better error reporting on why things went wrong*/

#include "zstream.h"
#include <zlib.h>

#include <stdexcept>
#include "path.h"

namespace Blex
{

#define ZSTREAM_BUFSIZE 16384

struct ZlibDecompressStream::Data
{
        inline Data(Stream &_compressed_stream)
          : outdataptr(0), compressed_stream(_compressed_stream), outputeof(false)
        {
                zlib.zalloc=0;
                zlib.zfree=0;
                zlib.opaque=0;
                zlib.next_in=0;
                zlib.avail_in=0;

                did_init=false;
                outdata_size=0;
        }

        //Read the next byte
        inline uint8_t ReadByte()
        {
                zlib.avail_in--;
                zlib.total_in++;
                return *zlib.next_in++;
        }
        //Amount of data to read left
        inline unsigned ReadDataLeft() const
        {
                return zlib.avail_in;
        }

        ///Have we actually initialized the zlib data structures ?
        bool did_init;

        //Buffer for the data to decompress
        uint8_t indata[ZSTREAM_BUFSIZE];
        //Buffer for the decompressed data
        uint8_t outdata[ZSTREAM_BUFSIZE];
        //Outputdata size
        unsigned outdata_size;
        //Number of decompressed data bytes we already sent
        unsigned outdataptr;
        //Stream to decompress data from
        Stream &compressed_stream;
        //ZLib's decompress data
        z_stream zlib;
        //No more uncompressed data
        bool outputeof;

        FileOffset totalsize;   // total size of the stream (if we have it .. RAW mode only!)
        FileOffset sizeread;    // counter to keep track of the amount we've read from the stream!
        FileType   filetype;    // the type of the stream (RAW or GZIP)
};

ZlibDecompressStream::ZlibDecompressStream()
  : Stream(false)
  , data(NULL)
{
        eof=false;
}

ZlibDecompressStream::~ZlibDecompressStream()
{
        if (data && data->did_init)
            inflateEnd(&data->zlib);
        delete data; //we need to manually delete this, to maintain Data class invisibility
}

void ZlibDecompressStream::FillReadBuffers()
{
        if (corrupted)
            return;

        //If we know the compressed size, never read more than we have (for nicer buffer cooperation)
        std::size_t toread = data->totalsize ? (std::size_t)std::min<Blex::FileOffset>(ZSTREAM_BUFSIZE, data->totalsize-data->sizeread) : ZSTREAM_BUFSIZE;
        uint32_t bytesread = data->compressed_stream.Read(&data->indata[0],toread);

        data->zlib.avail_in=bytesread;

        /* keep track of how many input bytes we've processed */
        data->sizeread += bytesread;
        data->zlib.next_in=&data->indata[0];
}

void ZlibDecompressStream::DecompressData()
{
        data->outdata_size=0;
        data->outdataptr=0;

        if (corrupted)
            return;

        //Prepare a new output buffer and start decompressing
        data->zlib.next_out=&data->outdata[0];
        data->zlib.avail_out=ZSTREAM_BUFSIZE;

        while (true)
        {
                int result = inflate(&data->zlib,0);
                data->outdata_size=ZSTREAM_BUFSIZE-data->zlib.avail_out;

                switch (result)
                {
                case Z_STREAM_END:
                        data->outputeof=true;
                        return;
                case Z_OK:
                        if (data->zlib.avail_out==0) //output buffer full
                            return;

                        // fallthrough
                        // probably still room in output buffer
                case Z_BUF_ERROR:
                        //still room in output buffer, so we need more input data
                        FillReadBuffers();
                        if (data->ReadDataLeft()==0)
                        {
                                //DEBUGONLY(Debug::Msg("ZlibDecompressStream corruption - EOF reported but no Z_STREAM_END"));
                                corrupted=true;
                                return;
                        }
                        break;
                default:
                        //DEBUGONLY(Debug::Msg("ZlibDecompressStream corruption - inflate returned error"));
                        corrupted=true;
                        return;
                }
        }
}

signed ZlibDecompressStream::ReadSingleByte()
{
        if (data->ReadDataLeft()==0)
        {
                FillReadBuffers();
                if (data->ReadDataLeft()==0)
                    return -1;
        }
        return data->ReadByte();
}

bool ZlibDecompressStream::StripGzipHeader()
{
        if (data->ReadDataLeft()<10) //zip header is at least 10 bytes
            return false;
        if (data->ReadByte()!=0x1F || data->ReadByte()!=0x8B)
        {
                //DEBUGONLY(Debug::Msg("File is not a Gzip file"));
                return false;
        }
        if (data->ReadByte()!=8) //compression type
        {
                //DEBUGONLY(Debug::Msg("File is not deflated"));
                return false;
        }
        uint8_t flags=data->ReadByte();
        //Skip 6 bytes for OS type, XFL and mod time
        for (unsigned i=0;i<6;++i)
            data->ReadByte();

        if (flags & 4) //FEXTRA bit
        {
                //Additional data, starting with a LSB length and the data itself
                //Just skip these bytes
                for (unsigned extrasize=unsigned(data->ReadByte()) || (unsigned(data->ReadByte())<<8);
                     extrasize>0;
                     --extrasize)
                {
                        if (ReadSingleByte()==-1)
                        {
                                //DEBUGONLY(Debug::Msg("Error reading EXTRA data"));
                                return false;
                        }
                }
        }

        if (flags & 8) //FNAME
        {
                //Read a null-terminated string (contains original file name)
                for (signed byte=ReadSingleByte();byte!=0;byte=ReadSingleByte())
                {
                        if (byte==-1)
                        {
                                //DEBUGONLY(Debug::Msg("Error filename data"));
                                return false;
                        }
                }
        }

        if (flags & 16) //FCOMMENT
        {
                //Read a null-terminated comment
                for (signed byte=ReadSingleByte();byte!=0;byte=ReadSingleByte())
                {
                        if (byte==-1)
                        {
                                //DEBUGONLY(Debug::Msg("Error filename data"));
                                return false;
                        }
                }
        }

        if (flags & 2) //CRC Header
        {
                //A 16-bit CRC prefixes the data, just eat it
                ReadSingleByte();
                ReadSingleByte();
        }
        return true;
}

ZlibDecompressStream* ZlibDecompressStream::OpenGzip(Stream &originalstream)
{
        ZlibDecompressStream *str = Open(originalstream, Gzip, 0);
        return str;
}

ZlibDecompressStream* ZlibDecompressStream::OpenRaw(Stream &originalstream, FileOffset length)
{
        ZlibDecompressStream *str = Open(originalstream, Raw, length);
        return str;
}

ZlibDecompressStream* ZlibDecompressStream::OpenZlib(Stream &originalstream)
{
        ZlibDecompressStream *str = Open(originalstream, Zlib, 0);
        return str;
}

ZlibDecompressStream* ZlibDecompressStream::Open(Stream &originalstream, FileType filetype, FileOffset length)
{
        std::unique_ptr<ZlibDecompressStream> newstream(new ZlibDecompressStream);
        newstream->corrupted=false;

        newstream->data=new Data(originalstream);

        /* initialize the length and type of the stream!!!
           this is important because it is used by FillReadBuffers
        */
        newstream->data->sizeread = 0;
        newstream->data->totalsize = length;
        newstream->data->filetype = filetype;

        //Prepare and initialize Zlib
        newstream->FillReadBuffers();

        if (filetype==Gzip && !newstream->StripGzipHeader())
            return 0;

        if (filetype==Zlib)
        {
                if (inflateInit(&newstream->data->zlib)!=Z_OK)
                        return 0;
        }
        else
        {
                /* windowBits is passed < 0 to tell that there is no zlib header.
                 * Note that in this case inflate *requires* an extra "dummy" byte
                 * after the compressed stream in order to complete decompression and
                 * return Z_STREAM_END. Here the gzip CRC32 ensures that 4 bytes are
                 * present after the compressed stream.
                 */
                if (inflateInit2(&newstream->data->zlib, -MAX_WBITS)!=Z_OK)
                {
                        //DEBUGONLY(Debug::Msg("ZlibDecompressStream::Open inflateInit2 failed"));
                        return 0;
                }
        }

        newstream->data->did_init=true;
        newstream->DecompressData();
        return newstream.release();
}

bool ZlibDecompressStream::EndOfStream()
{
        return eof;
}

std::size_t ZlibDecompressStream::Read(void *buf,std::size_t maxbufsize)
{
        std::size_t totalbytesread=0;
        while (maxbufsize>0)
        {
                //There is still decompressed data to send?
                if (data->outdataptr < data->outdata_size)
                {
                        //yes, send it!
                        std::size_t tosend = std::min<std::size_t>(data->outdata_size-data->outdataptr,maxbufsize);

                        memcpy(buf,&data->outdata[data->outdataptr],tosend);
                        buf=static_cast<uint8_t*>(buf) + tosend;
                        maxbufsize -= tosend;
                        data->outdataptr += tosend;
                        totalbytesread += tosend;
                }
                else //Fill local buffers to their maximum
                {
                        DecompressData();
                        if (data->outdata_size==0)
                            break;
                }
        }
        if (totalbytesread==0)
            eof=true;
        return totalbytesread;
}

std::size_t ZlibDecompressStream::Write(const void *, std::size_t )
{
        throw std::runtime_error("Blex::ZlibDecompressStream::Write - cannot write to a decompressing stream");
}

struct ZlibCompressStream::Data
{
        inline Data(Stream &_out_stream)
          : out_stream(_out_stream)
        {
                zlib.zalloc=0;
                zlib.zfree=0;
                zlib.opaque=0;
                zlib.next_in=0;
        }

        Stream &out_stream;
        ///Compression stream
        z_stream zlib;
};

ZlibCompressStream::ZlibCompressStream(Stream &true_data, FileType filetype, unsigned compress_factor)
  : Stream(false)
  , filetype(filetype)
{
        data=new Data(true_data);
        if (deflateInit2(&data->zlib,compress_factor,Z_DEFLATED,-15,8,Z_DEFAULT_STRATEGY) != Z_OK)
        {
                delete data; //we need to manually delete this, to maintain Data class invisibility
                throw std::runtime_error("Cannot initialize zlib deflate");
        }

        if (filetype==Gzip)
        {
                //must create a Gzip header
                uint8_t header[10];
                header[0]=037;
                header[1]=0213;
                header[2]=8; //deflate
                header[3]=0;
                putu32lsb(header+4,std::time(0));
                header[8]=0;
                header[9]=255;
                true_data.Write(header,10);
        }
}

ZlibCompressStream::~ZlibCompressStream()
{
        /* Flush first */
        uint8_t buffer[ZSTREAM_BUFSIZE];
        data->zlib.avail_in=0;

        while(true)
        {
                data->zlib.avail_out=ZSTREAM_BUFSIZE;
                data->zlib.next_out=buffer;

                int deflate_retval=deflate(&data->zlib,Z_FINISH);
                if (deflate_retval != Z_OK && deflate_retval != Z_STREAM_END)
                     break; //compression failed

                std::size_t towrite = ZSTREAM_BUFSIZE-data->zlib.avail_out;
                if (towrite)
                {
                        std::size_t bytes_written = data->out_stream.Write(buffer,towrite);
                        if (bytes_written != towrite)
                             break; //write failed!
                }

                if (deflate_retval == Z_STREAM_END)
                    break; //compression finished
        }

        if (filetype == Gzip)
        {
                //Write crc and size
                uint8_t footer[8];
                putu32lsb(footer+0,input_crc.GetValue());
                putu32lsb(footer+4,data->zlib.total_in);
                data->out_stream.Write(footer,8);
        }

        deflateEnd(&data->zlib);
        delete data; //we need to manually delete this, to maintain Data class invisibility
}

bool ZlibCompressStream::EndOfStream()
{
        throw std::runtime_error("Blex::ZlibCompressStream::EndOfStream - cannot read from a compressing stream");
}
std::size_t ZlibCompressStream::Read(void *, std::size_t )
{
        throw std::runtime_error("Blex::ZlibCompressStream::Read - cannot read from a compressing stream");
}

std::size_t ZlibCompressStream::Write(const void *buf, std::size_t bufsize)
{
        uint8_t buffer[ZSTREAM_BUFSIZE];

        data->zlib.avail_in=bufsize;
        data->zlib.next_in=const_cast<uint8_t*>(static_cast<const uint8_t*>(buf));

        if (filetype==Gzip || filetype==Zip)
             input_crc.Do(static_cast<uint8_t const*>(buf),bufsize);

        while(data->zlib.avail_in)
        {
                data->zlib.avail_out=ZSTREAM_BUFSIZE;
                data->zlib.next_out=buffer;

                int deflate_retval=deflate(&data->zlib,0);
                if (deflate_retval != Z_OK && deflate_retval != Z_STREAM_END)
                     return 0; //compression failed

                std::size_t towrite = ZSTREAM_BUFSIZE-data->zlib.avail_out;
                if (towrite)
                {
                        std::size_t bytes_written = data->out_stream.Write(buffer,towrite);
                        if (bytes_written != towrite)
                             return 0; //write failed!
                }
        }
        return bufsize;
}

/******************************************************************************
        ArchiveReaderBase
******************************************************************************/

ArchiveReaderBase::~ArchiveReaderBase()
{
}

/******************************************************************************
        ZipArchiveReader
******************************************************************************/

namespace
{

struct ZipHeader
{
      uint8_t   signature[4];      // 0x04034B50
      uint8_t   needversion[2];    // version needed to extract
      uint8_t   bitflags[2];       // bit flags
      uint8_t   compmethod[2];     // compression method
      uint8_t   mod_time[2];       // last modified file time
      uint8_t   mod_date[2];       // last modified file date
      uint8_t   crc32[4];          // crc
      uint8_t   compsize[4];       // compressed size in bytes
      uint8_t   uncompsize[4];     // uncompressed size in bytes
      uint8_t   filenamelen[2];    // filename length (in bytes)
      uint8_t   extralen[2];       // extra field length
};

struct ZipDataDescriptor
{
      uint8_t   crc32[4];          // crc
      uint8_t   compsize[4];       // compressed size in bytes
      uint8_t   uncompsize[4];     // uncompressed size in bytes
};

struct ZipCentralDir
{
      uint8_t   signature[4];      // 0x02014B50
      uint8_t   madeversion[2];    // version that made the ZIP
      uint8_t   needversion[2];    // version needed to uncompress ZIP
      uint8_t   bitflags[2];       // some flags (see fileformat!)
      uint8_t   compmethod[2];     // compression method
      uint8_t   mod_time[2];       // last modified file time
      uint8_t   mod_date[2];       // last modified file date
      uint8_t   crc32[4];          // crc
      uint8_t   compsize[4];       // compressed size
      uint8_t   uncompsize[4];     // uncompressed size
      uint8_t   filenamelen[2];    // filename length (in bytes)
      uint8_t   extralen[2];       // extra field length (in bytes)
      uint8_t   commentln[2];      // file comment length (in bytes)
      uint8_t   startdisk[2];      // used in multidisk spanning (sux!)
      uint8_t   infileattr[2];     // internal file attributes
      uint8_t   exfileattr[4];     // external file attributes
      uint8_t   reloffset[4];      // relative offset of local header
};

struct  ZipCentralDirEnd
{
      uint8_t   signature[4];      // 0x06054B50
      uint8_t   disknumber[2];     // disk number (multi-disk spanning)
      uint8_t   dirdisk[2];        // disk numer with start of central dir.
      uint8_t   diskentries[2];    // entries in central dir (this disk)
      uint8_t   direntries[2];     // total entries in central dir
      uint8_t   dirsize[4];        // size of central dir in bytes
      uint8_t   reloffset[4];      // offset of start of central dir
      uint8_t   commentlen[2];     // length of the comment
};

} // End of anonymous namespace


//NOTE: The versions prior to October 1st 2005 had a Streaming (instead of RandomStream) zip file reader.If we ever find a need for that one again, just resurrect it :-)

//Return central directory offset and size
bool ZipArchiveReader::GetCentralDir(RandomStream &stream, Blex::FileOffset *start, std::size_t *len, unsigned *numentries, std::string *comment)
{
        static const unsigned BufferSize = 4096;
        static const unsigned ReadBufferSize = BufferSize + sizeof(ZipCentralDirEnd);
        static const char EndOfDirSig[5] = {"\x50\x4B\x05\x06"};
        std::unique_ptr< uint8_t[] > end_search_buf( new uint8_t[ReadBufferSize] );
        Blex::FileOffset end_look_at = stream.GetFileLength() - (stream.GetFileLength() % BufferSize);

        //Scan backwards through the file
        while(true)
        {
                std::size_t bytesread = stream.DirectRead(end_look_at,&end_search_buf[0],ReadBufferSize);
                DEBUGPRINT("GetCentralDir: tried to get dir at " << end_look_at << ", reading " << ReadBufferSize << " got " << bytesread);
                if (bytesread >= sizeof(ZipCentralDirEnd)) //an end of central directory just might fit in this block
                {
                        uint8_t* sig = std::find_end(&end_search_buf[0], &end_search_buf[bytesread - sizeof(ZipCentralDirEnd) + 4], EndOfDirSig, EndOfDirSig+4);
                        if (sig != &end_search_buf[bytesread - sizeof(ZipCentralDirEnd) + 4]) //we found the sig
                        {
                                DEBUGPRINT("Signature found at relative offset " << std::distance(&end_search_buf[0], sig));

                                ZipCentralDirEnd *dirend = reinterpret_cast<ZipCentralDirEnd *>(sig);
                                *start = Blex::getu32lsb(dirend->reloffset);
                                *len = Blex::getu32lsb(dirend->dirsize);
                                *numentries = Blex::getu16lsb(dirend->direntries);

                                if (comment)
                                {
                                        uint16_t commentsize = Blex::getu16lsb(dirend->commentlen);
                                        comment->resize(commentsize);

                                        if (commentsize != 0)
                                        {
                                                Blex::FileOffset direndstart = end_look_at + std::distance(&end_search_buf[0], sig);
                                                bytesread = stream.DirectRead(direndstart + sizeof(*dirend), &(*comment)[0], commentsize);

                                                comment->resize(bytesread);
                                        }
                                }
                                return true;
                        }
                }

                //ADDME: As the ZIP comment can be no longer than 64K long, we might stop searching backwards after 64K?
                if (end_look_at==0)
                {
                        DEBUGPRINT("GetCentralDir: didn't find the directory");
                        return false; //eof, can't find directory
                }
                end_look_at -= BufferSize;
        }
}

Blex::DateTime ReadDosDateTime(uint16_t date, uint16_t time)
{
        return DateTime::FromDateTime( (date>>9)+1980, ((date>>5)&0xf), date&0x1f, (time>>11), (time>>5)&0x3f, (time&0x1f)*2);
}

std::pair< uint16_t, uint16_t > MakeDosDateTime(Blex::DateTime dt)
{
        std::pair< uint16_t, uint16_t > result;
        std::tm unp = dt.GetTM();

        result.first = uint16_t(((unp.tm_year - 80) << 9) +
                           ((unp.tm_mon + 1) << 5) + // range 0..11 -> 1..12
                           (unp.tm_mday)); // range 1..31
        result.second = uint16_t((unp.tm_hour << 11) +
                            (unp.tm_min << 5) +
                            (unp.tm_sec >> 1));

        return result;
}

ZipArchiveReader* ZipArchiveReader::Open(RandomStream &stream)
{
        /* Simply assume we have a valid ZIP file, and start reading it. Look
           for the end of the central directory */

        Blex::FileOffset start_central_dir;
        std::size_t len_central_dir;
        unsigned entries_central_dir;
        std::string mycomment;

        if (!GetCentralDir(stream, &start_central_dir, &len_central_dir, &entries_central_dir, &mycomment))
        {
                DEBUGPRINT("GetCentralDir failed - not a zip file");
                return NULL; //Not a zip file
        }

        std::unique_ptr<ZipArchiveReader> rdr(new ZipArchiveReader(stream));
        rdr->comment = mycomment;

        if (len_central_dir==0) //emptyzip
            return rdr.release();

        //Start reading the central directory
        std::unique_ptr<uint8_t[]> centraldir_data(new uint8_t[len_central_dir]);

        //ADDME: Optimize, chances are most of the directory is already loaded, skip double-read..
        len_central_dir = stream.DirectRead(start_central_dir, &centraldir_data[0], len_central_dir);

        //Read the central directory
        rdr->zippedfiles.reserve(entries_central_dir);

        uint8_t *readptr=&centraldir_data[0];
        while(readptr + sizeof(ZipCentralDir) <= &centraldir_data[len_central_dir])
        {
                ZipCentralDir *direntry = reinterpret_cast<ZipCentralDir*>(readptr);
                if (Blex::getu32lsb(direntry->signature) != 0x02014B50)
                {
                        DEBUGPRINT("Incorrect signature on direntry #" << rdr->zippedfiles.size() << ", got " << std::hex << Blex::getu32lsb(direntry->signature) << std::dec << " need 0x02014b50");
                        return NULL; //Format error
                }

                unsigned filenamelen = Blex::getu16lsb(direntry->filenamelen);
                if(readptr + filenamelen + sizeof(ZipCentralDir) > &centraldir_data[len_central_dir])
                    return NULL; //Format error

                //Get total length of all variable blocks
                unsigned variable_data_length = filenamelen + Blex::getu16lsb(direntry->extralen) + Blex::getu16lsb(direntry->commentln);
                if(readptr + sizeof(ZipCentralDir) + variable_data_length > &centraldir_data[len_central_dir])
                    return NULL; //Format error

                ZippedEntry newentry;
                newentry.compression = Blex::getu16lsb(direntry->compmethod);
                newentry.modtime = ReadDosDateTime(Blex::getu16lsb(direntry->mod_date), Blex::getu16lsb(direntry->mod_time));
                newentry.compressedsize = Blex::getu32lsb(direntry->compsize);
                newentry.uncompressedsize = Blex::getu32lsb(direntry->uncompsize);
                newentry.org_filename.assign(readptr + sizeof(ZipCentralDir), readptr + sizeof(ZipCentralDir) + filenamelen);
                newentry.type = Entry::File;
                newentry.bitflags = Blex::getu16lsb(direntry->bitflags);

                if(newentry.bitflags & 0x0800 && Blex::IsValidUTF8(newentry.org_filename.begin(), newentry.org_filename.end(), false))
                {
                        newentry.filename = newentry.org_filename;
                }
                else
                {
                        uint32_t const *charset = GetCharsetConversiontable(Charsets::CP437);
                        Blex::UTF8Encoder< std::back_insert_iterator< std::string > > encoder(std::back_inserter(newentry.filename));
                        for(std::string::const_iterator itr = newentry.org_filename.begin(); itr != newentry.org_filename.end(); ++itr)
                          if(charset[uint8_t(*itr)])
                            encoder(charset[uint8_t(*itr)]);
                }

                //Scan for extra fields
                unsigned extraptr = 0, extralen = Blex::getu16lsb(direntry->extralen);
                while(extraptr+4 < extralen)
                {
                        uint8_t const *field  = readptr + sizeof(ZipCentralDir) + filenamelen + extraptr;
                        unsigned headerid = Blex::getu16lsb(field);
                        unsigned datasize = Blex::getu16lsb(field+2);

                        unsigned fieldlimit = extraptr+datasize+4;
                        if(fieldlimit>extralen)
                             break; //skip this field, it's broken

                        if(headerid == 0x7075 && datasize>=5) //Info-ZIP Unicode Path Extra Field
                        {
                                uint8_t const *textstart = field+9;
                                uint8_t const *textlimit = field+datasize+4;

                                //std::cout << textstart << "\n";
                                //std::cout << std::hex << "read crc:" << Blex::getu32lsb(field+5) << "\n";

                                //format: <version:uint8_t> <namecrc:uint32_t> <filename utf8>
                                Crc32 headercrc;
                                headercrc.Do(newentry.org_filename.data(), newentry.org_filename.size());

                                //std::cout << std::hex << "calculated crc: " << headercrc.GetValue() << "\n";

                                //The CRC seems to be used to verify that the original name wasn't updated (probably by a non-unicode zip app)
                                if(Blex::IsValidUTF8(textstart, textlimit, false) && headercrc.GetValue() == Blex::getu32lsb(field+5))
                                     newentry.filename.assign(reinterpret_cast<const char*>(textstart), reinterpret_cast<const char*>(textlimit));
                        }

                        extraptr += fieldlimit;
                }

                //safely handle backslashes, if any
                std::replace(newentry.filename.begin(), newentry.filename.end(), '\\', '/');

                // if the filename ends in '/' then it's a directory...
                if (!newentry.filename.empty() && newentry.filename[newentry.filename.size()-1]=='/')
                    newentry.type = Entry::Directory;

                // remove dangerous components from the name
                newentry.filename = CollapsePathString(newentry.filename);
                // convert absolute names to relative ones
                while (!newentry.filename.empty() && newentry.filename[0]=='/')
                    newentry.filename.erase(newentry.filename.begin());

                //newentry.storage_offset = Blex::getu32lsb(direntry->reloffset) + variable_data_length + sizeof(ZipHeader);
                newentry.localheader_offset = Blex::getu32lsb(direntry->reloffset);

                rdr->zippedfiles.push_back(newentry);
                readptr += sizeof(ZipCentralDir) + variable_data_length;
        }

        //Sort the central directory by localheader_offset to speed up extraction (avoid seeks)
        std::sort(rdr->zippedfiles.begin(), rdr->zippedfiles.end(), ZipEntryFilePositionLess());

        return rdr.release();
}

ZipArchiveReader::ZipArchiveReader(RandomStream &stream)
: archivestream(stream)
, zippedfiles_ptr(0)
{
}

ZipArchiveReader::~ZipArchiveReader()
{
}

ArchiveReaderBase::Entry ZipArchiveReader::GetEntryByNr(unsigned filenr)
{
        Entry thisentry(Entry::File);
        thisentry.name = zippedfiles[filenr].filename;
        thisentry.length = zippedfiles[filenr].uncompressedsize;
        thisentry.modtime = zippedfiles[filenr].modtime;
        thisentry.type = zippedfiles[filenr].type;

        return thisentry;
}

bool ZipArchiveReader::SendFileByNr(Stream &output_stream, unsigned filenr)
{
        if (filenr >= zippedfiles.size()) //Illegal file nr
            return false;

        ZippedEntry const &entry = zippedfiles[filenr];

        if (entry.uncompressedsize==0)
            return true; //no data!

        archivestream.SetOffset(entry.localheader_offset);
        ZipHeader localheader;
        if(archivestream.Read(&localheader, sizeof(localheader)) != sizeof(localheader))
            return false; //broken zip file

        //ADDME: What to do when localheader differs from globalheader ?
        archivestream.SetOffset(entry.localheader_offset
                               + sizeof(ZipHeader)
                               + Blex::getu16lsb(localheader.filenamelen)
                               + Blex::getu16lsb(localheader.extralen)
                               );

        if(entry.compression==0) //Store
            return archivestream.LimitedSendTo(entry.uncompressedsize, output_stream) == entry.uncompressedsize;

        if (entry.compression==8) //ZLIB Deflate
        {
                // make a decompressing stream...
                std::unique_ptr<ZlibDecompressStream> zstream;
                zstream.reset(ZlibDecompressStream::OpenRaw(archivestream, entry.compressedsize));
                return zstream.get() && zstream->SendAllTo(output_stream) == entry.uncompressedsize;
        }
        return false; //unsupported compression method
}

ArchiveReaderBase::Entry ZipArchiveReader::NextEntryInfo()
{
        if (zippedfiles_ptr>=zippedfiles.size()) //reached eof
            return Entry(Entry::Eof);

        return GetEntryByNr(zippedfiles_ptr++);
}

bool ZipArchiveReader::SendFile(Stream &output_stream)
{
        if (zippedfiles_ptr == 0) // No files opened yet
            return false;

        return SendFileByNr(output_stream, zippedfiles_ptr - 1);
}

void ZipArchiveReader::GetFilesList(std::vector< Entry > *entries)
{
        for (unsigned i = 0, e = zippedfiles.size(); i < e; ++i)
            entries->push_back(GetEntryByNr(i));
}

bool ZipArchiveReader::SendFileByPath(std::string const &path, Stream &output_stream)
{
        for (unsigned i = 0, e = zippedfiles.size(); i < e; ++i)
        {
                ZippedEntry const &entry = zippedfiles[i];

                if (entry.filename == path)
                    return SendFileByNr(output_stream, i);
        }
        return false;
}

/* ADDME: 64-bit support
*/
ZipArchiveWriter::ZipArchiveWriter(RandomStream &_dest)
: dest(_dest)
{
}

ZipArchiveWriter::~ZipArchiveWriter()
{
}

unsigned ZipArchiveWriter::GetExtraFieldLen(bool need_utf8, std::string const &inname)
{
        return need_utf8 ? 9 + inname.size() : 0;
}
void ZipArchiveWriter::WriteExtraFields(bool need_utf8, std::string const &utf8name, std::string const &storedname)
{
        if(!need_utf8)
           return;

        uint8_t fieldheader[9];
        Blex::putu16lsb(fieldheader, 0x7075); //Info-ZIP Unicode Path Extra Field
        Blex::putu16lsb(fieldheader+2, 5 + utf8name.size());
        fieldheader[4] = 1;

        Crc32 headercrc;
        headercrc.Do(storedname.data(), storedname.size());
        Blex::putu32lsb(fieldheader+5, headercrc.GetValue());

        dest.Write(fieldheader, 9);
        dest.Write(utf8name.data(), utf8name.size());
}
bool ZipArchiveWriter::StoreFilename(std::string *store, std::string const &inname)
{
        uint32_t const *charset = GetCharsetConversiontable(Charsets::CP437);
        Blex::UTF8DecodeMachine decoder;
        bool need_utf8_version = false;

        for(std::string::const_iterator nameptr = inname.begin(); nameptr != inname.end(); ++nameptr)
        {
                uint32_t codepoint = decoder(*nameptr);
                if(codepoint == Blex::UTF8DecodeMachine::NoChar)
                    continue;

                unsigned inpos = std::find(charset, charset+256, codepoint) - charset;
                if (codepoint== 0 || inpos == 256)
                {
                        store->push_back('_');
                        need_utf8_version = true;
                }
                else
                {
                        store->push_back(char(inpos));
                }
        }

        return need_utf8_version;
}

void ZipArchiveWriter::AddDir(std::string const &dirname, DateTime modtime)
{
        std::string name = dirname;
        if (!name.empty() && name[name.size() - 1] != '/')
            name += "/";

        Entry entry;
        entry.store_utf8name = StoreFilename(&entry.cp437name, name);
        entry.utf8name = name;

        if (entry.utf8name.size() >= 65535 || entry.cp437name.size() >= 65535)
           throw std::runtime_error("Directory name too long");

        entry.is_directory = true;
        entry.modtime = modtime;
        entry.headerpos = dest.GetOffset();
        entry.datetime = MakeDosDateTime(modtime);
        entry.crc32 = 0;
        entry.uncompressed_size = 0;
        entry.compressed_size = 0;

        if (entries.size() > 65535)
           throw std::runtime_error("Too many entries in archive");

        /*Blex::DateTime restore = */ReadDosDateTime(entry.datetime.first, entry.datetime.second);

        entries.push_back(entry);

        ZipHeader header;
        Blex::PutLsb< uint32_t >(header.signature, 0x04034B50);
        Blex::PutLsb< uint16_t >(header.needversion, 0x0A); //Need MS-DOS, ZIP spec v1.0
        Blex::PutLsb< uint16_t >(header.bitflags, 0);
        Blex::PutLsb< uint16_t >(header.compmethod, 0);
        Blex::PutLsb< uint16_t >(header.mod_date, entry.datetime.first);
        Blex::PutLsb< uint16_t >(header.mod_time, entry.datetime.second);
        Blex::PutLsb< uint32_t >(header.compsize, 0);
        Blex::PutLsb< uint32_t >(header.uncompsize, 0);
        Blex::PutLsb< uint32_t >(header.crc32, 0);
        Blex::PutLsb< uint16_t >(header.filenamelen, uint16_t(entry.cp437name.size()));
        Blex::PutLsb< uint16_t >(header.extralen, GetExtraFieldLen(entry.store_utf8name, name));

        dest.Write(&header, sizeof(header));
        dest.Write(&entry.cp437name[0], entry.cp437name.size());
        WriteExtraFields(entry.store_utf8name, entry.utf8name, entry.cp437name);
}

void ZipArchiveWriter::AddFile(std::string const &name, DateTime modtime, Stream &stream)
{
        Entry entry;
        entry.store_utf8name = StoreFilename(&entry.cp437name, name);
        entry.utf8name = name;

        entry.is_directory = false;
        entry.modtime = modtime;
        entry.headerpos = dest.GetOffset();
        entry.datetime = MakeDosDateTime(modtime);

        if (entry.utf8name.size() >= 65535 || entry.cp437name.size() >= 65535)
           throw std::runtime_error("Directory name too long");
        if (entries.size() > 65535)
           throw std::runtime_error("Too many entries in archive");

        dest.MoveForward(sizeof(ZipHeader) + entry.cp437name.size() + GetExtraFieldLen(entry.store_utf8name, name));

        // Send the uncompressed data through the compressor
        FileOffset data_start = dest.GetOffset();
        {
                ZlibCompressStream compress_stream(dest, ZlibCompressStream::Zip, 9);

                entry.uncompressed_size = stream.SendAllTo(compress_stream);
                entry.crc32 = compress_stream.GetCRC32();
        }
        entry.compressed_size = dest.GetOffset() - data_start;
        FileOffset data_end = dest.GetOffset();

        entry.compressed = true;

        ZipHeader header;
        Blex::PutLsb< uint32_t >(header.signature, 0x04034B50);
        Blex::PutLsb< uint16_t >(header.needversion, 0x14); //Need MS-DOS, ZIP spec v2.0
        Blex::PutLsb< uint16_t >(header.bitflags, 0);//Winzip does this
        Blex::PutLsb< uint16_t >(header.compmethod, uint16_t(entry.compressed ? 8 : 0));
        Blex::PutLsb< uint16_t >(header.mod_date, entry.datetime.first);
        Blex::PutLsb< uint16_t >(header.mod_time, entry.datetime.second);
        Blex::PutLsb< uint32_t >(header.compsize, uint32_t(entry.compressed_size));
        Blex::PutLsb< uint32_t >(header.uncompsize, uint32_t(entry.uncompressed_size));
        Blex::PutLsb< uint32_t >(header.crc32, entry.crc32);
        Blex::PutLsb< uint16_t >(header.filenamelen, uint16_t(entry.cp437name.size()));
        Blex::PutLsb< uint16_t >(header.extralen, GetExtraFieldLen(entry.store_utf8name, name));

        dest.SetOffset(entry.headerpos);

        dest.Write(&header, sizeof(header));
        dest.Write(&entry.cp437name[0], entry.cp437name.size());
        WriteExtraFields(entry.store_utf8name, entry.utf8name, entry.cp437name);

        dest.SetOffset(data_end);

        entries.push_back(entry);
}

void ZipArchiveWriter::SetComment(std::string const &newcomment)
{
  comment = newcomment;
}

void ZipArchiveWriter::Finalize()
{
        Blex::FileOffset dirstart = dest.GetOffset();

        for (std::vector< Entry >::iterator it = entries.begin(); it != entries.end(); ++it)
        {
                ZipCentralDir cdentry;

                Blex::PutLsb< uint32_t >(cdentry.signature, 0x02014B50);
                Blex::PutLsb< uint16_t >(cdentry.madeversion, 0x14); // Made by MS-DOS, ZIP spec v2.0
                Blex::PutLsb< uint16_t >(cdentry.needversion, it->is_directory ? 0x0A : 0x14); // Need MS-DOS, ZIP spec v1.0(dir)/v2.0(file)
                Blex::PutLsb< uint16_t >(cdentry.bitflags, 0);
                Blex::PutLsb< uint16_t >(cdentry.compmethod, it->is_directory || !it->compressed ? 0 : 8);
                Blex::PutLsb< uint16_t >(cdentry.mod_date, it->datetime.first);
                Blex::PutLsb< uint16_t >(cdentry.mod_time, it->datetime.second);
                Blex::PutLsb< uint32_t >(cdentry.compsize, uint32_t(it->compressed_size));
                Blex::PutLsb< uint32_t >(cdentry.uncompsize, uint32_t(it->uncompressed_size));
                Blex::PutLsb< uint32_t >(cdentry.crc32, it->crc32);
                Blex::PutLsb< uint16_t >(cdentry.filenamelen, it->cp437name.size());
                Blex::PutLsb< uint16_t >(cdentry.extralen, GetExtraFieldLen(it->store_utf8name, it->utf8name));
                Blex::PutLsb< uint16_t >(cdentry.commentln, 0);
                Blex::PutLsb< uint16_t >(cdentry.startdisk, 0);
                Blex::PutLsb< uint16_t >(cdentry.infileattr, 0);
                Blex::PutLsb< uint16_t >(cdentry.exfileattr, uint16_t(it->is_directory ? 0x10 : 0));
                Blex::PutLsb< uint32_t >(cdentry.reloffset, uint32_t(it->headerpos));

                dest.Write(&cdentry, sizeof(cdentry));
                dest.Write(&it->cp437name[0], it->cp437name.size());
                WriteExtraFields(it->store_utf8name, it->utf8name, it->cp437name);
        }

        Blex::FileOffset dirsize = dest.GetOffset() - dirstart;

        ZipCentralDirEnd dirend;
        Blex::PutLsb< uint32_t >(dirend.signature, 0x06054B50);
        Blex::PutLsb< uint16_t >(dirend.disknumber, 0);
        Blex::PutLsb< uint16_t >(dirend.dirdisk, 0);
        Blex::PutLsb< uint16_t >(dirend.diskentries, uint16_t(entries.size()));
        Blex::PutLsb< uint16_t >(dirend.direntries, uint16_t(entries.size()));
        Blex::PutLsb< uint32_t >(dirend.dirsize, uint32_t(dirsize));
        Blex::PutLsb< uint32_t >(dirend.reloffset, uint32_t(dirstart));
        Blex::PutLsb< uint16_t >(dirend.commentlen, comment.size());

        dest.Write(&dirend, sizeof(dirend));
        if (!comment.empty())
            dest.Write(&comment[0], comment.size());
}

} //end of namespace Blex
