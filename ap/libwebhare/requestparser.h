#ifndef webhare_webserver_requestparser
#define webhare_webserver_requestparser

#include <blex/mime.h>
#include <blex/path.h>
#include "whcore.h"

namespace WebServer
{
class HeaderParsers;

//ADDME: Switch to the better tested blex::mime functions, but take care that it has a different definition of TSpecial!
/** Is the character a 'TSpecial' ? (HTTP/1.1 paragraph 2.2) */
inline bool IsTSpecial(uint8_t ch)
{
        static const char tspecials[]={"()<>@,;:\\\"/[]?={} \t"};
        static const char *tspecials_end = tspecials + sizeof tspecials - 1;
        return std::find(tspecials, tspecials_end, ch) != tspecials_end;
}
/** Parse a HTTP token, returning the end of the parse */
char const*  ParseToken(char const*  begin, char const*  end, std::string *output);

/** Parse a HTTP quoted string */
char const*  ParseQuotedString(char const*  begin, char const*  end, std::string *output, bool ignore_escaping);


struct WebVar
{
        WebVar();

        std::string contents;
        std::string filename;
        Blex::FileOffset bodystart;
        Blex::FileOffset bodylimit;
        bool ispost;
};

typedef std::multimap<std::string, WebVar, Blex::StrCaseLess <std::string> > WebVars;

typedef std::multimap<std::string, std::string, Blex::StrCaseLess <std::string> > WebHeaders;


enum class Methods
{
        Unknown,
        Get,
        Head,
        Post,
        Options,

        /* WebDAV methods */
        Delete,
        Put,
        Copy,
        Move,
        Lock,
        Unlock,
        Propfind,
        Proppatch,
        Mkcol
};

Methods LookupMethod(unsigned len, const char *request);

///Request accept types
enum class AcceptType
{
        Unrecognized,                   //Didn't recognize this Accept as anything special
        HTML,                           //Looks like the requester wants HTML
        Image                           //Looks like the request wants an image
};

/** A HTTP request parser. This parser will store the header and body of
    a HTTP request, and will extract the variables from the URI and a MIME body */
class BLEXLIB_PUBLIC RequestParser : private Blex::Mime::DecodeReceiver
{
        public:
        class Autostart;

        typedef std::function< bool() > HeaderCompleteCallback;

        enum ErrorCode
        {
                ErrorNone,
                ///Unknown method - must abort connection
                ErrorUnknownMethod,
                ///Unable to create temp file - must abort connection
                ErrorTempCreation,
                ///Unrecognized transfer encoding
                ErrorBadTransferEncoding,
                ///Request overflow or format error
                ErrorBadRequest,
                ///IO error - must abort connection
                ErrorIO
        };

        explicit RequestParser(Blex::ComplexFileSystem &tempfs);
        ~RequestParser();

        ErrorCode GetErrorCode() const { return errorcode; }

        ///Is the parser expecting data (ie, not in a complete or failed state)
        bool IsExpectingData() const { return state != ParsingFailed && state != ParsingDone; }
        ///Is the protocol sane? - no desynch or protocol failure
        bool IsProtocolSane() const { return state != ParsingFailed; }
        ///Has a request been started?
        bool IsRequestStarted() const { return state != ParsingHeaderMethod || !request_line.empty(); }

        ///Get the entire request line (usable for logging)
        const std::string& GetRequestLine() const { return request_line; }

        Methods GetProtocolMethod() const { return protocolmethod; }
        const std::string& GetProtocolMethodString() const { return protocolmethod_string; }

        AcceptType GetAcceptType() const { return accepttype; }

        ///Get the minor protocol revision
        unsigned GetProtocolMinor() const { return minor; }

        ///Get the major protocol revision
        unsigned GetProtocolMajor() const { return major; }

        ///Force major protocol revision
        void SetProtocolMajor(unsigned newmajor) { major = newmajor; }

        ///Get all received web variables
        const WebVars& GetVariables() const { return variables; }

        ///Get all received headers
        const WebHeaders& GetHeaders() const { return headers; }

        ///Get all received cookies
        const WebHeaders& GetCookies() const { return webcookies; }

        ///Clear the internal state of the request parser and the reset 'preserve body' flag
        void ClearState();

        /** Preserve the body as-is, useful for CGI.
            Should be called between ParseHTTPHeader and ParseHTTPBody */
        void PreserveBody()
        {
                body_contenttype = ContentTypes::Undefined;
        }
        /** Drop the body, useful for failed requests.
            Should be called between ParseHTTPHeader and ParseHTTPBody */
        void DropBody()
        {
                body_contenttype = ContentTypes::Dropped;
        }

        /** Parse bytes of an incoming HTTP request. Return the end of the
            parsed data. Will stop parsing as soon as the end of a request header
            or body is found */
        char const* ParseHTTP(char const *start, char const *limit, HeaderCompleteCallback const &hcc_callback);
        ///Call when the current request is finished (EOF received)
        void RequestIsFinished();

        bool IsProxyRequest() const;

        std::string const& GetReceivedUrl() const { return received_url; }
        std::string::const_iterator GetReceivedUrlVarSeparator() const { return received_url_separator; }

        std::string const* GetVariable(const char *varname) const;
        std::string GetVariableValue(const char *varname) const;

        std::string const* GetHeader(const char *headername) const;
        std::string GetHeaderValue(const char *headername) const;

        /** Look up a downloaded file, by variable name */
        Blex::RandomStream * OpenFile(std::string const &name) const;

        /** Get the complete body as an input file */
        Blex::RandomStream * OpenBody() const;

        /** Get the number of bytes in the body */
        uint64_t GetBodyBytesReceived() const
        { return body_bytes_received; }

        Blex::SocketAddress const& GetXforwardedFor() const
        { return xforwardedfor; }

        std::string const& GetXforwardedProto() const
        { return xforwardedproto; }

        bool GetHaveWHProxy() { return have_whproxy; }
        std::string GetWHProxySource() { return whproxy_source; }
        int32_t GetWHProxyBindingOverride() { return whproxy_bindingoverride; }
        std::string const & GetWHProxyProto() { return whproxy_proto; }
        Blex::SocketAddress const & GetWHProxyRemoteAddr() { return whproxy_remote_addr; }
        Blex::SocketAddress const & GetWHProxyLocalAddr() { return whproxy_local_addr; }

        std::string GetRequestedPath() const;

        private:
        /** A transferred file */
        struct TransferredFile
        {
                TransferredFile(const std::string &variable, Blex::FileOffset start)
                  : variable(variable), start(start), length(0)
                {
                }

                /** The variable associated with the file */
                std::string variable;
                /** The file's starting position */
                Blex::FileOffset start;
                /** The file's length */
                Blex::FileOffset length;
        };

        ///Request content types
        enum class ContentTypes
        {
                Undefined,                      //unknown contenttype
                Urlencoded,                     //URL encoded contenttype
                Multipart,                      //multipart data
                Dropped                         //just ignore the body
        };


        friend class Autostart;

        void StartPart(std::string const &contenttype, std::string const &encoding, std::string const &description, std::string const &disposition, std::string const &content_id, std::string const &original_charset, Blex::FileOffset, Blex::FileOffset);
        void EndPart(Blex::FileOffset, Blex::FileOffset, unsigned);
        void ReceiveData(const void *databuffer, unsigned buflen);

        //ADDME share with webscon.h ?
        void Split(char const *tosplit_begin, char const *tosplit_end, char tokensplitter, void (RequestParser::*parsefunc)(char const *, char const *));
        void Split2(char const *tosplit_begin, char const *tosplit_end, char tokensplitter, std::function< void(char const *, char const *) > parsefunc);
        bool TryParseRequestLine(std::string const &requestline);
        void ParseMimeFields(std::string const &parse_data, const HeaderParsers &parsers);
        void ParseHeaderFields(std::string const &parse_data);
        void ParseHeaderFieldParameters    (const char* data_start, const char* data_end, HeaderParsers const &parsers);
        void HTTPHeader_Accept             (const char* begin, const char* end);
        void HTTPHeader_ContentLength      (const char* begin, const char* end);
        void HTTPHeader_ContentType        (const char* begin, const char* end);
        void HTTPHeader_TransferEncoding   (const char* begin, const char* end);
        void HTTPHeader_XForwardedFor      (const char* begin, const char* end);
        void HTTPHeader_Cookie             (const char* begin, const char* end);
        void HTTPHeader_CookiePart         (const char* begin, const char* end);
        void HTTPHeader_CookieParts        (const char* begin, const char* end);
        void HTTPHeader_XWHProxy           (const char* begin, const char* end);
        void HTTPHeader_ParseWHProxyKeyValue(const char* begin, const char* end, std::map< std::string, std::string > *contents);
        void ContentType_Charset           (const char* begin, const char* end);
        void ContentType_Boundary          (const char* begin, const char* end);
        void MIMEHeader_ContentDisposition (const char* begin, const char* end);
        void MIMEDisposition_Name          (const char* begin, const char* end);
        void MIMEDisposition_Filename      (const char* begin, const char* end);
        void MultipartParse(char const *start, char const *limit);

        /** The HTTP message body is sent to this function if the body is Multipart.
            It may be called multiple times (if the body arrives in parts) */
        void BodyReceive(char const *ptr, char const *limit);

        /** The HTTP message body is sent to this function if the body is Urlencoded.
            It may be called multiple times (if the body arrives in parts) */
        void BodyReceiveUrlencoded(char const *ptr, char const *limit);

        /** This function is called when the entire HTTP body has been sent */
        void BodyFinished();

        /** This function is called when the entire multipart header has been sent */
        void MultipartHeaderFinished();

        /** This function is called when the entire multipart body has been sent */
        void MultipartBodyFinished();

        /** The Mime Multipart body is sent to this function. It may be called
            multiple times (if the body arrives in parts) */
        void MultipartBodyReceive(char const *start, char const *limit);

        /** Parse list of URL encoded variables (either a HTTP request URL or a application/x-www-form-urlencoded body
            @param variables_start Start of line
            @param variables_end Limit of line
            @param ispost True if we should mark the processed variables as being part of the POST body */
        void ParseEncodedVars(char const *variable_start, char const *variables_end, bool ispost);

        ///State of the parser
        enum State
        {
                ///Generic parser: expect a CRLF, then goto 'nextstate'
                ExpectCRLF,

                ///Parsing the request header. Parsing a method, parsing any charcter, waiting for CR
                ParsingHeaderMethod,
                ///Parsing the request header. Got CR after method, waiting for LF
                ParsingHeaderGotCr,
                ///Parsing the request header. Headers
                ParsingHeaderHeaders,
                ///Parsing a body chunk header
                ParsingChunkHeader,
                ///Parsing a body chunk
                ParsingChunkPart,
                ///Parsing the chunk trailer
                ParsingChunkTrailer,
                ///Parsing the request body
                ParsingBody,
                ///Request parsing is complete (check error code)
                ParsingDone,
                ///Request parser has failed - terminate connection because satte is unknown
                ParsingFailed
        };

        ErrorCode errorcode;
        State state;
        State nextstate;

        ///The GET/POST... request line received
        std::string request_line;

        ///Client high version number
        unsigned major;
        ///Client low version number
        unsigned minor;
        ///Content length promised by sender
        uint64_t content_length;
        ///Amount of content already received
        uint64_t content_received;

        Blex::Mime::HeaderParser request_headers_parser;
        Blex::Mime::Decoder mime_multipart_parser;

        ///Type of request
        Methods protocolmethod;
        std::string protocolmethod_string;
        ///Looks like it's accepting...
        AcceptType accepttype;

        ///URL received
        std::string received_url;
        ///Position of the URL variable separator
        std::string::const_iterator received_url_separator;
        ///Overridden x-forwarded-for address
        Blex::SocketAddress xforwardedfor;
        ///Overridden x-forwarded-proto scheme (http, https)
        std::string xforwardedproto;

        /// is there a valid x-wh-proxy-header?
        bool have_whproxy;
        /// x-wh-proxy source
        std::string whproxy_source;
        /// x-wh-proxy binding override
        int32_t whproxy_bindingoverride;
        /// x-wh-proxy protocol
        std::string whproxy_proto;
        /// x-wh-proxy remote address
        Blex::SocketAddress whproxy_remote_addr;
        /// x-wh-proxy local address
        Blex::SocketAddress whproxy_local_addr;

        ///Headers passed with the request (ADDME: map instead of multimap would suffice)
        WebHeaders headers;

        ///Variables passed with this request
        WebVars variables;

        ///Cookies passed to us
        WebHeaders webcookies;

        ///Content type of the body
        ContentTypes body_contenttype;

        ///The currently parsed variable
        WebVar *current_var;

        ///Expect chuncked body
        bool body_chunked;

        ///Current chunk header
        std::string chunkheader;
        ///Current chunk size
        uint64_t chunksize;

        unsigned mimelevel;

        std::vector<uint8_t> tempstore;

        ///Currently received content
        std::string protocol_content_data;
        ///Outstream name
        std::string outstreamname;
        ///Output stream for big request variables or bodies
        std::shared_ptr<Blex::RandomStream> outstream;
        ///Number of body bytes received?
        uint64_t body_bytes_received;
        ///Temporary storage
        Blex::ComplexFileSystem &tempfs;
};

} //end namespace webserver


#endif
