#include <drawlib/drawlibv2/allincludes.h>



#include "fontdata_internal.h"
#include "textrenderer.h"
#include "bitmapmanip.h"
#include "drawobject.h"
#include <blex/utils.h>
//#include <freetype.h>
#include FT_GLYPH_H

// Factor used to determine the size of sub/super script fonts
const double subscript_factor = 0.65;
// Factor used to scale bitmaps (graphical bullets for example)
const double bitmap_scaling = 0.7;

namespace DrawLib
{

struct TGlyph
{
        FT_UInt   glyph_index;
        FT_Vector pos;
        FT_Glyph  image;
        FT_Vector bearing;
};

namespace TextRendererFuncs
{
        void BlitGlyph    (const FT_Bitmap *source, int x, int y, const Font &myfont, Canvas32 &mycanvas);
        void BlitMonoGlyph(const FT_Bitmap *source, int x, int y, const Font &myfont, Canvas32 &mycanvas);
}


namespace Text
{

DrawLib::Pixel32 GetUpperEmbossColor(DrawLib::Pixel32 input)
{
        double h,s,v;
        DrawLib::Pixel32 upper_emboss_color;
        RGBtoHSV(input, &h, &s, &v);
        v = v * 2.0;
        v = v > 1.0 ? 1.0 : v;
        HSVtoRGB(h, s, v, &upper_emboss_color);
        return upper_emboss_color;
}

DrawLib::Pixel32 GetLowerEmbossColor(DrawLib::Pixel32 input)
{
        double h,s,v;
        DrawLib::Pixel32 lower_emboss_color;
        RGBtoHSV(input, &h, &s, &v);
        v = v * 0.5;
        HSVtoRGB(h, s, v, &lower_emboss_color);
        return lower_emboss_color;
}

DrawLib::Pixel32 GetShadowColor(DrawLib::Pixel32 input)
{
        double h,s,v;
        RGBtoHSV(input, &h, &s, &v);

        // FIXME: This factor is not yet correct
        if (v >= 0.97)
                return DrawLib::Pixel32(0xc0, 0xc0, 0xc0);
        else
                return DrawLib::Pixel32(0xff, 0xff, 0xff);
}

Symbol::Symbol(DrawLib::Font *_font, DrawLib::FPSize _font_size, uint32_t _c, DrawLib::Bitmap32 const *_bitmap,
        bool _underline, int _shadow, int _par_index, DrawLib::Pixel32 _font_color,
        double _offset, int _mode)
: font(_font)
, font_size(_font_size)
, c(_c)
, bitmap(_bitmap)
, underline(_underline)
, shadow(_shadow)
, color(_font_color)
, offset(_offset)
, mode(_mode)
, par_index(_par_index)
{
        font->SetSize(font_size);

        Blex::Mutex::AutoLock freetype_use(freetype_use_lock);
        FT_Face &face = font->data->face;

        FT_UInt glyph_index = FT_Get_Char_Index( face, c);
        FT_Error error = FT_Load_Glyph( face, glyph_index, FT_LOAD_NO_BITMAP);
        if(error)
        {
                width = 0;
                return;
        }

        FT_Size_Metrics*  metrics = &face->size->metrics; /* shortcut */

        double multiplyer = metrics->y_ppem / (double)face->units_per_EM;

        /* convert design distances to floating point pixels */
        //baseheight          = (face->height+face->descender) * multiplyer;
        underline_position  = -face->underline_position      * multiplyer;
        underline_thickness =  face->underline_thickness     * multiplyer;


        if (bitmap)
        {
                width = (double)bitmap->GetWidth() / (double)bitmap->GetHeight() * font_size.height * bitmap_scaling;
        }
        else
        {
                // Determine width, correction factor for super/sub script
                width  = face->glyph->metrics.horiAdvance / 64.0 * (offset==0.0 ? 1.0 : subscript_factor);
        }

        //ADDME: Review the calculation of the height here:
        //height = face->height * multiplyer;
        //height = (face->ascender + face->descender) * multiplyer + (font_size.height*0.5);
        ascender  = face->ascender  * multiplyer;
        descender = face->descender * multiplyer;
        switch (mode)
        {
                case 0: /* Word */
//                        line_height = (ascender - descender) + (ascender - descender)/24.5;
                        line_height = face->height * multiplyer;
                break;
                case 1: /* Powerpoint */
                        line_height = font_size.height * 3.0 / 4.0 * 1.6;
                break;
        }

        linegap = line_height - ascender + descender;
}


unsigned Word::CutForWidth(double _width)
{
        double width = 0.0;

        if(OnlySpaces())
                // We should just return zero here. This is the case when cutting a
                // word with for example 100 spaces at the end of the last row:
                return 0;

        std::vector<Symbol>::iterator symbol_iterator = symbols.begin();

        int count = 0;
        ascender  = 0.0;
        descender = 0.0;
        linegap = 0.0;
        line_height = 0.0;
        while(symbol_iterator != symbols.end() &&
              (width + symbol_iterator->width < _width ||
               symbol_iterator == symbols.begin())) // Always add at least the first symbol
        {
                width += symbol_iterator->width;
                if(ascender < symbol_iterator->ascender)
                        ascender = symbol_iterator->ascender;
                if(descender > symbol_iterator->descender)
                        descender = symbol_iterator->descender;
                if(linegap < symbol_iterator->linegap)
                        linegap = symbol_iterator->linegap;
                if(line_height < symbol_iterator->line_height)
                        line_height = symbol_iterator->line_height;

                ++symbol_iterator;
                ++count;
        }

        symbols.resize(count);
        return count;
}

bool Word::CutFirstSymbols(unsigned n)
{
        if(n > symbols.size())
                throw std::runtime_error("Word::CutFirstSymbols: Cutting to much symbols.");

        // Cut away the first n symbols:
        symbols.erase(symbols.begin(), symbols.begin() + n);

        // Get the new word dimentions:
        std::vector<Symbol>::iterator symbol_iterator = symbols.begin();

        width     = 0.0;
        ascender  = 0.0;
        descender = 0.0;
        linegap   = 0.0;
        line_height  = 0.0;
        while(symbol_iterator != symbols.end() && symbol_iterator->c != ' ')
        {
                width += symbol_iterator->width;
                if(ascender < symbol_iterator->ascender)
                        ascender = symbol_iterator->ascender;
                if(descender > symbol_iterator->descender)
                        descender = symbol_iterator->descender;
                if(linegap < symbol_iterator->linegap)
                        linegap = symbol_iterator->linegap;
                if(line_height < symbol_iterator->line_height)
                        line_height = symbol_iterator->line_height;

                ++symbol_iterator;
        }

        spaces_width = 0.0;

        return OnlySpaces();
}

void Word::AddSymbol(Symbol const &s)
{
        Symbol symbolcopy(s);

        if(ascender < s.ascender)
                ascender = s.ascender;
        if(descender > s.descender)
                descender = s.descender;
        if(linegap < s.linegap)
                linegap = s.linegap;
        if(line_height < s.line_height)
                line_height = s.line_height;

        if (s.c == '\t')
                symbolcopy.width = 0;

        if (s.c == 32) //space
                spaces_width += s.width;
        else
                width += symbolcopy.width;

        symbols.push_back(symbolcopy);
}

int Word::GetParIndex() const
{
        if(symbols.size() <= 0)
                return 0;

        return symbols[0].par_index;
}


void Row::AddWord(Word const &word, bool skip_spaces)
{

        // Only add the width of the spaces to the width of the row when
        // this is not the first word of a running paragraph and this word is not the last word of this row
        if(!skip_spaces && (!word.OnlySpaces() || !(word.ends_with_newline || word.ends_with_soft_newline)))
                width += word.spaces_width;

        width += word.width;

        if(ascender < word.ascender)
                ascender = word.ascender;
        if(descender > word.descender)
                descender = word.descender;
        if(linegap < word.linegap)
                linegap = word.linegap;
        if(line_height < word.line_height)
                line_height = word.line_height;

        words.push_back(word);

        // When this is the first word of a running paragraph, we can skip spaces
        // do so in the word
        if(skip_spaces)
                words.rbegin()->spaces_width = 0.0;
}

void Row::Render(
        FPBoundingBox rowbox,
        int text_direction,
        FPBoundingBox const& textbox,
        Canvas32 &canvas,
        Paragraph const &parsetting,
        bool skip_first_spaces,
        double letterspacing)
{
        DrawObject temp_drawobject(&canvas);

        bool first = true;
        DrawLib::Font *current_font = 0;
        DrawLib::FPSize current_font_size;
        DrawLib::Pixel32 current_fontcolor = DrawLib::Pixel32(0,0,0);
        Blex::UnicodeString current_string;
        double current_x = skip_first_spaces ? parsetting.left_indent : parsetting.firstline_indent;
        double current_offset = 0.0;

        bool current_underline = false;
        int current_shadow = normal;
        double last_underline_x = current_x;

        double underline_position  = 0.0;
        double underline_thickness = 0.0;
        uint16_t underlined_chars = 0;
        DrawLib::Pixel32 underline_color = DrawLib::Pixel32(0,0,0);

        double last_text_x = current_x;

        double text_angle;
        switch(text_direction)
        {
        case 0: // Horizontal, left to right:
                text_angle = 0.0;
                break;

        case 1: // Vertical, top to bottom:
                text_angle = -90.0;
                break;

        case 2: // Vertical, bottom to top:
                text_angle = 90.0;
                break;

        default:
                throw std::runtime_error("Row::Render: Unrecognized value for parameter 'text_direction'.");
        }


        // Get the horizontal alignment of this row:
        int alignment = parsetting.alignment;

        // The horizontal free space, left for this row, if any:
        double free_h_space = rowbox.lower_right.x - rowbox.upper_left.x - width;

        // Take some action given the horizontal alignment:
        switch(alignment)
        {
        case 1: // Center
                rowbox.upper_left.x += free_h_space/2.0;
                break;

        case 2: // Right
                rowbox.upper_left.x += free_h_space;
                break;

        case 3: // Justify
                if(!ends_with_newline)
                {
                        if(free_h_space <= 0.0)
                                break;

                        // Get the total of all relevant space between words:
                        double total_h_space = 0.0;
                        // We want to skip the first word here and go back
                        // till the last word that used a tab
                        for (std::vector<Word>::const_reverse_iterator it = words.rbegin();
                                it.base()-1 != words.begin() && !it->has_tab; ++it)
                                if (!it->OnlySpaces())
                                        total_h_space += it->spaces_width;

                        if(total_h_space <= 0.0)
                                break;

                        // Get a multiplier for all those spaces between words:
                        double space_multiplier = free_h_space/total_h_space + 1.0;

                          // .. and apply this multiplier:
                        for (std::vector<Word>::reverse_iterator it = words.rbegin();
                                it.base()-1 != words.begin() && !it->has_tab; ++it)
                                if (!it->OnlySpaces())
                                {
                                        it->spaces_width *= space_multiplier;
                                        it->symbols[0].width = it->spaces_width;
                                }
                }
                break;

        // default: (left) Do nothing
        }

        std::vector< std::pair<double, double> > underline_sections;

        // Loop through all words on this row, to precalculate underline position and thickness
        for (std::vector<Word>::const_iterator word_iterator = words.begin();
                word_iterator != words.end(); ++word_iterator)
        {
                // Now loop through all symbols, untill we discover a change
                for (std::vector<Symbol>::const_iterator i = word_iterator->symbols.begin();
                        i != word_iterator->symbols.end(); ++i)
                {
                        // Start of section
                        if (!current_underline && i->underline && !(i->c == ' ' && (word_iterator->ends_with_newline || word_iterator->ends_with_soft_newline)))
                        {
                                current_underline = true;
                                underlined_chars = 0;
                                underline_position = 0.0;
                                underline_thickness = 0.0;
                        }

                        // End of section
                        if (current_underline && !i->underline)
                        {
                                underline_sections.push_back(std::make_pair(underline_position/underlined_chars, underline_thickness/underlined_chars));
                                current_underline = false;
                        }

                        // In section
                        if (current_underline)
                        {
                                underlined_chars++;
                                underline_position += i->underline_position;
                                underline_thickness += i->underline_thickness;
                        }

                }
        }

        // Check if we were still inside a section
        if (current_underline)
                underline_sections.push_back(std::make_pair(underline_position/underlined_chars, underline_thickness/underlined_chars));

        current_underline = false;

        std::vector< std::pair<double, double> >::const_iterator section_iterator = underline_sections.begin();

        // Loop through all words on this row
        for (std::vector<Word>::const_iterator word_iterator = words.begin();
                word_iterator != words.end(); ++word_iterator)
        {
                // When the line ends with just spaces and a return, we don't have to do anything anymore (i.e. no underlining)
                if (word_iterator->OnlySpaces() && (word_iterator->ends_with_newline || word_iterator->ends_with_soft_newline))
                        break;

                last_text_x = current_x;

                // Now loop through all symbols, untill we discover a change
                for (std::vector<Symbol>::const_iterator i = word_iterator->symbols.begin();
                        i != word_iterator->symbols.end(); ++i)
                {
                        // The first time, set everything
                        if(first)
                        {
                                current_font      = i->font;
                                current_font_size = i->font_size;
                                current_fontcolor = i->color;
                                current_offset    = 0.0;
                                current_shadow    = i->shadow;

                                first = false;
                        }

                        // Start of underline section
                        if (!current_underline && i->underline && !(i->c == ' ' && (word_iterator->ends_with_newline || word_iterator->ends_with_soft_newline)))
                        {
                                current_underline = true;
                                underline_color = i->color;
                                last_underline_x = current_x;
                        }

                        // End of underline section
                        if (current_underline && !i->underline)
                        {
                                Underline(underline_color, section_iterator->first, section_iterator->second, temp_drawobject,
                                        last_underline_x, current_shadow, current_x, rowbox, textbox, text_direction, current_font_size);

                                current_underline = false;
                                ++section_iterator;
                        }

                        // When the color changes in a section, draw the line
                        if (current_underline && underline_color != i->color)
                        {
                                Underline(underline_color, section_iterator->first, section_iterator->second, temp_drawobject,
                                        last_underline_x, current_shadow, current_x, rowbox, textbox, text_direction, current_font_size);

                                last_underline_x = current_x;
                                underline_color = i->color;
                        }

                        // When there is a change in font settings, render everything up to now
                        if(current_font != i->font ||
                           current_font_size.width != i->font_size.width ||
                           current_font_size.height != i->font_size.height ||
                           current_fontcolor != i->color ||
                           current_offset != i->offset ||
                           current_shadow != i->shadow)
                        {
                                RenderText(current_font, current_font_size, current_fontcolor, current_offset, current_shadow, text_angle, text_direction,
                                        rowbox, textbox, current_string, last_text_x, current_x, temp_drawobject, letterspacing);

                                last_text_x = current_x;

                                current_font = i->font;
                                current_font_size = i->font_size;
                                current_fontcolor = i->color;
                                current_offset = i->offset;
                                current_shadow = i->shadow;

                                current_string.clear();
                        }

                        if (i->bitmap)
                        {
                                RenderText(current_font, current_font_size, current_fontcolor, current_offset, current_shadow, text_angle, text_direction,
                                        rowbox, textbox, current_string, last_text_x, current_x, temp_drawobject, letterspacing);

                                // And display the bitmap
                                DrawLib::ISize newsize(i->bitmap->GetWidth()/i->bitmap->GetHeight()*i->font_size.width*bitmap_scaling, i->font_size.height*bitmap_scaling);
                                DrawLib::FPPoint bitmap_pos = GetFinalPosition(text_direction, rowbox, textbox,
                                                                                  last_text_x, -newsize.height);


                                std::unique_ptr<DrawLib::Bitmap32 > resized_bitmap(DrawLib::CreateResizedBitmap(*i->bitmap, newsize));
                                if(resized_bitmap.get())
                                        temp_drawobject.DrawBitmap(*resized_bitmap, DrawLib::XForm2D(1,0,0,1,bitmap_pos));

                                current_x += i->width;
                                last_text_x = current_x;
                                current_string.clear();


                        }
                        else if (i->c != '\t' && i->c != ' ')
                        {
                                current_string.push_back(i->c);
                                current_x += i->width;
                        }
                        else if (word_iterator->spaces_width)
                        {
                                last_text_x += i->width;
                                current_x += i->width;
                        }
                }

                // Always render the last part
                RenderText(current_font, current_font_size, current_fontcolor, current_offset, current_shadow, text_angle, text_direction,
                        rowbox, textbox, current_string, last_text_x, current_x, temp_drawobject, letterspacing);

                last_text_x = current_x;
                current_string.clear();
        }

        if (current_underline)
                Underline(underline_color, section_iterator->first, section_iterator->second, temp_drawobject,
                        last_underline_x, current_shadow, current_x, rowbox, textbox, text_direction, current_font_size);

}

void Row::Underline(DrawLib::Pixel32 color, double position, double thickness, DrawObject &temp_drawobject,
        double last_underline_x, int current_shadow, double current_x, FPBoundingBox const &rowbox, FPBoundingBox const &textbox,
        int text_direction, DrawLib::FPSize font_size)
{
        temp_drawobject.SetOutlineWidth(thickness);
        temp_drawobject.SetOutlineEndcapMode(DrawLib::OutlineEndcapModes::Flat);

        DrawLib::FPPoint start_pos = GetFinalPosition(text_direction, rowbox, textbox,
                                                          last_underline_x, position);
        DrawLib::FPPoint end_pos = GetFinalPosition(text_direction, rowbox, textbox,
                                                           current_x      , position);

        if (current_shadow == shadow)
        {
                //ADDME: Duplicate of below (merge)
                FPPoint shadow_position(std::max(font_size.width*0.04,1.0), std::max(font_size.height*0.04,1.0));

                // Estimated the shadow repositioning factor to 0.04
                temp_drawobject.SetOutlineColor(GetShadowColor(background_color));
                temp_drawobject.DrawLine(start_pos+shadow_position,
                                         end_pos+shadow_position);
        }
        if (current_shadow == emboss)
        {
                //ADDME: Duplicate of below (merge)
                FPPoint emboss_position(std::max(font_size.width*0.02,1.0), std::max(font_size.height*0.02,1.0));

                temp_drawobject.SetOutlineColor(GetUpperEmbossColor(background_color));
                temp_drawobject.DrawLine(start_pos-emboss_position,
                                         end_pos-emboss_position);

                temp_drawobject.SetOutlineColor(GetLowerEmbossColor(background_color));
                temp_drawobject.DrawLine(start_pos+emboss_position,
                                         end_pos+emboss_position);
        }

        temp_drawobject.SetOutlineColor(current_shadow == emboss ? background_color : color);
        temp_drawobject.DrawLine(GetFinalPosition(text_direction, rowbox, textbox,
                                                  last_underline_x, position),
                                  GetFinalPosition(text_direction, rowbox, textbox,
                                                   current_x      , position));
}

void Row::RenderText(DrawLib::Font *current_font, DrawLib::FPSize current_font_size,
        DrawLib::Pixel32 current_fontcolor, double current_offset, int current_shadow, double text_angle,
        int text_direction, FPBoundingBox const &rowbox, FPBoundingBox const &textbox,
        Blex::UnicodeString const &current_string, double last_text_x, double /*current_x*/, DrawObject &temp_drawobject, double letterspacing)
{
        std::vector<double> deltas;
        DrawLib::FPSize font_size;

        if (current_offset != 0.0) //Subscript/superscript require a smaller fontsize (0.65 is an estimate)
                font_size = FPSize(current_font_size.width*0.65, current_font_size.height*subscript_factor);
        else
                font_size = current_font_size;
        current_font->SetSize(font_size);

        DrawLib::FPPoint pos = GetFinalPosition(text_direction, rowbox, textbox, last_text_x, -current_font_size.width*current_offset/100);
        if (current_shadow == shadow)
        {
                //ADDME: Duplicate of above (merge)
                // Estimated the shadow repositioning factor to 0.04
                FPPoint shadow_position(std::max(font_size.width*0.04,1.0), std::max(font_size.height*0.04,1.0));

                current_font->SetColor(GetShadowColor(background_color));
                temp_drawobject.DrawTextExtended(
                        pos+shadow_position,
                        current_string, *current_font, deltas, false, TextRenderer::LEFT, TextRenderer::BASELINE,
                        text_angle, text_angle, letterspacing);
        }
        if (current_shadow == emboss)
        {
                //ADDME: Duplicate of above (merge)
                FPPoint emboss_position(std::max(font_size.width*0.02,1.0), std::max(font_size.height*0.02,1.0));

                current_font->SetColor(GetUpperEmbossColor(background_color));
                // The emboss repositioning factor in PowerPoint is not relative to the font size
                // But I think it's nicer to have it relative to the font size
                temp_drawobject.DrawTextExtended(
                        pos-emboss_position,
                        current_string, *current_font, deltas, false, TextRenderer::LEFT, TextRenderer::BASELINE,
                        text_angle, text_angle,letterspacing);

                // Draw with a lighter color
                current_font->SetColor(GetLowerEmbossColor(background_color));
                temp_drawobject.DrawTextExtended(
                        pos+emboss_position,
                        current_string, *current_font, deltas, false, TextRenderer::LEFT, TextRenderer::BASELINE,
                        text_angle, text_angle,letterspacing);
        }

        current_font->SetColor(current_shadow == emboss ? background_color : current_fontcolor);
        temp_drawobject.DrawTextExtended(
                pos, current_string, *current_font, deltas, false, TextRenderer::LEFT, TextRenderer::BASELINE,
                text_angle, text_angle,letterspacing);
}

DrawLib::FPPoint Row::GetFinalPosition(int text_direction,
        DrawLib::FPBoundingBox const& rowbox,
        DrawLib::FPBoundingBox const& textbox,
        double x_offset, double y_offset) const
{
        //Does this work for powerpoint too?

        switch(text_direction)
        {
        case 0:
                return DrawLib::FPPoint(
                        rowbox.upper_left.x            + x_offset,
                        rowbox.upper_left.y + ascender + y_offset);

        case 1:
                return DrawLib::FPPoint(
                        textbox.upper_left.x + (textbox.lower_right.x - (rowbox.upper_left.y + ascender )) - y_offset,
                        textbox.upper_left.y + ((rowbox.upper_left.x + x_offset) - textbox.upper_left.y));

        case 2:
                return DrawLib::FPPoint(
                        rowbox.upper_left.y + ascender + y_offset,
                        textbox.upper_left.y + (textbox.lower_right.y - (rowbox.upper_left.x + x_offset)));
        }

        return DrawLib::FPPoint();
}

FontCacher::FontCacher()
: font_manager(DrawLib::GetGlobalFontManager())
{
}

DrawLib::Font *FontCacher::GetFont(
        std::string const &face, bool bold, bool italic)
{
        std::string style;
        if(bold && italic)
                style = "Bold Italic";
        else if(bold)
                style = "Bold";
        else if(italic)
                style = "Italic";
        else
                style = "Regular";

        std::string key = face + ',' + style;

        // Is this font already in the cache ?:
        FontCachePos pos = cache.find(key);
        if(pos != cache.end())
                return pos->second.get();

        // Font not yet in the cache, create it:
        DrawLib::Font *font = font_manager.CreateFontFromFile(face, style);

        // Add it to the cache:
        cache.insert(FontCacheValue(key, FontPtr(font)));

        // .. and also return it:
        return font;
}

} //end namespace DrawLib::Text

using namespace Text;


TextFormatter::TextFormatter(DrawLib::XForm2D const &scaling, DrawLib::Pixel32 background_color)
: background_color(background_color)
, mode(1) // Default to PowerPoint mode
, paragraph_locked(false)
, next_word_index  (0)
, next_symbol_index(0)
, accept_spaces_for_next_word(true)
, scaling(scaling)
{
        // Reset the font settings
        ResetFontSettings();
        // Initialize and reset the paragraph settings
        par_settings.push_back(Paragraph());
}

TextFormatter::~TextFormatter()
{
}

void TextFormatter::ParseText(const char *start, const char *limit)
{
        //ADDME: Do bulk transfers to the text renderer?
        for (;start!=limit;++start)
        {
                // When the user wants to type text, we have to lock and 'parse' the paragraph settings
                if (!paragraph_locked)
                        paragraph_locked = true;

                if (*start == '\0')
                        continue;

                // Soft newline
                if (*start == '\v')
                {
                        if (!current_word.IsEmpty())
                        {
                            current_word.ends_with_soft_newline = true;
                            EndWord();
                        }
                        accept_spaces_for_next_word = true;
                        continue;
                }

                //Word separator?
                if (*start == ' ' && !accept_spaces_for_next_word)
                {
                        EndWord();
                        accept_spaces_for_next_word=true;
                        AddToWord(' '); //add this space immediately to the new next word
                        continue;
                }

                // Tab
                if (*start == '\t')
                {
                        if (!current_word.IsEmpty())
                            EndWord();
                        AddToWord('\t'); //FIXME: We have to add a character here, because otherwise
                                         // the font settings (color, size, etc.) will be lost if this
                                         // word only consists of this tab (there will be no symbols
                                         // in the word)
                                         // It coule be a good idea to rewrite the whole word/symbol part
                                         // since it seems to be quite messy
                        current_word.has_tab = true;
                        accept_spaces_for_next_word = true;
                        continue;
                }

                //Plain character
                AddToWord(*start);

                if (*start != ' ') // The word content started.
                        accept_spaces_for_next_word=false;

                // A hyphen also ends a word:
                if (*start == '-')
                {
                        EndWord();
                        accept_spaces_for_next_word=true;
                }
        }
}

void TextFormatter::ParseText(uint16_t character)
{
        std::string result;
        Blex::UTF8Encoder<std::back_insert_iterator<std::string> > data_utf8_encoder(std::back_inserter(result));
        data_utf8_encoder(character);
        ParseText(result);
}

void TextFormatter::RenderText(DrawLib::Canvas32 &canvas,
        DrawLib::FPBoundingBox const &textbox,
        int text_direction,
        bool is_last_box,
        double letterspacing)
{
        double left   = textbox.upper_left.x;
        double top    = textbox.upper_left.y;
        double right  = textbox.lower_right.x;
        double bottom = textbox.lower_right.y;

        // Finish any leftover word?
        if (!current_word.IsEmpty())
            EndWord();

        // When there is no text to render, just return
        if (!words.size())
                return;

        // Append a newline when necessary
        if (!words.back().ends_with_newline)
                words.back().ends_with_newline = true;

        // The unrotates dimentions for rows:
        double row_width;
        double row_height;

        switch(text_direction)
        {
        case 0: // Horizontal, left to right:
                row_width  = right - left;
                row_height = bottom - top;
                break;

        case 1: // Vertical, top to bottom:
        case 2: // Vertical, bottom to top:
                row_width  = bottom - top;
                row_height = right - left;
                break;

        default:
                throw std::runtime_error("TextFormatter::RenderText: Unrecognized value for parameter 'text_direction'.");
        }

        //FIXME! THESE CORRECTIONS SHOULD NOT BE IN DRAWLIB (they are Word-specific ?)
        //ADDME: Review these corrections, rerieved from practice:
        row_width  += 2;
        row_height += 1;

        // In rare cases this holds true.It is best to do nothing at all in these cases.
        if(row_width < 0)
                return;

        // The (unrotaed) y-position of the current row in pixels:
        double row_pos = 0;

        bool skip_first_spaces = false;

        // Find all rows and render them:
        std::unique_ptr<Text::Row> next_row;
        for(;;)
        {
                BackupRenderPosition();

                // Determine Paragraph settings for this row
                Paragraph parsetting;
                if (next_word_index < words.size() && words[next_word_index].symbols.size())
                        parsetting = par_settings[words[next_word_index].symbols[0].par_index];

                // Fill in all tab_stops, according to the render width of this row
                CalculateAllTabStops(parsetting, row_width, !skip_first_spaces);

                next_row.reset(GetNextRow(row_width, skip_first_spaces, parsetting));

                //Determine the relative linespacing
                double line_spacing;
                if (parsetting.line_spacing_relative)
                        line_spacing = parsetting.line_spacing;
                else // (10.0/9.0) = (4.0/3.0) * 1.2).. lines are 1.2 times fontsize
                        line_spacing = (parsetting.line_spacing * (10.0/9.0) / next_row->line_height);  //If line_height is already in pixels..

                // Add spacing before paragraph
                //FIXME: Determine paragraph begin..
                if (parsetting.spacing_before_relative)
                        row_pos += next_row->line_height * parsetting.spacing_before;
                else
                        row_pos += parsetting.spacing_before * (10.0/9.0);

                // Go to the new baseline:
                row_pos += (next_row->line_height + next_row->descender) * line_spacing;

                // Is this row empty , because this is the end of the text,
                // or does it not any more fit in the box ?:
                if (next_row->ascender==0.0 || (!is_last_box &&
                        row_pos - next_row->descender >= row_height))
                {
                        RecallRenderPosition();
                        break;
                }

                // Get the unrotated bounding box for the next row:
                DrawLib::FPBoundingBox unrotated_row_box;
                switch(text_direction)
                {
                case 0: // Horizontal, left to right:
                        unrotated_row_box = DrawLib::FPBoundingBox(
                                left, top + row_pos - next_row->ascender,
                                right,std::min(top + row_pos - next_row->descender, bottom));
                        break;

                case 1: // Vertical, top to bottom:
                case 2: // Vertical, bottom to top:
                        unrotated_row_box = DrawLib::FPBoundingBox(
                                top, left + row_pos - next_row->ascender,
                                bottom,std::min(left + row_pos + next_row->descender, right));
                        break;
                }


                ///// Now do the rendering of the row, using the unrotated box: ///////
                next_row->Render(unrotated_row_box, text_direction, textbox, canvas, parsetting, skip_first_spaces, letterspacing);

/* FIXME                // From baseline to bottem of line
                if (parsetting.line_spacing_relative)
                        //row_pos += (next_row->linegap - next_row->descender) * parsetting.line_spacing;
                        row_pos += (-next_row->descender) * parsetting.line_spacing;
                else
                        //row_pos += 0.2 * parsetting.line_spacing;
                        row_pos += 0.2 * parsetting.line_spacing;

                // Add spacing after paragraph
                if (parsetting.spacing_after_relative)
                        //row_pos += (next_row->ascender - next_row->descender + next_row->linegap*1.5) * parsetting.spacing_after;
                        row_pos += (line_height) * parsetting.spacing_after;
                else
                        row_pos += parsetting.spacing_after; */

                // From baseline to bottem of line
                row_pos += (-next_row->descender) * line_spacing;

                // Add spacing after paragraph
                //FIXME: Determine paragraph..
                if (next_row->ends_with_newline)
                {
                        if (parsetting.spacing_after_relative)
                                row_pos += next_row->line_height * parsetting.spacing_after;
                        else
                                row_pos += parsetting.spacing_after * (10.0/9.0);
                }


                if(is_last_box && row_pos >= row_height)
                {
                        RecallRenderPosition();
                        break;
                }

                skip_first_spaces = !next_row->ends_with_newline;
        }
}

Row *TextFormatter::GetNextRow(double width, bool skip_first_spaces, Paragraph const &parsetting)
{
        std::unique_ptr<Row> row;
        row.reset(new Row);
        row->background_color = background_color;

        // Now update the current width
        double left_indent = skip_first_spaces ? parsetting.left_indent : parsetting.firstline_indent;
        row->width = left_indent;

        for(;;)
        {
                if(next_word_index >= words.size())
                {
                        row->width += parsetting.right_indent;
                        return row.release();
                }

                Word next_word = words[next_word_index];

                // When this was a cut-off word, put it directly at the root
                if(next_symbol_index)
                {
                        if(next_word.CutFirstSymbols(next_symbol_index))
                        { // Word has been cleared by cutting it?
                                ++next_word_index;
                                next_symbol_index = 0;
                                continue;
                        }
                }
                // When this word contains a fixed tab, see if we can jump to the correct tablevel
                else if (next_word.has_tab && next_word.fixed_tab_stop)
                {
                        if (parsetting.tab_stops.size() >= next_word.fixed_tab_stop
                            && row->width < parsetting.tab_stops[next_word.fixed_tab_stop-1])
                        {
                                next_word.symbols[0].width = parsetting.tab_stops[next_word.fixed_tab_stop-1] - row->width;
                                next_word.spaces_width += parsetting.tab_stops[next_word.fixed_tab_stop-1] - row->width;
                        }
                        else
                                next_word.symbols[0].width = 0;
                }
                // When this word contains a normal tab, find the correct tablevel
                else if (next_word.has_tab)
                {
                        // Look through all tabstops, and find the one correct one
                        std::vector<double>::const_iterator it;
                        for (it=parsetting.tab_stops.begin();
                                it!=parsetting.tab_stops.end(); ++it)
                        {
                                if (*it > row->width)
                                {
                                        // We found a tabstop, update the 'spaces' of this row
                                        next_word.symbols[0].width = *it - row->width;
                                        next_word.spaces_width += *it - row->width;
                                        break;
                                }
                        }

                        // No new tabstop found? Move on to the next row
                        if (it==parsetting.tab_stops.end())
                        {
                                row->width += parsetting.right_indent;
                                return row.release();
                        }
                }

                // Does the next word fit on the (next) row?
                if(row->width + (skip_first_spaces?0:next_word.spaces_width) + next_word.width >= width-parsetting.right_indent)
                {
                        // Skip empty words (i.e. only spaces)
                        if (next_word.OnlySpaces())
                        {
                                next_word_index++;
                                break;
                        }

                        // Not any word on this row?
                        if(row->IsEmpty())
                        {
                                // Create a 'cut' word, and put it on the row
                                Word w = next_word;
                                next_symbol_index += w.CutForWidth(width - row->width - parsetting.right_indent);
                                row->AddWord(w, true && !next_word.has_tab);
                        }
                        break;
                }

                if (next_word_index > 0)
                        row->AddWord(next_word, skip_first_spaces && !next_word.has_tab && !words[next_word_index-1].ends_with_soft_newline);
                else
                        row->AddWord(next_word, skip_first_spaces && !next_word.has_tab);

                next_symbol_index = 0;
                ++next_word_index;
                skip_first_spaces = false;

                // Is there a hard word break after the last word ?:
                if(next_word.ends_with_newline || next_word.ends_with_soft_newline)
                {
                        if (next_word.ends_with_newline)
                                row->SetEndsWithNewline(true);
                        break;
                }
        }

        row->width += parsetting.right_indent;
        return row.release();
}

void TextFormatter::AddToWord(char next_ch)
{
        //UTF-8 conversion
        uint32_t unicodechar = utf8decoder(next_ch);

        if (unicodechar != Blex::UTF8DecodeMachine::NoChar && unicodechar != Blex::UTF8DecodeMachine::InvalidChar) //we got a complete character
        {
                EnsureFontOpened();
                Symbol next_symbol(current_open_font, current_font_size * scaling, unicodechar, NULL,
                        current_underline, current_shadow, par_settings.size()-1, current_fontcolor, current_offset, mode);

                current_word.AddSymbol(next_symbol);
        }
}

void TextFormatter::AddFixedTab(unsigned tab_stop)
{
        if (!current_word.IsEmpty())
            EndWord();

        EnsureFontOpened();
        Symbol next_symbol(current_open_font, current_font_size * scaling, '\t', NULL,
                current_underline, current_shadow, par_settings.size()-1, current_fontcolor, current_offset, mode);
        current_word.AddSymbol(next_symbol);

        current_word.fixed_tab_stop = tab_stop;
        current_word.has_tab = true;
        accept_spaces_for_next_word = true;

}

void TextFormatter::AddBitmap(DrawLib::Bitmap32 const *bitmap)
{
        EnsureFontOpened();
        Symbol next_symbol(current_open_font, current_font_size * scaling, ' ', bitmap,
                current_underline, current_shadow, par_settings.size()-1, current_fontcolor, current_offset, mode);
        current_word.AddSymbol(next_symbol);
}

void TextFormatter::EndParagraph()
{
        //Finish any leftover word?
        if (!current_word.IsEmpty())
            EndWord();

        // Is this an empty line/row?
        if(!words.size() || words.rbegin()->ends_with_newline || words.rbegin()->ends_with_soft_newline)
        {
                current_word.AddSymbol(GetEmptySymbol());
                current_word.SetEndsWithNewline(true);
                words.push_back(current_word);
                current_word.Clear();
        }
        // This line is was not empty
        else
        {
                words.rbegin()->SetEndsWithNewline(true);
        }

        // Open a new paragraph, based on the current paragraph settings
        par_settings.push_back(par_settings.back());
        paragraph_locked = false;

        // Accept spaces again
        accept_spaces_for_next_word = true;
}

void TextFormatter::EndWord()
{
        words.push_back(current_word);
        current_word.Clear();
}

void TextFormatter::ResetFontSettings()
{
        current_open_font = NULL;
        current_font_face = "Times New Roman";
        current_font_size = DrawLib::FPSize(12.0, 12.0);
        current_font_bold   = false;
        current_font_italic = false;
        current_underline   = false;
        current_shadow      = normal;
        current_fontcolor = DrawLib::Pixel32(0,0,0);
        current_offset = 0.0;
}

Symbol TextFormatter::GetEmptySymbol()
{
        EnsureFontOpened();
        return Symbol(current_open_font, current_font_size * scaling, ' ', NULL, false, false, par_settings.size()-1, current_fontcolor, current_offset, mode);
}

void TextFormatter::SetMode(int mode_)
{
        mode = mode_;
}

void TextFormatter::SetBold(bool enable)
{
        current_font_bold = enable;
        current_open_font = NULL;
}
void TextFormatter::SetItalics(bool enable)
{
        current_font_italic = enable;
        current_open_font = NULL;
}
void TextFormatter::SetUnderline(bool enable)
{
        current_underline = enable;
}

void TextFormatter::SetShadow(bool enable)
{
        if (current_shadow == shadow && !enable)
                current_shadow = normal;
        if (enable)
                current_shadow = shadow;
}

void TextFormatter::SetEmboss(bool enable)
{
        if (current_shadow == emboss && !enable)
                current_shadow = normal;
        if (enable)
                current_shadow = emboss;
}

void TextFormatter::OpenFont()
{
        current_open_font = font_cacher.GetFont(current_font_face, current_font_bold, current_font_italic);
        if(!current_open_font)
        {
                //Liberation Serif is a Times New Roman compatible font that we _can_ ship
                current_open_font = font_cacher.GetFont("Liberation Serif", current_font_bold, current_font_italic);
                if (!current_open_font) //FIXME: Which is the PROPER fallback font to use? Should perhaps be specfied by Caller?! Perhaps caller should be required to set a proper default font settings?
                    throw std::runtime_error("Cannot find fallback font (Liberation Serif) to substitute for '" + current_font_face + "' - were any fonts installed for WebHare at all?");
        }
}

void TextFormatter::SetFontFace(std::string const &fontname)
{
        current_font_face = fontname;

        //Truncate font name after first comma, if any (ADDME: Those are fallback fonts, iterate if font is unknown)
        std::string::iterator lastcomma = std::find(current_font_face.begin(), current_font_face.end(), ',');
        current_font_face.erase(lastcomma, current_font_face.end());
        current_open_font = NULL;
}

void TextFormatter::SetFontSize(DrawLib::FPSize fontsize)
{
        current_font_size = fontsize;
}

void TextFormatter::SetFontColor(DrawLib::Pixel32 fontcolor)
{
        current_fontcolor = fontcolor;
}

void TextFormatter::SetOffset(double offset)
{
        current_offset = offset;
}

void TextFormatter::ResetParagraphSettings()
{
        if (paragraph_locked)
                throw std::runtime_error("Cannot change paragraph settings in the middle of a paragraph");
        par_settings.back() = Paragraph();
}

void TextFormatter::SetAlignment(int alignment)
{
        if (paragraph_locked)
                throw std::runtime_error("Cannot change paragraph settings in the middle of a paragraph");
        par_settings.back().alignment = alignment;
}

void TextFormatter::SetFirstLineIndent(double indentation)
{
        if (paragraph_locked)
                throw std::runtime_error("Cannot change paragraph settings in the middle of a paragraph");
        par_settings.back().firstline_indent = indentation * scaling.eM11;
}

void TextFormatter::SetFirstLineTabStop(double stop)
{
        if (paragraph_locked)
                throw std::runtime_error("Cannot change paragraph settings in the middle of a paragraph");
        par_settings.back().firstline_tab_stop = stop * scaling.eM11;
}

void TextFormatter::SetLeftIndent(double indentation)
{
        if (paragraph_locked)
                throw std::runtime_error("Cannot change paragraph settings in the middle of a paragraph");
        par_settings.back().left_indent = indentation * scaling.eM11;
}

void TextFormatter::SetRightIndent(double indentation)
{
        if (paragraph_locked)
                throw std::runtime_error("Cannot change paragraph settings in the middle of a paragraph");
        par_settings.back().right_indent = indentation * scaling.eM11;
}

void TextFormatter::AddTabStop(double stop)
{
        if (paragraph_locked)
                throw std::runtime_error("Cannot change paragraph settings in the middle of a paragraph");
        par_settings.back().tab_stops.push_back(stop * scaling.eM11);
}

void TextFormatter::SetDefaultTab(double tabsize)
{
        if (paragraph_locked)
                throw std::runtime_error("Cannot change paragraph settings in the middle of a paragraph");
        if (tabsize <= 0)
                throw std::runtime_error("Invalid factor supplied for default tab (has to be higher than 0)");
        par_settings.back().tab_size = tabsize * scaling.eM11;
}

void TextFormatter::SetLineSpacingFactor(double factor)
{
        if (paragraph_locked)
                throw std::runtime_error("Cannot change paragraph settings in the middle of a paragraph");
        if (factor <= 0)
                throw std::runtime_error("Invalid factor supplied as line spacing factor(has to be higher than 0)");
        par_settings.back().line_spacing = factor;
        par_settings.back().line_spacing_relative = true;
}

void TextFormatter::SetLineSpacingAbsolute(double line_spacing)
{
        if (paragraph_locked)
                throw std::runtime_error("Cannot change paragraph settings in the middle of a paragraph");
        if (line_spacing <= 0)
                throw std::runtime_error("Invalid factor supplied for absolute line spacing (has to be higher than 0)");
        par_settings.back().line_spacing = line_spacing * scaling.eM22;
        par_settings.back().line_spacing_relative = false;
}

void TextFormatter::SetSpacingBeforeFactor(double factor)
{
        if (paragraph_locked)
                throw std::runtime_error("Cannot change paragraph settings in the middle of a paragraph");
        if (factor < 0)
                throw std::runtime_error("Invalid factor supplied as spacing before factor(has to be higher than 0)");
        par_settings.back().spacing_before = factor;
        par_settings.back().spacing_before_relative = true;
}

void TextFormatter::SetSpacingBeforeAbsolute(double spacing)
{
        if (paragraph_locked)
                throw std::runtime_error("Cannot change paragraph settings in the middle of a paragraph");
        if (spacing < 0)
                throw std::runtime_error("Invalid factor supplied for absolute spacing before (has to be higher than 0)");
        par_settings.back().spacing_before = spacing * scaling.eM22;
        par_settings.back().spacing_before_relative = false;
}

void TextFormatter::SetSpacingAfterFactor(double factor)
{
        if (paragraph_locked)
                throw std::runtime_error("Cannot change paragraph settings in the middle of a paragraph");
        if (factor < 0)
                throw std::runtime_error("Invalid factor supplied as spacing after factor(has to be higher than 0)");
        par_settings.back().spacing_after = factor;
        par_settings.back().spacing_after_relative = true;
}

void TextFormatter::SetSpacingAfterAbsolute(double spacing)
{
        if (paragraph_locked)
                throw std::runtime_error("Cannot change paragraph settings in the middle of a paragraph");
        if (spacing < 0)
                throw std::runtime_error("Invalid factor supplied for absolute spacing before (has to be higher than 0)");
        par_settings.back().spacing_after = spacing * scaling.eM22;
        par_settings.back().spacing_after_relative = false;
}

void TextFormatter::CalculateAllTabStops(Paragraph &parsetting, double max_tab_stop, bool first_line)
{
//        bool handled_left = false;
        std::vector<double> all_tab_stops;
        double current_stop = 0.0;

        // The first line can be different
        if (first_line && parsetting.firstline_tab_stop > 0.0)
                all_tab_stops.push_back(parsetting.firstline_tab_stop);

        // Fill all 'programmed' tab stops first
        for (std::vector<double>::const_iterator it = parsetting.tab_stops.begin();
                it != parsetting.tab_stops.end(); ++it)
        {

                if (!first_line || parsetting.firstline_tab_stop <= 0.0 || *it > parsetting.firstline_tab_stop)
                {
                        current_stop = *it;
                        all_tab_stops.push_back(*it);
                }

/*                // Check if the left indent is already included
               if (!handled_left && parsetting.left_indent < *it)
                {
                        all_tab_stops.push_back(parsetting.left_indent);
                        handled_left = true;
                }*/
        }

        // When we didn't handle the left indent before, do that now
/*        if (!handled_left)
        {
                all_tab_stops.push_back(parsetting.left_indent);
                handled_left = true;
                current_stop = parsetting.left_indent;
        }*/

        // Fill the rest with default tab stops round
        current_stop = (floor(current_stop / parsetting.tab_size) + 1.0) * parsetting.tab_size;
        while (current_stop < max_tab_stop)
        {
                all_tab_stops.push_back(current_stop);
                current_stop += parsetting.tab_size;
        }

        // And update the tab_stops
        parsetting.tab_stops = all_tab_stops;
}

TextRenderer::~TextRenderer()
{
        ClearGlyphList();
}

 void TextRenderer::DrawText(Canvas32 &canvas,
        const Blex::UnicodeString &textstring,
        const FPPoint &position,
        const Font &myfont,
        const std::vector<double> &deltas,
        bool  antialiased,
        double baselinerotation,
        double glyphrotation,
        HorizontalAlignment halign,
        VerticalAlignment valign,
        double letterspacing)
{
        BuildGlyphList(textstring, myfont);
        LayoutGlyphList(myfont, deltas, !antialiased, antialiased, glyphrotation, letterspacing);
        FPBoundingBox bbox;
        BBox(&bbox, myfont);

        // the bbox is the bbox of these letters upside down, reverse it
        bbox.upper_left.y=-bbox.upper_left.y;
        bbox.lower_right.y=-bbox.lower_right.y;
        std::swap(bbox.upper_left.y,bbox.lower_right.y);

        // adjust for the current alignment

        double bound_xwidth = bbox.lower_right.x;

        double horiz_add = 0;
        double vert_add = 0;
        // The horizontal and vertical alignment are for the _unrotated_ text!!!!
        switch(valign)
        {
        case BASELINE:          // do nothing!
                break;
        case VCENTER:
                vert_add = -(bbox.upper_left.y + bbox.lower_right.y) / 2;
                break;
        case ASCENDER:
                DEBUGPRINT("align ascender: " << myfont.GetCurrentAscender());
                vert_add += myfont.GetCurrentAscender();
                break;
        case DESCENDER:
                DEBUGPRINT("align descender: " << myfont.GetCurrentDescender());
                vert_add -= myfont.GetCurrentDescender();
                break;
        case TOP:               // y = top coordinate
                vert_add = - bbox.upper_left.y;
                break;
        case BOTTOM:
                vert_add = - bbox.lower_right.y;
                break;

        default: //FIXME: lacks BOTTOM handling
                break;
        }
        switch(halign)
        {
        case LEFT:              // do nothing!
                break;
        case CENTER:
                horiz_add = -(bound_xwidth/2.0);
                break;
        case RIGHT:
                horiz_add= -bound_xwidth;
                break;
        default:
                break;
        }

        FPPoint pos(position);
        // Rotate the vert and horiz add components to suite the orientation!
        pos.x += horiz_add * cos(-2.0*M_PI * baselinerotation /360.0) - vert_add  * sin(-2.0*M_PI * baselinerotation /360.0);
        pos.y += horiz_add * sin(-2.0*M_PI * baselinerotation/360.0) + vert_add  * cos(-2.0*M_PI * baselinerotation /360.0);

        RenderGlyphList(DrawLib::RoundFloat(pos.x), DrawLib::RoundFloat(pos.y), baselinerotation,
                glyphrotation, myfont, antialiased, canvas);
        ClearGlyphList();
}

double TextRenderer::GetFontAdvance(const Font &myfont)
{
        Blex::Mutex::AutoLock freetype_use(freetype_use_lock);

        if (FT_IS_SCALABLE(myfont.data->face))
        {
                if (myfont.data->face->units_per_EM == 0)    //FIXME: Should this be possible? it is caused by xMF file in D3Part2Final from Susanne's testdocs
                        return 0.0;                        //NIELS: Nee, zou niet mogen, corrupte .TTF?

                // for TrueType(tm) fonts...
                double t = myfont.data->face->units_per_EM;
                //return ((double)(myfont.data->face->max_advance_height)* myfont.data->EMSize)/t;
                return ((double)(myfont.data->face->ascender)* myfont.data->EMSize)/t;
        }
        else
        {
                // for PCF fonts..
                return 9.0;
        }
}

FPBoundingBox TextRenderer::CalculateBoundingBox(
        const Blex::UnicodeString &textstring,
        const FPPoint &/*position*/,
        const Font &myfont,
        const std::vector<double> &deltas,
        bool  antialiased,
        double /*baselinerotation*/,
        double glyphrotation,
        HorizontalAlignment /*halign*/,
        VerticalAlignment /*valign*/,
        double letterspacing)
{
        FPBoundingBox ftbbox;

        BuildGlyphList(textstring, myfont);
        LayoutGlyphList(myfont, deltas, !antialiased, antialiased, glyphrotation, letterspacing);

        BBox(&ftbbox, myfont);
        ClearGlyphList();
        return ftbbox;
}

void TextRenderer::BBox(FPBoundingBox  *mybbox, const Font &myfont)
{
        Blex::Mutex::AutoLock freetype_use(freetype_use_lock);
        // bail if there are no glyphs to process!
        if (glyphlist.size()==0)
        {
                //no need to have an abbox, it is never used!!
                mybbox->upper_left.x = 0;
                mybbox->upper_left.y = 0;
                mybbox->lower_right.x = 0;
                mybbox->lower_right.y = 0;
                return;
        }

        FT_BBox  abbox;
        abbox.xMin = 0x0FFFFFFF;
        abbox.yMin = 0x0FFFFFFF;
        abbox.xMax = -0x0FFFFFFF;
        abbox.yMax = -0x0FFFFFFF;

        for(unsigned n=0; n<glyphlist.size(); ++n)
        {
                FT_Glyph        image;
                FT_Vector       vec;
                FT_Error        error;

                if (!glyphlist[n]->image)
                        continue;

                error = FT_Glyph_Copy(glyphlist[n]->image, &image);
                if (error)
                        continue;

                vec = glyphlist[n]->pos;
                //FT_Vector_Transform(&vec, &trans_matrix);
//                vec.x += delta.x;
//                vec.y += delta.y;
                if (FT_IS_SCALABLE((myfont.data->face)))
                        error = FT_Glyph_Transform(image, 0, &vec);
                else
                {
                        ((FT_BitmapGlyph)image)->left += (vec.x >> 6);
                }
                if (!error)
                {
                        FT_BBox bbox;
                        FT_Glyph_Get_CBox(image, ft_glyph_bbox_pixels, &bbox);
                        if (abbox.xMin > bbox.xMin)
                            abbox.xMin = bbox.xMin;

                        if (abbox.yMin > bbox.yMin)
                            abbox.yMin = bbox.yMin;

                        if (abbox.xMax < bbox.xMax)
                            abbox.xMax = bbox.xMax;

                        if (abbox.yMax < bbox.yMax)
                            abbox.yMax = bbox.yMax;
                }
                FT_Done_Glyph(image);
        }
        mybbox->upper_left.x =  abbox.xMin;
        mybbox->upper_left.y =  abbox.yMin;
        mybbox->lower_right.x = abbox.xMax;
        mybbox->lower_right.y = abbox.yMax;
        // convert abbox to mybbox..
}



void TextRenderer::ClearGlyphList()
{
        for(unsigned int i=0; i<glyphlist.size(); i++)
        {
                FT_Done_Glyph(glyphlist[i]->image);
                delete glyphlist[i];
        }
        glyphlist.clear();
}

void TextRenderer::BuildGlyphList(const Blex::UnicodeString &textstring, const Font &myfont)
{
        Blex::Mutex::AutoLock freetype_use(freetype_use_lock);
        ClearGlyphList();
        for(unsigned int i=0; i<textstring.size(); i++)
        {
                GlyphPtr newglyph = new TGlyph;
                glyphlist.push_back(newglyph);
                unsigned long unicode_code = textstring[i];
                // check if we have to add to get to the private area.. (for symbol fonts)
                if (myfont.data->use_private_area)
                        unicode_code += 0xF000;
                // get the glyph code from the charmap!
                FT_UInt glyph_index = FT_Get_Char_Index(myfont.data->face, unicode_code);
                newglyph->glyph_index = glyph_index;
                newglyph->image = NULL;
        }
}

/**
        Transforms text to be on the correct position on the baseline.
        After this step all glyphs have their x - position relative to (0,0)
*/
void TextRenderer::LayoutGlyphList(const Font &myfont, const std::vector<double> &deltas, bool hinting, bool kerning, double /*glyphrotation*/, double letterspacing)
{
        Blex::Mutex::AutoLock freetype_use(freetype_use_lock);
        FT_Vector       origin;
        FT_Pos          origin_x = 0;
        FT_UInt         prev_index = 0;
        FT_Error        error;

        bool use_deltas = false;
        if ((deltas.size() == glyphlist.size()-1) && (deltas.size()!=0))
                use_deltas = true;

        letterspacing *= 64;
        for(unsigned int n=0; n<glyphlist.size(); n++)
        {
                if (kerning)
               {
                        if (prev_index)
                        {
                                FT_Vector kern;
                                FT_Get_Kerning(myfont.data->face, prev_index, glyphlist[n]->glyph_index,
                                        hinting ? ft_kerning_default : ft_kerning_unfitted, &kern);
                                origin_x += kern.x;
                        }
                        prev_index = glyphlist[n]->glyph_index;
                }
                origin.x = origin_x;
                origin.y = 0;

                // for safety.. check if there was an image left..
                if (glyphlist[n]->image)
                        FT_Done_Glyph(glyphlist[n]->image);

                error = FT_Load_Glyph(myfont.data->face, glyphlist[n]->glyph_index,
                        hinting ? FT_LOAD_DEFAULT : FT_LOAD_NO_HINTING);

                if (error)
                        continue;

                error = FT_Get_Glyph((myfont.data->face)->glyph, &(glyphlist[n]->image));

                if (error)
                        continue;

                if (use_deltas && hinting)
                {
                        // if we use window's deltas, we should round the position to
                        // the nearest pixel to make sure we don't destroy FreeType's
                        // hinting!
                        FT_Vector origin2 = origin;
                        origin2.x = origin.x & 0xFFFFFFC0;
                        glyphlist[n]->pos = origin2;
                }
                else
                {
                        glyphlist[n]->pos = origin;
                }

                //NOTE: Glyphrotation is disabled.. and it sucks..

                //origin_x += static_cast<int>(cos(2.0*M_PI*glyphrotation/360.0) * (myfont.data->face)->glyph->advance.x
                //                          +  sin(2.0*M_PI*glyphrotation/360.0) * (myfont.data->face)->glyph->advance.y);

                if (use_deltas)
                {
                        if (n<glyphlist.size()-1)
                                origin_x += static_cast<FT_Pos>(deltas[n] * 64.0);
                }
                else
                    origin_x += (myfont.data->face)->glyph->advance.x;

                origin_x += letterspacing;
        }
}

void TextRenderer::RenderGlyphList(int x, int y, double baselinerotation, double glyphrotation,
        const Font &myfont, bool antialias,
        Canvas32 &mycanvas)
{
        Blex::Mutex::AutoLock freetype_use(freetype_use_lock);
        bool scalable;
        FT_Matrix glyph_trans_matrix;
        FT_Matrix baseline_trans_matrix;
        FT_Vector delta;
        FT_Error error;

        delta.x = x << 6;
        delta.y = 0;

        double angle = baselinerotation;
        baseline_trans_matrix.xx = (FT_Fixed)(0x010000* cos(2.0*M_PI*angle/360.0));
        baseline_trans_matrix.xy = (FT_Fixed)(0x010000*-sin(2.0*M_PI*angle/360.0));
        baseline_trans_matrix.yx = (FT_Fixed)(0x010000* sin(2.0*M_PI*angle/360.0));
        baseline_trans_matrix.yy = (FT_Fixed)(0x010000* cos(2.0*M_PI*angle/360.0));

        angle = glyphrotation;
        glyph_trans_matrix.xx = (FT_Fixed)(0x010000* cos(2.0*M_PI*angle/360.0));
        glyph_trans_matrix.xy = (FT_Fixed)(0x010000*-sin(2.0*M_PI*angle/360.0));
        glyph_trans_matrix.yx = (FT_Fixed)(0x010000* sin(2.0*M_PI*angle/360.0));
        glyph_trans_matrix.yy = (FT_Fixed)(0x010000* cos(2.0*M_PI*angle/360.0));


        // check for a scalable font (usually TrueType..)
        if (FT_IS_SCALABLE((myfont.data->face)))
            scalable = true;
        else
                scalable = false;     // unsupported .FON file???

        for (unsigned n=0; n<glyphlist.size(); n++)
        {
                FT_Glyph        image;
                FT_Vector       vec;

                if (!(glyphlist[n]->image))
                        continue;

                error = FT_Glyph_Copy(glyphlist[n]->image, &image);
                if (error)
                        continue;

                vec = glyphlist[n]->pos;
                // transform the direction vector!
                FT_Vector_Transform(&vec, &baseline_trans_matrix);
                // add the position offset!
                vec.x += delta.x;
                vec.y += delta.y;
                // hmmm.. check for scalability..
                if (scalable)
                {
                        // can't use FT_Glyph_Transform on non-scalable fonts!
                        // rotate the glyph using the trans_matrix and
                        // translate using the vector vec.
                        error = FT_Glyph_Transform(image, &glyph_trans_matrix, &vec);
                }
                else
                {
                        // if this is a .FON font.. we can still move it to the right
                        // position by changing the plot coordinate!
                        //((FT_BitmapGlyph)image)->left += (vec.x >> 6);
                }
                //uint32_t out_width  = _outputbitmap->width();
                //uint32_t out_height = _outputbitmap->height();
                if (error)
                        continue;

                if (image->format != ft_glyph_format_bitmap) //if it is scalable?
                {
                        error = FT_Glyph_To_Bitmap(&image,
                                antialias ? ft_render_mode_normal : ft_render_mode_mono, 0, 1);
                }
                else
                {
                        // make 26.6 fixedpoint
                        // transpose glyph to the right..
                        ((FT_BitmapGlyph)image)->left += (vec.x >> 6);
                        error = 0;
                }

                if (error)
                        continue;

                FT_BitmapGlyph bitmap   = (FT_BitmapGlyph)image;
                FT_Bitmap* source       = &bitmap->bitmap;  //yes.. dit is coole code

                FT_Pos x_top = bitmap->left;
                FT_Pos y_top = y - bitmap->top; //FT renders upside-down.

                if (source->pixel_mode==ft_pixel_mode_grays)
                        TextRendererFuncs::BlitGlyph(source, x_top, y_top, myfont, mycanvas);
                else
                        TextRendererFuncs::BlitMonoGlyph(source, x_top, y_top, myfont, mycanvas);
                FT_Done_Glyph(image);
        }

}

void TextRendererFuncs::BlitGlyph(const FT_Bitmap *glyphbitmap, int startx, int starty, const Font &myfont, Canvas32 &mycanvas)
{
        // check the bitmap format is multigray??
        if (glyphbitmap->pixel_mode!=ft_pixel_mode_grays)
                return; // only anti-aliased!

        int xsize = glyphbitmap->width;
        int ysize = glyphbitmap->rows;
        unsigned int pixel;
        unsigned char *glyphpixel = glyphbitmap->buffer;
        Scanline32 newscanline(mycanvas.GetWidth(), false);
        int canvaswidth = static_cast<int>(mycanvas.GetWidth());
        for(int y=0; y<ysize; y++)
        {
                if ((y+starty)<0)
                    continue;
                if ((uint32_t)(y+starty)>=mycanvas.GetHeight())
                    return;
                // reset the pixel mask of the scanline!
                for(unsigned x=0; x<newscanline.GetWidth(); x++)
                    newscanline.SetMask(x, false);

                for(int x=0; x<xsize; x++)
                {
                        pixel = *(glyphpixel+x+y*xsize);
                        if (pixel==0)
                                continue;
                        //get inverted version of that pixel
                        //calc weighted result of background and textcolor
                        if ((startx+x>=0) && (startx+x<canvaswidth))
                        {
                                uint8_t newalpha = static_cast<uint8_t>(pixel * myfont.data->fontcolor.GetA() / 255);
                                newscanline.Pixel(startx+x).SetRGBA(   myfont.data->fontcolor.GetR(),
                                                                        myfont.data->fontcolor.GetG(),
                                                                        myfont.data->fontcolor.GetB(),
                                                                        newalpha);
                                newscanline.SetMask(startx+x, true);
                        }
                }
                mycanvas.SetScanline32(y+starty, &newscanline);
        }
}

void TextRendererFuncs::BlitMonoGlyph(const FT_Bitmap *glyphbitmap, int startx, int starty, const Font &myfont, Canvas32 &mycanvas)
{
        // check the bitmap format is multigray??
        if (glyphbitmap->pixel_mode!=ft_pixel_mode_mono)
                return; // only on/off pixels wanted!

        int xsize = glyphbitmap->width;
        int ysize = glyphbitmap->rows;
        unsigned int pixel;
        unsigned char *glyphpixel = glyphbitmap->buffer;
        Scanline32 newscanline(mycanvas.GetWidth(),false);
        int canvaswidth = static_cast<int>(mycanvas.GetWidth());
        for(int y=0; y<ysize; y++)
        {
                if ((y+starty)<0) continue;
                if ((uint32_t)(y+starty)>=mycanvas.GetHeight()) return;
                // reset the pixel mask of the scanline!
                for(unsigned x=0; x<newscanline.GetWidth(); x++)
                        newscanline.SetMask(x, false);

                for(int x=0; x<xsize; x++)
                {
                        // get the right byte from the bitpacked bitmap
                        uint8_t bytecode = *(glyphpixel+(x>>3)+y*(glyphbitmap->pitch));
                        // extract the right bit by shifting!
                        pixel = (bytecode >> (7-(x & 0x07))) & 0x01;
                        // if the pixel is fully transparent bail!
                        if (pixel==0)
                                continue;

                        // if we end up here, the pixel is fully nontransparent!
                        pixel = 255;

                        //calc weighted result of background and textcolor
                        if ((startx+x>=0) && (startx+x<canvaswidth))
                        {
                                uint8_t newalpha = static_cast<uint8_t>(pixel * myfont.data->fontcolor.GetA() / 255);
                                newscanline.Pixel(startx+x).SetRGBA(   myfont.data->fontcolor.GetR(),
                                                                        myfont.data->fontcolor.GetG(),
                                                                        myfont.data->fontcolor.GetB(),
                                                                        newalpha);
                                newscanline.SetMask(startx+x, true);
                        }
                }
                mycanvas.SetScanline32(y+starty, &newscanline);
        }
}

} //end namespace Drawlib
