#include <blex/blexlib.h>



#include "mime.h"
#include "unicode.h"
#include "utils.h"
#include <iostream>

//ADDME: The base64 decoder is probably a relatively heavy class, we can probably
//       speed up its implementation

namespace Blex
{

namespace Mime
{

namespace
{
        const char Cr = '\r';
        const char Lf = '\n';
        const char Space = ' ';
        const char Tab = '\t';

/** Is the character a 'TSpecial' ? (RFC 2045 paragraph 5.1) */
inline bool IsTSpecial(uint8_t ch)
{
        static const char tspecials[]={"()<>@,;:\\\"/[]?="};
        static const char *tspecials_end = tspecials + sizeof tspecials - 1;
        return std::find(tspecials, tspecials_end, ch) != tspecials_end;
}

} //end anonymous namespace

/*  For all states: when any CR is parsed, the next character will not
                    be sent to the protocol if it's a LF.

    Parsing:     CR:     next state = GotCr
                 LF:     next state = GotLf
                 other:  store byte, next state = Parsing
    GotCr:       LF:     next state = GotLf
                 always: unget char, next state = GotLf
    GotLf:       always: next state = parse_data.empty() ? Done : UnsureEnd
    UnsureEnd:   LF:     next state = UnsureEnd
                 SP:     next state = Skipping
                 other:  parse last line, clear data, goto Parsing
    Skipping:    SP:     next state = Skipping
                 other:  goto Parsing

    ADDME: Should we really allow UnsureEnd inside the MIME protocol?
*/

const void* HeaderParser::ParseHeader(const void*start, const void*limit)
{
        /* ADDME: Useful optimization: use find() to find next interesting
           character, don't loop every char */
        for (;start!=limit && cur_state != Done; start = static_cast<const char*>(start)+1)
        {
                char ch=*static_cast<const char*>(start);

                if (ch==Tab) //convert TAB to SPACE
                    ch=Space;

                switch(cur_state)
                {
                case Parsing:
                case_Parsing:
                        if (ch==Cr)
                            cur_state=GotCr;
                        else if (ch==Lf)
                        {
                                cur_state=GotLf;
                                goto case_GotLf;
                        }
                        else
                            parse_data.push_back(ch);
                        break;
                case GotCr:
                        if (ch!=Lf) //ignore lack of LF
                            start = static_cast<const char*>(start) - 1;
                        cur_state = GotLf;
                        // fallthrough
                case GotLf:
                case_GotLf:
                        cur_state = parse_data.empty() ? Done : UnsureEnd;
                        break;
                case UnsureEnd:
                        if (ch==Space)
                        {
                                cur_state=Skipping;
                        }
                        else
                        {
                                callback(parse_data);
                                parse_data.clear();
                                parse_data.reserve(256);
                                cur_state=Parsing;
                                goto case_Parsing;
                        }
                        break;
                case Skipping:
                        if (ch!=Space)
                        {
                                cur_state=Parsing;
                                goto case_Parsing;
                        }
                        break;
                case ParseData:
                        throw std::runtime_error("Mime header parser got into state ParseData");
                case Done:
                        throw std::runtime_error("Mime header parser got into state Done");
                }
        }
        return start;
}

Decoder::Decoder(DecodeReceiver &receiver, std::string const &defaultcontenttype)
: headers_parser( std::bind(&Decoder::HeadersCallback, this, std::placeholders::_1) )
, base64_decoder(std::back_inserter(decode_temp))
, qp_decoder(std::back_inserter(decode_temp),false)
, defaultcontenttype(defaultcontenttype)
, receiver(receiver)
{
  /*

        state = ReadHeaders;
        data_encoding = Passthrough;
        data_charset = 0;
        bytes_parsed = 0;
        boundary_start = 0;
        boundary_end = 0;
        crlf_before_boundary = false;
        crlfstate = AtFirstLine;
        have_partial_boundary_matches = false;*/
}

Decoder::~Decoder()
{
}

void Decoder::Start(std::string const &toptype,
                        std::string const &topencoding,
                        std::string const &topdescription,
                        std::string const &topdisposition,
                        std::string const &topcontentid,
                        Blex::FileOffset data_start_offset,
                        Blex::FileOffset part_start_offset,
                        Blex::FileOffset body_start_offset)
{
        bytes_parsed = data_start_offset;
        crlf_before_boundary = false;
        crlfstate = AtFirstLine;
        have_partial_boundary_matches = false;
        while (!parts.empty())
            parts.pop_back();
        OpenPart(toptype,topencoding,topdescription,topdisposition,topcontentid, part_start_offset, part_start_offset, body_start_offset);
}

void Decoder::HeadersCallback(std::string const &hdr)
{
        static const char HDR_type[] = "Content-Type";
        static const char HDR_t_e[] = "Content-Transfer-Encoding";
        static const char HDR_desc[] = "Content-Description";
        static const char HDR_disp[] = "Content-Disposition";
        static const char HDR_cid[] = "Content-ID";

        static const int HDR_type_size = sizeof HDR_type - 1;
        static const int HDR_t_e_size = sizeof HDR_t_e - 1;
        static const int HDR_desc_size = sizeof HDR_desc - 1;
        static const int HDR_disp_size = sizeof HDR_disp - 1;
        static const int HDR_cid_size = sizeof HDR_cid - 1;

        std::string::const_iterator datastart = std::find(hdr.begin(),hdr.end(),':');
        if (datastart == hdr.end())
            return; //corrupted header line

        //Which header line is being parsed?
        std::string *interested_string = NULL;
        if (datastart-hdr.begin() == HDR_type_size && Blex::StrCaseCompare(&hdr[0],&hdr[HDR_type_size],HDR_type,HDR_type+HDR_type_size)==0)
            interested_string = &last_type;
        else if (datastart-hdr.begin() == HDR_t_e_size && Blex::StrCaseCompare(&hdr[0],&hdr[HDR_t_e_size],HDR_t_e,HDR_t_e+HDR_t_e_size)==0)
            interested_string = &last_encoding;
        else if (datastart-hdr.begin() == HDR_desc_size && Blex::StrCaseCompare(&hdr[0],&hdr[HDR_desc_size],HDR_desc,HDR_desc+HDR_desc_size)==0)
            interested_string = &last_description;
        else if (datastart-hdr.begin() == HDR_disp_size && Blex::StrCaseCompare(&hdr[0],&hdr[HDR_disp_size],HDR_disp,HDR_disp+HDR_disp_size)==0)
            interested_string = &last_disposition;
        else if (datastart-hdr.begin() == HDR_cid_size && Blex::StrCaseCompare(&hdr[0],&hdr[HDR_cid_size],HDR_cid,HDR_cid+HDR_cid_size)==0)
            interested_string = &last_content_id;

        if (!interested_string)
            return; //we didn't care about this header

        //Move the seperator over the colon, and past any possible spaces
        datastart = Blex::FindNot (datastart+1, hdr.end(), ' ');

        //Assign the new data
        unsigned size=hdr.end()-datastart;
        interested_string->clear();
        interested_string->reserve(size);
        DecodeEncodedWords(size, &*datastart, interested_string);
}

/** Decode a quoted string. The parameters passed to this function should have
    been validated by IsQuotedString()
    @param start Location OF the initial quote
    @param end Limit Location of the final quote */
std::string DecodeQuotedString(std::string::const_iterator start, std::string::const_iterator end)
{
        std::string retval;

        for (++start,--end; start != end; ++start)
        {
                if (*start=='\\' && start+1!=end) //escape next character
                    ++start;
                retval.push_back(*start);
        }
        return retval;
}

/** Find the end of a parameter. Includes the closing quote, if any */
std::string::const_iterator FindParamEnd(std::string::const_iterator start, std::string::const_iterator const &end)
{
        if (start!=end && *start=='"') //a quoted parameter follows
        {
                //find the closing quote (but it must not be prefixed)
                bool got_prefix=false;
                for (++start;start!=end;++start)
                {
                        if (*start=='\\')
                            got_prefix=true;
                        else if (*start=='"' && !got_prefix)
                            return start+1; //this is the end of the parameter!
                        else
                            got_prefix=false;
                }
                return start; //hit the end apparently
        }
        else
        {
                //find the first non-TSPecial and non-space/ctrl
                while (start != end && *start >= 33 && *start<=126 && !IsTSpecial(*start))
                    ++start;
                return start;
        }
}

/** look up the start of the specified parameter in the command line
    @param begin Start of the header line to look through
    @param end End of the header line to look through
    @param parameter Parameter to look for
    @return Description of the parameter, or start_parameter==end if parameter was not found*/
HeaderParam FindHeaderParameter(std::string::const_iterator const &begin, std::string::const_iterator const &end, std::string const &parameter)
{
        //ADDME: Support embedded comments (text-plain; (hi) charset=us-ascii)
        HeaderParam retval;

        std::string::const_iterator ptr = begin;
        // Skip the main parameter
        ptr = std::find(ptr,end,';');

        /* Scan forward to the parameter */
        while (true)
        {
                //Skip any spaces and semicolons
                while(ptr!=end && (*ptr==32 || *ptr==';')) ++ptr;
                //find param end
                std::string::const_iterator assignment = std::find(ptr,end,'=');
                if (assignment == end)
                {
                        retval.start_parameter = end-begin;
                        retval.start_value = 0;
                        retval.end_value = 0;

                        return retval; //not a parameter
                }

                //Is this the parameter we're looking for?
                if (Blex::StrCaseCompare(ptr,assignment,parameter.begin(),parameter.end())==0)
                {
                        retval.start_parameter=ptr - begin;
                        retval.start_value=assignment + 1 - begin;
                        retval.end_value=FindParamEnd(begin + retval.start_value,end) - begin;

                        return retval;
                }

                //Find the end of this parameter
                ptr=FindParamEnd(assignment+1,end);
        }
}

/** lookup, extract and decode a parameter from a header
*/
std::string ExtractHeaderParameter(std::string const &header, std::string const &parametername)
{
        HeaderParam param = FindHeaderParameter(header.begin(),header.end(),parametername);
        if (param.start_parameter == header.size())
            return std::string();

        if (IsQuotedString(header.begin()+param.start_value, header.begin()+param.end_value))
            return DecodeQuotedString(header.begin()+param.start_value, header.begin()+param.end_value);
        else
            return std::string(header.begin()+param.start_value, header.begin()+param.end_value);
}

/** Remove a parameter from a header */
void RemoveHeaderParameter(std::string *header, const HeaderParam &to_remove)
{
        if (to_remove.start_parameter==header->size())
            return;

        //Remove constness..
        std::string::iterator start_remove = header->begin() + to_remove.start_parameter;
        std::string::iterator end_remove = header->begin() + to_remove.end_value;

        //Eat any semicolons and spaces as well..
        while (end_remove != header->end() && (*end_remove==' ' || *end_remove==';'))
            ++end_remove;

        //Do the actual parameter remove
        header->erase(start_remove,end_remove);

        //Strip any terminating semicolons and space sfrom the header
        while (header->begin() != header->end() && (header->end()[-1]==' ' || header->end()[-1]==';'))
            header->erase(header->end()-1);
}

std::string GetBoundaryFromMultipartType(std::string const &contenttype)
{
//        static const char boundary_begin[]={'\r','\n','-','-'};
        static const char boundary_begin[]={'-','-'};

        std::string boundary = ExtractHeaderParameter(contenttype, "boundary");
        if (!boundary.empty())
            boundary.insert (boundary.begin(), boundary_begin,boundary_begin+sizeof(boundary_begin));
        return boundary;
}

uint32_t const * TryRemoveCharset(std::string *contenttype, std::string *original_charset = 0)
{
        HeaderParam param = FindHeaderParameter(contenttype->begin(), contenttype->end(), "charset");
        if (param.start_parameter == contenttype->size())
            return NULL;

        std::string charset;
        if (IsQuotedString(contenttype->begin()+param.start_value, contenttype->begin()+param.end_value))
            charset=DecodeQuotedString(contenttype->begin()+param.start_value, contenttype->begin()+param.end_value);
        else
            charset.assign(contenttype->begin()+param.start_value, contenttype->begin()+param.end_value);

        if (original_charset)
            *original_charset = charset;

        //Is this a known charset?
        Charsets::Charset thisset = FindCharacterset(&*charset.begin(),&*charset.end());
        if (thisset == Charsets::Iso8859_1)
            thisset = Charsets::CP1252; //choose a superset of the above character sets to work around broken Windows mailers

        if (thisset == Charsets::USAscii) //we DON'T want to convert 7bit data...
            return NULL;

        uint32_t const *conversiontable = Blex::GetCharsetConversiontable(thisset);
        if (conversiontable != NULL) //remove the charset from the content-type, as we handled it!
        {
                RemoveHeaderParameter(contenttype, param);
                *contenttype += "; charset=utf-8";
        }
        return conversiontable;
}

void Decoder::OpenPart(std::string const &_contenttype, std::string const &contentencoding,std::string const &description,std::string const &disposition,std::string const &content_id, Blex::FileOffset part_boundary_start, Blex::FileOffset part_start, Blex::FileOffset body_start)
{
        //ADDME: We should discard comments from the header lines! (RFC2045)
        std::string boundary;
        std::string contenttype = _contenttype;
        PartStack newpart;
        newpart.body_end = 0;

        if (contenttype.empty())
            contenttype = defaultcontenttype;

        if (IsMultipartType(contenttype))
            boundary = GetBoundaryFromMultipartType(contenttype);

        std::string original_charset;
        data_charset = IsTextType(contenttype) ? TryRemoveCharset(&contenttype, &original_charset) : NULL;

        newpart.boundary = boundary.empty() && !parts.empty() ? parts.back().boundary : boundary;
        state = ReadBody;

        if (Blex::StrCaseCompare(contentencoding,"BASE64") == 0)
        {
                //Reset encoder state
                base64_decoder = MyBase64Decoder(std::back_inserter(decode_temp));
                data_encoding = Base64;
        }
        else if (Blex::StrCaseCompare(contentencoding,"QUOTED-PRINTABLE") == 0)
        {
                qp_decoder = MyQPDecoder(std::back_inserter(decode_temp),false);
                data_encoding = QuotedPrintable;
        }
        else
        {
                data_encoding = Passthrough;
        }

        if (!parts.empty() && !parts.back().body_ended)
        {
                 parts.back().body_end = part_boundary_start;
                 parts.back().body_ended = true;
        }

        parts.push_back(newpart);
        receiver.StartPart(contenttype,contentencoding,description,disposition,content_id, original_charset, part_start, body_start);
}

bool Decoder::ClosePart(Blex::FileOffset end_boundary_start)
{
        PartStack &toppart = parts.back();

        Blex::FileOffset bodyend = end_boundary_start;
        if (toppart.body_ended)
             bodyend = toppart.body_end;
        unsigned linecount = toppart.linecount;

        parts.pop_back();
        receiver.EndPart(bodyend, end_boundary_start, linecount);
        return parts.empty();
}

void Decoder::StartBody(Blex::FileOffset boundary_start, Blex::FileOffset boundary_end, Blex::FileOffset headers_end)
{
        OpenPart(last_type,last_encoding,last_description,last_disposition,last_content_id, boundary_start, boundary_end, headers_end);

        last_type.clear();
        last_encoding.clear();
        last_description.clear();
        last_disposition.clear();
        last_content_id.clear();
}

void Decoder::ReturnData(const void *databuffer, unsigned buflen)
{
        if (parts.back().body_ended)
            return; //not interesting in dummy data after the mime subparts

        if (buflen>16384)
        {
                //Split the data into separate packets to avoid huge buffers...
                for (unsigned pos=0;pos<buflen;pos+=16384)
                    ReturnData(static_cast<const uint8_t*>(databuffer) + pos, std::min(16384u,buflen-pos));
                return;
        }

        //////////////////////////////////////////////////////////////////////
        //
        // Do the data conversion if necessary
        // (ADDME smarter output iterators would alleviate the need for a lot of in-between buffers)
        if (data_encoding != Passthrough)
        {
                decode_temp.clear();

                switch(data_encoding)
                {
                case Passthrough: break;// Shut up the compiler
                case Base64:
                        for (unsigned i=0;i<buflen;++i)
                             base64_decoder(static_cast<const uint8_t*>(databuffer)[i]);
                        break;
                case QuotedPrintable:
                        for (unsigned i=0;i<buflen;++i)
                             qp_decoder(static_cast<const uint8_t*>(databuffer)[i]);
                        break;
                }
        }

        if (data_charset==NULL)
        {
                //Fast-track the data conversion, as we don't need to do charset lookups
                if (data_encoding == Passthrough)
                    receiver.ReceiveData(databuffer,buflen);
                else
                    receiver.ReceiveData(&decode_temp[0],decode_temp.size());
                return;
        }

        //Set up a UTF-8 converter
        utf8_temp.clear();
        Blex::UTF8Encoder< std::back_insert_iterator< std::vector<uint8_t> > > utf8enc (std::back_inserter(utf8_temp));

        if (data_encoding == Passthrough)
        {
                //Directly move the data into the utf8 buffer
                for (unsigned i=0;i<buflen;++i)
                {
                        //allow real 0s through, but convert charset 0s (unknowns) to '?';
                        uint8_t in_ch = static_cast<const uint8_t*>(databuffer)[i];
                        utf8enc(in_ch == 0 ? 0 : data_charset[in_ch] == 0 ? '?' : data_charset[in_ch]);
                }
        }
        else
        {
                //Reprocess decoded data into the UTF8 buffer
                for (unsigned i=0;i<decode_temp.size();++i)
                {
                        //allow real 0s through, but convert charset 0s (unknowns) to '?';
                        uint8_t in_ch = uint8_t(decode_temp[i]);
                        utf8enc(in_ch == 0 ? 0 : data_charset[in_ch] == 0 ? '?' : data_charset[in_ch]);
                }
        }
        receiver.ReceiveData(&utf8_temp[0],utf8_temp.size());
}

void Decoder::ProcessData(const void *databuffer, unsigned buflen)
{
        Blex::FileOffset buffer_start_offset = bytes_parsed;
        bytes_parsed += buflen;

        if (buflen == 0 || parts.empty())
            return;

        if (!parts.empty() && parts[0].boundary.empty()) //there is no boundary, so nothing to do!
        {
                ReturnData(databuffer,buflen);
                return;
        }

        const char *buffer_start = static_cast<const char*>(databuffer);
        const char *buffer_limit = buffer_start + buflen;

        const char *start = buffer_start;

        while (start != buffer_limit)
        {
                if (crlfstate == AtCR && *start == 10)
                {
                        crlfstate = AtCRLF;
                        if (++start == buffer_limit)
                            break;
                }

                // INV: start != buffer_limit
                if ((crlfstate == AtFirstLine || crlfstate == AtCRLF) && !have_partial_boundary_matches)
                {
                        // We're at the start of a line, reset the match status for all boundaries
                        for (std::vector< PartStack >::iterator it = parts.begin(); it != parts.end(); ++it)
                            if (!it->is_complete)
                            {
                                    it->is_partial_match = true;
                                    it->is_complete = false;
                                    it->is_end_boundary = false;
                            }
                        have_partial_boundary_matches = true;
                }
                if (have_partial_boundary_matches)
                {
                        // Start of line or resuming previous matches from the previous block
                        bool any_match = false;

                        unsigned already_parsed = boundary_buffer.size();

                        // Check all boundaries
                        for (std::vector< PartStack >::iterator it = parts.begin(); it != parts.end(); ++it)
                        {
                                // Skip all undefined boundaries or boundaries that failed before
                                if (!it->is_partial_match || it->boundary.empty())
                                    continue;

                                // Calc the number of bytes needed for the rest of the boundary (+) or the nr bytes past the end (-)
                                signed need_body_bytes = signed(it->boundary.size()) - already_parsed;

                                if (need_body_bytes > 0)
                                {
                                        // Need to parse more boundary bytes. How many can we parse?
                                        long parse_room = buffer_limit - start;
                                        long want_parse = std::min< signed >(need_body_bytes, parse_room);

                                        // Does the part we can parse match?
                                        if (std::equal(start, start + want_parse, &it->boundary[already_parsed]))
                                        {
                                                // Check if all boundary chars are parsed
                                                it->is_complete = want_parse == need_body_bytes;
                                                // If one more available then check for the '-' bytes (ADDME: check for '--')
                                                if (want_parse < parse_room)
                                                    it->is_end_boundary = start[want_parse] == '-';
                                        }
                                        else
                                        {
                                                // No: discard this match
                                                it->is_partial_match = false;
                                        }
                                }
                                else if (need_body_bytes == 0) // 1st char after the boundary text, check for '-' (ADDME check for '--')
                                    it->is_end_boundary = start[0] == '-';

                                any_match = any_match || it->is_partial_match;
                        }

                        // Cache if any matches are there
                        have_partial_boundary_matches = any_match;
                }

                // There are still matches. Check if the end of line is in sight
                if (have_partial_boundary_matches)
                {
                        // Search for end of the current line
                        const char *endofboundary = std::find(start, buffer_limit, 10); //ADDME should search for crlf.

                        // There are (partial) matches in this line. Search for end of line (max 8192 bytes)
                        if (endofboundary == buffer_limit)
                        {
                                // Append current data, wait for newline
                                if (boundary_buffer.size() + (buffer_limit - start) <= 8192)
                                {
                                        if (boundary_buffer.empty())
                                            crlf_before_boundary = crlfstate == AtCRLF;
                                        boundary_buffer.append(start, buffer_limit);
                                        return;
                                }
                                // Line too long. Just pretend like we found a crlf.
                        }
                        else
                        {
                                // Found the terminating \n!
                                ++endofboundary;
                        }

                        // Line has ended. See if we found a complete boundary.
                        signed boundidx = -1, idx = 0;
                        for (std::vector< PartStack >::iterator it = parts.begin(); it != parts.end(); ++it, ++idx)
                            if (it->is_complete)
                            {
                                    boundidx = idx;
                                    break;
                            }

                        if (boundidx != -1)
                        {
                                // A complete boundary has been found; we can be sure we're not parsing headers anymore.
                                state = ReadBody;

                                Blex::FileOffset start_ofs = buffer_start_offset + (start - buffer_start) - boundary_buffer.size();
                                if (crlf_before_boundary || crlfstate == AtCRLF)
                                    start_ofs -= 2;

                                // Reset completeness, so at the next iteration all state will be reset
                                for (std::vector< PartStack >::iterator it = parts.begin(); it != parts.end(); ++it)
                                    it->is_complete = false;

                                // Close extraeneous parts (and make sure boundidx is the current part)
                                while ((signed)parts.size() > boundidx + 1)
                                    ClosePart(start_ofs);

                                // If this is a closing boundary, close the current part.
                                if (parts[boundidx].is_end_boundary)
                                {
                                        state = IgnoreRest;

                                        // Return when last part has been closed
//                                        if (ClosePart(start_ofs))
//                                            return;
                                }
                                else
                                {
                                        // New part boundary found, store positions
                                        boundary_start = start_ofs;
                                        boundary_end = buffer_start_offset + (endofboundary - buffer_start);

                                        // All data now must go to mime header parser
                                        state = ReadHeaders;
                                        headers_parser.Reset();
                                }

                                // The boundary buffer is used for the boundary, clear it. Also set start to end of boundary
                                boundary_buffer.clear();
                                crlf_before_boundary = false;
                                start = endofboundary;
                                have_partial_boundary_matches = false;

                                // We did parse a CRLF (at least a LF), the next line may be another boundary.
                                crlfstate = AtFirstLine;
                                continue;
                        }

                        // End of line has been reached, but no boundary found.
                        have_partial_boundary_matches = false;
                }

                // Send the current CR/LF to the body data processor
                const char *header_start = "\r\n--";

                Blex::FileOffset start_offset = buffer_start_offset + (start - buffer_start);

                if (crlfstate == AtCR) // Spurious \r?
                {
                        ProcessBodyData(start_offset - 1, header_start, header_start + 1);
                        crlfstate = AtFirstLine;

                        // CR is treated like CRLF in the header parser, so a new part may have been added. Make sure to go
                        // through boundary detect again.
                        continue;
                }
                else if (crlfstate == AtCRLF)
                {
                        ProcessBodyData(start_offset - 2, header_start, header_start + 2);

                        // After CRLF a new boundary can follow. Make sure to go through boundary detect, because
                        // body processing could have added a new part
                        crlfstate = AtFirstLine;
                        continue;
                }

                // Clear out the boundary buffer (no CRLF in there)
                if (!boundary_buffer.empty())
                {
                        const char *buf_start = &boundary_buffer[0];
                        const char *buf_end = buf_start + boundary_buffer.size();

                        const char *new_start = ProcessBodyData(start_offset - boundary_buffer.size(), buf_start, buf_end);
                        boundary_buffer.erase(0, new_start - buf_start);

                        // If not all consumed, check for borders again
                        if (!boundary_buffer.empty())
                             continue;
                }

                // Search for next boundary beginning
                const char *next_header = Blex::SearchUncontained(start, buffer_limit, header_start, header_start + 4);

                // If at least \r\n has been found, process everything upto that.
                if (buffer_limit - next_header >= 2)
                {
                        start = ProcessBodyData(start_offset, start, next_header);

                        // If returned prematurely, go through boundary detection again
                        if (start != next_header)
                            continue;

                        // Restart, so new headers will be picked up
                        crlfstate = AtCRLF;
                        start = next_header + 2;
                        continue;
                }
                else if (next_header == buffer_limit)
                {
                        // No \r\n-- at all. Process everything
                        start = ProcessBodyData(start_offset, start, buffer_limit);
                        crlfstate = AtNone;
                }
                else
                {
                        // Last charachter is a CR. Process everything until CR, set state to AtCR, set start to buffer limit
                        start = ProcessBodyData(start_offset, start, next_header);
                        if (start == next_header)
                        {
                                start = buffer_limit;
                                crlfstate = AtCR;
                        }
                }
        }
}

const char *Decoder::ProcessBodyData(Blex::FileOffset buffer_start_offset, const char *start, const char *limit)
{
        const char *buffer_start = start;

        switch (state)
        {
        case ReadHeaders:
            {
                    start = static_cast<const char*>(headers_parser.ParseHeader(start,limit));

                    Blex::FileOffset body_pos = buffer_start_offset + (start - buffer_start);

                    if (headers_parser.IsDone())
                    {
                            StartBody(boundary_start, boundary_end, body_pos);
                            headers_parser.Reset();
                    }
            } break;

        case ReadBody:
            {
                    // ADDME: count crlf's instead of lf
                    const char *lf_pos = start;
                    if (lf_pos != limit)
                    {
                            while (true)
                            {
                                    lf_pos = std::find(lf_pos, limit, '\n');
                                    if (lf_pos == limit)
                                        break;
                                    ++parts.back().linecount;
                                    ++lf_pos;
                            }
                    }

                    ReturnData(start, limit - start);
                    start = limit;
            } break;
        case IgnoreRest:
            {
                    start = limit;
            }

        }
        return start;
}

void Decoder::Finish()
{
        while (!parts.empty())
            ClosePart(bytes_parsed);
}

DecodeReceiver::~DecodeReceiver()
{
}

void DecodeSingleWord(const char *charset_start, const char *charset_end,
                               const char *coding_start, const char *coding_end,
                               const char *text_start, const char *text_end,
                               std::string *decoded_output)
{
        //ADDME: could be faster if we had a chrrset transforming output iterator
        std::string temp;

        if (coding_end-coding_start == 1 && (*coding_start&0xDF) == 'Q')
        {
                //Quoted-printable encoding
                QuotedPrintableDecoder< std::back_insert_iterator< std:: string > > qpd (std::back_inserter(temp), /*underscore_is_space=*/true);
                std::for_each(text_start,text_end,qpd);
        }
        else if (coding_end-coding_start == 1 && (*coding_start&0xDF) == 'B')
        {
                //Base-64 encoding
                Blex::DecodeBase64(text_start,text_end,std::back_inserter(temp));
        }

        //we should have the data now, start a conversion!
        static const char utf8[] = "utf-8";
        static const unsigned utf8_len = sizeof utf8-1;
        if (Blex::StrCaseCompare(charset_start, charset_end, utf8, utf8+utf8_len)==0)
        {
                //No conversion necessary - export directly!
                *decoded_output += temp;
                return;
        }

        Charsets::Charset which_charset = FindCharacterset(charset_start, charset_end);
        if (which_charset == Charsets::USAscii || which_charset == Charsets::Iso8859_1)
            which_charset = Charsets::CP1252; //CP1252 is a superset of the above charsets, use this to work around broken Windows mailers

        const uint32_t* converttable = Blex::GetCharsetConversiontable(which_charset);

        if (converttable == NULL) //convert unknowns through the USAScii set
            converttable = Blex::GetCharsetConversiontable(Charsets::USAscii);

        //Encode the characters into UTF8
        Blex::UTF8Encoder< std::back_insert_iterator< std:: string > > utf8enc (std::back_inserter(*decoded_output));
        for (unsigned i=0;i<temp.size();++i)
        {
                uint32_t newbyte = converttable[uint8_t(temp[i])];
                utf8enc(newbyte < 32 ? '?' : newbyte);
        }
}

static const char startEW[]="=?";
static const unsigned startEW_len=sizeof startEW-1;
static const char endEW[]="?=";
static const unsigned endEW_len=sizeof endEW-1;

void DecodeEncodedWords(unsigned size, const char *encoded_bytes, std::string *decoded_output)
{

        const char *start = encoded_bytes;
        const char *end = encoded_bytes + size;

        while(true)
        {
                const char *encword_start = std::search(start,end,startEW,startEW+startEW_len);

                //flush all bytes that are NOT part of an encoding.
                if (encword_start != start)
                    decoded_output->insert(decoded_output->end(), start, encword_start);
                //anything to decode?
                if (encword_start == end)
                    return; //nope,finished

                //find second '?'
                const char *second_qmark = std::find(encword_start+2,end,'?');
                if (second_qmark == end)
                    return; //corrupted, ignore

                //find third '?'
                const char *third_qmark = std::find(second_qmark+1,end,'?');
                if (third_qmark == end)
                    return; //corrupted, ignore

                //find terminator sequence
                const char *encword_end = std::search(third_qmark+1,end,endEW,endEW+endEW_len);
                if (encword_end == end)
                    return; //corrupted, ignore

                DecodeSingleWord(encword_start+2,second_qmark,
                                 second_qmark+1,third_qmark,
                                 third_qmark+1,encword_end,
                                 decoded_output);

                start=encword_end+2;

                //eat any trailing whitespace if a new encoded-word follows
                const char *skip_wsp=start;
                while (skip_wsp!=end && Blex::IsWhitespace(*skip_wsp))
                    ++skip_wsp;

                if (static_cast<unsigned>(end-skip_wsp) >= startEW_len
                    && std::equal(skip_wsp,skip_wsp+startEW_len,startEW))
                    start=skip_wsp;
        }
}

bool SafeUnencodedWord(unsigned size, const char *decoded_bytes)
{
        for(unsigned i=0;i<size;++i)
        {
                //Avoid control chars
                if (decoded_bytes[i]<32)
                    return false;
                //Make sure there is no 'forbidden' =? character in the word
                if (decoded_bytes[i]=='=' && i<size-1 && decoded_bytes[i+1]=='?')
                    return false;
        }
        return true;
}

//RFC2047: Header encoding
void EncodeWords(unsigned size, const char *decoded_bytes, std::string *encoded_output)
{
        const char *start=decoded_bytes;
        const char *end=start+size;

        Charsets::Charset encode_with = GetBestCharacterset(start,end);
        if (encode_with == Charsets::USAscii && SafeUnencodedWord(size,decoded_bytes))
        {
                //It's okay! Directly output the text - no need for encoding
                encoded_output->insert(encoded_output->end(),start,end);
                return;
        }

        //Build an encoded word
        *encoded_output += "=?";
        *encoded_output += encode_with == Charsets::Unicode ? "UTF-8" : Blex::GetCharsetName(encode_with);
        *encoded_output += "?Q?";

        QuotedPrintableEncoder<std::back_insert_iterator<std::string> > qep(std::back_inserter(*encoded_output), true);
        uint32_t const * converttable = Blex::GetCharsetConversiontable(encode_with);
        if (converttable)
        {
                /* Decode, map and then process every character */
                Blex::UTF8DecodeMachine my_utf8_decoder;
                for (;start!=end;++start)
                {
                        uint32_t inbyte = my_utf8_decoder(*start);
                        if (inbyte == Blex::UTF8DecodeMachine::NoChar || inbyte == 0 || inbyte == Blex::UTF8DecodeMachine::InvalidChar)
                            continue;

                        unsigned outbyte = std::find(converttable,converttable+256,inbyte) - converttable;
                        if (outbyte < 256) //found it!
                             qep(uint8_t(outbyte)); //encode it..
                }
        }
        else
        {
                //directly feed the UTF-8 charactesr to the encoder
                std::for_each(start,end,qep);
        }

        *encoded_output += "?=";
}

} //end namespace Mime

} //end namespace Blex
