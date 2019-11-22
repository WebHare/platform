#ifndef textrenderer_h
#define textrenderer_h

#include "canvas.h"
#include "drawlib_v2_types.h"
#include "fontmanager.h"
#include <blex/unicode.h>
#include <map>

namespace DrawLib
{

struct TGlyph;
typedef TGlyph* GlyphPtr;

class DrawObject;
class TextRenderer;
struct Paragraph;

namespace Text
{

const int normal = 0x0;
const int shadow = 0x1;
const int emboss = 0x2;

/**
 * This struct represents a single symbol.
 * It contains all necessary glyph and font data.
 */
struct Symbol
{
        /** A pointer to the font used font. The symbol does not own the font. */
        DrawLib::Font *font;
        /** The font size. */
        DrawLib::FPSize font_size;

        /** The symbol itself. */
        uint32_t c;
        /** Or a bitmap */
        DrawLib::Bitmap32 const *bitmap;


        /** The width. */
        double width;
        /** The ascender. */
        double ascender;
        /** The descender. */
        double descender;
        /** The linegap */
        double linegap;
        /** line_height (in pixels) */
        double line_height;

        /** Wether underlined or not. */
        bool  underline;
        /** Shadow, Emboss or nothing */
        int  shadow;
        /** Color of this symbol. */
        DrawLib::Pixel32 color;
        /** Offset of this symbol. */
        double offset;

        /** Operation mode (0=Word, 1=Powerpoint) */
        int mode;

        /**
         * The distance of the top of the symbol to the baseline,
         * read from the font data.
         */
        //double baseheight;
        /**
         * Distance from the baseline to the underline line,
         * read from the font data.
         */
        double underline_position;
        /**
         * Thickness of the underline line,
         * read from the font data.
         */
        double underline_thickness;
         /**
          * Index reference to the paragraph used for this symbol
          * when this is the first symbol of the first word of that row.
          */
        int par_index;

        /**
         * Constructs an empty symbol.
         * Strictly needed for storing symbols in vectors.
         */
        Symbol()
        : font      (NULL)
        , c         (0)
        , bitmap(NULL)
        , width     (0.0)
        , ascender  (0.0)
        , descender (0.0)
        , linegap   (0.0)
        , line_height (0.0)
        , underline(false)
        , shadow(normal)
        , color(0,0,0)
        , offset(0.0)
        , mode(0)
        , underline_position (0.0)
        , underline_thickness(0.0)
        , par_index(0)
        {}
        /**
         * Construct a symbol.
         */
        Symbol(DrawLib::Font *font, DrawLib::FPSize font_size, uint32_t c, DrawLib::Bitmap32 const *bitmap,
                bool underline, int shadow, int par_index, DrawLib::Pixel32 _font_color, double _offset, int mode);
};

/**
 * This struct represents a single word / sequnce of symbols.
 * It also contains the width of space to keep at the left of the word
 * when rendered next to an other word or on a new line. And it
 * 'knows' wether there is a hard word-break at the right of it.
 */
struct Word
{
        /** The symbols of this word. It should contains at least one. */
        std::vector<Symbol> symbols;
        /**
         * The width of space to keep at the left of the word
         * when rendered next to an other word or on a new line.
         */
        double spaces_width;
        /** Wether the spaces should get underlined or not. */
        bool underline_spaces;
        /** Wether this word starts with a tab */
        bool has_tab;
        /** When this variable is set, we have to use a fixed tab */
        unsigned fixed_tab_stop;

        /** The total width  / horizontal advance. */
        double width;
        /** The total ascender. */
        double ascender;
        /** The total descender (negative). */
        double descender;
        /** The total linegap. */
        double linegap;
        /** line height (in pixels) */
        double line_height;


        /** Whether there is a hard word-break at the left of this word. */
        bool ends_with_newline;
        /** Whether there is a soft line-break at the left of this word. */
        bool ends_with_soft_newline;

        /** Creates an empty word. */
        Word()
        : spaces_width(0.0)
        , underline_spaces(false)
        , has_tab     (false)
        , fixed_tab_stop (0)
        , width       (0.0)
        , ascender    (0.0)
        , descender   (0.0)
        , linegap     (0.0)
        , line_height    (0.0)
        , ends_with_newline(false)
        , ends_with_soft_newline(false)
        {
        }

        void AddSymbol(Symbol const &s);

        // FIXME: Maybe clean up this code, why is there such a function when the whole class is public
        /** Setter function for the field 'ends_with_newline'. */
        void SetEndsWithNewline(bool b)
        {
                ends_with_newline = b;
        }

        /**
         * Cuts as many symbols from the end of this word, to
         * make the word fit within the given width.
         * The dimentions of this word get recalculated.
         * @return The number of symbols cut off in total.
         */
        unsigned CutForWidth(double width);

        /**
         * Cuts off the first n symbols.
         * The dimentions of this word get recalculated.
         * @return If the word has become an empty word.
         */
        bool CutFirstSymbols(unsigned n);

        /** Wether this word is empty or not. */
        bool IsEmpty() const
        {
                return symbols.size() <= 0 && spaces_width == 0.0 && !has_tab;
        }

        /** Wether this word contains only spaces */
        bool OnlySpaces() const
        {
                return symbols.size() ? symbols.back().c == ' ' : true;
        }

        /**
         * Returns the paragraph settings index.
         * This is the par_index of the first symbol of this row
         */
        int GetParIndex() const;

        /** Clears / empties this word and resets its dimentions. */
        void Clear()
        {
                symbols.clear();
                spaces_width = 0.0;
                has_tab = false;
                width = 0.0;
                ascender = 0.0;
                descender = 0.0;
                linegap = 0.0;
                line_height = 0.0;
                ends_with_newline = false;
                ends_with_soft_newline = false;
        }
};

/**
 * This struct represents a single row / sequnce of words.
 * It contains a field telling wether there is a hard word-break
 * at the right of the last word of it.
 */
struct Row
{
        /** The words of this row. The row is mpty if there are no words here. */
        std::vector<Word> words;
        /** The total width  / horizontal advance of this row. */
        double width;
        /** The total ascender. */
        double ascender;
        /** The total descender (negative). */
        double descender;
        /** The total linegap. */
        double linegap;
        /** Line height (in pixels) */
        double line_height;
        /** The background color of the area */
        DrawLib::Pixel32 background_color;

        /**
         * Tells wether there is a hard word-break
         * at the right of the last word of this row.
         */
        bool ends_with_newline;

        /** Creates an empty row. */
        Row()
        : width     (0.0)
        , ascender  (0.0)
        , descender (0.0)
        , linegap   (0.0)
        , line_height (0.0)
        , background_color(DrawLib::Pixel32(0xff, 0xff, 0xff))
        , ends_with_newline(false)
        {}

        /** Adds a word to this row, updating the dimentions. */
        void AddWord(Word const &word, bool skip_spaces);

        /** Setter function for the field 'ends_with_newline'. */
        void SetEndsWithNewline(bool b)
        {
                ends_with_newline = b;
        }

        /**
         * Returns wether this row is empty. It is empty when it contains
         * now words or one word, which is empty itself.
         * @return Wether this row is empty.
         */
        bool IsEmpty() const
        {
                return words.size() <= 0 ||
                        (words.size() == 1 && words[0].IsEmpty());
        }

        /**
         * Renders this row entirely. No clipping is done here.
         *
         * @param rowbox The bounding box for the rendering. It assumes this box un NOT
         * rotated with the text direction! In spite of this the text gets rendered
         * rotated if needed.
         *
         * @param text_direction The direction of the text:
         * '0': Horizontal, left to right,
         * '1': Vertical  , top to bottom,
         * '2': Vertical  , bottom to top.
         *
         * @param textbox The original textbox rendering in. Used when rows get
         * rendered in revere direction, caused by rotation.
         *
         * @param draw_object The render context.
         */
        void Render(
                FPBoundingBox rowbox,
                int text_direction,
                FPBoundingBox const& textbox,
                Canvas32 &draw_object,
                Paragraph const &parsetting,
                bool skip_first_spaces,
                double letterspacing);

private:
        //ADDME: Replace with proper transformations (XForm2D)
        DrawLib::FPPoint GetFinalPosition(int text_direction,
                DrawLib::FPBoundingBox const& rowbox,
                DrawLib::FPBoundingBox const& textbox,
                double x_offset, double y_offset) const;

        void RenderText(DrawLib::Font *current_font, DrawLib::FPSize current_font_size,
                DrawLib::Pixel32 current_fontcolor, double current_offset, int current_shadow,
                double text_angle, int text_direction, FPBoundingBox const &rowbox,
                FPBoundingBox const &textbox, Blex::UnicodeString const &current_string,
                double last_text_x, double current_x, DrawObject &temp_drawobject, double letterspacing);

        void Underline(DrawLib::Pixel32 color, double position, double thickness, DrawObject &temp_drawobject,
                double last_underline_x, int shadow, double current_x, FPBoundingBox const &rowbox, FPBoundingBox const &textbox,
                int text_direction, DrawLib::FPSize font_size);
};

/**
 * This class is a cache for DrawLib fonts. It also creates fonts
 * when not yet in the cache. When destructed, all fonts get deleted.
 */
class FontCacher
{
        /** The font manager of DrawLib. */
        DrawLib::FontManager &font_manager;

        typedef std::shared_ptr<DrawLib::Font> FontPtr;
        typedef std::map<std::string, FontPtr>   FontCache;
        typedef FontCache::value_type            FontCacheValue;
        typedef FontCache::iterator              FontCachePos;

        /**
         * A map, used as cache of (DrawLib) fonts.
         * The keys are like "Times New Roman,bold".
         */
        FontCache cache;

public:
        /** Creates an empty cache. */
        FontCacher();

        /**
         * Gets a font with the current face-name, boldness and italicness
         * eighter from the font cache or creates it and adds it to the cache.
         */
        DrawLib::Font *GetFont(
                std::string const &face, bool bold, bool italic);
};

} //end namespace DrawLib::Text

/**
 * This struct stores paragraph settings, these settings are saved
 * per symbol by an index
 */
struct Paragraph
{
        Paragraph()
        :
          alignment(0), tab_size(25.0), firstline_indent(0.0),
          firstline_tab_stop(0.0), left_indent(0.0), right_indent(0.0),
          line_spacing_relative(true), line_spacing(1.0),
          spacing_before_relative(false), spacing_before(0.0),
          spacing_after_relative(false), spacing_after(0.0), offset(0.0)
        {
        }

        /**
         * The horizontal alignment of the last symbol.
         * '0'=Left, '1'=Center, '2'=Right, '3'=Justified.
         */
        int             alignment;
        /** The default tabsize */
        double           tab_size;
        /** The default tabsize */
        std::vector<double> tab_stops;
        /** The first line indent */
        double           firstline_indent;
        /** The first line tab stop */
        double           firstline_tab_stop;
        /** The left indent */
        double           left_indent;
        /** The right indent */
        double           right_indent;
        /** The line spacing setting */
        bool            line_spacing_relative; // When set, the line_spacing is a factor, otherwise it's in pixels
        double           line_spacing;
        /** The spacing before setting */
        bool            spacing_before_relative; // When set, the spacing_before is a factor, otherwise it's in pixels
        double           spacing_before;
        /** The spacing after setting */
        bool            spacing_after_relative; // When set, the spacing_after is a factor, otherwise it's in pixels
        double           spacing_after;
        /** The offset setting */
        double           offset;

};

/** A generic text formatter and rendering enginge */
class BLEXLIB_PUBLIC TextFormatter
{
        /** The font caching object. */
        Text::FontCacher font_cacher;

        /** Background color of the area (used for shadow, emboss) */
        DrawLib::Pixel32 background_color;

        /** The operation mode of the textformatter (0=Word, 1=Powerpoint) */
        int mode;

        /**
         * Font settings, stored per symbol
         */

        /** Wether the last symbol was bold or not. */
        bool            current_font_bold;
        /** Wether the last symbol was italic or not. */
        bool            current_font_italic;
        std::string     current_font_face;
        /** The font used, by the last symbol. */
        DrawLib::Font  *current_open_font;
        /** The fontsize used, by the last symbol. */
        DrawLib::FPSize current_font_size;
        /** Wether the last symbol was underlined or not. */
        bool            current_underline;
        /** Wether the last symbol was shadowed or not. */
        int             current_shadow;
        /** The color of the last symbol */
        DrawLib::Pixel32 current_fontcolor;
        /** The offset of the last symbol */
        double current_offset;

        /**
         * Paragraph settings, stored per paragraph
         */
        std::vector<Paragraph> par_settings;
        bool paragraph_locked;

        void OpenFont();
        inline void EnsureFontOpened()
        {
                if(!current_open_font)
                    OpenFont();
        }
        void PrepareParagraph();

        /** The words found in the text. This vector gets filled in the constructor. */
        std::vector<Text::Word> words;

        /// The word currently being created
        Text::Word current_word;

        /**
         * The next word to use for the next row.
         */
        unsigned next_word_index;
        /**
         * The symbol, within the next word to use for the next row.
         */
        unsigned next_symbol_index;

        /**
         * The next word to use for the next row.
         * This is the backupped value.
         */
        unsigned backupped_next_word_index;
        /**
         * The symbol, within the next word to use for the next row.
         * This is the backupped value.
         */
        unsigned backupped_next_symbol_index;

        ///A stateful UTF-8 Decoder
        Blex::UTF8DecodeMachine utf8decoder;

        /**
         * Creates an empty (space) symbol with as much as possible
         * properties of the current settings,like font.
         * This symbol can then be used to create an empty word,
         * to create an empty line, with the correct height.
         */
        Text::Symbol GetEmptySymbol() ;

        bool accept_spaces_for_next_word;
public:
        /** Constructor */
        explicit TextFormatter(DrawLib::XForm2D const &scaling, DrawLib::Pixel32 background_color);

        ///Destructor
        ~TextFormatter();

        /** Add the specified character to the current word. Use this only
            for characters you want printed (eg, initial spaces and normal
            characters). This function accepts UTF-8 characters, but should
            not be used for word-separating spaces, newlines or other control
            characters */
        void AddToWord(char next_ch);

        void ParseText(std::string const &text) { ParseText(&text[0],&text[text.size()]); }
        void ParseText(const char *start, const char *limit);
        void ParseText(uint16_t character);

        /** Add fixed tab. That means, jump to the fixed tab, when we are already
            beyond this tab, don't do anything */
        void AddFixedTab(unsigned tab_stop);

        /** This will add a bitmap as a symbol */
        void AddBitmap(DrawLib::Bitmap32 const *bitmap);

        void EndParagraph();

        /** Set the operation mode of the text formatter (0=Word, 1=PowerPoint) */
        void SetMode(int mode);

        /**
         * Resets all 'current' values to their defaults and (re)loads
         * the default font.
         */
        void ResetFontSettings();
        void SetBold(bool enable);
        void SetItalics(bool enable);
        void SetUnderline(bool enable);
        void SetShadow(bool enable);
        void SetEmboss(bool enable);
        void SetFontFace(std::string const &fontname);
        void SetFontSize(DrawLib::FPSize fontsize);
        void SetFontColor(DrawLib::Pixel32 fontcolor);
        void SetOffset(double offset);

        /**
         * Resets all 'current' paragraph values to their defaults and (re)loads
         * the default paragraph.
         */
        void ResetParagraphSettings();
        void SetAlignment(int alignment);
        void SetFirstLineIndent(double indentation);
        void SetFirstLineTabStop(double stop);
        void SetLeftIndent(double indentation);
        void SetRightIndent(double indentation);
        void AddTabStop(double stop);
        void SetDefaultTab(double tabsize);
        void SetLineSpacingFactor(double factor);
        void SetLineSpacingAbsolute(double line_spacing);
        void SetSpacingBeforeFactor(double factor);
        void SetSpacingBeforeAbsolute(double spacing);
        void SetSpacingAfterFactor(double factor);
        void SetSpacingAfterAbsolute(double spacing);

        /**
         * Renders the text. May get called only once per object instance.
         * @param Wether this is the lasttext box this renderer will render.
         * If so, also the last line, just NOT fitting within the box, also
         * gets rendered.
         *
         * @param text_direction The direction of the text:
         * '0': Horizontal, left to right,
         * '1': Vertical  , top to bottom,
         * '2': Vertical  , bottom to top.
         */
        void RenderText(DrawLib::Canvas32 &canvas,
                DrawLib::FPBoundingBox const &textbox,
                int text_direction,
                bool is_last_box,
                double letterspacing);


private:
        void EndWord();

        /**
         * Returns the next row, which will fitn within the given width.
         * After this function is called, the field 'next_word_index' will
         * point to the first unused word.
         */
        Text::Row *GetNextRow(double width, bool is_first_row, Paragraph const &parsetting);

        /**
         * Backups the current read index, for reading words and
         * symbols to put on a new line.
         * See also the member function 'RecallRenderPosition'.
         */
        void BackupRenderPosition()
        {
                backupped_next_word_index   = next_word_index;
                backupped_next_symbol_index = next_symbol_index;
        }

        /**
         * Recalls the backupped read index, for reading words and
         * symbols to put on a new line.
         * See also the member function 'BackupRenderPosition'.
         */
        void RecallRenderPosition()
        {
                next_word_index   = backupped_next_word_index;
                next_symbol_index = backupped_next_symbol_index;
        }

        void CalculateAllTabStops(Paragraph &parsetting, double max_tab_stop, bool first_line);

        DrawLib::XForm2D scaling;
};

/** TextRenderer - a class that renders Unicode strings on a canvas.
    The alpha mode of the canvas _must_ be BLEND255 for this to work!
*/

class BLEXLIB_PUBLIC TextRenderer
{
public:
        ~TextRenderer();

        enum HorizontalAlignment {LEFT, CENTER, RIGHT};
        enum VerticalAlignment {BASELINE, TOP, BOTTOM, VCENTER, ASCENDER, DESCENDER};

        /** Draw a text string comprising of a single type of font
            @param canvas - reference to a Canvas32 object that will receive the text output
            @param position - reference to a FPPoint that describes the starting point of the baseline
            @param myfont - pointer to a Font object that contains the font to be used
            @param baselinerotation - rotation of the baseline relative to the horizontal (in degrees)
            @param glyphrotation - rotation of the glyphs relative to the horizontal (in degrees)
            @param HorizontalAlignment - horizontal alignment of the text relative to the 'position'
            @param VertialAlignment - vertical alignment of the text relative to the 'position'
        */

        void DrawText(Canvas32 &canvas,
                const Blex::UnicodeString &textstring,
                const FPPoint &position,
                const Font &myfont,
                const std::vector<double> &deltas,
                bool antialiased,
                double baselinerotation,
                double glyphrotation,
                HorizontalAlignment,
                VerticalAlignment,
                double letterspacing
                );

        /** Get the bounding box of a text string
            @param canvas - pointer to a Canvas32 object that will receive the text output
            @param position - reference to a FPPoint that describes the starting point of the baseline
            @param myfont - pointer to a Font object that contains the font to be used
            @param baselinerotation - rotation of the baseline relative to the horizontal (in degrees)
            @param glyphrotation - rotation of the glyphs relative to the horizontal (in degrees)
            @param HorizontalAlignment - horizontal alignment of the text relative to the 'position'
            @param VertialAlignment - vertical alignment of the text relative to the 'position'
            @return FPBoundingBox - returns a boundingbox that fits around the text
        */
        FPBoundingBox CalculateBoundingBox(
                const Blex::UnicodeString &textstring,
                const FPPoint &position,
                const Font &myfont,
                const std::vector<double> &deltas,
                bool antialiased,
                double baselinerotation,
                double glyphrotation,
                HorizontalAlignment halign,
                VerticalAlignment valign,
                double letterspacing
                );

private:
        void ClearGlyphList();
        void BuildGlyphList(const Blex::UnicodeString &textstring, const Font &myfont);
        void LayoutGlyphList(const Font &myfont, const std::vector<double> &deltas, bool hinting, bool kerning, double glyphrotation, double letterspacing);
        void RenderGlyphList(int x, int y, double baselinerotation,
                double glyphrotation, const Font &myfont, bool antialias, Canvas32 &mycanvas);

        double GetFontAdvance(const Font &myfont);

        void BBox(FPBoundingBox *abbox, const Font &myfont);

        std::vector<GlyphPtr> glyphlist;
};

}
#endif
