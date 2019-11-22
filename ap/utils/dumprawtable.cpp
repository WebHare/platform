#include <ap/libwebhare/allincludes.h>

#include <iostream>
#include <iomanip>
#include <blex/getopt.h>
#include <blex/bitmanip.h>
#include <blex/logfile.h>
#include <ap/dbserver/dbase_meta.h>
#include <ap/dbserver/dbase_diskio.h>
#include <ap/dbserver/dbase_trans.h>
//---------------------------------------------------------------------------

std::string GetTransIdName(Database::TransId id)
{
        if (id == Database::TransStateMgr::NeverCommitted)
            return "Never";
        else if (id == Database::TransStateMgr::AlwaysCommitted)
            return "Always";
        return Blex::AnyToString(id);
}

std::string GetTransShow(Database::TransId id, Database::TransStateMgr &translog)
{
        std::string id_str = GetTransIdName(id);
        if (id == Database::TransStateMgr::NeverCommitted || id == Database::TransStateMgr::AlwaysCommitted)
            return id_str;
        else
        {
                switch (translog.GetStatus(id, 0))
                {
                case Database::TransStateMgr::GlobalCommitted:     id_str += "(GC)"; break;
                case Database::TransStateMgr::GlobalRolledBack:    id_str += "(GR)"; break;
                case Database::TransStateMgr::LocalCommitted:      id_str += "(LC)"; break;
                case Database::TransStateMgr::LocalRolledBack:     id_str += "(LR)"; break;
                default:
                    id_str += "?";
                }
                return id_str;
        }
}

void DumpTranslog(std::string const &dbfolder)
{
        std::unique_ptr< Blex::MmapFile > logfile;

        // Try to open pre-existing transaction log.
        std::string logfilename = Blex::MergePath(dbfolder,"translog.whdb");
        logfile.reset(Blex::MmapFile::OpenRW(logfilename,false,false,Blex::FilePermissions::PrivateRead,false,false,true));
        if (!logfile.get())
            throw Database::Exception(Database::ErrorIO,"Cannot open transaction log file");

        Blex::FileOffset filelen=logfile->GetFilelength();
        if ((filelen % Database:: TransStateMgr::BlockSize) != 0)
            throw Database::Exception(Database::ErrorInternal,"Transaction log file is in an unrecognized format");

        // Read version if file length is valid, otherwise we were just initializing
        unsigned version = 0;

        // Map header pages and read version
        Blex::IndependentBitmap transmap=static_cast< uint8_t* >(logfile->MapRW(0, filelen));
        version = Blex::getu32lsb(transmap + Database::TransStateMgr::HeaderVersionId);

        std::cout << "Translog version " << version << std::endl;
        switch (version)
        {
        case 3:
            {
                    std::cout << "Current range: " << (int)Blex::getu8(transmap + 20) << std::endl;
                    for (Database::RangeId range = 0; range < Database::TransStateMgr::RangesCount; ++range)
                        std::cout << "Last trans for range #" << range << ": " << std::setw(10) << Blex::getu32lsb(transmap + 4 + 4*range) << " (" << (Blex::getu32lsb(transmap + 4 + 4*range) & 0x3FFFFFFF) << ")" << std::endl;

                    for (Database::RangeId range = 0; range < 4; ++range)
                    {
                            std::cout << "Dump for range " << (int)range << std::endl;
                            Database::TransId last = Blex::getu32lsb(transmap + 4 + 4*range);
                            Database::TransId base = range * 0x40000000;

                            std::vector< std::pair< std::pair< Database::TransId, Database::TransId >, bool > > cs;

                            for (; base != last; ++base)
                            {
                                    unsigned local_trans = base & 0x3FFFFFFF;
                                    unsigned pagenr = local_trans / (4096 * 8);
                                    uint8_t *page = transmap + (1 + pagenr * 4 + range) * 4096;
                                    uint8_t *byte = page + ((local_trans >> 3) & 4095);
                                    bool committed = (*byte & (1 << (local_trans & 7))) != 0;
                                    cs.push_back(std::make_pair(std::make_pair(base, base), committed));
                            }
                            unsigned i = 0, other = 1;
                            for (; other < cs.size(); ++other)
                            {
                                    if (cs[i].second != cs[other].second)
                                    {
                                            ++i;
                                            cs[i] = cs[other];
                                    }
                                    else
                                        cs[i].first.second = cs[other].first.second;
                            }
                            cs.resize(i + 1);

                            for (std::vector< std::pair< std::pair< Database::TransId, Database::TransId >, bool > >::iterator it = cs.begin(); it != cs.end(); ++it)
                            {
                                    std::cout << "Transaction " << std::setw(10) << it->first.first << " - " << std::setw(10) << it->first.second << ":  " << (it->second ? "C" : "R") << std::endl;

                            }
                    }
            } break;
        default:
            std::cout << "Unsupported version" << std::endl;
        }
}

// Get representation of record without having metadata to pretty up everything
void GetRawRecordRepresentation(Database::TransStateMgr &translog, Database::RecordId id, Database::Record const &record, Database::RawDatabase::Debug_RecordData const &data, std::string *out, bool hex)
{
        static std::stringstream str;
        str.str("");

        str << "Rec: " << id << "(" << data.size << ","
            << GetTransShow(data.adder, translog) << "," << GetTransShow(data.remover, translog) << "," << data.next << ",T=" << data.tableid << ") ";

        for (unsigned i=0;i<record.GetNumCells();++i)
        {
                Database::ColumnId colid = record.GetColumnIdByNum(i);
                Database::Cell curcell = record.GetCell(colid);
                str << " #" << i << '.' << colid << ':' << curcell.Size();
                str << "=";

                if(curcell.End() > record.GetRawData() + record.GetRawLength())
                {
                        str << "CORRUPT:EXTENDS PAST END";
                        continue;
                }

                if(hex)
                {
                        Blex::EncodeBase16(curcell.Begin(), curcell.End(), std::ostream_iterator<char>(str));
                }
                else
                {
                        if (curcell.Size()==4)
                            str << curcell.Integer();
                        if (curcell.Size()==8)
                        {
                                Blex::DateTime dt = curcell.DateTime();
                                if (dt <= Blex::DateTime::Now() + Blex::DateTime::Days(365))
                                {
                                        std::tm dt_tm = dt.GetTM();
                                        if (dt_tm.tm_year >= 0)
                                        {
                                                str << "[" << std::right << std::setw(2) << std::setfill('0') << dt_tm.tm_mday << "-" << std::setw(2) << std::setfill('0') << (dt_tm.tm_mon+1) << "-" << (dt_tm.tm_year+1900) << " ";
                                                str << std::right << std::setw(2) << std::setfill(' ') << dt_tm.tm_hour << ":" << std::setw(2) << std::setfill('0') << dt_tm.tm_min << ":" << std::setw(2) << std::setfill('0') << dt_tm.tm_sec << ":" << std::setw(3) << std::setfill('0') << (dt.GetMsecs() % 1000) << "] ";
                                        }
                                }
                        }
                        else if (curcell.Size()<=1)
                            str << (curcell.Boolean()?"true":"false");
                        str << ":";
                        for (const uint8_t *data=curcell.Begin();data!=curcell.End();++data)
                        {
                                if (*data>=32 && *data<=127)
                                    str << *data;
                                else
                                    str << '?';
                        }
                }
        }

        str << "\n";
        *out=str.str();
}

void DumpSectionList(std::string const &dbfolder)//, unsigned id, bool show_dead, bool group_by_trans, bool followupdates, Database::TransId fromtrans, Database::TransId totrans, bool hex)
{
        std::cout << "Opening database for sectionlist ...";
        Database::RawDatabase dbase(dbfolder, dbfolder, false, false, false, false);
        Database::TransStateMgr &translog(dbase.GetTransLog());
        Database::IdentifiedTrans trans(translog, false);
        std::cout << " done" << std::endl;

        std::cout << "Number of sections: " << dbase.GetNumSections() << std::endl;

        std::cout << "SECTION  TABLE FILL" << std::endl;

        for (unsigned sectionid=0;sectionid<dbase.GetNumSections();++sectionid)
        {
                Database::TableId tableid = dbase.Deprecated_GetSectionTableId(sectionid);

                unsigned fill = 0;

                Database::RawDatabase::SectionViewer viewer(dbase, tableid);
                if (viewer.MoveToSection(sectionid))
                {
                        do
                        {
                                for (Database::RawDatabase::SectionViewer::DiskRecord const *rit = viewer.view_begin(); rit != viewer.view_end(); ++rit)
                                {
                                        Database::RawDatabase::Debug_RecordData data = dbase.Debug_GetRecordInfo(rit->recordid);
                                        fill += (data.size + 127)/128;
                                }
                        } while (viewer.NextViewInSection());
                }

                std::cout << std::setw(8) << sectionid << " " << std::setw(5) << tableid << " " <<
                    std::setw(5) << fill << "/448" << std::endl;
        }

        dbase.Close();
}


void DumpRawTable(std::string const &dbfolder, unsigned id, bool show_dead, bool group_by_trans, bool followupdates, Database::TransId fromtrans, Database::TransId totrans, bool hex)
{
        std::cout << "Opening database ...";
        Database::RawDatabase dbase(dbfolder, dbfolder, false, false, false, false);
        Database::TransStateMgr &translog(dbase.GetTransLog());
        Database::IdentifiedTrans trans(translog, false);
        std::cout << " done" << std::endl;

        std::string depthstr, temp;

        if (!group_by_trans)
        {
                Database::RawDatabase::SectionViewer viewer(dbase, id);
                if (viewer.MoveToFirstSection())
                    while (true)
                    {
                            for (Database::RawDatabase::SectionViewer::DiskRecord const *rit = viewer.view_begin(); rit != viewer.view_end(); ++rit)
                            {
                                    Database::RawDatabase::Debug_RecordData data = dbase.Debug_GetRecordInfo(rit->recordid);

                                    if (!show_dead
                                            && (data.adder == Database::TransStateMgr::NeverCommitted
                                                || data.remover == Database::TransStateMgr::AlwaysCommitted))
                                        continue;

                                    if ((data.adder < fromtrans || data.adder > totrans)
                                         && (data.remover < fromtrans || data.remover > totrans))
                                        continue;

                                    GetRawRecordRepresentation(translog, rit->recordid, rit->record, data, &temp, hex);
                                    std::cout << temp;
                            }
                            if (!viewer.NextViewInSection() && !viewer.MoveToNextSection())
                                break;
                    }
        }
        else
        {
                typedef std::map< uint32_t, std::vector< uint32_t > > RelevantStuff;
                RelevantStuff relevant_stuff;
                RelevantStuff relevant_updates;

                std::cout << "Scanning database for transaction ids" << std::endl;
                Database::RawDatabase::SectionViewer viewer(dbase, id);
                if (viewer.MoveToFirstSection())
                    while (true)
                    {
                            for (Database::RawDatabase::SectionViewer::DiskRecord const *rit = viewer.view_begin(); rit != viewer.view_end(); ++rit)
                            {
                                    Database::RawDatabase::Debug_RecordData data = dbase.Debug_GetRecordInfo(rit->recordid);

                                    if (!show_dead
                                            && (data.adder == Database::TransStateMgr::NeverCommitted
                                                || data.remover == Database::TransStateMgr::AlwaysCommitted))
                                        continue;

                                    if ((data.adder < fromtrans || data.adder > totrans)
                                         && (data.remover < fromtrans || data.remover > totrans))
                                        continue;

                                    relevant_updates[data.remover].push_back(data.next);
                                    relevant_stuff[data.adder].push_back(rit->recordid);
                                    relevant_stuff[data.remover].push_back(rit->recordid);
                            }
                            if (!viewer.NextViewInSection() && !viewer.MoveToNextSection())
                                break;
                    }

                Database::DatabaseLocker locker(dbase);
                for (RelevantStuff::iterator trit = relevant_stuff.begin(); trit != relevant_stuff.end(); ++trit)
                {
                        uint32_t relevant_trans = trit->first;
                        std::vector<uint32_t>&updates= relevant_updates[relevant_trans];

                        std::cout << "**Records relevant to transaction " << GetTransIdName(relevant_trans) << " " << std::hex << relevant_trans << std::dec << std::endl;

                        for (std::vector< uint32_t >::iterator rit = trit->second.begin(); rit != trit->second.end(); ++rit)
                        {
                                if (std::find(updates.begin(), updates.end(), *rit) != updates.end()) //this is an updated record, skip
                                    continue;

                                uint32_t current = *rit;
                                uint32_t depth = 0;

                                while (current != 0)
                                {
                                        depthstr.assign(depth, ' ');
                                        Database::RawDatabase::Debug_RecordData data = dbase.Debug_GetRecordInfo(current);
                                        if (data.adder != relevant_trans && data.remover != relevant_trans)
                                            break;

                                        Database::DeprecatedAutoRecord rec(locker, id, current);

                                        if(data.adder == relevant_trans && depth==0)
                                            std::cout<<"INS:";
                                        else if (data.remover == relevant_trans && data.next==0)
                                            std::cout<<"DEL:";
                                        else
                                            std::cout<<"U:  ";

                                        GetRawRecordRepresentation(translog, current, *rec, data,&temp, hex);
                                        std::cout << depthstr << temp;
                                        if (!followupdates)
                                            break;
                                        current = data.next;
                                        ++depth;
                                }
                        }
                }
        }

        dbase.Close();
}

void DumpIndex(std::string const &/*dbasedir*/)
{

}

Blex::OptionParser::Option optionlist[] =
{
  Blex::OptionParser::Option::Switch("h", false),
  Blex::OptionParser::Option::Switch("d", false),
  Blex::OptionParser::Option::Switch("hex", false),
  Blex::OptionParser::Option::Switch("groupbytrans", false),
  Blex::OptionParser::Option::Switch("showtranslog", false),
  Blex::OptionParser::Option::Switch("followupdates", false),
  Blex::OptionParser::Option::StringOpt("fromtrans"),
  Blex::OptionParser::Option::StringOpt("totrans"),
  Blex::OptionParser::Option::Param("dbasedir", true),
  Blex::OptionParser::Option::Param("tableid", true),
  Blex::OptionParser::Option::ListEnd()
};

int UTF8Main(std::vector<std::string> const &args)
{
        //ADDME: Move to blexlib!
        std::cout.sync_with_stdio(false);
        try
        {
                Blex::OptionParser optparse(optionlist);
                if (!optparse.Parse(args) || optparse.Switch("h"))
                {
                        std::cout  << "Syntax: dumprawtable [options] {dbasedir} {<tableid>/index/sectionlist}\n";
                        std::cout << "    -d: Show dead (invisible) records as well";
                        std::cout << "    --hex: Dump all data as hexadecimal bytes\n";
                        if (!optparse.GetErrorDescription().empty())
                            std::cout  << optparse.GetErrorDescription() << "\n";
                        return EXIT_FAILURE;
                }

                if (optparse.Param("tableid")=="index")
                {
                        DumpIndex(optparse.Param("dbasedir"));
                        return 0;
                }

                if (optparse.Param("tableid")=="sectionlist")
                {
                        DumpSectionList(optparse.Param("dbasedir"));
                        return 0;
                }

                unsigned tableid = Blex::DecodeUnsignedNumber<unsigned>(optparse.Param("tableid"));

                if (optparse.Switch("showtranslog"))
                {
                        DumpTranslog(optparse.Param("dbasedir"));
                        return 0;
                }

                Database::TransId transfrom = optparse.Exists("fromtrans") ? std::strtoul(optparse.StringOpt("fromtrans").c_str(),NULL,10) : Database::TransStateMgr::AlwaysCommitted;
                Database::TransId transto = optparse.Exists("totrans") ? std::strtoul(optparse.StringOpt("totrans").c_str(),NULL,10) : Database::TransStateMgr::NeverCommitted;

                DumpRawTable(optparse.Param("dbasedir"),
                        tableid,
                        optparse.Switch("d"),
                        optparse.Switch("groupbytrans"),
                        optparse.Switch("followupdates"),
                        transfrom,
                        transto,
                        optparse.Switch("hex")
                );
        }
        catch(std::exception &e)
        {
                Blex::ErrStream() << "\nException: " << e.what();
                std::abort();
        }
        return 0;
}
//---------------------------------------------------------------------------



int main(int argc, char *argv[])
{
        return Blex::InvokeMyMain(argc,argv,&UTF8Main);
}
