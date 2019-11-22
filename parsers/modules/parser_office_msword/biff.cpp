#include <ap/libwebhare/allincludes.h>


#include <iostream>
#include "biff.h"
#include "word_walker.h"

namespace Parsers {
namespace Office {
namespace Word {

BiffParagraph::BiffParagraph(DocPart *parent, BiffDoc &doc, Cp startcp, Cp limitcp, ComplexRecord const *endpiece, ParaCharStyle const* style)
: DocPart(doc, parent, style)
, startcp(startcp)
, limitcp(limitcp)
, endpiece(endpiece)
, configured(false)
{
}

void BiffParagraph::ExtendParagraph(Cp newlimitcp, ComplexRecord const *newendpiece)
{
        limitcp = newlimitcp;
        endpiece = newendpiece;
}

const ComplexRecord* PieceTable::FindPiece(Cp cp) const
{
        //look up our current piece
        if (cp >= piecetable[piecetable.size()-1].limitcp)
            return NULL; //EOF

        for (unsigned piecenum=piecetable.size();piecenum>0;--piecenum)
          if (cp >= piecetable[piecenum-1].startcp)
            return &piecetable[piecenum-1];

        return &piecetable[0];
}

GrpprlPointer PieceTable::GetSprmGrpprl(uint16_t sprm) const
{
        sprm>>=1; //Cut off that PropertyModifier bit
        if ((unsigned)sprm >= complexgrpprl.size())
        {
                DEBUGPRINT("Unable to find fast-saved formatting data");
                return GrpprlPointer(0);
        }
        else
        {
                return complexgrpprl[sprm];
        }
}

void PieceTable::Parse(Fc pos, Fc limittable, Blex::RandomStream &infile, BiffDoc &worddoc)
{
        while (pos<limittable)
        {
                //read the type
                uint8_t type=infile.DirectReadLsb<uint8_t>(pos);
                ++pos;

                if (type==1) //got a grpprl
                {
                        unsigned len=infile.DirectReadLsb<uint16_t>(pos);

                        if (pos+len+2>limittable)
                            break; //too short

                        GrpprlPointer newgrpprl=worddoc.grpprlcache.Reserve(len);
                        infile.DirectRead(pos+2,newgrpprl.Data(),len);

                        complexgrpprl.push_back(newgrpprl);
                        pos+=len+2;
                }
                else if (type==2) //got a complex
                {
                        unsigned len=infile.DirectReadLsb<uint32_t>(pos);
                        unsigned b,numpieces;

                        if (pos+len+4>limittable)
                            break; //too short

                        std::vector<uint8_t> buffer(len);
                        infile.DirectRead(pos+4,&buffer[0],len);

                        numpieces=(len-4)/12;

                        if ((len-4)%12)
                        {
                                DEBUGPRINT("Corrupted Word document: Error reading part of the piece table (illegal size)");
                                return;
                        }
                        if (piecetable.size())
                        {
                                DEBUGPRINT("Corrupted Word document: Duplicate piece tables");
                                return;
                        }

                        piecetable.resize(numpieces);

                        b=4; //skip the first (useless) offset

                        for (unsigned c=0;c<numpieces;++c)
                        {
                                if (c==0)
                                    piecetable[c].startcp=0;
                                else
                                    piecetable[c].startcp=Blex::getu32lsb(&buffer[b+(c-1)*4]);

                                piecetable[c].limitcp=Blex::getu32lsb(&buffer[b+c*4]);
                                piecetable[c].val=Blex::getu16lsb(&buffer[b+numpieces*4+c*8]);
                                int32_t tempfc=Blex::getu32lsb(&buffer[b+numpieces*4+c*8+2]);
                                if (tempfc&0x40000000L)
                                {
                                        //8bit piece
                                        piecetable[c].bytespc=1;
                                        tempfc=(tempfc&0x3FFFFFFFL)>>1;
                                        piecetable[c].startfc=tempfc;
                                        piecetable[c].limitfc=tempfc+(piecetable[c].limitcp-piecetable[c].startcp);
                                }
                                else
                                {
                                        piecetable[c].startfc=tempfc;
                                        piecetable[c].bytespc=2;
                                        piecetable[c].limitfc=tempfc+(piecetable[c].limitcp-piecetable[c].startcp)*2;
                                }
                                piecetable[c].sprm=Blex::getu16lsb(&buffer[b+numpieces*4+c*8+6]);
                        }
                        break;
                }
        }
        if (piecetable.empty())
        {
                //Fake a piecetable. Word95 docs don't always come with one
                piecetable.resize(1);
                piecetable[0].startcp=0;
                piecetable[0].limitcp=worddoc.GetHeader().OffsetLimitCharacter()
                                     -worddoc.GetHeader().OffsetFirstCharacter();
                piecetable[0].startfc=worddoc.GetHeader().OffsetFirstCharacter();
                piecetable[0].limitfc=worddoc.GetHeader().OffsetLimitCharacter();
                piecetable[0].val=0;
                piecetable[0].bytespc=1;
                piecetable[0].sprm=0;
        }

}


BiffDoc::BiffDoc(int32_t unique_id,
                  std::shared_ptr<Blex::Docfile> const &docfile,
                  Blex::Docfile::Directory const *docfileroot,
                  Callbacks &callbacks)
  : DocBase(&mynullstyle, unique_id, callbacks)
  , docfile(docfile)
  , docfileroot(docfileroot)
  , mynullstyle(*this, 4095)
  , fieldsmgr(*this)
{
#ifdef DEBUG
        sprms_total=0;
        sprms_errors=0;
        sprms_unknown=0;
        memset(sprm_problems,0,sizeof(sprm_problems));
#endif
}

BiffDoc::~BiffDoc()
{
#ifdef DEBUG
        std::clog << "Got " << sprms_total
                  << " sprms. Converted " << (sprms_total-sprms_unknown)
                  << " (" << (((sprms_total-sprms_unknown)*100)/(sprms_total?sprms_total:1))
                  << "%), failed " << sprms_errors
                  << " (" << ((sprms_errors*100)/(sprms_total?sprms_total:1)) << "%)\n";

        for (unsigned type=0;type<8;++type)
        {
                switch (type)
                {
                case 1: std::clog << "PAP:"; break;
                case 2: std::clog << "CHP:"; break;
                case 3: std::clog << "PIC:"; break;
                case 4: std::clog << "SEP:"; break;
                case 5: std::clog << "TAP:"; break;
                default: std::clog << "Type " << type << ":"; break;
                }

                for (unsigned i=0;i<512;++i)
                  if (sprm_problems[i][type])
                    std::clog << " 0x" << std::hex << i << std::dec << " (" << sprm_problems[i][type] << ")";

                std::clog << std::endl;
        }
#endif
}

void BiffDoc::ParsePropertySets()
{
        const Blex::Docfile::File *dsi=docfile->FindFile(docfileroot,"\x05" "documentsummaryinformation");
        if(!dsi)
            return;

        if (header.IsWord2000()) //target is unsafe to read in word97
        {
                std::unique_ptr<Blex::Stream> dsi_stream(docfile->OpenOleFile(dsi));
                Blex::OlePropertySet dsi_ops;
                if (dsi_ops.ParseProperties(*dsi_stream))
                {
                        //Find the proper property set
                        static const uint8_t format_id[16] = {0x05,0xD5,0xCD,0xD5,0x9C,0x2E,0x1B,0x10,0x93,0x97,0x08,0x00,0x2B,0x2C,0xF9,0xAE};
                        int propset = dsi_ops.FindSectionByFormatId(format_id);
                        if(propset>=0)
                        {
                                //The base target can be in here
                                unsigned baseprop = dsi_ops.GetSection(propset).FindPropertyByName("Base Target"); //not sure if props are case-sensitive
                                if(baseprop>0)
                                {
                                        fieldsmgr.SetDefaultAnchorTarget(dsi_ops.GetString(baseprop));
                                }
                        }
                }
        }
}

void BiffDoc::ReadHeader ()
{
        /* FIXME: I/O error detection */
        wordfile->DirectRead(0,&header,sizeof(header));
}

#ifdef DEBUG
void BiffDoc::DumpHeader (void) const
{
        DEBUGPRINT("*****************************\n"
                        "*   Document header (FIB)   *\n"
                        "*****************************\n");

        DEBUGPRINT("Magic number: "<<header.Ident());
        DEBUGPRINT("FIB version written: " << header.Version());
        if (header.IsTemplate())
            DEBUGPRINT("File is a template");
        if (header.IsGlossary())
            DEBUGPRINT("File is a glossary");
        if (header.IsComplex())
            DEBUGPRINT("File is complex");
        if (header.HasPictures())
            DEBUGPRINT("File has pictures");
        if (header.IsEncrypted())
            DEBUGPRINT("File is encrypted");
        if (header.IsWriteReserved())
            DEBUGPRINT("File is write reserved");
        if (header.IsExtendedCharset())
            DEBUGPRINT("File is using the extended character set");
        if (header.IsLastSaveMac())
            DEBUGPRINT("File was last saved on a Mac");
        if (header.IsTable1())
            DEBUGPRINT("File uses table 1");

        DEBUGPRINT("Text range offsets: " << header.OffsetFirstCharacter() << " to " << header.OffsetLimitCharacter());
        DEBUGPRINT("Page number of CHP: " << header.FirstChpPage() << " (" << header.CountChpPages() << "pages");
        DEBUGPRINT("Page number of PAP: " << header.FirstPapPage() << " (" << header.CountPapPages() << "pages");
        DEBUGPRINT("Page number of LVC: " << header.FirstLvcPage() << " (" << header.CountLvcPages() << "pages");
        DEBUGPRINT("Offset of original STSH in table stream: " << header.OffsetOriginalStylesheet() << " " << header.LengthOriginalStylesheet() << " bytes long");
        DEBUGPRINT("Offset of current STSH in table stream: " << header.OffsetStylesheet() << " " << header.LengthStylesheet() << " bytes long");
        DEBUGPRINT("Character property table starts at " << header.OffsetChpxTable() << " and is " << header.LengthChpxTable() << " bytes long");
        DEBUGPRINT("Paragraph property table starts at " << header.OffsetPapxTable() << " and is " << header.LengthPapxTable() << " bytes long");
        DEBUGPRINT("Font sttbf starts at " << header.OffsetFontSttbf() << " and is " <<  header.LengthFontSttbf()<< " bytes long");
        DEBUGPRINT("CLX info is at offset " <<  header.OffsetComplexTable()<< " and is " << header.LengthComplexTable() << " bytes long");
        DEBUGPRINT("FSPA info is at offset " << header.OffsetFspaPlcMainDoc() << " and is " << header.LengthFspaPlcMainDoc() << " bytes long");
        DEBUGPRINT("DGG info is at offset " << header.OffsetDggInfo() << " and is " << header.LengthDggInfo() << " bytes long");
        DEBUGPRINT("SedPlc info is at offset " << header.OffsetSedPlc() << " and is " << header.LengthSedPlc() << " bytes long");
        DEBUGPRINT("Motherdoc field info is at offset " << header.OffsetFldPlcMainDoc() << " and is " << header.LengthFldPlcMainDoc() << " bytes long");
        DEBUGPRINT("Bookmark info is at offset " << header.OffsetBookmarkInfo() << " and is " << header.LengthBookmarkInfo() << " bytes long");
        DEBUGPRINT("Plcfbkf info is at offset " << header.OffsetPlcfBookmarkStart() << " and is " << header.LengthPlcfBookmarkStart() << " bytes long");
        DEBUGPRINT("Plcfbkl info is at offset " << header.OffsetPlcfBookmarkEnd() << " and is " << header.LengthPlcfBookmarkEnd() << " bytes long");
        DEBUGPRINT("PlcfLst info is at offset " << header.OffsetListFormatInfo() << " and is " << header.LengthListFormatInfo() << " bytes long");
        DEBUGPRINT("PlcfLfo info is at offset " << header.OffsetListFormatOverrides() << " and is " << header.LengthListFormatOverrides() << " bytes long");
        DEBUGPRINT("PlcftxbxTxt info is at offset " << header.OffsetPlcfTextboxes() << " and is " << header.LengthPlcfTextboxes() << " bytes long");
        DEBUGPRINT("PlcfldTxt info is at offset " << header.OffsetPlcfTextboxFields() << " and is " << header.LengthPlcfTextboxFields() << " bytes long");
        DEBUGPRINT("Footnote FRD info is at offset " << header.OffsetFootnoteFRDs() << " and is " << header.LengthFootnoteFRDs() << " bytes long");
        DEBUGPRINT("Footnote text info is at offset " << header.OffsetFootnoteTexts() << " and is " << header.LengthFootnoteTexts() << " bytes long");
        DEBUGPRINT("Endnote FRD info is at offset " << header.OffsetEndnoteFRDs() << " and is " << header.LengthEndnoteFRDs() << " bytes long");
        DEBUGPRINT("Endnote text info is at offset " << header.OffsetEndnoteTexts() << " and is " << header.LengthEndnoteTexts() << " bytes long");
        DEBUGPRINT("Annotation ATRD info is at offset " << header.OffsetAnnotationATRDs() << " and is " << header.LengthAnnotationATRDs() << " bytes long");
        DEBUGPRINT("Annotation text info is at offset " << header.OffsetAnnotationTexts() << " and is " << header.LengthAnnotationTexts() << " bytes long");

        DEBUGPRINT("Main doc starts at CP "        << header.MainDocStart()         << " (0x" << std::hex << header.MainDocStart()          << std::dec << ") and has length " << header.MainDocLength()         );
        DEBUGPRINT("Footnote doc starts at CP "    << header.FootnoteDocStart()     << " (0x" << std::hex << header.FootnoteDocStart()      << std::dec << ") and has length " << header.FootnoteDocLength()     );
        DEBUGPRINT("Header doc starts at CP "      << header.HeaderDocStart()       << " (0x" << std::hex << header.HeaderDocStart()        << std::dec << ") and has length " << header.HeaderDocLength()       );
        DEBUGPRINT("Macro doc starts at CP "       << header.MacroDocStart()        << " (0x" << std::hex << header.MacroDocStart()         << std::dec << ") and has length " << header.MacroDocLength()        );
        DEBUGPRINT("Annotation doc starts at CP "  << header.AnnotationDocStart()   << " (0x" << std::hex << header.AnnotationDocStart()    << std::dec << ") and has length " << header.AnnotationDocLength()   );
        DEBUGPRINT("Endnote doc start s at CP "    << header.EndnoteDocStart()      << " (0x" << std::hex << header.EndnoteDocStart()       << std::dec << ") and has length " << header.EndnoteDocLength()      );
        DEBUGPRINT("Textbox doc starts at CP "     << header.TextboxDocStart()      << " (0x" << std::hex << header.TextboxDocStart()       << std::dec << ") and has length " << header.TextboxDocLength()      );
        DEBUGPRINT("Hdr Textbox doc starts at CP " << header.HeaderTextboxDocStart()<< " (0x" << std::hex << header.HeaderTextboxDocStart() << std::dec << ") and has length " << header.HeaderTextboxDocLength());
}
#endif

std::pair<unsigned, std::string> BiffDoc::ScanMetadata()
{
        /* FIXME: Remove exceptions and convert them to plain return values */
        const Blex::Docfile::File *wordfileentry=docfile->FindFile(docfileroot,"WordDocument");
        if (!wordfileentry)
            throw std::runtime_error("Corrupted word document: Cannot find worddocument data");

        wordfile.reset(docfile->OpenOleFile(wordfileentry));

        /* FIXME: Need a mechanism to inform callers of the specific errors */
        ReadHeader();
        DEBUGONLY(DumpHeader());

        //FIXME: Figure out the proper Word 2K version identifier
        if (GetHeader().Version() >= 0x6A)
            version = Word2000;
        else if (GetHeader().Version() >= 0x69)
            version = Word97;
        else if (GetHeader().Version() >= 0x65)
            return std::make_pair(2004,"MS Word 95");
        else
            return std::make_pair(2004,"MS Word pre-95");

        if (header.IsEncrypted())
            return std::make_pair(105,"Encrypted file");

        //Now read the formatting info (in the tablestream)
        //Find the table, and read it
        const Blex::Docfile::File *table=docfile->FindFile(docfileroot,header.IsTable1() ? "1Table" : "0Table" );
        if (table)
            tablefile.reset(docfile->OpenOleFile(table));

        if (!tablefile.get())
            throw std::runtime_error("Corrupted Word document: No formatting information");

        ReadStyles();
        return std::make_pair(0,"");
}

std::pair<unsigned, std::string> BiffDoc::ScanStructure()
{
        //Find the datafile, but don't care if its not there
        const Blex::Docfile::File *data=docfile->FindFile(docfileroot,"data");
        if (data)
            datafile.reset(docfile->OpenOleFile(data));

        ReadTableStream();
        DEBUGONLY(DumpTableStream());

        //Grab the document property set
        ParsePropertySets();

        //FIXME! ReadFootEndNotes();

        //Discover the end of the main stream. Punch a hole there, because the
        //rest of the paragraphs are only needed later
        BiffParagraph *finalpara = FindParagraph(header.MainDocLength() - 1);
        if(finalpara)
            finalpara->next = NULL;

        if(!pars.empty())
           firstpart = &**pars.begin();

        //Fieldsmgr must be initialized after ScanContents, so it can build proper hyperlinks
        fieldsmgr.Initialize(*tablefile);
        DEBUGONLY(fieldsmgr.DumpToClog());

        return std::make_pair(0,"");
}

//ADDME: Just replace this with a Cp, BiffParagraph/ParaData map...
BiffParagraph* BiffDoc::FindParagraph(uint32_t cp)
{
        ParaMap::const_iterator mappos; //Maps limit CPs to paragraphs.
        mappos = paramap.upper_bound(cp);
        return mappos != paramap.end() ? mappos->second : NULL;
}

std::pair<bool, unsigned> BiffParagraph::GetParagraphCollapseInfo() const
{
        bool infield=false;
        ParagraphWalker walker(GetBiffDoc());
        walker.SetCharacter(startcp);
        //FIXME?walker.SetParagraph(*this); - we already know the para, stupid to loop around!

        //Look for any viewable character inside the paragraph, taking into
        //account fields and hidden text (loop to -1, because the last char is a CR or CellEnd anyway and never interesting
        for (Cp curcp = startcp; curcp < limitcp-1; ++curcp)
        {
                if (curcp == walker.GetSwitchCp()) //hit a switch position
                    walker.SetCharacter(curcp);

                uint32_t curchar=walker.GetChar(curcp, false);
                if (curchar==0) //null byte?
                    continue;

                const Chp &chp=walker.GetCurChp();
                bool is_special = chp.pod.internal_bits & Chp::Special;

                if(is_special && curchar==19)
                {
                        infield=true;
                        continue;
                }
                if(is_special && (curchar==20||curchar==21))
                {
                        infield=false;
                        continue;
                }
                if(infield)
                        continue;

                /* ADDME: If we can move 'hidden' and PRIVATE field parsing
                   to the Character walker, we might have a simplified parser here */

                if (chp.pod.internal_bits & Chp::Vanish //marked as hidden
                    && !basestyle->filter->ShowHiddenAnyway())  //profile doesn't override it
                    continue;
                if((chp.pod.internal_bits & Chp::RMarkDel) && doc.tcmode == DocBase::TCFinal)
                    continue;

                if (is_special || (curchar>32 && curchar != 160) )
                {
                        if(is_special)
                                DEBUGPRINT("Paragraph not collapsed because of SPECIAL char #" << (int)curchar);
                        else
                                DEBUGPRINT("Paragraph not collapsed because of normal char #" << (int)curchar);

                        return std::make_pair(false,0) ; //had a visible character
                }
        }
        return std::make_pair(true, walker.GetEmptyHeight()); //empty paragraph indeed..
}

void BiffParaCharStyle::ApplyStyle(Pap *pap, Chp * chp) const
{
        if(type == CharacterStyle)
        {
                //character styles store their data into the first upx
                SprmIterator sprmitr2(doc, grpprls[0]);
                doc.ApplyChpSprms(&sprmitr2, *chp, chp, chp);
        }
        else //para styles have paraformat in upx[0], and char data in upx[1]
        {
                SprmIterator sprmitr(doc, grpprls[0]);
                doc.ApplySprms(&sprmitr, pap,0,0);

                SprmIterator sprmitr2(doc, grpprls[1]);
                doc.ApplyChpSprms(&sprmitr2, *chp, chp, chp);
        }
}

CharData const & BiffDoc::GetCharData(Fc fc) const
{
        //Do a binary search for the character run
        std::vector<CharData>::const_iterator itr=
           std::lower_bound(chars.begin(),chars.end(),fc,CharData::IsBefore());

        if (itr==chars.end())
        {
                //OpenOffice has an off-by-one bug in its word doc generation code
                DEBUGPRINT("\aCursor position FC " << fc << " has no corresponding character data (OpenOffice?)");
                return chars.back();
        }
        return *itr;
}

// read_characters tries to get all character information
void BiffDoc::CharactersRead ()
{
        //TypedArray<WordRun> runs;
        GrpprlPointer mergers[256];

        uint8_t buffer[512];
        unsigned curtable,entries;

        Plcf chars_plcf(*tablefile,header.OffsetChpxTable(),header.LengthChpxTable(), 8, false);

        unsigned len=chars_plcf.GetNumEntries();

        for (curtable=0;curtable<len;++curtable)
        {
                //Read the FKP from the main stream
                unsigned pagenum;

                pagenum=Blex::getu32lsb(chars_plcf.GetEntryData(curtable));
                wordfile->DirectRead(pagenum*512,buffer,512);

                //How many entries do we have?
                entries=buffer[511]; //last byte

                //Reset the grpprlpointer merges - we use these to reduce the
                //memory usage when two paragraphs refer to the same properties
                memset (mergers,0,sizeof(mergers));

                //Run through the entries and record pointer information
                for (unsigned a=0;a<entries;++a)
                    {
                        CharData cur;
                        unsigned pos=buffer[4*(entries+1)+a];

                        cur.startfc=Blex::gets32lsb(&buffer[a*4]);
                        cur.limitfc=Blex::gets32lsb(&buffer[(a*4+4)]);

                        if (pos)
                        {
                                if (mergers[pos].Length()==0)
                                    mergers[pos]=grpprlcache.Store(buffer[pos<<1],&buffer[(pos<<1)+1]);

                                cur.grpprlptr = mergers[pos];
                        }
                        chars.push_back(cur);
                    }
        }
}


} // End of namespace Word
} // End of namespace Office
} // End of namespace Parsers
