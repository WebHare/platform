#ifndef blex_parsers_formats_HSXMLFormat_HSXMLFormat
#define blex_parsers_formats_HSXMLFormat_HSXMLFormat

#include <parsers/base/formatter.h>
#include <stack>
#include <sstream>
//#include "xml_funcs.h"

namespace Parsers {
namespace Formats {
namespace HSXML {


class HSXMLFormat;

struct HSXMLFormatContext
{
        HSXMLFormatContext()
        {
          // Signal for initialization
          c_top = 0;
        }

        void GetColumnIds(HSVM *vm);
        void BorderToHSVar(HSVM *vm, HSVM_VariableId var, Table::BorderType const &bordertype) const;
        void CharacterToHSVar(HSVM *vm, HSVM_VariableId var, Character const &formatpara) const;
        void CellFormatToHSVar(HSVM *vm, HSVM_VariableId var, Table::CellFormatting const &format) const;
        void PaddingToHSVar(HSVM *vm, HSVM_VariableId var, Distance const &data) const;
        void ParagraphToHSVar(HSVM *vm, HSVM_VariableId var, Paragraph const &formatpara) const;
        void TableToHSVar(HSVM *vm, HSVM_VariableId var, Parsers::Table const &data) const;

        HSVM_ColumnId c_bgcolor;
        HSVM_ColumnId c_blink;
        HSVM_ColumnId c_bold;
        HSVM_ColumnId c_borderbottom;
        HSVM_ColumnId c_borderleft;
        HSVM_ColumnId c_borderright;
        HSVM_ColumnId c_bordertop;
        HSVM_ColumnId c_bottom;
        HSVM_ColumnId c_cellpadding;
        HSVM_ColumnId c_cells;
        HSVM_ColumnId c_cellspacing;
        HSVM_ColumnId c_changeformatting;
        HSVM_ColumnId c_character;
        HSVM_ColumnId c_cols;
        HSVM_ColumnId c_colspan;
        HSVM_ColumnId c_color;
        HSVM_ColumnId c_deletion;
        HSVM_ColumnId c_doublestrike;
        HSVM_ColumnId c_emboss;
        HSVM_ColumnId c_endhyperlink;
        HSVM_ColumnId c_endparagraph;
        HSVM_ColumnId c_endtable;
        HSVM_ColumnId c_endtablecell;
        HSVM_ColumnId c_endtablerow;
        HSVM_ColumnId c_enterparatext;
        HSVM_ColumnId c_fontallowoverride;
        HSVM_ColumnId c_fontface;
        HSVM_ColumnId c_fontsize;
        HSVM_ColumnId c_gridrows;
        HSVM_ColumnId c_halign;
        HSVM_ColumnId c_headinglevel;
        HSVM_ColumnId c_href;
        HSVM_ColumnId c_imprint;
        HSVM_ColumnId c_insertion;
        HSVM_ColumnId c_isopen;
        HSVM_ColumnId c_italic;
        HSVM_ColumnId c_left;
        HSVM_ColumnId c_listtype;
        HSVM_ColumnId c_mswordid;
        HSVM_ColumnId c_objectid;
        HSVM_ColumnId c_outline;
        HSVM_ColumnId c_overlapped;
        HSVM_ColumnId c_overline;
        HSVM_ColumnId c_padding;
        HSVM_ColumnId c_paragraph;
        HSVM_ColumnId c_predefinestyle;
        HSVM_ColumnId c_right;
        HSVM_ColumnId c_rows;
        HSVM_ColumnId c_rowspan;
        HSVM_ColumnId c_setanchor;
        HSVM_ColumnId c_shadow;
        HSVM_ColumnId c_smallcaps;
        HSVM_ColumnId c_starthyperlink;
        HSVM_ColumnId c_startparagraph;
        HSVM_ColumnId c_starttable;
        HSVM_ColumnId c_starttablecell;
        HSVM_ColumnId c_starttablerow;
        HSVM_ColumnId c_strikethrough;
        HSVM_ColumnId c_styleid;
        HSVM_ColumnId c_subsuper;
        HSVM_ColumnId c_target;
        HSVM_ColumnId c_textindent;
        HSVM_ColumnId c_title;
        HSVM_ColumnId c_thickness;
        HSVM_ColumnId c_top;
        HSVM_ColumnId c_underline;
        HSVM_ColumnId c_valign;
        HSVM_ColumnId c_width;
        HSVM_ColumnId c_writetext;

        typedef std::shared_ptr<HSXMLFormat> HSXMLFormatPtr;
        std::map<int32_t, HSXMLFormatPtr> HSXMLFormats;

};

/** Base class for formattable output objects */
class HSXMLFormat : public Parsers::FormattedOutput
{
        public:
        HSXMLFormat(HSXMLFormatContext &formatcontext, HSVM *vm, HSVM_VariableId objectthis);
        ~HSXMLFormat();
        DrawLib::Pixel32 GetBackgroundColor();
        int32_t PredefineStyle(std::string const &suggestedname, Paragraph const &formatpara, Character const &formatchar);
        void SetAnchor(std::string const &anchor);
        void StartParagraph(int32_t predefstyle,Paragraph const &format_para,ObjectType listtype);
        void EnterParaText();
        void EndParagraph();
        void StartHyperlink(Hyperlink const &hyperlink);
        void EndHyperlink();
        void ChangeFormatting(Character const &new_format);
        void WriteString (unsigned numchars, char const *firstchar);
        void StartTable(Table const &tableformat);
        void EndTable();
        void NextCell();

        private:
        void UpdateCharacterFormatting();
        void OpenTableRow();
        void CloseTableRow();
        void OpenCell();
        void CloseCell();
        bool HandleNonDataCells();

        HSXMLFormatContext &fc;
        HSVM *vm;
        HSVM_VariableId objectref;

        DrawLib::Pixel32 bgcolor;

        struct TableStack
        {
                TableStack(Parsers::Table const &tableformat, DrawLib::Pixel32 saved_bgcolor)
                : table(tableformat)
                , saved_bgcolor(saved_bgcolor)
                , row(0)
                , column(0)
                {
                }

                Parsers::Table table;
                DrawLib::Pixel32 saved_bgcolor;
                unsigned row,column;
        };

        Parsers::Character official_style;

        std::stack<TableStack> tables;


};

} //end namespace XML
} //end namespace Formats
} //end namespace Parsers

#endif
