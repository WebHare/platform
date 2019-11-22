#include <ap/libwebhare/allincludes.h>


#include <blex/utils.h>
#include <blex/docfile.h>
#include "word_prescan.h"
#include "word_pic.h"
#include "biff.h"
#include "word_output.h"
#include "wordstyles.h"
#include <iostream>

namespace Parsers {
namespace Office {
namespace Word {

DocPart::DocPart(DocBase const &doc, DocPart *parent, ParaCharStyle const *_basestyle)
: doc(doc)
, master(this)
, basestyle(_basestyle)
, table(NULL)
, parent(parent)
, prev(NULL)
, next(NULL)
, add_top_padding(0) //ADDME: Can move this to the render phase, no need to pre-record this now we have 'prev' and 'next'
, add_bottom_padding(0)
, listovr(NULL)
, listlevel(0)
, contextualspacing(false)
, myspacingtop(0)
, myspacingbottom(0)
{
        if(!basestyle || !basestyle->filter)
        {
                if(basestyle)
                {
                        DEBUGPRINT("Basestyle set, but no filter attached?!");
                }
                basestyle = doc.nullstyle;
        }
        std::fill_n(listcounters,NumListLevels, 0);
}

DocPart::~DocPart()
{
}

int32_t DocPart::GetFinalOutputObjectId() const
{
        DocPart *analyze=master;
        while(analyze->parent)
            analyze = analyze->parent;
        return analyze->outputobjectid;
}

DocPart const *DocPart::GetFirstSlave() const
{
        DocPart const *cur=this;
        while(cur->prev && cur->prev->master==this)
            cur=cur->prev;
        return cur;
}

std::pair<bool, unsigned> DocPart::GetParagraphCollapseInfo() const
{
        return std::make_pair(false,0);
}

std::string DocPart::SuggestAnchorName() const
{
        //Ensure all characters in name are lowercase alpha or underscores.
        const unsigned MaxAnchorLength=32;
        std::shared_ptr<Parsers::RawTextFilter> paratext(new RawTextFilter (0/*no limit, MaxAnchorLength is no good as we may need more...*/, true/*skip bul&num*/));
        Send(paratext);

        std::string anchor;
        for (std::string::const_iterator aitr=paratext->GetText().begin();aitr!=paratext->GetText().end();++aitr)
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

std::string DocPart::GetAnchor() const
{
        return initialanchors.empty() ? std::string() : initialanchors[0];
}

///////////////////////////////////////////////////////////////////////////////

DocBase::DocBase(ParaCharStyle *nullstyle, int32_t unique_id, Callbacks &callbacks)
: tcmode(TCFinal)
, symbol_conversion_images(false)
, ignore_allcaps(false)
, nullstyle(nullstyle)
, default_paragraph_style(NULL)
, callbacks(callbacks)
, unique_id(unique_id)
, firstpart(NULL)
, document_default_pap(*this)
, document_default_chp(*this)
{
}

DocBase::~DocBase()
{
}

DocPart *DocBase::AdoptAndRegisterPart(DocPart *part)
{
        pars.Adopt(part);
        //callbacks.RegisterOutputObject(part, top_level, part->basestyle->filter->toclevel, part->basestyle->filter->split, false);
        return part;
}

void DocBase::EliminateEmptyDocPartsTable(TableDocPart *part)
{
        for(unsigned i=0;i<part->rows.size();++i)
          for(unsigned j=0;j<part->rows[i].cells.size();++j)
            if(part->rows[i].cells[j].firstpart)
              EliminateEmptyDocParts(part->rows[i].cells[j].firstpart);
}
void DocBase::EliminateEmptyDocParts(DocPart *itr) //marks for elimination..
{
        std::pair<bool, unsigned> empty_par_result;
        std::vector<DocPart*> update_masters;

        DocPart *add_to_para = NULL;
        unsigned height_collapsed = 0;
        for(;itr;itr=itr->next)
        {
                empty_par_result = itr->table ? std::make_pair(false,0u) : itr->GetParagraphCollapseInfo();
                DEBUGPRINT("Checking para. eliminate? " << (empty_par_result.first?"yes":"no") << " height " << empty_par_result.second);
                if(empty_par_result.first //allow to collapse
                   && !(add_to_para==NULL && itr->next==NULL) //NEVER eliminate the last paragraph if we don't have any yet
                   && (add_to_para == NULL || add_to_para->basestyle->filter->hide_docobject == itr->basestyle->filter->hide_docobject) // hide settings must match
                   && !itr->HasAnyAnchors()
                   )
                {
                        height_collapsed = std::max(height_collapsed, empty_par_result.second);
                        if(add_to_para)
                            itr->master = add_to_para;
                        else
                            update_masters.push_back(itr);
                }
                else //NOT collapsable
                {
                        if(height_collapsed)
                                DEBUGPRINT((add_to_para ? "Adding to earlier paragraph as bottom padding:" : " Adding to this paragraph as top padding:") << height_collapsed);
                        if(add_to_para) //already had a para, make everything bottom padding
                            add_to_para->add_bottom_padding = height_collapsed;
                        else
                            itr->add_top_padding = height_collapsed;

                        height_collapsed = 0;
                        add_to_para = itr;

                        if(!update_masters.empty()) //Flush paragraphs at the top of the document into this one
                        {
                                for(unsigned i = 0; i < update_masters.size();++i)
                                    update_masters[i]->master = add_to_para;
                                update_masters.clear();
                        }
                }

                if(itr->table)
                    EliminateEmptyDocPartsTable(itr->table);
        }

        //Flush any remaining bottom padding to last paragraph
        if(add_to_para && height_collapsed)
        {
                DEBUGPRINT("Flushing remaining collapsed height to last paragraph: " << height_collapsed);
                add_to_para->add_bottom_padding = height_collapsed;
        }
}
void DocBase::RegisterDocParts()
{
        if(firstpart)
            RegisterDocPartsFrom(firstpart, true);
}
bool DocPart::HasAnyAnchors() const
{
        return !initialanchors.empty() || !otheranchors.empty();
}
bool DocPart::HasAnchor(std::string const &anchorname) const
{
        return std::find(initialanchors.begin(), initialanchors.end(), anchorname) != initialanchors.end()
               || std::find(otheranchors.begin(), otheranchors.end(), anchorname) != otheranchors.end();
}

Parsers::Hyperlink DocBase::GetHyperlink(DocPart const *para, std::string const &anchorname) const
{
        Parsers::Hyperlink link;
        if(!para || (!para->HasAnchor(anchorname) && para->master->initialanchors.empty()))
        {
                DEBUGPRINT("Para " << (void*)para << " has no anchor");
                DEBUGPRINT("Trying to get a non-existing hyperlink to para that has no exact or initial anchor"); //initial scanning should have caught it
                return link;
        }

        link.objectptr = para->master;
        if(para->master->HasAnchor(anchorname))
            link.data = anchorname;
        return link;
}
void DocBase::RegisterDocPartsFrom(DocPart *first, bool top_level)
{
        //ADDME: Smarter algorithm may avoid rewinding
        for(DocPart *cur=first;cur;cur=cur->next)
        {
                if(cur->master!=cur) //not an interesting paragraph
                    continue;

                int32_t toclevel = 0;
                bool split = false;
                bool eliminate = true;
//                bool seen_anchor_on_master = false;

                for (DocPart *slave = cur->GetFirstSlave(); slave && slave->master == cur; slave=slave->next)
                {
                        if(!slave->initialanchors.empty() && slave!=cur) //move slave anchors to us
                        {
                                cur->initialanchors.insert(cur->initialanchors.end(), slave->initialanchors.begin(), slave->initialanchors.end());
                                slave->initialanchors.clear();
                        }
                        if(slave->basestyle->filter->toclevel || slave->basestyle->filter->split)
                        {
                                std::pair<bool, unsigned> empty_par_result;
                                empty_par_result = slave->table ? std::make_pair(false,0u) : slave->GetParagraphCollapseInfo();
                                if(!empty_par_result.first) //not empty
                                {
                                        toclevel = std::max(toclevel, slave->basestyle->filter->toclevel);
                                        split = split || slave->basestyle->filter->split;
                                }
                        }
                        eliminate = eliminate && slave->basestyle->filter->hide_docobject;
                }

                if(toclevel || split)
                {
                        if(cur->initialanchors.empty())
                        {
                                DEBUGPRINT("Must generate anchor because of toclevel/split " << toclevel << " " << split);
                                GenerateAnchorFor(cur);
                        }
                }

                callbacks.RegisterOutputObject(cur, top_level, toclevel, split, eliminate);
                if(cur->table)
                    RegisterTable(cur->table);
        }
}
void DocBase::RegisterTable(TableDocPart *part)
{
        for(unsigned i=0;i<part->rows.size();++i)
          for(unsigned j=0;j<part->rows[i].cells.size();++j)
            if(part->rows[i].cells[j].firstpart)
                RegisterDocPartsFrom(part->rows[i].cells[j].firstpart, false);
}
void DocBase::DumpParts()
{
        if(firstpart)
            DumpPartsFrom(firstpart, 0);
}
void DocBase::DumpPartsFrom(DocPart *part, unsigned level)
{
        for(;part;part=part->next)
        {
                std::clog << level << ".";
                if(part->table)
                {
                        std::clog << " table (" << part->table->rows.size() << " rows) (top +" << part->add_top_padding << ", bottom +" << part->add_bottom_padding << ")\n";
                        for (unsigned i=0;i<part->table->rows.size(); ++i)
                          for (unsigned j=0;j<part->table->rows[i].cells.size(); ++j)
                        {
                                TableDocPart::Cell &cell = part->table->rows[i].cells[j];
                                std::clog << level << ". row #" << i << " cell #" << j << " (offset " << cell.offset << "\n";
                                DumpPartsFrom(cell.firstpart, level+1);
                        }
                }
                else
                {
                        std::clog << " paragraph (top +" << part->add_top_padding << ", bottom +" << part->add_bottom_padding << ")\n";
                }
        }
        std::clog<<std::flush;
}

void DocBase::MapStyles(Parsers::PublicationProfile const &pubprof)
{
        for(unsigned i=0;i<styles.size();++i)
          if(styles[i].get() && styles[i]->type == StyleBase::ParagraphStyle)
          {
                ParaCharStyle *pcs = static_cast<ParaCharStyle*>(styles[i].get());
                if(pcs->mswordid >= 0xffe)
                  pcs->filter = &pubprof.GetFilter_WordCustomStyle(pcs->stylename);
                else
                  pcs->filter = &pubprof.GetFilter_WordStyle(pcs->mswordid);
          }

        nullstyle->filter = &pubprof.GetFilter_WordStyle(nullstyle->mswordid);
}
void DocBase::GenerateAnchorFor(DocPart *part)
{
        std::string newanchor;
        std::string anchorbase = part->SuggestAnchorName();

        /* Create a unique anchor */
        for (unsigned uniquecount=0;;++uniquecount)
        {
                newanchor = anchorbase;
                if (uniquecount>0)
                        newanchor += Blex::AnyToString(uniquecount);

                if (anchors.find(newanchor) == anchors.end()) //unique anchor..
                    break;
        }

        part->master->initialanchors.push_back(newanchor);
        anchors[newanchor] = part;
        DEBUGPRINT("Generated anchor [" << newanchor << "] for paragraph " << (void*)part->master);
}
std::pair<unsigned, std::string> DocBase::Scan(bool emptydocobjects, Parsers::PublicationProfile const &pubprof)
{
        std::pair<unsigned, std::string> res = ScanMetadata(); //analyze all metadata, including stylesheets
        if(res.first) //error
            return res;

        DEBUGONLY(DumpMetadata());

        DEBUGPRINT("DocBase::Scan: MapStyles");
        MapStyles(pubprof);

        DEBUGPRINT("DocBase::Scan: ScanStructure");
        res = ScanStructure();
        if(res.first) //error
            return res;

        if(!emptydocobjects && firstpart)
        {
                DEBUGPRINT("DocBase::Scan: EliminateEmptyDocParts");
                EliminateEmptyDocParts(firstpart);
        }

        DEBUGPRINT("DocBase::Scan: RegisterDocParts");
        RegisterDocParts();

        DEBUGPRINT("DocBase::Scan: ProcessLists");
        ProcessLists();

        DEBUGPRINT("DocBase::Scan: CreateAnchors");
        CreateAnchors();

#ifdef DEBUG
        DumpParts();
#endif

        return std::make_pair(0,std::string());
}
ParaCharStyle const* DocBase::GetStyle(unsigned num) const
{
        if(num<styles.size())
        {
                StyleBase const *style = styles[num].get();
                if(style && (style->type == StyleBase::ParagraphStyle || style->type == StyleBase::CharacterStyle))
                    return static_cast<ParaCharStyle const*>(style);
        }
        return nullstyle;
}

Font const* DocBase::GetFontByTheme(std::string const &fonttheme) const
{
        ThemeFontsMap::const_iterator fontthemeitr = themefonts.find(fonttheme);
        if(fontthemeitr == themefonts.end())
        {
                DEBUGPRINT("Did not recognize theme " << fonttheme);
                return &fonts[0];
        }

        return GetFontByName(fontthemeitr->second);
}

Font const* DocBase::GetFontByName(std::string const &fontname) const
{
        for(unsigned i=0;i<fonts.size();++i)
          if(fonts[i].name==fontname)
            return &fonts[i];
        return &fonts[0];
}

ListOverride const *DocBase::GetListOverride(int32_t id) const
{
        std::map<int32_t, ListOverridePtr>::const_iterator itr = numberings.find(id);
        if(itr != numberings.end() && itr->second.get())
            return itr->second.get();
        else
            return NULL;
}

typedef std::map<unsigned,DocPart*> OrderedParaMap;
void DocBase::ProcessLists()
{
        OrderedParaMap listparas;
        for(ListOverrideMap::iterator itr = numberings.begin(); itr != numberings.end(); ++itr)
          if(itr->second.get())
        {
                DEBUGPRINT("Creating list " << itr->first);
                ListOverride &numbering = *itr->second;
                listparas.clear();

                for(unsigned j=0;j<numbering.listparas.size();++j)
                  if(numbering.listparas[j]->outputobjectid)
                  {
                        DEBUGPRINT("Found listitem #" << j << " it has id " << numbering.listparas[j]->outputobjectid);
                        //ADDME: Might as well just std::sort that vector with a custom function
                        listparas.insert(std::make_pair(numbering.listparas[j]->outputobjectid, numbering.listparas[j]));
                  }
                  else
                  {
                        DEBUGPRINT("No docobject for item covered by list para #" << j << " " << ((void*)numbering.listparas[j]));
                  }

                //Now we've found listitems, configure them

                ///last list level we saw, used for updating the list levle counters
                unsigned lastlevel = 0;

                ///counters for each list level, used to associate paragraphs with list levels (prescan)
                ListCounters counters;

                /// For every level, whether the level has been started
                bool started[NumListLevels];

                //Reset all counters to their initial positions
                for(unsigned i = 0; i < numbering.abstract->levels.size(); ++i)
                {
                        counters[i] = numbering.GetStartAt(i);
                        started[i] = i == 0; // First level is always started
                }

                for (OrderedParaMap::const_iterator itr = listparas.begin(); itr != listparas.end(); ++itr)
                {
                        unsigned para_listlevel = itr->second->listlevel;

                        // Reset all levels from the current when they haven't been started yet
                        for (unsigned i = para_listlevel + 1; i < numbering.abstract->levels.size(); ++i)
                        {
                                if (!started[i])
                                {
                                        counters[i] = numbering.GetStartAt(i) - 1;
                                        started[i] = true;
                                }
                        }

                        // Restart all levels between the last level and the current level, if the last level was their restart level (or below)
                        for (unsigned i = lastlevel; i < para_listlevel; ++i)
                        {
                                unsigned restartat = numbering.GetRestartAfter(i);
                                if (lastlevel <= restartat)
                                {
                                        counters[i] = numbering.GetStartAt(i);
                                        started[i] = false;
                                }
                        }

                        for (unsigned i = para_listlevel; i < numbering.abstract->levels.size(); ++i)
                        {
                                unsigned restartat = numbering.GetRestartAfter(i);
                                if (lastlevel <= restartat)
                                     counters[i] = numbering.GetStartAt(i) - 1;
                        }

                        ++counters[para_listlevel];
                        started[para_listlevel] = true;

                        //Make a copy for this paragraph of the current list counters - but make sure to apply it on the deepest paragraph, not a table itself..
                        DocPart *toset = itr->second;
                        while(toset && toset->table)
                            toset = toset->table->GetFirstDocpart();
                        std::copy(counters, counters + NumListLevels, toset->listcounters);

                        lastlevel = para_listlevel+1;
                }
        }
}

DocPart const * DocBase::FindByBookmark(std::string const &part) const
{
        if(part=="_top") //hardwire _top to the first paragraph
            return firstpart;

        BookmarkMap::const_iterator pos = bookmarks.find(part);
        if(pos != bookmarks.end())
            return pos->second;
        else
            return firstpart; //resolve non-existing bookmarks to _top (it's what Word does...)
}

void DocBase::CreateAnchors()
{
        DEBUGPRINT("Creating anchors");
        bool missing_anchors = false;

        for (ReferredAnchors::const_iterator itr = referred_anchors.begin(); itr != referred_anchors.end(); ++itr)
        {
                DEBUGPRINT("Checking anchor [" << *itr << "]");
                BookmarkMap::const_iterator pos = bookmarks.find(*itr);
                if(pos == bookmarks.end())
                {
                        DEBUGPRINT("Anchor was never encountered");
                        missing_anchors = true;
                        continue;
                }

                if(!pos->second->master->HasAnchor(*itr)
                   && pos->second->master->initialanchors.empty())
                {
                        DEBUGPRINT("Need to generate anchor for referred paragraph");
                        GenerateAnchorFor(pos->second->master);
                }
        }

        if(missing_anchors && firstpart && firstpart->master->initialanchors.empty())
        {
                DEBUGPRINT("There were missing anchors. Firstpart " << (void*)firstpart << " will get an anchor because missing links will resolve to top of document");
                GenerateAnchorFor(firstpart);
        }
}

namespace Colors
{
// Note: This table is a duplicate of the palette table in escher_util.cpp,
// in the 'publishing' project.
// ADDME: Cleanup.  FIXME These are probably not quite correct!
const DrawLib::Pixel32 colormap[16] = { DrawLib::Pixel32 (  0,  0,  0,255) //black
                                      , DrawLib::Pixel32 (  0,  0,255,255) //blue
                                      , DrawLib::Pixel32 (  0,255,255,255) //turquoise
                                      , DrawLib::Pixel32 (  0,255,  0,255) //bright green
                                      , DrawLib::Pixel32 (255,  0,255,255) //pink
                                      , DrawLib::Pixel32 (255,  0,  0,255) //red
                                      , DrawLib::Pixel32 (255,255,  0,255) //yellow
                                      , DrawLib::Pixel32 (255,255,255,255) //white
                                      , DrawLib::Pixel32 (  0,  0,132,255) //dark blue
                                      , DrawLib::Pixel32 (  0,130,132,255) //teal
                                      , DrawLib::Pixel32 (  0,130,  0,255) //green
                                      , DrawLib::Pixel32 (132,  0,132,255) //violet
                                      , DrawLib::Pixel32 (132,  0,  0,255) //darkred
                                      , DrawLib::Pixel32 (132,130,  0,255) //darkyellow
                                      , DrawLib::Pixel32 (132,130,132,255) //darkgray
                                      , DrawLib::Pixel32 (192,192,192,255) //lightgray
                                      };
}

GrpprlPointer GrpprlCache::Reserve(unsigned size)
{
        if (size>=sizeof(Cache)-2)
            throw std::runtime_error("Corrupted Word document: grpprl data too large");

        /** Find a CacheBlock with enough free space */
        for (std::list<CacheBlock>::iterator itr=blocks.begin();itr!=blocks.end();++itr)
        {
                if (sizeof(itr->data) - itr->used > size + 2)
                {
                        //This block has space left! Set it up for grpprl storage
                        //and return it
                        unsigned insertpos = itr->used;
                        Blex::putu16lsb(&itr->data[itr->used],static_cast<uint16_t>(size));
                        itr->used+=size+2;
                        return GrpprlPointer(&itr->data[insertpos]);
                }
        }

        blocks.push_back(CacheBlock());
        Blex::putu16lsb(&blocks.back().data[0],static_cast<uint16_t>(size));
        blocks.back().used=size+2;
        return GrpprlPointer(&blocks.back().data[0]);
}

GrpprlPointer GrpprlCache::Store(unsigned size, uint8_t const *data)
{
        GrpprlPointer store=Reserve(size);
        std::copy(data,data+size,store.Data());
        return store;
}

void BiffDoc::RenderTextboxText(int32_t shapeid, Escher::Interface const *iface, DrawLib::TextFormatter *textformatter) const
{
        uint32_t hostid = iface->GetTextId(shapeid);
        unsigned id = (hostid >> 16)-1;
        if (id >= textboxes.size())
        {
                DEBUGPRINT("GetTextboxText: Cannot locate textbox info for id " << hostid);
                return;
        }

        RenderText(GetHeader().TextboxDocStart() + textboxes[id].startcp,
                   GetHeader().TextboxDocStart() + textboxes[id].limitcp,
                   textformatter);
}

std::string BiffDoc::GetText(Cp cp, Cp limit_cp) const
{
        ParagraphWalker walker(*this);
        walker.SetCharacter(cp);

        std::string retval;
        Blex::UTF8Encoder<std::back_insert_iterator<std::string> > utf8encoder(std::back_inserter(retval));

        for (; cp < limit_cp; ++cp)
        {
                if (cp == walker.GetSwitchCp()) //hit a switch position
                    walker.SetCharacter(cp);

                utf8encoder(walker.GetChar(cp, true));
        }
        return retval;
}

std::string BiffDoc::GetRawText(Cp cp, Cp limit_cp) const
{
        Parsers::RawTextFilter filter( 0/*no limit*/, true);
        CharacterProcessor charproc(*this, cp);
        OutputState os(*this,filter);
        charproc.DoText(os, NULL, cp, limit_cp);
        return filter.GetText();
}

ParaEvent::~ParaEvent()
{
}

std::string ParaEvent::Describe() const
{
        return "Undescribed ParaEvent";
}

StyleBase::StyleBase()
: mswordid(0xFFE)
{
}

StyleBase::~StyleBase()
{
}

ParaCharStyle::ParaCharStyle(DocBase &parent)
: cached_stylepap(parent)
, cached_stylechp(parent)
, filter(NULL)
{
        type = ParagraphStyle;
        predefined_output_style=0;
}


void ParaCharStyle::PredefineStyle(Parsers::FormattedOutput &output)
{
        Parsers::Paragraph predef_para;
        Parsers::Character predef_char;

        cached_stylepap.Fixup();
        cached_stylechp.Fixup();

        //Apply profile filters to the settings
        filter->FixupParagraphSettings(&predef_para, cached_stylepap.formatted, Parsers::NoList);
        filter->FixupCharacterSettings(&predef_char, cached_stylechp.formatted);
        predef_para.mswordid = mswordid;

        //Record the settings in the stylesheet
        predefined_output_style = output.PredefineStyle(stylename, predef_para, predef_char);
}

Font::Font()
: prq(0)
, truetype(true)
, fontfamily(0)
, baseweight(0)
, charset(0)
, alternative(0)
, msfonttype(Font::Plain)
, charactermap(NULL)
{
}

const char *GetLanguageCode(int16_t windows_id)
{
        switch(windows_id)
        {
        case 0x0400:     return "";
        case 0x0401:     return "ar-sa";
        case 0x0402:     return "bg";
        case 0x0403:     return "ca";
        case 0x0404:     return "zh-tw";
        //case 0x0804:     //traditional chinese
        case 0x0405:     return "cs";
        case 0x0406:     return "da";
        case 0x0407:     return "de";
        case 0x0807:     return "de-ch";
        case 0x0408:     return "el";
        case 0x0409:     return "en-us";
        case 0x0809:     return "en-gb";
        case 0x0C09:     return "en-au";
        case 0x040A:     return "es";
        case 0x080A:     return "es-mx";
        case 0x040B:     return "fi";
        case 0x040C:     return "fr";
        case 0x080C:     return "fr-be";
        case 0x0c0C:     return "fr-ca";
        case 0x100C:     return "fr-ch";
        case 0x040D:     return "he";
        case 0x040E:     return "hu";
        case 0x0410:     return "it";
        case 0x0411:     return "ja";
        case 0x0412:     return "ko";
        case 0x0413:     return "nl";
        case 0x0813:     return "nl-be";
        case 0x0414:     return "no";
        case 0x0415:     return "pl";
        case 0x0416:     return "pt-br";
        case 0x0419:     return "ru";
        case 0x041D:     return "sv";
        case 0x0804:     return "zh-cn";
        case 0x0816:     return "pt";
        case 0x0C0A:     return "es";

        //ADDME: A lot of language codes are still missing

        default:
                DEBUGPRINT("Cannot find language for code " << windows_id);
                return "";
        };
}

Callbacks::~Callbacks()
{
}

void BrcToBorder(Parsers::Table::BorderType *border, Brc const &brc)
{
        //convert automatic to black..
        if (brc.bordertype == 255) //undocumented, but it probably means: no border
        {
                border->thickness_twips = 0;
                border->color = DrawLib::Pixel32(0,0,0,255);
        }
        else
        {
                border->thickness_twips = (brc.linewidth * 5 + 1) / 2; // linewidth in twips (was 0.125 pts)
                border->color = brc.color.IsFullyTransparent() ? DrawLib::Pixel32(0,0,0,255) : brc.color;
        }
}

//ADDME contextual spacing support
unsigned GetPapChpEmptyHeight(Pap const &pap, Chp const &chp)
{
        DEBUGPRINT("hps " << chp.formatted.font_halfpoint_size << " padding " << pap.formatted.padding);
        return chp.formatted.font_halfpoint_size*12 //add a fifth.. (FIXME: Get size from actual font props, if available)
                + pap.formatted.padding.top
                + pap.formatted.padding.bottom;
}

void TableDocPart::ApplyGlobalPropsFromTap(Tap const &tap)
{
        tableformat.tablewidth = tap.wWidth;
        tableformat.cellspacing = tap.cellspacing/15; //twips to pixels..
        //FIXME:tableformat.padding_top = toppadding;
        //ADDME: Not right - table rows inside a table can differ with alignment..
        tableformat.halign = tap.table_jc;
}

void TableDocPart::PostProcess()
{
        /* Kill unused margins (no border and no background color), which occur
           because word tables by default have their borders inside the page margins

           Calculate the minmium removable margins */

        unsigned min_left_margin = std::numeric_limits<unsigned>::max(), min_right_margin = std::numeric_limits<unsigned>::max();
        for(unsigned i=0;i<tableformat.GetRows();++i)
        {
                if(tableformat.GetFormatting(0,i).left.thickness_twips != 0
                   || !tableformat.GetFormatting(0,i).background.IsFullyTransparent())
                {
                        min_left_margin = 0;
                }
                else
                {
                        min_left_margin = std::min(min_left_margin, tableformat.GetFormatting(0,i).padding.left);
                }

                unsigned lastcell = tableformat.GetRightmostColumn(i);
                if(lastcell != tableformat.GetColumns())
                {
                        if (tableformat.GetFormatting(lastcell,i).right.thickness_twips != 0
                            || !tableformat.GetFormatting(lastcell,i).background.IsFullyTransparent())
                        {
                                min_right_margin=0;
                        }
                        else
                        {
                                min_right_margin = std::min(min_right_margin, tableformat.GetFormatting(lastcell,i).padding.right);
                        }
                }
        }

        if(min_left_margin>0 || min_right_margin>0)
        { //go again, but now to actually clear the margins
                for(unsigned i=0;i<tableformat.GetRows();++i)
                {
                        //ADDME: Only clear the padding that is inside the page margin (and actually the minimum removable padding of all rows) - don't just bluntly reset
                        tableformat.GetFormatting(0,i).padding.left -= min_left_margin;
                        unsigned lastcell = tableformat.GetRightmostColumn(i);
                        if(lastcell!=tableformat.GetColumns())
                            tableformat.GetFormatting(lastcell, i).padding.right -= min_right_margin;
                }
        }
}

DocPart const * TableDocPart::GetFirstDocpart() const
{
        for (unsigned i=0;i<rows.size();++i)
          for (unsigned j=0;j<rows[i].cells.size();++j)
            if(rows[i].cells[j].firstpart)
              return rows[i].cells[j].firstpart;
        return NULL;
}

Parsers::ObjectType Pap::GetListType() const
{
        if (listovr)
        {
                //side by side bullets only work with negative first indent and leftaligned text.
                return (formatted.first_indent < 0 && (formatted.jc == Parsers::Left || formatted.jc == Parsers::Justified))
                           ? Parsers::SidebysideBullet
                           : Parsers::InlineBullet;
        }
        else
        {
                return Parsers::NoList;
        }
}

void DocPart::StartPara(Pap const &pap, Parsers::FormattedOutput &output, Parsers::ObjectType listtype, ParaCharStyle *style) const
{
        Parsers::Paragraph para(pap.formatted);
        DEBUGPRINT("DocPart::StartPara addtop " << this->add_top_padding << " addbottom " << this->add_bottom_padding);

        //ADDME How to account for eliminated paragraphs when contextualspacing is used ?
        if(contextualspacing && prev && prev->basestyle == basestyle)
        {
                DEBUGPRINT("Contextual spacing, padding.top set from " << para.padding.top << " to 0");
                para.padding.top = 0;
        }
        if(contextualspacing && next && next->basestyle == basestyle)
        {
                DEBUGPRINT("Contextual spacing, padding.bottom set from " << para.padding.bottom << " to 0");
                para.padding.bottom = 0;
        }

        if(!contextualspacing && prev && prev->basestyle == style && prev->contextualspacing)
        {
                //If prev had contextual spacing, but we don't, subtract prev's padding-bottom from our top (2nd 1 17.3.1.9 pdfpage 220)
                DEBUGPRINT("Compensate for contextspacing, padding.top set from " << para.padding.top);
                para.padding.top = para.padding.top < prev->myspacingbottom ? 0 : para.padding.top - prev->myspacingbottom;
                DEBUGPRINT("to " << para.padding.top);
        }
        if(!contextualspacing && next && next->basestyle == style && next->contextualspacing)
        {
                //If prev had contextual spacing, but we don't, subtract prev's padding-bottom from our top (2nd 1 17.3.1.9 pdfpage 220)
                DEBUGPRINT("Compensate for contextspacing, padding.bottom set from " << para.padding.bottom);
                para.padding.bottom = para.padding.bottom < next->myspacingtop ? 0 : para.padding.bottom - next->myspacingtop;
                DEBUGPRINT("to " << para.padding.bottom);
        }

        para.padding.top += this->add_top_padding;
        para.padding.bottom += this->add_bottom_padding;

        DEBUGPRINT("Final padding " << para.padding);

        output.StartParagraph(style->predefined_output_style, para, listtype) ;
        for(std::vector<std::string>::const_iterator itr = initialanchors.begin(); itr!=initialanchors.end(); ++itr)
            output.SetAnchor(*itr);

}


} // End of namespace Word
} // End of namespace Office
} // End of namespace Parsers
