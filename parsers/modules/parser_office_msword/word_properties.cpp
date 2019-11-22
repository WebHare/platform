#include <ap/libwebhare/allincludes.h>



#include <iomanip>
#include <iostream>
#include <blex/utils.h>
#include "biff.h"
#include "word_base.h"

using namespace Blex;

namespace Parsers {
namespace Office {
namespace Word {

DrawLib::Pixel32 MixColors2(unsigned promille, DrawLib::Pixel32 forecolor, DrawLib::Pixel32 backcolor)
{
        if (promille==0)
            return backcolor;
        if (promille==1000)
            return forecolor.IsFullyTransparent() ? DrawLib::Pixel32(0,0,0,255) : forecolor; //ADDME: Should we always use black?

        //ADDME: Instead of just using back color, we should probably use the real table background color. Our current design doesn't
        //       allow that, because we're mixing colors too early. We should move mixing closer to actual table rendering
        if (backcolor.IsFullyTransparent()) //convert automatic to white background for proper mixing? (Just a trial..)
            backcolor = DrawLib::Pixel32(255,255,255,255);

        uint32_t red=       (promille*forecolor.GetR() + (1000-promille)*backcolor.GetR()) /1000;
        uint32_t green=     (promille*forecolor.GetG() + (1000-promille)*backcolor.GetG()) /1000;
        uint32_t blue=      (promille*forecolor.GetB() + (1000-promille)*backcolor.GetB()) /1000;

        return DrawLib::Pixel32(static_cast<uint8_t>(red),static_cast<uint8_t>(green),static_cast<uint8_t>(blue),255);
}

Chp::Chp(DocBase const &parent)
{
        SetFont(&parent.GetFont(0)); //NOTE: Was 0, but word says its 4
        formatted.font_halfpoint_size=20;
        pod.fcPicObjTag=0xffffffff;
        pod.istd_style = parent.GetStyle(10); //the standard character style - FIXME: DocX safe standard char style retrieval FIXME -get by istd, not hardcoded
        pod.lidDefault=pod.lidFE=0x0400; //no proofing
        pod.wCharScale=100;
        pod.internal_bits |= FGAutomatic;
}
void Chp::SetFont(Font const *newfont)
{
        font = newfont;
        formatted.fonttype = &font->formatted;
}
void Chp::Fixup()
{
}

Pap::Pap(DocBase const &doc)
{
        listovr=NULL;
        listlevel=0;
        istd_style= doc.GetStyle(0); //FIXME ensure 0 exists
        lvl=9;
        tablelevel=0;
        ttp=0;
        cellend=false;
        ilfo=0;
        multilinespace = 1;
        dyaline = 240;
        contextualspacing = 0;
        paddingbeforeauto = 0;
        paddingafterauto = 0;

        //style=parentdoc->GetStyle(0);
        //p->fMultLineSpace=1;  worddocs tell to do this but there is no fMultLineSpace element!
        //p->dyaLine=240;               worddocs tell to do this but there is no dyaLine element!
}

void Pap::Fixup() //ADDME perhaps ApplyFormatting is a better name, and have that do all updates to 'formatted' - don't directly modify it during property parsing
{
        /*if(paddingbeforeauto)
            formatted.padding.top=0;
        if(paddingafterauto)
            formatted.padding.bottom=0;*/
}

void Pap::AddTab(int16_t tabstop,uint8_t descriptor)
{
        Tabs::iterator insert_pos;

        for (insert_pos = tabs.begin();
             insert_pos != tabs.end();
             ++insert_pos)
        {
                if (tabstop == insert_pos->stop)
                {
                        DEBUGPRINT("Duplicate tab " << tabstop);
                        return;
                }
                if (tabstop < insert_pos->stop)
                    break;
        }

        tabs.insert(insert_pos,Tab(tabstop,descriptor));
}

void Pap::DelTab(int16_t tabstop,int16_t tolerance)
{
        Tabs::iterator delete_pos=tabs.begin();

        while (delete_pos != tabs.end())
          if (tabstop - tolerance <= delete_pos->stop
              && delete_pos->stop <= tabstop - tolerance)
            delete_pos = tabs.erase(delete_pos);
          else
            ++delete_pos;
}

void Pap::ApplyIlfo(BiffDoc const &parent, int16_t newilfo)
{
        ilfo=newilfo;
        if (ilfo)
        {
                listovr = parent.GetListOverride(ilfo);
                if (!listovr)
                {
                        DEBUGPRINT("Failing ilfo " << ilfo
                                   << " listlevel " << listlevel
                                   << " lvl " << lvl);
                        if (ilfo==721)
                        {
                                DEBUGPRINT("\aMystical LFO 721 found (is this an ALND indication? but why such a low list number)");
                                return;
                        }
                        if (ilfo==2047)
                        {
                                DEBUGPRINT("\aMystical LFO 2047 found (ex-Word95)");
                                return;
                        }
                        DEBUGPRINT("\aInvalid LFO " << ilfo);
                        return;
                }
                else
                {
                        DEBUGPRINT("List ilfo " << ilfo << " & level " << listlevel << " id " << std::hex << std::setw(8) << listovr->abstract->unique_list_id << std::dec);
                }

                if (listovr->abstract->simplelist) //ADDME docx say ignore this?
                    listlevel=0;

                if (listlevel >= NumListLevels)
                    throw std::runtime_error("Corrupted Word document: Illegal list level in list");

                //ADDME: Shrugh.. reading the documentation correctly, it seems that we
                //       should *not* apply the character properties here, but first
                //       use the list's character properties to do the list number.
                //       After that, we can do the character properties for the text itself

                //Apply properties from the list
                ListLevel const *lvl = listovr->GetLevel(listlevel); //current level data
                if(lvl)
                {
                        lvl->ApplyPap(this);
                }
        }
        else
        {
                listovr=NULL;
                formatted.first_indent = 0;
                formatted.padding.left = 0;
        }
}

Sep::Sep()
{
        memset(&pod,0,sizeof(pod));

        pod.bkc=2;              //new page
        pod.dyaPgn=720;         //720 twips (equivalent to .5 in)
        pod.dxaPgn=720;
        pod.fEndNote=1;
        pod.fEvenlySpaced=1;
        pod.xaPage=12240;
        pod.yaPage=15840;
        pod.xaPageNUp=12240;
        pod.yaPageNUp=15840;
        pod.dyaHdrTop=720;
        pod.dyaHdrBottom=720;
        pod.dmOrientPage=1;     //portrait orientation
        pod.dxaColumns=720;
        pod.dyaTop=1440;
        pod.dxaLeft=1800;
        pod.dyaBottom=1440;
        pod.dxaRight=1800;
        pod.pgnStart=1;
}
//returns *CP* where the next break of column text should occur
//should return -1 when there is no (more) switching of columns to do
//returns a new coordinate every time its called - so record the value

void Sep::Apply (Parsers::FormattedOutput *) const
{
}

SectionData::SectionData(BiffDoc &worddoc,Cp startcp, Cp limitcp, std::vector<uint8_t> &grpprl_ptr)
  : biff_startcp(startcp), biff_limitcp(limitcp)
{
        SprmIterator sprmitr(worddoc, &grpprl_ptr[0], grpprl_ptr.size());
        worddoc.ApplySprms(&sprmitr,0,&sep,0);
}

// read_Sections tries to get all section information
void BiffDoc::SectionsRead()
{
        //FIXME: Detect I/O errors
        int32_t next_start=0;
        int32_t startpos;
        int a;

        int entries=((header.LengthSedPlc()-4)/16);

        if ( (header.LengthSedPlc()-4)%8 )
        {
                DEBUGPRINT("Illegally-sized section descriptors");
                entries=0;
        }

        if (!header.LengthSedPlc() || entries == 0)
        {
                //Create a section manually to describe the majority of the document
                //(Seen a document without section info once. Probably from a converter, but which?)
                DEBUGPRINT("BAD DOC! Document has no section table, will destabilize word. Probably came from a converter");
                std::vector<uint8_t> nulldata;
                sections.push_back(SectionData(*this, 0, header.DocumentLimitCp(), nulldata));
                return;
        }

        //not loading first 4 bytes - can't figure out what they stand for (always 4?)
        std::vector<uint8_t> secbuf(entries*16);

        //read sections one-by-one
        tablefile->DirectRead(header.OffsetSedPlc()+4,&secbuf[0],entries*16);
        for (a=0;a<entries;++a)
        {
                Cp section_start = next_start;
                next_start = getu32lsb(&secbuf[a*4]);
                Cp section_limit = next_start;

                std::vector<uint8_t> section_grpprl;
                startpos=getu32lsb(&secbuf[a*12+entries*4+2]);
                if (startpos != -1) // a grpprl exists
                {
                        section_grpprl.resize(wordfile->DirectReadLsb<uint16_t>(startpos));
                        wordfile->DirectRead(startpos+2,&*section_grpprl.begin(),section_grpprl.size());
                }
                sections.push_back(SectionData(*this,section_start,section_limit,section_grpprl));
        }
}

Sections::iterator BiffDoc::FindSection(uint32_t cp)
{
        /* ADDME: Binary search? */
        for (Sections::iterator itr=sections.begin();itr!=sections.end();++itr)
          if (itr->biff_startcp <= cp && cp < itr->biff_limitcp)
            return itr;

        return sections.end();
}

Tap::Tap()
{
        table_jc=Parsers::Left;
        dxaGapHalf=0;
        dxaGapHalf_delta=0;
        dyaRowHeight=0;
        cantsplit=0;
        tableheader=0;
        lwHTMLProps=0;
        cellspacing=0;
        default_cellpadding.left = 8*15; //8 pixels
        default_cellpadding.right = 8*15;

        wWidth=0;
        wWidthIndent=0;
        wWidthBefore=0;
        wWidthAfter=0;
}

void Brc::PackedRead2000(uint8_t const *packed_brc)
{
        color=DrawLib::Pixel32::GetRedFirstInverseAlpha(packed_brc);
        //ADDME: Unsure if these readings are correct..
        linewidth=getu8(packed_brc+4);
        bordertype=static_cast<BorderTypeCode>(getu8(packed_brc+5));

        if (getu16lsb(packed_brc+6) != 0) //new unknown data?!
        {
                DEBUGPRINT("Unexpected non-null value in trailing BRC");
        }
}

void Brc::PackedRead97(uint8_t const *packed_brc)
{
        linewidth=getu8(packed_brc);
        bordertype=static_cast<BorderTypeCode>(getu8(packed_brc+1));
        color=Colors::GetRGBA(getu8(packed_brc+2));
        borderspace=getu8(packed_brc+3) & 0x1f;
        shadow=getu8(packed_brc+3) & 0x20 ? true : false;
}

TableCell::TableCell()
{
        cellpadding.left = cellpadding.right = cellpadding.top = cellpadding.bottom = 0xFFFFFFFF; //mark them as unused :-(
        bgcolor = DrawLib::Pixel32::MakeTransparent();
        vertalign = Parsers::Top;
        fFirstMerged=false;
        fMerged=false;
        fVertical=false;
        fBackward=false;
        fRotateFont=false;
        fVertMerge=false;
        fVertRestart=false;
        verifiedVertMerge=false;
}

void TableCell::PackedRead(uint8_t const *packed_tc)
{
        fFirstMerged=getu8(packed_tc)&1;
        fMerged=(getu8(packed_tc)&2)>>1;
        fVertical=(getu8(packed_tc)&4)>>2;
        fBackward=(getu8(packed_tc)&8)>>3;
        fRotateFont=(getu8(packed_tc)&16)>>4;
        fVertMerge=(getu8(packed_tc)&32)>>5;
        fVertRestart=(getu8(packed_tc)&64)>>6;
        vertalign=MapVerticalAlignment((gets16lsb(packed_tc)>>7)&3);

        bordertop.PackedRead97(packed_tc+4);
        borderleft.PackedRead97(packed_tc+8);
        borderbottom.PackedRead97(packed_tc+12);
        borderright.PackedRead97(packed_tc+16);
}

int Tap::ParseTableBorders2000(BiffDoc const &,const SprmData &sprm)
{
        const unsigned brcsize = 8;
        if (sprm.OpSize() < 6 * brcsize)
        {
                DEBUGPRINT("Got too few BRCs");
                return 1; //error!
        }

        //FIXME: I have no clue whether this is the correct ordering, so if borders screw up, check this..
        //       Also, no clue whether these names are the actual things read from the wordfile..
        //       No clue how it works in word - this code is just pure speculation..
        default_topborder.PackedRead2000(sprm.Data(0*brcsize));
        default_leftborder.PackedRead2000(sprm.Data(1*brcsize));
        default_bottomborder.PackedRead2000(sprm.Data(2*brcsize));
        default_rightborder.PackedRead2000(sprm.Data(3*brcsize));
        default_innerhorizontalborder.PackedRead2000(sprm.Data(4*brcsize));
        default_innerverticalborder.PackedRead2000(sprm.Data(5*brcsize));
        return 0;
}

int Tap::ParseTableBorders(const SprmData &sprm)
{
        DEBUGPRINT("Got a table borders set " << sprm.OpSize() << " bytes");
        const unsigned brcsize = 24;
        if (sprm.OpSize() < 6 * 4)
        {
                DEBUGPRINT("Got too few BRCs");
                return 1; //error!
        }

        //FIXME: I have no clue whether this is the correct ordering, so if borders screw up, check this..
        //       Also, no clue whether these names are the actual things read from the wordfile..
        //       No clue how it works in word - this code is just pure speculation..
        default_topborder.PackedRead97(sprm.Data(0*brcsize));
        default_leftborder.PackedRead97(sprm.Data(1*brcsize));
        default_bottomborder.PackedRead97(sprm.Data(2*brcsize));
        default_rightborder.PackedRead97(sprm.Data(3*brcsize));
        default_innerhorizontalborder.PackedRead97(sprm.Data(4*brcsize));
        default_innerverticalborder.PackedRead97(sprm.Data(5*brcsize));
        return 0;
}

unsigned Tap::FindClosestCell(int32_t margin) const
{
        return Blex::BinaryClosestFind(margins.begin(),margins.end(),margin)-margins.begin();
}

void Tap::Dump(std::ostream &ostr) const
{
        if (margins.empty())
            return;

        ostr << "lm: " << std::setw(6) << margins[0];

        for (unsigned i=0; i<cells.size(); ++i)
        {
                ostr << (cells[i].fVertMerge
                              ? (cells[i].fVertRestart ? 'V' : 'v')
                              : (cells[i].fVertRestart ? '?' : '.'))
                          << (cells[i].fMerged
                              ? (cells[i].fFirstMerged ? 'H' : 'h')
                              : (cells[i].fFirstMerged ? '?' : '.'))
                          << (cells[i].bordertop.bordertype!=0 ? (cells[i].bordertop.bordertype!=255 ? 'T' :'t') : '.')
                          << (cells[i].borderleft.bordertype!=0 ? (cells[i].borderleft.bordertype!=255 ? 'L' :'l') : '.')
                          << (cells[i].borderbottom.bordertype!=0 ? (cells[i].borderbottom.bordertype!=255 ? 'B' :'b') : '.')
                          << (cells[i].borderright.bordertype!=0 ? (cells[i].borderright.bordertype!=255 ? 'R' :'r') : '.')
                          << std::setw(6)
                          << margins[i+1];
        }
}

SprmIterator::SprmIterator(BiffDoc const &doc, uint16_t piecesprm)
: doc(doc)
, overrun(false)
{
        //ComplexSprms 97 are documented as Property Modifiers, variant 1

        //We simply map the compressed sprm back to a real sprm, and then
        //execute that. Our map uses the high-bits (0xE000) to mark the sprm
        //0x2000=PAP, 0x4000=CHP and 0x6000=PIC
        //A 0 sprm is a NoOp, and all other data should be passed to the sprm
        //parsers, with the high bit stripped off
        static const uint16_t sprmmap[0x80]=
        { 0x0000, 0x0000, 0x0000, 0x0000, 0x2002, 0x2003, 0x2004, 0x2005,
          0x2006, 0x2007, 0x2008, 0x2009, 0x200A, 0x0000, 0x200C, 0x0000,
          0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000,
          0x2016, 0x2017, 0x0000, 0x0000, 0x0000, 0x201B, 0x0000, 0x0000,

          0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x2023, 0x0000, 0x0000,
          0x0000, 0x0000, 0x0000, 0x0000, 0x202A, 0x0000, 0x0000, 0x0000,
          0x0000, 0x0000, 0x2030, 0x2031, 0x0000, 0x2033, 0x2034, 0x2035,
          0x2036, 0x2037, 0x2038, 0x0000, 0x0000, 0x203B, 0x0000, 0x0000,

          0x0000, 0x4000, 0x4001, 0x4002, 0x0000, 0x0000, 0x0000, 0x4006,
          0x0000, 0x0000, 0x0000, 0x400A, 0x0000, 0x400C, 0x4058, 0x4059,
          0x0000, 0x0000, 0x0000, 0x4033, 0x0000, 0x4035, 0x4036, 0x4037,
          0x4038, 0x4039, 0x403A, 0x403B, 0x403C, 0x0000, 0x403E, 0x0000,

          0x0000, 0x0000, 0x4042, 0x0000, 0x4044, 0x0000, 0x4046, 0x0000,
          0x4048, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000,
          0x0000, 0x0000, 0x0000, 0x4053, 0x4054, 0x4055, 0x4056, 0x6000,
          0x2040, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000 /*PPnbrRMarkNot*/, 0x0000 };

        if (piecesprm&1)
        {
                GrpprlPointer ptr=doc.piecetable.GetSprmGrpprl(piecesprm);
                grpprl = ptr.Data();
                len = ptr.Length();
        }
        else
        {
                uint16_t bigsprm=sprmmap[(piecesprm&0xff)>>1];
                localbuf[0]=uint8_t(bigsprm&0xff);
                localbuf[1]=uint8_t((bigsprm>>8)&1) | uint8_t((bigsprm>>11)&0x1C) | uint8_t(0x20); //0x20: 1byte argument
                localbuf[2]=uint8_t(piecesprm>>8);
                grpprl=localbuf;
                len=3;
        }

        ReadCurrent97();
}
SprmIterator::SprmIterator(BiffDoc const &doc, uint8_t const *grpprl_start, unsigned len)
: doc(doc)
, grpprl(grpprl_start)
, overrun(false)
, len(len)
{
        if(len)
          ReadCurrent97();
}
SprmIterator::SprmIterator(BiffDoc const &doc, GrpprlPointer ptr)
: doc(doc)
, grpprl(ptr.Data())
, overrun(false)
, len(ptr.Length())
{
        if(len)
            ReadCurrent97();
}
void SprmIterator::Next()
{
        if (overrun || (opsize+start)>=len) //end of SPRM
        {
                len=0;
                return;
        }

        grpprl=grpprl+opsize+start;
        len-=opsize+start;

        if(len)
            ReadCurrent97();
}
void SprmIterator::ReadCurrent97()
{
        if(len<2) //too small for a sprm
        {
                DEBUGPRINT("sprm error: len<2");
                len=0;
                return;
        }

        unsigned sprm=getu16lsb(grpprl);

        //there are three special types that require other handling. why can't they make things simple?
        if (sprm==0xC615) // sprmPChgTabs
        {
                if (grpprl[2]==0xff) //the hard way
                {
                        if (len<4)
                        {
                                DEBUGPRINT("sprm error: len<4");
                                len=0;
                                return;
                        }
                        if (len<unsigned(grpprl[2]*4+4))
                        {
                                DEBUGPRINT("sprm error: len<(grpprl[2]*4+4)");
                                len=0;
                                return;
                        }
                        opsize=2+grpprl[2]*4+grpprl[grpprl[2]*4+4]*3;
                }
                else
                {
                        if (len<3)
                        {
                                DEBUGPRINT("sprm error: len<3");
                                len=0;
                                return;
                        }
                        opsize=grpprl[2];
                }
                start=3;
        }
        else if (sprm==0xD606 || sprm==0xD608) // sprmTDefTable
            {
                if (len<4)
                {
                        DEBUGPRINT("sprm error: len<4");
                        len=0;
                        return;
                }
                opsize=getu16lsb(grpprl+2)-1;
                start=4;
            }
        else if (sprm==0xD609) // sprmTDefTableShd
        {
                /* Contrary to the BFF docs, DefTableShd seems
                   to store a _one_ byte len, not two. */
                if (len<3)
                {
                        DEBUGPRINT("sprm error: len<4");
                        len=0;
                        return;
                }
                opsize=grpprl[2];
                start=3;
        }
        else if ((sprm&0xE000)==0xC000)
        {
                if (len<3)
                {
                        DEBUGPRINT("sprm error: len<3");
                        len=0;
                        return;
                }
                opsize=grpprl[2];
                start=3;
        }
        else
        {
                if ((sprm&0xE000)<0x4000)
                    opsize=1;
                else if ((sprm&0xE000)==0xE000)
                    opsize=3;
                else if ((sprm&0xE000)==0x6000)
                    opsize=4;
                else
                    opsize=2;

                start=2;
        }
        if(start>len)
        {
                DEBUGPRINT("sprm error: start>len");
                len=0;
                return;
        }

        if ( opsize+start > len)
        {
                //Move it into a 0-padded space long enough to hold any sprm
                if(len-start)
                    memcpy(localbuf,grpprl+start,len-start);
                memset(localbuf+len-start,0,sizeof(localbuf)-(len-start));
                overrun=true;
        }

        cur = SprmData(sprm | (opsize<<16),overrun?localbuf:grpprl+start);
}

#ifdef DEBUG
#define DEBUGSPRMPREFIX retvalue=
#else
#define DEBUGSPRMPREFIX
#endif

void BiffDoc::ApplySprm(SprmData const &sprmdata, Pap *pap, Sep *sep, Tap *tap) const
{
#ifdef DEBUG
        int retvalue;
#endif
        DEBUGONLY(retvalue=2);
        switch(sprmdata.Category())
        {
        case 1:
                if (pap)
                    DEBUGSPRMPREFIX pap->Sprm (*this,sprmdata,tap);
                else
                    DEBUGONLY(retvalue=0); //Got SPRM at wrong spot for unknown reasons, may happen with pieces
                break;

        case 4:
                if (sep)
                    DEBUGSPRMPREFIX sep->Sprm (*this,sprmdata);
                break;

        case 5:
                if (tap)
                    DEBUGSPRMPREFIX tap->Sprm (*this,sprmdata);
                break;
        }


#ifdef DEBUG
        ++sprms_total;
        if (retvalue!=0) //nothing wrong
        {
                if (retvalue==1)
                {
                        DEBUGPRINT("Error interpreting sprm: sgc=" << sprmdata.Category() << " ispmd=" << sprmdata.CommandCode() << " " << sprmdata.OpSize());
                        ++sprms_errors;
                }
                else
                {
                        ++sprms_unknown;
                }

                ++sprm_problems[sprmdata.CommandCode()][sprmdata.Category()];
        }
#endif
}

void BiffDoc::ApplyChpSprm(SprmData const &sprmdata, Chp const &style_base, Chp *cur_style_chp, Chp *to_update_chp) const
{
#ifdef DEBUG
        int retvalue;
#endif
        DEBUGONLY(retvalue=2);
        if(sprmdata.Category()==2)
            DEBUGSPRMPREFIX to_update_chp->Sprm (*this, style_base, cur_style_chp, sprmdata);

#ifdef DEBUG
        ++sprms_total;
        if (retvalue!=0) //nothing wrong
        {
                if (retvalue==1)
                {
                        DEBUGPRINT("Error interpreting sprm: sgc=" << sprmdata.Category() << " ispmd=" << sprmdata.CommandCode() << " " << sprmdata.OpSize());
                        ++sprms_errors;
                }
                else
                {
                        ++sprms_unknown;
                }

                ++sprm_problems[sprmdata.CommandCode()][sprmdata.Category()];
        }
#endif
}

//Microsoft sick bastards :)
void BiffDoc::ApplySprms (SprmIterator *sprms, Pap *pap, Sep *sep, Tap *tap) const
{
        for (;!sprms->AtEnd();sprms->Next())
            ApplySprm(sprms->GetSprm(), pap, sep, tap);
}
void BiffDoc::ApplyChpSprms(SprmIterator *sprms, Chp const &style_base, Chp *cur_style_chp, Chp *to_update_chp) const
{
        for (;!sprms->AtEnd();sprms->Next())
            ApplyChpSprm(sprms->GetSprm(), style_base, cur_style_chp, to_update_chp);
}

GrpprlPointer BiffDoc::GetHugePapx(uint32_t offset) const
{
        /* FIXME: Detect I/O errors */
        HugePapx::iterator itr=hugepapx.find(offset);

        if (itr!=hugepapx.end())
            return itr->second;

        if(!datafile.get())
            return GrpprlPointer();

        unsigned len=datafile->DirectReadLsb<uint16_t>(offset);
        GrpprlPointer newptr=grpprlcache.Reserve(len);

        if (datafile->DirectRead(offset+2,newptr.Data(),len)!=len)
        {
                DEBUGPRINT("Corrupted word document: Read error on HugePapx " << offset);
                hugepapx.insert( std::make_pair(offset,GrpprlPointer()) );
                return GrpprlPointer();
        }

        hugepapx.insert( std::make_pair(offset,newptr) );
        return newptr;
}

} // End of namespace Word
} // End of namespace Office
} // End of namespace Parsers
