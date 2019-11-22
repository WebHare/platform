#include <ap/libwebhare/allincludes.h>


#include <drawlib/drawlibv2/canvas.h>
#include "word_output.h"
#include "biff.h"
#include "word_prescan.h"
#include <parsers/base/formatter.h>
#include <parsers/base/filtering.h>

namespace Parsers {
namespace Office {
namespace Word {

OutputState::OutputState(DocBase const &doc, Parsers::FormattedOutput &output)
: doc(doc)
, output(output)
{
}

OutputState::~OutputState()
{

}

void OutputState::SetFormatting(Font const *font, Parsers::Character const &formatting)
{
        if(font->charset == 2 && doc.symbol_conversion_images)
        {
                symbolfont = font->formatted.font_face;
                symbolsize = formatting.font_halfpoint_size/2;
        }
        else
            symbolfont.clear();

        output.ChangeFormatting(formatting);
}

void OutputState::ApplyChp(Chp const &chp, Parsers::StyleSettings const *filter)
{
        Parsers::Character newformatting(chp.formatted);

        if (chp.pod.internal_bits & Chp::FGAutomatic)
        {
                //FIXME: Read para and text backgrounds, and allow them to override!
                DrawLib::Pixel32 bgcolour = output.GetBackgroundColor();
                if (!bgcolour.IsFullyTransparent())
                {
                        unsigned coloursum = bgcolour.GetR()
                                             + bgcolour.GetG()
                                             + bgcolour.GetB();

                        if (coloursum <= 153) //make white!
                            newformatting.foreground_color=DrawLib::Pixel32(255,255,255,255);
                }
        }

        if (filter)
            filter->FixupCharacterSettings(&newformatting, newformatting);

        SetFormatting(chp.font, newformatting);
}

void OutputState::DrawText(DrawLib::BitmapInterface *bitmap, int32_t /*startx*/, int32_t /*starty*/, int32_t /*lenx*/, int32_t /*leny*/)
{
        DrawLib::TextRenderer textrenderer;
        DrawLib::Canvas32 canvas(bitmap);
        textrenderer.DrawText(canvas, current_text, DrawLib::FPPoint(0,current_outputfont->GetCurrentHeight() + current_outputfont->GetCurrentDescender()), *current_outputfont,
                              std::vector<double>(), true, 0, 0,
                              DrawLib::TextRenderer::LEFT,
                              DrawLib::TextRenderer::BASELINE,
                              0);
}

void OutputState::Write(unsigned numbytes, const char *bytes)
{
        if(current_symbolfont != symbolfont)
        {
                //Close current font
                current_outputfont.reset();

                //Open the font
                if(!symbolfont.empty())
                    current_outputfont.reset(DrawLib::GetGlobalFontManager().CreateFontFromFile(symbolfont, "Regular")); //FIXME: Propert font subtype

                current_symbolfont = symbolfont;
        }

        if(!current_outputfont.get())
        {
                output.WriteString(numbytes, bytes);
                return;
        }

        current_outputfont->SetSize(DrawLib::FPSize(symbolsize * (4.0/3.0),symbolsize * (4.0/3.0)));
        current_outputfont->SelectCharacterMap(DrawLib::Font::SYMBOLMAP);

        //ADDME: Separate images to allow for word wrapping
        current_text.clear();
        Blex::UTF8Decode(bytes, bytes+numbytes, std::back_inserter(current_text));

        //Get the bounding box for our text
        DrawLib::TextRenderer textrenderer;
        bbox = textrenderer.CalculateBoundingBox(current_text,
                                                DrawLib::FPPoint(0,0),
                                                *this->current_outputfont,
                                                std::vector<double>(),
                                                true,
                                                0,
                                                0,
                                                DrawLib::TextRenderer::LEFT,
                                                DrawLib::TextRenderer::TOP,
                                                0);

        Parsers::ImageInfo imginfo;
        imginfo.lenx = std::ceil(bbox.lower_right.x);
        imginfo.leny = std::ceil(current_outputfont->GetCurrentHeight());
        //ADDME: Merge font type and color into the uniqueid
        imginfo.uniqueid = "msword-symbol-" + current_symbolfont + "-" + Blex::AnyToString(symbolsize) + "-" + std::string(bytes,bytes+numbytes);
        //ADDME: Generate an alttag out of the Unicode-converted symbols
        //ADDME: Mark us as symbol text in the imginfo (so image resizers might stay away? but what can they do anyway?)
        imginfo.painter = std::bind(&OutputState::DrawText, this, std::placeholders::_2, std::placeholders::_3, std::placeholders::_4, std::placeholders::_5, std::placeholders::_6);
        output.InsertImage(imginfo);
}

void AddNumberToBullet(std::string &out,
                                     unsigned word_nfc,
                                     unsigned number)
{
        if (number >= 32768)
        {
                DEBUGPRINT("List number too large " << number);
                return;
        }

        if (word_nfc==1 || word_nfc==2) //Upper or lower case roman?
            Blex::EncodeNumberRoman(number,word_nfc==1,std::back_inserter(out));
        else if (word_nfc==3 || word_nfc==4) //Upper or lower case alpha?
            Blex::EncodeNumberAlpha(number,word_nfc==3,std::back_inserter(out));
        else if (word_nfc==22) //decimal, but with a preceding zero for 0-9
        {
                if(number<10)
                    out.push_back('0');
                Blex::EncodeNumber(number,10/*decimal radix*/,std::back_inserter(out));
        }
        else //word_nfc ==0 and fallback
        {
                Blex::EncodeNumber(number,10/*decimal radix*/,std::back_inserter(out));
        }
}

void DoBullet(OutputState &os, ListOverride const &list, unsigned level, ListCounters const &counters, Font const &font)
{
        std::string bullet;

        ListLevel const *lvldata=list.GetLevel(level); //current level data
        if(!lvldata)
            return;

        //Apply the list formatting.
        for (unsigned numberptr=0;numberptr < lvldata->lvltext.size();++numberptr) //walk through the number string
        {
                if(lvldata->lvltext[numberptr] == '%' && (numberptr+1) < lvldata->lvltext.size())
                {
                        unsigned insertlevel = lvldata->lvltext[++numberptr] - '1';
                        //DocX specs for lvlText tell us NOT to insert a list level deeper than our currnet level
                        if(insertlevel > level)
                            continue;
                        ListLevel const *lookuplevel = list.GetLevel(insertlevel); //current level data
                        if(!lookuplevel)
                        {
                                DEBUGPRINT("Reference to non-existing listlevel " << insertlevel);
                                continue;
                        }

                        unsigned nfc = lookuplevel->nfc;

                        //turn inherited into arabic?
                        if (lvldata->legal && insertlevel < level)
                            nfc=0;

                        AddNumberToBullet(bullet,nfc,counters[insertlevel]);
                }
                else
                {
                        Blex::UTF8Encoder<std::back_insert_iterator<std::string> > utf8encoder(std::back_inserter(bullet));
                        utf8encoder(MapCharThroughFont(lvldata->lvltext[numberptr], font));
                }
        }
        os.Write(bullet.size(),&bullet[0]);
}

inline void FlushCharacters(OutputState &os, std::string &chars)
{
        if (!chars.empty())
        {
                os.Write(chars.size(),&chars[0]);
                chars.clear();
        }
}

bool CharacterProcessor::InsideFieldOfType(unsigned type)
{
        for (unsigned i=0;i<fieldcode_stack.size();++i)
          if (fieldcode_stack[i].type==type)
            return true;

        return false;
}

CharacterProcessor::CharacterProcessor(BiffDoc const &doc, int32_t initial_cp)
: doc(doc)
, parawalker(doc)
{
        parawalker.SetCharacter(initial_cp);
}

void CharacterProcessor::UpdateFormatting(OutputState &os, Parsers::StyleSettings const *filter)
{
        os.ApplyChp(parawalker.GetCurChp(), filter);
}

void CharacterProcessor::DoText(OutputState &os, Parsers::StyleSettings const *filter, Cp curcp, Cp limitcp)
{
//        FieldsManager::BookmarkPlacements const &marks = parawalker.doc.fieldsmgr.GetPlacedBookmarks();
//        typedef FieldsManager::BookmarkPlacements::const_iterator BookmarkCItr;

        //Current character list
        std::string chars;
        chars.reserve(limitcp - curcp);
        Blex::UTF8Encoder<std::back_insert_iterator<std::string> > utf8encoder(std::back_inserter(chars));

        //Keep track of the current link
        //(ADDME: perhaps a general 'Events' structure, in which we record at
        //        what location to do what?)
        ParaEvents::const_iterator nextevent = doc.paraevents.lower_bound(curcp);

        //ADDME: Store bookmarks as ParaData events. NOTE: We start at +1. any bookmarks at curcup should have been handled by the caller (eg to put anchors in front of bullets etc)
//        BookmarkCItr next_bookmark = marks.lower_bound(curcp+1);
//        Cp next_bookmark_cp = next_bookmark == marks.end() ? limitcp : next_bookmark->first;

                //Are we in pagebreak eating mode?
                bool eating_pagebreaks = true;

        //Loop through entire paragraph
        while (curcp < limitcp)
        {
                parawalker.SetCharacter(curcp);

                UpdateFormatting(os, filter);

                //ADDME: Filter starting, duplicate and trailing spaces
                //Loop through all characters until the next switch
                for (;curcp< parawalker.GetSwitchCp();++curcp)
                {
/*                        if (curcp >= next_bookmark_cp)
                        {
                                FlushCharacters(os, chars);
                                os.output.SetAnchor(next_bookmark->second->first);
                                next_bookmark = marks.find(curcp+1);
                                next_bookmark_cp = next_bookmark == marks.end() ? limitcp : next_bookmark->first;
                        }
  */
                        /* Handle all events at this location.. */
                        bool skipchar=false;
                        for(;nextevent != doc.paraevents.end() && nextevent->first <= curcp;++nextevent)
                          for(ParaEventPtrs::const_iterator itr2 = nextevent->second.begin(); itr2!=nextevent->second.end();++itr2)
                          {
                                //Flush all buffered characters first
                                FlushCharacters(os, chars);
                                if ((*itr2)->Execute(os.output))
                                    skipchar=true;
                          }

                        if (skipchar)
                            continue;

                        uint32_t curchar=parawalker.GetChar(curcp, false);
                        if (curchar==0) //null byte?
                            continue;

                        const Chp &chp=parawalker.GetCurChp();
                        bool is_special = chp.pod.internal_bits & Chp::Special;
                        bool is_hidden = false; //we need to leak hidden characters as long enough as possible to let PRIVATE fields reach our field decoder

                        if (chp.pod.internal_bits & Chp::Vanish //marked as hidden
                            && (!filter || !filter->ShowHiddenAnyway()))  //profile doesn't override it
                            is_hidden = true;

                        if((chp.pod.internal_bits & Chp::RMarkDel) && doc.tcmode == DocBase::TCFinal)
                            is_hidden = true;

                        if(curchar != 12)
                            eating_pagebreaks = false;

                        //Process the character
                        if (is_special)
                        {
                                //Do the special!
                                FlushCharacters(os, chars);
                                ProcessSpecial(curchar,curcp, os, is_hidden);
                                UpdateFormatting(os, filter); //reset to original formatting (we never know what we embedded..)
                                continue;
                        }

                        if (!fieldcode_stack.empty() && fieldcode_stack.back().in_code_part)
                        {
                                if (fieldcode_stack.back().code.empty() && curchar <= 32)
                                    continue;

                                Blex::UTF8Encoder<std::back_insert_iterator<std::string> > localencoder(std::back_inserter(fieldcode_stack.back().code));
                                localencoder(curchar);
                                continue;
                        }

                        if (is_hidden)
                            continue;

                        if (curchar==9) //tab to space
                           curchar=32;

                        if (curchar>=32) // Don't print specials yet..
                        {
                                utf8encoder(curchar);
                        }
                        else if (curchar == 12 && eating_pagebreaks) //pagebreak
                        {
                                                                continue;
                                                }
                        else
                        {
                                if(curcp != parawalker.GetParaLimitCp()-1 && curchar >= 11 && curchar <= 13) //cr-like char but not at paraend..
                                {
                                        /* 11: Soft break
                                           12: page break (a section end if located at a section boundary, but as sectionbound implies parabound,
                                           13 Hard paragraph end _inside_ a para?  Shouldn't happen I think, reported to be done copying Unicode text from Photoshop to Word
                                         */
                                        chars += '\n';
                                }
                        }
                }

                FlushCharacters(os, chars);
        }
}

void CharacterProcessor::ProcessSpecial(uint32_t ch, Cp cp,OutputState &os, bool is_hidden)
{
        //FormattedOutput *const output=siteoutput->GetFormattedOutput();
        if ((ch==1 || ch==8) && !(!fieldcode_stack.empty() && fieldcode_stack.back().in_code_part)) //don't render pictures inside the field code part (ADDME: We should probably split Fields and other Special handling, so that the 'skip field code' can be moved into a general section)
        {
                if (!os.output.AreImagesAccepted() || is_hidden)
                    return; //no point in doing all the hard work when images are unsupported by the output

                try
                {
                        /* If the shape is located inside a shape field, we need to ignore any floats. (appears to be so?)
                           also, these fields contain a second shape with just a pictureframe, should we ignore that one? shrug... */
                        bool inside_shape_field = InsideFieldOfType(95);

                        //anytext=true;
                        Chp const &chp=parawalker.GetCurChp();
                        if (chp.pod.internal_bits & Chp::Data)
                        {
                                //Some sort of extended field data?
                                DEBUGPRINT("Something strange with FDATA at " << chp.pod.fcPicObjTag << " and CP " << cp);
                        }
                        else if (chp.pod.internal_bits & Chp::Ole2)
                        {
                                DEBUGPRINT("OLE2 object ID " << chp.pod.fcPicObjTag << " at CP " << cp);
                                doc.Pic_OLE2(chp.pod.fcPicObjTag, os.output);
                        }
                        else if (const FileShape* fs=doc.GetShapeCp(cp))
                        {
                                DEBUGPRINT("Spid " << fs->spid << " at CP " << cp << " embedded? " << (chp.pod.internal_bits & Chp::EmbeddedObj ? 1 : 0));
                                doc.Pic_Escher(*fs, os.output, inside_shape_field);
                        }
                        else if (chp.pod.fcPicObjTag==0xFFFFFFFF)
                        {
                                DEBUGPRINT("Picture at CP " << cp << ", Office2000 position -1 (sucks) " << (chp.pod.internal_bits & Chp::EmbeddedObj ? "(also an embedded object!)" : "") );
                        }
                        else if (ch==1)      /* ADDME: Check that the datafile stream does exist*/
                        {
                                DEBUGPRINT("Picture at CP " << cp << ", data file position " << chp.pod.fcPicObjTag << " embedded? " << (chp.pod.internal_bits & Chp::EmbeddedObj));
                                doc.Pic_Pic(chp.pod.fcPicObjTag, os.output);
                        }
                        else
                        {
                                DEBUGPRINT("Cannot locate picture data for drawn object");
                        }
                }
                catch(std::exception &e)
                {
                        DEBUGPRINT("Exception handling image: " << e.what());
                }
        }
        else if (ch==19) //field code start
        {
                fieldcode_stack.push_back(FieldStack());
                fieldcode_stack.back().in_code_part=true;
                fieldcode_stack.back().type = doc.fieldsmgr.GetFieldType(cp);
        }
        else if (ch==20)
        {
                if (!fieldcode_stack.empty())
                {
                        /* ADDME: We might have to generalize this a bit, but for
                           now: If we're inside a HTML control we will not reset
                           the in_code_part flag, because we don't want to
                           render the physical HTML field data (it will contain
                           a graphic object) */
                        if (fieldcode_stack.back().type != 91) //HTML field
                            fieldcode_stack.back().in_code_part=false;
                }
        }
        else if (ch==21) //field data start, or field end
        {
                if (!fieldcode_stack.empty())
                {
                        DEBUGPRINT("Field command " << fieldcode_stack.back().code);
                        if (Blex::StrCaseLike(fieldcode_stack.back().code,"PRIVATE *")
                            || Blex::StrCaseLike(fieldcode_stack.back().code,"PRIVE *")
                            || Blex::StrCaseLike(fieldcode_stack.back().code,"PRIVATESPA *"))
                        {
                                //It's a private field!
                                std::string const &code = fieldcode_stack.back().code;
                                std::string::const_iterator datastart = std::find(code.begin(), code.end(), ' ');
                                std::string::const_iterator dataend = code.end();

                                while (datastart!=dataend && *datastart<=32)
                                    ++datastart;
                                while (datastart!=dataend && dataend[-1]<=32)
                                    --dataend;
                                doc.callbacks.PrivateFieldCallback(std::string(datastart,dataend), os.output);
                        }
                        fieldcode_stack.pop_back();
                }
        }
        else if (ch==40 && !is_hidden)
        {
                /* Undocumented Word hack: Demote symbols back to non-special characters */
                Chp const &chp = parawalker.GetCurChp();
                uint32_t ch = MapCharThroughFont(chp.pod.xchSym, doc.GetFont(chp.pod.ftcSym));

                char tempch[16]; //Enough for any UTF8-encoded character
                unsigned len = Blex::UTF8Encode(&ch, &ch + 1, (char*)&tempch[0]) - &tempch[0];
                os.Write(len,tempch);
        }
        else
        {
                DEBUGPRINT("Unprocessed special character #" << ch);
        }
}

void BiffParagraph::SendCurrentParagraph(CharacterProcessor &charproc,Parsers::FormattedOutputPtr const &output) const
{
        //charproc.parawalker.SetCharacter(localparainfo.real_paragraph->startcp);
        charproc.parawalker.SetCharacter(startcp);

        if (this->table)
        {
                //FIXME: Add top&bottom table paddings!
                SendTable(charproc,output);
                return;
        }

/*        if (localparainfo.real_paragraph->basestyle->filter)
        {
                //FilteredOutput filtered(output, *localparainfo.real_paragraph->basestyle->filter);
*/

                FilteredOutput filtered(output, *basestyle->filter);
                SendParagraphData(charproc,filtered);
/*        }
        else
        {
                SendParagraphData(charproc,output);
        }*/
}

void BiffParagraph::SendParagraphData(CharacterProcessor &charproc,Parsers::FormattedOutput &output) const
{
        //DEBUGPRINT("SendParagraph (" << localparainfo.start << "-" << localparainfo.limit << ") " << localparainfo.real_paragraph->basestyle->stylename);
        DEBUGPRINT("SendParagraph (" << startcp << "-" << limitcp << ") " << basestyle->stylename);
        OutputState os(charproc.doc, output);

        const Pap &pap=charproc.parawalker.GetParaPap();
        Parsers::ObjectType listtype = pap.GetListType();

        //FIXME: The code below is actually broken, even not considering the const-cast
        //       it assumes predefined output style IDs are transferrable between
        //       Outputs - of course, they are not (probably need a Unique ID here as well)

        /* Add the paragraph to the stylesheet, if necessary */
        ParaCharStyle *style = const_cast<ParaCharStyle *>(charproc.parawalker.GetParaPap().istd_style);
        if (style->predefined_output_style == 0) //a predefined style was not requested yet..
            style->PredefineStyle(output);

        /* Open the paragraph, and if necessary, the space for a side-by-side bullet */
        StartPara(pap, output, listtype, style);

        /* Create the bullet if necessary */
        if (listtype!=Parsers::NoList)
        {
                if (pap.listovr) //Word 97 lists..
                {
                        Chp listchp = charproc.parawalker.GetListBulletChp();
                        os.SetFormatting(listchp.font, listchp.formatted);
                        //DoBullet(os,*pap.listovr, pap.listlevel, localparainfo.real_paragraph->listcounters,*charproc.parawalker.GetListBulletChp().font);
                        DoBullet(os,*pap.listovr, pap.listlevel, listcounters, *charproc.parawalker.GetListBulletChp().font);
                }
        }

        /* Start of actual paragraph text */
        output.EnterParaText();
        //charproc.DoText(os, localparainfo.real_paragraph->basestyle->filter, localparainfo.real_paragraph->startcp, localparainfo.real_paragraph->limitcp);
        charproc.DoText(os, basestyle->filter, startcp, limitcp);
        output.EndParagraph();
}

void BiffParagraph::Send(Parsers::FormattedOutputPtr const &output) const
{
        CharacterProcessor charproc(GetBiffDoc(), startcp);
        SendCurrentParagraph(charproc,output);
}

void BiffParagraph::SendTable(CharacterProcessor &/*charproc*/, Parsers::FormattedOutputPtr const &siteoutput) const
{
        Parsers::Table tableformat = table->tableformat;
        tableformat.tablepadding.top += add_top_padding;
        tableformat.tablepadding.bottom += add_bottom_padding;

        bool tableopen = false;
        for (unsigned i=0;i<table->rows.size() && i < table->tableformat.GetRows();++i)
          for (unsigned j=0;j<table->rows[i].cells.size() && j < table->tableformat.GetColumns();++j)
        {
                TableDocPart::Cell const &cellinfo = table->rows[i].cells[j];


                if(tableformat.GetFormatting(cellinfo.offset,i).type != Parsers::Table::Data)
                    continue; //overlapped cell

                if(!tableopen)
                {
                        siteoutput->StartTable(tableformat);
                        tableopen=true;
                }
                else
                {
                        siteoutput->NextCell();
                }

                for(DocPart const *part=cellinfo.firstpart;part;part=part->next)
                  if(part->master==part)
                     part->Send(siteoutput);
        }
        if(tableopen)
            siteoutput->EndTable();
}

} // End of namespace Word
} // End of namespace Office
} // End of namespace Parsers
