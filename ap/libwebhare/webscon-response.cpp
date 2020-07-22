#include <ap/libwebhare/allincludes.h>

#include "webscon.h"
#include <blex/utils.h>

namespace WebServer
{

std::string Connection::GetErrorPagePath(std::string const &errorfile)
{
        //ADDME It's hard to debug when files aren't picked up, some more errorlogging (specific directory set but no file found, file is a dir) would be nice
        ///Error rule hit, if any
        std::string errorfilepath;
        for (auto &ruleinfo: request->rules_hit)
        {
                if(ruleinfo.rule->errorpath.empty())
                    continue;

                bool have_match = false;
                Blex::Directory find_error(ruleinfo.rule->errorpath, errorfile);
                for (; find_error; ++find_error)
                {
                        if(!find_error.GetStatus().IsDir() && !Blex::StrCaseLike(find_error.CurrentFile(),"*.gz"))
                        {
                                have_match = true;
                                break;
                        }
                }

                if (ruleinfo.rule->finalerrorpath)
                {
                        if (have_match)
                            return find_error.CurrentPath();

                        return std::string();
                }

                if (!have_match)
                    continue;

                errorfilepath = find_error.CurrentPath();
        }

        return errorfilepath;
}

void Connection::GenerateErrorContent()
{
        assert(LockedOutputData::ReadRef(lockedoutputdata)->output_body.Empty());

        //Reset external content handlers. breaks error pages though, so disabled
        //this->request->requestkeeper.Reset();

        //Look for a suitable error message in the specified folder
        std::string path = GetErrorPagePath(Blex::AnyToString((int)protocol.status_so_far) + ".*");
        if(!path.empty())
        {
                contenttype=connection.config->GetContentType(path);
                try
                {
                        (contenttype->handler)(this,path);
                }
                catch(std::exception &e)
                {
                        FailRequest(StatusInternalError,e.what());
                }
                return;
        }

        //Error handlers are unable to offer a body, so generate standard information
        GenerateDefaultErrorContent();
}

void Connection::GenerateDefaultErrorContent()
{
        const StatusData *status=webserver->GetStatusData(protocol.status_so_far);

        Connection::LockedOutputData::WriteRef lock(lockedoutputdata);
        SegmentedBuffer &output_body(lock->output_body);

        std::string encodedtitle;
        encodedtitle.reserve(status->title.length()+16);
        Blex::EncodeValue(status->title.begin(), status->title.end(), std::back_inserter(encodedtitle));

        output_body.Store("<!DOCTYPE html>\r\n");
        output_body.Store("<html><head><meta charset=\"utf-8\" /><title>");
        output_body.Store(encodedtitle);
        output_body.Store("</title></head><body><h1>");
        output_body.Store(encodedtitle);
        output_body.Store("</h1><p>");

        output_body.Store(status->description);
        if (protocol.status_so_far == StatusInternalError && !protocol.errorid.empty())
            output_body.Store(". ID: " + protocol.errorid);

        std::string const *uri = GetPreparedHeader("Location",8);
        if (uri)
        {
                std::string encodeduri;
                encodeduri.reserve(uri->length()+16);
                Blex::EncodeValue(uri->begin(), uri->end(), std::back_inserter(encodeduri));

                output_body.Store("</p><p>The results of your request can be found at <a href=\"");
                output_body.Store(encodeduri);
                output_body.Store("\">");
                output_body.Store(encodeduri);
                output_body.Store("</a>");
        }

        output_body.Store("</p></body></html>");

        //Work around IE's nasty habit of not showing our error page (we can defeat Friendly Error Messages by ensuring a page size of 1KB)
        char buf[1024];
        memset(buf,32/*space*/,sizeof buf-1);
        buf[sizeof buf-1]='\n';
        output_body.StoreData(buf,sizeof buf);

        AddHeader("Content-Type",12,"text/html",9,false);
}

void Connection::IndicateAsyncResponseGeneration()
{
        DEBUGPRINT("Connection " << this << " will get an asynchronous response");
        // The connection should be put asleep.
        is_sleeping = true;
        protocol.async_response = true;
}

void Connection::PrepareResponse(uint64_t length)
{
        if (protocol.responded)
        {
                DEBUGPRINT("Duplicate response!");
                return;
        }
        protocol.responded=true;
        total_output_size += length;
}

void Connection::SetupFinalHeaders()
{
        //If this is a static request (or someone is trying to make it appear like one) do NOT fiddle with headers.
        if (!IsHeaderSet("Last-Modified", 13) && !IsHeaderSet("Expires", 7) && !IsHeaderSet("Cache-Control",13)) //looks like it's dynamic but no cache headers yet...
        {
                if (GetRequestParser().GetProtocolMajor() > 1 || GetRequestParser().GetProtocolMinor() >= 1)
                    AddHeader("Cache-Control",13,"no-cache",8,false);
                else
                    AddHeader("Pragma",6,"no-cache",8,false);
        }

        if (!IsHeaderSet("Date",4))
        { //set DATE
                char datedata[40]; //ADDME use the date when we started handling the request: "The HTTP-date sent in a Date header SHOULD NOT represent a date and time subsequent to the generation of the message."
                AddHeader("Date",4,datedata, Blex::CreateHttpDate(Blex::DateTime::Now(),datedata),false);
        }

        //ADDME Cleaner mime header fields token parser to see if we're actually dealing with application/pdf?
        //ADDME or only do this for static requests, or for all?.... who/what actually needed this?
        std::string const *contenttype = GetPreparedHeader("Content-Type", 12);
        if(contenttype
           && (Blex::StrCaseCompare(*contenttype, "APPLICATION/PDF")==0
              || Blex::StrCaseCompare(*contenttype, "APPLICATION/PDF;", 16)==0)
           && !IsHeaderSet("Accept-Ranges",13))
        {
                AddHeader("Accept-Ranges",13,"bytes",5,false);
        }

        RequestParser const &reqparser = GetRequestParser();
        if (!protocol.is_websocket)
        {
                if (reqparser.GetProtocolMajor()==1 && reqparser.GetProtocolMinor()==0 && protocol.persistent)
                {
                        AddHeader("Connection",10,"Keep-Alive",10,false);
                }
                else if (!protocol.persistent)
                {
                        AddHeader("Connection",10,"Close",5,false);
                }

                if (protocol.status_so_far != StatusNotModified
                    && !protocol.continuing_response
                    && (GetRequestParser().GetProtocolMethod() != Methods::Head || !IsHeaderSet("Content-Length",14)))
                {
                        char pagelen[40];
                        unsigned pagelenbytes = Blex::EncodeNumber(total_output_size,10,pagelen)-pagelen;
                        AddHeader("Content-Length",14,pagelen,pagelenbytes,false);
                }
        }
}

void Connection::ScheduleHeaderForSending()
{
        if(protocol.sent_headers)
        {
                request->ErrorLog("Duplicate ScheduleHeaderForSending call");
                return;
        }
        protocol.sent_headers=true;

        output_header.Clear();
        if (GetRequestParser().GetProtocolMajor()>=1)
        {
                output_header.Store("HTTP/1.1 ");

                //Sanitize the status message. truncate if needed and abort at first non-printable
                if(protocol.status_additional_message.size() > 300)
                    protocol.status_additional_message.resize(300);
                for(auto itr = protocol.status_additional_message.begin(); itr != protocol.status_additional_message.end(); ++itr)
                  if(*itr < 32 || *itr >= 127)
                {
                        protocol.status_additional_message.resize(std::distance(protocol.status_additional_message.begin(), itr));
                        break;
                }

                if (protocol.status_additional_message.empty())
                {
                        const StatusData *status=webserver->GetStatusData(protocol.status_so_far);
                        output_header.Store(status->title);
                }
                else
                {
                        // Two spaces, max 10 uint32_t digits and a space
                        char statuscode[13] = { '0','0' };
                        char *code_end = Blex::EncodeNumber< uint32_t >(protocol.status_so_far, 10, &statuscode[0]);
                        *code_end = ' ';
                        output_header.StoreData(code_end - 3, 4);
                        output_header.Store(protocol.status_additional_message);
                }

                output_header.Store("\r\n");
                for (unsigned i=0;i<send_headers.size();++i)
                {
                        if (send_headers[i].data.empty())
                            continue;

                        //Do not accept non-space and non-printable characters in headers
                        bool isvalid = true;
                        for(auto itr = send_headers[i].header.begin(); isvalid && itr != send_headers[i].header.end(); ++itr)
                          if(*itr < 32 || *itr >= 127)
                            isvalid = false;

                        for(auto itr = send_headers[i].data.begin(); isvalid && itr != send_headers[i].data.end(); ++itr)
                          if(*itr < 32 || *itr >= 127)
                            isvalid = false;

                        if(!isvalid)
                            continue; //don't send an invalid header

                        output_header.Store(send_headers[i].header);
                        output_header.Store(": ");
                        output_header.Store(send_headers[i].data);
                        output_header.Store("\r\n");
                }
                output_header.Store("\r\n");
        }
        output_header.AddToQueue(&final_senddata);
}

void Connection::SetLastModified(Blex::DateTime lastmodtime)
{
        char datedata[40];
        AddHeader("Last-Modified", 13, datedata, Blex::CreateHttpDate(lastmodtime,datedata),false);
}

//FIXME: HEAD requests SEEMS TO BE COMPLETELY BROKEN
void Connection::SendStream(std::unique_ptr<Blex::Stream> &to_send, Blex::FileOffset data_length)
{
        assert(protocol.status_so_far != StatusNotModified);
        PrepareResponse(data_length);

        if (GetRequestParser().GetProtocolMethod() != Methods::Head) //send a body?
        {
                outstream_str.reset(to_send.release());
                outstream_lastsendsize = 0;
                outstream_buffer_length = 0;
                outstream_buffer.reset(new uint8_t[StreamBufferSize]);
        }
}

//ADDME: Don't map everything at once, instead stream the mapping, or even better: TransmitFile/sendfile
void Connection::SendFile(std::string const &filename)
{
        if (GetRequestParser().GetProtocolMethod() == Methods::Head)
        {
                //ADDME: filestatus isn't always being updated properly because SendFile is externally visible, if it weren't we could just reuse filestatus!
                request->filestatus = Blex::PathStatus(filename);
                if (!request->filestatus.IsFile())
                {
                        FailRequest(StatusInternalError,"I/O error opening " + filename);
                        return;
                }
                PrepareResponse(request->filestatus.FileLength());
        }
        else
        {
                if(outmmap_file.get())
                {
                        FailRequest(StatusInternalError,"Detecting an attempt to send " + filename + " while we already intended to send a file.");
                        return;
                }

                outmmap_file.reset(Blex::MmapFile::OpenRO(filename,true));
                if (!outmmap_file.get())
                {
                        FailRequest(StatusInternalError,"I/O error opening " + filename);
                        return;
                }

                std::string const *contentrange = GetRequestParser().GetHeader("Range");
                Blex::FileOffset startoffset=0, limitoffset=0;
                Blex::FileOffset filelen = outmmap_file->GetFilelength();

                if(contentrange && Blex::StrCaseLike(*contentrange,"bytes=*") && !Blex::StrCaseLike(*contentrange,"*,*"))
                {
                        //ADDME support multiple ranges. deal with mulitple range headers. generalize this code to also support eg SendWebFile responses (which go through SendStream)
                        std::string::const_iterator startparse = contentrange->begin()+6;
                        std::pair<Blex::FileOffset, std::string::const_iterator> res;

                        if(startparse != contentrange->end() && *startparse=='-') //this is a 'last x bytes' request
                        {
                                res = Blex::DecodeUnsignedNumber<Blex::FileOffset>(startparse+1, contentrange->end());
                                if(res.first == 0)
                                {
                                        //Unsatisfiable
                                        protocol.status_so_far = StatusRangeNotSatisfiable;
                                        std::string respheader = "bytes */" + Blex::AnyToString(filelen);
                                        AddHeader("Content-Range", 13, respheader.data(), respheader.size(), false);
                                        return;
                                }
                                limitoffset = filelen;
                                startoffset = res.first > filelen ? 0 : filelen - res.first;
                        }
                        else
                        {
                                res = Blex::DecodeUnsignedNumber<Blex::FileOffset>(startparse, contentrange->end());
                                if(res.second != startparse && res.second != contentrange->end() && res.second[0]=='-')
                                {
                                        if(res.first >= filelen)
                                        {
                                                //Unsatisfiable
                                                protocol.status_so_far = StatusRangeNotSatisfiable;
                                                std::string respheader = "bytes */" + Blex::AnyToString(filelen);
                                                AddHeader("Content-Range", 13, respheader.data(), respheader.size(), false);
                                                return;
                                        }
                                        startoffset = res.first;
                                        ++res.second;
                                        if(res.second == contentrange->end())
                                        {
                                                limitoffset = filelen;
                                        }
                                        else
                                        {
                                                res = Blex::DecodeUnsignedNumber<Blex::FileOffset>(res.second, contentrange->end());
                                                limitoffset = res.first + 1;
                                        }
                                }
                        }
                }

                if(limitoffset != 0 && startoffset < limitoffset && limitoffset <= filelen) //partial content!
                {
                        std::string respheader = "bytes " + Blex::AnyToString(startoffset) + "-" + Blex::AnyToString(limitoffset-1) + "/" + Blex::AnyToString(filelen);
                        AddHeader("Content-Range", 13, respheader.data(), respheader.size(), false);
                        range_start = startoffset;
                        range_limit = limitoffset;
                        protocol.status_so_far = StatusPartialContent;
                }
                else
                {
                        // Sending the whole file

                        // Check if a compressed version of this file exists
                        std::unique_ptr< Blex::MmapFile > outmmap_file_gz(Blex::MmapFile::OpenRO(filename + ".gz", true));
                        if (outmmap_file_gz.get())
                        {
                                // When a compressed version exists, send a 'Vary: Accept-Encoding' header
                                // We want both the compressed and uncompressed version to be cached
                                AddHeader("Vary", 4, "Accept-Encoding", 15, true);

                                // Only send the gzip version if the client accepts it
                                if (request->accept_contentencoding_gzip)
                                {
                                        outmmap_file.swap(outmmap_file_gz);
                                        filelen = outmmap_file->GetFilelength();
                                        AddHeader("Content-Encoding", 16, "gzip", 4, false);
                                }
                        }

                        range_start = 0;
                        range_limit = filelen;
                }

                //Round up to mapping size
                outmmap_offset = range_start - (range_start % MmapBufferSize);
                outmmap_length = filelen;

                PrepareResponse(range_limit - range_start);
                if (filelen == 0)
                {
                        //No data to send, really! Just close it again..
                        outmmap_file.reset();
                        return;
                }
        }
}

bool Connection::IsHeaderSet(const char *fieldname, unsigned fieldlen)
{
        for (unsigned i=0;i<send_headers.size();++i)
        {
                if (send_headers[i].header.size() == fieldlen
                      && Blex::StrCaseCompare<const char*>
                                             ((&*send_headers[i].header.begin()),
                                              (&*send_headers[i].header.end()),
                                              fieldname,
                                              fieldname+fieldlen)==0)
                {
                          //found it!
                          return true;
                }
        }
        return false;
}

std::string const* Connection::GetPreparedHeader(const char *fieldname, unsigned fieldlen)
{
        for (unsigned i=0;i<send_headers.size();++i)
        {
                if (send_headers[i].header.size() == fieldlen
                      && Blex::StrCaseCompare<const char*>
                                             ((&*send_headers[i].header.begin()),
                                              (&*send_headers[i].header.end()),
                                              fieldname,
                                              fieldname+fieldlen)==0)
                {
                          return &send_headers[i].data;
                }
        }
        return NULL;
}

void Connection::AddHeader(const char *fieldname, unsigned fieldlen,const char *datastart, unsigned datalen,bool always_add)
{
        if(protocol.sent_headers)
        {
                request->ErrorLog("Cannot AddHeader after flushing the response");
                return;
        }

        //See if the header already exists?
        if (!always_add)
        {
                for (unsigned i=0;i<send_headers.size();++i)
                {
                        if (send_headers[i].header.size() == fieldlen
                            && Blex::StrCaseCompare(reinterpret_cast<const char*>(&*send_headers[i].header.begin()),
                                                    reinterpret_cast<const char*>(&*send_headers[i].header.end()),
                                                    fieldname,
                                                    fieldname+fieldlen)==0)
                        {
                                //found it!
                                if (datalen==0) //delete header
                                    send_headers.erase(send_headers.begin()+i);
                                else            //overwrite header
                                    send_headers[i].data.assign(datastart,datastart+datalen);
                                return;
                        }
                }
        }

        //add it, if we weren't deleting a header
        if (datalen!=0)
        {
                send_headers.resize(send_headers.size()+1);
                send_headers.back().header.assign(fieldname,fieldname+fieldlen);
                send_headers.back().data.assign(datastart,datastart+datalen);
        }
}

void Connection::RedirectRequest(std::string const &newurl, StatusCodes statuscode)
{
        protocol.status_so_far = statuscode;
        AddHeader("Location",8,&newurl[0],newurl.size(),false);
}

} //end namespace WebServer
