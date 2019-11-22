#include <ap/libwebhare/allincludes.h>



#include <iomanip>
#include <iostream>
#include <blex/utils.h>
#include "biff_analysis.h"

#define DEBUGTABLES

namespace Parsers {
namespace Office {
namespace Word {

void BiffTable::DumpTable()
{
        DEBUGPRINT("Legend: Row skip(begincells,endcells), all other numbers are margins\n"
                     "Flags: 'V'=vertmerge start, 'v'=vertmerge");
        for (unsigned i=0;i<rows.size();++i)
        {
                DEBUGPRINT("Row " << i << ":" << rowtaps[i]);
        }
}

TableScanner::TableScanner(BiffDoc const &scanner)
: doc(scanner)
{
}

void TableScanner::ScanTable(TableDocPart *part)
{
        BiffTable *bifftable = static_cast<BiffTable*>(part);

        //DEBUGPRINT("Scanning table at para " << start << " to " << limit << " level " << tablelevel);
        if (part->rows.empty() || bifftable->margins.size()<2)
            return;

        //Setup the table layout
        part->ApplyGlobalPropsFromTap(bifftable->rowtaps[0]);

        part->tableformat.SetupGrid(bifftable->margins.size()-1, part->rows.size());
        for (unsigned i=0;i<bifftable->margins.size()-1;++i)
            part->tableformat.cellwidths[i] = bifftable->margins[i+1] - bifftable->margins[i];

        //Add individual rows and their cells
        for (unsigned i=0;i<part->rows.size();++i)
            ProcessRow(i, bifftable);
}

std::pair<unsigned,unsigned> TableScanner::FindDepth(BiffTable const *bifftable, unsigned row, unsigned col)
{
        int32_t margin = bifftable->rowtaps[row].margins[col];
        for (++row;row < bifftable->rows.size();++row)
        {
                Tap const &testrow=bifftable->rowtaps[row];

                //Find the cell!
                unsigned local_cell = std::find(testrow.margins.begin(),
                                                testrow.margins.end(),
                                                margin) - testrow.margins.begin();

                //Does the vertical merge end here?
                if (local_cell >= testrow.cells.size()
                    || !testrow.cells[local_cell].fVertMerge
                    || testrow.cells[local_cell].fVertRestart)
                    break;

                col=local_cell;
        }
        return std::make_pair(col,row-1);
}

void TableScanner::ProcessRow(unsigned rownum, BiffTable *bifftable)
{
        BiffTable::Row &row=bifftable->rows[rownum];
        Tap const &rowtap=bifftable->rowtaps[rownum];

        DEBUGPRINT("Row " << rownum << " jc: " << rowtap.table_jc << " split? " << (rowtap.cantsplit?"true":"false")
                   << " header? " << (rowtap.tableheader?"true":"false") << " gap: " << rowtap.dxaGapHalf);

        if (rowtap.margins.size()<2 || row.cells.empty())
        {
                DEBUGPRINT("Row is EMPTY! SKIP!\a");
                return;
        }

        //Okay, figure out the left margin
        unsigned cur_output_cell = Blex::BinaryClosestFind(bifftable->margins.begin(),bifftable->margins.end(),rowtap.margins[0])
                                   - bifftable->margins.begin();

        //Walk through all Word cells on this row
        for (unsigned cur_word_cell = 0;
             cur_word_cell < row.cells.size();
             ++cur_word_cell)
        {
                assert(row.cells.size() == rowtap.cells.size());

                std::pair<unsigned,unsigned> bottomcellpos = FindDepth(bifftable, rownum,cur_word_cell);

                //let's see how much down we can go (figure out rowspan)
                bool overlapped = (!rowtap.cells[cur_word_cell].fVertRestart && rowtap.cells[cur_word_cell].fVertMerge) //vertically overlapped
                                  || (!rowtap.cells[cur_word_cell].fFirstMerged && rowtap.cells[cur_word_cell].fMerged); //horizontally merged

                //This cell must be span 'numcells' Word cells. So figure
                //out its real right boundary
                unsigned rightmargin = Blex::BinaryClosestFind(bifftable->margins.begin(),bifftable->margins.end(),rowtap.margins[cur_word_cell+1])
                                       - bifftable->margins.begin();

                unsigned colspan = rightmargin - cur_output_cell;

                //Store settings
                Parsers::Table::BorderType top,left,right,bottom;
                TableCell const &topcell = rowtap.cells[cur_word_cell];
                TableCell const &bottomcell = bifftable->rowtaps[bottomcellpos.second].cells[bottomcellpos.first];

                //Figure out table borders
                if (topcell.bordertop.IsDefault())
                    BrcToBorder(&top, rownum == 0 ? rowtap.default_topborder : rowtap.default_innerhorizontalborder);
                else
                    BrcToBorder(&top, topcell.bordertop);

                if (topcell.borderleft.IsDefault())
                    BrcToBorder(&left, cur_word_cell == 0 ? rowtap.default_leftborder : rowtap.default_innerverticalborder);
                else
                    BrcToBorder(&left, topcell.borderleft);

                if (topcell.borderright.IsDefault())
                    BrcToBorder(&right, cur_word_cell == row.cells.size()-1 ? rowtap.default_rightborder : rowtap.default_innerverticalborder);
                else
                    BrcToBorder(&right, topcell.borderright);

                if (bottomcell.borderbottom.IsDefault())
                    BrcToBorder(&bottom, rownum == bifftable->rows.size()-1 ? rowtap.default_bottomborder : rowtap.default_innerhorizontalborder);
                else
                    BrcToBorder(&bottom, bottomcell.borderbottom);

                //Create the cell
                row.cells[cur_word_cell].offset = cur_output_cell;
                Table::CellFormatting *cellformat =
                  bifftable->tableformat.CreateCell(cur_output_cell, rownum,
                                         overlapped ? 0 : colspan,
                                         overlapped ? 0 : bottomcellpos.second-rownum+1,
                                         top, left, bottom, right);
                cellformat->background = topcell.bgcolor;
                cellformat->valign = topcell.vertalign;
                cellformat->tableheader = row.cells[cur_word_cell].tableheader;

                cellformat->padding.left = topcell.cellpadding.left==0xFFFFFFFF   ? rowtap.default_cellpadding.left  : topcell.cellpadding.left;
                cellformat->padding.right = topcell.cellpadding.right==0xFFFFFFFF  ? rowtap.default_cellpadding.right  : topcell.cellpadding.right;
                cellformat->padding.top    = topcell.cellpadding.top==0xFFFFFFFF    ? rowtap.default_cellpadding.top    : topcell.cellpadding.top;
                cellformat->padding.bottom = topcell.cellpadding.bottom==0xFFFFFFFF ? rowtap.default_cellpadding.bottom : topcell.cellpadding.bottom;

//                if(!overlapped)
//                    allcells.push_back(row.cells[cur_word_cell]);

                cur_output_cell += colspan;
        }
}

BiffParaAnalyzer::BiffParaAnalyzer(BiffDoc &biffdoc)
: biffdoc(biffdoc)
, merge_with_next(NULL)
, mypap(biffdoc)
{
        lastpart.push_back(NULL);
}

BiffParaAnalyzer::~BiffParaAnalyzer()
{
}

/* The BIFF format stores tables as paragraph formatting. Any paragraph with a set
   table level, is part of a table. Row ends are specially formatted paragraphs
   Consequently, there is no real 'end of table' - a table ends before the
   first paragraph with a lower table level. (This is why two tables in Word
   will merge together if you remove all paragraphs between them) */

void BiffParaAnalyzer::OpenTable()
{
        BiffTable *table = biffdoc.tableparts.Adopt(new BiffTable);
        tablestack.push(table);
        lastpart.push_back(NULL);
        NextRow();
}
void BiffParaAnalyzer::NextRow()
{
        tablestack.top()->rows.push_back(BiffTable::Row());
        if(tablestack.top()->rows.size()>1) //use the # of cells in first row as an estimate
            tablestack.top()->rows.back().cells.reserve(tablestack.top()->rows.end()[-2].cells.size() + 1);
        NextCell();
}
void BiffParaAnalyzer::NextCell()
{
        tablestack.top()->rows.back().cells.resize(tablestack.top()->rows.back().cells.size() + 1);
        lastpart.back() = NULL;
}

void BiffTable::PostProcessTable()
{
#if defined(DEBUGTABLES) && defined(DEBUG)
        DEBUGPRINT("--- Table definition, with " << rows.size() << " rows");
        DumpTable();
        DEBUGPRINT("--- End of table definition");
#endif

        /* Gather all widths for further processing */
        for (unsigned i=0;i<rows.size();++i)
        {
                std::copy (rowtaps[i].margins.begin(), rowtaps[i].margins.end(), std::back_inserter(margins));
        }

        //Sort and remove duplicates
        std::sort(margins.begin(),margins.end());
        margins.erase(std::unique(margins.begin(),margins.end()),margins.end());

        /* normalize close numbers (9 is a Magic Number, they require at leat 36, word docs suggest 3*15 but that is too much for some docs.. */
        CollapseWidths(&margins,9);

#if defined(DEBUGTABLES) && defined(DEBUG)
        std::stringstream output;
        std::copy(margins.begin(),margins.end(),std::ostream_iterator<int>(output," "));
        DEBUGPRINT("Widths: " << output.str());
#endif

        //fit the table back into its margins
        for (unsigned i=0;i<rows.size();++i)
            RefitWidths(i);
}

void BiffTable::RefitWidths(unsigned row)
{
        DEBUGPRINT("Before refit: " << rowtaps[row]);
        if (!margins.empty())
          for (unsigned i=0;i<rowtaps[row].margins.size();++i)
            rowtaps[row].margins[i]=*Blex::BinaryClosestFind(margins.begin(), margins.end(), rowtaps[row].margins[i]);
        DEBUGPRINT("After refit: " << rowtaps[row]);
}


void BiffTable::CollapseWidths(Widths *const widths,unsigned tolerance)
{
        Widths::iterator itr=widths->begin();
        while (itr != widths->end() )
        {
                // Find first value that is greater than tolerance
                int32_t thiscell = *itr;
                ++itr;

                Widths::iterator upper_collapse_limit = std::upper_bound(itr, widths->end(), int32_t(thiscell + (tolerance*2)));

                // Erase all these values
                if (itr!=upper_collapse_limit)
                {
                        DEBUGPRINT("Normalising " << (upper_collapse_limit-itr) << " values to " << *upper_collapse_limit);
                        itr = widths->erase(itr,upper_collapse_limit);
                }
        }
}


void BiffParaAnalyzer::CloseTable()
{
        tablestack.top()->PostProcessTable();

        //scan it (used to be done during the output phase....)
        TableScanner scan(biffdoc);
        scan.ScanTable(tablestack.top());
        tablestack.top()->PostProcess();

        tablestack.pop();
        lastpart.pop_back();
}
void BiffParaAnalyzer::StoreRowProperties()
{
        TableDocPart::Row &row = tablestack.top()->rows.back();

        //Validate TAP info against parsed info
        unsigned numcells = std::min(mytap.margins.size()-1, std::min(row.cells.size(), mytap.cells.size()));
        if (mytap.margins.size() > numcells+1)
        {
                DEBUGPRINT("Too many table TAP margins, stripping some");
                mytap.margins.resize(numcells+1);
        }
        if (mytap.cells.size() > numcells)
        {
                DEBUGPRINT("Too many table TAP cells, stripping some");
                mytap.cells.erase(mytap.cells.begin() + numcells, mytap.cells.end());
        }
        if (row.cells.size() > numcells)
        {
                DEBUGPRINT("Too many table document text cells, stripping some");
                row.cells.erase(row.cells.begin() + numcells, row.cells.end());
        }

        //Collapse horizontal merges
        unsigned i=1; //the first cell can never be merged away..
        while (i<mytap.cells.size())
        {
                if (!mytap.cells[i].fFirstMerged && mytap.cells[i].fMerged)
                {
                        //Copy the right border from the deleted cell, because it will be the right border of the merged cell
                        mytap.cells[i-1].borderright = mytap.cells[i].borderright;

                        row.cells.erase(row.cells.begin()+i);
                        mytap.cells.erase(mytap.cells.begin()+i);
                        mytap.margins.erase(mytap.margins.begin()+i);
                        DEBUGPRINT("Collapsed horizontal merge of cell " << i);
                }
                else
                {
                        ++i;
                }
        }

        tablestack.top()->rowtaps.push_back(mytap);

}
void BiffParaAnalyzer::AddBiffParagraph(Cp startcp, Cp limitcp, ComplexRecord const *endpiece, ParaCharStyle const *style, GrpprlPointer grpprlptr)
{
        //Add a paragraph to our list
        BiffParagraph *newpara;
        bool merged_with_prev = false;
        if(merge_with_next && tablestack.size() == mypap.tablelevel) //merge only when table levels are equal
        {
                newpara = merge_with_next;
                merge_with_next = NULL;
                merged_with_prev = true;
                //ADDME Do we need to deal with the grpplptr of this new para?

                biffdoc.paramap.erase(newpara->limitcp);
                newpara->ExtendParagraph(limitcp, endpiece);
        }
        else
        {
                newpara = static_cast<BiffParagraph*>(biffdoc.AdoptAndRegisterPart( new BiffParagraph(NULL, biffdoc, startcp, limitcp, endpiece, style)));
                newpara->grpprlptr=grpprlptr;
        }

        //Discover the properties for this paragraph
        biffdoc.LoadParagraphProperties(newpara, &mypap, &mytap);
        DEBUGPRINT("Paragraph " << newpara << " from " << std::dec << startcp << " to " << limitcp << " lvl " << mypap.tablelevel << (merged_with_prev?" merged_with-prev":""));

        if(biffdoc.tcmode == DocBase::TCFinal || biffdoc.tcmode == DocBase::TCOriginal) //we care about deleted/inserted paras
        {
                Chp paramarkprops(biffdoc);
                biffdoc.LoadParagraphMarkProperties(newpara, mypap, &paramarkprops);
                if(paramarkprops.pod.internal_bits & Chp::RMarkDel && biffdoc.tcmode == DocBase::TCFinal)
                {
                        DEBUGPRINT("Paragraph mark must be deleted");
                        merge_with_next = newpara;
                }
        }

        if(!merged_with_prev)
        {
                while(tablestack.size() > mypap.tablelevel)
                {
                        tablestack.top()->rows.pop_back(); //remove the last row (unnecessary added)
                        DEBUGPRINT("Close a table level, was at " << tablestack.size() << " and must go to " << mypap.tablelevel);
                        CloseTable();
                }

                /* Is this paragraph part of a list? Add it then */
                if (mypap.listovr) //word97 list...
                {
                        newpara->listovr = mypap.listovr;
                        newpara->listlevel = mypap.listlevel;
                        const_cast<ListOverride*>(mypap.listovr)->listparas.push_back(newpara);
                }

                /* table increments auto-generate parts... eg jumping from lvl 0 to 4
                   requires a stack of 4 TableParts, but those parts have no physical
                   presence in Word - so just generate them */
                while (true)
                {
                        //Append to last piece (maindoc or current open cell)
                        if(lastpart.back())
                        {
                                DEBUGPRINT("Linking " << lastpart.back() << " to " << newpara);
                                lastpart.back()->next = newpara;
                                newpara->prev = lastpart.back();
                                newpara->parent = lastpart.back()->parent;
                        }
                        else if(!tablestack.empty()) //if lastpart == NULL, then add us as 'first part' to the current cell
                        {
                                tablestack.top()->rows.back().cells.back().firstpart = newpara;
                                newpara->parent = lastpart[lastpart.size()-2];
                        }

                        lastpart.back() = newpara;

                        if(tablestack.size() >= mypap.tablelevel)
                             break;

                        DEBUGPRINT("Add a table level, was at " << tablestack.size() << " and must go to " << mypap.tablelevel);

                        OpenTable();

                        BiffParagraph *firstcell = static_cast<BiffParagraph*>(biffdoc.AdoptAndRegisterPart( new BiffParagraph(*newpara)) );
                        firstcell->master = firstcell;
                        newpara->table = tablestack.top();
                        newpara = firstcell;
                }
                if(!tablestack.empty())
                {
                        if(mypap.ttp) //Row end
                        {
                                tablestack.top()->rows.back().cells.pop_back(); //remove the last 'cell'
                                DEBUGPRINT("Finished table row #" << (tablestack.top()->rows.size()-1) << " " << tablestack.top()->rows.back().cells.size() << " cells at level " << tablestack.size());
                                StoreRowProperties();
                                NextRow();
                        }
                        else
                        {
                                //Detect table headers
                                if (newpara->basestyle->filter->tableheader)
                                    tablestack.top()->rows.back().cells.back().tableheader = true;

                                bool cellend=mypap.cellend;
                                if(!cellend)
                                {
                                        //FIXME Eliminate RawCharacterParser constructions
                                        RawCharacterParser rcp(biffdoc);
                                        if(rcp.GetRawChar(limitcp-1)==7)
                                            cellend=true;
                                }


                                if(cellend)
                                    NextCell();
                        }
                }
        }
        biffdoc.paramap.insert(std::make_pair(limitcp, newpara));
}

// read_paragraphs tries to get all paragraph information
void BiffParaAnalyzer::ParagraphsRead(void)
{
        uint8_t entries;
        unsigned paradata;
        std::vector<Paragraph> paragraphs;
        ParagraphMerger mergers[256];

        Plcf paras_plcf(*biffdoc.tablefile, biffdoc.header.OffsetPapxTable(), biffdoc.header.LengthPapxTable(), 8,false);
        unsigned len=paras_plcf.GetNumEntries();

        for (unsigned curtable=0;curtable<paras_plcf.GetNumEntries();++curtable)
        {
                unsigned pagenum;
                if (curtable < len)
                {
                        pagenum=Blex::getu32lsb(paras_plcf.GetEntryData(curtable));
                }
                else //incomplete bintable
                {
                        pagenum=Blex::getu16lsb(paras_plcf.GetEntryData(len-1))+1+curtable-len;
                }

                //Read the FKP from the main stream
                uint8_t buffer[512];
                if (biffdoc.wordfile->DirectRead(pagenum*512,buffer,512) != 512)
                    throw std::runtime_error("I/O error reading paragraph exception page (PAPX)");

                //How many entries do we have?
                entries=buffer[511]; //last byte

                //Reset the grpprlpointer merges - we use these to reduce the
                //memory usage when two paragraphs refer to the same properties
                memset (mergers,0,sizeof(mergers));

                //Run through the entries and record BX (and later PAPX) information
                for (unsigned curentry=0;curentry<unsigned(entries);++curentry)
                {
                        //We are creating overlapping ranges, because we
                        //are actually reading the limit FC. Unfortunately,
                        //we don't know whether to substract 1 or 2 from the
                        //limit FC to reach the last FC, because we need the
                        //piecetable for that.
                        Paragraph cur;
                        cur.limitfc=Blex::gets32lsb(buffer+curentry*4+4);
                        if (cur.limitfc == 0) //ignore corrupted paragraphs
                        {
                                DEBUGPRINT("Apple Works corrupted paragraph: limitfc == 0");
                                continue;
                        }

                        paradata=4*(entries+1)+13*curentry; //this is a pointer to the additional data
                        if (paradata>=511)
                        {
                                DEBUGPRINT("Corrupted document: PAPX contains out-of-range pointers");
                                return;
                        }

                        if (buffer[paradata]==0) //standard style
                        {
                                //should use standard pap and chp
                                cur.basestyle=4095;
                        }
                        else
                        {
                                unsigned pos=buffer[paradata];

                                //Read the GRPPRL if it wasn't cached yet
                                if (!mergers[pos].grpprlptr.Length())
                                {
                                        uint8_t const *papx_pos=buffer+(pos<<1);

                                        if (*papx_pos)
                                        {

                                                //On >=97, papx_pos is count of words including papx_pos itself
                                                //On 95, papx_pos is count of words NOT including papx_pos itself
                                                unsigned len=(papx_pos[0]*2)-3;
                                                if (papx_pos+len>buffer+512 || len>=512)
                                                {
                                                        DEBUGPRINT("Corrupted document: PAPX contains out-of-range pointers");
                                                        mergers[pos].basestyle=4095;
                                                }
                                                else
                                                {
                                                        mergers[pos].grpprlptr=biffdoc.grpprlcache.Store(len,papx_pos+3);
                                                        mergers[pos].basestyle=Blex::getu16lsb(papx_pos+1);
                                                }
                                        }
                                        else
                                        {
                                                //Count of words, NOT including papx_pos, is at papx_pos[1]
                                                unsigned len=(papx_pos[1]*2)-2;
                                                if (papx_pos+len>buffer+512 || len>=512)
                                                {
                                                        DEBUGPRINT("Corrupted document: PAPX contains out-of-range pointers");
                                                        mergers[pos].basestyle=4095;
                                                }
                                                else
                                                {
                                                        mergers[pos].grpprlptr=biffdoc.grpprlcache.Store(len,papx_pos+4);
                                                        mergers[pos].basestyle=Blex::getu16lsb(papx_pos+2);
                                                }
                                        }
                                }
                                cur.grpprlptr=mergers[pos].grpprlptr;
                                cur.basestyle=mergers[pos].basestyle;
                        }
                        //ADDME: If a plcfphe has an entry that maps to the FC for this paragraph, that entry's PHE overrides the PHE stored in the FKP
                        paragraphs.push_back(cur);
                }
        }

        //Build our list of paragraphs using Table's data
        //and the piece table
#ifdef DEBUG
        std::clog << "Paragraph boundaries: (all numers are FC limits in decimal):\n";
        for (unsigned paraptr=0;paraptr<paragraphs.size();++paraptr)
        {
                if (paraptr>0)
                    std::clog << '-';
                std::clog << paragraphs[paraptr].limitfc;
        }
        std::clog << std::endl;
#endif


        Cp startcp=0;
        /* Loop through all pieces in the source document */
        for (unsigned piece=0;piece<biffdoc.piecetable.piecetable.size();++piece)
        {
                unsigned bytesize=biffdoc.piecetable.piecetable[piece].bytespc;
                unsigned cp=biffdoc.piecetable.piecetable[piece].startcp;
                unsigned fc=biffdoc.piecetable.piecetable[piece].startfc;
                unsigned paraptr=0;

                //Find the starting paragraph
                if (fc >= paragraphs[0].limitfc)
                {
                        for (paraptr=1;paraptr<paragraphs.size();++paraptr)
                          if (fc >= paragraphs[paraptr-1].limitfc && fc < paragraphs[paraptr].limitfc)
                            break;
                }

                /* Loop through all paragraphs that end inside this piece */
                while (paraptr < paragraphs.size()
                       && cp<biffdoc.piecetable.piecetable[piece].limitcp
                       && paragraphs[paraptr].limitfc <= biffdoc.piecetable.piecetable[piece].limitfc)
                {
                        /* 'Close this paragraph' - record its coordinates, its
                           associations with the piece tables, and convert its
                           FC to CPs (it's much easier to work with CPs) */

                        //Move the CP and FC behind the paragraph
                        cp+=(paragraphs[paraptr].limitfc-fc)/bytesize;
                        fc=paragraphs[paraptr].limitfc;

                        AddBiffParagraph(startcp, cp, &biffdoc.piecetable.piecetable[piece], biffdoc.GetStyle(paragraphs[paraptr].basestyle), paragraphs[paraptr].grpprlptr);

                        //Prepare for scanning the next paragraph
                        ++paraptr;
                        startcp=cp;
                }
        }

        if (startcp < biffdoc.GetHeader().DocumentLimitCp())
        {
                DEBUGPRINT("Paragraph table too short: it ends at " << startcp << " but doc len is " << biffdoc.GetHeader().DocumentLimitCp());

                /* We will need to manually generate the missing paragraphs.
                   See: para_exception_table_too_short.doc */
                RawCharacterParser parser(biffdoc);

                for (Cp cp = startcp+1; cp < biffdoc.GetHeader().DocumentLimitCp(); ++cp)
                  if (parser.GetRawChar(cp) == 0xD) //paragraph end
                {
                        DEBUGPRINT("Generating paragraph start " << startcp << " limit " << (cp+1));
                        ComplexRecord const *endpiece = biffdoc.piecetable.FindPiece(cp);
                        if (!endpiece) //ADDME: Piecetable should guard its own consistency, so we don't have to re-check it all the time
                             throw std::runtime_error("Corrupted Word document: Cannot find piece for cp " + Blex::AnyToString(cp));

                        AddBiffParagraph(startcp, cp+1, endpiece, NULL, GrpprlPointer());
                        startcp = cp+1;
                }
        }
}



} // End of namespace Word
} // End of namespace Office
} // End of namespace Parsers




