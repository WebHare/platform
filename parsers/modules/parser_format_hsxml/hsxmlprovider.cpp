#include <ap/libwebhare/allincludes.h>

#include <parsers/base/parserinterface.h>
#include "hsxmlprovider.h"
#include <blex/unicode.h>
#include <blex/utils.h>

namespace Parsers {
namespace Formats {
namespace HSXML {

using namespace Parsers;

void HSXMLFormatContext::GetColumnIds(HSVM *vm)
{
        c_bgcolor            = HSVM_GetColumnId(vm,"BGCOLOR");
        c_blink              = HSVM_GetColumnId(vm,"BLINK");
        c_bold               = HSVM_GetColumnId(vm,"BOLD");
        c_borderbottom       = HSVM_GetColumnId(vm,"BORDERBOTTOM");
        c_borderleft         = HSVM_GetColumnId(vm,"BORDERLEFT");
        c_borderright        = HSVM_GetColumnId(vm,"BORDERRIGHT");
        c_bordertop          = HSVM_GetColumnId(vm,"BORDERTOP");
        c_bottom             = HSVM_GetColumnId(vm,"BOTTOM");
        c_cellpadding        = HSVM_GetColumnId(vm,"CELLPADDING");
        c_cells              = HSVM_GetColumnId(vm,"CELLS");
        c_cellspacing        = HSVM_GetColumnId(vm,"CELLSPACING");
        c_changeformatting   = HSVM_GetColumnId(vm,"CHANGEFORMATTING");
        c_character          = HSVM_GetColumnId(vm,"CHARACTER");
        c_cols               = HSVM_GetColumnId(vm,"COLS");
        c_colspan            = HSVM_GetColumnId(vm,"COLSPAN");
        c_color              = HSVM_GetColumnId(vm,"COLOR");
        c_deletion           = HSVM_GetColumnId(vm,"DELETION");
        c_doublestrike       = HSVM_GetColumnId(vm,"DOUBLESTRIKE");
        c_emboss             = HSVM_GetColumnId(vm,"EMBOSS");
        c_endhyperlink       = HSVM_GetColumnId(vm,"ENDHYPERLINK");
        c_endparagraph       = HSVM_GetColumnId(vm,"ENDPARAGRAPH");
        c_endtable           = HSVM_GetColumnId(vm,"ENDTABLE");
        c_endtablecell       = HSVM_GetColumnId(vm,"ENDTABLECELL");
        c_endtablerow        = HSVM_GetColumnId(vm,"ENDTABLEROW");
        c_enterparatext      = HSVM_GetColumnId(vm,"ENTERPARATEXT");
        c_fontallowoverride  = HSVM_GetColumnId(vm,"FONTALLOWOVERRIDE");
        c_fontface           = HSVM_GetColumnId(vm,"FONTFACE");
        c_fontsize           = HSVM_GetColumnId(vm,"FONTSIZE");
        c_gridrows           = HSVM_GetColumnId(vm,"GRIDROWS");
        c_halign             = HSVM_GetColumnId(vm,"HALIGN");
        c_headinglevel       = HSVM_GetColumnId(vm,"HEADINGLEVEL");
        c_href               = HSVM_GetColumnId(vm,"HREF");
        c_imprint            = HSVM_GetColumnId(vm,"IMPRINT");
        c_insertion          = HSVM_GetColumnId(vm,"INSERTION");
        c_isopen             = HSVM_GetColumnId(vm,"ISOPEN");
        c_italic             = HSVM_GetColumnId(vm,"ITALIC");
        c_left               = HSVM_GetColumnId(vm,"LEFT");
        c_listtype           = HSVM_GetColumnId(vm,"LISTTYPE");
        c_mswordid           = HSVM_GetColumnId(vm,"MSWORDID");
        c_objectid           = HSVM_GetColumnId(vm,"OBJECTID");
        c_outline            = HSVM_GetColumnId(vm,"OUTLINE");
        c_overlapped         = HSVM_GetColumnId(vm,"OVERLAPPED");
        c_overline           = HSVM_GetColumnId(vm,"OVERLINE");
        c_padding            = HSVM_GetColumnId(vm,"PADDING");
        c_paragraph          = HSVM_GetColumnId(vm,"PARAGRAPH");
        c_predefinestyle     = HSVM_GetColumnId(vm,"PREDEFINESTYLE");
        c_right              = HSVM_GetColumnId(vm,"RIGHT");
        c_rows               = HSVM_GetColumnId(vm,"ROWS");
        c_rowspan            = HSVM_GetColumnId(vm,"ROWSPAN");
        c_setanchor          = HSVM_GetColumnId(vm,"SETANCHOR");
        c_shadow             = HSVM_GetColumnId(vm,"SHADOW");
        c_smallcaps          = HSVM_GetColumnId(vm,"SMALLCAPS");
        c_starthyperlink     = HSVM_GetColumnId(vm,"STARTHYPERLINK");
        c_startparagraph     = HSVM_GetColumnId(vm,"STARTPARAGRAPH");
        c_starttable         = HSVM_GetColumnId(vm,"STARTTABLE");
        c_starttablecell     = HSVM_GetColumnId(vm,"STARTTABLECELL");
        c_starttablerow      = HSVM_GetColumnId(vm,"STARTTABLEROW");
        c_strikethrough      = HSVM_GetColumnId(vm,"STRIKETHROUGH");
        c_styleid            = HSVM_GetColumnId(vm,"STYLEID");
        c_subsuper           = HSVM_GetColumnId(vm,"SUBSUPER");
        c_target             = HSVM_GetColumnId(vm,"TARGET");
        c_textindent         = HSVM_GetColumnId(vm,"TEXTINDENT");
        c_title              = HSVM_GetColumnId(vm,"TITLE");
        c_thickness          = HSVM_GetColumnId(vm,"THICKNESS");
        c_top                = HSVM_GetColumnId(vm,"TOP");
        c_underline          = HSVM_GetColumnId(vm,"UNDERLINE");
        c_valign             = HSVM_GetColumnId(vm,"VALIGN");
        c_width              = HSVM_GetColumnId(vm,"WIDTH");
        c_writetext          = HSVM_GetColumnId(vm,"WRITETEXT");
}

void HSXMLFormatContext::PaddingToHSVar(HSVM *vm, HSVM_VariableId var, Distance const &data) const
{
        HSVM_SetDefault(vm, var, HSVM_VAR_Record);
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, var, c_top), data.top);
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, var, c_right), data.right);
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, var, c_left), data.left);
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, var, c_bottom), data.bottom);
}

void HSXMLFormatContext::ParagraphToHSVar(HSVM *vm, HSVM_VariableId var, Paragraph const &data) const
{
        HSVM_SetDefault(vm, var, HSVM_VAR_Record);
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, var, c_headinglevel), data.headinglevel);
        PaddingToHSVar(vm, HSVM_RecordCreate(vm, var, c_padding), data.padding);
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, var, c_textindent), data.first_indent);
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, var, c_halign), data.jc);
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, var, c_mswordid), data.mswordid);
}
void HSXMLFormatContext::CharacterToHSVar(HSVM *vm, HSVM_VariableId var, Character const &data) const
{
        HSVM_SetDefault(vm, var, HSVM_VAR_Record);
        HSVM_BooleanSet(vm, HSVM_RecordCreate(vm, var, c_bold),         data.format_bits & Character::Bold);
        HSVM_BooleanSet(vm, HSVM_RecordCreate(vm, var, c_italic),       data.format_bits & Character::Italic)        ;
        HSVM_BooleanSet(vm, HSVM_RecordCreate(vm, var, c_strikethrough),data.format_bits & Character::Strikethrough) ;
        HSVM_BooleanSet(vm, HSVM_RecordCreate(vm, var, c_blink),        data.format_bits & Character::Blink)         ;
        HSVM_BooleanSet(vm, HSVM_RecordCreate(vm, var, c_smallcaps),    data.format_bits & Character::Smallcaps)     ;
        HSVM_BooleanSet(vm, HSVM_RecordCreate(vm, var, c_doublestrike), data.format_bits & Character::DoubleStrike)  ;
        HSVM_BooleanSet(vm, HSVM_RecordCreate(vm, var, c_shadow),       data.format_bits & Character::Shadow)        ;
        HSVM_BooleanSet(vm, HSVM_RecordCreate(vm, var, c_emboss),       data.format_bits & Character::Emboss)        ;
        HSVM_BooleanSet(vm, HSVM_RecordCreate(vm, var, c_imprint),      data.format_bits & Character::Imprint)       ;
        HSVM_BooleanSet(vm, HSVM_RecordCreate(vm, var, c_outline),      data.format_bits & Character::Outline)       ;
        HSVM_BooleanSet(vm, HSVM_RecordCreate(vm, var, c_overline),     data.format_bits & Character::Overline)      ;
        HSVM_BooleanSet(vm, HSVM_RecordCreate(vm, var, c_insertion),    data.format_bits & Character::Insertion)     ;
        HSVM_BooleanSet(vm, HSVM_RecordCreate(vm, var, c_deletion),     data.format_bits & Character::Deletion)      ;

        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, var, c_subsuper),     (int)data.subsuper);
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, var, c_underline),    (int)data.underlining);
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, var, c_color),        DrawlibtoHSPixel(data.foreground_color));
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, var, c_bgcolor),      DrawlibtoHSPixel(data.background_color));

        if(data.fonttype)
                HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, var, c_fontface),     data.fonttype->font_face);
        else
                HSVM_SetDefault(vm, HSVM_RecordCreate(vm, var, c_fontface), HSVM_VAR_String);

        HSVM_BooleanSet(vm, HSVM_RecordCreate(vm, var, c_fontallowoverride), !(data.fonttype && data.fonttype->neveroverride));
        HSVM_FloatSet  (vm, HSVM_RecordCreate(vm, var, c_fontsize),     float(data.font_halfpoint_size)/2);
}


void HSXMLFormatContext::BorderToHSVar(HSVM *vm, HSVM_VariableId var, Table::BorderType const &bordertype) const
{
        HSVM_SetDefault(vm, var, HSVM_VAR_Record);
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, var, c_color),     DrawlibtoHSPixel(bordertype.color));
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, var, c_thickness), bordertype.thickness_twips);
        HSVM_BooleanSet(vm, HSVM_RecordCreate(vm, var, c_overlapped),bordertype.overlapped);
}
void HSXMLFormatContext::CellFormatToHSVar(HSVM *vm, HSVM_VariableId var, Table::CellFormatting const &format) const
{
        HSVM_SetDefault(vm, var, HSVM_VAR_Record);
        if(format.type != Table::Data && format.type != Table::Open)
                return;

        HSVM_BooleanSet(vm, HSVM_RecordCreate(vm, var, c_isopen),  format.type == Table::Open);
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, var, c_bgcolor), DrawlibtoHSPixel(format.background));
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, var, c_valign),  format.valign);
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, var, c_colspan), format.colspan);
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, var, c_rowspan), format.rowspan);
        PaddingToHSVar (vm, HSVM_RecordCreate(vm, var, c_padding), format.padding);
        BorderToHSVar  (vm, HSVM_RecordCreate(vm, var, c_bordertop),    format.top);
        BorderToHSVar  (vm, HSVM_RecordCreate(vm, var, c_borderleft),   format.left);
        BorderToHSVar  (vm, HSVM_RecordCreate(vm, var, c_borderbottom), format.bottom);
        BorderToHSVar  (vm, HSVM_RecordCreate(vm, var, c_borderright),  format.right);
}

void HSXMLFormatContext::TableToHSVar(HSVM *vm, HSVM_VariableId var, Parsers::Table const &data) const
{
        HSVM_SetDefault(vm, var, HSVM_VAR_Record);
        PaddingToHSVar( vm, HSVM_RecordCreate(vm, var, c_padding), data.tablepadding);
        PaddingToHSVar( vm, HSVM_RecordCreate(vm, var, c_cellpadding), data.default_cellpadding);
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, var, c_cellspacing), data.cellspacing);
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, var, c_halign), data.halign);
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, var, c_width),  data.tablewidth);

        HSVM_VariableId cols = HSVM_RecordCreate(vm, var, c_cols);
        HSVM_SetDefault(vm, cols, HSVM_VAR_RecordArray);

        for (std::vector<signed>::const_iterator itr=data.cellwidths.begin(); itr!=data.cellwidths.end(); ++itr)
        {
                HSVM_VariableId col = HSVM_ArrayAppend(vm, cols);
                HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, col, c_width), *itr);
        }

        HSVM_VariableId rows = HSVM_RecordCreate(vm, var, c_rows);
        HSVM_SetDefault(vm, rows, HSVM_VAR_RecordArray);
        for (unsigned y=0;y<data.GetRows();++y)
        {
                HSVM_VariableId row = HSVM_ArrayAppend(vm, rows);
                HSVM_RecordSetEmpty(vm, row);
        }

        HSVM_VariableId gridrows = HSVM_RecordCreate(vm, var, c_gridrows);
        HSVM_SetDefault(vm, gridrows, HSVM_VAR_RecordArray);
        for (unsigned y=0;y<data.GetRows()+1;++y)
        {
                HSVM_VariableId gridrow = HSVM_ArrayAppend(vm, gridrows);
                HSVM_VariableId cells = HSVM_RecordCreate(vm, gridrow, c_cells);
                HSVM_SetDefault(vm, cells, HSVM_VAR_RecordArray);
                for (unsigned x=0;x<data.GetColumns()+1;++x)
                        CellFormatToHSVar(vm, HSVM_ArrayAppend(vm, cells), data.GetFormatting(x,y));
        }
}

HSXMLFormat::HSXMLFormat(HSXMLFormatContext &formatcontext, HSVM *vm, HSVM_VariableId objectthis)
: fc(formatcontext)
, vm(vm)
, objectref(HSVM_AllocateVariable(vm))
, bgcolor(DrawLib::Pixel32(255,255,255,0))
{
        HSVM_CopyFrom(vm, objectref, objectthis);
}
HSXMLFormat::~HSXMLFormat()
{
        HSVM_DeallocateVariable(vm,objectref);
}

DrawLib::Pixel32 HSXMLFormat::GetBackgroundColor()
{
        return bgcolor;
}
int32_t HSXMLFormat::PredefineStyle(std::string const &suggestedname, Paragraph const &formatpara, Character const &formatchar)
{
        int32_t styleid = -1;

        HSVM_OpenFunctionCall(vm, 3);
        HSVM_StringSetSTD(vm, HSVM_CallParam(vm,0), suggestedname);
        fc.ParagraphToHSVar(vm, HSVM_CallParam(vm,1), formatpara);
        fc.CharacterToHSVar(vm, HSVM_CallParam(vm,2), formatchar);
        HSVM_VariableId retval = HSVM_CallObjectMethod(vm, objectref, fc.c_predefinestyle, true, false);
        if(retval)
                styleid = HSVM_IntegerGet(vm, retval);

        HSVM_CloseFunctionCall(vm);
        return styleid;
}
void HSXMLFormat::SetAnchor(std::string const &anchor)
{
        HSVM_OpenFunctionCall(vm, 1);
        HSVM_StringSetSTD(vm, HSVM_CallParam(vm,0), anchor);
        HSVM_CallObjectMethod(vm, objectref, fc.c_setanchor, true, true);
        HSVM_CloseFunctionCall(vm);
}

void HSXMLFormat::StartParagraph(int32_t predefstyle, Paragraph const &format_para, ObjectType listtype)
{
        HSVM_OpenFunctionCall(vm, 1);
        HSVM_SetDefault(vm, HSVM_CallParam(vm, 0), HSVM_VAR_Record);
        fc.ParagraphToHSVar(vm,HSVM_RecordCreate(vm, HSVM_CallParam(vm, 0), fc.c_paragraph), format_para);
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, HSVM_CallParam(vm, 0), fc.c_listtype), listtype);
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, HSVM_CallParam(vm, 0), fc.c_styleid), predefstyle);
        HSVM_CallObjectMethod(vm, objectref, fc.c_startparagraph, true, true);
        HSVM_CloseFunctionCall(vm);
}
void HSXMLFormat::EnterParaText()
{
        HSVM_OpenFunctionCall(vm, 0);
        HSVM_CallObjectMethod(vm, objectref, fc.c_enterparatext, true, true);
        HSVM_CloseFunctionCall(vm);
}
void HSXMLFormat::EndParagraph()
{
        HSVM_OpenFunctionCall(vm, 0);
        HSVM_CallObjectMethod(vm, objectref, fc.c_endparagraph, true, true);
        HSVM_CloseFunctionCall(vm);
}
void HSXMLFormat::StartHyperlink(Hyperlink const &hyperlink)
{
        HSVM_OpenFunctionCall(vm, 1);
        HSVM_SetDefault(vm, HSVM_CallParam(vm, 0), HSVM_VAR_Record);

        int32_t objectid = hyperlink.objectptr ? hyperlink.objectptr->GetFinalOutputObjectId() : 0;

        HSVM_IntegerSet  (vm, HSVM_RecordCreate(vm, HSVM_CallParam(vm, 0), fc.c_objectid), objectid);
        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, HSVM_CallParam(vm, 0), fc.c_href),   hyperlink.data);
        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, HSVM_CallParam(vm, 0), fc.c_target), hyperlink.target);
        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, HSVM_CallParam(vm, 0), fc.c_title),  hyperlink.title);
        HSVM_CallObjectMethod(vm, objectref, fc.c_starthyperlink, true, true);
        HSVM_CloseFunctionCall(vm);
}
void HSXMLFormat::EndHyperlink()
{
        HSVM_OpenFunctionCall(vm, 0);
        HSVM_CallObjectMethod(vm, objectref, fc.c_endhyperlink, true, true);
        HSVM_CloseFunctionCall(vm);
}
void HSXMLFormat::ChangeFormatting(Character const &new_format)
{
        HSVM_OpenFunctionCall(vm, 1);
        fc.CharacterToHSVar(vm, HSVM_CallParam(vm, 0),new_format);
        HSVM_CallObjectMethod(vm, objectref, fc.c_changeformatting, true, true);
        HSVM_CloseFunctionCall(vm);

        official_style = new_format;
}

void HSXMLFormat::WriteString (unsigned numchars, char const *firstchar)
{
        HSVM_OpenFunctionCall(vm, 1);

        // For the Symbol font we have to remap to our unicode map
        //FIXME: This code probably shouldn't appear in THIS stage - let Symbol font generators deal with it ?
        if (official_style.fonttype && official_style.fonttype->font_face == "Symbol")
        {
                uint32_t const * chartable = Blex::GetCharsetConversiontable(Blex::Charsets::CPSymbol);

                std::string encoded;
                Blex::UTF8Encoder<std::back_insert_iterator<std::string> > encoder(std::back_inserter(encoded));

                Blex::UTF8DecodeMachine decoder;
                for (unsigned i = 0; i < numchars ; i++)
                {
                        uint32_t c = decoder(*(firstchar + i));
                        if (c == Blex::UTF8DecodeMachine::InvalidChar)
                            break;
                        if (c != Blex::UTF8DecodeMachine::NoChar)
                            encoder(chartable[c & 0xff]);
                }
                HSVM_StringSetSTD(vm, HSVM_CallParam(vm, 0), encoded);
        }
        else
        {
                HSVM_StringSet(vm, HSVM_CallParam(vm, 0), firstchar, firstchar+numchars);
        }
        HSVM_CallObjectMethod(vm, objectref, fc.c_writetext, true, true);
        HSVM_CloseFunctionCall(vm);
}

void HSXMLFormat::StartTable(Table const &tableformat)
{
        tables.push(TableStack(tableformat,bgcolor));

        HSVM_OpenFunctionCall(vm, 1);
        fc.TableToHSVar(vm, HSVM_CallParam(vm, 0), tableformat);
        HSVM_CallObjectMethod(vm, objectref, fc.c_starttable, true, true);
        HSVM_CloseFunctionCall(vm);

        OpenTableRow();
        if (!HandleNonDataCells())
            throw std::runtime_error("HSXMLFormat: Table has no data cells");
        OpenCell();
}
void HSXMLFormat::EndTable()
{
        TableStack &state=tables.top();

        CloseCell();

        //Move to next cell
        state.column += state.table.GetFormatting(state.column,state.row).colspan;

        if (HandleNonDataCells())
            throw std::runtime_error("HSXMLFormat: haven't rendered all cells yet");

        HSVM_OpenFunctionCall(vm, 0);
        HSVM_CallObjectMethod(vm, objectref, fc.c_endtable, true, true);
        HSVM_CloseFunctionCall(vm);

        bgcolor=state.saved_bgcolor;
        tables.pop();
}
void HSXMLFormat::NextCell()
{
        TableStack &state=tables.top();

        //Close current cell
        CloseCell();

        //Move to next cell
        state.column += state.table.GetFormatting(state.column,state.row).colspan;

        if (!HandleNonDataCells())
            throw std::runtime_error("HtmlOutput::NextCell - trying to move off the end of the table");

        //Start the new cell
        OpenCell();
}
void HSXMLFormat::OpenTableRow()
{
        tables.top().column=0;

        HSVM_OpenFunctionCall(vm, 0);
        HSVM_CallObjectMethod(vm, objectref, fc.c_starttablerow, true, true);
        HSVM_CloseFunctionCall(vm);
}
void HSXMLFormat::CloseTableRow()
{
        HSVM_OpenFunctionCall(vm, 0);
        HSVM_CallObjectMethod(vm, objectref, fc.c_endtablerow, true, true);
        HSVM_CloseFunctionCall(vm);
}
void HSXMLFormat::OpenCell()
{
        TableStack &state=tables.top();
        Parsers::Table::CellFormatting const &cell=state.table.GetFormatting(state.column,state.row);

        HSVM_OpenFunctionCall(vm, 3);
        HSVM_IntegerSet(vm, HSVM_CallParam(vm, 0), state.row);
        HSVM_IntegerSet(vm, HSVM_CallParam(vm, 1), state.column);
        fc.CellFormatToHSVar(vm, HSVM_CallParam(vm, 2), cell);
        HSVM_CallObjectMethod(vm, objectref, fc.c_starttablecell, true, true);
        HSVM_CloseFunctionCall(vm);

        bgcolor = cell.background.IsFullyTransparent() ? state.saved_bgcolor : cell.background;
}
void HSXMLFormat::CloseCell()
{
        HSVM_OpenFunctionCall(vm, 0);
        HSVM_CallObjectMethod(vm, objectref, fc.c_endtablecell, true, true);
        HSVM_CloseFunctionCall(vm);
}
bool HSXMLFormat::HandleNonDataCells()
{
        TableStack &state=tables.top();
        while (true)
        {
                while (state.column < state.table.GetColumns())
                {
                        Parsers::Table::CellFormatting const &cell=state.table.GetFormatting(state.column,state.row);

                        if (cell.type == Parsers::Table::Data) //Real cell (the one we're looking for!)
                            return true;

                        unsigned nextcell = state.table.GetNextCell(state.column,state.row);
                        state.column=nextcell;
                }
                CloseTableRow();

                if (++state.row>= state.table.GetRows())
                    return false;

                OpenTableRow();
        }
}


static const unsigned ContextId = 66521; //FIXME!

void GetParserDefaults(HSVM *vm, HSVM_VariableId id_set)
{
        HSXMLFormatContext &fc = *static_cast<HSXMLFormatContext*>(HSVM_GetContext(vm,ContextId,true));
        if(!fc.c_top)
                fc.GetColumnIds(vm);

        HSVM_SetDefault(vm, id_set, HSVM_VAR_Record);
        fc.ParagraphToHSVar(vm,HSVM_RecordCreate(vm, id_set, fc.c_paragraph), Paragraph());
        fc.CharacterToHSVar(vm,HSVM_RecordCreate(vm, id_set, fc.c_character), Character());
}

void CreateHSXMLFormatOutput(HSVM *vm, HSVM_VariableId id_set)
{
        HSXMLFormatContext &context = *static_cast<HSXMLFormatContext*>(HSVM_GetContext(vm,ContextId,true));
        if(!context.c_top)
                context.GetColumnIds(vm);

        HSXMLFormatContext::HSXMLFormatPtr newformat(new HSXMLFormat(context, vm, HSVM_Arg(0)));

        int32_t formatid = Parsers::RegisterFormattedOutput(vm, newformat);

        context.HSXMLFormats[formatid] = newformat;
        HSVM_IntegerSet(vm, id_set, formatid);

}

void CloseHSXMLFormatOutput(HSVM *vm)
{
        HSXMLFormatContext &context = *static_cast<HSXMLFormatContext*>(HSVM_GetContext(vm,ContextId,true));

        int32_t id = HSVM_IntegerGet(vm, HSVM_Arg(0));
        std::map<int32_t, HSXMLFormatContext::HSXMLFormatPtr>::iterator itr = context.HSXMLFormats.find(id);
        if (itr==context.HSXMLFormats.end())
            return;

        Parsers::UnregisterFormattedOutput(vm,id);
        context.HSXMLFormats.erase(itr);
}


} //end namespace XML
} //end namespace Formats
} //end namespace Parsers


extern "C" {

static void* CreateContext(void *)
{
        return new Parsers::Formats::HSXML::HSXMLFormatContext;
}
static void DestroyContext(void*, void *context_ptr)
{
        delete static_cast<Parsers::Formats::HSXML::HSXMLFormatContext*>(context_ptr);
}

int HSVM_ModuleEntryPoint(HSVM_RegData *regdata,void*)
{
        HSVM_RegisterContext (regdata, Parsers::Formats::HSXML::ContextId, NULL, &CreateContext, &DestroyContext);
        HSVM_RegisterFunction(regdata, "__GETPARSERDEFAULTS:PARSER_FORMAT_HSXML:R:", Parsers::Formats::HSXML::GetParserDefaults);
        HSVM_RegisterFunction(regdata, "__CREATECALLBACKFORMATOUTPUT:PARSER_FORMAT_HSXML:I:O", Parsers::Formats::HSXML::CreateHSXMLFormatOutput);
        HSVM_RegisterMacro(regdata, "__CLOSECALLBACKFORMATOUTPUT:PARSER_FORMAT_HSXML::I", Parsers::Formats::HSXML::CloseHSXMLFormatOutput);
        return 1;
}

} //end extern "C"

/* example command lines
   r:\whbuild\bin\runscript.exe
   with
   --moduledir R:/whbuild/bin --config Q:/webhare/whtree/etc/webhare-config.xml modulescript::beta/createhsxml.whscr "X:\data\Ontwikkeling\File formats\DocX\testfiles\ubertest.docx" r:/final/temp.xml
   or
   --moduledir R:/whbuild/bin --config Q:/webhare/whtree/etc/webhare-config.xml direct::q:/parsers/tests/msword/links.whscr
*/
