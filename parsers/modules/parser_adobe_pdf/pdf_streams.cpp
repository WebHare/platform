#include <ap/libwebhare/allincludes.h>


#include "pdf_streams.h"
#include <blex/zstream.h>
#include <blex/crypto.h>

namespace Parsers
{

namespace Adobe
{

namespace PDF
{

BitReader::BitReader(Blex::Stream &in)
        : bitsbuffer(in,4096)
        , curbits(0)
        , bits_in_curbyte(0)
        , eof(false)
{ }

BitReader::~BitReader()
{ }

unsigned BitReader::GetMSBBits(unsigned numbits)
{
        // Fill up the bit buffer until we have enough bits
        while(bits_in_curbyte < numbits)
        {
                uint8_t newbyte;
                if (!bitsbuffer.ReadLsb<uint8_t>(&newbyte))
                {
                        eof=true;
                        return unsigned(-1);
                }
                curbits = (curbits << 8) | newbyte;
                bits_in_curbyte += 8;
        }

        // Get the next result from the (left side of the) buffer:
        unsigned next_result = curbits >> (bits_in_curbyte - numbits);
        // And empty the used part of the buffer:
        bits_in_curbyte -= numbits;
        curbits &= (1L<<bits_in_curbyte)-1;

        return next_result;
}
unsigned BitReader::GetLSBBits(unsigned numbits)
{
        // Fill up the bit buffer until we have enough bits
        while(bits_in_curbyte < numbits)
        {
                uint8_t newbyte;
                if (!bitsbuffer.ReadLsb<uint8_t>(&newbyte))
                {
                        eof=true;
                        return unsigned(-1);
                }
                curbits = curbits | (newbyte << bits_in_curbyte);
                bits_in_curbyte += 8;
        }

        // Get the next result from the (right side of the) buffer:
        unsigned next_result = curbits & ((1L<<numbits)-1);
        // And empty the used part of the buffer:
        curbits >>= numbits;
        bits_in_curbyte -= numbits;

        return next_result;
}
/** At end of file ? May not become true until AFTER eof is hit! */
bool BitReader::Eof()
{
        return eof;
}

PNGPredictionDecodeStream::PNGPredictionDecodeStream(Blex::Stream &originalstream, unsigned columns)
: Stream(false)
, columns(columns)
, dataoffset(0)
, eof(false)
{
        if(columns==0) //nothing to do
            return;

        /* ADDME make streaming */
        std::vector<uint8_t> temp;
        Blex::ReadStreamIntoVector(originalstream, &temp);

        unsigned numrows = temp.size() / (columns+1);
        decompresseddata.resize(numrows*columns);

        uint8_t const *inptr = &temp[0];
        uint8_t *outptr = &decompresseddata[0];

        //http://www.w3.org/TR/PNG-Filters.html
        for (unsigned y=0;y<numrows;++y)
        {
                uint8_t rowtype = *inptr++;
                DEBUGPRINT("rowtype " << (int)rowtype << " offset " << int(inptr-1-&temp[0]) << " cols " << columns);
                DEBUGONLY(if(rowtype > 2) DEBUGPRINT("Unrecognized rowtype " << (int)rowtype << " in png prediction filter"));

                for(unsigned x=0;x<columns;++x)
                {
                        uint8_t inbyte = *inptr++;
                        uint8_t outbyte;

                        if(rowtype==1) //Sub
                            outbyte = inbyte + (x==0 ? 0 : *(outptr - 1));
                        else if (rowtype == 2) //Up (previous row)
                            outbyte = inbyte  + (y==0 ? 0 : *(outptr - columns));
                        else //ADDME support other types? they don't make sense for crossref streams though i thin
                            outbyte = inbyte;

                        DEBUGPRINT("inbyte " << (int)inbyte << " outbyte " << (int)outbyte);
                        *outptr++ = outbyte;
                }
        }
}
PNGPredictionDecodeStream::~PNGPredictionDecodeStream()
{
}
bool PNGPredictionDecodeStream::EndOfStream()
{
        return eof;
}
std::size_t PNGPredictionDecodeStream::Read(void *buf,std::size_t maxbufsize)
{
        maxbufsize = std::min(maxbufsize, decompresseddata.size() - dataoffset);
        if(maxbufsize>0)
        {
                memcpy(buf, &decompresseddata[dataoffset], maxbufsize);
                dataoffset += maxbufsize;
        }
        else
        {
                eof=true;
        }
        return maxbufsize;
}
std::size_t PNGPredictionDecodeStream::Write(const void *, std::size_t )
{
        throw std::runtime_error("PNGPredictionDecodeStream is read-only");
}

#define ASCII85STREAM_BUFSIZE 8192

Ascii85DecodeStream::Ascii85DecodeStream(Blex::Stream &originalstream)
        : Stream(false)
        , state(First)
        , indataptr(0), cdataptr(0), outdatalen(0), avail_in(0)
        , coded_stream(originalstream)
{
        cdata.resize(5);
        bdata.resize(4);
        eof = false;
        source_stream_eof = false;
        corrupted = false;
}

Ascii85DecodeStream::~Ascii85DecodeStream()
{ }

void Ascii85DecodeStream::FillReadBuffers()
{
        indata.resize(ASCII85STREAM_BUFSIZE);
        if (corrupted)
            return;

        uint32_t bytesread=coded_stream.Read(&indata[0],ASCII85STREAM_BUFSIZE);

        avail_in = bytesread;
        indataptr = 0;
}

bool Ascii85DecodeStream::IsWhiteSpace(signed c)
{
        return c == 0 || c == 9 || c == 10 || c == 12 || c == 13 || c == 32;
}

void Ascii85DecodeStream::DecodeBuffer()
{
        //We may have got a final partial group, fill read character buffer with 0's
        for (unsigned i=cdataptr;i<5;++i)
            cdata[i] = 84;

        uint32_t b = (cdata[0]*52200625)+
                (cdata[1]*614125)+
                (cdata[2]*7225)+
                (cdata[3]*85)+
                cdata[4];
//ADDME: The value represented by a group of 5 characters must not be greater than 2^32-1 - Check for overflow!

        bdata[0] = (uint8_t)((b >> 24) & 255);
        bdata[1] = (uint8_t)((b >> 16) & 255);
        bdata[2] = (uint8_t)((b >> 8) & 255);
        bdata[3] = (uint8_t)(b & 255);

        //Any decoded bytes in the bdata buffer?
        if (cdataptr > 1)
        {
                memcpy(&outdata[outdatalen],&bdata[4-(cdataptr-1)],cdataptr-1);
                outdatalen += cdataptr-1;
        }
        cdataptr = 0;
}

void Ascii85DecodeStream::DecodeData()
{
        //Prepare a new output buffer and start decompressing
        outdata.resize(ASCII85STREAM_BUFSIZE);
        outdatalen = 0;

        while (outdatalen < outdata.size() - 4) //Stop short of filling buffers, because the bdata decoder algorithm does not handle partial writes correctly
        {
                if (source_stream_eof)
                    break;

                signed i = ReadSingleByte();
                while (IsWhiteSpace(i))
                    i = ReadSingleByte();
                if (i == -1)
                {
                        outdata.resize(0);
                        corrupted = true;
                        return;
                }
                switch (state)
                {
                        case First:
                        {
                                if (i == '~')
                                    state = Eod;
                                else if (i == 'z')
                                {
                                        //We got four 0 bytes
                                        memset(&outdata[outdatalen], 0, 4);
                                        outdatalen+=4;
                                }
                                else if (i >= '!' && i <= 'v')
                                {
                                        //First of five ASCII-85 bytes
                                        cdata[cdataptr++] = i-33;
                                        state = Next;
                                }
                                else
                                {
                                        //Illegal character
                                        outdata.resize(0);
                                        corrupted = true;
                                        return;
                                }
                        } break;
                        case Next:
                        {
                                if (i == '~' && cdataptr > 1)
                                    state = Eod;
                                else if (i >= '!' && i <= 'v')
                                {
                                        //Next ASCII-85 byte
                                        cdata[cdataptr++] = i-33;
                                        if (cdataptr == 5)
                                        {
                                                DecodeBuffer();
                                                state = First;
                                        }
                                }
                                else
                                {
                                        //Illegal character
                                        outdata.resize(0);
                                        corrupted = true;
                                        return;
                                }
                        } break;
                        case Eod:
                        {
                                if (i == '>')
                                {
                                        //End-of-document
                                        if (cdataptr > 0)
                                        {
                                                DecodeBuffer();
                                        }
                                        source_stream_eof = true;
                                }
                                else
                                {
                                        //Illegal character
                                        outdata.resize(0);
                                        corrupted = true;
                                        return;
                                }
                        } break;
                }
        }
}

signed Ascii85DecodeStream::ReadSingleByte()
{
        if (avail_in == 0)
        {
                FillReadBuffers();
                if (avail_in == 0)
                    return -1;
        }
        --avail_in;
        return indata[indataptr++];
}

bool Ascii85DecodeStream::EndOfStream()
{
        return eof;
}

std::size_t Ascii85DecodeStream::Read(void *buf,std::size_t maxbufsize)
{
        std::size_t totalbytesread=0;
        while (!corrupted && maxbufsize>0 && !eof)
        {
                //There is still decompressed data to send?
                if (outdatalen > 0 && outdatalen <= outdata.size())
                {
                        //yes, send it!
                        std::size_t tosend = std::min<std::size_t>(outdatalen,maxbufsize);

                        memcpy(buf,&outdata[0],tosend);
                        buf = static_cast<uint8_t*>(buf) + tosend;
                        if (tosend < outdatalen) //still bytes left in buffer, move them backwards
                            memmove(&outdata[0], &outdata[tosend], outdatalen-tosend);
                        maxbufsize -= tosend;
                        totalbytesread += tosend;
                        outdatalen -= tosend;
                }
                else //Fill local buffers to their maximum
                {
                        DecodeData();
                        if(outdatalen==0)
                            eof=true;

                }
        }
        return totalbytesread;
}

std::size_t Ascii85DecodeStream::Write(const void *, std::size_t )
{
        throw std::runtime_error("Ascii85DecodeStream::Write - cannot write to a decoding stream");
}

DynamicDecodingStream::DynamicDecodingStream()
        : Stream(false)
        , eof(false)
{
        outbuffer.reserve(PreferredMaximumFill);
}

DynamicDecodingStream::~DynamicDecodingStream()
{ }

// FIXME: Is lzw broken or is the stream in thesis_derooij.pdf really broken?
// It results in a lzw decoding exception
std::size_t DynamicDecodingStream::Read(void *buf,std::size_t maxbufsize)
{
        /* ADDME: Perhaps Blex should offer generalized pull/push mechanics
           for us, Ascii85stream and ZlibStream (they seem to share the same basics) */
        std::size_t bytesread=0;
        while(maxbufsize>0 && !eof)
        {
                if (outbuffer.size())
                {
                        std::size_t toread = std::min(outbuffer.size(), maxbufsize);
                        memcpy(buf, &outbuffer[0], toread);

                        buf = static_cast<char*>(buf) + toread;
                        outbuffer.erase(outbuffer.begin(), outbuffer.begin() + toread);
                        bytesread += toread;
                        maxbufsize -= toread;
                }
                else
                {
                        FillBuffer();
                        if (outbuffer.empty())
                            eof=true;
                }
        }
        return bytesread;
}

std::size_t DynamicDecodingStream::Write(const void *, std::size_t )
{
        throw std::runtime_error("This stream type is read-only");
}

bool DynamicDecodingStream::EndOfStream()
{
        return eof;
}

LZWDecodingStream::LZWDecodingStream(Blex::Stream &in, unsigned databitsize)
        : bitsource(in)
        , databitsize(databitsize)
        , cleartable_code(1 << databitsize)
        , eod_code(cleartable_code + 1)
        , bitspercode(databitsize + 1)
        , previouscode(cleartable_code)
{
        /* Create the initial tables */
        codelimits.resize(eod_code+1);
        codedata.resize(cleartable_code-1);

        /* Initialize the string table - the first 256 strings contain themselves */
        for (unsigned i=0;i<cleartable_code;++i)
        {
                codelimits[i] = i+1;
                codedata[i] = uint8_t(i);
        }
        /* Put sane values in the otherwise unused code limits */
        codelimits[cleartable_code] = codelimits[eod_code] = codelimits[cleartable_code-1];
}

LZWDecodingStream::~LZWDecodingStream()
{
}

inline void LZWDecodingStream::EmitOutput(unsigned code)
{
        uint8_t *codestart = &codedata[code > 0 ? codelimits[code-1] : 0];
        uint8_t *codelimit = &codedata[codelimits[code]];
        outbuffer.insert(outbuffer.end(), codestart, codelimit);
}

void LZWDecodingStream::AddString(unsigned basecode, unsigned extend_with_code)
{
        uint8_t newbyte = codedata[extend_with_code > 0 ? codelimits[extend_with_code-1] : 0];
        unsigned basecodestart = basecode > 0 ? codelimits[basecode-1] : 0;
        unsigned basecodelength = codelimits[basecode] - basecodestart;

        unsigned newcodestart = codedata.size();
        unsigned newcodelimit = newcodestart + basecodelength + 1;

        codelimits.push_back(newcodelimit);

        codedata.resize(newcodelimit);
        memcpy(&codedata[newcodestart], &codedata[basecodestart], basecodelength);
        codedata[newcodelimit-1] = newbyte;

        if (codelimits.size() + 1 >= unsigned(1<<bitspercode)) //maximum code size reached..
            ++bitspercode;
}

void LZWDecodingStream::FillBuffer(void)
{
        while(!codelimits.empty() && outbuffer.size() < PreferredMaximumFill-256)
        {
                unsigned code = bitsource.GetMSBBits(bitspercode);
                if (code == eod_code)
                {
                        codelimits.clear();
                        codedata.clear();
                        break;
                }
                else if (code == cleartable_code)
                {
                        ResetLZWTables();
                }
                else if (previouscode == cleartable_code) //first code..
                {
                        if (code >= codelimits.size())
                            throw std::runtime_error("LZW data corruption, a code was referred that is not in the string table");
                        else
                            EmitOutput(code);
                        previouscode = code;
                }
                else if (code < codelimits.size()) //is code in the string table?
                {
                        /* (yes: output the string for <code> to the charstream;
                            [...] <- translation for <old>;
                            K <- first character of translation for <code>;
                           add [...]K to the string table;        <old> <- <code>;  */
                        EmitOutput(code);
                        AddString(previouscode, code);
                        previouscode = code;
                }
                else if (code > codelimits.size())
                {
                        throw std::runtime_error("LZW data corruption, a code was referred that is not in the string table");
                }
                else
                {
                        /* (no: [...] <- translation for <old>;
                           K <- first character of [...];
                           output [...]K to charstream and add it to string table;
                           <old> <- <code>
                        */
                        AddString(previouscode, previouscode);
                        EmitOutput(GetLastAddedCode());
                }
        }
}

void LZWDecodingStream::ResetLZWTables()
{
        if (codelimits.size() == eod_code+1)
            return; //the tables are already reset

        codelimits.resize(eod_code+1);
        codedata.resize(cleartable_code-1);
        bitspercode=9;
}

/** Stream I/O baseclass. A stream implements streaming I/O, but no
    file pointer repositioning. A stream is not copyable. */
class FilterOwnerStream : public Blex::Stream
{
        public:
        FilterOwnerStream(std::shared_ptr<Blex::Stream> const &_filteredstream
                       ,std::shared_ptr<Blex::Stream> const &_originalstream)
        : Stream(_filteredstream->DoSmallAccessesNeedBuffering())
        , filteredstream(_filteredstream)
        , originalstream(_originalstream)
        {
        }

        private:
        std::shared_ptr<Blex::Stream> filteredstream, originalstream;

        virtual std::size_t Read(void *buf,std::size_t maxbufsize)
        { return filteredstream->Read(buf,maxbufsize); }
        virtual bool EndOfStream()
        { return filteredstream->EndOfStream(); }
        virtual std::size_t Write(void const *buf, std::size_t bufsize)
        { return filteredstream->Write(buf,bufsize); }
};

std::shared_ptr<Blex::Stream> ApplyRC4FilterToStream(void const *key, unsigned keylen, std::shared_ptr<Blex::Stream> const &input_stream)
{
        std::shared_ptr<Blex::RC4CryptingStream> decrypt_stream;
        decrypt_stream.reset(new Blex::RC4CryptingStream(*input_stream));
        decrypt_stream->InitKey(key, keylen);
        return std::shared_ptr<Blex::Stream>(new FilterOwnerStream(decrypt_stream,input_stream));
}

std::shared_ptr<Blex::Stream> ApplyFilterToStream(const std::string &filter_name, std::shared_ptr<Blex::Stream> const &input_stream)
{
        std::shared_ptr<Blex::Stream> filtered;

        if (filter_name == "FlateDecode")
            filtered.reset(Blex::ZlibDecompressStream::OpenZlib(*input_stream));
        else if (filter_name == "ASCII85Decode")
            filtered.reset(new Ascii85DecodeStream(*input_stream));
        else if (filter_name == "LZWDecode")
            filtered.reset(new LZWDecodingStream(*input_stream, 8));
        else
            throw std::runtime_error("Unimplemented filter: " + filter_name);

        return std::shared_ptr<Blex::Stream>(new FilterOwnerStream(filtered,input_stream));
}

}

}

}
