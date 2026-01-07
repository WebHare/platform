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

} //end of namespace Blex
