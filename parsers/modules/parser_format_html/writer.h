#ifndef blex_webhare_hare_output_html
#define blex_webhare_hare_output_html

#include <parsers/base/formatter.h>
#include <stack>
#include <harescript/vm/hsvm_dllinterface.h>

//Referenced here
class HtmlOutput;
class SiteWriter;
class OutputTransaction;

//ADDME: fix this, duplicate of hsinterface.cpp, take care of this when redoing abstractions.. (perhaps create a drawlib hsinterface header file...)
inline DrawLib::Pixel32 HStoDrawlibPixel(uint32_t packed_hs_pixel)
{
        //Pixel32(packedcolor) 65536*red + 256* green + blue + 16.7m * alpha
        return DrawLib::Pixel32(packed_hs_pixel>>16
                      ,packed_hs_pixel>>8
                      ,packed_hs_pixel
                      ,packed_hs_pixel>>24);
}

namespace Parsers {
namespace Formats {
namespace XML {

class HtmlWriter;
class TagRendering;

enum StandardLevels
{
        HTML32=0,         //< HTML 3.2
        HTML4,          //< HTML 4.01
        XHTML           //< XHTML 1.0
};
enum Wrappings
{
        Wrap,
        Nowrap
};

class HtmlOutput : public Parsers::FormattedOutput
{
        public:
        HtmlOutput(HSVM *vm, int32_t outputfile, HtmlWriter &htmlwriter);

        ~HtmlOutput();

        /** Start a list (preeedes a StartParagraph, but no end tag exists)
            @param predefstyle Predefined style settings to try to use
            @param format_para Paragraph formatting
            @param format_char Character formatting for the bullet
            @param listtype List type */
        void StartParagraph(int32_t predefstyle,
                                     Parsers::Paragraph const &format_para,
                                     Parsers::ObjectType listtype);

        /** Start a paragraph
            @param bottompixels Additional bottom line spacing (used by collapsed breaks) */
        virtual void EnterParaText();

        /** End the last started paragraph */
        virtual void EndParagraph();

        /** Start a hyperlink. Hyperlinks may not be nested */
        virtual void StartHyperlink(Parsers::Hyperlink const &hyperlink);

        /** End a hyperlink */
        virtual void EndHyperlink();

        /** Change the character formatting
            @param new_format New character formatting
            WARNING: The data new_link points to is expected to remain available at that
                     location until the next call to ChangeFormatting */
        virtual void ChangeFormatting(Parsers::Character const &new_format);

        void WriteString (unsigned numchars, char const *firstchar);
        void StartTable(Parsers::Table const &tableformat);
        void EndTable();
        void NextCell();
        void InsertImage(Parsers::ImageInfo const &imginfo);
        int32_t PredefineStyle(std::string const &suggestedname, Parsers::Paragraph const &formatpara, Parsers::Character const &formatchar);
        void SetAnchor(std::string const &anchor);
        DrawLib::Pixel32 GetBackgroundColor();
        void GetBaseFormatting(Character  *formatting);
        unsigned GetMaximumImageWidth();

        private:
        /** Structure to store our table state (created by StartTable, updated by NextCell) */
        struct TableState
        {
                TableState(Parsers::Table const &table, bool prettyborders);

                /** Maximise all table border sizes
                    @param is_minimum Force all borders to this size*/
                void MaximiseTableBorders(unsigned bordersize, bool is_minimum);

                /** Overide all table border colors
                    @param newcolor New table border colour */
                void SetTableBorderColours(DrawLib::Pixel32 newcolor);

                /** Calculate border widths */
                void CalculateBorderWidths();

                /** Calculate maximum tablecell widths
                    @param forcedwidth Exact width the table should occupy */
                void CalculateMaximumWidths(unsigned forcedwidth);

                /** Read the table.cellwidths and fill in columnwidths */
                void ScaleTable();

                /** Get highest table border width in the table */
                unsigned GetHighestBorderWidth();

                /** Figure out where to draw borders */
                void FigureOutBorders();

                void EliminateDeadColumns();
                void SetWidthRows();

                Parsers::Table table;

                ///n HTML column widths ( n = number of columns, unit is pixels)
                std::vector<unsigned> columnwidths;
                ///n HTML maximum column widths ( n = number of columns, unit is pixels)
                std::vector<unsigned> maxcolumnwidths;
                ///n Row border widths ( n = number of rows + 1, unit is twips)
                std::vector<unsigned> rowborderwidths_twips;
                ///n Column border widths ( n = number of columns + 1, unit is twips)
                std::vector<unsigned> columnborderwidths_twips;
                ///For each column, which gridrow should set the width
                std::vector<unsigned> set_width_rows;

                ///Cell spacing
                unsigned cellspacing;

                ///Current grid row
                unsigned gridrow;
                ///Current grid coluimn
                unsigned gridcolumn;
                ///Do we want pretty table borders?
                bool prettyborders;

                /// Saved cell size in pixels, before entering the table
                unsigned saved_cellsize;
                /// Saved background colour, before entering the table
                DrawLib::Pixel32 saved_bgcolor;
        };

        /** Structure to store our paragraph state */
        struct ParaState
        {
                ParaState(Parsers::PredefinedStyle const &_predefstyle,
                                   Parsers::Paragraph const &_format_para,
                                   Parsers::ObjectType _listtype);

                //paragraph settings
                Parsers::PredefinedStyle const *predefstyle;
                Parsers::Paragraph format_para;
                Parsers::ObjectType listtype;

                /// Do we want a hyperlink
                bool want_hyperlink;
                /// Requested hyperlink
                Parsers::Hyperlink requested_hyperlink;

                /// Requested formatting
                Parsers::Character requested_format_char;

                /// Current actually written character formatting
                Parsers::Character actual_format_char;
                ///Did we open a span tag?
                unsigned span_open : 1;
                ///Did we open a INS tag?
                unsigned ins_open : 1;
                ///Did we open a DEL tag?
                unsigned del_open : 1;
                ///Did we open a SUB tag?
                unsigned sub_open : 1;
                ///Did we open a SUPER tag?
                unsigned super_open : 1;
                ///Did we open a FONT tag?
                unsigned font_open : 1;
                ///Did we open a B tag?
                unsigned b_open : 1;
                ///Did we open a I tag?
                unsigned i_open : 1;
                ///Did we open a U tag?
                unsigned u_open : 1;
        };

        /** Paint the horizontal borders for a tablestate.gridrow */
        void PaintRowBorders();

        /** Paint the vertical border for (tablestate.gridcell,tablestate.gridrow) */
//        void PaintColumnBorders();

        /** Open a table row, and skip to the first visible cell */
        void OpenTableRow();

        /** Close a table row, and skip any remaining invisible cells */
        void CloseTableRow();

        /** Open the current cell */
        void OpenCell();

        /** Close the current cell */
        void CloseCell();

        /** Update formatting to reflect requested style */
        void UpdateCharacterFormatting();

        /** Handle any non-data cells at the current cell location
            @return true if a data cell was found, false on end of table */
        bool HandleNonDataCells();

        Parsers::PredefinedStyle const& BaseParaStyle() const
        { return *parastack.top().predefstyle; }
        Parsers::Paragraph const& BaseParaState() const
        { return BaseParaStyle().formatpara; }
        Parsers::Paragraph & CurParaState()
        { return parastack.top().format_para; }
        Parsers::Character const& BaseCharState() const
        { return BaseParaStyle().formatchar; }
        Parsers::Character & CurOfficialState()
        { return parastack.top().requested_format_char; }
        Parsers::Character & CurActualState()
        { return parastack.top().actual_format_char; }

        enum ParaOpenStyles
        {
                SidebysideLeft,
                SidebysideRight,
                OutsideSidebyside
        };

        void BuildParaOpen(ParaOpenStyles style, unsigned minimumwidth);

        /** Emits all the necessary close tags to bring the current state back
            to the base state.
            @param tags Stringstream to append closing tags to */
        void GenerateCloseTags(bool close_hyperlink_too);

        void FlushOutput();

        /// Current cell size in pixels (0=not in a table)
        unsigned cellsize;

        ///Has any link been opened?
        bool have_hyperlink;
        ///Current hyperlink
        Parsers::Hyperlink opened_link;

        /// HTML state stack
        std::stack<ParaState> parastack;

        /// Table state stack
        std::stack<TableState> tablestack;

        /// Current background colour
        DrawLib::Pixel32 bgcolor;
        /// Current language code
        std::string languagecode;

        HtmlWriter &htmlwriter;

        ///Has any paragraph been written? (used by EndCell to figure out if it needs to send)
        bool any_paragraph;
        ///Has any non-space been written inside this paragraph?
        bool any_nonspace;
        ///Did we just do a </div> that may still need an enter? (but must be evaded for </td>)
        bool suppressed_div_enter;

        ///The HTML standard style
        Parsers::PredefinedStyle standard_style;

        //WARNING! Exception safety REQUIRES that 'render' is the LAST member!
        ///The tag rendering engine (FIXME: BCB prevents a scoped_ptr pimpl :-( )
        TagRendering *render;
};

struct Preferences
{
        Preferences();

        ///Background color
        DrawLib::Pixel32 bgcolor;

        ///Container language
        std::string languagecode;

        ///HTML maximum table size (0: no limit)
        unsigned tablewidth;

        ///HTML forced table size
        bool tablewidth_forced;

        ///Table border color (transparent for no override)
        DrawLib::Pixel32 tablebordercolor;

        ///HTML border size limit (-1 no limit)
        int borderwidth;

        ///HTML forced border size
        bool borderwidth_forced;

        ///HTML pretty borders enable
        bool pretty_borders;
        ///HTML base font size for relative fonts (0 for absolute fonts)
        unsigned basefontsize;
        ///HTML suppress underline & foreground color formatting on hyperlinks
        bool suppress_hyperlink_formatting;
};

/** An implementation of a site writer supporting HTML output */
class HtmlWriter
{
        public:
        typedef std::deque<Parsers::PredefinedStyle> PredefinedStyles;
        typedef std::shared_ptr<HtmlOutput> HtmlOutputPtr;

        HtmlWriter(StandardLevels level, bool strict, bool stylesheets, bool cssclasses);

        ~HtmlWriter();

        Preferences& GetPreferences() { return preferences; }

        int32_t PredefineHtmlStyle(std::string const &suggestedname, Parsers::Paragraph const &formatpara, Parsers::Character const &formatchar);

        ///Any currently predefined styles (ADDME: make private)
        PredefinedStyles predefinedstyles;

        ///Create an output (the 'nice' way)
        int32_t CreateOutput(HSVM *vm, int32_t outputid);
        ///Close an output (the 'nice' way - ie HareScript requested)
        void CloseOutput(HSVM *vm, int32_t outputid);
        ///Close all outputs (the 'nice' way - ie HareScript requested)
        void CloseAllOutputs(HSVM *vm);

        ///Print style sheet to specified output
        void PrintStyleSheet(HSVM *vm, int32_t outputid);

        ///HTML standard to use
        StandardLevels const standard;
        ///Strict compliance?
        bool const strict;
        ///Use a stylesheet?
        bool const stylesheet;
        ///Create css classes
        bool const cssclasses;

        private:
        ///HTML outputs in use
        std::map<int32_t, HtmlOutputPtr> html_outputs;
        ///Output preferences
        Preferences preferences;
        /** Map and usage counters of style names to prevent duplicate usage */
        std::map<std::string,unsigned> stylenames;
        /** Font copies; the original font objects may disappear */
        std::list<Font> fontcopies;
};

struct HtmlContext
{
        typedef std::shared_ptr<HtmlWriter> HtmlWriterPtr;
        std::vector<HtmlWriterPtr> htmlwriters;
};

const unsigned HtmlContextId = 514;


} //end namespace XML
} //end namespace Formats
} //end namespace Parsers

#endif
