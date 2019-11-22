#include <ap/libwebhare/allincludes.h>


#include <blex/utils.h>
#include <drawlib/drawlibv2/textrenderer.h>
#include "word_prescan.h"
#include "word_base.h"
#include "word_output.h"
#include "biff.h"
#include "biff_analysis.h"

#define DEBUGTABLES
//#define DEBUGPARAS
//#define DEBUGFIELDS
#define DEBUGBOOKMARKS  //Dump all bookmarks

#ifndef DEBUG
#undef DEBUGTABLES
#undef DEBUGPARAS
#endif


/* Notes of interesting things I've seen in tables..
   * Most of the border colouring options in Word 2000 are just ignored by Word 97,
     instead a lot of unknown sprms 'flash' by.
   * The left and top border of a cell seem to always take precedence over the
     formatting their left and top neighbour try to give to their right and
     bottom border, respectively.
   * To properly implement vertical and horizontal inner borders, you need to
     know whether a row is first, last, or neither. This information isn't stored
     in the sprms, but it is shown as an internal field in the TAP. We probably
     need to maintain it ourselves as well. It is hard to analyze this during
     sprm parsing, but we can do it relatively easy 'afterwards'.
*/

namespace Parsers {
namespace Office {
namespace Word {

bool IsParaEmpty(ParagraphWalker &walker, BiffParagraph const* paragraph)
{
        //Note, we expect walker to be already configured for the current paragraph..

        //Look for any viewable character inside the paragraph, taking into
        //account fields and hidden text (loop to -1, because the last char is a CR or CellEnd anyway and never interesting
        for (Cp curcp = walker.GetParaBeginCp(); curcp < walker.GetParaLimitCp()-1; ++curcp)
        {
                if (curcp == walker.GetSwitchCp()) //hit a switch position
                    walker.SetCharacter(curcp);

                uint32_t curchar=walker.GetChar(curcp, false);
                if (curchar==0) //null byte?
                    continue;

                const Chp &chp=walker.GetCurChp();
                bool is_special = chp.pod.internal_bits & Chp::Special;

                /* ADDME: If we can move 'hidden' and PRIVATE field parsing
                   to the Character walker, we might have a simplified parser here */

                if (chp.pod.internal_bits & Chp::Vanish //marked as hidden
                    && !paragraph->basestyle->filter->ShowHiddenAnyway())  //profile doesn't override it
                    continue;

                if (is_special)
                {
                        return false; //A paragraph with fields should never be discarded..
                }
                else
                {
                        if (curchar<=32 || curchar==160)
                            continue; //not a visible character
                        return false ; //had a visible character
                }
        }
        return true; //empty paragraph indeed..
}
void BiffDoc::ReadNoteSet(bool /*emptydocobjects*/, Parsers::PublicationProfile const &/*pubprof*/, Cp startoffset, bool is_footnote, Plcf const &frd, Plcf const &text)
{
        unsigned numnotes = std::min(frd.GetNumEntries(), text.GetNumEntries()-1);

        for (unsigned i=0;i<numnotes;++i)
        {
                Cp startcp = startoffset + text.GetEntryOffset(i);
                Cp limitcp = startoffset + text.GetEntryOffset(i+1);
                Cp location = frd.GetEntryOffset(i);

                DEBUGPRINT("Note " << i << " at cp " << location << " (" << startcp << "-" << limitcp << ") " << GetText(startcp,std::min(startcp+50,limitcp)));

                //Scan the contents
                //ScanParagraphs(startcp, limitcp);

                //Create an event
                paraevents[location].push_back(ParaEventPtr(new FootEndNoteEvent(*this, is_footnote, startcp,limitcp)) );
        }
}

void BiffDoc::ReadFootEndNotes(bool emptydocobjects, Parsers::PublicationProfile const &pubprof)
{
        DEBUGPRINT("- Footnotes -");
        Plcf footnotes_frd_plcf(*tablefile,header.OffsetFootnoteFRDs(),header.LengthFootnoteFRDs(),6,true);
        Plcf footnotes_text_plcf(*tablefile,header.OffsetFootnoteTexts(),header.LengthFootnoteTexts(),4,true);
        ReadNoteSet(emptydocobjects,pubprof,header.FootnoteDocStart(), true, footnotes_frd_plcf, footnotes_text_plcf);

        DEBUGPRINT("- Endnotes -");
        Plcf endnotes_frd_plcf(*tablefile,header.OffsetEndnoteFRDs(),header.LengthEndnoteFRDs(),6,true);
        Plcf endnotes_text_plcf(*tablefile,header.OffsetEndnoteTexts(),header.LengthEndnoteTexts(),4,true);
        ReadNoteSet(emptydocobjects,pubprof,header.EndnoteDocStart(), false, endnotes_frd_plcf, endnotes_text_plcf);
}

void AddEscherFormatting(Chp const &chp, Pap const &pap, bool start_of_line, DrawLib::TextFormatter *textformatter)
{
        if (start_of_line)
        {
                textformatter->SetAlignment((unsigned)pap.formatted.jc);
        }

        float pixelsize = (chp.formatted.font_halfpoint_size / 2.0) * (4.0/3.0); //4/3 is point-to-pixel factor

        textformatter->SetMode(0); // Set Word mode
        textformatter->ResetFontSettings();
        textformatter->SetFontFace(chp.formatted.fonttype->font_face);
        textformatter->SetFontSize(DrawLib::FPSize(pixelsize,pixelsize));
        textformatter->SetFontColor(chp.formatted.foreground_color);
        textformatter->SetBold(chp.formatted.format_bits & Parsers::Character::Bold);
        textformatter->SetItalics(chp.formatted.format_bits & Parsers::Character::Italic);
        textformatter->SetUnderline(chp.formatted.underlining != Parsers::Character::NoUnderline);
}

/* ADDME: Share code with GetTexAsString
   ADDME: this is not a prescan function - it shouldn't be here!
   ADDME: Even better would be to have a Parsers* that wraps a TextRender, to also allow GetRawText etc to be implemented by just using a dummy output catching text. Perhaps we can even integrate ALL rendering code into a single function */
void BiffDoc::RenderText(Cp cp, Cp limit_cp, DrawLib::TextFormatter *textformatter) const
{
        //ADDME: We could create 'cleaner' code, less redundancy etc, by only
        //       writing out the differences (But for now, we don't care)
        std::string data;
        bool infield=false;
        Blex::UTF8Encoder<std::back_insert_iterator<std::string> > data_utf8_encoder(std::back_inserter(data));

        ParagraphWalker walker(*this);

        /* Walk through data and further paragraphs */
        while (cp<limit_cp)
        {
                /* Set up formatting, if necessary */
                walker.SetCharacter(cp);
                AddEscherFormatting(walker.GetCurChp(), walker.GetParaPap(), true, textformatter);

                /* And read the text! */
                for (;cp < walker.GetParaLimitCp() && cp < limit_cp;++cp)
                {
                        if (cp >= walker.GetSwitchCp())
                        {
                                //Flush formatting
                                textformatter->ParseText(&data[0], &data[data.size()]);
                                data.clear();

                                //Set up formatting
                                walker.SetCharacter(cp);
                                AddEscherFormatting(walker.GetCurChp(), walker.GetParaPap(), false, textformatter);
                        }

                        uint16_t curchar=walker.GetChar(cp, false);

                        if (walker.GetCurChp().pod.internal_bits & Chp::Vanish)
                            continue;

                        if (walker.GetCurChp().pod.internal_bits & Chp::Special)
                        {
                                if (curchar==19)
                                    infield=true;
                                if (curchar==20 || curchar==21)
                                    infield=false;
                                continue;
                        }

                        if (curchar>=32 && !infield)
                            data_utf8_encoder(curchar);
                        //ADDME: Transalte other special stuff (eg SoftCR)
                }

                //Flush formatting
                textformatter->ParseText(&data[0], &data[data.size()]);
                textformatter->EndParagraph();
                data.clear();
        }
}
                                 /*
void BiffDoc::AddRecommendedAnchors()
{
        FieldsManager::BookmarkPlacements const &marks = fieldsmgr.GetPlacedBookmarks();

        for (OutputObjects::iterator itr = outputobjects.begin(); itr!=outputobjects.end(); ++itr)
        {
                OutputObject &obj = *itr->second;
                if (obj.parainfo.toclevel==0 && !obj.parainfo.splitfilter)
                    continue; //not an interesting paragraph
                if (marks.lower_bound(obj.parainfo.start) != marks.lower_bound(obj.parainfo.limit))
                    continue; //already has an anchor

                //This paragraph has no anchor, but is interesting enough that someone might want to link it. Force it to have an anchor
                fieldsmgr.GenerateAnchor(obj.parainfo.real_paragraph->startcp);
        }
}                                  */

FootEndNoteEvent::FootEndNoteEvent(BiffDoc &doc, bool is_foot_note, Cp startcp, Cp endcp)
: doc(doc)
, is_footnote(is_foot_note)
, startcp(startcp)
, limitcp(endcp)
{
}
bool FootEndNoteEvent::Execute(FormattedOutput &/*output*/)
{
//FIXME        doc.callbacks.FoundFootEndNote(is_footnote, doc.outputobjects.upper_bound(startcp), doc.outputobjects.upper_bound(limitcp), output);
        return true;
}



} // End of namespace Word
} // End of namespace Office
} // End of namespace Parsers
