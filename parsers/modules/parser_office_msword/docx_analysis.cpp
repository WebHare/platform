#include <ap/libwebhare/allincludes.h>


#include "docx.h"
#include "docx_parse.h"
#include "word_fields.h"

namespace Parsers {
namespace Office {
namespace Word {
namespace DocX {

extern Blex::XML::Namespace xmlns_wordml;

Blex::XML::Node GetFirstChildByName(Blex::XML::Node start, Blex::XML::Namespace const *ns, std::string const &name)
{
        for(Blex::XML::NodeIterator itr = start.GetChildNodeIterator(ns); itr; ++itr)
          if(itr->LocalNameIs(name))
            return *itr;

        return Blex::XML::Node();
}

DocXTable::DocXTable(DocXDoc &doc, Blex::XML::Node tableprops)
:doc(doc)
{
        if(tableprops)
        {
                Blex::XML::Node prop = tableprops.GetFirstChild();

                StyleBase const* tablestyle = doc.default_table_style;
                if(prop.LocalNameIs("tblStyle"))
                {
                        StyleBase const* trystyle = doc.GetStyleByDocXId(GetAttr(prop, "val"));
                        if(trystyle && trystyle->type == StyleBase::TableStyle)
                            tablestyle=trystyle;
                        prop=prop.GetNextSibling();
                }

                if(tablestyle)
                    static_cast<DocXTableStyle const*>(tablestyle)->ApplyTableStyle(this);

                for(;prop;prop=prop.GetNextSibling())
                    defaulttap.ApplySingleDocXProp(prop);

                ApplyGlobalPropsFromTap(defaulttap);
        }
}
DocXTable::~DocXTable()
{
}

void DocXTableStyle::ApplyTableStyle(DocXTable *doctable) const
{
        //Apply parent style, if any
        if(stylehistory.size()>2)
            static_cast<DocXTableStyle const*>(stylehistory[stylehistory.size()-2])->ApplyTableStyle(doctable);

        //Process our options
        if(tblpr)
            doctable->defaulttap.ApplyDocXProps(tblpr);
}

unsigned DocXDoc::ScanCell(DocXParagraphWalker &walker, DocPart *parent, Blex::XML::Node cellitr, DocXTable *table, unsigned rownum, unsigned celloffset, Tap const &tap, unsigned gridbefore, unsigned gridafter)
{
        Blex::XML::Node propnode;
        unsigned colspan = 1;

        if(cellitr && cellitr.LocalNameIs("tcPr")) //pg 464: 2.4.67
        {
                propnode = cellitr;
                cellitr = cellitr.GetNextSibling(); //move past the tcPr property

                //First loop to discover the most important properties
                for(Blex::XML::Node tcptr = propnode.GetFirstChild(); tcptr; tcptr = tcptr.GetNextSibling())
                {
                        if(tcptr.LocalNameIs("gridSpan"))
                        {
                                colspan = GetS32Attr(tcptr, "val");
                        }
                        else if(tcptr.LocalNameIs("vMerge"))
                        {
                                if(GetAttr(tcptr, "val") != "restart")
                                    return table->tableformat.SpanToAboveCell(celloffset, rownum);
                        }
                }
        }


        Brc top = rownum == 0 ? tap.default_topborder : tap.default_innerhorizontalborder;
        Brc bottom = rownum == table->rows.size()-1 ? tap.default_bottomborder : tap.default_innerhorizontalborder;
        //FIXME Use InnerV based on gridbefore/after
        Brc left = celloffset == gridbefore ? tap.default_leftborder : tap.default_innerverticalborder;
        Brc right = celloffset + colspan + gridafter == table->tableformat.GetColumns() ? tap.default_rightborder : tap.default_innerverticalborder;

        DrawLib::Pixel32 cellbackground(0,0,0,0);
        Parsers::Distance cellpadding = tap.default_cellpadding;

        if(propnode) //pg 464: 2.4.67
        {
                for(Blex::XML::Node tcptr = propnode.GetFirstChild(); tcptr; tcptr = tcptr.GetNextSibling())
                {
                        if(tcptr.LocalNameIs("tcBorders"))
                        {
                                for (Blex::XML::Node borderitr = tcptr.GetFirstChild();borderitr;borderitr = borderitr.GetNextSibling())
                                  if(borderitr.LocalNameIs("top"))
                                    top = ParseDocXBorder(borderitr);
                                  else if(borderitr.LocalNameIs("left"))
                                    left = ParseDocXBorder(borderitr);
                                  else if(borderitr.LocalNameIs("right"))
                                    right = ParseDocXBorder(borderitr);
                                  else if(borderitr.LocalNameIs("bottom"))
                                    bottom = ParseDocXBorder(borderitr);
                        }
                        else if(tcptr.LocalNameIs("shd"))
                        {
                                cellbackground = ParseShading(tcptr);
                        }
                        else if(tcptr.LocalNameIs("tcMar"))
                        {
                                ParseDocXMargins(tcptr, &cellpadding);
                        }
                }
        }

        //ADDME: Merge Brc and BorderType..
        Parsers::Table::BorderType top_, left_, right_, bottom_;
        Word::BrcToBorder(&top_, top);
        Word::BrcToBorder(&left_, left);
        Word::BrcToBorder(&bottom_, bottom);
        Word::BrcToBorder(&right_, right);

        Table::CellFormatting *cellformat
            = table->tableformat.CreateCell(celloffset, rownum, colspan, 1,
                                           top_, left_, bottom_, right_);
        cellformat->padding = cellpadding;
        cellformat->background = cellbackground;

        DocXTable::Row &row = table->rows[rownum];
        row.cells.push_back(DocXTable::Cell());

        DocXTable::Cell &cell = row.cells.back();
        cell.offset = celloffset;
        cell.firstpart = ScanParts(walker, parent, cellitr);
        return colspan;
}

void DocXDoc::ScanRow(DocXParagraphWalker &walker, DocPart *parent, Blex::XML::Node tr, DocXTable *table, unsigned rownum)
{
        //ADDME Implement row-level table border overrides

        Tap mytap = table->defaulttap; //my tap, my tap, talking 'bout my tap... my tap!

        unsigned gridbefore=0, gridafter=0;
        Blex::XML::Node rowitr = tr.GetFirstChild();

        if(rowitr && rowitr.LocalNameIs("tblPrEx"))
        {
                for(Blex::XML::Node prop = rowitr.GetFirstChild(); prop; prop=prop.GetNextSibling())
                    mytap.ApplySingleDocXProp(prop);
                rowitr=rowitr.GetNextSibling();
        }
        if(rowitr && rowitr.LocalNameIs("trPr"))
        {
                for(Blex::XML::Node prop = rowitr.GetFirstChild(); prop; prop=prop.GetNextSibling())
                {
                        if(prop.LocalNameIs("gridBefore"))
                            gridbefore = GetS32Attr(prop, "val");
                        if(prop.LocalNameIs("gridAfter"))
                            gridafter = GetS32Attr(prop, "val");
                }
                rowitr=rowitr.GetNextSibling();
        }

        unsigned cell_offset=gridbefore;
        for(; rowitr; rowitr=rowitr.GetNextSibling())
          if(rowitr.LocalNameIs("tc"))
          {
                cell_offset += ScanCell(walker, parent, rowitr.GetFirstChild(), table, rownum, cell_offset, mytap, gridbefore, gridafter);
          }
}

DocPart* DocXDoc::ScanTable(DocXParagraphWalker &walker, DocPart *parent, Blex::XML::Node tablenode)
{
        //First map the table and find the primary stuff
        std::vector<int> cellwidths;
        Blex::XML::Node tableprops;
        std::vector< Blex::XML::Node> rows;

        for (Blex::XML::NodeIterator itr = tablenode.GetChildNodeIterator(&xmlns_wordml);itr;++itr)
        {
                if(itr->LocalNameIs("tblPr")) //pg441: 2.4.56
                {
                        tableprops=*itr;
                }
                else if(itr->LocalNameIs("tblGrid")) //pg419: 2.4.44
                {
                        for (Blex::XML::NodeIterator griditr = itr->GetChildNodeIterator(&xmlns_wordml); griditr; ++griditr)
                        {
                                if(griditr->LocalNameIs("gridCol")) //pg 309: 2.4.12
                                {
                                        unsigned cellwidth = GetS32Attr(*griditr, "w");
                                        cellwidths.push_back(cellwidth);
                                }
                                else
                                {
                                        DEBUGPRINT("Did not understand table grid node " << griditr->GetLocalName());
                                }
                        }
                }
                else if(itr->LocalNameIs("tr")) //pg491: 2.4.75  table row!
                {
                        rows.push_back(*itr);
                }
                else
                {
                        DEBUGPRINT("Did not understand table node " << itr->GetLocalName());
                }
        }

        //Now that we've got everything, startt analyinz
        if(!tableprops || cellwidths.empty() || rows.empty())
            throw std::runtime_error("Document contains a table without a grid");


        DocXTable *table = tableparts.Adopt(new DocXTable(*this, tableprops));
        DocXTableHolder *tableholder = static_cast<DocXTableHolder *>(AdoptAndRegisterPart(new DocXTableHolder(parent, *this, table)));

        table->tableformat.SetupGrid(cellwidths.size(), rows.size());
        table->tableformat.cellwidths = cellwidths;
        table->rows.resize(rows.size());

        for (unsigned row=0;row<rows.size();++row)
            ScanRow(walker, tableholder, rows[row], table, row);

        table->PostProcess();
        return tableholder;
}

DocPart* DocXDoc::ScanSDT(DocXParagraphWalker &walker, DocPart *parent, Blex::XML::Node node)
{
        DEBUGPRINT("Inside SDT");
        for(node=node.GetFirstChild(); node; node = node.GetNextSibling())
        {
                if(node.LocalNameIs("sdtPr"))
                    continue; //properties of this one, ignore
                if(node.LocalNameIs("sdtContent"))
                    return ScanParts(walker, parent, node.GetFirstChild());
                DEBUGPRINT("Unrecognized node type in SDT: " << node.GetLocalName());
        }
        return NULL;
}

DocPart* DocXDoc::ScanParts(DocXParagraphWalker &walker, DocPart *parent, Blex::XML::Node node)
{
        DocPart *first=0, *last=0;
        std::vector<std::string> cached_bookmarks;

        while(node)
        {
                DocPart *part=0;
                bool flushanchors = false;

                if(node.LocalNameIs("p"))
                {
                        part=ScanParagraph(walker,parent, node);
                        flushanchors = true;
                }
                else if (node.LocalNameIs("tbl")) //pg404: 2.4.36
                {
                        part=ScanTable(walker,parent, node);
                        flushanchors = true;
                }
                else if (node.LocalNameIs("sdt")) //structured document tag. 2nd1: 17.5.2.29 pdfpage 596
                    part=ScanSDT(walker,parent, node);
                else if(node.LocalNameIs("bookmarkStart"))
                {
                        std::string name = node.GetAttr(&xmlns_wordml,"name");
                        DEBUGPRINT("Found bookmark [" << name << "] outside part");
                        if(!name.empty())
                                cached_bookmarks.push_back(name);
                }
                else
                    DEBUGPRINT("Unrecognized node type " << node.GetLocalName());

                if(part)
                {
                        if(flushanchors && !cached_bookmarks.empty())
                        {
                                for(unsigned i=0;i<cached_bookmarks.size();++i)
                                {
                                        if(cached_bookmarks[i][0] != '_')
                                                part->initialanchors.push_back(cached_bookmarks[i]);
                                        bookmarks.insert(std::make_pair(cached_bookmarks[i],part));
                                }
                                cached_bookmarks.clear();
                        }

                        if(!first)
                            first=part;
                        if(last)
                        {
                                last->next=part;
                                part->prev=last;
                        }
                        last=part;
                        //Some functions, such as ScanSDT can return a chain of paras, so find the real end
                        while(last->next)
                            last=last->next;
                }
                node=node.GetNextSibling();
        }
        return first;
}

bool ParanodeHasDel(Blex::XML::Node paranode)
{
        for (Blex::XML::NodeIterator itr = paranode.GetChildNodeIterator(&xmlns_wordml);itr;++itr)
          if(itr->LocalNameIs("pPr"))
            for (Blex::XML::NodeIterator itr2 = itr->GetChildNodeIterator(&xmlns_wordml);itr2;++itr2)
             if(itr2->LocalNameIs("rPr"))
                for (Blex::XML::NodeIterator itr3 = itr2->GetChildNodeIterator(&xmlns_wordml);itr3;++itr3)
                 if(itr3->LocalNameIs("del"))
                   return true;
        return false;
}



DocPart* DocXDoc::ScanParagraph(DocXParagraphWalker &walker, DocPart *parent, Blex::XML::Node paranode)
{
        bool merged_with_prev=false;

        DocXParagraph *part = NULL;
        if(merge_with_next)
        {
                merged_with_prev = true;
                part = merge_with_next;
                merge_with_next = NULL;

                part->ExtendParagraph(paranode);
        }
        else
        {
                part = static_cast<DocXParagraph*>(AdoptAndRegisterPart(new DocXParagraph(parent, *this, paranode)));
                part->initialfieldstack = walker.fieldstack;
        }

        if(tcmode == DocBase::TCFinal || tcmode == DocBase::TCOriginal)
        {
                //Need to look for <w:del /> inside <w:pPr> <w:rPr>
                if(ParanodeHasDel(paranode) && tcmode == DocBase::TCFinal)
                {
                        merge_with_next = part;
                }
        }

        bool seencontent = false;
        ScanRuns(walker, paranode, part, &seencontent);
        return merged_with_prev ? NULL : part;
}

void DocXDoc::ScanRuns(DocXParagraphWalker &walker, Blex::XML::Node paranode, DocXParagraph *part, bool *seencontent)
{
        for (Blex::XML::NodeIterator itr = paranode.GetChildNodeIterator(&xmlns_wordml);itr;++itr)
        {
                if(itr->LocalNameIs("pPr"))
                {
                        part->AddPpr(*itr);
                }
                else if(itr->LocalNameIs("bookmarkStart"))
                {
                        std::string name = itr->GetAttr(&xmlns_wordml,"name");
                        DEBUGPRINT("Paragraph contains bookmark start for [" << name << "]");
                        if(name.empty())
                            continue;

                        // If this bookmark looks like it was user-generated, store its name
                        if(name[0]!='_')
                        {
                              if(!*seencontent) //initialanchor only if we haven't displayed content yet
                                part->initialanchors.push_back(name);
                              else
                                part->otheranchors.push_back(name);
                        }

                        bookmarks.insert(std::make_pair(name,part));
                }
                else if(itr->LocalNameIs("bookmarkEnd"))
                {
                        std::string name = itr->GetAttr(&xmlns_wordml,"name");
                        DEBUGPRINT("Paragraph contains bookmark end for [" << name << "]");
                }
                else if(itr->LocalNameIs("hyperlink"))
                {
                        std::string anchor = itr->GetAttr(&xmlns_wordml, "anchor");
                        if(!anchor.empty())
                            referred_anchors.insert(anchor);
                }
                else if(itr->LocalNameIs("r"))
                {
                        ScanRun(walker, *itr, part, seencontent);
                }
                else
                {
                        ScanRuns(walker, *itr, part, seencontent);
                }
        }
}
void DocXDoc::ScanRun(DocXParagraphWalker &walker, Blex::XML::Node runnode, DocXParagraph *part, bool *seencontent)
{
        for (Blex::XML::NodeIterator itr = runnode.GetChildNodeIterator(&xmlns_wordml);itr;++itr)
        {
                if(itr->LocalNameIs("fldChar"))
                {
                        FieldInfo fld = walker.ProcessFieldChar(*itr);
                        DEBUGPRINT("ANALYSIS fldChar " << (int)fld.first << " " << fld.second.instruction);
                        if(fld.first==FieldStates::Separate && Blex::StrLike(fld.second.instruction,"HYPERLINK *"))
                        {
                                Parsers::Hyperlink currentscanlink = ParseFieldCodeHyperlink(fld.second.instruction);
                                if (!currentscanlink.data.empty() && currentscanlink.data[0]=='#')
                                {
                                        std::string locationdata = std::string(currentscanlink.data.begin()+1, currentscanlink.data.end());
                                        referred_anchors.insert(locationdata);
                                        DEBUGPRINT("Picked up requested hyperlink " << locationdata);
                                }
                        }
                        else if(fld.first==FieldStates::Separate && Blex::StrLike(fld.second.instruction,"REF *"))
                        {
                                Parsers::Hyperlink currentscanlink = ParseFieldCodeHyperlink(fld.second.instruction);
                                std::string locationdata = std::string(currentscanlink.data.begin(), currentscanlink.data.end());
                                referred_anchors.insert(locationdata);
                                DEBUGPRINT("Picked up requested ref '" << locationdata << "'");
                        }
                        else if(fld.first==FieldStates::End && (Blex::StrLike(fld.second.instruction,"HYPERLINK *") || Blex::StrLike(fld.second.instruction,"REF *")))
                        {
                                DEBUGPRINT("Analyze: Closing open link");
                        }
                }
                else if(itr->LocalNameIs("instrText"))
                {
                        walker.ProcessFieldInstr(*itr);
                }
                else if(itr->LocalNameIs("pict") || itr->LocalNameIs("drawing") || itr->LocalNameIs("t"))
                {
                        if(!*seencontent)
                                DEBUGPRINT("Seen '" << itr->GetLocalName() << "' node, marking this paragraph as content-seeen");
                        *seencontent=true;
                }
                else
                {
                        ScanRun(walker, *itr, part, seencontent);
                }
        }
}

std::pair<unsigned, std::string> DocXDoc::ScanStructure()
{
        //Find the body
        Blex::XML::Node worddoc = maindoc.GetRoot();
        if(!worddoc || !worddoc.IsInNamespace(xmlns_wordml) || !worddoc.LocalNameIs("document"))
            throw std::runtime_error("No root node in the document");

        Blex::XML::Node body = GetFirstChildByName(worddoc, &xmlns_wordml, "body");
        if(!body)
            throw std::runtime_error("No body node in the document");

        DocXParagraphWalker walker(*this);
        firstpart = ScanParts(walker, NULL, body.GetFirstChild());
        return std::make_pair(0,"");
}

} // End of namespace DocX
} // End of namespace Word
} // End of namespace Office
} // End of namespace Parsers
