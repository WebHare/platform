#ifndef blex_harescript_modules_pdf_ascii85stream
#define blex_harescript_modules_pdf_ascii85stream

#include <blex/stream.h>
#include "pdf_streams.h"

namespace Parsers
{

namespace Adobe
{

namespace PDF
{

std::shared_ptr<Blex::Stream> ApplyRC4FilterToStream(void const *key, unsigned keylen, std::shared_ptr<Blex::Stream> const &input_stream);
/* Apply a PDF Filter to a given stream and return the filtered stream */
std::shared_ptr<Blex::Stream> ApplyFilterToStream(const std::string &filter_name, std::shared_ptr<Blex::Stream> const &input_stream);

/** Read bits in most-significant-bit first file format */
class BitReader
{
        public:
        BitReader(Blex::Stream &in);
        ~BitReader();

        /** Get up to sizeof(unsigned) * 8 bits. Returns unsigned(-1) at eof. This one seems to be needed for GIF? */
        unsigned GetLSBBits(unsigned numbits);
        /** Get up to sizeof(unsigned) * 8 bits. Returns unsigned(-1) at eof. This one seems to be needed for real LZW*/
        unsigned GetMSBBits(unsigned numbits);
        /** At end of file ? May not become true until AFTER eof is hit! */
        bool Eof();

private:
        Blex::BufferedStream bitsbuffer;
        unsigned curbits; //currently buffered bits. MSB first.
        unsigned bits_in_curbyte;
        bool eof;
};

/** PNG Prediction decoder */
class PNGPredictionDecodeStream : public Blex::Stream
{
        public:
        /** Construct a decoding stream for an existing ASCII-85 encoded stream */
        PNGPredictionDecodeStream(Blex::Stream &originalstream, unsigned columns);

        /** Destroy the decoding stream, and the stream it is based upon */
        virtual ~PNGPredictionDecodeStream();

        //Basic I/O functions. They return the # of bytes read or written,
        //or 0 upon error or EOF
        bool EndOfStream();
        std::size_t Read(void *buf,std::size_t maxbufsize);
        std::size_t Write(const void *buf, std::size_t bufsize);

        private:
        unsigned columns;

        std::vector<uint8_t> decompresseddata;
        unsigned dataoffset;
        bool eof;
};

/** An Ascii85DecodeStream adopts an existing stream and returns decoded data */
class Ascii85DecodeStream
        : public Blex::Stream
{
public:

        /** Construct a decoding stream for an existing ASCII-85 encoded stream */
        Ascii85DecodeStream(Blex::Stream &originalstream);

        /** Destroy the decoding stream, and the stream it is based upon */
        virtual ~Ascii85DecodeStream();

        //Basic I/O functions. They return the # of bytes read or written,
        //or 0 upon error or EOF
        bool EndOfStream();
        std::size_t Read(void *buf,std::size_t maxbufsize);
        std::size_t Write(const void *buf, std::size_t bufsize);

        /** Has the datastream gotten corrupted somehow? */
        inline bool IsCorrupted() const
        {
                return corrupted;
        }

private:

        //Read the next byte
        inline uint8_t ReadByte()
        {
                avail_in--;
                return indata[indataptr++];
        }

        //Decode cdata buffer into bdata buffer
        void DecodeBuffer();

        enum DecodeState
        {
                First,  //Read first byte ('!'-'v', 'z' or '~')
                Next,   //Read following byte ('!'-'v' or '~')
                Eod     //Read '>' after '~'
        } state;

        //Buffer for the data to decompress
        std::vector<uint8_t> indata;
        //Temp buffer for 5 encoded chars
        std::vector<uint8_t> cdata;
        //Temp buffer for 4 decoded bytes
        std::vector<uint8_t> bdata;
        //Buffer for the decompressed data
        std::vector<uint8_t> outdata;

        //Number of coded data bytes we alread read
        uint32_t indataptr;
        //Number of bytes to encode in encode buffer
        uint32_t cdataptr;
        //Number of decoded data bytes we already sent
        uint32_t outdatalen;

        //Available input bytes
        uint32_t avail_in;

        //Stream to decode data from
        Blex::Stream &coded_stream;

        /** Read a single byte from the buffer, refilling the buffer if necessary
            @return the byte, or -1 on EOF */
        signed ReadSingleByte();

        /** Fill the internal buffers as much as possible */
        void FillReadBuffers();

        /** Get a loadful of decoded data*/
        void DecodeData();

        /** Is the character a PDF white-space character? */
        bool IsWhiteSpace(signed c);

        bool corrupted;
        bool eof;
        bool source_stream_eof;
};

class DynamicDecodingStream
        : public Blex::Stream
{
public:
        DynamicDecodingStream();
        ~DynamicDecodingStream();

        bool EndOfStream();
        std::size_t Read(void *buf,std::size_t maxbufsize);
        std::size_t Write(const void *buf, std::size_t bufsize);

        virtual void FillBuffer() = 0;

        protected:
        static const unsigned PreferredMaximumFill = 8192;

        /** Derived classes are suppoed to add to outbuffer and should prevent
            filling it with more than PreferredMaximumFill bytes (but that is
            not an absolute requirement) */
        std::vector<uint8_t> outbuffer;

        private:
        bool eof;
};

class LZWDecodingStream
        : public DynamicDecodingStream
{
        public:
        /** LZW streaming decoder
            @param in Input stream, must exist as long as LZWDecodingStream exists
            @param databitsize Size of underlying compressed data. 8 for plain LZW, might be less for GIF */
        LZWDecodingStream(Blex::Stream &in, unsigned databitsize);
        ~LZWDecodingStream();

        private:
        /** Implementation of dynamic buffer fill */
        virtual void FillBuffer();
        /** Reset the LZW tables */
        void ResetLZWTables();
        /** Output a code to the output buffer */
        inline void EmitOutput(unsigned code);
        /** Add a new string to the code table */
        void AddString(unsigned basecode, unsigned extend_with_code);
        /** Get the last added code */
        unsigned GetLastAddedCode() { return codelimits.size()-1; }

        BitReader bitsource;
        /** Size of underlying compressed data. 8 for LZW, might be less for GIF */
        unsigned const databitsize;
        unsigned const cleartable_code;
        unsigned const eod_code;
        // Number of bits per code
        unsigned bitspercode;
        // The last code we have seen so far
        unsigned previouscode;

        /** The LZW code offset/length table. Records the LIMIT offset of all
            codes in the code table.  */
        std::vector< unsigned > codelimits;
        /** The LZW code data table. If empty, there is no more LZW data */
        std::vector<uint8_t> codedata;
};

}

}

}

#endif
