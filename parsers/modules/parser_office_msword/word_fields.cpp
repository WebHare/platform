#include <ap/libwebhare/allincludes.h>

#include <stack>
#include <iostream>
#include <blex/utils.h>
#include "biff.h"
#include "word_base.h"
#include "word_fields.h"
#include "word_output.h"

/* With the field scanner, we try to gather important field information in
   advance and discard any irrelevant field information. This reduces the
   complexity in the prescan and textprocessor phases, as they won't have
   to deal with the horrors of field parsing anymore.

   The biggest problem with MS Word fields (apart from their poor documentation)
   is that they can span multiple paragraphs. If we were to interpret fields
   inside the paragraph code, we would always have to search backwards for
   fields that might span completely OVER our paragraph. */

namespace Parsers {
namespace Office {
namespace Word {

namespace
{

std::string GenerateAnchorName(std::string const &in)
{
        //Ensure all characters in name are lowercase alpha or underscores.
        const unsigned MaxAnchorLength=32;

        std::string anchor;
        for (std::string::const_iterator aitr=in.begin();aitr!=in.end();++aitr)
        {
                //Translate spaces and underscores to underscore, but never
                //start an anchor with an underscore, and never create duplicate
                //underscores
                if (*aitr==' ' || *aitr=='_')
                {
                        if (!anchor.empty() && anchor[anchor.size()-1]!=L'_')
                            anchor.push_back('_');
                }
                else if (Blex::IsAlNum(*aitr))
                {
                        anchor.push_back(Blex::ToLower(*aitr));
                }
                if (anchor.size() >= MaxAnchorLength)
                    break;
        }
        //Remove trailing underscores
        if (!anchor.empty() && anchor[anchor.size()-1]=='_')
            anchor.erase(anchor.end()-1);
        if (anchor.empty())
            return "webhare";
        return anchor;
}


/* ADDME: Better description
   basically, fields look like this

   KEYWORD [PARAMETERS] [SWITCHES]

   Switches start with a backslash. Word uses Fuzzy(tm) parsing for field codes
   and it's hard to find any documentation about this */

/* ADDME: Perhaps an iterator over switches/parameters could be useful? */

typedef std::string ::const_iterator FieldIterator;

FieldIterator GetFirstParamPos(FieldIterator start, FieldIterator limit)
{
        //Find field name
        start = Blex::FindNot(start,limit,' ');

        //Skip field name
        start = std::find(start,limit,' ');

        //And eat the rest of the spaces
        start = Blex::FindNot(start,limit,' ');

        return start;
}
FieldIterator GetNextParamPos(FieldIterator pos,FieldIterator end)
{
        char scanfor=' ';

        if (pos!=end && *pos=='"')
        {
                ++pos; //skip first '"'
                scanfor='"';
        }

        //Skip till scanfor character. Skip all characters following a '\'
        while (pos != end && *pos!=scanfor)
        {
                if (*pos=='\\') //escape the next character
                {
                        ++pos;
                        if (pos==end)
                            break;
                }
                ++pos; //to the next character
        }

        if (pos!=end)
            ++pos; //eat the closing character, if any

        pos = Blex::FindNot(pos,end,' ');
        return pos;
}

unsigned GetNumParameters(std::string const &fielddata)
{
        unsigned params=0;
        FieldIterator end=fielddata.end();
        FieldIterator pos=GetFirstParamPos(fielddata.begin(),end);

        //We are now at the first parameter!
        for (;pos!=end && *pos!='\\';pos=GetNextParamPos(pos,end))
            ++params;

        return params;
}

/* get the position of the requested paramter */
FieldIterator GetParamStartpos(std::string const &fielddata,unsigned num)
{
        unsigned params=0;
        FieldIterator end=fielddata.end();
        FieldIterator pos=GetFirstParamPos(fielddata.begin(),end);

        if (pos!=end && *pos=='\\') //no parameters at all exist!
            return end;

        //We are now at the first parameter!
        for (;pos!=end && params<num;pos=GetNextParamPos(pos,end))
          if (*pos=='\\') //the switches have started, no more params follow...
            return end;

        //Now return this final parameter
        return pos;
}

FieldIterator FindSwitchPosition(std::string const &fielddata,char switchchar)
{
        FieldIterator end=fielddata.end();
        FieldIterator pos=GetFirstParamPos(fielddata.begin(),end);

        while (pos!=end)
        {
                //Case-insensitive compare!
                if (*pos=='\\' && pos+1 != end)
                {
                        char thisswitch=char(pos[1]);
                        if (std::tolower(thisswitch) == std::tolower(switchchar))
                            return pos;
                }
                pos=GetNextParamPos(pos,end);
        }
        return end;
}

bool GetSwitchSet(std::string const &fielddata,char switchchar)
{
        return FindSwitchPosition(fielddata,switchchar)!=fielddata.end();
}

std::string DecodeParam(FieldIterator startpos, FieldIterator end)
{
        std::string retval;
        char scanfor=' ';
        if (startpos!=end && *startpos=='"')
        {
                ++startpos; //skip first '"'
                scanfor='"';
        }

        //Skip till scanfor character. Skip all characters following a '\'
        while (startpos != end && *startpos!=scanfor)
        {
                if (*startpos=='\\') //escape the next character
                {
                        ++startpos;
                        if (startpos==end)
                            break;
                }
                retval.push_back(*startpos);
                ++startpos;
        }
        return retval;
}

std::string GetSwitchParam(std::string const &fielddata, char switchchar)
{
        FieldIterator end=fielddata.end();
        FieldIterator pos=FindSwitchPosition(fielddata,switchchar);

        if (pos==end)
            return std::string ();

        //skip past switch
        pos+=2;
        //skip past spaces
        pos=Blex::FindNot(pos,end,' ');

        //if this is not another switch...
        if (pos!=end && *pos!='\\')
            return DecodeParam(pos,end);
        else
            return std::string ();
}

std::string GetParam(std::string const &fielddata,unsigned num)
{
        FieldIterator pos=GetParamStartpos(fielddata,num);

        if (pos==fielddata.end())
            return std::string ();
        else
            return DecodeParam(pos,fielddata.end());
}

} //end anonymous namespace

std::string FixupWordLink(std::string const &linktodata)
{
        if(linktodata.size()>2 && linktodata[0]=='\\' && linktodata[1]=='\\') //UNC paths?
        {
                return "file:///" + linktodata;
        }

        //Word loves converting slashes to backslashes. Turn them back until we hit a ':' or '?'
        std::string linkto;
        bool convert_backslashes = true;
        for (std::string::const_iterator itr = linktodata.begin(); itr != linktodata.end(); ++itr)
        {
                if (*itr==':' || *itr=='?')
                    convert_backslashes = false;

                if (*itr=='\\' && convert_backslashes)
                    linkto.push_back('/');
                else if (*itr==' ') //word 'forgets' to convert spaces to %20s
                    linkto += "%20";
                else if (*itr>=0&&*itr<32) //skip non printables
                    continue;
                else //ADDME: Urlencode for UTF-8 characters?
                    linkto.push_back(*itr);
        }
        return linkto;
}

FieldsManager::FieldsManager(BiffDoc &parentdoc)
: doc(parentdoc)
{
}

void FieldsManager::SetDefaultAnchorTarget(std::string const &target)
{
        DEBUGPRINT("Default target " << target);
        defaultanchortarget = target;
}

Parsers::Hyperlink FieldsManager::ResolveInternalLink(std::string const &linklocation)
{
        Parsers::Hyperlink link;

        DEBUGPRINT("Resolving internal link for '" << linklocation << "'");
        DocPart *para = doc.FindByBookmark(linklocation);

        if(!para->HasAnchor(linklocation) && para->master->initialanchors.empty())
        {
                DEBUGPRINT("Generating an anchor because of internal link to '" << linklocation << "'");
                doc.GenerateAnchorFor(para);
        }
        return doc.GetHyperlink(para, linklocation);
}

//DOCX still borrows from the BIFF implementation...
Parsers::Hyperlink ParseFieldCodeHyperlink(std::string const &fieldcode)
{
        Parsers::Hyperlink link;
        link.title = GetSwitchParam(fieldcode,'o');
        link.data = FixupWordLink(GetParam(fieldcode,0));
        link.target = GetSwitchParam(fieldcode,'t');

        if (link.target.empty() && GetSwitchSet(fieldcode,'N')) //open in new window?
            link.target="_blank";

        DEBUGPRINT("link.data: " << link.data);
        std::string locationdata = GetSwitchParam(fieldcode,'L');
        DEBUGPRINT("/L: " << locationdata);

        if (!locationdata.empty()) //Add it as a normal anchor
        {
                link.data += "#";
                link.data += locationdata;
        }

        ApplyWordLinkHack(&link);
        return link;
}

Parsers::Hyperlink FieldsManager::CreateHyperlink(std::string const &fieldcode)
{
        Parsers::Hyperlink link = ParseFieldCodeHyperlink(fieldcode);

        if (!link.data.empty() && link.data[0]=='#')
        {
                std::string locationdata = std::string(link.data.begin()+1, link.data.end());
                std::string savetarget = link.target;
                link = ResolveInternalLink(locationdata);
                link.target = savetarget;
        }

        if(link.target.empty()) //then switch to the default...
        {
                DEBUGPRINT("Link target for " << link.data << " not set, falling back to default: " << defaultanchortarget);
                link.target = defaultanchortarget;
        }

        return link;
}

void FieldsManager::SetLinks(Cp start_cp, Cp end_cp, Parsers::Hyperlink const &link)
{
        DEBUGPRINT("Setting links for range " << start_cp << "-" << end_cp << " with data " << link.data);
        /* Assign this link to all affected paragraphs */
        BiffParagraph const* curpara = doc.FindParagraph(start_cp);
        BiffParagraph const* limitpara = doc.FindParagraph(end_cp);
        if (limitpara)
            limitpara = limitpara->GetNext();

        for (;curpara != limitpara;curpara=curpara->GetNext())
        {
                Cp local_start_cp = std::max(start_cp,curpara->startcp);
                Cp local_stop_cp = std::min(end_cp,curpara->limitcp-1); //FIXME: I think stop_cp is one off? after all, you close the hyperlink AFTER all data it contains?

                DEBUGPRINT("Setting para [" << curpara->startcp << "-" << curpara->limitcp << "[ link at local range " << local_start_cp << "-" << local_stop_cp);
                if(local_start_cp == local_stop_cp)
                {
                        DEBUGPRINT("** NOT skipping link at start of paragraph - we used to do this, but it's a doc/docx difference now (see defaulttarget test)");
                        //continue; //this is a link terminating at the start of the paragraph
                }
                doc.paraevents[local_start_cp].push_back(ParaEventPtr(new OpenLinkParaEvent(link)));
                doc.paraevents[local_stop_cp].push_back(ParaEventPtr(new CloseLinkParaEvent));
        }
}

void FieldsManager::Process(FieldStack const &field, Cp end_cp, BiffDoc &doc)
{
        if (field.start_cp>=field.seperator_cp || field.seperator_cp>end_cp)
        {
                DEBUGPRINT("Skipping invalid field ending at " << end_cp);
                return;
        }

        //ADDME: Ignore unsupported field types..
        //ADDME: An alternative would be to create a global Events structure...
        std::string fieldcode = doc.GetText(field.start_cp+1,field.seperator_cp);
        DEBUGPRINT("Type " << (int)field.type << " (" << field.start_cp << "-" << end_cp << ") data [" << fieldcode << ']');
        fieldtypes.insert(std::make_pair(field.start_cp, field.type));

        if (field.type == 3) //Reference
        {
                std::string target = GetParam(fieldcode,0);
                SetLinks(field.start_cp,end_cp,ResolveInternalLink(target));
        }
        if (field.type == 88) //Hyperlink!
        {
                SetLinks(field.start_cp,end_cp,CreateHyperlink(fieldcode));
                return;
        }
}

void FieldsManager::DumpToClog() const
{
        std::clog << "Fieldsmanager debug dump\n";
        for(ParaEvents::const_iterator itr = doc.paraevents.begin(); itr!=doc.paraevents.end();++itr)
          for(ParaEventPtrs::const_iterator itr2 = itr->second.begin(); itr2!=itr->second.end();++itr2)
            std::clog << itr->first << ": " << (*itr2)->Describe() << "\n";
        std::clog << std::flush;
}

unsigned FieldsManager::GetFieldType(Cp cp) const
{
        FieldTypes::const_iterator fieldinfo = fieldtypes.find(cp);
        if (fieldinfo == fieldtypes.end())
            return 0;
        else
            return fieldinfo->second;
}

void FieldsManager::Initialize(Blex::RandomStream &tablefile)
{
        ReadBookmarks(tablefile);
        ReadFields(tablefile);
}

void FieldsManager::ReadFields(Blex::RandomStream &tablefile)
{
        Plcf fields_plcf(tablefile, doc.GetHeader().OffsetFldPlcMainDoc(), doc.GetHeader().LengthFldPlcMainDoc(), 6, true);
        ReadFieldsPlcf(fields_plcf, 0);

        Plcf footnote_plcf(tablefile, doc.GetHeader().OffsetFldPlcFootnoteDoc(), doc.GetHeader().LengthFldPlcFootnoteDoc(), 6, true);
        ReadFieldsPlcf(footnote_plcf, doc.GetHeader().FootnoteDocStart());

        Plcf endnote_plcf(tablefile, doc.GetHeader().OffsetFldPlcEndnoteDoc(), doc.GetHeader().LengthFldPlcEndnoteDoc(), 6, true);
        ReadFieldsPlcf(endnote_plcf, doc.GetHeader().EndnoteDocStart());

        Plcf textbox_plcf(tablefile, doc.GetHeader().OffsetFldPlcTextboxDoc(), doc.GetHeader().LengthFldPlcTextboxDoc(), 6, true);
        ReadFieldsPlcf(textbox_plcf, doc.GetHeader().TextboxDocStart());
}

void FieldsManager::ReadFieldsPlcf(Plcf const &fields_plcf, Cp startoffset)
{
        std::stack<FieldStack> fieldstack;

        /* Now record data about the fields we find interesting */
        for (unsigned i=0;i<fields_plcf.GetNumEntries();++i)
        {
                const uint8_t *numbering=static_cast<const uint8_t*> (fields_plcf.GetEntryData(i)) ;
                Cp cur_cp=fields_plcf.GetEntryOffset(i) + startoffset; //subdocs are locally offset

                switch (Blex::getu8(numbering)&0x1F)
                {
                case 19: //field start
                        fieldstack.push(FieldStack(cur_cp, Blex::getu8(numbering+1)));
                        break;
                case 20: //field seperator
                        if (!fieldstack.empty())
                            fieldstack.top().seperator_cp=cur_cp;
                        else
                            DEBUGPRINT("Got a field seperator at " << cur_cp << " but no field is open");
                        break;
                case 21: //field end
                        if (!fieldstack.empty())
                        {
                                if (fieldstack.top().seperator_cp==0)
                                    fieldstack.top().seperator_cp=cur_cp;

                                Process(fieldstack.top(),cur_cp,doc);
                                fieldstack.pop();
                        }
                        else
                        {
                                DEBUGPRINT("Got a field seperator at " << cur_cp << " but no field is open");
                        }
                        break;
                default:
                        DEBUGPRINT("Got unknown field code " << (Blex::getu8(numbering)&0x1F) << " at " << cur_cp);
                        break;
                }
        }
}

void FieldsManager::ReadBookmarks(Blex::RandomStream &tablefile)
{
        /* Read and parse the bookmarks in a doc */
        Stringtable bookmarktable;

        //Read the bookmarks
        bookmarktable.Read(/*doc,
                           */tablefile,
                           doc.GetHeader().OffsetBookmarkInfo(),
                           doc.GetHeader().LengthBookmarkInfo());

        //static int read_plcf(uint32_t data_lcb,uint32_t data_fc,int structsize,uint32_t *entries,void **data)
        //returns -3 on memerror, -2 on readerror, -1 on weird datasize
        Plcf bookmarks_plcf(tablefile,
                            doc.GetHeader().OffsetPlcfBookmarkStart(),
                            doc.GetHeader().LengthPlcfBookmarkStart(),
                            8,
                            true);

        if (bookmarks_plcf.GetNumEntries() != bookmarktable.Length())
        {
                DEBUGPRINT("Corrupted Word doc: Bookmark data truncated "
                           << " plcf has " << bookmarks_plcf.GetNumEntries() << " entries"
                           " and stringtable has " << bookmarktable.Length() << " entries");
                return;
        }

        /* Store paragraph pointers for all bookmarks, */
        for (unsigned i=0;i<bookmarks_plcf.GetNumEntries();++i)
        {
                /* Find the paragraph this bookmark refers to */
                Cp offset = bookmarks_plcf.GetEntryOffset(i);
                BiffParagraph* para = doc.FindParagraph(offset);
 //               while (para && para->master != para) //move to a visible paragraph
//                    para=para->GetNext();

                if (!para)
                {
                        DEBUGPRINT("Corrupted Word doc: Bookmark data associated with non-existing paragraph");
                        continue;
                }

                /* Keep it in bounds (necessary for anchors living in a collapsed paragraph)
                   offset = Blex::Bound(, obj->parainfo.real_paragraph->limitcp-1, offset);
                   unfortunately, that doesn't work, because word is inconsistent in its
                   anchor lcation generation (Hard page ends can invisible cause
                   different locations for anchors

                   Just move all anchors to the beginning of their paragraph*/
                //offset = para->startcp;

                // If this bookmark looks like it was user-generated, store its name
                std::string const &markname=bookmarktable.Grab(i);
                if(markname.empty())
                    continue;

                if(markname[0]!='_')
                {
                        //This mark is worth outputting
                        if(offset == para->startcp)
                        {
                                para->initialanchors.push_back(markname);
                        }
                        else
                        {
                                para->otheranchors.push_back(markname);
                                doc.paraevents[offset].push_back(ParaEventPtr(new AnchorEvent(markname)));
                        }
                }
                doc.bookmarks.insert(std::make_pair(markname, para));
        }
}
AnchorEvent::AnchorEvent(std::string const &anchor)
:anchor(anchor)
{
}
bool AnchorEvent::Execute(FormattedOutput &output)
{
        output.SetAnchor(anchor);
        return false;
}
std::string AnchorEvent::Describe() const
{
        return "Anchor: " + anchor;
}

OpenLinkParaEvent::OpenLinkParaEvent(Parsers::Hyperlink const &_extern_link)
: external_link(_extern_link)
{
}
bool OpenLinkParaEvent::Execute(FormattedOutput &output)
{
        DEBUGPRINT("Opening hyperlink.. " << external_link.data << " " << external_link.target);
        if(output.AreHyperlinksAccepted())
            output.StartHyperlink(external_link);
        return false; //don't skip character
}
std::string OpenLinkParaEvent::Describe() const
{
        return "Open Link: " + external_link.data;
}
bool CloseLinkParaEvent::Execute(FormattedOutput &output)
{
        DEBUGPRINT("Closing hyperlink..");
        if(output.AreHyperlinksAccepted())
            output.EndHyperlink();
        return false; //don't skip character
}
std::string CloseLinkParaEvent::Describe() const
{
        return "Close Link";
}

} // End of namespace Word
} // End of namespace Office
} // End of namespace Parsers
