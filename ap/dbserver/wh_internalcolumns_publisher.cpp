#include <ap/libwebhare/allincludes.h>


#include "wh_dbase.h"

//ADDME: Perhaps per-transaction pool allocators for holding temporary data
//       and passing it around would simplify code here (easy dynamic memory management)
//       and still offer speedups (no global locks for those functions now using std::string)

//-----------------------------------------------------------------------------
// Column functions
//-----------------------------------------------------------------------------
unsigned WebHareTransBack::PUB_SiteGetWebRoot(void *store,unsigned maxsize, Database::BackendTransaction *trans, Database::Record rec)
{
        WHContext whtrans(trans->transcontextkeeper);
        CachedSite* site = whtrans->LoadSiteDirect(*trans, rec);
        if(!site || site->webroot_len==0 || site->webroot_len>maxsize)
            return 0;

        memcpy(store, whtrans->GetFolderSiteName(site->webroot_start), site->webroot_len);
        return site->webroot_len;
}

bool WebHareTransBack::SYS_FS_FilePublish(Database::BackendTransaction &trans, Database::Record rec)
{
        WHCore::Context whcorecontext = GetWHCoreContext(trans);
        return rec.GetCell(whcorecontext->TFS_Objects_IsFolder).Boolean()
               || WHCore::IsPublishPublished(rec.GetCell(whcorecontext->TFS_Objects_Published).Integer());
}
unsigned WebHareTransBack::SYS_FS_GetUrl(void *store,unsigned maxsize, Database::BackendTransaction *trans, Database::Record rec)
{
        WHContext whtrans(trans->transcontextkeeper);

        WHCore::Context whcorecontext = GetWHCoreContext(*trans);
        if(rec.GetCell(whcorecontext->TFS_Objects_IsFolder).Boolean())
        {
                CachedFSObject *folderinfo = whtrans->LoadFSObjectDirect(*trans, rec);
                if(!folderinfo)
                    return 0;

                whtrans->FolderGetUrl(*trans, folderinfo);
                std::vector<uint8_t> &scratchpad=whtrans->scratchpad;
                if (scratchpad.empty() || scratchpad.size() > maxsize)
                    return 0;

                std::copy(scratchpad.begin(),scratchpad.end(),static_cast<uint8_t*>(store));
                return scratchpad.size();
        }

        int32_t filetype = rec.GetCell(whcorecontext->TFS_Objects_Type).Integer();
        if (filetype == 18 /* External link */)
        {
                //Just return the external link
                Database::Cell link = rec.GetCell(whcorecontext->TFS_Objects_ExternalLink);
                if (link.Size() > maxsize)
                    return 0;

                std::copy(link.Begin(),link.End(),static_cast<uint8_t*>(store));
                return link.Size();
        }

        if (filetype == 19 /* Internal link */ || filetype == 20 /* Content link */)
        {
                //Look up the linked-to file
                int32_t linkfile = rec.GetCell(whcorecontext->TFS_Objects_FileLink).Integer();
                Database::Scanner filescan(*trans, Database::ShowNormalSkipAccess, false);
                filescan.AddTable(whcorecontext->TFS_Objects_TableId);
                filescan.AddIntegerSearch(0, whcorecontext->TFS_Objects_Id, linkfile, Database::SearchEqual);
                filescan.SetLimit(1);
                if (!filescan.NextRow())
                    return 0;

                //Check destination type (avoid circulair links)
                int32_t linktype = filescan.GetRowPart(0).GetCell(whcorecontext->TFS_Objects_Type).Integer();
                if (linktype==19) //Linking to an internal link is never valid
                    return 0;

                if (filetype==19) //internal link
                {
                        unsigned size = SYS_FS_GetUrl(store,maxsize,trans,filescan.GetRowPart(0));

                        // An append may be stored in the 'externallink' field
                        Database::Cell link = rec.GetCell(whcorecontext->TFS_Objects_ExternalLink);
                        if (link.Size())
                        {
                            // Only allow appends starting with '#', '?' or '!' because externallink field was never cleared
                            // when changing type, so garbage still lingers there
                            uint8_t firstchar = (uint8_t)*(link.Begin());
                            if (firstchar != '#' && firstchar != '?' && firstchar != '!')
                                return size;

                            // Append doesn't fit
                            if (size + link.Size() > maxsize)
                                return size;

                            // Store the append after the link and update the size
                            std::copy(link.Begin(),link.End(),static_cast<uint8_t*>(store) + size);
                            size += link.Size();
                        }

                        return size;
                }
                else //content link
                    filetype=linktype;
        }


        //Other file types. Grab the folder so we can inspect whether this document is the index document
        int32_t parentid = rec.GetCell(whcorecontext->TFS_Objects_Parent).Integer();
        CachedFSObject *folderinfo = parentid ? whtrans->LoadFSObject(*trans, parentid) : 0;
        if(!folderinfo)
        {
                DEBUGPRINT("PUB_FileGetUrl: PUB_GetFolderById failed on "<<parentid);
                return 0;
        }

        std::vector<uint8_t> &scratchpad=whtrans->scratchpad;
        whtrans->FolderGetUrl(*trans, folderinfo); //returns its results over the scratchpad
        if (scratchpad.empty())
            return 0;

        bool is_index_doc = folderinfo->indexdoc == rec.GetCell(whcorecontext->TFS_Objects_Id).Integer();

        if (!is_index_doc)
        {
                CachedFSType *fstype = 0;

                if(filetype!=0)
                    fstype = whtrans->LoadType(*trans, filetype);

                bool is_subdir_doc = fstype && fstype->ispublishedassubdir;

                //add a filename as well...
                Database::Cell name = rec.GetCell(whcorecontext->TFS_Objects_Name);
                uint8_t const  *name_begin = name.Begin();
                uint8_t const  *name_end = name.End();

                int32_t published = rec.GetCell(whcorecontext->TFS_Objects_Published).Integer();
                if (WHCore::TestFlagFromPublished(published, 1600000) && name_begin != name_end) //PublisherStripExtension
                {
                        uint8_t const *lastdot = name_end-1;
                        while(lastdot != name_begin && *lastdot != '.')
                            --lastdot;
                        if(lastdot != name_begin)
                            name_end = lastdot;
                }

                Blex::EncodeUrl(name_begin, name_end, std::back_inserter(whtrans->scratchpad));

                //if it's a worddoc, add a '/'
                if (is_subdir_doc)
                {
                        //Add the '/' first
                        whtrans->scratchpad.push_back('/');
                }
        }

        if (scratchpad.size() > maxsize)
            return 0;

        std::copy(scratchpad.begin(),scratchpad.end(),static_cast<uint8_t*>(store));
        return scratchpad.size();
}

unsigned WebHareTransBack::SYS_FS_GetFullPath(void *store,unsigned maxsize, Database::BackendTransaction *trans, Database::Record rec)
{
        WHContext whtrans(trans->transcontextkeeper);
        CachedFSObject const *curfolder = whtrans->LoadFSObjectDirect(*trans, rec);
        if (!curfolder)
            return 0;

        return whtrans->SYS_GetFullPath(*trans, store, maxsize, curfolder, false);
}

unsigned WebHareTransBack::SYS_FS_GetWHFSPath(void *store,unsigned maxsize, Database::BackendTransaction *trans, Database::Record rec)
{
        WHContext whtrans(trans->transcontextkeeper);
        CachedFSObject const *curfolder = whtrans->LoadFSObjectDirect(*trans, rec);
        if (!curfolder)
            return 0;

        return whtrans->SYS_GetWHFSPath(*trans, store, maxsize, curfolder, true);
}

unsigned WebHareTransBack::SYS_GetFullPath(Database::BackendTransaction &trans, void *store,unsigned maxsize, CachedFSObject const *curfolder, bool whfspath)
{
        if (maxsize<1)
            return 0;

        unsigned depth=0;
        unsigned size=1;
        bool tail_is_folder = curfolder->isfolder;

        //We build the fullpath by searching upward from our current point,
        //and continuously inserting new directory portions
        Blex::putu8(static_cast<uint8_t*>(store),'/');

        WHContext whtrans(trans.transcontextkeeper);
        if (!whtrans->rootfoldersvalid)
            whtrans->FillSiteCache(trans);

        while(true)
        {
                //Check if we have a parent, but don't break if whfspath was requested
                bool siteroot = whtrans->rootfolders.count(curfolder->id);
                if(siteroot)
                    break;

                int32_t parentid=curfolder->parentid;
                if ((!parentid && !whfspath) || ++depth > WHCore::MaxFolderDepth)
                    return 0; //hit the root (or max folder depth reached), so no fullpath

                if ( (maxsize-size) < (curfolder->name_len+1) )
                    return 0; //failed to build a directory name

                //Now insert this name into the path (move 'size' bytes 'tempsize+1' bytes to the right)

                //Start with: "/folder/", add "blah", tempsize=4, size=8
                memmove(static_cast<uint8_t*>(store)+curfolder->name_len+1,store,size);
                //Now: "/fold/folder/", add "blah", tempsize=4, size=8
                memcpy(static_cast<uint8_t*>(store)+1,GetFolderSiteName(curfolder->name_start),curfolder->name_len);
                //Now: "/blah/folder/", add "blah", tempsize=4, size=8
                size+=curfolder->name_len+1;

                //Process our parent, but check if we have a parent first
                if (!parentid)
                    break;
                curfolder = LoadFSObject(trans, parentid);
                if (!curfolder)
                {
                        DEBUGPRINT("PUB_FolderGetFullPath: PUB_GetFolderById failed");
                        return 0;
                }
        }
        if(!tail_is_folder)
            --size; //kill trailing slash
        return size;
}

unsigned WebHareTransBack::SYS_GetWHFSPath(Database::BackendTransaction &trans, void *store,unsigned maxsize, CachedFSObject const *curfolder, bool whfspath)
{
        if (maxsize<1)
            return 0;

        unsigned depth=0;
        unsigned size=1;
        bool tail_is_folder = curfolder->isfolder;

        //We build the fullpath by searching upward from our current point,
        //and continuously inserting new directory portions
        Blex::putu8(static_cast<uint8_t*>(store),'/');

        WHContext whtrans(trans.transcontextkeeper);
        if (!whtrans->rootfoldersvalid)
            whtrans->FillSiteCache(trans);

        while(true)
        {
                int32_t parentid=curfolder->parentid;
                if ((!parentid && !whfspath) || ++depth > WHCore::MaxFolderDepth)
                    break; //hit the root, so stop generating a fullpath!

                if ( (maxsize-size) < (curfolder->name_len+1) )
                    return 0; //failed to build a directory name

                //Now insert this name into the path (move 'size' bytes 'tempsize+1' bytes to the right)

                //Start with: "/folder/", add "blah", tempsize=4, size=8
                memmove(static_cast<uint8_t*>(store)+curfolder->name_len+1,store,size);
                //Now: "/fold/folder/", add "blah", tempsize=4, size=8
                memcpy(static_cast<uint8_t*>(store)+1,GetFolderSiteName(curfolder->name_start),curfolder->name_len);
                //Now: "/blah/folder/", add "blah", tempsize=4, size=8
                size+=curfolder->name_len+1;

                //Process our parent, but check if we have a parent first
                if (!parentid)
                    break;
                curfolder = LoadFSObject(trans, parentid);
                if (!curfolder)
                {
                        DEBUGPRINT("PUB_FolderGetFullPath: PUB_GetFolderById failed");
                        return 0;
                }
        }
        if(!tail_is_folder)
            --size; //kill trailing slash
        return size;
}

void WebHareTransBack::FolderGetUrl(Database::BackendTransaction &trans, CachedFSObject *folder)
{
        scratchpad.clear();

        //ADDME: can optimize away the temp vector and the local auto temp variable?
        uint8_t temp[4096];

        //Get the site web root
        int32_t highestparent = folder->highestparent ? folder->highestparent : SYS_FS_FolderHighestParentCF(trans, folder);
        CachedSite *site = LoadSite(trans, highestparent);
        if(!site || site->webroot_len==0 || site->webroot_len>sizeof(temp))
            return;

        uint8_t const *sitewebroot = GetFolderSiteName(site->webroot_start);
        unsigned out_len = site->webroot_len;
        if (sitewebroot[out_len-1]=='/')
            --out_len;

        scratchpad.assign(sitewebroot, sitewebroot + out_len);

        //Get the folder fullpath in a temp var
        unsigned fullpathlen = SYS_GetFullPath(trans, temp, sizeof temp, folder, false);

        //urlencode and attach it to the full url
        //OLD CODE: Blex::EncodeUrl(temp, temp + fullpathlen,std::back_inserter(out));
        unsigned old_size = scratchpad.size();
        scratchpad.resize(scratchpad.size() + fullpathlen*3);
        unsigned new_size = Blex::EncodeUrl(temp, temp + fullpathlen,&scratchpad[old_size]) - &scratchpad[0];
        scratchpad.resize(new_size);
}

unsigned WebHareTransBack::SYS_FS_GetIndexUrl(void *store,unsigned maxsize, Database::BackendTransaction *trans, Database::Record rec)
{
        WHContext whtrans(trans->transcontextkeeper);
        WHCore::Context whcorecontext = GetWHCoreContext(*trans);

        if(!rec.GetCell(whcorecontext->TFS_Objects_IsFolder).Boolean()) //ADDME: What _should_ we do for indexurl of a file?
        {
                int32_t filepublished = rec.GetCell(whcorecontext->TFS_Objects_Published).Integer();
                if (WHCore::IsPublishPublished(filepublished))
                    return SYS_FS_GetUrl(store, maxsize, trans, rec);
                else
                    return 0;
        }

        int32_t foldertype = rec.GetCell(whcorecontext->TFS_Objects_Type).Integer();

        if (foldertype == WHCore::FolderTypes::Foreign)
            return SYS_FS_GetUrl(store,maxsize,trans,rec);

        //Look up the index document/file for this folder
        int32_t indexdoc = rec.GetCell(whcorecontext->TFS_Objects_IndexDoc).Integer();
        if (!indexdoc)
            return 0;

        Database::Scanner filescan(*trans, Database::ShowNormalSkipAccess, false);
        filescan.AddTable(whcorecontext->TFS_Objects_TableId);
        filescan.AddIntegerSearch(0, whcorecontext->TFS_Objects_Id, indexdoc, Database::SearchEqual);
        filescan.SetLimit(1);
        if (!filescan.NextRow())
            return 0;

        int32_t filepublished = filescan.GetRowPart(0).GetCell(whcorecontext->TFS_Objects_Published).Integer();
        if (WHCore::IsPublishPublished(filepublished))
            return SYS_FS_GetUrl(store,maxsize,trans,filescan.GetRowPart(0)); //ADDME: optimize - this one might duplicate a lot of earlier work..
        else
            return 0;
}

int32_t WebHareTransBack::SYS_FS_Objects_GetParentInsideSite(Database::BackendTransaction &trans, Database::Record rec)
{
        WHContext whtrans(trans.transcontextkeeper);
        CachedFSObject const *fsobject = whtrans->LoadFSObjectDirect(trans, rec);
        return SYS_FS_Objects_GetParentInsideSiteCF(trans, fsobject);
}

int32_t WebHareTransBack::SYS_FS_Objects_GetParentInsideSiteCF(Database::BackendTransaction &trans, CachedFSObject const *fsobject)
{
        WHContext whtrans(trans.transcontextkeeper);
        if (!fsobject)
            return 0;
        if (!fsobject->isfolder || fsobject->parentid == 0)
            return fsobject->parentid;

        // Are all site roots present in the rootfolders array?
        if (!whtrans->rootfoldersvalid)
            whtrans->FillSiteCache(trans);

        // If this is a root of a site, return 0
        if (whtrans->rootfolders.count(fsobject->id))
            return 0;

        return fsobject->parentid;
}
