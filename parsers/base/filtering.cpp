#include <ap/libwebhare/allincludes.h>


#include "filtering.h"
//#include "parserinterface.h"

namespace Parsers {

FilteredOutput::FilteredOutput(FormattedOutputPtr const &dest, StyleSettings const &currentfilter)
: ForwardingOutput(dest)
, currentfilter(currentfilter)
, filtering_bulnum(false)
{
}

FilteredOutput::~FilteredOutput()
{
}

int32_t FilteredOutput::PredefineStyle(std::string const &suggestedname, Parsers::Paragraph const &_formatpara, Parsers::Character const &_formatchar)
{
        if (!currentfilter.paragraph_formatting) //Can't allow you to define a style now..
            return 0;

        Parsers::Paragraph formatpara(_formatpara);
        Parsers::Character formatchar(_formatchar);

        //Apply profile filters to the settings
        currentfilter.FixupParagraphSettings(&formatpara,formatpara,Parsers::NoList);
        currentfilter.FixupCharacterSettings(&formatchar,formatchar);

        //Pass it through, and record the style for our reference
        return ForwardingOutput::PredefineStyle(suggestedname, formatpara, formatchar);
}

void FilteredOutput::StartParagraph(int32_t styleid, Parsers::Paragraph const &format_para, Parsers::ObjectType listtype)
{
        if (!currentfilter.show_bullets_numbering)
        {
                filtering_bulnum=true;
                listtype=NoList;
        }
        if (!currentfilter.paragraph_formatting) //No opening or closing of paragraphs now
            return;

        Parsers::Paragraph filteredformat;
        currentfilter.FixupParagraphSettings(&filteredformat,format_para, listtype);
        ForwardingOutput::StartParagraph(styleid, filteredformat, listtype);
}
void FilteredOutput::EnterParaText()
{
        filtering_bulnum=false;
        if (!currentfilter.paragraph_formatting) //No opening or closing of paragraphs now
            return;

        ForwardingOutput::EnterParaText();
}
void FilteredOutput::EndParagraph()
{
        if (!currentfilter.paragraph_formatting) //No opening or closing of paragraphs now
        {
                ForwardingOutput::FlushOutput(); //allow formatter to close character-level tags
                static const char lf='\n';
                WriteString(1,&lf);
                return;
        }
        ForwardingOutput::EndParagraph();
}
void FilteredOutput::ChangeFormatting(Parsers::Character const &new_format)
{
        Parsers::Character filteredformat;
        GetBaseFormatting(&filteredformat);
        currentfilter.FixupCharacterSettings(&filteredformat,new_format);
        ForwardingOutput::ChangeFormatting(filteredformat);
}
void FilteredOutput::WriteString (unsigned numchars, char const *firstchar)
{
        if (filtering_bulnum)
            return;

        if(currentfilter.softbreaks)
            return ForwardingOutput::WriteString(numchars, firstchar);

        while(true)
        {
                char const *maxprint = std::find(firstchar, firstchar+numchars, '\n');
                ForwardingOutput::WriteString(maxprint-firstchar, firstchar);
                if(maxprint==firstchar+numchars)
                    break;

                numchars -= (maxprint-firstchar)+1;
                firstchar = maxprint+1;
        }
}
void FilteredOutput::SetAnchor(std::string const &anchor)
{
        if (currentfilter.anchors)
            ForwardingOutput::SetAnchor(anchor);
}
void FilteredOutput::StartTable(Parsers::Table const &tableformat)
{
        if (!filtering_bulnum && currentfilter.tables)
            ForwardingOutput::StartTable(tableformat);
}
void FilteredOutput::EndTable()
{
        if (!filtering_bulnum && currentfilter.tables)
            ForwardingOutput::EndTable();
}
void FilteredOutput::NextCell()
{
        if (!filtering_bulnum && currentfilter.tables)
            ForwardingOutput::NextCell();
}
void FilteredOutput::StartHyperlink(Parsers::Hyperlink const &hyperlink)
{
        if (currentfilter.hyperlinks && !filtering_bulnum)
            ForwardingOutput::StartHyperlink(hyperlink);
}
void FilteredOutput::InsertImage(ImageInfo const &img)
{
        if (currentfilter.images && !filtering_bulnum)
            ForwardingOutput::InsertImage(img);
}
void FilteredOutput::EndHyperlink()
{
        if (currentfilter.hyperlinks && !filtering_bulnum)
            ForwardingOutput::EndHyperlink();
}

PublicationProfile::PublicationProfile()
{
        //Create the default style (returned when no other style is available)
        filters.push_front(StyleSettings());
        implicitfilter = filters.begin();
}

/// Get the filter id associated with a word style
StyleSettings const &PublicationProfile::GetFilter_WordStyle(int32_t word_id) const
{
        BuiltinStyleMap::const_iterator style=builtinstylemap.find(word_id);
        return style==builtinstylemap.end() ? GetFilter_Implicit() : *style->second;
}

/// Get the filter id associated with a custom word style
StyleSettings const &PublicationProfile::GetFilter_WordCustomStyle(std::string const &stylename) const
{
        CustomStyleMap::const_iterator style=customstylemap.find(stylename);
        return style==customstylemap.end() ? GetFilter_Implicit() : *style->second;
}

void PublicationProfile::AddFilter(int32_t wordid, std::string const &name, StyleSettings const &filter)
{
        filters.push_back(filter);
        Filters::const_iterator newfilter=filters.end();
        --newfilter;

        if (wordid==-1)
        {
                if (name.empty())
                    implicitfilter=newfilter;
                else
                    customstylemap.insert(std::make_pair(name,newfilter));
        }
        else
        {
                builtinstylemap.insert(std::make_pair(wordid,newfilter));
        }
}


StyleSettings::StyleSettings()
: toclevel(0)
, fontsize(-1)
, fontcolor(0,0,0,0)
, para_bgcolor(0,0,0,0)
, vertspace_above(-1)
, vertspace_below(-1)
, margin_left(-1)
, margin_right(-1)
, margin_first(-1)
, horizalign(-1)
, underlining(-1)
, formatflags_and(0xFFFFFFFF)
, formatflags_or(0)
, split(false)
, show_bullets_numbering(true)
, hide_docobject(false)
, show_hidden_text(false)
, paragraph_formatting(true)
, texteffects(true)
, subsuper(true)
, hyperlinks(true)
, anchors(true)
, images(true)
, tables(true)
, softbreaks(true)
, tableheader(false)
, headinglevel(0)
{
}

void StyleSettings::FixupCharacterSettings(Parsers::Character *dest, Parsers::Character const &src) const
{
        if (texteffects)
        {
                //Font settings
                dest->foreground_color = fontcolor.IsFullyTransparent() ? src.foreground_color : fontcolor;
                dest->background_color = para_bgcolor.IsFullyTransparent() ? src.background_color : para_bgcolor;
                dest->fonttype = newfont.font_face.empty() || (src.fonttype && src.fonttype->neveroverride) ? src.fonttype : &newfont;
                dest->font_halfpoint_size = fontsize==-1 ? src.font_halfpoint_size : fontsize;

                //Text decorations
                dest->format_bits = (src.format_bits & formatflags_and) | formatflags_or;
                dest->underlining = underlining==-1 ? src.underlining : (underlining == 0 ? Parsers::Character::NoUnderline : Parsers::Character::SingleUnderline);
        }
        if (subsuper)
        {
                dest->subsuper = src.subsuper;
        }
        dest->languagecode = src.languagecode;
}

void StyleSettings::FixupParagraphSettings(Parsers::Paragraph *dest, Parsers::Paragraph const &src, Parsers::ObjectType listtype) const
{
        if (listtype==Parsers::SidebysideBullet)
        {
                /* Re-interpret left margin overrides for better formatting */
                dest->padding.left = margin_left==-1
                                     ? src.padding.left
                                     : (margin_left*20) - src.first_indent;
                dest->first_indent = src.first_indent;
        }
        else
        {
                dest->padding.left = margin_left==-1 ? src.padding.left : margin_left*20;
                dest->first_indent = margin_first==-1 ? src.first_indent: margin_first*20;
        }

        dest->jc = horizalign==-1 ? src.jc : static_cast<Parsers::HorizontalAlignment>(horizalign);
        dest->padding.right = margin_right==-1 ? src.padding.right : margin_right*20;
        dest->padding.top = vertspace_above==-1 ? src.padding.top : vertspace_above*20;
        dest->padding.bottom = vertspace_below==-1 ? src.padding.bottom : vertspace_below*20;
        dest->headinglevel = headinglevel;
        dest->exactheight = src.exactheight;
        dest->lineheight = src.lineheight;
}

bool StyleSettings::ShowHiddenAnyway() const
{
        return show_hidden_text;
}

} //end namespace Parsers
