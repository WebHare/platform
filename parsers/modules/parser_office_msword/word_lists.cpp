#include <ap/libwebhare/allincludes.h>


#include "word_lists.h"
#include "word_base.h"
#include "biff.h"
#include <parsers/base/formatter.h>

using Blex::getu8;
using Blex::gets16lsb;
using Blex::getu16lsb;
using Blex::gets32lsb;
using Blex::getu32lsb;

namespace Parsers {
namespace Office {
namespace Word {

//FIXME: ListLevel reads cause a lot of RPCs.. optimize this code!
unsigned int BiffListLevel::Read (Blex::Stream &table)
{
        //FIXME! Better bounds checking, we'll need it if we want to pass raw buffers..
        uint8_t mybuf[28];
        int ptr=28;

        table.Read(mybuf,28);

        startat=gets32lsb(mybuf);
        nfc=mybuf[4];
        jc=uint8_t(mybuf[5] & 3);
        legal=mybuf[5] & 4?true:false;
        if(mybuf[5]&8) //word97 this probably just means 'never restart', assuming a level can be specified since Word2000
             restartafter = parent.GetHeader().Version() >= Word2000 ? mybuf[26] : 0;

        unsigned offsets[9];
        unsigned num_offsets = 0;
        for (;num_offsets < 9 && mybuf[6 + num_offsets] != 0; ++num_offsets)
            offsets[num_offsets] = mybuf[6 + num_offsets];

        follower=mybuf[15];

        if (mybuf[25])
        {
                list_papx = parent.grpprlcache.Reserve(mybuf[25]);
                table.Read(list_papx.Data(),mybuf[25]);
                ptr += mybuf[25];
        }

        if (mybuf[24])
        {
                list_chpx = parent.grpprlcache.Reserve(mybuf[24]);
                table.Read(list_chpx.Data(),mybuf[24]);
                ptr+=mybuf[24];
        }

        unsigned length=table.ReadLsb<uint16_t>();
        if (length)
        {
                std::vector<uint8_t> tempbuf(length*2);
                table.Read(&tempbuf[0],tempbuf.size());
                lvltext.reserve(length + num_offsets);

                for (unsigned i=0;i<length;++i)
                {
                        uint16_t ch = Blex::getu16lsb(&tempbuf[i*2]);
                        bool is_level_insert = std::count(offsets, offsets + num_offsets, i+1) != 0;
                        if(is_level_insert)
                        {
                                lvltext.push_back('%');
                                lvltext.push_back('1' + char(ch));
                        }
                        else
                        {
                                lvltext.push_back(ch);
                        }
                }
        }
        return ptr+length*2+2;
}

ListLevel const *ListOverride::GetLevel(unsigned num) const
{
        if (num >= NumListLevels)
            return NULL; //it cannot exist (such a listlevel would overflow listcounters[])

        LevelOverride const *ovr=GetOverride(num);
        if (ovr && ovr->formatting)
            return ovr->new_level.get();

        ListLevel *lvl = abstract->levels[num].get();
        if(lvl)
            return lvl;

        DEBUGPRINT("GetLevel requested for non-existing level " << num);
        return 0;
}

unsigned ListOverride::GetRestartAfter(unsigned num)
{
        ListLevel *lvl = abstract->levels[num].get();
        if(lvl)
            return lvl->restartafter;

        DEBUGPRINT("GetRestartAt requested for non-existing level " << num);
        return 0;
}

unsigned ListOverride::GetStartAt(unsigned num)
{
        LevelOverride *ovr=GetOverride(num);
        if (ovr && ovr->startat)
            return ovr->new_startat;

        ListLevel *lvl = abstract->levels[num].get();
        if(lvl)
            return lvl->startat;

        DEBUGPRINT("GetStartAt requested for non-existing level " << num);
        return 0;
}
LevelOverride *ListOverride::GetOverride(unsigned lvl)
{
        for (LevelOverrides::iterator itr=overrides.begin(); itr!=overrides.end(); ++itr)
          if (abstract->simplelist || itr->level==static_cast<uint8_t>(lvl))
            return &*itr;
        return NULL;
}
LevelOverride const *ListOverride::GetOverride(unsigned lvl) const
{
        for (LevelOverrides::const_iterator itr=overrides.begin(); itr!=overrides.end(); ++itr)
          if (abstract->simplelist || itr->level==static_cast<uint8_t>(lvl))
            return &*itr;
        return NULL;
}

Anlv::Anlv(uint8_t const *disk_anlv)
{
        nfc=getu8(disk_anlv + 0);
        textbefore=getu8(disk_anlv + 1);
        textafter=getu8(disk_anlv + 2);
        flags=getu16lsb(disk_anlv + 3);
        kul=getu8(disk_anlv + 5)&7;
        autonumber_colour=Colors::GetRGBA(getu8(disk_anlv + 5)>>3);
        font_code=gets16lsb(disk_anlv + 6);
        font_halfpoint_size=getu16lsb(disk_anlv + 8);
        startat=getu16lsb(disk_anlv + 10);
        dxaindent=getu16lsb(disk_anlv + 12);
        dxaspace=getu16lsb(disk_anlv + 14);
}

void Anlv::FixTextPointers(unsigned maxlen)
{
        if (unsigned(textbefore+textafter)>maxlen)
        {
                DEBUGPRINT("Incorrect text pointers: max = " << maxlen << ", before = " << textbefore << ", after = " << textafter);
                textbefore=0;
                textafter=0;
        }
}

Anld::Anld(uint8_t const *disk_anld)
: anlv(disk_anld)
{
        ftc = gets16lsb(disk_anld+6);
        hps = getu16lsb(disk_anld+8);
        number_1 = getu8(disk_anld+16) ? 1 : 0;
        numberaccross = getu8(disk_anld+17) ? 1 : 0;
        restartheading = getu8(disk_anld+18) ? 1 : 0;

        unsigned maxchars = std::max(32,anlv.textbefore+anlv.textafter);

        /* Read up to maxchars, but terminate at NUL byte */
        for (unsigned i=0;i<maxchars && getu16lsb(disk_anld+20+i*2);++i)
            chars.push_back(getu16lsb(disk_anld+20+i*2));
        anlv.FixTextPointers(chars.size());
}

void Anlv::Project(BiffDoc const &parent, Chp *chp) const
{
        //ADDME? Ignoring the justification code and indent settings
        //ADDME: It would be prettier if Anld used the same bits as other code
        //       does, so that we could use just a few bitmasks
        if (flags&SetBold)
        {
          if (flags&Bold)
            chp->formatted.format_bits |= Parsers::Character::Bold;
          else
            chp->formatted.format_bits &= ~Parsers::Character::Bold;
        }

        if (flags&SetItalic)
        {
                if (flags&Italic)
                    chp->formatted.format_bits |= Parsers::Character::Italic;
                else
                    chp->formatted.format_bits &= ~Parsers::Character::Italic;
        }

        if (flags&SetSmallCaps)
        {
                if (flags&SmallCaps)
                        chp->formatted.format_bits |= Parsers::Character::Smallcaps;
                else
                        chp->formatted.format_bits &= ~Parsers::Character::Smallcaps;
        }

        if (flags&SetStrike)
        {
                if (flags&Strike)
                        chp->formatted.format_bits |= Parsers::Character::Strikethrough;
                else
                        chp->formatted.format_bits &= ~Parsers::Character::Strikethrough;
        }

        if (flags&SetCaps)
        {
                if (flags&Caps)
                        chp->pod.internal_bits |= Chp::Caps;
                else
                        chp->pod.internal_bits &= ~Chp::Caps;
        }

        if (flags&SetKul)
            chp->formatted.underlining=MapUnderlines(kul);

        chp->formatted.foreground_color=autonumber_colour;
        chp->SetFont(&parent.GetFont(font_code));
        if (font_halfpoint_size) //Is this the correct way to implement Auto? (hps==0)
            chp->formatted.font_halfpoint_size=font_halfpoint_size;
}


Anlv::Anlv()
: autonumber_colour(0,0,0,255)
{
        flags=0;
        nfc=0;
        textbefore=0;
        textafter=0;
        kul=0;
        font_halfpoint_size=0;
        startat=0;
        dxaindent=0;
        dxaspace=0;
        font_halfpoint_size=0;
}

Anld::Anld()
{
}

Olst::Olst()
{
}

Olst::Olst(uint8_t const *data)
{
        //initialize Anlvs using the disk info
        for (unsigned i=0;i<9;++i)
            anlv[i]=Anlv(data + Anlv::DiskSize*i);

        restart_after_sectionbreak=getu8(data+144) ? 1 : 0;

        for (unsigned i=0;i<32 && getu16lsb(data+148+i*2);++i)
            chars.push_back(getu16lsb(data+148+i*2));
}

ListLevel::ListLevel(unsigned level)
: startat(0) //ECMA-376 2E1 p824
, nfc(0)
, jc(0)
, legal(false)
, restartafter(level) //default to restart after previous level. level is 0-based and restartafter is 1-based
, follower(0)
{
}
ListLevel::~ListLevel()
{
}
void ListLevel::ApplyPap(Pap *) const
{
}
void ListLevel::ApplyChp(Pap const *, Chp *) const
{
}

BiffListLevel::BiffListLevel(BiffDoc &parent, unsigned level)
: ListLevel(level)
, parent(parent)
{
}
void BiffListLevel::ApplyPap(Pap *pap) const
{
        SprmIterator itr(parent, list_papx);
        parent.ApplySprms(&itr, pap, NULL, NULL);
}
void BiffListLevel::ApplyChp(Pap const *pap, Chp *chp) const
{
        SprmIterator itr(parent, list_chpx);
        parent.ApplyChpSprms(&itr, pap->istd_style->cached_stylechp, chp, chp);
}

ListOverride::ListOverride()
{
}
ListOverride::~ListOverride()
{
}

LevelOverride::LevelOverride()
{
        startat=false;
        formatting=false;
}
LevelOverride::~LevelOverride()
{
}

} // End of namespace Word
} // End of namespace Office
} // End of namespace Parsers
