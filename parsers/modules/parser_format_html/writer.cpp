#include <ap/libwebhare/allincludes.h>


#include <blex/utils.h>
#include <iomanip>
#include <numeric>
#include <parsers/base/parserinterface.h>
#include <parsers/base/xmlformats.h>
#include "writer.h"
#include "rendering.h"
#include <harescript/vm/hsvm_context.h>

/* ADDME: We should use the same facilities strings.h HTMLENCODE does. We have
          better HTML encoding than that function */

namespace Parsers {
namespace Formats {
namespace XML {

using namespace Parsers;

const unsigned SupportedFormattingBits = Parsers::Character::Bold
                                         | Parsers::Character::Shadow
                                         | Parsers::Character::Italic
                                         | Parsers::Character::Strikethrough
                                         | Parsers::Character::DoubleStrike
                                         | Parsers::Character::Overline
                                         | Parsers::Character::Insertion
                                         | Parsers::Character::Deletion
                                         ;

/* Simple CSS properties: print the enable if toggled on, print the disable if toggled off */
inline void SimpleCSSBitProperty(Parsers::Character const &src,Parsers::Character const &dest,std::string *style, unsigned whichbit, char const *turn_on, char const *turn_off, bool in_stylesheet)
{
        if (in_stylesheet || (src.format_bits ^ dest.format_bits) & whichbit)
        {
                *style += (dest.format_bits & whichbit ? turn_on : turn_off);
        }
}

void AddToStyle(std::string &str, const char *attrname, std::string const &invalue)
{
        str += attrname;
        str += ":";
        str.insert(str.end(), invalue.begin(), invalue.end());
        str += ";";
}

void GenerateCharStyle(Parsers::Character const &src,
                                Parsers::Character const &dest,
                                std::string *style,
                                bool suppress_underline_foreground,
                                bool in_stylesheet,
                                unsigned basefontsize)
{
        if (in_stylesheet
            || (src.fonttype != dest.fonttype
                && dest.fonttype
                && (!src.fonttype || src.fonttype->font_face != dest.fonttype->font_face)
           ) )
        {
                AddToStyle(*style,"font-family",dest.fonttype->font_face);
        }

        if (in_stylesheet || src.font_halfpoint_size != dest.font_halfpoint_size)
        {
                if (basefontsize)
                {
                        unsigned percentage;
                        if (in_stylesheet || !src.font_halfpoint_size)
                            percentage = (dest.font_halfpoint_size * 50) / basefontsize;
                        else
                            percentage = (dest.font_halfpoint_size * 100) / src.font_halfpoint_size;

                        EncodePercentageStyle(*style,"font-size",percentage);
                }
                else
                {
                        char buf[36];
                        char *endbuf = Blex::EncodeNumber(dest.font_halfpoint_size/2, 10, buf);
                        if (dest.font_halfpoint_size%2)
                            (*endbuf++='.'), (*endbuf++='5');
                        *endbuf++='p';
                        *endbuf++='t';
                        *endbuf++=0;
                        AddToStyle(*style,"font-size",buf);
                }
        }

        if (in_stylesheet ||
            (!suppress_underline_foreground //don't touch colour on a hyperlink!
             && src.foreground_color != dest.foreground_color))
            EncodeColorStyle(*style, "color", dest.foreground_color);

        if ((in_stylesheet || src.background_color != dest.background_color)
            && !dest.background_color.IsFullyTransparent())
            EncodeColorStyle(*style, "background-color", dest.background_color);

        //Currently ignoring: Emboss, Outline, Imprint
        SimpleCSSBitProperty(src,dest,style,Parsers::Character::Bold,"font-weight:bold;","font-weight:normal;",in_stylesheet);
        SimpleCSSBitProperty(src,dest,style,Parsers::Character::Shadow,"text-shadow:2pt 2pt #808080;","text-shadow:none;",in_stylesheet);
        SimpleCSSBitProperty(src,dest,style,Parsers::Character::Italic,"font-style:italic;","font-style:normal;",in_stylesheet);

        //Update text decoration?
        if (!suppress_underline_foreground || in_stylesheet)
        {
                const unsigned StrikeBits = Parsers::Character::Strikethrough
                                            | Parsers::Character::DoubleStrike;
                const unsigned TextDecorationBits = StrikeBits
                                                    | Parsers::Character::Overline;

                if (in_stylesheet
                    || src.underlining != dest.underlining
                    || (src.format_bits ^ dest.format_bits) & TextDecorationBits)
                {
                        *style += "text-decoration:";

                        bool turned_all_off = in_stylesheet
                                            || (src.underlining != dest.underlining && src.underlining != Parsers::Character::NoUnderline)
                                            || ((src.format_bits ^ dest.format_bits) & TextDecorationBits && src.format_bits & TextDecorationBits);

                        if (turned_all_off)
                            *style += "none";
                        if ((src.underlining!=dest.underlining || turned_all_off)
                            && dest.underlining!=Parsers::Character::NoUnderline)
                            *style += " underline";
                        if ( ( !(src.format_bits & StrikeBits) || turned_all_off)
                             && dest.format_bits & StrikeBits)
                            *style += " line-through";
                        if ( ( !(src.format_bits & Parsers::Character::Overline) || turned_all_off)
                             && dest.format_bits & Parsers::Character::Overline)
                            *style += " overline";

                        *style += ";";
                }
        }
}

void HTML_StyleTextAlign(std::string &tags, Parsers::HorizontalAlignment jc)
{
        switch (jc)
        {
                case Parsers::Left:      tags += "text-align:left;"; break;
                case Parsers::Right:     tags += "text-align:right;"; break;
                case Parsers::Center:    tags += "text-align:center;"; break;
                case Parsers::Justified: tags += "text-align:justify;"; break;
        }
}



HtmlOutput::HtmlOutput(HSVM *vm, int32_t outputfile, HtmlWriter &_writer)
: cellsize(0)
, have_hyperlink(false)
, bgcolor(_writer.GetPreferences().bgcolor)
, languagecode(_writer.GetPreferences().languagecode)
, htmlwriter(_writer)
, render(new TagRendering(vm, outputfile, _writer.standard, _writer.strict)) //FIXME unclean to have two different routes to associating with a vm - this plus RegisterOutput
{
        suppressed_div_enter=false;
        parastack.push(ParaState(standard_style, Parsers::Paragraph(), Parsers::NoList));
}

HtmlOutput::~HtmlOutput()
{
        delete render;
}

unsigned HtmlOutput::GetMaximumImageWidth()
{
        int32_t maximagesize = cellsize;
        if (maximagesize>0) // subtract margins, if necessary
        {
                maximagesize -= TwipsToPixels(CurParaState().padding.left + CurParaState().padding.right);
                if (maximagesize <= 0)
                    maximagesize = 1;
        }
        return maximagesize;
}


/* The general tricks are:
   * Side by side bullets: we open two table cells.
     The bullet goes into the left cell, the text into the right cell.
     To get horizontal alignment right, we do the left indent in the
     bullet's cell, and the right indent in the text cell.
   * Inline bullets: ADDME
*/

std::string GetParagraphTag(unsigned headinglevel)
{
        switch(headinglevel)
        {
        case 1: return "h1";
        case 2: return "h2";
        case 3: return "h3";
        case 4: return "h4";
        case 5: return "h5";
        case 6: return "h6";
        default: return "p";
        }
}

void HtmlOutput::BuildParaOpen(ParaOpenStyles openstyle, unsigned minimumwidth)
{
        Parsers::Paragraph const &basestate = BaseParaState();

        if (htmlwriter.standard < HTML4)
        {
                if (openstyle == OutsideSidebyside)
                {
                        switch (CurParaState().jc)
                        {
                        case Parsers::Right:
                                render->tags += "<" + GetParagraphTag(CurParaState().headinglevel) + " align=\"right\">"; break;
                        case Parsers::Center:
                                render->tags += "<" + GetParagraphTag(CurParaState().headinglevel) + " align=\"center\">"; break;
                        default:
                                if (CurParaState().padding.top)
                                    render->tags += "<br>";
//                                if (CurParaState().bottom_padding)
//                                    render->tags += "<p>"; break;
                                ;
                        }
                }
                return;
        }

        /* ADDME: - add paragraph background_colors
                  - for NS4: add border:none
                  - ensure that character background_colors are NOT added
                    to the P's STYLE= */

        Parsers::Distance finalpadding = CurParaState().padding;
        signed text_indent = 0;
        switch(openstyle)
        {
        case SidebysideLeft:
                finalpadding.left=0;
                finalpadding.right=0;
                text_indent = CurParaState().padding.left + CurParaState().first_indent;
                break;
        case SidebysideRight:
                finalpadding.left=0;
                break;
        case OutsideSidebyside:
                text_indent = CurParaState().first_indent;
                break;
        }

        std::string style;
        render->tags += "<" + GetParagraphTag(openstyle!=SidebysideLeft ? CurParaState().headinglevel : 0);

        if (htmlwriter.cssclasses && !BaseParaStyle().name.empty()) //link to the stylesheet
            EncodeValueAttribute(render->tags, "class", BaseParaStyle().name);

        if (!htmlwriter.stylesheet || BaseParaStyle().name.empty())
            AddToStyle(style, "margin", "0"); //make sure default P margins are supressed

        if (basestate.jc != CurParaState().jc)
            HTML_StyleTextAlign(style, CurParaState().jc);

        if (basestate.first_indent != text_indent)
            EncodePoints100Style(style,"text-indent",TwipsToPoints100( std::max(-int(finalpadding.left),text_indent) ));

        if (minimumwidth)
            EncodePoints100Style(style,"width",TwipsToPoints100(minimumwidth));

        EncodePaddingStyle(style, basestate.padding, finalpadding);

        if (!style.empty())
            EncodeValueAttribute(render->tags, "style", style);

        //ADDME: This sometimes causes immediate language switching, but only when users are intentionally uploading wrongly-languaged docs. Nevertheless, the new HTML render may be able to take care of this?
        if (!languagecode.empty() && !BaseCharState().languagecode.empty() && BaseCharState().languagecode != languagecode)
            EncodeValueAttribute(render->tags, "lang", BaseCharState().languagecode.empty() ? std::string("unknown") : BaseCharState().languagecode);

        render->tags += ">";
}

void HtmlOutput::SetAnchor(std::string const &anchor)
{
        render->tags += "<a name=\"" + anchor + "\"></a>";
}

void HtmlOutput::StartParagraph(int32_t predefstyleid,
                                         Parsers::Paragraph const &format_para,
                                         Parsers::ObjectType listtype)
{
        Parsers::PredefinedStyle const *style;

        if (!htmlwriter.cssclasses || predefstyleid <= 0 || uint32_t(predefstyleid) > htmlwriter.predefinedstyles.size())
            style=&standard_style;
        else
            style=&htmlwriter.predefinedstyles[predefstyleid-1];

        parastack.push(ParaState(*style,format_para,listtype));
        any_paragraph=true;

        if (suppressed_div_enter)
        {
                render->Indent(0);
                suppressed_div_enter=false;
        }

        if (listtype==Parsers::SidebysideBullet)
        {
                //Record these, because they may have been overwritten by override_filter
                //and they will become invisible with the next parastack.push
                unsigned width = std::max(unsigned(-CurParaState().first_indent),CurParaState().padding.left);

                parastack.push(ParaState(standard_style,format_para,listtype));

                //width:100% is required to prevent text from disappearing with other text-aligns that 'left' (NS4, IE5.* issue)
                render->OpenTable(0, 0, -100, /*cellpadding=*/0, false, Parsers::Left);
                render->OpenTr();
                render->OpenTd(0, TwipsToPixels(width), 1, 1,
                               true, DrawLib::Pixel32(),
                               Parsers::Table::BorderType(), Parsers::Table::BorderType(),
                               Parsers::Table::BorderType(), Parsers::Table::BorderType(),
                               true, Parsers::Top,
                               Nowrap, false, Parsers::Distance());

                BuildParaOpen(SidebysideLeft, /*width - BREAKS outline rendering (see ubertest)*/0);
        }
        else
        {
                BuildParaOpen(OutsideSidebyside, 0);
        }

        render->FlushTags();
        any_nonspace=false;
}

void HtmlOutput::EnterParaText()
{
        if (parastack.top().listtype==Parsers::SidebysideBullet)
        {
                GenerateCloseTags(true);
                if (htmlwriter.standard >= HTML4)
                    render->tags += "</" + GetParagraphTag(0) + ">"; //sidebyside always has type 0 for the bullet paragraph
                render->CloseTd(false);
                render->OpenTd(0,/*width=*/-100,/*colspan=*/1,/*rowspan=*/1,
                               /*transparent_bg=*/true,/*bg=*/DrawLib::Pixel32(),
                               /*border-top=*/Parsers::Table::BorderType(),
                               /*border-right=*/Parsers::Table::BorderType(),
                               /*border-bottom=*/Parsers::Table::BorderType(),
                               /*border-left=*/Parsers::Table::BorderType(),
                               /*set_valign=*/true, /*valign=*/Parsers::Top,
                               /*wrap=*/Wrap, false, Parsers::Distance());
                parastack.pop(); //get rid of the side-by-side style

                BuildParaOpen(SidebysideRight, 0);
        }
        else if (parastack.top().listtype==Parsers::InlineBullet)
        {
                render->tags += " "; //FIXME: Create the 'proper' amount of spaces
        }
        render->FlushTags();
}

/** End the last started paragraph */
void HtmlOutput::EndParagraph()
{
        GenerateCloseTags(true);

        /* Browser issue: empty paragraphs should have a nbsp in them to be visible */
        if (!any_nonspace)
            render->tags += ( htmlwriter.standard >= XHTML ? "&#160;" : "&nbsp;" );

        if (htmlwriter.standard >= HTML4)
        {
                render->tags += "</" + GetParagraphTag(CurParaState().headinglevel) + ">";
        }
        else
        {
                //HTML3.2 Close para only when not creating a side-by-side bullet
                if (parastack.top().listtype!=Parsers::SidebysideBullet
                    && (CurParaState().jc == Parsers::Right || CurParaState().jc == Parsers::Center /*|| CurParaState().padding.bottom*/))
                {
                        render->tags += "</" + GetParagraphTag(CurParaState().headinglevel) + ">";
                }
                else
                {
                        render->tags += "<br>";
                        if (CurParaState().padding.bottom)
                            render->tags += "<br>";
                }
        }

        if (parastack.top().listtype==Parsers::SidebysideBullet)
        {
                render->CloseTd(false);
                render->CloseTr();
                render->CloseTable();
        }

        suppressed_div_enter=true;
        render->FlushTags();
        parastack.pop();
}

void HtmlOutput::UpdateCharacterFormatting()
{
        if (parastack.empty())
            return; //without any open paragraphs, there is no formatting to update (insertimage call by IndexObject)

        bool link_was_open = have_hyperlink;
        bool link_now_open = parastack.top().want_hyperlink;
        bool link_changed = link_was_open != link_now_open || (link_now_open && opened_link != parastack.top().requested_hyperlink);
        bool language_changed = !languagecode.empty() && CurActualState().languagecode != CurOfficialState().languagecode;
        bool language_must_open = !languagecode.empty() && BaseCharState().languagecode != CurOfficialState().languagecode;
        bool no_foreground_underline = link_now_open && htmlwriter.GetPreferences().suppress_hyperlink_formatting;

        if (!link_changed
            && CurActualState().font_halfpoint_size == CurOfficialState().font_halfpoint_size
            && CurActualState().fonttype == CurOfficialState().fonttype
            && CurActualState().background_color == CurOfficialState().background_color
            && ((CurActualState().format_bits ^ CurOfficialState().format_bits) & SupportedFormattingBits) == 0
            && CurActualState().subsuper == CurOfficialState().subsuper
            && (no_foreground_underline || CurActualState().foreground_color == CurOfficialState().foreground_color) //ignore foreground colour changes inside hyperlinks
            && (no_foreground_underline || CurActualState().underlining == CurOfficialState().underlining) //ignore underline inside hyperlinks
            && !language_changed)
            return;

        GenerateCloseTags(link_changed);

        if (link_changed && link_now_open)
        {
                render->FlushTags();
                HyperlinkHandler(true, parastack.top().requested_hyperlink);
                have_hyperlink=true;
                opened_link=parastack.top().requested_hyperlink;
        }

        if (CurOfficialState().format_bits & Parsers::Character::Insertion)
        {
                render->tags += "<ins>";
                parastack.top().ins_open=true;
        }
        if (CurOfficialState().format_bits & Parsers::Character::Deletion)
        {
                render->tags += "<del>";
                parastack.top().del_open=true;
        }

        if (htmlwriter.standard < HTML4)
        {
                signed fontsize = ((signed)(CurOfficialState().font_halfpoint_size/2) - (signed)htmlwriter.GetPreferences().basefontsize) / 2;

                if (!htmlwriter.strict
                    || (!no_foreground_underline && BaseCharState().foreground_color != CurOfficialState().foreground_color)
                    || fontsize != 0)
                {
                        render->tags += "<font";

                        if (!htmlwriter.strict) //face is not part of 3.2
                            EncodeValueAttribute(render->tags, "face", CurOfficialState().fonttype->font_face);

                        if (!htmlwriter.GetPreferences().suppress_hyperlink_formatting && CurOfficialState().foreground_color != BaseCharState().foreground_color)
                            EncodeColorAttribute(render->tags, "color", CurOfficialState().foreground_color);

                        if (fontsize != 0)
                        {
                                static const char *sizes[]={"-3","-2","-1","+0","+1","+2","+3"};
                                const char *whichsize = sizes[Blex::Bound(-3,3,fontsize) + 3];
                                EncodeValueAttribute(render->tags,"size",whichsize);
                        }
                        render->tags += ">";

                        parastack.top().font_open=true;
                }
        }

        Parsers::Character basestate = BaseCharState();
        if(htmlwriter.standard < HTML4 || !htmlwriter.strict)
        {
                if (CurOfficialState().format_bits & Parsers::Character::Bold && (htmlwriter.standard < HTML4 || !(basestate.format_bits & Parsers::Character::Bold)))
                {
                        render->tags+="<b>";
                        parastack.top().b_open=true;
                        basestate.format_bits |= Parsers::Character::Bold;
                }
                if (CurOfficialState().format_bits & Parsers::Character::Italic && (htmlwriter.standard < HTML4 || !(basestate.format_bits & Parsers::Character::Italic)))
                {
                        render->tags+="<i>";
                        parastack.top().i_open=true;
                        basestate.format_bits |= Parsers::Character::Italic;
                }
                bool set_underline = CurOfficialState().underlining != Parsers::Character::NoUnderline && !htmlwriter.GetPreferences().suppress_hyperlink_formatting;
                if(set_underline && (htmlwriter.standard < HTML4 || basestate.underlining == Parsers::Character::NoUnderline))
                {
                        render->tags+="<u>";
                        parastack.top().u_open=true;
                        basestate.underlining = CurOfficialState().underlining;
                }
        }
        if (htmlwriter.standard >= HTML4)
        {
                std::string newtags;

                if (link_now_open)
                {
                        //FIXME: A hack, try to ensure that the foreground color and hyperlink colors get overwritten if possible
                        basestate.foreground_color = DrawLib::Pixel32(0xDE,0xAD,0xBE,0xEF);
                        basestate.underlining = (Parsers::Character::Underlines)0xDEADBEEF;
                }

                GenerateCharStyle(basestate,CurOfficialState(),&newtags,no_foreground_underline,false,htmlwriter.GetPreferences().basefontsize);
                if (!newtags.empty() || language_must_open)
                {
                        render->tags += "<span";
                        if (!newtags.empty())
                            EncodeValueAttribute(render->tags, "style", newtags);
                        if (language_must_open)
                            EncodeValueAttribute(render->tags, "lang", CurOfficialState().languagecode);
                        render->tags += ">";

                        parastack.top().span_open=true;
                }
        }
        if (CurOfficialState().subsuper == Parsers::Character::SubScript)
        {
                render->tags += "<sub>";
                parastack.top().sub_open=true;
        }
        else if (CurOfficialState().subsuper == Parsers::Character::SuperScript)
        {
                render->tags += "<sup>";
                parastack.top().super_open=true;
        }

        render->FlushTags();
        CurActualState()=CurOfficialState();
}

/** Change the character formatting */
void HtmlOutput::ChangeFormatting(Parsers::Character const &formatted)
{
        parastack.top().requested_format_char = formatted;
}

void HtmlOutput::WriteString (unsigned size, char const *chars)
{
        UpdateCharacterFormatting();

        if (!any_nonspace) //still need to find any non-spaces
        {
                for (unsigned pos=0;pos<size && !any_nonspace;++pos)
                  if (chars[pos]!=32)
                    any_nonspace=true;
        }

        bool small_tag_open=false;
        static const char smallopen[]="<small>";
        static const char smallclose[]="</small>";

        std::vector<char> data_to_write;
        data_to_write.reserve(size);

        Blex::UTF8DecodeMachine decoder;
        for (;size>0;--size,++chars)
        {
                //Pop a character
                uint32_t curch = decoder(*chars);
                if (curch == Blex::UTF8DecodeMachine::NoChar || curch == Blex::UTF8DecodeMachine::InvalidChar)
                    continue;

                /* Rewrite special characters
                if (Blex::IsPrivateRangeUnicode(curch)) //private use range
                {
                        if(curch==Parsers::Characters::SymbolBullet) //unicode 8226 with 60% boost
                        {
                                static const char bullet[]="<span style=\"font-size:160%;position:absolute;vertical-align:middle;\">&#8226;</span>&nbsp;";
                                data_to_write.insert(data_to_write.end(), bullet, bullet + sizeof bullet - 1);
                        }
                        continue;
                }
                */

                //Handle smallcaps open/close (ADDME: see if this can be replaced by text-variant: small-cpas)
                if (CurOfficialState().format_bits & Parsers::Character::Smallcaps)
                {
                        if (Blex::IsLower(curch))
                        {
                                if (!small_tag_open)
                                {
                                        data_to_write.insert(data_to_write.end(), smallopen, smallopen + sizeof smallopen - 1);
                                        small_tag_open=true;
                                }
                                curch=Blex::ToUpper(curch);
                        }
                        else
                        {
                                if (small_tag_open)
                                {
                                        data_to_write.insert(data_to_write.end(), smallclose, smallclose + sizeof smallclose - 1);
                                        small_tag_open=false;
                                }
                        }
                }

                //Write the characters themselves
                if (curch>=32 && curch<128 && curch!='&' && curch!='<' && curch!='>')
                {
                        data_to_write.push_back(curch);
                        continue;
                }

                if (curch=='\r') //skip CRs
                    continue;

                if (curch=='\n')
                {
                        static const char br_tag[]="<br />";
                        data_to_write.insert(data_to_write.end(), br_tag, br_tag + sizeof br_tag - 1);
                        continue;
                }

                //ADDME: Optimize using a temp char buffer for single pass write and no insert iterator creation
                data_to_write.push_back('&');
                data_to_write.push_back('#');
                Blex::EncodeNumber(curch,10,std::back_inserter(data_to_write));
                data_to_write.push_back(';');
        }

        if (small_tag_open)
            data_to_write.insert(data_to_write.end(), smallclose, smallclose + sizeof smallclose - 1);


        UpdateCharacterFormatting(); //flush any pending data
        render->RawWrite(data_to_write.size(),&data_to_write[0]);
}

////////////////////////////////////////////////////////////////////////////////
//
// Table handling
//
HtmlOutput::TableState::TableState(Parsers::Table const &_table, bool const _prettyborders)
: table(_table)
, gridrow(0)
, prettyborders(_prettyborders)
{
        //EliminateDeadColumns(); // dit werkt nu niet, want hij haalt ook de kolom daadwerkelijk weg van de tabel zodat bij overlapped cells de overlapping cells daadwerkelijk ruimte verliezen
        SetWidthRows();

        columnwidths.resize(table.GetColumns(),0);
        maxcolumnwidths.resize(table.GetColumns(),0);
        rowborderwidths_twips.resize(table.GetRows() + 1,0);
        columnborderwidths_twips.resize(table.GetColumns() + 1,0);
}

void HtmlOutput::TableState::CalculateBorderWidths()
{
        //Calculate maximum border widths
        for (unsigned x=0; x<table.GetColumns()+1; ++x)
          for (unsigned y=0; y<table.GetRows()+1; ++y)
        {
                unsigned rowborder = table.GetFormatting(x,y).top.thickness_twips;
                if(y > 0)
                    rowborder = std::max(rowborder, table.GetFormatting(x,y-1).bottom.thickness_twips);

                unsigned colborder = table.GetFormatting(x,y).left.thickness_twips;
                if(x > 0)
                    colborder = std::max(colborder, table.GetFormatting(x-1,y).right.thickness_twips);

                rowborderwidths_twips[y] = std::max(rowborderwidths_twips[y], rowborder);
                columnborderwidths_twips[x] = std::max(columnborderwidths_twips[x], colborder);
        }
        /*

        //Reduce all thickness_twips-es back to one, because we don't have satisfying
        //support for varying thickness_twips in a table border yet
        for (unsigned y=0; y<table.GetRows()+1; ++y)
            rowborderwidths[y] = std::min(1u,rowborderwidths[y]);
        for (unsigned x=0; x<table.GetColumns()+1; ++x)
            columnborderwidths[x] = std::min(1u,columnborderwidths[x]);
        */
}

void HtmlOutput::TableState::MaximiseTableBorders(unsigned bordersize, bool is_minimum)
{
        for (unsigned y=0;y<=table.GetRows();++y)
          for (unsigned x=0;x<=table.GetColumns();++x)
        {
                Parsers::Table::CellFormatting &format=table.GetFormatting(x,y);
                if (format.top.thickness_twips > 0 && (is_minimum || format.top.thickness_twips > bordersize))
                    format.top.thickness_twips = bordersize;
                if (format.bottom.thickness_twips > 0 && (is_minimum || format.bottom.thickness_twips > bordersize))
                    format.bottom.thickness_twips = bordersize;
                if (format.left.thickness_twips > 0 && (is_minimum || format.left.thickness_twips > bordersize))
                    format.left.thickness_twips = bordersize;
                if (format.right.thickness_twips > 0 && (is_minimum || format.right.thickness_twips > bordersize))
                    format.right.thickness_twips = bordersize;
        }
}

void HtmlOutput::TableState::SetTableBorderColours(DrawLib::Pixel32 newcolor)
{
        for (unsigned y=0;y<=table.GetRows();++y)
          for (unsigned x=0;x<=table.GetColumns();++x)
        {
                Parsers::Table::CellFormatting &format=table.GetFormatting(x,y);
                if (format.top.thickness_twips > 0)
                {
                        format.top.color = newcolor;
                }
                if (format.left.thickness_twips > 0)
                {
                        format.left.color = newcolor;
                }
        }
}

void HtmlOutput::TableState::ScaleTable()
{
        //FIXME: Rescale cellspacing

        if (table.tablewidth<0)
        {
                //Rescale everything to 100 percent
                signed totalsize = std::accumulate(table.cellwidths.begin(), table.cellwidths.end(), 0);

                for (unsigned i=0;i<table.GetColumns();++i)
                    columnwidths[i] = - std::max(1, (table.cellwidths[i] * 100) / totalsize);
        }
        else
        {
                //Scale and calculate all cell widths
                //Make sure that ALL cells are at least one pixel wide
                for (unsigned i=0;i<table.GetColumns();++i)
                    columnwidths[i] = std::max(1,TwipsToPixels(table.cellwidths[i]));
        }
}

unsigned HtmlOutput::TableState::GetHighestBorderWidth()
{
        return TwipsToPixels(
                          std::max( *std::max_element(columnborderwidths_twips.begin(),columnborderwidths_twips.end()),
                         *std::max_element(rowborderwidths_twips.begin(),rowborderwidths_twips.end())) );
}

void HtmlOutput::TableState::CalculateMaximumWidths(unsigned forcedsize)
{
        unsigned totalsize = std::accumulate(table.cellwidths.begin(), table.cellwidths.end(), 0);

        //Subtract borders, if we have to
        if (prettyborders)
        {
                unsigned bordersize = TwipsToPixels(std::accumulate(columnborderwidths_twips.begin(), columnborderwidths_twips.end(), 0));
                if (forcedsize > bordersize)
                    forcedsize -= bordersize;
                else
                    forcedsize = 0;
        }
        if (totalsize < 1)
            totalsize=1;

        //Make sure there is room for all the cells (prevent the last loop in this function from becoming endless!)
        forcedsize = std::max(forcedsize, table.GetColumns());

        //Scale and calculate all cell widths
        for (unsigned i=0;i<table.GetColumns();++i)
            maxcolumnwidths[i] = (table.cellwidths[i] * forcedsize) / totalsize;

        //Make sure that ALL cells are at least one pixel wide
        for (unsigned i=0;i<table.GetColumns();++i)
          if (maxcolumnwidths[i] == 0)
            maxcolumnwidths[i] += 1;

        //How much does the total table size differ from its forced size?
        unsigned newtotalsize = std::accumulate(maxcolumnwidths.begin(), maxcolumnwidths.end(), 0);
        signed difference = (signed)newtotalsize - (signed)forcedsize;

        //Distribute the difference amongst the cells
        while (difference != 0)
        {
                for (unsigned i=0; i<table.GetColumns();++i)
                  if (maxcolumnwidths[i] > 1 && difference)
                {
                        signed update = difference>0 ? -1 : 1;
                        maxcolumnwidths[i] += update;
                        difference += update;
                }
        }
}

void HtmlOutput::TableState::EliminateDeadColumns()
{
        std::vector<bool> columns_has_data(table.GetColumns(), false);

        for (unsigned row=0;row<table.GetRows();++row)
          for (unsigned col=0;col<table.GetColumns();++col)
        {
                if(table.GetFormatting(col,row).type == Parsers::Table::Data)
                    columns_has_data[col]=true;
        }

        //Handle evil columns
        for(unsigned col=table.GetColumns();col>0;--col)
        {
                unsigned realcolnum=col-1;
                if(!columns_has_data[realcolnum])
                {
                        DEBUGPRINT("Eliminate column " << realcolnum);
                        table.DeleteColumn(realcolnum);
                }
        }
}

void HtmlOutput::TableState::SetWidthRows()
{
        //Set up all widths to the max# of rows
        set_width_rows.resize(table.GetColumns(), table.GetRows());

        for (unsigned row=0;row<table.GetRows();++row)
          for (unsigned col=0;col<table.GetColumns();++col)
        {
                Table::CellFormatting &cf = table.GetFormatting(col,row);
                if(cf.type == Table::Data && cf.colspan==1 && set_width_rows[col]==table.GetRows())
                    set_width_rows[col]=row;
        }

        for (unsigned col=0;col<table.GetColumns();++col)
          if(set_width_rows[col]==table.GetRows())
          {
                DEBUGPRINT("Column " << col << " has no unambiguous data cells to set a width on");
                //Any Open cells to take up this role?
                for (unsigned row=0;row<table.GetRows();++row)
                  if(table.GetFormatting(col,row).type == Table::Open)
                  {
                        DEBUGPRINT("Row " << row << " in this column has an Open cell which will do");
                        set_width_rows[col] = row;
                        break;
                  }
          }
}

void HtmlOutput::StartTable(Parsers::Table const &_tableformat)
{
        ///Create a local copy of the table data
        tablestack.push( TableState(_tableformat, htmlwriter.GetPreferences().pretty_borders) );
        TableState &state=tablestack.top();
        state.saved_cellsize = cellsize; //store container size
        state.saved_bgcolor = bgcolor;

        //Apply template-specified border overrides
        int borderwidth = htmlwriter.GetPreferences().borderwidth;
        bool borderforced = htmlwriter.GetPreferences().borderwidth_forced || !state.prettyborders;

        if (!state.prettyborders && borderwidth != 0) //only widths 0 and 1 work if prettyborders is off
            borderwidth = 1;

        if (borderwidth != -1)
            state.MaximiseTableBorders(borderwidth, borderforced);

        if (!htmlwriter.GetPreferences().tablebordercolor.IsFullyTransparent())
            state.SetTableBorderColours(htmlwriter.GetPreferences().tablebordercolor);

        state.CalculateBorderWidths();

        if (htmlwriter.standard >= HTML4) //ADDME: Suppress this <div> if unnecesasry
        {
                render->Indent(+1);

                std::string style="clear:both;";
                EncodePaddingStyle(style, Parsers::Distance(), state.table.tablepadding);
                HTML_StyleTextAlign(style,state.table.halign); //IE6 requires this, doesn't support margin: auto on the table itself

                render->tags += "<div class=\"whpfh-tablewrapper\" style=\"" + style + "\">";
        }

        state.cellspacing=state.table.cellspacing;
        unsigned htmlbordersize = 0;
        signed total_table_width;

        unsigned maxborderwidth = state.GetHighestBorderWidth();
        if (state.table.tablewidth < 0) //a percentage width!
        {
                total_table_width = htmlwriter.GetPreferences().tablewidth_forced ? -100 : std::max(-100,state.table.tablewidth);
                state.ScaleTable(); //scale to table's preferred sizes
        }
        else
        {
                //Calculate maximum table cell widths
                unsigned forcedsize = htmlwriter.GetPreferences().tablewidth;
                bool setcolumnstomaximum = htmlwriter.GetPreferences().tablewidth_forced && forcedsize>0;

                //If cellsize < forcedsize, reduce forcedsize to cellsize
                if (cellsize && (forcedsize==0 || forcedsize>cellsize))
                    forcedsize = cellsize;
                //If tablewidth < forcedsize, and we're not required to maximimize table sizes, reduce forcedsize to tableformat.tablewidth
                if (state.table.tablewidth > 0 && !setcolumnstomaximum && (forcedsize == 0 || forcedsize > unsigned(state.table.tablewidth)))
                    forcedsize = state.table.tablewidth;

                if (forcedsize != 0)
                {
                        state.CalculateMaximumWidths(forcedsize);
                }

                if (!setcolumnstomaximum)
                {
                        state.ScaleTable(); //scale to table's preferred sizes

                        if (forcedsize)
                        {
                                //We _might_ need to override the table size anyway,
                                unsigned curtablesize = std::accumulate(state.columnwidths.begin(), state.columnwidths.end(), 0u)
                                                      + TwipsToPixels(std::accumulate(state.columnborderwidths_twips.begin(), state.columnborderwidths_twips.end(), 0u));

                                if (curtablesize > forcedsize) //table too large, set to maximums!
                                    state.columnwidths = state.maxcolumnwidths;
                        }
                }
                else
                {
                        state.columnwidths = state.maxcolumnwidths;
                }

                //FIXME: Implement cellspacing for tables _with_ borders

                //Without the width the table grows to 100% in some cases, so the
                //following comment is now ignored: DON'T add a table width: it breaks table border rendering on Opera
                total_table_width = std::accumulate(state.columnwidths.begin(), state.columnwidths.end(), 0)
                                  + TwipsToPixels(std::accumulate(state.columnborderwidths_twips.begin(), state.columnborderwidths_twips.end(), 0));
        }
        if (!state.prettyborders)
            htmlbordersize = maxborderwidth;

        //DEBUGPRINT(state.table);

        if (htmlwriter.standard >= HTML4)
            render->OpenTable(htmlbordersize, state.cellspacing, total_table_width, 0, state.prettyborders && state.cellspacing==0, state.table.halign);
        else
            render->OpenTable(htmlbordersize, 3, total_table_width, 3, false, state.table.halign);

        OpenTableRow();

        if (!HandleNonDataCells())
            throw std::runtime_error("HtmlOutput: Table has no data cells");

        OpenCell();
        render->FlushTags();
}

bool HtmlOutput::HandleNonDataCells()
{
        TableState &state=tablestack.top();
        while (true)
        {
                while (state.gridcolumn < state.table.GetColumns())
                {
                        Parsers::Table::CellFormatting const &cell=state.table.GetFormatting(state.gridcolumn,state.gridrow);

//                        if (state.prettyborders)
//                           PaintColumnBorders();

                        if (cell.type == Parsers::Table::Data) //Real cell (the one we're looking for!)
                            return true;

                        unsigned nextcell = state.table.GetNextCell(state.gridcolumn,state.gridrow);
                        unsigned numgridcells = nextcell - state.gridcolumn;

                        //Make sure we're allowed to overlap these cells
                        for (unsigned check=0;check<numgridcells;check=check+1)
                        {
                                if (state.set_width_rows[state.gridcolumn + check]==state.gridrow)
                                    numgridcells=std::max(1u,check);
                        }

                        if (cell.type == Parsers::Table::Open)
                        {
                                int width = std::accumulate(&state.columnwidths[state.gridcolumn],
                                                            &state.columnwidths[state.gridcolumn + numgridcells],
                                                            0);
                                render->ColspanTd(numgridcells, state.set_width_rows[state.gridcolumn]==state.gridrow ? width : 0, Wrap, cell.top,
                                cell.right,//state.table.GetCellRightBorder(state.gridcolumn,state.gridrow),
                                cell.bottom,//state.table.GetCellBottomBorder(state.gridcolumn,state.gridrow),
                                cell.left);
                        }
                        state.gridcolumn += numgridcells;
                }
//                if (state.prettyborders)
//                    PaintColumnBorders();

                CloseTableRow();

                if (++state.gridrow >= state.table.GetRows())
                {
                        return false;
                }

                OpenTableRow();
        }
}

void HtmlOutput::OpenCell()
{
        TableState &state=tablestack.top();
        Parsers::Table::CellFormatting const &cell=state.table.GetFormatting(state.gridcolumn,state.gridrow);

        //Required width
        int width = std::accumulate(&state.columnwidths[state.gridcolumn],
                                         &state.columnwidths[state.gridcolumn + cell.colspan],
                                         0);
        unsigned colspan = cell.colspan;
        unsigned rowspan = cell.rowspan;

        Parsers::Table::BorderType topborder, rightborder, bottomborder, leftborder;
        DEBUGPRINT(" row #" << state.gridrow << " col #" << state.gridcolumn << " colspan " << colspan << " right border: " << cell.right.thickness_twips);
        if(state.prettyborders)
        {
                topborder = cell.top;
                rightborder = cell.right;
                bottomborder = cell.bottom;
                leftborder = cell.left;

                /* this is causing issues and broke table_test.docx.
                 * Need a counter example to reenable it
                //Validate that border is the same for all spanned cells. Reset borders otherwise
                for (unsigned x = state.gridcolumn + 1; x < state.gridcolumn + colspan; ++x)
                {
                        if (state.table.GetFormatting(x, state.gridrow).top != topborder)
                            topborder = Parsers::Table::BorderType();
                        if (state.table.GetFormatting(x, state.gridrow + rowspan - 1).bottom != bottomborder)
                            bottomborder = Parsers::Table::BorderType();
                }
                for (unsigned y = state.gridrow + 1; y < state.gridrow + rowspan; ++y)
                {
                        if (state.table.GetFormatting(state.gridcolumn, y).left != leftborder)
                        {
                                DEBUGPRINT("Resetting leftborder for col #" << state.gridcolumn << " row #" << state.gridrow << " because of row#" << y);
                                leftborder = Parsers::Table::BorderType();
                        }
                        if (state.table.GetFormatting(state.gridcolumn + colspan - 1, y).right != rightborder)
                        {
                                DEBUGPRINT("Resetting rightborder for col #" << state.gridcolumn << " row #" << state.gridrow << " because of row#" << y);
                                rightborder = Parsers::Table::BorderType();
                        }
                }*/
        }

        DEBUGPRINT(" row #" << state.gridrow << " col #" << state.gridcolumn << " colspan " << colspan << " right border: " << rightborder.thickness_twips);
        render->OpenTd(0,
                    state.set_width_rows[state.gridcolumn]==state.gridrow ? width : 0,
                    colspan, rowspan,
                    cell.background.IsFullyTransparent(), cell.background,
                    topborder,
                    rightborder,
                    bottomborder,
                    leftborder,
                    true, cell.valign, Wrap, cell.tableheader,
                    cell.padding);

        //Add a table margin
        int extrapadding = TwipsToPixels(cell.padding.left) + TwipsToPixels(cell.padding.right);
        if (width>0)
        {
                cellsize = std::max(width,extrapadding + 1) - extrapadding; //subtract the left and right margins
        }
        else if (width<0)
        {
                //Calculate cellszie by taking current size limit
                unsigned current_limit = htmlwriter.GetPreferences().tablewidth;
                if(state.saved_cellsize && (!current_limit || current_limit > state.saved_cellsize))
                    current_limit = state.saved_cellsize;

                cellsize = current_limit*(-width) / 100;
        }
        else
        {
                cellsize = state.saved_cellsize;
        }

        bgcolor = cell.background.IsFullyTransparent() ? state.saved_bgcolor : cell.background;
        any_paragraph=false;
        suppressed_div_enter=false;
}

void HtmlOutput::CloseCell()
{
        TableState &state=tablestack.top();
        Parsers::Table::CellFormatting const &cell=state.table.GetFormatting(state.gridcolumn,state.gridrow);

        //This is a NS4 work around i think, but even without NS4, there needs
        //to be at least ONE cell with content on a row to prevent it from being squished...
        if (!any_paragraph) //make sure the cell becomes visible
            render->tags += ( htmlwriter.standard >= XHTML ? "&#160;" : "&nbsp;" );

        render->CloseTd(cell.tableheader);

        suppressed_div_enter=false;
}

void HtmlOutput::OpenTableRow()
{
        TableState &state=tablestack.top();

        render->OpenTr();
        state.gridcolumn=0;
}

void HtmlOutput::CloseTableRow()
{
        render->CloseTr();
}

void HtmlOutput::NextCell()
{
        //ADDME: Fail if no table was opened..
        TableState &state=tablestack.top();

        //Close current cell
        CloseCell();

        //Move to next cell
        state.gridcolumn += state.table.GetFormatting(state.gridcolumn,state.gridrow).colspan;

        if (!HandleNonDataCells())
            throw std::runtime_error("HtmlOutput::NextCell - trying to move off the end of the table");

        //Start the new cell
        OpenCell();
        render->FlushTags();
}

void HtmlOutput::EndTable()
{
        TableState &state=tablestack.top();

        //Close the current cell
        CloseCell();

        //Move to next cell
        state.gridcolumn += state.table.GetFormatting(state.gridcolumn,state.gridrow).colspan;

        if (HandleNonDataCells())
            throw std::runtime_error("HtmlOutput::EndTable - haven't rendered all cells yet");

//        if (state.prettyborders)
//            PaintRowBorders();

        //Do we need an extra row to force cell widths?
        if(state.prettyborders && std::find(state.set_width_rows.begin(), state.set_width_rows.end(), state.table.GetRows()) != state.set_width_rows.end())
        {
                DEBUGPRINT("Must add an extra row to force cell widths");
                render->OpenTr();
                //ADDME: Span over non interesting cells
                for (unsigned x=0;x<state.table.GetColumns();++x)
                {
                        int width = state.set_width_rows[x]==state.table.GetRows() ? state.columnwidths[x] : 0;
                        render->ColspanTd(1, width, Wrap, Parsers::Table::BorderType(), Parsers::Table::BorderType(), Parsers::Table::BorderType(), Parsers::Table::BorderType());
                }
                render->CloseTr();
        }

        render->CloseTable();

        if (htmlwriter.standard >= HTML4)
        {
                render->Indent(-1);
                render->tags += "</div>";
        }
        render->Indent(0);

        any_paragraph=true;
        cellsize=state.saved_cellsize; //restore old cellsize
        bgcolor=state.saved_bgcolor; //restore old cellsize
        tablestack.pop();

        render->FlushTags();
}

/* Should we close the tags associated with these bits?
   (they differ, and the tags is now open) */
template<unsigned bits> bool ShouldClose(uint32_t oldformat, uint32_t newformat)
{
        return (oldformat ^ newformat) & bits
               && (oldformat & bits) != 0;
}

void HtmlOutput::GenerateCloseTags(bool close_hyperlink_too)
{
        //FIXME: Should we really be able to get here without an open paragraph?
        if (parastack.empty())
            return;

        /* Close all tags that we need to rebuild. Basically, if the settings
           that are associated with a tags are changed, and one of the settings
           is already opened (so the tags must be open as well), then we need
           to close that tags first.

           The order in which tags are closed doesn't matter */
        if (parastack.top().super_open)
        {
                parastack.top().super_open=false;
                render->tags += "</sup>";
        }
        if (parastack.top().sub_open)
        {
                parastack.top().sub_open=false;
                render->tags += "</sub>";
        }
        if (parastack.top().span_open)
        {
                parastack.top().span_open=false;
                render->tags += "</span>";
        }
        if (parastack.top().u_open)
        {
                parastack.top().u_open=false;
                render->tags += "</u>";
        }
        if (parastack.top().i_open)
        {
                parastack.top().i_open=false;
                render->tags += "</i>";
        }
        if (parastack.top().b_open)
        {
                parastack.top().b_open=false;
                render->tags += "</b>";
        }
        if (parastack.top().font_open)
        {
                parastack.top().font_open=false;
                render->tags += "</font>";
        }
        if (parastack.top().del_open)
        {
                parastack.top().del_open=false;
                render->tags += "</del>";
        }
        if (parastack.top().ins_open)
        {
                parastack.top().ins_open=false;
                render->tags += "</ins>";
        }
        if (have_hyperlink && close_hyperlink_too)
        {
                render->FlushTags();
                HyperlinkHandler(false, opened_link);
                have_hyperlink=false;
        }
}

void HtmlOutput::InsertImage(Parsers::ImageInfo const &imginfo)
{
        UpdateCharacterFormatting();
        FormattedOutput::InsertImage(imginfo);

        any_nonspace=true;
}

void HtmlOutput::StartHyperlink(Parsers::Hyperlink const &hyperlink)
{
        parastack.top().requested_hyperlink=hyperlink;
        parastack.top().want_hyperlink=true;
}

void HtmlOutput::EndHyperlink()
{
        parastack.top().want_hyperlink=false;
}

int32_t HtmlOutput::PredefineStyle(std::string const &suggestedname, Parsers::Paragraph const &formatpara, Parsers::Character const &formatchar)
{
        return htmlwriter.PredefineHtmlStyle(suggestedname, formatpara, formatchar);
}

DrawLib::Pixel32 HtmlOutput::GetBackgroundColor()
{
        return bgcolor;
}
void HtmlOutput::GetBaseFormatting(Character  *formatting)
{
        *formatting = BaseCharState();
}

void HtmlOutput::FlushOutput()
{
        GenerateCloseTags(true);
        render->FlushTags();
        CurActualState()=BaseCharState();
}

HtmlOutput::ParaState::ParaState(Parsers::PredefinedStyle const &_predefstyle,
                                          Parsers::Paragraph const &_format_para,
                                          Parsers::ObjectType _listtype)
: predefstyle(&_predefstyle)
, format_para(_format_para)
, listtype(_listtype)
, actual_format_char(predefstyle->formatchar)
{
        ins_open = false;
        del_open = false;
        span_open= false;
        sub_open= false;
        super_open= false;
        font_open = false;
        b_open = false;
        i_open = false;
        u_open = false;
        want_hyperlink = false;
}

Preferences::Preferences()
: bgcolor(DrawLib::Pixel32(255,255,255,255)) //white is default bgcolor...
, tablewidth(0)
, tablewidth_forced(false)
, tablebordercolor(DrawLib::Pixel32::MakeTransparent())
, borderwidth(-1)
, borderwidth_forced(false)
, pretty_borders(true)
, basefontsize(0)
, suppress_hyperlink_formatting(true)
{
}

HtmlWriter::HtmlWriter(StandardLevels level, bool _strict, bool _stylesheet, bool _cssclasses)
: standard(level)
, strict(_strict)
, stylesheet(_stylesheet)
, cssclasses(_cssclasses)
{
}
HtmlWriter::~HtmlWriter()
{
}

int32_t HtmlWriter::PredefineHtmlStyle(std::string const &suggestedname, Parsers::Paragraph const &formatpara, Parsers::Character const &formatchar)
{
        //Create proper name (note: NEVER use underscores or spaces in a stylename, NS4 will freak out!)
        std::string stylename="wh-";
        for (std::string::const_iterator nameptr=suggestedname.begin();nameptr!=suggestedname.end();++nameptr)
          if (Blex::IsAlNum(*nameptr))
            stylename.push_back(static_cast<char>(std::tolower(*nameptr)));

        //Get uniqueness counter
        unsigned namecounter=++stylenames[stylename];
        if (namecounter>1)
            stylename += "-" + Blex::AnyToString(namecounter);

        predefinedstyles.push_back(Parsers::PredefinedStyle());
        predefinedstyles.back().name=stylename;
        if(stylesheet)
        {
                predefinedstyles.back().formatpara=formatpara;
                predefinedstyles.back().formatchar=formatchar;

                if (formatchar.fonttype)
                {
                        fontcopies.push_back(*formatchar.fonttype);
                        predefinedstyles.back().formatchar.fonttype = &fontcopies.back();
                }
        }
        return predefinedstyles.size();
}

void HtmlWriter::PrintStyleSheet(HSVM *vm, int32_t outputid)
{
        for (PredefinedStyles::const_iterator itr=predefinedstyles.begin();itr != predefinedstyles.end();++itr)
        {
                std::string style = GetParagraphTag(itr->formatpara.headinglevel);
                style += "." + itr->name + " {";

                HTML_StyleTextAlign(style, itr->formatpara.jc);
                EncodePoints100Style(style,"text-indent", TwipsToPoints100( std::max(-int(itr->formatpara.padding.left),itr->formatpara.first_indent)));
                EncodePaddingStyle(style,Parsers::Distance(), itr->formatpara.padding);
                style += "margin:0pt;";
                GenerateCharStyle(Parsers::Character(),itr->formatchar,&style,false,true,GetPreferences().basefontsize);
                style += "}\n";
                HSVM_PrintTo(vm, outputid, style.size(), style.data());
        }
}

///Create an output (the 'nice' way)
int32_t HtmlWriter::CreateOutput(HSVM *vm, int32_t outputid)
{
        HtmlOutputPtr newoutput(new HtmlOutput(vm,outputid,*this));
        int32_t id = Parsers::RegisterFormattedOutput(vm, newoutput);
        html_outputs[id]=newoutput;
        return id;
}
///Close an output (the 'nice' way - ie HareScript requested)
void HtmlWriter::CloseOutput(HSVM *vm, int32_t id)
{
        Parsers::UnregisterFormattedOutput(vm, id);
        html_outputs.erase(id);
}
///Close all outputs (the 'nice' way - ie HareScript requested)
void HtmlWriter::CloseAllOutputs(HSVM *vm)
{
        //Note: we don't unregister on forced destruction - this could cause ordering problems during shutdown (output base may die before us)
        for (std::map<int32_t, HtmlOutputPtr>::const_iterator itr = html_outputs.begin(); itr != html_outputs.end(); ++itr)
            Parsers::UnregisterFormattedOutput(vm, itr->first);
        html_outputs.clear();
}


} //end namespace XML
} //end namespace Formats
} //end namespace Parsers
