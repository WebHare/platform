#include <ap/libwebhare/allincludes.h>


#include "formatter.h"
#include "parserinterface.h"
#include <harescript/vm/hsvm_dllinterface.h>

namespace Parsers
{

void ApplyWordLinkHack(Parsers::Hyperlink *link)
{
        DEBUGPRINT("Fixup hyperlink " << link->data);

        //Allow the 'old' word hacks for backwards compatibility
        std::string::iterator hashstart = std::find(link->data.begin(), link->data.end(), '#');
        if(hashstart != link->data.end())
        {
                std::string locationdata(hashstart+1, link->data.end());
                DEBUGPRINT("Link hash data: " << locationdata);
                if (link->target.empty() && (Blex::StrCaseCompare(locationdata,"_blank")==0
                                            || Blex::StrCaseCompare(locationdata,"_self")==0
                                            || Blex::StrCaseCompare(locationdata,"_parent")==0))
                {
                        link->target = locationdata;
                        link->data.assign(link->data.begin(), hashstart);

                        DEBUGPRINT("Link updated to " << link->data << ", target to " << link->target);
                }
        }
}

std::string EncodeXML(std::string const &in)
{
        std::string out;
        Blex::EncodeValue(in.begin(), in.end(), std::back_inserter(out) );
        return out;
}

inline char HexDigit(unsigned value)
{ return (value&0xf) < 10 ? char((value&0xf) + '0') : char((value&0xf) - 10 + 'A'); }

std::string EncodeColor(DrawLib::Pixel32 color)
{
        char tempbuf[8];
        tempbuf[0]='#';
        tempbuf[1]=HexDigit(color.GetR() >> 4);
        tempbuf[2]=HexDigit(color.GetR());
        tempbuf[3]=HexDigit(color.GetG() >> 4);
        tempbuf[4]=HexDigit(color.GetG());
        tempbuf[5]=HexDigit(color.GetB() >> 4);
        tempbuf[6]=HexDigit(color.GetB());
        tempbuf[7]=0;
        return std::string(tempbuf);
}

std::ostream& operator << (std::ostream &str, ObjectType listtype)
{
        switch(listtype)
        {
                case NoList:           str << "none"; break;
                case InlineBullet:     str << "inline_bullet"; break;
                case SidebysideBullet: str << "sidebyside_bullet"; break;
                default:               str << "unknown listtype?"; break;
        }
        return str;
}
std::ostream& operator << (std::ostream &str, HorizontalAlignment data)
{
        switch(data)
        {
                case Left:      return str << "left";
                case Center:    return str << "center";
                case Right:     return str << "right";
                case Justified: return str << "justified";
                default:        return str << "unknown halign?";
        }
}
std::ostream& operator << (std::ostream &str, VerticalAlignment data)
{
        switch(data)
        {
                case Top:      return str << "top";
                case Middle:   return str << "middle";
                case Bottom:   return str << "bottom";
                default:       return str << "unknown valign?";
        }
}
std::ostream& operator << (std::ostream &str, const ImageInfo &data)
{
        str << " photo='" << (data.is_known_photo?"yes":"no") << "'";
        str << " lenx='" << data.lenx << "'";
        str << " leny='" << data.leny << "'";
        str << " alt='" << EncodeXML(data.alttag) << "'";
        str << " title='" << EncodeXML(data.title) << "'";
        if (!data.animated_gif.empty())
            str << " animatedgif='" << data.animated_gif.size() << "'";
        str << " halign='" << data.align << "'";
        str << " uniqueid='" << EncodeXML(data.uniqueid) << "'";
        return str;
}
std::ostream& operator << (std::ostream &str, Distance const &data)
{
        return str << "[distance:top="<<data.top<<",right="<<data.right<<",bottom="<<data.bottom<<",left="<<data.left<<"]";
}
std::ostream& operator << (std::ostream &str, const Paragraph &data)
{
        str << "<paraprops";
        str << " firstindent='" << data.first_indent << "'"
            << " padding='" << data.padding << "'"
            << " jc='" << data.jc << "'";
        str << "/>";
        return str;
}
std::ostream& operator << (std::ostream &str, const Character &data)
{
        str << "<charprops";
        if (data.format_bits & Character::Bold)           str << " bold='1'";
        if (data.format_bits & Character::Italic)         str << " italic='1'";
        if (data.format_bits & Character::Strikethrough)  str << " strikethrough='1'";
        if (data.format_bits & Character::Blink)          str << " blink='1'";
        if (data.format_bits & Character::Smallcaps)      str << " smallcaps='1'";
        if (data.format_bits & Character::DoubleStrike)   str << " doublestrike='1'";
        if (data.format_bits & Character::Shadow)         str << " shadow='1'";
        if (data.format_bits & Character::Emboss)         str << " emboss='1'";
        if (data.format_bits & Character::Imprint)        str << " imprint='1'";
        if (data.format_bits & Character::Outline)        str << " outline='1'";
        if (data.format_bits & Character::Overline)       str << " overline='1'";
        if (data.format_bits & Character::Insertion)      str << " insertion='1'";
        if (data.format_bits & Character::Deletion)       str << " deletion='1'";

        switch (data.subsuper)
        {
        case Character::NormalScript: break;
        case Character::SubScript:    str << " script='sub'"; break;
        case Character::SuperScript:  str << " script='super'"; break;
        default:                      str << " script='unknown subsuper?'"; break;
        }

        switch (data.underlining)
        {
        case Character::NoUnderline: break;
        case Character::SingleUnderline: str << " underline='single'"; break;
        default:                         str << " underline='unknown underlining?'"; break;
        }

        if (!data.foreground_color.IsFullyTransparent())
            str << " fgcolor='" << EncodeColor(data.foreground_color) << "'";
        if (!data.background_color.IsFullyTransparent())
            str << " bgcolor='" << EncodeColor(data.background_color) << "'";

        if (data.fonttype)
        {
                str << " fontface='" << data.fonttype->font_face << "'";
                str << " fontoverride='" << (data.fonttype->neveroverride?"never":"ok") << "'";
        }
        str << " fontsize='" << (float(data.font_halfpoint_size)/2) << "'";
        str << " />";
        return str;
}
std::ostream& operator << (std::ostream &str, Table::BorderType const &bordertype)
{
        str << " color='" << EncodeColor(bordertype.color)
            << "' thickness_twips='" << bordertype.thickness_twips
            << "' overlapped='" << (bordertype.overlapped?"yes":"no")
            << "'";
        return str;
}
std::ostream& operator << (std::ostream &str, Table::CellTypes celltype)
{
        switch(celltype)
        {
        case Table::Open: str << "open"; break;
        case Table::Data: str << "data"; break;
        case Table::OverlappedStartLower: str << "overlappedstartlower"; break;
        case Table::OverlappedRemainder: str << "overlappedremainder"; break;
        case Table::OutsideTable: str << "outsidetable"; break;
        default: str << "unknown celltype?";
        }
        return str;
}
std::ostream& operator << (std::ostream &str, Table::CellFormatting const &format)
{
        str << "<cellformat type='" << format.type << "'";
        if (format.type == Table::Data)
        {
                if (!format.background.IsFullyTransparent())
                    str << " bgcolor='" << EncodeColor(format.background) << "'";
                str << " valign='" << format.valign
                    << "' rowspan='" << format.rowspan
                    << "' colspan='" << format.colspan
                    << "' padding='" << format.padding
                    << "'";
        }
        str << ">";
        if (format.type == Table::Data)
        {
                str << "<topborder" << format.top << " />";
                str << "<rightborder" << format.right << " />";
                str << "<bottomborder" << format.bottom << " />";
                str << "<leftborder" << format.left << " />";
        }
        str << "</cellformat>\n";
        return str;
}

std::ostream& operator << (std::ostream &str, const Table &data)
{
        str << "\n<tableinfo rows='" << data.GetRows()
             << "' cols='" << data.GetColumns()
             << "' tablepadding='" << data.tablepadding
             << "' defaultcellpadding='" << data.default_cellpadding
             << "' cellspacing='" << data.cellspacing
             << "' halign='" << data.halign
             << "'>\n";

        str << "<widths>";
        for (std::vector<signed>::const_iterator itr=data.cellwidths.begin();
             itr!=data.cellwidths.end();
             ++itr)
        {
                str << "<column width=\"" << *itr << "\" />";
        }
        str << "</widths>\n";
        str << "<grid>\n";

        //Having set all borders, DUMP them!
        for (unsigned y=0;y<data.GetRows()+1;++y)
        {
                str << "<gridrow>\n";
                for (unsigned x=0;x<data.GetColumns()+1;++x)
                   str << data.GetFormatting(x,y);
                str << "</gridrow>\n";
        }
        str << "</grid>\n";
        str << "</tableinfo>\n";
        return str;
}

std::ostream& operator << (std::ostream &str, Hyperlink const &data)
{
        str << " data='" << EncodeXML(data.data) << "'";
        str << " object='" << data.objectptr << "'";
        str << " target='" << EncodeXML(data.target) << "'";
        str << " title='" << EncodeXML(data.title) << "'";
        return str;
}

Paragraph::Paragraph()
: jc(Left)
, first_indent(0)
, headinglevel(0)
, exactheight(false)
, lineheight(-100)
, mswordid(-1)
{
}

Table::Table()
: numrows(0)
, cellspacing(0)
, halign(Parsers::Left)
, tablewidth(0)
{
}

void Table::SetupGrid(unsigned columns, unsigned rows)
{
        grid.assign((columns+1)*(rows+1), CellFormatting());
        cellwidths.assign(columns,0);
        numrows=rows;

        for (unsigned i=0;i<rows;++i)
            GetFormatting(columns,i).type = OutsideTable;
        for (unsigned i=0;i<columns+1;++i)
            GetFormatting(i,rows).type = OutsideTable;
}

/*
Table::BorderType Table::GetCellRightBorder(unsigned column, unsigned row) const
{
        unsigned colspan = GetFormatting(column,row).colspan;
        if (column+colspan < GetColumns())
            return BorderType();

        return GetFormatting(column+colspan,row).left;
}

Table::BorderType Table::GetCellBottomBorder(unsigned column, unsigned row) const
{
        unsigned rowspan = GetFormatting(column,row).rowspan;
        if (row+rowspan < GetRows())
            return BorderType();

        return GetFormatting(column,row+rowspan).top;
}

Table::BorderType const& Table::GetIntersection(unsigned column, unsigned row) const
{
        //First look to the 'right' border (top border of cell (column,row) )
        if (GetFormatting(column,row).top.thickness_twips != 0)
            return GetFormatting(column,row).top;
        //Then, look to the 'top' border (left border of cell (column, row-1) )
        if (row>0 && GetFormatting(column,row-1).left.thickness_twips != 0)
            return GetFormatting(column,row-1).left;
        //Third, look to the 'left' border (top border of cell (column-1, row) )
        if (column>0 && GetFormatting(column-1,row).top.thickness_twips != 0)
            return GetFormatting(column-1,row).top;
        //All failed, so return the 'bottom' border (left border of cell (column,row) )
        return GetFormatting(column,row).left;
}
*/
unsigned Table::GetRightmostColumn(unsigned row) const
{
        for (unsigned i=GetColumns();i>0;--i)
        {
                CellFormatting const& format = GetFormatting(i-1,row);
                if(format.type==OverlappedStartLower) //we're below a rowspan cell
                    return GetColumns();
                else if(format.type==Data || format.type==Open)
                    return i-1;
        }
        return GetColumns();
}

unsigned Table::SpanToAboveCell(unsigned x, unsigned y)
{
        if(x>=GetColumns() || y>=GetRows())
            throw std::runtime_error("SpanToAboveCell called for a non-existing cell");
        if(GetFormatting(x,y).type != Open)
            throw std::runtime_error("SpanToAboveCell called for a non-open cell");

        unsigned startrow=y;
        for(;startrow>0;--startrow)
        {
                if(GetFormatting(x, startrow-1).type == Data)
                    break;
                if(GetFormatting(x, startrow-1).type != OverlappedStartLower)
                    throw std::runtime_error("SpanToAboveCell called for a cell that is not below (the left column of) a rowspan");
        }
        if(startrow==0)
            throw std::runtime_error("SpanToAboveCell called for a cell that is not below (the left column of) a rowspan");

        //startrow starts the actual range
        unsigned colspan = GetFormatting(x, startrow-1).colspan;
        GetFormatting(x, startrow-1).rowspan += 1;
        for (unsigned i=0;i<colspan; ++i)
        {
                if(GetFormatting(x+i,y).type != Open)
                    throw std::runtime_error("SpanToAboveCell called for a cell which does not have sufficient horizontal space to expand its row+colspan");
                GetFormatting(x+i,y).type = i==0 ? OverlappedStartLower : OverlappedRemainder;

                GetFormatting(x,y).bottom = GetFormatting(x,y-1).bottom;
        }

        GetFormatting(x,y).left = GetFormatting(x,y-1).left;
        GetFormatting(x+colspan-1,y).right = GetFormatting(x+colspan-1,y-1).right;
        return GetFormatting(x, startrow-1).colspan;
}

void Table::DeleteColumn(unsigned colindex)
{
        unsigned y=0;
        while (y<numrows)
        {
                //Is this a starting point?
                if(GetFormatting(colindex,y).type == Data)
                {
                        //Data must go. If we have a colspan, just decrease the remaining cell in size
                        if(GetFormatting(colindex,y).colspan>1)
                        {
                                //Merge into the next cell
                                assert(GetFormatting(colindex+1,y).type == OverlappedRemainder);
                                GetFormatting(colindex+1,y).colspan = GetFormatting(colindex,y).colspan-1;
                                GetFormatting(colindex+1,y).rowspan = GetFormatting(colindex,y).rowspan;
                                GetFormatting(colindex+1,y).type = Data;
                                GetFormatting(colindex+1,y).left = GetFormatting(colindex,y).left;

                                //In this case, we should also update the cell types of the next rows to OverlappedStartLower
                                for (unsigned rows_to_update = GetFormatting(colindex,y).rowspan; rows_to_update>1; --rows_to_update)
                                {
                                        unsigned update_y=y + rows_to_update-1;
                                        assert(GetFormatting(colindex,y+update_y).type == OverlappedStartLower);
                                        assert(GetFormatting(colindex+1,y+update_y).type == OverlappedRemainder);
                                        GetFormatting(colindex+1,y+update_y).type = OverlappedStartLower;
                                }
                        }
                        y += GetFormatting(colindex,y).rowspan;
                }
                else if (GetFormatting(colindex,y).type == OverlappedRemainder)
                {
                        //We are a middle point in an overlapped cell. Find our owner
                        assert(colindex>0);
                        unsigned startingcol;
                        for(startingcol = colindex-1;GetFormatting(startingcol,y).type == OverlappedRemainder;--startingcol)
                            /* loop until we found it */;

                        assert(startingcol < colindex);
                        assert(GetFormatting(startingcol,y).colspan > 1);
                        GetFormatting(startingcol,y).colspan -= 1;
                        y += GetFormatting(startingcol,y).rowspan;
                }
                else
                {
                        assert(GetFormatting(colindex,y).type == Open);
                        ++y;
                }
        }

        //If the table has an absolute width, we can entirely remove this column
        if(tablewidth>0 && cellwidths[colindex]>0)
            tablewidth -= cellwidths[colindex];

        //Remove the cells themselves from the grid
        for (unsigned y=numrows;y>0;--y)
            grid.erase(grid.begin() + (y-1) * cellwidths.size() + colindex);

        //And finally remove column-level metadata;
        cellwidths.erase(cellwidths.begin() + colindex);
}

bool Table::DoesNewCellFit(unsigned column, unsigned row, unsigned colspan, unsigned rowspan) const
{
        if (colspan == 0 || rowspan == 0 || column + colspan > GetColumns() || row + rowspan > GetRows())
            return false;

        for (unsigned x = column; x < column + colspan; ++x)
          for (unsigned y = row; y < row + rowspan; ++y)
            if (GetFormatting(x,y).type != Open)
                return false;

        return true;
}

//ADDME: Clean this up if it works: as a bit of  a hack, Createcell can be claled with colspan==rowspan==0 to redefine borders
Table::CellFormatting *Table::CreateCell(unsigned column, unsigned row,
                                unsigned colspan, unsigned rowspan,
                                BorderType const &topborder,
                                BorderType const &leftborder,
                                BorderType const &bottomborder,
                                BorderType const &rightborder)
{
        if (colspan!=0 && rowspan!=0)
        {
                if(!DoesNewCellFit(column, row, colspan, rowspan))
                {
                        throw std::runtime_error("Output::Table internal error: Trying to create a non-fitting cell");
                }

                for (unsigned y = row; y < row + rowspan; ++y)
                  for (unsigned x = column; x < column + colspan; ++x)
                {
                        CellFormatting &cell = GetFormatting(x,y);

                        if (x == column && y == row )
                        {
                                //We store the cell information into its top-left corner
                                cell.rowspan = rowspan;
                                cell.colspan = colspan;
                                cell.type = Data;
                        }
                        else //This is an overlapped cell
                        {
                                cell.type = x == column ? OverlappedStartLower : OverlappedRemainder;
                        }
                }
        }

        /* Set the vertical borders */
        for (unsigned y = row; y < row + (rowspan?rowspan:1); ++y)
        {
                GetFormatting(column, y).left = leftborder;
                GetFormatting(column, y).right = rightborder;
//                for (unsigned overlapx = column+1; overlapx < column + colspan - 1; ++overlapx)
//                    GetFormatting(overlapx, y).left.overlapped=true;
//                if (colspan >= 2)
//                    for (unsigned overlapx = column; overlapx < column + colspan - 2; ++overlapx)
//                        GetFormatting(overlapx, y).right.overlapped=true;
        }
        /* Set the horizontal borders */
        for (unsigned x = column; x < column + (colspan?colspan:1); ++x)
        {
                GetFormatting(x, row).top = topborder;
                GetFormatting(x, row).bottom = bottomborder;
//                for (unsigned overlapy = row+1; overlapy < row + rowspan - 1; ++overlapy)
//                    GetFormatting(x, overlapy).top.overlapped=true;
//                if (rowspan >= 2)
//                    for (unsigned overlapy = row; overlapy < row + rowspan - 2; ++overlapy)
//                        GetFormatting(x, overlapy).bottom.overlapped=true;
        }
        return &GetFormatting(column,row);
}

unsigned Table::GetNextCell(unsigned column, unsigned row) const
{
        CellTypes thistype = GetFormatting(column,row).type;

        if (thistype == Data)
            return column + GetFormatting(column,row).colspan;
        else if (thistype == Open)
        {
                //Look for non-Open cells
                for (++column; column < GetColumns(); ++column)
                  if (GetFormatting(column,row).type != Open)
                    return column;
                return GetColumns();
        }
        else //Look for any non overlapped-remainder cel
        {
                for (++column; column < GetColumns(); ++column)
                  if (GetFormatting(column,row).type != OverlappedRemainder)
                    return column;
                return GetColumns();
        }
}

Character::Character()
: format_bits(0)
, underlining(NoUnderline)
, subsuper(NormalScript)
, foreground_color(0,0,0,255) //black
, background_color(DrawLib::Pixel32::MakeTransparent())
, font_halfpoint_size(0)
, fonttype(NULL)
{
}

bool Character::operator ==(Character const &rhs) const
{
        return format_bits == rhs.format_bits
               && underlining == rhs.underlining
               && subsuper == rhs.subsuper
               && foreground_color == rhs.foreground_color
               && background_color == rhs.background_color
               && font_halfpoint_size == rhs.font_halfpoint_size
               && fonttype == rhs.fonttype
               && languagecode == rhs.languagecode;
}

ImageInfo::ImageInfo()
{
        is_known_photo=false;
        lenx=0;
        leny=0;
        align=0; //Unknown
}
ImageInfo::~ImageInfo()
{
}

FormattedOutput::FormattedOutput()
: vm(NULL)
, registered_id(0)
{
}
FormattedOutput::~FormattedOutput()
{
}
void FormattedOutput::HyperlinkHandler(bool is_open, Parsers::Hyperlink const &hyperlink)
{
        HSVM_ColumnId col_docobject = HSVM_GetColumnId(vm,"DOCOBJECT");
        HSVM_ColumnId col_href      = HSVM_GetColumnId(vm,"HREF");
        HSVM_ColumnId col_target    = HSVM_GetColumnId(vm,"TARGET");
        HSVM_ColumnId col_title     = HSVM_GetColumnId(vm,"TITLE");
        HSVM_ColumnId col_opened    = HSVM_GetColumnId(vm,"OPENED");

        HSVM_OpenFunctionCall(vm, 2);
        HSVM_IntegerSet(vm, HSVM_CallParam(vm,0), registered_id);

        HSVM_VariableId rec = HSVM_CallParam(vm,1);
        HSVM_SetDefault  (vm, rec, HSVM_VAR_Record);

        if(hyperlink.objectptr)
        {
                int32_t outputobjectid = hyperlink.objectptr->GetFinalOutputObjectId();
                std::string anchor = !hyperlink.data.empty() ? hyperlink.data : hyperlink.objectptr->GetAnchor();
                if(!anchor.empty())
                    anchor="#"+anchor;

                HSVM_IntegerSet  (vm, HSVM_RecordCreate(vm, rec, col_docobject), outputobjectid);
                HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, rec, col_href), anchor);
        }
        else
        {
                HSVM_IntegerSet  (vm, HSVM_RecordCreate(vm, rec, col_docobject), 0);
                HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, rec, col_href), hyperlink.data);
        }

        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, rec, col_target), hyperlink.target);
        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, rec, col_title), hyperlink.title);
        HSVM_BooleanSet  (vm, HSVM_RecordCreate(vm, rec, col_opened), is_open);

        static HSVM_VariableType funcargs[2]={HSVM_VAR_Integer, HSVM_VAR_Record};
        if (!HSVM_CallFunction(vm, "wh::formatter/output.whlib", "__ENTRYPOINT_HYPERLINKCALLBACK", 0, 2, funcargs))
            return;
        HSVM_CloseFunctionCall(vm);
}

bool FormattedOutput::AreImagesAccepted()
{ return true; }
bool FormattedOutput::AreHyperlinksAccepted()
{ return true; }
int32_t FormattedOutput::PredefineStyle(std::string const &, Paragraph const &, Character const &)
{ return 0; }
void FormattedOutput::SetAnchor(std::string const &)
{ }
void FormattedOutput::StartParagraph(int32_t, Paragraph const &, ObjectType )
{ }
void FormattedOutput::EnterParaText()
{ }
void FormattedOutput::EndParagraph()
{ }
void FormattedOutput::StartHyperlink(Hyperlink const &)
{ }
void FormattedOutput::EndHyperlink()
{ }
void FormattedOutput::ChangeFormatting(Character const &)
{ }
void FormattedOutput::WriteString(unsigned, char const *)
{ }
void FormattedOutput::StartTable(Table const &)
{ }
void FormattedOutput::EndTable()
{ }
void FormattedOutput::NextCell()
{ }
unsigned FormattedOutput::GetMaximumImageWidth()
{
        return 0;//no max
}
void FormattedOutput::InsertImage(Parsers::ImageInfo const &imginfo)
{
        int32_t maximagesize = GetMaximumImageWidth();
        if (maximagesize>0) // subtract margins, if necessary
        {
                maximagesize -= TwipsToPixels(imginfo.wrapping.left + imginfo.wrapping.right);
                if (maximagesize <= 0)
                    maximagesize = 1;
        }

        HSVM_OpenFunctionCall(vm, 2);
        HSVM_IntegerSet(vm, HSVM_CallParam(vm,0), registered_id);

        HSVM_VariableId rec = HSVM_CallParam(vm,1);
        HSVM_SetDefault(vm, rec, HSVM_VAR_Record);
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, rec, HSVM_GetColumnId(vm,"CELLSIZE")), maximagesize); //Still named 'cellsize' for legacy reasons
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, rec, HSVM_GetColumnId(vm,"BGCOLOR")), DrawlibtoHSPixel(GetBackgroundColor()));
        HSVM_BooleanSet(vm, HSVM_RecordCreate(vm, rec, HSVM_GetColumnId(vm,"IS_KNOWN_PHOTO")), imginfo.is_known_photo);
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, rec, HSVM_GetColumnId(vm,"LENX")), imginfo.lenx);
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, rec, HSVM_GetColumnId(vm,"LENY")), imginfo.leny);
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, rec, HSVM_GetColumnId(vm,"ALIGN")), imginfo.align);

        //return str << "[distance:top="<<data.top<<",right="<<data.right<<",bottom="<<data.bottom<<",left="<<data.left<<"]";
        HSVM_VariableId padding = HSVM_RecordCreate(vm, rec, HSVM_GetColumnId(vm,"PADDING"));
        HSVM_SetDefault(vm, padding , HSVM_VAR_Record);
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, padding , HSVM_GetColumnId(vm,"TOP")), imginfo.wrapping.top);
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, padding , HSVM_GetColumnId(vm,"RIGHT")), imginfo.wrapping.right);
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, padding , HSVM_GetColumnId(vm,"LEFT")), imginfo.wrapping.left);
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, padding , HSVM_GetColumnId(vm,"BOTTOM")), imginfo.wrapping.bottom);

        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, rec, HSVM_GetColumnId(vm,"MARGINLEFT")), TwipsToPixels(imginfo.wrapping.left));
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, rec, HSVM_GetColumnId(vm,"MARGINTOP")), TwipsToPixels(imginfo.wrapping.top));
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, rec, HSVM_GetColumnId(vm,"MARGINRIGHT")), TwipsToPixels(imginfo.wrapping.right));
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, rec, HSVM_GetColumnId(vm,"MARGINBOTTOM")), TwipsToPixels(imginfo.wrapping.bottom));
        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, rec, HSVM_GetColumnId(vm,"UNIQUEID")), imginfo.uniqueid);
        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, rec, HSVM_GetColumnId(vm,"ALTTAG")), imginfo.alttag);
        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, rec, HSVM_GetColumnId(vm,"TITLE")), imginfo.title);
        HSVM_MakeBlobFromMemory(vm, HSVM_RecordCreate(vm, rec, HSVM_GetColumnId(vm, "ANIMATED_GIF")), imginfo.animated_gif.size(), &imginfo.animated_gif[0]);

        //FIXME: Ugly code mixup.. move above stuff etc to formatter.cpp or similair?
        Parsers::PushPaintFunction(vm, imginfo.painter);

        static HSVM_VariableType funcargs[2]={HSVM_VAR_Integer, HSVM_VAR_Record};
        if (!HSVM_CallFunction(vm, "wh::formatter/output.whlib", "__ENTRYPOINT_IMAGECALLBACK", 0, 2, funcargs))
            return;
        HSVM_CloseFunctionCall(vm);
        Parsers::PopPaintFunction(vm);
}
void FormattedOutput::FlushOutput()
{ }
DrawLib::Pixel32 FormattedOutput::GetBackgroundColor()
{
        return DrawLib::Pixel32(255,255,255,0);
}
void FormattedOutput::GetBaseFormatting(Character *formatting)
{
        *formatting = Character();
}



ForwardingOutput::ForwardingOutput(FormattedOutputPtr const &dest)
: dest(dest)
{
}
ForwardingOutput::~ForwardingOutput()
{
}
unsigned ForwardingOutput::GetMaximumImageWidth()
{
        VerifyDestination();
        return dest->GetMaximumImageWidth();
}
void ForwardingOutput::NoDestination()
{
        throw std::runtime_error("ForwardingOutput does not have a destination set");
}
bool ForwardingOutput::AreHyperlinksAccepted()
{
        VerifyDestination();
        return dest->AreHyperlinksAccepted();
}
bool ForwardingOutput::AreImagesAccepted()
{
        VerifyDestination();
        return dest->AreImagesAccepted();
}
DrawLib::Pixel32 ForwardingOutput::GetBackgroundColor()
{
        VerifyDestination();
        return dest->GetBackgroundColor();
}
void ForwardingOutput::GetBaseFormatting(Character *formatting)
{
        VerifyDestination();
        return dest->GetBaseFormatting(formatting);
}
int32_t ForwardingOutput::PredefineStyle(std::string const &suggestedname, Paragraph const &formatpara, Character const &formatchar)
{
        VerifyDestination();
        return dest->PredefineStyle(suggestedname, formatpara, formatchar);
}
void ForwardingOutput::SetAnchor(std::string const &anchor)
{
        VerifyDestination();
        dest->SetAnchor(anchor);
}
void ForwardingOutput::StartParagraph(int32_t predefstyle,Paragraph const &format_para,ObjectType listtype)
{
        VerifyDestination();
        dest->StartParagraph(predefstyle,format_para,listtype);
}
void ForwardingOutput::EnterParaText()
{
        VerifyDestination();
        dest->EnterParaText();
}
void ForwardingOutput::EndParagraph()
{
        VerifyDestination();
        dest->EndParagraph();
}
void ForwardingOutput::StartHyperlink(Hyperlink const &hyperlink)
{
        VerifyDestination();
        dest->StartHyperlink(hyperlink);
}
void ForwardingOutput::EndHyperlink()
{
        VerifyDestination();
        dest->EndHyperlink();
}
void ForwardingOutput::ChangeFormatting(Character const &new_format)
{
        VerifyDestination();
        dest->ChangeFormatting(new_format);
}
void ForwardingOutput::WriteString (unsigned numchars, char const *firstchar)
{
        VerifyDestination();
        dest->WriteString (numchars, firstchar);
}
void ForwardingOutput::StartTable(Table const &tableformat)
{
        VerifyDestination();
        dest->StartTable(tableformat);
}
void ForwardingOutput::EndTable()
{
        VerifyDestination();
        dest->EndTable();
}
void ForwardingOutput::NextCell()
{
        VerifyDestination();
        dest->NextCell();
}
void ForwardingOutput::InsertImage(ImageInfo const &img)
{
        VerifyDestination();
        dest->InsertImage(img);
}
void ForwardingOutput::FlushOutput()
{
        VerifyDestination();
        dest->FlushOutput();
}


RawTextFilter::RawTextFilter(unsigned _maxlen, bool _skip_bulnum)
: maxlen(_maxlen)
, skip_bulnum(_skip_bulnum)
, now_skipping_bulnum(false)
{
}

RawTextFilter::~RawTextFilter()
{
}
void RawTextFilter::StartParagraph(int32_t , Paragraph const &, ObjectType )
{
        if (skip_bulnum)
            now_skipping_bulnum=true;
}
void RawTextFilter::EnterParaText()
{
        now_skipping_bulnum=false;
}
void RawTextFilter::WriteString(unsigned numchars, char const *firstchar)
{
        if (now_skipping_bulnum)
            return;

        //ADDME: Remap special characters (eg SymbolBullet) to Unicode characters

        if (maxlen)
            rawtext.insert(rawtext.end(), firstchar, firstchar + std::min<unsigned>(maxlen - rawtext.size(), numchars));
        else
            rawtext.insert(rawtext.end(), firstchar, firstchar + numchars);
}
bool RawTextFilter::AreImagesAccepted() //speed up (at least) Word rendering
{
        return false;
}
bool RawTextFilter::AreHyperlinksAccepted() //speed up (at least) Word rendering
{
        return false;
}
void RawTextFilter::NextCell()
{
        if (maxlen && rawtext.size() < maxlen)
            rawtext += '\n';
}

OutputObjectInterface::OutputObjectInterface()
: outputobjectid(0)
{
}
OutputObjectInterface::~OutputObjectInterface()
{
}
std::string OutputObjectInterface::GetAnchor() const
{
        return std::string();
}
int32_t OutputObjectInterface::GetFinalOutputObjectId() const
{
        return outputobjectid;
}

} //end namespace Parsers
