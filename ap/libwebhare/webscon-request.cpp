#include <ap/libwebhare/allincludes.h>


#include "webscon.h"
#include <blex/logfile.h>
#include <blex/unicode.h>
#include <blex/utils.h>

// Enable to show disk file resolution prints
#define SHOW_DISKRESOLUTION


#if defined(SHOW_DISKRESOLUTION) && defined(DEBUG)
 #define DISKRES_PRINT(x) DEBUGPRINT(x)
 #define DISKRES_ONLY(x) x
#else
 #define DISKRES_PRINT(x)
 #define DISKRES_ONLY(x)
#endif


namespace WebServer
{

bool Connection::PreprocessHeader()
{
        RequestParser const &reqparser = GetRequestParser();

        //HTTP/1.1+ default to persistent
        protocol.persistent=reqparser.GetProtocolMajor()>1
                            || (reqparser.GetProtocolMajor()==1 && reqparser.GetProtocolMinor()>=1);

        DoHttpHeaderParse();

        //Parse the URL
        requested_path = reqparser.GetRequestedPath();

        //ADDME: Can we combine above and this step?
        /* Detect obvious hack attempts */
        Blex::UTF8DecodeMachine reqpath_sanity_checker;
        for (unsigned i=0;i<requested_path.size();++i)
        {
                uint32_t decoded=reqpath_sanity_checker(requested_path[i]);
                if (decoded==Blex::UTF8DecodeMachine::NoChar)
                    continue;
                if (decoded<32)
                {
                        FailRequest(StatusForbidden,"Attempt to request a path containing illegal (unprintable) characters");
                        return false;
                }
                if (decoded==Blex::UTF8DecodeMachine::InvalidChar)
                {
                        FailRequest(StatusForbidden,"Attempt to request a path containing illegal (non shortest form) UTF-8 sequences");
                        return false;
                }
        }
        if (reqpath_sanity_checker.InsideCharacter())
        {
                FailRequest(StatusNotFound,"Attempt to request a path containing illegal (truncated) UTF-8 sequences");
                return false;
        }

        static const char forbidden_seq[] = "/^^";
        if (requested_path.find(forbidden_seq, 0, 3) != std::string::npos)
        {
                FailRequest(StatusForbidden,"Attempt to request a path containing the sequence '/^^'");
                return false;
        }

        ProcessRequestHeader();

        return OkToContinue();
}

uint8_t const *Connection::SubHookIncomingData(uint8_t const *start, uint8_t const * const limit)
{
        /* FIXME: Support CHUNCKED encodings - the protocol here should un-chunck
                  them and pass them 'normally' up to the Body decoders */
        RequestParser &reqparser = GetRequestParser();

        if (!reqparser.IsExpectingData())
        {
                if (protocol.is_websocket && async_itf.get())
                {
                        uint8_t const *storeduntil = async_itf->StoreIncomingData(start, limit);
                        if (storeduntil != limit)
                        {
                                //DEBUGPRINT("WebSocket buffer full on connection " << this);
                                EnableIncomingData(false);
                        }
                        return storeduntil;
                }

                //We're not parsing, so we're not accepting any incoming data!
                return start;
        }

        //We need to read the 'incoming' buffer, and delete any data
        //we parsed from it. We should cease parsing if we have not sent
        //all outbound data yet (protocolstate==Flushing)

        //DEBUGPRINT("HookIncomingData, state " << protocol.protocolstate);
        start=reinterpret_cast<uint8_t const*>(reqparser.ParseHTTP(reinterpret_cast<char const*>(start)
                                                             ,reinterpret_cast<char const*>(limit)
                                                             ,std::bind(&Connection::PreprocessHeader, this))
                                                             );

        //ADDME: on non-persisent connections we canb probably SKIP the body (hangup?) if Status is already != OK

        if(reqparser.IsExpectingData()) //need more data
            return start;

        //Now see if we can finalize anything
        switch(reqparser.GetErrorCode())
        {
        case RequestParser::ErrorNone:
                break;

        case RequestParser::ErrorUnknownMethod:
                FailRequest(StatusBadRequest,"Unable to interpret HTTP request");
                break;
        case RequestParser::ErrorTempCreation:
                FailRequest(StatusInternalError,"Cannot create temporary storage");
                break;
        case RequestParser::ErrorIO:
                FailRequest(StatusInternalError,"I/O error storing request data");
                break;
        default:
                FailRequest(StatusInternalError,"Parser failed - internal error");
                break;
        }

        //if we get here, parsing of the current request was completed or aborted
        if (!reqparser.IsProtocolSane())
            protocol.persistent = false; //too dangerous to continue after a parse failure

        // Now we have parsed the request, we know the used binding.
        request->request_start = Blex::GetSystemCurrentTicks();

        if (OkToContinue())
            ProcessRequest();

        return start;
}

unsigned Connection::PathMatchesRule(AccessRule const &rule, std::string const &path, WebSite const* forwebsite) const
{
        if(rule.matchmethods.size() && !rule.matchmethods.count(GetRequestParser().GetProtocolMethodString()))
            return 0;

        if(!rule.limitsites.empty() && !rule.limitsites.count(forwebsite)) //not applicable to us
        {
                return 0;
        }

        if(rule.accepttype != AcceptType::Unrecognized && GetRequestParser().GetAcceptType() != rule.accepttype) //not filtering for this accepttype (usually used for error handlers)
        {
                return 0;
        }

        if (!rule.ignorepaths.empty())
        {
                for (auto &ignorepath: rule.ignorepaths)
                {
                        if (Blex::StrCaseLike(path, ignorepath))
                            return 0;
                }
        }

        if(rule.matchtype == AccessRule::MatchCookieGlob)
        {
                for (auto &cookie: GetRequestParser().GetCookies())
                {
                        if (Blex::StrCaseLike(cookie.first, rule.path))
                            return 1;
                }
                return 0;
        }

        if(rule.matchtype == AccessRule::MatchGlob)
            return Blex::StrCaseLike(path, rule.path) ? 1 : 0;

        /* Detect match-as-subdirectory */
        if (rule.matchassubdir
             && path.size() == rule.path.size()-1
             && Blex::StrCaseCompare(rule.path, path, rule.path.size()-1)==0
             && rule.path[rule.path.size()-1]=='/')
        {
                return 2;
        }

        bool initial_match = path.size() >= rule.path.size() && Blex::StrCaseCompare(rule.path, path, rule.path.size())==0;
        if(!initial_match)
            return 0;
        if(rule.matchtype == AccessRule::MatchInitial)
            return 1;
        if(path.size() == rule.path.size())
            return 1; //exact match

        //exact match on ...../ should also match default index pages
        if (!rule.path.empty() && rule.path[rule.path.size()-1]=='/' && GetRequest().website)
        {
                std::string::const_iterator filenamestart = path.begin() + rule.path.size();
                unsigned remainderlength = std::distance(filenamestart, path.end());

                for (unsigned i=0; i<GetRequest().website->defaultpages.size(); ++i)
                {
                        std::string const &defpage = GetRequest().website->defaultpages[i];
                        if(defpage.size() == remainderlength && Blex::StrCaseCompare(defpage.begin(), defpage.end(), filenamestart, path.end()) == 0)
                             return 1; //exact match
                }
        }
        return 0; //not a match
}

void Connection::DoDiskPathRewrites(std::string const &testpath, WebSite const *forwebsite, bool fixcase)
{
        DISKRES_PRINT("DoDiskPathRewrites enter");
        auto ruleitr = request->rules_hit.rbegin();

        std::vector< std::string > tested_paths;

        // Find last matching access rule with datastorage rules
        for (; ruleitr != request->rules_hit.rend(); ++ruleitr)
        {
                DISKRES_PRINT(" DoDiskPathRewrites match rule " << ruleitr->rule->id << " have_dsl: " << !ruleitr->rule->datastorage.empty() << " path " << ruleitr->rule->path);
                if (!ruleitr->rule->datastorage.empty())
                {
                        DISKRES_PRINT("  has disk storage locations");
                        break;
                }
        }

        // No storage location overrides?
        if (ruleitr == request->rules_hit.rend())
        {
                DISKRES_PRINT(" No disk location rules found, using default");
                if (forwebsite && !forwebsite->documentroot.empty()) //Access rules have no answer, so get document root for this webserver
                {
                        //DEBUGONLY(Debug::Msg("Url: %s  persistent: %s",url,persistent?"true":"false"));
                        assert(forwebsite->documentroot[request->website->documentroot.size()-1]=='/');
                        disk_file_path = forwebsite->documentroot;
                        base_file_path = disk_file_path;
                        disk_file_path.insert(disk_file_path.end(), requested_path.begin()+1, requested_path.end());

                        tested_paths.push_back(disk_file_path);
                        if (DoDiskStorageFileCheck(fixcase, true, testpath) != 0)
                            FailDiskPathResolve(tested_paths);
                }

                return;
        }

        AccessRule const &rule = *ruleitr->rule;

        std::string sha256b16hash;
        std::string sha256b16hash_directory;
        bool have_subpath = testpath.size() >= rule.path.size() && rule.matchtype != AccessRule::MatchGlob;

        std::string::const_iterator subpath_start;
        if (have_subpath)
        {
                subpath_start = testpath.begin() + rule.path.size();
                while (subpath_start != testpath.end() && *subpath_start=='/')
                    ++subpath_start;
        }
        else
            subpath_start = testpath.end();

        DISKRES_PRINT(" Subpath: '" << std::string(subpath_start, testpath.end()) << "', have_subpath: " << have_subpath);

        bool have_match = false;
        ruleitr->datastoragerule = -1; // should be true already
        for (auto const &entry: rule.datastorage)
        {
                ++ruleitr->datastoragerule;
                disk_file_path = entry.resource;
                base_file_path.clear();

                DISKRES_PRINT("  Base resource: " << entry.resource << " => " << disk_file_path);
                if (disk_file_path.empty())
                    continue;

                bool expand_to_defaultpage = false;
                switch (entry.method)
                {
                        case DiskLookupMethod::Direct:
                        {
                                if (entry.is_folder && have_subpath)
                                {
                                        if(disk_file_path[disk_file_path.size()-1] != '/')
                                            disk_file_path += '/';
                                        base_file_path = disk_file_path;
                                        disk_file_path.append(subpath_start, testpath.end());
                                }

                                expand_to_defaultpage = true;
                                DISKRES_PRINT("  Test path direct: " << disk_file_path);
                        } break;

                        case DiskLookupMethod::SHA256B16:
                        {
                                if (sha256b16hash.empty())
                                {
                                        Blex::SHA256 hasher;
                                        if (subpath_start != testpath.end())
                                            hasher.Process(&*subpath_start, std::distance(subpath_start, testpath.end()));

                                        Blex::StringPair hash = hasher.FinalizeHash();
                                        Blex::EncodeBase16(hash.begin, hash.end, std::back_inserter(sha256b16hash));
                                        Blex::ToLowercase(sha256b16hash);
                                        sha256b16hash.insert(3, 1, '/');

                                        // Append extension, if there is any.
                                        static const char dot='.';
                                        static const char slash='/';
                                        std::string::const_iterator dotpos = std::find_end(subpath_start, testpath.end(), &dot, &dot + 1);
                                        std::string::const_iterator slashpos = std::find_end(subpath_start, testpath.end(), &slash, &slash + 1);
                                        if (slashpos == testpath.end() || dotpos > slashpos)
                                            sha256b16hash.append(dotpos, testpath.end());
                                }

                                if(disk_file_path[disk_file_path.size()-1] != '/')
                                    disk_file_path += '/';

                                disk_file_path += sha256b16hash;
                                DISKRES_PRINT("  Test path with hash: " << disk_file_path << ", hash: " << sha256b16hash);
                        } break;

                        case DiskLookupMethod::SHA256B16_Directory:
                        {
                                if (sha256b16hash_directory.empty())
                                {
                                        // Find last slash
                                        static const char slash='/';
                                        std::string::const_iterator slashpos = std::find_end(subpath_start, testpath.end(), &slash, &slash + 1);

                                        Blex::SHA256 hasher;
                                        if (subpath_start != slashpos)
                                            hasher.Process(&*subpath_start, std::distance(subpath_start, slashpos));

                                        Blex::StringPair hash = hasher.FinalizeHash();
                                        Blex::EncodeBase16(hash.begin, hash.end, std::back_inserter(sha256b16hash_directory));
                                        Blex::ToLowercase(sha256b16hash_directory);
                                        sha256b16hash_directory.insert(3, 1, '/');

                                        // Append extension, if there is any.
                                        static const char dot='.';
                                        std::string::const_iterator dotpos = std::find_end(subpath_start, testpath.end(), &dot, &dot + 1);
                                        if (slashpos == testpath.end() || dotpos > slashpos)
                                            sha256b16hash_directory.append(dotpos, testpath.end());
                                }

                                if(disk_file_path[disk_file_path.size()-1] != '/')
                                    disk_file_path += '/';

                                disk_file_path += sha256b16hash_directory;
                                DISKRES_PRINT("  Test path with folder hash: " << disk_file_path << ", hash: " << sha256b16hash_directory);
                        } break;
                }

                tested_paths.push_back(disk_file_path);
                if (DoDiskStorageFileCheck(fixcase, expand_to_defaultpage, testpath) == 0) // file match?
                {
                        DISKRES_PRINT("  Match found: " << disk_file_path);
                        have_match = true;
                        break;
                }
        }
        DISKRES_PRINT("DoDiskPathRewrites done, final path: " << disk_file_path);
        if (!have_match)
            FailDiskPathResolve(tested_paths);
}

int Connection::DoDiskStorageFileCheck(bool fixcase, bool allow_rewrites, std::string const &testpath)
{
        int path = TryPath(fixcase);
        if (path == 1)
        {
                if (allow_rewrites && RedirectAlternativePath(disk_file_path))
                    return 0;

                disk_file_path.clear();
                base_file_path.clear();
        }
        if (path != 2) // 0 is match, 1 is no match, 2 is folder
            return path;

        // disk path points to a folder. Did the user request a folder?
        if (!testpath.empty() && testpath.end()[-1] != '/')
        {
                // Add a to the url '/' for relative links. Return like we had a match
                DISKRES_PRINT("  Found a directory match " << disk_file_path << ", but url needs a slash");
                RedirectIntoDirectory();
                return 0;
        }

        // correct disk file path
        if (!disk_file_path.empty() && disk_file_path.end()[-1] != '/')
            disk_file_path.insert(disk_file_path.end(), '/');

        // can we expand default pages?
        if (allow_rewrites && ExpandDefaultPages())
        {
                DISKRES_PRINT("  Default page match: " << disk_file_path);
                return 0;
        }

        return 2;
}

void Connection::FailDiskPathResolve(std::vector< std::string > const &tested_paths)
{
        // See if the client thinks it was going to a url on the same website it came from.
        // Algo: check if referrer starts with http[s]://(host-header)
        std::string errorbase;
        if(request->reqparser.GetAcceptType() == AcceptType::HTML)
                errorbase = "Cannot find disk page, tried ";
        else if(request->reqparser.GetAcceptType() == AcceptType::Image)
                errorbase = "Cannot find disk image, tried ";
        else
                errorbase = "Cannot find disk resource, tried ";

        const std::string *hostheader = request->reqparser.GetHeader("Host");
        std::string local_request_postfix;
        if (hostheader && request->referrer)
        {
                std::string url;
                if (request->is_client_secure)
                    url = "https://";
                else
                    url = "http://";
                url += *hostheader;

                if (Blex::StrCompare< std::string::const_iterator >(url.begin(), url.end(), request->referrer->begin(), request->referrer->end(), url.size()) == 0)
                    local_request_postfix = ", local referrer: " + *request->referrer;
        }

        std::string joined_tested_paths;
        for (auto itr = tested_paths.begin(); itr != tested_paths.end(); ++itr)
            joined_tested_paths += (itr != tested_paths.begin() ? ", " : "") + *itr;


        FailRequest(StatusNotFound,errorbase + joined_tested_paths + local_request_postfix);
}

void Connection::DoAccessCheck(AccessRules const &rules, std::string const &testpath, WebSite const* forwebsite)
{
        //Check against all access rules (ADDME: Optimize search,see comment in webserve.h)
        for (AccessRules::const_iterator itr=rules.begin(); itr!=rules.end(); ++itr)
        {
                unsigned match=PathMatchesRule(*itr, testpath, forwebsite);
                if (match == 0)
                    continue;

                bool match_as_subdir = match==2; //Does this rule introduce a fake subdirectory we matched? (eg, /bc should match rule /bc/)

                DEBUGPRINT("Match rule #" << itr->id << ": " << itr->path << (match_as_subdir?" as subdir!":""));

                Request::AccessRuleHitInfo hitinfo;
                hitinfo.rule = &*itr;
                hitinfo.datastoragerule = -1;
                request->rules_hit.push_back(hitinfo);

                if(itr->fixcase)
                    request->fixcase = true;

                //Check the IP access list!
                bool on_allow_list=false, on_deny_list=false;
                Blex::SocketAddress sockaddr = GetRequest().remoteaddress;
                for (std::vector<IPRule>::const_iterator ip_itr=itr->ip_masks.begin();ip_itr!=itr->ip_masks.end();++ip_itr)
                {
                        DEBUGPRINT("Match " << sockaddr << " vs " << ip_itr->address << "/" << ip_itr->prefixlength);
                        if(sockaddr.IsSameIPPrefixAs(ip_itr->address, ip_itr->prefixlength))
                        {
                                DEBUGPRINT("ACCESSCHECK: it's a match! " << (ip_itr->is_allow ? "ALLOW" : "DENY"));
                                (ip_itr->is_allow ? on_allow_list : on_deny_list) = true;
                        }
                }
                bool failed_ip_check = on_deny_list && !on_allow_list;
                DEBUGONLY(if(failed_ip_check) DEBUGPRINT("ACCESSCHECK: IP check failed. authrequired= " << (itr->authrequired?"yes":"no")));

                //Add headers immediately so customhandlers have a chance to remove them (eg security headers blocking login pages)
                for(unsigned i=0;i<itr->addheaders.size();++i)
                    AddHeader(&itr->addheaders[i].first[0], itr->addheaders[i].first.size()
                             ,&itr->addheaders[i].second[0], itr->addheaders[i].second.size()
                             ,false);

                if (itr->customhandler)
                {
                        //run customhandler if IP check failed XOR authrequired
                        //don't run when BOTH are true: IP check denies any access anyway
                        //don't run when BOTH are false: There is no requirement to do authenitcate

                        bool check_authorization = (itr->authrequired ^ failed_ip_check) && !match_as_subdir;
                        (*itr->customhandler)(this,*itr,check_authorization,testpath);
                        if (!OkToContinue())
                        {
                              DEBUGONLY(if(failed_ip_check) DEBUGPRINT("ACCESSCHECK: IP checks failed, but custom handler now sent us into a " << (int)protocol.status_so_far << " status."));
                              return;
                        }
                }

                if (itr->authrequired && failed_ip_check && !match_as_subdir)
                {
                        //if we get here, the auth check above failed
                        FailRequest(StatusForbidden,"IP address blocked by 'deny' rule - denying access to " + GetRequestParser().GetReceivedUrl());
                        return;
                }

                if (itr->force_content_type)
                {
                        contenttype = itr->force_content_type.get();
                }

                if (match_as_subdir) //We must convert this to a subdirectory match
                {
                        // This won't work when the user connects with port other than 80
                        std::string desturl = request->is_client_secure ? "https://" : "http://";
                        request->AddRequestHostTo(&desturl, 0, true);
                        Blex::EncodeUrl(testpath.begin(), testpath.end(), std::back_inserter(desturl));
                        desturl.push_back('/');
                        RedirectRequest(desturl, WebServer::StatusSeeOther);
                        return;
                }

                //Does this rule require a new path?
                if (!itr->redirecttarget.empty() && itr->redirect) //it's actually a redirect
                {
                        bool matchsubdir = itr->redirecttarget_is_folder && itr->matchtype != AccessRule::MatchGlob;
                        if (!matchsubdir)
                        { //we cannot consider itr->path in glob mode
                                RedirectRequest(itr->redirecttarget, static_cast<StatusCodes>(itr->redirectcode));
                                return;
                        }

                        std::string script_requested_path = GetRequestParser().GetRequestedPath();

                        //variables on the redirect path?
                        std::string::const_iterator varstart = itr->redirecttarget.end();
                        if(itr->redirecttarget_is_folder) //locate and strip any variables
                                varstart = std::find(itr->redirecttarget.begin(), itr->redirecttarget.end(), '?');

                        std::string redirect_dest(itr->redirecttarget.begin(), varstart);

                        //add remaining parts of the path.
                        std::string::iterator startpos = script_requested_path.begin();
                        unsigned skipbytes = itr->path.size();
                        while (skipbytes > 0 && startpos != script_requested_path.end())
                        {
                                if(skipbytes > 1
                                   && *startpos == '/'
                                   && (startpos + 1) != script_requested_path.end()
                                   && startpos[1] == '!')
                                {
                                        //Skip this entire segment
                                        startpos = std::find(startpos+1, script_requested_path.end(), '/');
                                }
                                else
                                {
                                        --skipbytes;
                                        ++startpos;
                                }
                        }

                        //if the last part of the redirect-to path is a !, and the first part of the new rule is a !, combine them
                        if(redirect_dest.end()[-1] == '!' && *startpos=='!')
                                ++startpos;

                        //add path remainder
                        Blex::EncodeUrl(startpos, script_requested_path.end(), std::back_inserter(redirect_dest));
                        bool desthasvars = GetRequestParser().GetReceivedUrlVarSeparator() != GetRequestParser().GetReceivedUrl().end();
                        bool stripdestsemi = false;

                        //add any redirect url variables
                        if(varstart != itr->redirecttarget.end())
                        {
                                stripdestsemi = desthasvars && *GetRequestParser().GetReceivedUrlVarSeparator() == '?';
                                redirect_dest.append(varstart, itr->redirecttarget.end());
                                if(stripdestsemi)
                                        redirect_dest += '&';
                        }

                        //add variables
                        if(desthasvars)
                        {
                                redirect_dest.append(GetRequestParser().GetReceivedUrlVarSeparator() + (stripdestsemi ? 1 : 0)
                                                    ,GetRequestParser().GetReceivedUrl().end());
                        }
                        RedirectRequest(redirect_dest, static_cast<StatusCodes>(itr->redirectcode));
                        return;
                }
        }
}

void Connection::Split(char const*  tosplit_begin, char const*  tosplit_end, char tokensplitter, void (Connection::*parsefunc)(char const* , char const* ))
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

void Connection::SplitWithQuotes(char const*  tosplit_begin, char const*  tosplit_end, char tokensplitter, char quotation_mark, void (Connection::*parsefunc)(char const* , char const* ))
{
        //Loop for all fields
        while (true)
        {
                // Skip whitespace
                while (tosplit_begin != tosplit_end && Blex::IsWhitespace(*tosplit_begin))
                    ++tosplit_begin;

                // Find the next unquoted tokensplitter
                char const *tokenend = tosplit_begin;

                while (tokenend != tosplit_end && *tokenend != tokensplitter)
                {
                        if (*tokenend == quotation_mark)
                        {
                                // Skip quotation mark
                                ++tokenend;
                                if (tokenend == tosplit_end)
                                    break;
                                // Skip quotes
                                while (tokenend != tosplit_end && *tokenend != quotation_mark)
                                {
                                        // Skip escaped character
                                        if (*tokenend == '\\')
                                        {
                                            ++tokenend;
                                            if (tokenend == tosplit_end)
                                                break;
                                        }
                                        ++tokenend;
                                }
                                // Eat last quotation mark
                                if (tokenend != tosplit_end)
                                    ++tokenend;
                        }
                        else
                            ++tokenend;
                }

                //Send the token to the protocol
                (this->*parsefunc)(tosplit_begin,tokenend);

                if (tokenend == tosplit_end)
                    break;

                tosplit_begin=tokenend + 1; // Skip splitter
        }
}

void Connection::DoHttpHeaderParse()
{
        //ADDME: Do these header lookups only when we NEED them, not ALWAYS.
        const std::string *find;

        RequestParser const &reqparser = GetRequestParser();
        request->user_agent = reqparser.GetHeader("User-Agent");
        request->referrer = reqparser.GetHeader("Referer");

        if ((find = reqparser.GetHeader("Host")) != NULL)
            HTTPHeader_Host(&*find->begin(),&*find->end());
        if ((find = reqparser.GetHeader("Authorization")) != NULL)
            HTTPHeader_Authorization(&*find->begin(),&*find->end());
        if ((find = reqparser.GetHeader("Connection")) != NULL)
            Split(&*find->begin(),&*find->end(),',',&Connection::HTTPHeader_Connection);
        if ((find = reqparser.GetHeader("If-Modified-Since")) != NULL)
            HTTPHeader_IfModifiedSince(&*find->begin(),&*find->end());
        if ((find = reqparser.GetHeader("Accept-Encoding")) != NULL)
            HTTPHeader_AcceptEncoding(&*find->begin(),&*find->end());
}

void Connection::HTTPHeader_Connection(char const*   begin, char const*   end)
{
        static const char str_close[]="Close";
        static const char str_keepalive[]="Keep-alive";

        /* FIXME: Detect colliding Keep-Alive/Close settings? */
        if (Blex::StrCaseCompare(begin,end,str_keepalive, str_keepalive + sizeof str_keepalive - 1)==0)
            protocol.persistent=true;
        else if (Blex::StrCaseCompare(begin,end,str_close, str_close + sizeof str_close - 1)==0)
            protocol.persistent=false;
        else
        {
                DEBUGPRINT("Connection: unknown token: " << std::string(begin,end));
                protocol.persistent=false;
        }
}

void Connection::HTTPHeader_Authorization(char const*  begin, char const*  end)
{
        static const char basic_auth[]={"BASIC"};
        static const char bearer_auth[]={"BEARER"};

        //Skip the authorization type (we just assume basic)
        char const *end_method = std::find(begin,end,' ');
        if (Blex::StrCaseCompare(begin,end_method,basic_auth,basic_auth + sizeof basic_auth - 1)==0)
        {
                request->authentication.auth_type = Authentication::Basic;

                //Skip to the username
                while (end_method<end && *end_method==' ')
                    ++end_method;

                //Decode the base64 authorization string
                std::string output;
                Blex::DecodeBase64(end_method,end,std::back_inserter(output));

                //Seperate the username and password (they should be seperated by a ':',
                //which is base64-encoded as well, without a known escape)
                //(effectively barring using a ':' in usernames)
                std::string::iterator seperator=std::find(output.begin(),output.end(),':');

                request->authentication.seen_username.assign(output.begin(),seperator);

                if (seperator!=output.end())
                    request->authentication.password.assign(seperator+1,output.end());
        }
        else if (Blex::StrCaseCompare(begin,end_method,bearer_auth,bearer_auth + sizeof bearer_auth - 1)==0)
        {
                request->authentication.auth_type = Authentication::Bearer;

                //Skip to the token
                while (end_method<end && *end_method==' ')
                    ++end_method;

                request->authentication.token.assign(end_method, end);
        }
        else
        {
                DEBUGPRINT("Unknown auth method " << std::string(begin,end));
        }
}
void Connection::HTTPHeader_IfModifiedSince(char const*   begin, char const*   end)
{
        request->condition_ifmodifiedsince = Blex::DateTime::FromText(begin,end);
        if(request->condition_ifmodifiedsince == Blex::DateTime::Invalid())
        {
                DEBUGPRINT("Warning! Parsing date " << std::string(reinterpret_cast<const char*>(&*begin),reinterpret_cast<const char*>(&*end)) << " failed");
        }
}

void Connection::HTTPHeader_Host(char const*   begin, char const*   end)
{
        //Strip everything after the ':'
        request->hostname.assign(begin,end);
}

void Connection::HTTPHeader_AcceptEncoding(char const*   begin, char const*   end)
{
        static const char str_gzip[]={"gzip"};

        while (begin != end)
        {
                // Skip spaces and comma's
                while (begin != end && (*begin == ' ' || *begin == ','))
                    ++begin;

                std::string coding;
                char const* next = ParseToken(begin, end, &coding);
                if (begin == next) //no progress, so no token
                {
                        DEBUGPRINT("Ill-formatted HTTP accept-encoding token");
                        return;
                }
                begin = next;
                bool is_accepted = true;

                if (begin != end && *begin == ';')
                {
                        ++begin;
                        if (begin != end && *begin == 'q')
                        {
                                bool has_nonzero = false;
                                ++begin;
                                if (begin != end && *begin == '=')
                                {
                                        ++begin;
                                        while (begin != end && *begin != ',')
                                        {
                                                if (*begin != '0' && *begin != '.')
                                                    has_nonzero = true;
                                                ++begin;
                                        }


                                }
                                is_accepted = has_nonzero;
                        }
                }

                if (is_accepted && Blex::StrCaseCompare(coding.c_str(), coding.c_str() + coding.size(), str_gzip, str_gzip + sizeof str_gzip - 1) == 0)
                    request->accept_contentencoding_gzip = true;
        }
}

} //end namespace WebServer
