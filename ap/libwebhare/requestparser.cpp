#include <ap/libwebhare/allincludes.h>


#include <blex/path.h>
#include <blex/utils.h>
#include "requestparser.h"

//ADDME: DO we need character set tranformations on post multipart and/or urlencoded data?

//#define PROTOCOLDEBUG(x) DEBUGONLY(x)         //Enable protocol debugging
#define PROTOCOLDEBUG(x)                        //Disable protocol debugging

namespace WebServer
{

///maximum length for a received variable
const unsigned MaxVarLength = 4096;

const unsigned MaxMemoryTempStore=32768; //start flushing to disk after 32K

const char url_separators[] = "?&;";
const char *url_separators_end = url_separators + (sizeof url_separators) - 1;

/** Parse a HTTP token, returning the end of the parse */
char const*  ParseToken(char const*  begin, char const*  end, std::string *output)
{
        for (; begin != end && *begin>32 && !IsTSpecial(*begin); ++begin)
            output->push_back(*begin);

        return begin;
}

/** Parse a HTTP quoted string */
char const*  ParseQuotedString(char const*  begin, char const*  end, std::string *output, bool ignore_escaping)
{
        if (*begin!='"')
            return begin;

        for (++begin; begin != end; ++begin)
        {
                if (*begin=='"')
                    return begin+1;

                if (*begin=='\\' && !ignore_escaping) //escape next character
                    ++begin;

                output->push_back(*begin);
        }
        return begin;
}

WebVar::WebVar()
: bodystart(0)
, bodylimit(0)
, ispost(false)
{
}

RequestParser::RequestParser(Blex::ComplexFileSystem &tempfs)
: request_headers_parser( std::bind(&RequestParser::ParseHeaderFields,this,std::placeholders::_1) )
, mime_multipart_parser( *this,"text/plain" )
, tempfs(tempfs)
{
        ClearState();
}

RequestParser::~RequestParser()
{
}

void RequestParser::ClearState()
{
        //ADDME: we surely don't have to clean THIS much stuff?
        state = ParsingHeaderMethod;
        errorcode = ErrorNone;
        request_line.clear();
        major=0;
        minor=9; //HTTP0.9 is default
        protocolmethod = Methods::Unknown;
        accepttype = AcceptType::Unrecognized;
        content_received=0;
        content_length = 0;
        received_url.clear();
        headers.clear();
        variables.clear();
        body_contenttype = ContentTypes::Undefined;
        outstream.reset();
        webcookies.clear();
        if(!outstreamname.empty())
        {
                tempfs.DeletePath(outstreamname);
                outstreamname.clear();
        }
        protocol_content_data.clear();
        chunkheader.clear();
        body_bytes_received=0;
        body_chunked=false;
        xforwardedfor = Blex::SocketAddress();
        xforwardedproto.clear();

        have_whproxy = false;
        whproxy_source.clear();
        whproxy_bindingoverride = 0;
        whproxy_proto.clear();
        whproxy_remote_addr = Blex::SocketAddress();
        whproxy_local_addr = Blex::SocketAddress();

        current_var=0;
        tempstore.resize(0);
}

char const* RequestParser::ParseHTTP(char const *start, char const *limit, HeaderCompleteCallback const &hcc_callback)
{
        while(start != limit)
        {
                switch (state)
                {
                        case ParsingHeaderMethod:
                        {
                                //Eat all till the '\r'
                                char const *first_cr = std::find(start,limit,'\r');
                                //If no '\r' was found, then maybe only '\n' is used
                                if (first_cr==limit)
                                    first_cr = std::find(start,limit,'\n');

                                //No '\r' or '\n' found, maybe a '\0' ?
                                if(first_cr==limit)
                                {
                                        char const *first_null = std::find(start, limit, '\0');
                                        if(first_null != limit)
                                        {
                                                request_line.insert(request_line.end(), start, first_null);
                                                start = first_null + 1;

                                                errorcode = ErrorUnknownMethod;
                                                state = ParsingFailed;
                                                break;
                                        }
                                }

                                //Append to the current request line
                                request_line.insert(request_line.end(),start,first_cr);
                                //Got a \r? Then up to the GotCr state!
                                if (first_cr!=limit)
                                {
                                        state=ParsingHeaderGotCr;
                                        if (*first_cr=='\r')
                                            start=first_cr+1; //move ptr past cr
                                }
                                else
                                {
                                        //Not - just on to the next data
                                        start=first_cr;
                                }
                                continue;
                        }

                        case ParsingHeaderGotCr:
                        {
                                if (*start=='\n') //Skip linefeed, but accept none appearing..
                                    ++start;

                                if (request_line.empty())
                                {
                                        DEBUGPRINT("Method_Parsing: Lame HTTP client - empty request line");
                                        state = ParsingHeaderMethod;
                                        continue;
                                }

                                if (!TryParseRequestLine(request_line))
                                {
                                        //We failed to parse the client
                                        //ADDME: Properly implement 'Method not implemented' instead of this failure
                                        state = ParsingFailed;
                                        errorcode = ErrorUnknownMethod;
                                        break;
                                }

                                if (major<1)
                                {
                                        DEBUGPRINT("Method_Parsing: Got HTTP/0.9 request, moving to Responding");
                                        state = ParsingDone;
                                        if(hcc_callback)
                                          if(!hcc_callback()) //body must be ignored
                                            DropBody();
                                        break;
                                }

                                PROTOCOLDEBUG(DEBUGPRINT("Method_Parsing: Got HTTP/1.0+ request, moving to Fields_Parsing"));
                                request_headers_parser.Reset();
                                state = ParsingHeaderHeaders;
                                continue;
                        }

                        case ParsingHeaderHeaders:
                        {
                                //Let the header parser take as much bytes
                                //as he can, and we'll handle the remainder
                                start = static_cast<const char*>(request_headers_parser.ParseHeader(start,limit));
                                if (request_headers_parser.IsDone())
                                {
                                        //ADDME: shouldn't expect a body on a HEAD request no matter what content-length says? see rfc 2616 4.4 1
                                        state = body_chunked ? ParsingChunkHeader : content_length==0 ? ParsingDone : ParsingBody;
                                        if(hcc_callback)
                                          if(!hcc_callback()) //body must be ignored
                                            DropBody();
                                }
                                continue;
                        }

                        case ExpectCRLF: //Expect \r\n - tolerant of missing \r or \n
                        {
                                if(*start=='\r')
                                {
                                        ++start;
                                        continue;
                                }
                                if(*start=='\n')
                                    ++start;
                                state = nextstate;
                                continue;
                        }

                        case ParsingChunkHeader:
                        {
                                while(start!=limit)
                                {
                                        if(chunkheader.size()>=1024) //overflow attempt
                                        {
                                                DEBUGPRINT("Method_Parsing: Bad chunk length");
                                                errorcode=ErrorBadRequest;
                                                state = ParsingFailed;
                                                break;
                                        }
                                        if(*start=='\r' || *start=='\n')
                                        {
                                                std::pair<uint64_t, std::string::iterator> retval = Blex::DecodeUnsignedNumber<uint64_t>(chunkheader.begin(), chunkheader.end(), 16);
                                                if(retval.second != chunkheader.end())
                                                {
                                                        DEBUGPRINT("Method_Parsing: Corrupt chunk header");
                                                        errorcode = ErrorBadRequest;
                                                        state = ParsingFailed;
                                                        break;
                                                }
                                                chunksize = retval.first;
                                                state = ExpectCRLF;
                                                nextstate = chunksize==0 ? ParsingChunkTrailer : ParsingChunkPart;
                                                break;
                                        }
                                        chunkheader += *start++;
                                }
                                break;
                        }

                        case ParsingChunkPart:
                        {
                                //How much to pass to the body parser?
                                unsigned to_pass = std::min<unsigned>(chunksize - content_received, limit - start);
                                BodyReceive(start, start + to_pass);

                                //Update the number of bytes passed to the parser and our counter
                                body_bytes_received += to_pass;
                                chunksize -= to_pass;
                                start += to_pass;

                                if (chunksize == 0) //Finished
                                {
                                        chunkheader.clear();
                                        state = ExpectCRLF;
                                        nextstate = ParsingChunkHeader;
                                }
                                break;
                        }

                        case ParsingChunkTrailer:
                        {
                                start = static_cast<const char*>(request_headers_parser.ParseHeader(start,limit));
                                if (request_headers_parser.IsDone())
                                {
                                        //ADDME: Send the second stream of headers to the user too, but how?
                                        //       Should we have delayed after seeing 'trailers' ?
                                        state = ParsingDone;
                                }
                                break;
                        }

                        case ParsingBody:
                        {
                                //How much to pass to the body parser?
                                unsigned to_pass = content_length ? std::min<unsigned>(content_length - content_received, limit - start) : limit-start;
                                if(to_pass > 0)
                                {
                                        BodyReceive(start, start + to_pass);

                                        //Update the number of bytes passed to the parser and our counter
                                        body_bytes_received += to_pass;
                                        content_received += to_pass;
                                        start += to_pass;
                                }

                                //Finished?
                                if (content_received == content_length)
                                {
                                        BodyFinished();
                                        state = ParsingDone;
                                }
                                break;
                        }

                        case ParsingDone:
                        case ParsingFailed:
                                return start;
                }
        }
        return start;
}

void RequestParser::RequestIsFinished()
{
        if(state != ParsingBody)
        {
                DEBUGPRINT("Unexpected parsing body");
                state = ParsingFailed;
                errorcode = ErrorBadRequest;
                return;
        }
        BodyFinished();
        state = ParsingDone;
}

Methods LookupMethod(unsigned len, const char *request)
{
       if (len==3 && std::equal(request,request + len,"GET"))
            return Methods::Get;
        else if (len==4 && std::equal(request,request + len,"POST"))
            return Methods::Post;
        else if (len==4 && std::equal(request,request + len,"HEAD"))
            return Methods::Head;
        else if (len==4 && std::equal(request,request + len,"COPY"))
            return Methods::Copy;
        else if (len==4 && std::equal(request,request + len,"MOVE"))
            return Methods::Copy;
        else if (len==4 && std::equal(request,request + len,"LOCK"))
            return Methods::Lock;
        else if (len==7 && std::equal(request,request + len,"OPTIONS"))
            return Methods::Options;
        else if (len==5 && std::equal(request,request + len,"MKCOL"))
            return Methods::Mkcol;
        else if (len==6 && std::equal(request,request + len,"UNLOCK"))
            return Methods::Unlock;
        else if (len==6 && std::equal(request,request + len,"DELETE"))
            return Methods::Delete;
        else if (len==8 && std::equal(request,request + len,"PROPFIND"))
            return Methods::Propfind;
        else if (len==9 && std::equal(request,request + len,"PROPPATCH"))
            return Methods::Proppatch;
        else
            return Methods::Unknown; //not a method WE know about..
}

void RequestParser::Split(char const*  tosplit_begin, char const*  tosplit_end, char tokensplitter, void (RequestParser::*parsefunc)(char const* , char const* ))
{
        //Loop for all fields
        while (true)
        {
                //Find the ',' that seperates tokens
                char const*  tokenend=std::find(tosplit_begin,tosplit_end,tokensplitter);

                //Send the token to the protocol
                (this->*parsefunc)(tosplit_begin,tokenend);

                //And move to the next token, skipping spaces
                if (tokenend!=tosplit_end)
                    tosplit_begin=Blex::FindNot(tokenend+1,tosplit_end,' ');
                else
                    break;
        }
}

void RequestParser::Split2(char const  *tosplit_begin, char const *tosplit_end, char tokensplitter, std::function< void(char const *, char const *) > parsefunc)
{
        //Loop for all fields
        while (true)
        {
                //Find the ',' that seperates tokens
                char const*  tokenend=std::find(tosplit_begin,tosplit_end,tokensplitter);

                //Send the token to the protocol
                parsefunc(tosplit_begin,tokenend);

                //And move to the next token, skipping spaces
                if (tokenend!=tosplit_end)
                    tosplit_begin=Blex::FindNot(tokenend+1,tosplit_end,' ');
                else
                    break;
        }
}

bool RequestParser::TryParseRequestLine(std::string const &requestline)
{
        /* HTTP/1.1, 5.1:
           Request-Line = Method SP Request-URI SP HTTP-Version CRLF */
        std::string::const_iterator first_space = std::find(requestline.begin(),requestline.end(),' ');
        unsigned len = first_space - requestline.begin();

        if (len == 0 || first_space == requestline.end())
            return false;

        protocolmethod_string.assign(requestline.begin(), first_space);
        Blex::ToUppercase(protocolmethod_string);
        protocolmethod = LookupMethod(protocolmethod_string.size(), &protocolmethod_string[0]);

        //Find the protocol seperator space (first_space+1 is safe, because *first_space is guaranteed to be a ' ')
        std::string::const_iterator proto=std::find(first_space+1,requestline.end(),' ');

        //Store the url (it's between the first space and the protocol space, if any)
        received_url.assign(first_space+1,proto);

        //Do we have a url variable separator in the url?
        received_url_separator = std::find_first_of(received_url.begin(), received_url.end(), url_separators,url_separators_end);

        //Decode web variables, if any (they appear after the '?')
        if (received_url_separator != received_url.end())
            ParseEncodedVars(&*received_url_separator+1, &*received_url.end(), false);

        //Decode the protocol
        if (proto!=requestline.end()) //Protocol should be there..
        {
                if (requestline.end()-proto<6
                    || !std::equal(proto+1,proto+6,"HTTP/"))
                     return true; //no version apparently..

                std::pair<unsigned,std::string::const_iterator> highversion = Blex::DecodeUnsignedNumber<unsigned>(proto+6,requestline.end());
                if (highversion.second == proto+6 || *highversion.second!='.')
                    return true; //no version found..

                std::pair<unsigned,std::string::const_iterator> lowversion = Blex::DecodeUnsignedNumber<unsigned>(highversion.second+1,requestline.end());
                DEBUGONLY(if (lowversion.second != requestline.end()) DEBUGPRINT("Garbage after version!"));
                major=highversion.first;
                minor=lowversion.first;
        }

        //DEBUGPRINT(request.received_url);
        return true;
}

void RequestParser::ParseHeaderFields(std::string const &headerline)
{
        static const char accept[] = "Accept";
        static const char contenttype[] = "Content-Type";
        static const char contentlength[] = "Content-Length";
        static const char transferencoding[] = "Transfer-Encoding";
        static const char xforwardedfor[] = "X-Forwarded-For";
        static const char xforwardedproto[] = "X-Forwarded-Proto";
        static const char cookie[] = "Cookie";
        static const char xwhproxy[] = "X-WH-Proxy";

        std::string::const_iterator colon = std::find(headerline.begin(),headerline.end(),':');
        if (colon==headerline.end())
            return;

        //skip colon & whitespace
        std::string::const_iterator remaining_data = colon+1;
        while (remaining_data != headerline.end() && Blex::IsWhitespace(*remaining_data))
            ++remaining_data;

        //special handling of content-length
        if (Blex::StrCaseCompare(&*headerline.begin(),&*colon, contentlength,contentlength+sizeof contentlength-1)==0)
        {
                content_length = Blex::DecodeUnsignedNumber<unsigned>(remaining_data,headerline.end()).first;
        }

        //special handler of transfer-encoding
        else if (Blex::StrCaseCompare(&*headerline.begin(),&*colon, transferencoding, transferencoding + sizeof transferencoding-1)==0)
        {
                HTTPHeader_TransferEncoding(&*remaining_data,&*headerline.end());
        }

        //X-Forwarded-For may need handling too
        else if (Blex::StrCaseCompare(&*headerline.begin(),&*colon, xforwardedfor, xforwardedfor + sizeof xforwardedfor - 1)==0)
        {
                HTTPHeader_XForwardedFor(&*remaining_data,&*headerline.end());
        }

        //X-Forwarded-Proto may need handling too
        else if (Blex::StrCaseCompare(&*headerline.begin(),&*colon, xforwardedproto, xforwardedproto + sizeof xforwardedproto - 1)==0)
        {
                this->xforwardedproto.assign(&*remaining_data,&*headerline.end());
        }

        //see if this is a known and parseable body type
        else if (Blex::StrCaseCompare(&*headerline.begin(),&*colon, contenttype, contenttype+sizeof contenttype-1)==0)
        {
                HTTPHeader_ContentType(&*remaining_data,&*headerline.end());
        }

        //Cookie handling moves to requestparser as accesrules switch on it
        else if (Blex::StrCaseCompare(&*headerline.begin(),&*colon, cookie, cookie+sizeof cookie-1)==0)
        {
                HTTPHeader_Cookie(&*remaining_data,&*headerline.end());
        }

        //X-WH-Proxy also needs handling
        else if (Blex::StrCaseCompare(&*headerline.begin(),&*colon, xwhproxy, xwhproxy+sizeof xwhproxy-1)==0)
        {
                HTTPHeader_XWHProxy(&*remaining_data, &*headerline.end());
                DEBUGONLY(if (!have_whproxy) DEBUGPRINT("Invalid X-WH-Proxy header: " << std::string(&*remaining_data, &*headerline.end())));
        }

        //Accept:
        else if (Blex::StrCaseCompare(&*headerline.begin(),&*colon, accept, accept+sizeof accept-1)==0)
        {
                HTTPHeader_Accept(&*remaining_data, &*headerline.end());
        }

        std::string header(headerline.begin(),colon);
        WebHeaders::iterator hdritr = headers.find(header);
        if (hdritr==headers.end())
        {
                //this is the first time we see this header, just store it
                headers.insert(std::make_pair(header,std::string(remaining_data,headerline.end())));
        }
        else
        {
                //merge the header with the existing header
                hdritr->second.push_back(',');
                hdritr->second.insert(hdritr->second.end(),remaining_data,headerline.end());
        }
}

void RequestParser::HTTPHeader_Cookie(const char* begin, const char* end)
{
        Split(begin,end,',',&RequestParser::HTTPHeader_CookiePart);
}
void RequestParser::HTTPHeader_CookiePart(char const*  begin, char const*  end)
{
        //Officially, header should be merged with commas, but Cookies use semicolons
        Split(begin,end,';',&RequestParser::HTTPHeader_CookieParts);
}
void RequestParser::HTTPHeader_CookieParts(char const*  begin, char const*  end)
{
        std::string name, value;

        begin = ParseToken(begin,end,&name);
        if (begin==end || *begin!='=')
        {
                DEBUGPRINT("Ill-formatted HTTP cookie header");
                return;
        }
        ++begin; //move behind the '='
        if (begin != end && *begin == '"')
            begin = ParseQuotedString(begin,end,&value,false);
        else
            begin = ParseToken(begin,end,&value);

        DEBUGONLY(if (begin!=end)
            DEBUGPRINT("Garbage after parsed cookie"));

        webcookies.insert(std::make_pair(name,value));
}
void RequestParser::HTTPHeader_XForwardedFor(const char* begin, const char* end)
{
        if(begin==end)
            return;

        //only storing last address for now
        const char *ipbegin = end-1;
        while(ipbegin>=begin && *ipbegin != ',')
            --ipbegin;

        if(*ipbegin==',') //position after comma
            ++ipbegin;

        //strip whitespace
        while(ipbegin!=end && *ipbegin==' ')
            ++ipbegin;

        std::string temp(ipbegin, end); //ADDME optimize
        xforwardedfor.SetIPAddress(temp);
}

void RequestParser::HTTPHeader_Accept(const char* begin, const char* end)
{
        if(begin==end || accepttype == AcceptType::HTML) //something silly as multiple Accept: lines where an earlier already matched?
            return; //we can never move on from HTML

        //This is just a heuristic... we could use smarter matching i guess, accept header is more complex than we actually underestand here
        static const char texthtml[] = "text/html";
        if(std::search(begin, end, texthtml, texthtml + sizeof(texthtml) -1) != end)
        {
                accepttype = AcceptType::HTML;
                return;
        }

        static const char image[] = "image/";
        if(std::search(begin, end, image, image + sizeof(image) -1) != end)
        {
                accepttype = AcceptType::Image;
                return;
        }
}

void RequestParser::HTTPHeader_XWHProxy(const char* begin, const char* end)
{
        if(begin==end)
            return;

        std::map< std::string, std::string > keyvals;
        Split2(begin, end, ';', [this, &keyvals](char const *b, char const *e) { HTTPHeader_ParseWHProxyKeyValue(b, e, &keyvals); });

        // Check for existance of source and proto params
        if (keyvals["source"].empty() || keyvals["proto"].empty())
        {
                DEBUGPRINT("Invalid X-WH-Proxy header: empty source or proto");
                return;
        }

        // Parse 'binding' param if present
        int32_t parsed_binding = 0;
        if (keyvals.find("binding") != keyvals.end())
        {
                std::string const &binding_str = keyvals["binding"];
                auto binding = Blex::DecodeSignedNumber< int32_t >(binding_str.begin(), binding_str.end());
                if (binding.second != binding_str.end() || binding.first < 0)
                {
                        DEBUGPRINT("Invalid X-WH-Proxy header: invalid binding id '" << binding_str << "'");
                        return;
                }
                parsed_binding = binding.first;
        }

        // Remote address is required, check it
        Blex::SocketAddress remote_addr;
        remote_addr.SetIPAddress(keyvals["for"]);
        if (remote_addr.IsAnyAddress())
        {
                DEBUGPRINT("Invalid X-WH-Proxy header: invalid remote address '" << keyvals["for"] << "'");
                return;
        }

        // Local addr should be an IP address + port (if present)
        Blex::SocketAddress localaddr;
        if (keyvals.find("local") != keyvals.end())
        {
            try
            {
                    localaddr = Blex::SocketAddress(keyvals["local"]);
                    if (localaddr.IsAnyAddress())
                    {
                            DEBUGPRINT("Invalid X-WH-Proxy header: invalid local address '" << localaddr << "', isanyaddress");
                            return;
                    }
            }
            catch (std::exception &DEBUGONLYARG(e))
            {
                    DEBUGPRINT("Invalid X-WH-Proxy header: invalid local address '" << keyvals["local"] << "', could not parse: " << e.what());
                    return;
            }
        }
        else
            localaddr = Blex::SocketAddress();

        have_whproxy = true;
        whproxy_source = keyvals["source"];
        whproxy_bindingoverride = parsed_binding;
        whproxy_proto = keyvals["proto"];
        whproxy_remote_addr = remote_addr;
        whproxy_local_addr = localaddr;
}

void RequestParser::HTTPHeader_ParseWHProxyKeyValue(char const *begin, char const *end, std::map< std::string, std::string > *contents)
{
        std::string name;

        DEBUGPRINT("Parsing key-value '" << std::string(begin, end) << "'");

        // eat initial spaces
        while (begin != end && *begin == ' ')
            ++begin;

        begin = ParseToken(begin, end, &name);

        if (begin==end || *begin!='=')
        {
                DEBUGPRINT("Ill-formatted HTTP header");
                return;
        }
        ++begin; //move behind the '='

        // strip end spaces
        const char *strend = end;
        while (strend != begin && strend[-1] == ' ')
            --strend;

        DEBUGPRINT(" Parsed '" << name << "'='" << std::string(begin, strend) << "'");

        contents->insert(std::make_pair(name, std::string(begin, strend)));
}

void RequestParser::HTTPHeader_TransferEncoding(const char* begin, const char* end)
{
        static const char identity[]="identity";
        static const char chunked[]="chunked";

        const char* type_end = std::find(begin,end,';');

        if (Blex::StrCaseCompare(begin, type_end, identity, identity + sizeof identity-1)==0)
        {
                //This is the standard encoding, ignore
                return;
        }
        else if (Blex::StrCaseCompare(begin, type_end, chunked, chunked + sizeof chunked-1)==0)
        {
                body_chunked = true;
        }
        else
        {
                errorcode = ErrorBadTransferEncoding;
                state = ParsingFailed;
        }
}

/* ADDME: If we wish, we could just forward all the data to the mime parser
   and listen for its events. Perhaps the mime parser could then also take
   care of content encodings and character set conversions */
void RequestParser::HTTPHeader_ContentType(const char* begin, const char* end)
{
        static const char urlencoded[]="application/x-www-form-urlencoded";
        static const char formdata[]="multipart/form-data";

        const char* type_end = std::find(begin,end,';');

        if (Blex::StrCaseCompare(begin,type_end,urlencoded,urlencoded+sizeof urlencoded-1)==0)
        {
                body_contenttype = ContentTypes::Urlencoded;
        }
        else if (Blex::StrCaseCompare(begin,type_end,formdata,formdata+sizeof formdata-1)==0)
        {
                //ADDME: Handle Charset ?!
                body_contenttype = ContentTypes::Multipart;
                mimelevel=0;
                mime_multipart_parser.Start(std::string(begin,end),std::string(),std::string(),std::string(),std::string(), 0, 0, 0);
        }
        else
        {
                DEBUGPRINT("Content-Type: unknown content type: " << std::string(begin,type_end));
        }
}

void RequestParser::StartPart(std::string const &/*contenttype*/, std::string const &/*encoding*/, std::string const &/*description*/, std::string const &disposition, std::string const &/*content_id*/, std::string const &/*original_charset*/, Blex::FileOffset, Blex::FileOffset body_start)
{
        ++mimelevel;
        if (mimelevel == 2) //This is an interesting part!
        {
                std::string varname;

                Blex::Mime::HeaderParam get_name = Blex::Mime::FindHeaderParameter(disposition.begin(),disposition.end(),"name");
                if (get_name.start_parameter != disposition.size()) //we have a name!
                {
                        std::string::const_iterator databegin = disposition.begin() + get_name.start_value;
                        std::string::const_iterator dataend = disposition.begin() + get_name.end_value;

                        //IE performs incorrect encoding on filenames, so we
                        //cannot safely decode such names  (old code: //Blex::DecodeJava(assignment+2,end-1,std::back_inserter(*to_assign));
                        if (dataend-databegin >= 2 && databegin[0]=='"' && dataend[-1]=='"') //it's quoted!
                            varname.assign(databegin+1,dataend-1);
                        else //unqouted
                            varname.assign(databegin,dataend);
                }

                current_var = &variables.insert(std::make_pair (varname, WebVar()))->second;
                current_var->ispost = true;
                current_var->bodystart = body_start;

                Blex::Mime::HeaderParam get_filename = Blex::Mime::FindHeaderParameter(disposition.begin(),disposition.end(),"filename");
                if (get_filename.start_parameter != disposition.size()) //we have a name!
                {
                        std::string::const_iterator databegin = disposition.begin() + get_filename.start_value;
                        std::string::const_iterator dataend = disposition.begin() + get_filename.end_value;

                        //IE performs incorrect encoding on filenames, so we
                        //cannot safely decode such names  (old code: //Blex::DecodeJava(assignment+2,end-1,std::back_inserter(*to_assign));
                        if (dataend-databegin >= 2 && databegin[0]=='"' && dataend[-1]=='"') //it's quoted!
                            current_var->filename.assign(databegin+1,dataend-1);
                        else //unqouted
                            current_var->filename.assign(databegin,dataend);
                }
        }
}
void RequestParser::EndPart(Blex::FileOffset body_limit, Blex::FileOffset, unsigned)
{
        if (mimelevel == 2)
        {
                current_var->bodylimit = body_limit;
                current_var=NULL;
        }
        --mimelevel;
}
void RequestParser::ReceiveData(const void *databuffer, unsigned buflen)
{
        if (mimelevel != 2)
        {
                DEBUGPRINT("Receiving mime body without a variable");
                return;
        }

        //first 4k of each var is cached in memory too (ADDME: Combine this cache with the 'external' cache!)
        if (current_var && current_var->contents.size() < MaxVarLength)
        {
                //process as much data as we can
                unsigned to_copy = std::min<unsigned>(buflen, MaxVarLength - current_var->contents.size());
                current_var->contents.insert(current_var->contents.end(), static_cast<const uint8_t*>(databuffer), static_cast<const uint8_t*>(databuffer) + to_copy);
        }
}

//-----------------------------------------------------------------------------
//
//
// Request entity (message body) protocol
//
//
//-----------------------------------------------------------------------------
void RequestParser::BodyFinished()
{
        switch(body_contenttype)
        {
        case ContentTypes::Urlencoded:
                ParseEncodedVars(&*protocol_content_data.begin(), &*protocol_content_data.end(), true);
                break;
        case ContentTypes::Multipart:
                mime_multipart_parser.Finish();
                break;
        default:
                return;
        }
}

void RequestParser::BodyReceive(char const *start, char const *limit)
{
        switch (body_contenttype)
        {
        case ContentTypes::Urlencoded:
                BodyReceiveUrlencoded(start,limit);
                break;
        case ContentTypes::Multipart:
                mime_multipart_parser.ProcessData(start,limit-start);
                break;
        case ContentTypes::Undefined:
                break; //just store it..
        case ContentTypes::Dropped:
                DEBUGPRINT("Ignoring " << int(limit-start) << " bytes because the request will fail anyway");
                return; //ignore
        }

        //Flush physical data to temporary storage
        if(tempstore.size() < MaxMemoryTempStore)
        {
                unsigned to_copy = std::min<unsigned>(limit-start, MaxMemoryTempStore - tempstore.size());
                tempstore.insert(tempstore.end(), start, start + to_copy);
                start+=to_copy;
        }
        if(tempstore.size() >= MaxMemoryTempStore) //we need to start overflowing to disk...
        {
                if(!outstream.get())
                {
                        //Get a nice tempfile in this directory
                        //ADDME: use segmented buffers and only overflow into a file when stuff gets REALLY big
                        //ADDME: Limit maximum upload size
                        outstream.reset(tempfs.CreateTempFile(&outstreamname));
                        if (!outstream.get())
                        {
                                state = ParsingFailed;
                                errorcode = ErrorTempCreation;
                                return;
                        }

                        if (outstream->Write(&tempstore[0], tempstore.size())!=unsigned(tempstore.size()))
                        {
                                state = ParsingFailed;
                                errorcode = ErrorIO;
                                return;
                        }
                }
                if(start!=limit && outstream->Write(start, limit-start)!=unsigned(limit-start))
                {
                        state = ParsingFailed;
                        errorcode = ErrorIO;
                        return;
                }
        }
}
void RequestParser::BodyReceiveUrlencoded(char const *start, char const *limit)
{
        //ADDME: Parse immediately, to get rid of 'content_data' inbetween
        /* ADDME: What we _should_ do is truncate all variables to 4096, but
                  still pass on the variables that didn't overflow. That gives
                  the underlying interface page a better chance to deal with
                  the overflow (&folder= won't be cut off) */
        protocol_content_data.insert(protocol_content_data.end(), start, limit);
}


//-----------------------------------------------------------------------------
//
//
// MIME data protocol
//
//
//-----------------------------------------------------------------------------

/** Look up a downloaded file, by variable name */
Blex::RandomStream * RequestParser::OpenFile(std::string const &name) const
{
        /* FIXME What prevents harescripts from keeping files open while the
                 request data (eg a SRH) is gone?! */
        WebVars::const_iterator itr=variables.find(name);
        if (itr==variables.end() || itr->second.contents.empty())
            return NULL;
        else if (itr->second.bodystart == itr->second.bodylimit) // it was URLencoded (FIXME make sure the data stays in memory!)
            return new Blex::MemoryReadStream(itr->second.contents.data(),itr->second.contents.size());
        else if(outstream.get())
            return new Blex::LimitedStream(itr->second.bodystart, itr->second.bodylimit, *outstream);
        else
            return new Blex::MemoryReadStream(&tempstore[itr->second.bodystart], itr->second.bodylimit - itr->second.bodystart);
}

void RequestParser::ParseEncodedVars(const char* variable_start, const char* variables_end, bool ispost)
{
        std::string name;
        std::string parameter;

        //The parsing of webvariables can be found in RFC1738
        //An encoded variable will look like:   var=data&var=data ....
        while (variable_start != variables_end)
        {
                //Find the end of the current variable (end of URL, or a '&')
                const char* this_variable_end = std::find_first_of(variable_start,variables_end,url_separators,url_separators_end);

                //Find the assignment opreator (a '=' sign)
                const char* this_variable_assign = std::find(variable_start,this_variable_end,'=');

                name.clear();
                parameter.clear();
                //Borland performs very badly when doing a lot of replaces (which std::back_inserter does)
                name.reserve(this_variable_assign - variable_start);
                parameter.reserve(this_variable_end - this_variable_assign);

                Blex::DecoderUrl< std::back_insert_iterator<std::string> > name_inserter( std::back_inserter(name) );
                for (const char* itr = variable_start; itr != this_variable_assign; ++itr)
                    name_inserter(*itr=='+' ? ' ' : *itr);

                if (this_variable_assign != this_variable_end)
                {
                        Blex::DecoderUrl< std::back_insert_iterator<std::string> > param_inserter( std::back_inserter(parameter) );
                        for (const char* itr = this_variable_assign+1; itr != this_variable_end; ++itr)
                            param_inserter(*itr=='+' ? ' ' : *itr);
                }

                //An assignment operator did appear! Decode and store variable name and its contents
                WebVar *newvar = &variables.insert(std::make_pair(name, WebVar()))->second;
                newvar->contents = parameter;
                newvar->ispost = ispost;

                if (this_variable_end == variables_end)
                    return;

                variable_start=this_variable_end+1;
        }
}

std::string const* RequestParser::GetVariable(const char *varname) const
{
        std::string search(varname,varname+strlen(varname));
        WebVars::const_iterator itr=variables.find(search);
        if (itr==variables.end())
            return NULL;
        else
            return &itr->second.contents;
}

std::string RequestParser::GetVariableValue(const char *varname) const
{
        std::string const* val = GetVariable(varname);
        if (val)
            return *val;
        else
            return std::string();
}

std::string const* RequestParser::GetHeader(const char *headername) const
{
        std::string search(headername,headername+strlen(headername));
        WebHeaders::const_iterator itr=headers.find(search);
        if (itr==headers.end())
            return NULL;
        else
            return &itr->second;
}

std::string RequestParser::GetHeaderValue(const char *headername) const
{
        std::string const* val = GetHeader(headername);
        if (val)
            return *val;
        else
            return std::string();
}

Blex::RandomStream * RequestParser::OpenBody() const
{
        if (!outstream.get())
            return new Blex::MemoryReadStream(&tempstore[0], tempstore.size());
        else
            return new Blex::LimitedStream(0, outstream->GetFileLength(), *outstream);
}

bool RequestParser::IsProxyRequest() const
{
        return !received_url.empty() && received_url[0]!='/' && std::find(received_url.begin(), received_url.end(), ':') != received_url.end();
}

void DecodeWebVar(char const*  begin, char const*  end, std::string *output)
{
        output->reserve(256);
        Blex::DecodeUrl(begin, end, back_inserter(*output));
}


std::string RequestParser::GetRequestedPath() const
{
        std::string const &inputurl = GetReceivedUrl();
        std::string::const_iterator questionmark = GetReceivedUrlVarSeparator();
        std::string requested_path;

        DecodeWebVar(&*inputurl.begin(), &*questionmark, &requested_path);

        //Remove double slashes (ADDME: Merge with DecodeWebVar above?)
        if (!requested_path.empty())
        {
                for(unsigned i = requested_path.size()-1;i>0;--i)
                   if (requested_path[i-1]=='/' && requested_path[i]=='/')
                     requested_path.erase(requested_path.begin()+i);
        }
        //Did the requested URL end with a slash?
        bool directory_request = !requested_path.empty() && requested_path.end()[-1]=='/';
        unsigned bytes_to_remove = reinterpret_cast<char*>(&*requested_path.end())
                                   - Blex::CollapsePath(reinterpret_cast<char*>(&*requested_path.begin()),
                                                        reinterpret_cast<char*>(&*requested_path.end()));

        if (bytes_to_remove)
            requested_path.erase(requested_path.end() - bytes_to_remove,requested_path.end());
        if (directory_request && requested_path.size()>1 /*not root*/)
            requested_path.push_back('/');

        //Make sure the path starts with a forward slash
        if (requested_path.empty())
            requested_path="/";
        else if (requested_path[0]!='/')
            requested_path.insert(requested_path.begin(),'/');

        return requested_path;
}

} //end namespace webserver
