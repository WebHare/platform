#ifndef blex_mime
#define blex_mime

#ifndef blex_blexlib
#include "blexlib.h"
#endif

#include <vector>
#include <stack>

namespace Blex {

namespace Mime {

/** Is the mimetype any multipart type? */
inline bool IsMultipartType(std::string const &toptype)
{
        return toptype.size() > 10 //length of 'multipart/'
               && Blex::StrCaseCompare(toptype,"multipart/",10) == 0;
}

/** Is the mimetype any text type? */
inline bool IsTextType(std::string const &toptype)
{
        return toptype.size() > 5 //length of 'text/'
               && Blex::StrCaseCompare(toptype,"text/",5) == 0;
}

template <class OutputIterator> class QuotedPrintableDecoder
{
        int curval; //current value. -1 = expecting HEX, just got a '=',  -2 = expecting any characters
        bool underscore_is_space;

        public:
        /** Initialize the decoder, waiting for a byte */
        QuotedPrintableDecoder(OutputIterator _output, bool _underscore_is_space)
        : curval(-2)
        , underscore_is_space(_underscore_is_space)
        , output(_output)
        { }

        /** Convert a hexadecimal char to its true value */
        int HexToInt(char inputbyte)
        {
                if (inputbyte>='0' && inputbyte<='9') return inputbyte - '0';
                if (inputbyte>='A' && inputbyte<='F') return inputbyte - 'A' + 10;
                if (inputbyte>='a' && inputbyte<='f') return inputbyte - 'a' + 10;
                return 0;
        }

        /** Decode a single byte. Return the byte, or -1 if we can't
            decode anything yet */
        void operator() (char inputbyte)
        {
                //Just record this byte
                if (curval==-2)
                {
                        if (inputbyte=='_' && underscore_is_space)
                            *output++=' ';
                        else if (inputbyte=='=')
                            curval=-1;
                        else
                            *output++=inputbyte;
                }
                else  if (curval==-1)
                {
                        if (inputbyte=='\r') //this is a CR eating =
                            return;
                        else if (inputbyte=='\n') //this is the end of a CR eating =
                            curval=-2; //back to normal input mode
                        else //decode this first hex byte..
                            curval=HexToInt(inputbyte) << 4;
                }
                else
                {
                        //Combine inputbyte and stored, and return this new value
                        *output++=uint8_t(HexToInt(inputbyte) | curval);
                        curval=-2; //back to normal input mode
                }
        }

        OutputIterator output;
};

//ADDME: Break lines after 74 characters...

template <class OutputIterator> class QuotedPrintableEncoder
{
        OutputIterator output;
        bool creating_header;
        unsigned charcount;

        public:
        /** Initialize the decoder, waiting for a byte */
        QuotedPrintableEncoder(OutputIterator _output, bool _creating_header)
        : output(_output)
        , creating_header(_creating_header)
        , charcount(0)
        { }

        /** Decode a single byte. Return the byte, or -1 if we can't
            decode anything yet */
        void operator() (char inputbyte)
        {
                if (charcount>70 && !creating_header)
                {
                        *output++='=';
                        *output++='\r';
                        *output++='\n';
                        charcount=0;
                }
                if (creating_header && inputbyte == ' ')
                {
                        *output++='_';
                        ++charcount;
                }
                else if ( (creating_header && (inputbyte == '?'   //https://www.rfc-editor.org/errata/eid506
                                               || inputbyte == '('
                                               || inputbyte == ')'
                                               || inputbyte == '<'
                                               || inputbyte == '>'
                                               || inputbyte == '@'
                                               || inputbyte == ','
                                               || inputbyte == ';'
                                               || inputbyte == ':'
                                               || inputbyte == '"'
                                               || inputbyte == '['
                                               || inputbyte == ']'
                                               || inputbyte == '\\'
                                               || inputbyte == '/'
                                               || inputbyte == '.'))
                          || inputbyte == '_'
                          || inputbyte == '='
                          || inputbyte < 32
                          || inputbyte > 126)
                {
                        *output++='=';
                        *output++=blex_stringmanip_SingleByteToHex(uint8_t(inputbyte)>>4);
                        *output++=blex_stringmanip_SingleByteToHex(uint8_t(inputbyte)&15);
                        charcount+=3;
                }
                else
                {
                        *output++=inputbyte;
                        ++charcount;
                }
         }
};

/** Our HTTP request parser state machine */
class BLEXLIB_PUBLIC HeaderParser
{
        public:
        typedef std::function< void(std::string const &) > Callback;

        private:
        enum ParseState
        {
                ///Parsing fields, waiting for colon
                Parsing,
                ///Got colon, waiting for end of whitespace
                ParseData,
                ///Parsing fields, got CR, waiting for LF
                GotCr,
                ///Parsing fields, got LF
                GotLf,
                ///Parsing fields, got CR LF, if field will actually terminate
                UnsureEnd,
                ///Parsing fields, it is a continued field, eating whitespace
                Skipping,
                ///Parsing done
                Done
        };

        ParseState cur_state;

        std::string parse_data;

        Callback callback;

        public:
        HeaderParser(Callback const & _callback)
        : cur_state(Parsing)
        , callback(_callback)
        {
        }

        void Reset()
        {
                cur_state=Parsing;
                parse_data.clear();
                parse_data.reserve(256);
        }

        bool IsDone() const
        {
                return cur_state==Done;
        }

        void const *ParseHeader(void const *start, void const *limit);
};

/** Mime decoder receiver class. Offers the callbacks to run during mime
    decoding.


    Assume the following message (a message with a text/html and alternative
    plaintext body, contianing one message)

    Multipart/Mixed
    +- Multipart/Alternative
    |  +- Text/plain
    |  `- Text/html
    `- Application/Octet-Stream

    Then, the following receiver calls woul be made:
    StartPart("multipart/mixed","");
     StartPart("multipart/alternative","");
      StartPart("text/plain","Message body");
       ReceiveData(plain_message_body);        (may be invoked multiple times)
      EndPart();
      StartPart("text/html","Message body");
       ReceiveData(html_message_body);         (may be invoked multiple times)
      EndPart();
     EndPart();
     StartPart("application/octet-stream; name=\"your_name.doc\"","");
      ReceiveData(file_data);                  (may be invoked multiple times)
     EndPart();
*/
class BLEXLIB_PUBLIC DecodeReceiver
{
        public:
        /** Invoked when a new piece of mime data starts, which will contain
            other pieces
            @param type Type of the part that will follow
            @param contenttype Full content-type, with subparameters, as described by the application
            @param description Description associated with this file
            @param content_id Content-ID of the file*/
        virtual void StartPart(std::string const &contenttype, std::string const &description, std::string const &encoding, std::string const &disposition, std::string const &content_id, std::string const &original_charset, Blex::FileOffset part_start, Blex::FileOffset body_start) = 0;

        /** Invoked when a piece of data is finished */
        virtual void EndPart(Blex::FileOffset body_end, Blex::FileOffset part_end, unsigned linecount) = 0;

        /** Invoked to process incoming data */
        virtual void ReceiveData(const void *databuffer, unsigned buflen) = 0;

        virtual ~DecodeReceiver() = 0;
};

/** Mime decoder class. Decodes a mime message and invokes callbacks to return
    the data it got.  */
class BLEXLIB_PUBLIC Decoder
{
        public:
        Decoder(DecodeReceiver &receiver, std::string const &defaultcontenttype);
        ~Decoder();

        /** Reste and start mime decoder with offered properties*/
        void Start(std::string const &toptype,
                            std::string const &topencoding,
                            std::string const &topdescription,
                            std::string const &topdisposition,
                            std::string const &topcontentid,
                            Blex::FileOffset data_start_offset,
                            Blex::FileOffset part_start_offset,
                            Blex::FileOffset body_start_offset);

        /** Invoked to process mime-encoded data */
        void ProcessData(const void *databuffer, unsigned buflen);
        const char *ProcessBodyData(Blex::FileOffset buffer_start_offset, const char *start, const char *limit);

        /** Signal end of data */
        void Finish();

        private:
        void HeadersCallback(std::string const &hdr);

        void OpenPart(std::string const &toptype, std::string const &topencoding,std::string const &description, std::string const &disposition, std::string const &content_id, Blex::FileOffset part_boundary_start, Blex::FileOffset part_start, Blex::FileOffset body_start);
        bool ClosePart(Blex::FileOffset end_boundary_start);
        void StartBody(Blex::FileOffset boundary_start, Blex::FileOffset boundary_end, Blex::FileOffset headers_end);
        void ReturnData(const void *databuffer, unsigned buflen);

        /** Different states the mime parser can be in. Note that the
            Read and Hold states depend on being able to do --state or ++state
            to switch between reading/holding, and Hold depends on being
            able to do ++state to go to the boundary-wait stage */
        enum MimeStates
        {
/*                ///Waiting for the starting boundary to appear
                ReadStartBoundary,
                ///Inside a possible start boundary, so hold processing
                HoldStartBoundary,
                ///Got the boundary, waiting for some real data to appear (eat CR/LF)
                WaitForLf,
                ///Inside a possible boundary, so hold processing
                HoldReadBody,
                ///Had the boundary, now see if it is followed by '-' or '\r'
                WaitForBoundaryType,
                ///Done processing mime
                Done,*/

                ///Reading MIME headers
                ReadHeaders,
                ///Reading MIME body
                ReadBody,
//                ///Reading RFC822 message headers
//                ReadRFC822Headers
                // Ignore stuff following end boundary
                IgnoreRest
        };

        enum EncodingType
        {
                ///Standard encoding, nothing to do
                Passthrough,
                ///Base64 encoding
                Base64,
                ///Quoted-printable encoding
                QuotedPrintable
        };

        enum CRLFState
        {
                AtFirstLine,
                AtNone,
                AtCR,
                AtCRLF
        };

        ///Parser of MIME headers
        HeaderParser headers_parser;
        ///Current state of the mime multipart parser
        MimeStates state;
        ///Current data encoding
        EncodingType data_encoding;
        ///Current data charset conversion
        const uint32_t *data_charset;

        ///A base-64 decoder
        typedef Blex::DecoderBase64<std::back_insert_iterator< std::vector<uint8_t> > > MyBase64Decoder;
        ///our decoder object
        MyBase64Decoder base64_decoder;

        ///A quoted-printable decoder
        typedef QuotedPrintableDecoder<std::back_insert_iterator< std::vector<uint8_t> > > MyQPDecoder;
        ///our decoder object
        MyQPDecoder qp_decoder;

        ///Temporary buffer for BASE64/Quoted-Printable decoding
        std::vector<uint8_t> decode_temp;

        ///Temporary buffer for UTF-8 codes
        std::vector<uint8_t> utf8_temp;

        ///Default content type
        std::string const defaultcontenttype;
        ///Last parsed Content-Type header
        std::string last_type;
        ///Last parsed Encoding header
        std::string last_encoding;
        ///Last parsed Description header
        std::string last_description;
        ///Last parsed Disposition header
        std::string last_disposition;
        ///Last parsed Content ID header
        std::string last_content_id;

        /// Internal data about subparts
        struct PartStack
        {
                inline PartStack()
                : body_end(0)
                , body_ended(false)
                , linecount(1)
                , is_partial_match(true)
                , is_complete(false)
                , is_end_boundary(false)
                {}

                /// Position of the end of the body of this part
                Blex::FileOffset body_end;

                /// Wether body has already ended (a subpart has begun)
                bool body_ended;

                /// Number of lines in this part
                unsigned linecount;

                /// Position of start of boundary
                std::string boundary;

                /// Whether a partial match of the boundary has been found
                bool is_partial_match;

                /// Whether the complete boundary has been found (might still be waiting for the end of the line though)
                bool is_complete;

                /// Whether this boundary has a '--' following it (and is the boundary ending the multipart)
                bool is_end_boundary;
        };

        std::vector<PartStack> parts;

        Blex::FileOffset bytes_parsed;

        Blex::FileOffset boundary_start, boundary_end;

        // Line left from last parse (if any part boundary is partially complete
        std::string boundary_buffer;
        bool crlf_before_boundary;
        CRLFState crlfstate;
//        bool last_was_crlf;
        bool have_partial_boundary_matches;


        DecodeReceiver &receiver;
};

/** Decode an 'encoded word' (RFC 2047 text)
    @param size Number of bytes to decode
    @param encoded_bytes Bytes to decode
    @param decoded_output String to append the decoded bytes to, in UTF-8 format */
void BLEXLIB_PUBLIC DecodeEncodedWords(unsigned size, const char *encoded_bytes, std::string *decoded_output);

/** Encode a UTF-8 word as a RFC 2047 encoded word
    @param size Number of bytes to decode
    @param decoded_bytes Bytes to decode
    @param encoded_output String to append the decoded bytes to, in UTF-8 format */
void BLEXLIB_PUBLIC EncodeWords(unsigned size, const char *decoded_bytes, std::string *encoded_output);

/** Is the string a quoted string ? */
inline bool IsQuotedString(std::string::const_iterator const &start, std::string::const_iterator const &end)
{
        return end-start>=2 && *start=='"' && end[-1]=='"';
}

/** Decode a quoted string. The parameters passed to this function should have
    been validated by IsQuotedString()
    @param start Location OF the initial quote
    @param end Limit Location of the final quote */
std::string DecodeQuotedString(std::string::const_iterator start, std::string::const_iterator end);

/** Description of a parameter inside a header field (eg a Content-Type header) */
struct HeaderParam
{
        ///Start of the parameter itself
        unsigned start_parameter;
        ///Start of the parameter's value
        unsigned start_value;
        ///End of the parameter's value
        unsigned end_value;
};

/** look up the start of the specified parameter in the command line
    @param begin Start of the header line to look through
    @param end End of the header line to look through
    @param parameter Parameter to look for
    @return Description of the parameter, or start_parameter==(end-begin) if parameter was not found*/
HeaderParam BLEXLIB_PUBLIC FindHeaderParameter(std::string::const_iterator const &begin, std::string::const_iterator const &end, std::string const &parameter);

/** lookup, extract and decode a parameter from a header */
std::string BLEXLIB_PUBLIC ExtractHeaderParameter(std::string const &header, std::string const &parametername);

/** Remove a parameter from a header */
void BLEXLIB_PUBLIC RemoveHeaderParameter(std::string *header, const HeaderParam &to_remove);

} //end namespace Mime
} //end namespace Blex


#endif
