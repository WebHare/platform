#include <ap/libwebhare/allincludes.h>


#include <blex/crypto.h>
#include <blex/logfile.h>
#include <blex/path.h>
#include <blex/utils.h>
#include "consilio.h"
#include "consilio_main.h"
#include "consilio_janitor.h"
#include "langspecific.h"
#include "field.h"
#include "indexreader.h"
#include "indexwriter.h"
#include "query.h"
#include "queryparser.h"
#include "searcher.h"
#include "termquery.h"
#include "wildcardquery.h"
#include <ap/libwebhare/webscon.h>

using namespace WebServer;
using namespace Lucene;

/// Time connecting processes have to wait before resending command when optimizing
const std::string RetryAfter("30"); //retry after 30 seconds

/// How much context to print before the first match in summaries, in ConsilioToken%s
const uint32_t ContextBefore = 6;

std::string GetUrlMD5(std::string const &input)
{
        // Calculate MD5 of url, to be used as the cache file's filename
        Blex::MD5 md5;
        md5.Process(input.c_str(), input.size());
        uint8_t dirhash[Blex::MD5HashLen];
        memcpy(dirhash, md5.Finalize(), sizeof dirhash);
        std::string filename;
        Blex::EncodeBase16(dirhash, dirhash + sizeof dirhash, std::back_inserter(filename));
        return filename;
}

Blex::DateTime DecodeDateTime(const std::string &datetime)
{
        if (datetime.size() != 17 || datetime[0] != '@')
            return Blex::DateTime::Invalid();

        uint32_t days = Blex::DecodeUnsignedNumber<uint32_t>(datetime.begin()+1,datetime.begin()+9,16).first;
        uint32_t msecs = Blex::DecodeUnsignedNumber<uint32_t>(datetime.begin()+9,datetime.end(),16).first;
        return Blex::DateTime(days, msecs);
}
std::string EncodeDateTime(Blex::DateTime datetime)
{
        if (datetime == Blex::DateTime::Invalid())
            return "";

        std::string days = "0000000";
        Blex::EncodeNumber<uint32_t>(datetime.GetDays(), 16, std::back_inserter(days));
        std::string msecs = "0000000";
        Blex::EncodeNumber<uint32_t>(datetime.GetMsecs(), 16, std::back_inserter(msecs));
        return "@" + days.substr(days.size()-8) + msecs.substr(msecs.size()-8);
}

IndexManager::Command IndexManager::ParseCommand(const std::string &url)
{
        std::vector<std::string> parts;
        Command cmd;
        Blex::TokenizeString(url, '/', &parts);
        if (parts[0] == ""              // url starts with '/'
            && parts.size() > 1)        // url contains at least one '/'
        {
                if (parts[1] == "index")// index-specific action, read indexid and action
                {
                        if (parts.size() > 3)
                        {
                                cmd.indexid = parts[2];
                                cmd.action = parts[3];
                        }
                }
                else                    // just a single action
                {
                        cmd.action = parts[1];
                }
        }
        return cmd;
}

void IndexManager::HandleIndexRequest(WebServer::Connection *webcon, std::string const &)
{
        LogLevel l = GetLogLevel();

        if (webcon->GetRequestParser().GetProtocolMethod() == Methods::Get
            || webcon->GetRequestParser().GetProtocolMethod() == Methods::Head
            || webcon->GetRequestParser().GetProtocolMethod() == Methods::Post)
        {
                std::string url(webcon->GetRequestParser().GetReceivedUrl().begin(),std::find(webcon->GetRequestParser().GetReceivedUrl().begin(), webcon->GetRequestParser().GetReceivedUrl().end(), '?'));

                //Extract action and possible indexid from received url
                Command cmd = ParseCommand(url);
                DEBUGPRINT("Got action " << cmd.action << " for index " << cmd.indexid);

                if (cmd.action == "setstatus")
                {
                        if (l >= Log_Debug)
                            Blex::ErrStream() << webcon->GetRemoteAddress().GetPort() << " got action " << cmd.action;

                        SetStatusRequest(webcon);
                }
                else
                {
                        // Add index check header if index should be checked
                        if (*LockedStatus::ReadRef(indexstatus) == IndexCheck)
                            webcon->AddHeader("Index-Status",12,"check",5,false);

                        if (cmd.action == "connect")
                        {
                                if (l >= Log_Debug)
                                    Blex::ErrStream() << webcon->GetRemoteAddress().GetPort() << " got action " << cmd.action;

                                ConnectionRequest(webcon);
                        }
                        else if (cmd.action == "configure")
                        {
                                if (l >= Log_Debug)
                                    Blex::ErrStream() << webcon->GetRemoteAddress().GetPort() << " got action " << cmd.action;

                                if (webcon->GetCategoryRunPermission(2))
                                    ConfigureRequest(webcon);
                                else if (l >= Log_Debug)
                                    Blex::ErrStream() << webcon->GetRemoteAddress().GetPort() << " put to sleep";
                        }
                        else if (cmd.action == "search")
                        {
                                if (l >= Log_Debug)
                                    Blex::ErrStream() << webcon->GetRemoteAddress().GetPort() << " got action search: index=" << cmd.indexid <<
                                                     ", query=" << webcon->GetRequestParser().GetVariableValue("query");

                                SearchRequest(webcon, cmd.indexid);
                        }
                        else if (cmd.action == "suggest")
                        {
                                if (l >= Log_Debug)
                                    Blex::ErrStream() << webcon->GetRemoteAddress().GetPort() << " got action suggest: index=" << cmd.indexid <<
                                                     ", query=" << webcon->GetRequestParser().GetVariableValue("query");

                                SuggestRequest(webcon, cmd.indexid);
                        }
                        else if (cmd.action == "size")
                        {
                                if (l >= Log_Debug)
                                    Blex::ErrStream() << webcon->GetRemoteAddress().GetPort() << " got action size: index=" << cmd.indexid;

                                SizeRequest(webcon, cmd.indexid);
                        }
                        else if (cmd.action == "indexlist")
                        {
                                if (l >= Log_Debug)
                                    Blex::ErrStream() << webcon->GetRemoteAddress().GetPort() << " got action indexlist";

                                IndexListRequest(webcon);
                        }
                        else if (cmd.action == "add")
                        {
                                if (l >= Log_Debug)
                                    Blex::ErrStream() << webcon->GetRemoteAddress().GetPort() << " got action add: index=" << cmd.indexid <<
                                                     ", groupid=" << webcon->GetRequestParser().GetVariableValue("groupid") <<
                                                     ", objectid=" << webcon->GetRequestParser().GetVariableValue("objectid");

                                if (IsIndexAvailable(webcon))
                                {
                                        if (webcon->GetCategoryRunPermission(1))
                                            IndexRequest(webcon, cmd.indexid);
                                        else if (l >= Log_Debug)
                                            Blex::ErrStream() << webcon->GetRemoteAddress().GetPort() << " put to sleep";
                                }
                        }
                        else if (cmd.action == "delete")
                        {
                                if (l >= Log_Debug)
                                    Blex::ErrStream() << webcon->GetRemoteAddress().GetPort() << " got action delete: index=" << cmd.indexid <<
                                                     ", contentsource=" << webcon->GetRequestParser().GetVariableValue("contentsource") <<
                                                     ", groupid=" << webcon->GetRequestParser().GetVariableValue("groupid") <<
                                                     ", objectid=" << webcon->GetRequestParser().GetVariableValue("objectid");

                                if (IsIndexAvailable(webcon))
                                {
                                        if (webcon->GetCategoryRunPermission(1))
                                            DeleteRequest(webcon, cmd.indexid);
                                        else if (l >= Log_Debug)
                                            Blex::ErrStream() << webcon->GetRemoteAddress().GetPort() << " put to sleep";
                                }
                        }
                        else if (cmd.action == "deleteoutdated")
                        {
                                if (l >= Log_Debug)
                                    Blex::ErrStream() << webcon->GetRemoteAddress().GetPort() << " got action outdated: index=" << cmd.indexid <<
                                                     ", contentsource=" << webcon->GetRequestParser().GetVariableValue("contentsource") <<
                                                     ", groupid=" << webcon->GetRequestParser().GetVariableValue("groupid") <<
                                                     ", objectid=" << webcon->GetRequestParser().GetVariableValue("objectid") <<
                                                     ", last_indexed=" << webcon->GetRequestParser().GetVariableValue("last_indexed");

                                if (webcon->GetCategoryRunPermission(1))
                                    DeleteOutdatedRequest(webcon, cmd.indexid);
                                else if (l >= Log_Debug)
                                    Blex::ErrStream() << webcon->GetRemoteAddress().GetPort() << " put to sleep";
                        }
                        else if (cmd.action == "moddate")
                        {
                                if (l >= Log_Debug)
                                    Blex::ErrStream() << webcon->GetRemoteAddress().GetPort() << " got action moddate: index=" << cmd.indexid <<
                                                     ", groupid=" << webcon->GetRequestParser().GetVariableValue("groupid") <<
                                                     ", objectid=" << webcon->GetRequestParser().GetVariableValue("objectid");

                                ModDateRequest(webcon, cmd.indexid);
                        }
                        else if (cmd.action == "optimize")
                        {
                                if (l >= Log_Debug)
                                    Blex::ErrStream() << webcon->GetRemoteAddress().GetPort() << " got action optimize";

                                if (webcon->GetCategoryRunPermission(1))
                                    OptimizeRequest(webcon);
                                else if (l >= Log_Debug)
                                    Blex::ErrStream() << webcon->GetRemoteAddress().GetPort() << " put to sleep";
                        }
                        else if (cmd.action == "status")
                        {
                                if (l >= Log_Debug)
                                    Blex::ErrStream() << webcon->GetRemoteAddress().GetPort() << " got action status";

                                StatusRequest(webcon);
                        }
                        else if (cmd.action.empty())
                        {
                                webcon->FailRequest(WebServer::StatusBadRequest, "No action");
                        }
                        else
                        {
                                webcon->FailRequest(WebServer::StatusNotFound, "Unknown action '" + cmd.action + "'");
                        }
                }
        }
        else
        {
                webcon->FailRequest(WebServer::StatusMethodNotAllowed,"The IndexManager does not support method " + webcon->GetRequestParser().GetProtocolMethodString());
        }
        WebServer::Request const &request = webcon->GetRequest();
        uint32_t requesttime = static_cast<uint32_t>( (Blex::GetSystemCurrentTicks() - request.request_start)/ (Blex::GetSystemTickFrequency()/1000) );
        if (l >= Log_Debug)
            Blex::ErrStream() << webcon->GetRemoteAddress().GetPort() << " handling request took " << requesttime << "ms";
}

bool IndexManager::IsIndexAvailable(WebServer::Connection *webcon)
{
        if (*LockedStatus::ReadRef(indexstatus) != IndexOptimizing)
            return true;

        if (GetLogLevel() >= Log_Statistics)
            Blex::ErrStream() << webcon->GetRemoteAddress().GetPort() << " not running - index not clean";

        // Index not available, Fetcher should retry after 30 seconds
        webcon->AddHeader("Retry-After",11,RetryAfter.data(),RetryAfter.size(),false);
        webcon->FailRequest(StatusServiceUnavailable,"Index not clean, try again later");
        return false;
}

std::vector<uint32_t> IndexManager::GetOutdatedObjects(std::string const &last_indexed, std::string const &indexid, std::string const &contentsource, std::string const &groupid, std::string const &objectid, std::vector<std::string> *active)
{
        // Open the index
        const std::unique_ptr<IndexSearcher> searcher(new IndexSearcher(commit_lock, *indexdirectory, cache));

        // Get a list of files for the indexid, not having the given date_indexed date
        QueryPtr query(new BooleanQuery());
        ((BooleanQuery *)query.get())->Add(QueryPtr(new TermQuery(Term("indexid", indexid))), true, false);
        if (!contentsource.empty())
            ((BooleanQuery *)query.get())->Add(QueryPtr(new TermQuery(Term("contentsource", contentsource))), true, false);
        if (!groupid.empty())
            ((BooleanQuery *)query.get())->Add(QueryPtr(new TermQuery(Term("groupid", groupid))), true, false);
        if (!objectid.empty())
            ((BooleanQuery *)query.get())->Add(QueryPtr(new TermQuery(Term("objectid", objectid))), true, false);
        std::shared_ptr<Hits> hits(searcher->Search(query));

        std::vector<uint32_t> deleted;
        if (active)
            active->clear();
        for (uint32_t i = 0; i < hits->size(); ++i)
        {
                DEBUGPRINT("Checking " << hits->Doc(i)->Get("groupid") << ":" << hits->Doc(i)->Get("objectid") << " (" << hits->Doc(i)->Get("date_indexed") << ")");
                // Only urls having date_indexed less than last_indexed
                std::string date_indexed = hits->Doc(i)->Get("date_indexed");
                if (date_indexed < last_indexed)
                    deleted.push_back(hits->Id(i));
                else if (active)
                    active->push_back(hits->Doc(i)->Get("objectid"));
        }
        return deleted;
}

void IndexManager::ConnectionRequest(WebServer::Connection *webcon)
{
        LogLevel l = GetLogLevel();
        if (l >= Log_Debug)
            Blex::ErrStream() << webcon->GetRemoteAddress().GetPort() << " now running";

        // Add configure header if indexmanager should be configured
        if (!(*LockedConfigured::ReadRef(indexmanagerconfigured)))
            webcon->AddHeader("Configure",9,"all",3,false);

        DEBUGPRINT("Fetcher connected");
}

void IndexManager::ConfigureRequest(WebServer::Connection *webcon)
{
        LogLevel l = GetLogLevel();
        if (l >= Log_Debug)
            Blex::ErrStream() << webcon->GetRemoteAddress().GetPort() << " now running";

        RequestParser &reqparser = webcon->GetRequestParser();
        const WebVars & fields = reqparser.GetVariables();
        WebVars::const_iterator type = fields.find("type");
        if (type != fields.end())
        {
                std::unique_ptr<Blex::RandomStream> body;
                WebVars::const_iterator filefield = fields.find("file");
                if (filefield != fields.end())
                {
                        body.reset(reqparser.OpenFile("file"));
                        if (!body.get())
                            body.reset(new Blex::MemoryReadStream(filefield->second.contents.data(), filefield->second.contents.size()));
                }
                else
                {
                        if (l >= Log_Debug)
                            Blex::ErrStream() << "No file received";
                        return;
                }

                // Don't ask for configuration again
                *LockedConfigured::WriteRef(indexmanagerconfigured) = true;

                if (type->second.contents == "stopwords")
                {
                        if (l >= Log_Debug)
                            Blex::ErrStream() << "Got a new stop word list!";

                        if (!ReadStopWordXml(*body) && l >= Log_Debug)
                            Blex::ErrStream() << "Could not read stop word xml";
                }
                else if (l >= Log_Debug)
                    Blex::ErrStream() << "Unknown configuration type '" << type->second.contents << "' received";
        }
        else if (l >= Log_Debug)
            Blex::ErrStream() << "No configuration type received";
}

void IndexManager::SetStatusRequest(WebServer::Connection *webcon)
{
        LogLevel l = GetLogLevel();
        if (l >= Log_Debug)
            Blex::ErrStream() << webcon->GetRemoteAddress().GetPort() << " now running";

        *LockedStatus::WriteRef(indexstatus) = IndexManager::IndexOk;

        DEBUGPRINT("Index status cleared");
}

void IndexManager::IndexRequest(WebServer::Connection *webcon, std::string const &indexid)
{
        LogLevel l = GetLogLevel();
        if (l >= Log_Debug)
            Blex::ErrStream() << webcon->GetRemoteAddress().GetPort() << " now running";

        RequestParser &reqparser = webcon->GetRequestParser();
        const WebVars & fields = reqparser.GetVariables();

        if (indexid.empty() || indexid == "0")
        {
                webcon->FailRequest(StatusBadRequest,"No index given");
                return;
        }
        if (fields.find("objectid") == fields.end())
        {
                webcon->FailRequest(StatusBadRequest,"No objectid given");
                return;
        }
        if (fields.find("contentprovider") == fields.end())
        {
                webcon->FailRequest(StatusBadRequest,"No contentprovider given");
                return;
        }
        if (fields.find("date_indexed") == fields.end())
        {
                webcon->FailRequest(StatusBadRequest,"No or invalid date_indexed given");
                return;
        }

        std::string id = indexid + "/" + fields.find("objectid")->second.contents;
        DEBUGPRINT("Received index request for " << id);

        // Calculate MD5 of the id, to be used as the object's identifier within the index
        std::string filename = GetUrlMD5(id);
        DEBUGPRINT("Using filename " << filename);

        // Store the received body text in a randomstream
        std::shared_ptr<Blex::RandomStream> body;
        if (fields.find("body") != fields.end())
        {
                body.reset(reqparser.OpenFile("body"));
                if (!body.get())
                {
                        body.reset(new Blex::MemoryRWStream());
                        std::string fieldvalue = fields.find("body")->second.contents.substr(0, MaxCacheFileSize);
                        body->DirectWrite(0, fieldvalue.c_str(), fieldvalue.size());
                }
                body->SetOffset(0);
        }

        // Write body to cache file, if "-body" is not specified (the cache file
        // will only be used to store body text, all other fields are stored within
        // the index
        if (body.get() && fields.find("-discardsummaries") == fields.end())
        {

                // Open cache file
                cachefs->DeletePath(filename+".tmp");
                std::shared_ptr<Blex::ComplexFileStream> cachestream(cachefs->OpenFile(filename + ".tmp", true, true));
                if (!cachestream.get())
                    throw std::runtime_error("Cannot open cache file");

                body->LimitedSendTo(MaxCacheFileSize, *cachestream);
                body->SetOffset(0);

                // Index file
                cachestream.reset();

                // Make sure the data is flushed to disk first
                cachefs->MovePath(filename+".tmp", filename);
                cachefs->Flush();
        }
        else
        {
                // Delete existing cache file, as it is not needed (anymore)
                cachefs->DeletePath(filename);
                cachefs->Flush();
        }

        // Add a buffer before the stream, utf8 reader will read byte by byte
        std::shared_ptr< Blex::RandomStream > body_buffered;
        if (body.get())
            body_buffered.reset(new Blex::BufferedRandomStream(body));

        int ms = IndexFile(filename, indexid, fields, body_buffered);
        std::string indextime = Blex::AnyToString(ms);
        webcon->AddHeader("Index-Time", 10, indextime.data(), indextime.size(), false);
}

void IndexManager::DeleteRequest(WebServer::Connection *webcon, std::string const &indexid)
{
        if (!IsIndexAvailable(webcon))
            return;
        LogLevel l = GetLogLevel();
        if (l >= Log_Debug)
            Blex::ErrStream() << webcon->GetRemoteAddress().GetPort() << " now running";

        const WebVars & fields = webcon->GetRequestParser().GetVariables();

        // Find valid fieldname
        std::string groupid;
        WebVars::const_iterator field = fields.find("groupid");
        if (field != fields.end())
            groupid = field->second.contents;
        std::string objectid;
        field = fields.find("objectid");
        if (field != fields.end())
            objectid = field->second.contents;
        std::string contentsource;
        field = fields.find("contentsource");
        if (field != fields.end())
            contentsource = field->second.contents;

        if (!indexid.empty() || !groupid.empty() || !objectid.empty() || !contentsource.empty())
        {
                uint32_t numdel = DeleteFiles(indexid, groupid, objectid, contentsource);
                std::string deleted = Blex::AnyToString(numdel);
                webcon->AddHeader("Deleted",7,deleted.data(),deleted.size(),false);
        }
        else
            webcon->FailRequest(StatusBadRequest,"Incomplete or invalid delete request");
}

void IndexManager::DeleteOutdatedRequest(WebServer::Connection *webcon, std::string const &indexid)
{
        LogLevel l = GetLogLevel();
        if (l >= Log_Debug)
            Blex::ErrStream() << webcon->GetRemoteAddress().GetPort() << " now running";

        RequestParser &reqparser = webcon->GetRequestParser();
        const WebVars & fields = reqparser.GetVariables();

        std::string results;
        int n = 0;
        // Get index dates for an index
        if (!indexid.empty() && indexid != "0" && fields.find("last_indexed") != fields.end())
        {
                // Get all objects indexed before a given date_indexed
                std::string last_indexed(fields.find("last_indexed")->second.contents);

                // If contentsource is given, only delete objects within the contentsource
                std::string contentsource;
                if (fields.find("contentsource") != fields.end())
                    contentsource = fields.find("contentsource")->second.contents;

                // If groupid is given, only delete objects within the group
                std::string groupid;
                if (fields.find("groupid") != fields.end())
                    groupid = fields.find("groupid")->second.contents;

                // If objectid is given, only delete those objects
                std::string objectid;
                if (fields.find("objectid") != fields.end())
                    objectid = fields.find("objectid")->second.contents;

                DEBUGPRINT("Received deleteoutdated request for indexid " << indexid << " with last_indexed " << last_indexed);

                // Collect all urls
                std::vector<std::string> active;
                std::vector<uint32_t> outdated = GetOutdatedObjects(last_indexed, indexid, contentsource, groupid, objectid, objectid.empty() && groupid.empty() ? NULL : &active);
                const std::unique_ptr<IndexReader> reader(IndexReader::Open(commit_lock, *indexdirectory, cache));
                for (uint32_t i = 0; i < outdated.size(); ++i)
                {
                        DEBUGPRINT("Deleting document #" << outdated[i]);
                        reader->Delete(outdated[i]);

                        ++n;
                }
                std::string results;
                for (uint32_t i = 0; i < active.size(); ++i)
                    results += active[i] + "\n";

                // Send results
                std::string deleted = Blex::AnyToString(n);
                webcon->AddHeader("Deleted",7,deleted.data(),deleted.size(),false);
                webcon->GetAsyncInterface()->StoreData(results.data(), results.size());
                DEBUGPRINT("Deleted " << n << " outdated results");
        }
        else
        {
                webcon->FailRequest(StatusBadRequest,"No indexid and last_indexed given");
                return;
        }
}

void IndexManager::ModDateRequest(WebServer::Connection *webcon, std::string const &indexid)
{
        LogLevel l = GetLogLevel();
        if (l >= Log_Debug)
            Blex::ErrStream() << webcon->GetRemoteAddress().GetPort() << " now running";

        RequestParser &reqparser = webcon->GetRequestParser();
        const WebVars & fields = reqparser.GetVariables();

        std::string results;
        int n = 0;
        // Get modification dates for a group or object
        if (fields.find("groupid") != fields.end() || fields.find("objectid") != fields.end())
        {
                // Open the index
                const std::unique_ptr<IndexSearcher> searcher(new IndexSearcher(commit_lock, *indexdirectory, cache));

                // Get a list of files for the groupid
                QueryPtr query(new BooleanQuery());
                if (!indexid.empty() && indexid != "0")
                    ((BooleanQuery *)query.get())->Add(QueryPtr(new TermQuery(Term("indexid", indexid))), true, false);
                if (fields.find("groupid") != fields.end())
                {
                        DEBUGPRINT("Received modification date request for groupid " << fields.find("groupid")->second.contents);
                        ((BooleanQuery *)query.get())->Add(QueryPtr(new TermQuery(Term("groupid", fields.find("groupid")->second.contents))), true, false);
                }
                else
                {
                        DEBUGPRINT("Received modification date request for objectid " << fields.find("objectid")->second.contents);
                        ((BooleanQuery *)query.get())->Add(QueryPtr(new TermQuery(Term("objectid", fields.find("objectid")->second.contents))), true, false);
                }
                const std::unique_ptr<Hits> hits(searcher->Search(query));

                // Collect all urls
                for (uint32_t i = 0; i < hits->size(); ++i)
                {
                        results += hits->Doc(i)->Get("objectid")
                                 + "\t" + hits->Doc(i)->Get("date_modified")
                                 + "\n";
                        ++n;
                }
        }
        else
        {
                webcon->FailRequest(StatusBadRequest,"No groupid or objectid given");
                return;
        }

        // Send results
        DEBUGPRINT("Sending " << n << " moddate results");
        webcon->GetAsyncInterface()->StoreData(results.data(), results.size());
}

void IndexManager::SearchRequest(WebServer::Connection *webcon, std::string const &indexid)
{
        LogLevel l = GetLogLevel();
        if (l >= Log_Debug)
            Blex::ErrStream() << webcon->GetRemoteAddress().GetPort() << " now running";

        RequestParser &reqparser = webcon->GetRequestParser();

        if (reqparser.GetVariables().find("query") == reqparser.GetVariables().end()
            && reqparser.GetVariables().find("objectid") == reqparser.GetVariables().end())
        {
                webcon->FailRequest(StatusBadRequest,"Empty search request");
                return;
        }

        // Perform search
        SearchResults results;
        int32_t total = Search(reqparser.GetVariables(), indexid, &results);
        if (total == -1)
        {
                webcon->FailRequest(StatusInternalError,"Error while searching");
                return;
        }

        // Return results
        for (SearchResults::iterator it = results.begin(); it != results.end(); ++it)
            webcon->GetAsyncInterface()->StoreData(it->data(), it->size());

        std::string totalhits = Blex::AnyToString(total);
        webcon->AddHeader("Total-Hits",10,totalhits.data(),totalhits.size(),false);

        // Set content type to plain text, so result is directly viewable in browser
        webcon->AddHeader("Content-Type",12,"text/plain",10,false);
        webcon->AddHeader("Content-Disposition",19,"inline;filename=results.txt",27,false);

        DEBUGPRINT("Sending " << results.size() << " of " << total << " results");
}

void IndexManager::SuggestRequest(WebServer::Connection *webcon, std::string const &indexid)
{
        LogLevel l = GetLogLevel();
        if (l >= Log_Debug)
            Blex::ErrStream() << webcon->GetRemoteAddress().GetPort() << " now running";

        RequestParser &reqparser = webcon->GetRequestParser();

        if (reqparser.GetVariables().find("query") == reqparser.GetVariables().end())
        {
                webcon->FailRequest(StatusBadRequest,"Empty search request");
                return;
        }

        // Perform search
        SearchResults results;
        int32_t total = GetSuggestKeywords(reqparser.GetVariables(), indexid, &results);
        if (total == -1)
        {
                webcon->FailRequest(StatusInternalError,"Error while searching");
                return;
        }

        // Return results
        for (SearchResults::iterator it = results.begin(); it != results.end(); ++it)
            webcon->GetAsyncInterface()->StoreData(it->data(), it->size());

        std::string totalhits = Blex::AnyToString(total);
        webcon->AddHeader("Total-Hits",10,totalhits.data(),totalhits.size(),false);
        webcon->AddHeader("Content-Type",12,"text/plain",10,false);

        DEBUGPRINT("Sending " << results.size() << " of " << total << " results");
}

void IndexManager::SizeRequest(WebServer::Connection *webcon, std::string const &indexid)
{
        LogLevel l = GetLogLevel();
        if (l >= Log_Debug)
            Blex::ErrStream() << webcon->GetRemoteAddress().GetPort() << " now running";

        if (indexid.empty())
        {
                webcon->FailRequest(StatusBadRequest,"No index given");
                return;
        }

        int32_t total = IndexSize(indexid);
        if (total == -1)
        {
                webcon->FailRequest(StatusInternalError,"Error while searching");
                return;
        }

        std::string totalhits = Blex::AnyToString(total);
        webcon->AddHeader("Index-Size",10,totalhits.data(),totalhits.size(),false);

        DEBUGPRINT("Sending index " << indexid << " size " << totalhits);
}

void IndexManager::IndexListRequest(WebServer::Connection *webcon)
{
        LogLevel l = GetLogLevel();
        if (l >= Log_Debug)
            Blex::ErrStream() << webcon->GetRemoteAddress().GetPort() << " now running";

        SearchResults indices;
        if (!IndexList(&indices))
        {
                webcon->FailRequest(StatusInternalError,"Error while searching");
                return;
        }

        // Return results
        for (SearchResults::iterator it = indices.begin(); it != indices.end(); ++it)
            webcon->GetAsyncInterface()->StoreData(it->data(), it->size());

        std::string numindices = Blex::AnyToString(indices.size());
        webcon->AddHeader("Index-List",10,numindices.data(),numindices.size(),false);

        DEBUGPRINT("Sending " << numindices << " indices");
}

void IndexManager::OptimizeRequest(WebServer::Connection *webcon)
{
        if (!IsIndexAvailable(webcon))
            return;
        LogLevel l = GetLogLevel();
        if (l >= Log_Debug)
            Blex::ErrStream() << webcon->GetRemoteAddress().GetPort() << " now running";


        int ms = OptimizeIndex();
        std::string indextime = Blex::AnyToString(ms);
        webcon->AddHeader("Index-Time",10,indextime.data(),indextime.size(),false);
}

void IndexManager::StatusRequest(WebServer::Connection *webcon)
{
        std::string status;
        status = "indexstatus=" + Blex::AnyToString<int>(*LockedStatus::ReadRef(indexstatus)) + "\n";
        status += janitor->GetStatus();

        webcon->GetAsyncInterface()->StoreData(status.data(), status.size());
}

int IndexManager::IndexFile(const std::string &filename, const std::string &indexid, const WebVars &fields, std::shared_ptr<Blex::RandomStream> body)
{
        Blex::DateTime totaltime = Blex::DateTime::Now();
        LogLevel l = GetLogLevel();
        if (l >= Log_Debug)
            Blex::ErrStream() << "Adding document " << filename;

        Lucene::Document doc;
        doc.Add(Lucene::Field::Keyword("id", filename));
        doc.Add(Lucene::Field::Keyword("indexid", indexid));

        // The file's body text is not one of the fields
        if (body.get())
            doc.Add(Lucene::Field::Text("body", body));

        // Add all other fields (these are all stored in the index)
        for (WebVars::const_iterator field = fields.begin(); field != fields.end(); ++field)
        {
                // Don't index parameters
                if (field->first.compare(0,1,"-") == 0)
                    continue;

                if (field->first.compare("body") != 0 && !field->second.contents.empty())
                {
                        if (field->first.compare("suggestfields") == 0)
                            // Tokenize and index suggest fields (don't have to be stored)
                            doc.Add(Lucene::Field::Text(field->first, field->second.contents.substr(0, MaxCacheFileSize)));
                        else if (IsTokenizedField(field->first))
                            // Tokenize, index and store (we want to search for single words)
                            doc.Add(Lucene::Field(field->first, field->second.contents.substr(0, MaxCacheFileSize), true, true, true));
                        else
                            // Required fields: index and store, don't tokenize
                            doc.Add(Lucene::Field::Keyword(field->first, field->second.contents.substr(0, MaxCacheFileSize)));
                }
        }

        Lucene::IndexWriter(commit_lock, *indexdirectory, *ramfs, cache, false).AddDocument(filename, doc);

        totaltime = Blex::DateTime::Now() - totaltime;
        if (l >= Log_Statistics)
            Blex::ErrStream() << "Document added (" << totaltime.GetMsecs() << "ms)";

        return totaltime.GetMsecs();
}

uint32_t IndexManager::DeleteFiles(std::string const &indexid, std::string const &groupid, std::string const &objectid, std::string const &contentsource)
{
        Blex::DateTime totaltime = Blex::DateTime::Now();
        LogLevel l = GetLogLevel();
        if (l >= Log_Debug)
            Blex::ErrStream() << "Deleting " << indexid << "." << groupid << ": " << objectid;

        // Delete by single Term
        if ((indexid.empty() || indexid == "0") && contentsource.empty())
        {
                if (!groupid.empty())
                    return DeleteTerm("groupid", groupid);
                else if (!objectid.empty())
                    return DeleteTerm("objectid", objectid);
        }

        // Prepare a deletion query
        QueryPtr query(new BooleanQuery());
        if (!indexid.empty())
            ((BooleanQuery *)query.get())->Add(QueryPtr(new TermQuery(Term("indexid", indexid))), true, false);
        if (!groupid.empty())
            ((BooleanQuery *)query.get())->Add(QueryPtr(new TermQuery(Term("groupid", groupid))), true, false);
        if (!objectid.empty())
            ((BooleanQuery *)query.get())->Add(QueryPtr(new TermQuery(Term("objectid", objectid))), true, false);
        if (!contentsource.empty())
            ((BooleanQuery *)query.get())->Add(QueryPtr(new TermQuery(Term("contentsource", contentsource))), true, false);

        if (((BooleanQuery *)query.get())->GetClauses().size() == 0)
            return 0; // Nothing to search

        uint32_t deleted = DeleteQuery(query);

        totaltime = Blex::DateTime::Now() - totaltime;
        if (l >= Log_Statistics)
            Blex::ErrStream() << "Deleted " << deleted << " documents (" << totaltime.GetMsecs() << "ms)";

        return deleted;
}

uint32_t IndexManager::DeleteQuery(QueryPtr query)
{
        Blex::DateTime totaltime = Blex::DateTime::Now();

        // Single term queries can be deleted using DeleteTerm
        TermQuery *q = dynamic_cast<TermQuery *>(query.get());
        if(q)
            return DeleteTerm(q->GetTerm().Field(), q->GetTerm().Text());

        // Open the index
        const std::unique_ptr<IndexSearcher> searcher(new IndexSearcher(commit_lock, *indexdirectory, cache));

        // Get a list of files to delete
        const std::unique_ptr<Hits> hits(searcher->Search(query));

        // Delete all files on the list using the id field
        const std::unique_ptr<IndexReader> reader(IndexReader::Open(commit_lock, *indexdirectory, cache));
        uint32_t numdel = 0;
        for (uint32_t i = 0; i < hits->size(); ++i)
        {
                numdel += reader->Delete(Term("id",hits->Doc(i)->Get("id")));
        }

        totaltime = Blex::DateTime::Now() - totaltime;
        LogLevel l = GetLogLevel();
        if (l >= Log_Statistics)
            Blex::ErrStream() << "Deleted " << numdel << " file" << (numdel != 1 ? "s" : "") << " (" << totaltime.GetMsecs() << "ms)";

        return numdel;
}

uint32_t IndexManager::DeleteTerm(const std::string & fieldname, const std::string & fieldvalue)
{
        Blex::DateTime totaltime = Blex::DateTime::Now();

        Term todelete(fieldname, fieldvalue);
        DEBUGPRINT("Deleting term " << todelete.ToString());

        const std::unique_ptr<IndexReader> reader(IndexReader::Open(commit_lock, *indexdirectory, cache));

        uint32_t numdel = reader->Delete(todelete);

        totaltime = Blex::DateTime::Now() - totaltime;
        LogLevel l = GetLogLevel();
        if (l >= Log_Statistics)
            Blex::ErrStream() << "Deleted " << numdel << " file" << (numdel != 1 ? "s" : "") << " for " << fieldname << ":" << fieldvalue << " (" << totaltime.GetMsecs() << "ms)";

        return numdel;
}

int IndexManager::OptimizeIndex()
{
        Blex::DateTime totaltime = Blex::DateTime::Now();
        LogLevel l = GetLogLevel();

        // Set index status
        {
                LockedStatus::WriteRef status(indexstatus);
                if (*status != IndexOk)
                {
                        if (l >= Log_Statistics)
                            Blex::ErrStream() << "Not optimizing index, should be checked or rebuilt first";
                        return -1;
                }
                *status = IndexOptimizing;
        }

        if (l >= Log_Debug)
            Blex::ErrStream() << "Optimizing index...";

        Blex::DateTime opttime = Blex::DateTime::Now();

        // Optimize index
        IndexWriter(commit_lock, *indexdirectory, *ramfs, cache, false).Optimize();

        opttime = Blex::DateTime::Now() - opttime;
        if (l >= Log_Statistics)
            Blex::ErrStream() << "Index is optimized (" << opttime.GetMsecs() << "ms)";

        if (l >= Log_Debug)
            Blex::ErrStream() << "Cleaning out cachefs...";

        // If some of the search results are deleted after the search was performed,
        // but before the relevant cache files are read, then we will delete those
        // cache files here. This will generate some errors ("Could not read cache
        // file"), preventing those pages from being returned with the search results,
        // which is ok.

        opttime = Blex::DateTime::Now();
        uint32_t deleted = 0;
        uint32_t cachefiles = 0;

        // Put all index id's in a set
        std::set<std::string> indexids;
        std::unique_ptr<IndexReader> reader(IndexReader::Open(commit_lock, *indexdirectory, cache));
        for (uint32_t d = 0; d < reader->MaxDoc(); ++d)
        {
                const std::unique_ptr<Document> doc(reader->GetDocument(d));
                if (doc.get())
                    indexids.insert(doc->Get("id"));
        }
        reader.reset();

        // Delete all cachefs files which are not indexed
        std::vector<std::string> cachelist = cachefs->ListDirectory("*");
        for (std::vector<std::string>::const_iterator cachefile = cachelist.begin(); cachefile != cachelist.end(); ++cachefile)
        {
                if (indexids.find(*cachefile) == indexids.end())
                {
                        ++deleted;
                        cachefs->DeletePath(*cachefile);
                }
                else
                    ++cachefiles;
        }
        cachefs->Flush();

        opttime = Blex::DateTime::Now() - opttime;
        if (l >= Log_Statistics)
        {
                Blex::ErrStream() << "Cleaned out " << deleted << " cachefs files (" << opttime.GetMsecs() << "ms)";
                Blex::ErrStream() << "The index contains " << indexids.size() << " pages, cachefs contains " << cachefiles << " files";
        }

        *LockedStatus::WriteRef(indexstatus) = IndexOk;

        totaltime = Blex::DateTime::Now() - totaltime;
        return totaltime.GetMsecs();
}

int32_t IndexManager::Search(const WebVars &fields, const std::string &indexid, SearchResults * results)
{
        DEBUGPRINT("Processing search request");
        Blex::DateTime totaltime = Blex::DateTime::Now();
        LogLevel l = GetLogLevel();
        WebVars::const_iterator field;

        std::string querystring;
        std::string objectid;

        field = fields.find("query");
        if ((field == fields.end()) || (field->second.contents.size() == 0))
        {
                field = fields.find("objectid");
                if ((field == fields.end()) || (field->second.contents.size() == 0))
                    return 0;
                objectid = field->second.contents;
        }
        else
        {
                querystring = field->second.contents;
        }

        std::vector<std::string> req_fields;
        bool allfields = false;
        field = fields.find("fields");
        if (field != fields.end())
        {
                if (field->second.contents == "*")
                    // If requested fields is '*', return all fields
                    allfields = true;
                else
                {
                        // Tokenizing on ',', but not trimming, so don't put spaces around field names!
                        std::vector<std::string> tokenized;
                        Blex::TokenizeString(field->second.contents, ',', &tokenized);
                        for (std::vector<std::string>::iterator f = tokenized.begin(); f != tokenized.end(); ++f)
                            if (std::find(req_fields.begin(), req_fields.end(), *f) == req_fields.end())
                                req_fields.push_back(*f);
                }
        }

        int32_t first = 0;
        field = fields.find("first");
        if (field != fields.end())
            first = Blex::DecodeSignedNumber<int32_t>(field->second.contents.begin(),field->second.contents.end()).first;

        int32_t count = 0;
        field = fields.find("count");
        if (field != fields.end())
            count = Blex::DecodeSignedNumber<int32_t>(field->second.contents.begin(),field->second.contents.end()).first;

        // This parameter is not used yet, may be used to group search results on groupid
        /*int32_t groupsize = 0;
        field = fields.find("groupsize");
        if (field != fields.end())
            groupsize = Blex::DecodeSignedNumber<int32_t>(field->second.contents.begin(),field->second.contents.end()).first;*/

        int32_t summarylength = 200;
        field = fields.find("summary");
        if (field != fields.end())
            summarylength = Blex::DecodeSignedNumber<int32_t>(field->second.contents.begin(),field->second.contents.end()).first;
        if (summarylength < 0)
            summarylength = 200;

        bool highlight = true;
        field = fields.find("donthighlight");
        if (field != fields.end())
            highlight = false;

        Blex::Lang::Language lang = Blex::Lang::None;
        field = fields.find("lang");
        if (field != fields.end())
        {
                lang = Blex::Lang::GetLanguage(field->second.contents);
                if (l >= Log_Debug)
                    Blex::ErrStream() << "Setting language for searching to " << lang;
        }

        int32_t total;
        try
        {
                // Open the index
                const std::unique_ptr<IndexSearcher> searcher(new IndexSearcher(commit_lock, *indexdirectory, cache));

                // Parse query
                std::shared_ptr<BooleanQuery> query(new BooleanQuery());
                StopWordList highlight_words;
                FieldSet query_fields;
                std::shared_ptr<MultiFilter> filters;
                if (!querystring.empty())
                {
                        QueryParser parser;
                        ParsedQuery userquery = parser.Parse(querystring, lang);
                        std::swap(userquery.words, highlight_words);
                        if (((BooleanQuery *)userquery.query.get())->GetClauses().size())
                            query->Add(userquery.query, true, false);

                        // Add found filters
                        if (userquery.filters.size())
                        {
                                if (!filters.get())
                                    filters.reset(new MultiFilter(true, false));
                                for (std::vector<FilterPtr>::iterator filter = userquery.filters.begin(); filter != userquery.filters.end(); ++filter)
                                    filters->Add(*filter);
                        }


                        // Get a list of searched fields (which can be highlighted later)
                        query_fields = userquery.query->GetQueryFields();
                }
                else
                {
                        query->Add(QueryPtr(new TermQuery(Term("objectid", objectid))), true, false);
                }

                // Add specific index to search
                if (!indexid.empty())
                    query->Add(QueryPtr(new TermQuery(Term("indexid", indexid))), true, false);

                // Add restrictions to search
                field = fields.find("restrict-to");
                if (field != fields.end() && !field->second.contents.empty())
                {
                        if (!filters.get())
                            filters.reset(new MultiFilter(true, false));
                        filters->Add(FilterPtr(new InitialValueFilter(Term("initialfilter", field->second.contents))));
                }
                field = fields.find("exclude-urls");
                if (field != fields.end() && !field->second.contents.empty())
                {
                        if (!filters.get())
                            filters.reset(new MultiFilter(true, false));

                        std::shared_ptr<MultiFilter> exclude_filters(new MultiFilter(false, true));

                        // The exclude-urls filter may contain multiple url's, separated by tab characters
                        std::vector<std::string> urls;
                        Blex::Tokenize(field->second.contents.begin(), field->second.contents.end(),'\t',&urls);
                        bool any_filters = false;
                        for (uint32_t i = 0; i < urls.size(); ++i)
                            if (!urls[i].empty())
                            {
                                    exclude_filters->Add(FilterPtr(new InitialValueFilter(Term("initialfilter", urls[i]))));
                                    any_filters = true;
                            }

                        if (any_filters)
                            filters->Add(exclude_filters);
                }

                // Look up query
                if (l >= Log_Debug)
                {
                        Blex::ErrStream() << "Searching the index for '" << query->ToStringWithField("body") << "'";
                        if (filters.get())
                            Blex::ErrStream() << "Applying filters: " << filters->ToString();
                }
                const std::unique_ptr<Hits> hits(searcher->Search(query, filters));

                total = hits->size();
                results->reserve(count < 0 ? 0 : count);
                results->clear();
                int32_t num = 0;
                for (uint32_t i = first; (i < hits->size()) && ((count < 0) || (num < count)); ++i)
                {
                        // Create a list of all requested document fields
                        std::map<std::string, std::string> cachefields;
                        // Get all requested document fields from index
                        //ADDME: Highlight searched terms in searched fields
                        DocumentFieldList fields = hits->Doc(i)->Fields();
                        for (DocumentFieldList::const_iterator f = fields.begin(); f != fields.end(); ++f)
                        {
                                if (f->Name() == "id")
                                    continue; // Don't return internal id
                                if (allfields || f->Name() == "objectid" || f->Name() == "groupid" || std::find(req_fields.begin(), req_fields.end(), f->Name()) != req_fields.end())
                                {
                                        if (highlight && query_fields.count(f->Name()) && IsTokenizedField(f->Name()))
                                        {
                                                // This is a queried and tokenized field, highlight searched words
                                                std::string fieldvalue = f->StringValue();
                                                std::shared_ptr<NormalizedTokenStream> reader(new StemmedTokenStream(fieldvalue));
                                                reader->SetLang(lang);
                                                reader->SetMaxWordLength(MAX_WORD_LENGTH);
                                                cachefields[f->Name()] = HighlightWords(*reader, highlight_words, 0);
                                        }
                                        else
                                        {
                                                cachefields[f->Name()] = f->StringValue();
                                        }
                                }
                        }
                        // Add document score, if requested
                        if (allfields || std::find(req_fields.begin(), req_fields.end(), "_score") != req_fields.end())
                            cachefields["_score"] = Blex::AnyToString(hits->Score(i));
                        // Add summary, if requested
                        if (summarylength > 0 && (allfields || std::find(req_fields.begin(), req_fields.end(), "_summary") != req_fields.end()))
                            GenerateSummaryFromCache(hits->Doc(i)->Get("id"), &cachefields, highlight, highlight_words, summarylength, lang);
                                //Blex::ErrStream() << "Could not read cache file '" << hits->Doc(i)->Get("id") << "'";

                        std::string result;

                        // Encode parameters
                        if (allfields)
                        {
                                // All fields are requested, make the first field a space-separated list of field names
                                for (std::map<std::string, std::string>::iterator f = cachefields.begin(); f != cachefields.end(); ++f)
                                {
                                        std::string const &value = (*f).first;
                                        std::string enc_value;
                                        Blex::EncodeJava(value.begin(), value.end(), std::back_inserter(enc_value));
                                        result += (result.empty()?"":" ") + enc_value;
                                }
                                for (std::map<std::string, std::string>::iterator f = cachefields.begin(); f != cachefields.end(); ++f)
                                {
                                        std::string &value = (*f).second;
                                        std::string enc_value;
                                        Blex::EncodeJava(value.begin(), value.end(), std::back_inserter(enc_value));
                                        result += "\t" + enc_value;
                                }
                        }
                        else
                        {
                                // Add default fields
                                result = "";
                                Blex::EncodeJava(cachefields["objectid"].begin(), cachefields["objectid"].end(), std::back_inserter(result));
                                result += "\t";
                                Blex::EncodeJava(cachefields["groupid"].begin(), cachefields["groupid"].end(), std::back_inserter(result));

                                for (std::vector<std::string>::iterator f = req_fields.begin(); f != req_fields.end(); ++f)
                                {
                                        if (*f == "objectid" || *f == "groupid")
                                            continue;
                                        std::string &value = cachefields[*f];
                                        std::string enc_value;
                                        Blex::EncodeJava(value.begin(), value.end(), std::back_inserter(enc_value));
                                        result += "\t" + enc_value;
                                }
                        }

                        result += "\n";
                        results->push_back(result);
                        ++num;
                }
        }
        catch (LuceneException const &e)
        {
                Blex::ErrStream() << "Lucene exception: " << e.what();
                if (e.fatal())
                    throw;// fatal exception, let global handler handle it
                total = -1;
        }

        totaltime = Blex::DateTime::Now() - totaltime;
        if (l >= Log_Statistics)
            Blex::ErrStream() << "Searched index for " << querystring << " (" << totaltime.GetMsecs() << "ms" << (summarylength > 0 ? ", including summary generation" : "") << ")";
        return total;
}

int32_t IndexManager::GetSuggestKeywords(const WebVars &fields, const std::string &indexid, SearchResults * results)
{
        DEBUGPRINT("Processing suggest request");
        Blex::DateTime totaltime = Blex::DateTime::Now();
        LogLevel l = GetLogLevel();
        WebVars::const_iterator field;

        field = fields.find("query");
        if (field == fields.end())
            return 0;

        // userquery holds the user's query
        std::string userquery = field->second.contents;

        // Using a NormalizedTokenStream to get the last word of the query
        std::shared_ptr<NormalizedTokenStream> reader(new NormalizedTokenStream(userquery));
        std::string word;
        std::string userword;
        std::string whitespace;
        ConsilioToken token = reader->Next();
        while (token.valid)
        {
                if (token.type == ConsilioToken::Word)
                {
                        whitespace.clear();
                        word.assign(token.normalizedterm);
                        userword.assign(token.term);
                }
                else
                    whitespace.assign(token.term);
                token = reader->Next();
        }
        // If word is somehow empty, use the entire userquery
        if (word.empty())
            word = !userword.empty() ? userword : userquery;
        if (l >= Log_Debug)
            Blex::ErrStream() << "Using search word '" << word << "'";

        // querystring holds the suggestfields term to look for
        std::string querystring = indexid + "_";
        field = fields.find("prefix");
        if ((field != fields.end()) && (!field->second.contents.empty()))
            querystring = field->second.contents + "_";
        else if (userquery.empty())
            return 0; // If no fixed prefix is given, don't tolerate empty suggest requests
        if (l >= Log_Debug)
            Blex::ErrStream() << "Using suggest prefix '" << querystring << "'";
        int prefixlen = querystring.size();
        querystring += word;
        // Remove the word we're searching for from the userquery
        userquery = userquery.substr(0, userquery.size() - (userword.size() + whitespace.size()));

        // count = 0 means return all results
        int32_t count = 0;
        field = fields.find("count");
        if (field != fields.end())
            count = Blex::DecodeSignedNumber<int32_t>(field->second.contents.begin(),field->second.contents.end()).first;

        // Document counting method flags
        bool count_documents = false;
        bool count_fast = false;
        bool count_active = false;
        bool count_search = false;
        field = fields.find("doccount");
        if (field != fields.end())
        {
                count_fast = field->second.contents == "fast";
                count_active = field->second.contents == "active";
                count_search = field->second.contents == "search";
                count_documents = count_fast || count_active || count_search;
        }
        // Check for a restriction
        std::string restrictto;
        field = fields.find("restrict-to");
        if (field != fields.end() && !field->second.contents.empty())
        {
                // If restriction is active, use search to count documents (leaving count_document alone, so document count
                // isn't unexpectedly returned if not requested)
                count_fast = false;
                count_active = false;
                count_search = true;
                restrictto = field->second.contents;
        }

        // Check for term requirement
        field = fields.find("and-search");
        bool and_search = field != fields.end() && field->second.contents == "true";

        int32_t total = 0;
        try
        {
                // Open the index and a searcher if document counting method is search
                const std::unique_ptr<IndexReader> reader(IndexReader::Open(commit_lock, *indexdirectory, cache));
                std::unique_ptr<IndexSearcher> searcher;
                if (!count_fast && !count_active)
                    searcher.reset(new IndexSearcher(commit_lock, *indexdirectory, cache));

                // Look up the keyword and return the first x keywords
                if (l >= Log_Debug)
                    Blex::ErrStream() << "Looking for terms starting with '" << querystring << "'" << (count_fast ? " (fast)" : count_active ? " (active)" : count_search ? " (search)" : "");

                // Reserve some memory for the number of results to return
                if (count > 0)
                    results->reserve(count);
                results->clear();
                // Make a map to store results ordered by number of documents
                std::multimap<int32_t, std::string> sorted_results;
                std::string text;

                // Some variables we're using if document counting method is search
                std::string parsequery;
                std::shared_ptr<BooleanQuery> query;
                std::unique_ptr<Hits> hits;
                QueryParser parser;
                QueryPtr indexidquery(new TermQuery(Term("indexid", indexid)));
                std::shared_ptr<MultiFilter> filters;

                // Skip to the first term matching the querystring
                const std::unique_ptr<TermEnum> terms(reader->Terms(Term("suggestfields", querystring)));
                Term t = terms->GetTerm();
                while (t.Valid())
                {
                        if (l >= Log_Debug)
                            Blex::ErrStream() << "Found suggest term " << t.Text();

                        // Break if the found term does not begin with the querystring we're looking for
                        if (t.Text().size() < querystring.size() || t.Text().compare(0, querystring.size(), querystring) != 0)
                            break;
                        // text now holds the term text without prefix
                        text.assign(t.Text().substr(prefixlen));

                        int32_t doccount = -1;
                        if (count_fast)
                        {
                                // Return the number of documents containing the suggestfields term (which may include
                                // deleted documents)
                                doccount = terms->DocFreq();
                                if (l >= Log_Debug)
                                    Blex::ErrStream() << "Got fast doccount " << doccount;
                        }
                        else if (count_active)
                        {
                                // Enumerate the documents containing the suggestfields term (this only enumerates active
                                // documents)
                                doccount = 0;
                                const std::unique_ptr<TermDocs> docs(reader->GetTermDocs(t));
                                while (docs->Next())
                                    ++doccount;
                                if (l >= Log_Debug)
                                    Blex::ErrStream() << "Got active doccount " << doccount;
                        }
                        else
                        {
                                // Prepare a search for the current term
                                query.reset(new BooleanQuery());
                                // parsequery holds the userquery, with the found term added
                                parsequery.assign(userquery);
                                parsequery += text;
                                if (l >= Log_Debug)
                                    Blex::ErrStream() << "Using query '" << parsequery << "'";
                                if (and_search)
                                    parser.SetDefaultRequirement(Lucene::QueryParser::Required);
                                ParsedQuery userquery = parser.Parse(parsequery, Blex::Lang::None);
                                // Search for the parsed query within the requested index
                                query->Add(userquery.query, true, false);
                                query->Add(indexidquery, true, false);

                                // Add restrictions to search
                                if (!restrictto.empty())
                                {
                                        filters.reset(new MultiFilter(true, false));
                                        filters->Add(FilterPtr(new InitialValueFilter(Term("initialfilter", restrictto))));
                                }
                                else
                                    filters.reset();

                                if (l >= Log_Debug)
                                {
                                        Blex::ErrStream() << "Searching the index for '" << query->ToStringWithField("body") << "'";
                                        if (filters.get())
                                            Blex::ErrStream() << "Applying filters: " << filters->ToString();
                                }
                                hits.reset(searcher->Search(query, filters));

                                // Store the number of results found
                                doccount = hits->size();
                                if (l >= Log_Debug)
                                    Blex::ErrStream() << "Got search doccount " << doccount;

                                // If nothing was found, don't return this result
                                if (doccount == 0)
                                    text.clear();
                        }

                        if (!text.empty())
                        {
                                // Return the user query, with the found term added and the number of results
                                text = userquery + userword + text.substr(word.size()) + whitespace + (count_documents ? "\t" + Blex::AnyToString(doccount) : std::string("")) + "\n";
                                // Negate the doccount, so results are sorted by most results, then alphabetically
                                sorted_results.insert(std::make_pair(-doccount, text));
                        }

                        terms->Next();
                        t = terms->GetTerm();
                }

                // Store the requested number of results in the results array
                for (std::multimap<int32_t, std::string>::iterator i = sorted_results.begin(); (count == 0 || total < count) && i != sorted_results.end(); ++i, ++total)
                    results->push_back(i->second);
        }
        catch (LuceneException const &e)
        {
                Blex::ErrStream() << "Lucene exception: " << e.what();
                if (e.fatal())
                    throw;// fatal exception, let global handler handle it
                total = -1;
        }

        totaltime = Blex::DateTime::Now() - totaltime;
        if (l >= Log_Statistics)
            Blex::ErrStream() << "Got " << total << " suggestions for " << querystring.substr(prefixlen) << " (" << totaltime.GetMsecs() << "ms" << ")";
        return total;
}

int32_t IndexManager::IndexSize(const std::string &indexid)
{
        const std::unique_ptr<IndexSearcher> searcher(new IndexSearcher(commit_lock, *indexdirectory, cache));

        int32_t total;
        try
        {
                QueryPtr query(new TermQuery(Term("indexid", indexid)));
                const std::unique_ptr<Hits> hits(searcher->Search(query));

                // Return the length of the result list
                total = hits->size();
        }
        catch (LuceneException const &e)
        {
                Blex::ErrStream() << "Lucene exception: " << e.what();
                if (e.fatal())
                    throw;// fatal exception, let global handler handle it
                total = -2;
        }

        return total;
}

bool IndexManager::IndexList(SearchResults *list)
{
        LogLevel l = GetLogLevel();

        list->clear();
        try
        {
                // Open the index
                const std::unique_ptr<IndexReader> reader(IndexReader::Open(commit_lock, *indexdirectory, cache));

                const std::unique_ptr<TermEnum> terms(reader->Terms(Term("indexid", "")));

                const std::unique_ptr<IndexSearcher> searcher(new IndexSearcher(commit_lock, *indexdirectory, cache));

                Term t = terms->GetTerm();
                while (t.Valid())
                {
                        if (t.Field() != "indexid")
                            break;

                        // Check if there are any active documents having this indexid
                        QueryPtr query(new TermQuery(Term("indexid", t.Text())));
                        const std::unique_ptr<Hits> hits(searcher->Search(query));

                        if (l >= Log_Debug)
                            Blex::ErrStream() << "Found " << hits->size() << " documents with indexid " << t.Text();

                        if (hits->size())
                            list->push_back(t.Text() + "\n");

                        terms->Next();
                        t = terms->GetTerm();
                }
        }
        catch (LuceneException const &e)
        {
                Blex::ErrStream() << "Lucene exception: " << e.what();
                if (e.fatal())
                    throw;// fatal exception, let global handler handle it
                return false;
        }
        return true;
}

std::string IndexManager::HighlightWords(NormalizedTokenStream &text,
                                                       const std::set<std::string> &words,
                                                       int32_t maxlength,
                                                       bool highlight)
{
//ADDME: Highlight phrases, not the single phrase words
        TokenList tokens;
        for (ConsilioToken t = text.Next(); tokens.size() <= 10000 && t.valid; t = text.Next())
        {
                t.match = false;
                if(highlight && t.type == ConsilioToken::Word)
                {
                        // See if the normalized or stemmed text are a match, if
                        // so, mark it
                        t.match = words.count(t.normalizedterm);
                        if (!t.match && !t.stemmedterm.empty())
                            t.match = words.count(t.stemmedterm);
                        if (t.match)
                            t.term = "\x1D" + t.term + "\x1C";
                }

                // Push the token to print
                if (t.type != ConsilioToken::Lang)
                    tokens.push_back(t);
        }

        // Find first match
        TokenList::iterator firstmatch = std::find_if(tokens.begin(), tokens.end(), is_match_token);
        if (maxlength > 0 && firstmatch != tokens.end())
        {
                if (firstmatch > tokens.begin() + ContextBefore)
                    firstmatch -= ContextBefore;
                else
                    firstmatch = tokens.begin();
        }
        else
        {
                firstmatch = tokens.begin();
        }
//ADDME: Maybe it's an idea to use the last match to "split" the summary, providing
//       some context around the first match and some around the last, if they're
//       far enough apart.

        // Produce summary
        TokenList::iterator it;
        std::string hilite;
        if (maxlength > 0 && firstmatch != tokens.begin())
            hilite = "... ";
        for (it = firstmatch; it != tokens.end() && (maxlength == 0 || (int32_t)hilite.size() < maxlength); ++it)
            hilite += it->term;
        if (maxlength > 0 && it != tokens.end())
            hilite += " ...";

        return hilite;
}

bool IndexManager::GenerateSummaryFromCache(const std::string &filename,
                                                          std::map<std::string, std::string> * req_fields,
                                                          bool highlight,
                                                          const std::set<std::string> &querywords,
                                                          int32_t summarylength,
                                                          Blex::Lang::Language lang)
{
        const std::unique_ptr<Blex::ComplexFileStream> cachestream(cachefs->OpenFile(filename, false, false));
        if (!cachestream.get())
            return false;

        std::shared_ptr<NormalizedTokenStream> reader(new StemmedTokenStream(cachestream.get()));
        reader->SetLang(lang);
        reader->SetMaxWordLength(MAX_WORD_LENGTH);
        (*req_fields)["_summary"] = HighlightWords(*reader, querywords, summarylength, highlight);

        return true;
}


