#include <ap/libwebhare/allincludes.h>


//------------------------------------------------------------------------------
#include <blex/crypto.h>
#include <iostream>
#include <iomanip>
#include <blex/logfile.h>
#include <blex/stream.h>
#include <blex/path.h>
#include <blex/getopt.h>
#include <blex/parityfile.h>
#include <blex/zstream.h>
#include <ap/libwebhare/whcore.h>
#include "../dbserver/dbase_types.h"

const unsigned BufferSize = 1 << 22; // 4 meg buffer
const unsigned WriteChunkSize = 65536;
const int ReadChunkSize = 65536;

namespace BlobMode
{
enum Type
{
        Full,       // Include blobs in backup
        Ignore,     // Ignore blobs (give back empty blobs upon restore)
        Reference   // Store reference in backup, requires external source of blobs upon restore
};
}

class AsyncStreamWriter : public Blex::Stream
{
    private:
        Blex::Stream &stream;

        Blex::Thread thread;

        void ThreadFunction();

        // 256 kb ringbuffer
        uint8_t ringbuffer[BufferSize];

        struct Data
        {
                inline Data() : buffer_start(0), buffer_end(0), must_finish(0) {}

                unsigned buffer_start;
                unsigned buffer_end;
                bool must_finish;
        };
        typedef Blex::InterlockedData< Data, Blex::ConditionMutex > LockedData;

        LockedData lockeddata;

        unsigned write_pos;
        unsigned write_room;

        AsyncStreamWriter(AsyncStreamWriter const &);
        AsyncStreamWriter & operator =(AsyncStreamWriter const &);

        std::pair< unsigned, unsigned > AllocateWriteBlock();
        std::pair< unsigned, unsigned > GetReadBlock();

    public:
        AsyncStreamWriter(Blex::Stream *_stream);

        virtual ~AsyncStreamWriter();

        virtual std::size_t Read(void *buf,std::size_t maxbufsize);
        virtual bool EndOfStream();
        virtual std::size_t Write(void const *buf, std::size_t bufsize);
};

AsyncStreamWriter::AsyncStreamWriter(Blex::Stream *_stream)
: Stream(false)
, stream(*_stream)
, thread(std::bind(&AsyncStreamWriter::ThreadFunction, this))
, write_pos(0)
, write_room(0)
{
        thread.Start();
}

AsyncStreamWriter::~AsyncStreamWriter()
{
        {
                LockedData::WriteRef lock(lockeddata);
                lock->buffer_end = write_pos;
                lock->must_finish = true;
        }
        lockeddata.SignalAll();
        thread.WaitFinish();
}

void AsyncStreamWriter::ThreadFunction()
{
        while (true)
        {
                unsigned write_start;
                unsigned write_end;
                signed write_size;

                {
                        LockedData::WriteRef lock(lockeddata);

                        while (true)
                        {
                                write_start = lock->buffer_start;
                                write_end = lock->buffer_end;

                                if (write_start == write_end && lock->must_finish)
                                    return;

                                bool wrapping = false;
                                if (write_end < write_start)
                                {
                                        write_end = sizeof(ringbuffer);
                                        wrapping = true;
                                }

                                write_size = write_end - write_start;

                                if (!lock->must_finish && !wrapping)
                                    write_size -= 256;

                                if (write_size >= 16384 || lock->must_finish || (write_size > 0 && wrapping))
                                    break;

//                                DEBUGPRINT(this << " read wait");
                                lock.Wait();
                        }

                        // Read from buffer in chunks of max ReadChunkSize
                        if (write_size >= ReadChunkSize)
                            write_size = ReadChunkSize;

                }

//                DEBUGPRINT(this << " rd " << write_start << "-" << write_start + write_size << " **");
                stream.Write(ringbuffer + write_start, write_size);
//                DEBUGPRINT(this << " /rd");

                {
                        LockedData::WriteRef lock(lockeddata);
                        lock->buffer_start = (lock->buffer_start + write_size) % sizeof(ringbuffer);

//                        DEBUGPRINT("Current fill: " << (sizeof(ringbuffer) + lock->buffer_end - lock->buffer_start) % sizeof(ringbuffer));
                }
                // We process a lot of data per time, so always signalling is ok.
                lockeddata.SignalAll();
        }
}

std::size_t AsyncStreamWriter::Read(void *,std::size_t)
{
        throw std::runtime_error("Read not supported in AsyncStreamWriter");
}

bool AsyncStreamWriter::EndOfStream()
{
        return false;
}

std::size_t AsyncStreamWriter::Write(void const *buf, std::size_t bufsize)
{
        uint8_t const *data_start = static_cast< uint8_t const * >(buf);
        unsigned bytes_written = 0;

        while (bufsize != 0)
        {
                while (write_room != 0)
                {
                        unsigned room_now = std::min<std::size_t>(sizeof(ringbuffer) - write_pos, write_room);
                        unsigned write_now = std::min<std::size_t>(bufsize, room_now);

//                        DEBUGPRINT(this << " wr " << write_pos << "-" << write_pos + write_now);
                        memcpy(ringbuffer + write_pos, data_start, write_now);
//                        DEBUGPRINT(this << " /wr");

                        data_start += write_now;
                        write_pos = (write_pos + write_now) % sizeof(ringbuffer);
                        write_room -= write_now;
                        bufsize -= write_now;
                        bytes_written += write_now;
                        if (bufsize == 0)
                            return bytes_written;
                }

                {
                        LockedData::WriteRef lock(lockeddata);

                        lock->buffer_end = write_pos;
//                        DEBUGPRINT("Current fill: " << (sizeof(ringbuffer) + lock->buffer_end - lock->buffer_start) % sizeof(ringbuffer));

                        while (write_room == 0)
                        {
                                // If the buffer does not wrap (start <= end) we may write until the end of the buffer
                                if (lock->buffer_start <= lock->buffer_end)
                                {
                                        // If the start is at 0, the end may not end up at 0 too. Stop one short of the end.
                                        if (lock->buffer_start == 0)
                                            write_room = sizeof(ringbuffer) - lock->buffer_end - 1; // inv: sizeof(ringbuffer) > lock->buffer_end, so the '- 1' part is ok.
                                        else
                                            write_room = sizeof(ringbuffer) - lock->buffer_end;
                                }
                                else
                                {
                                        // Make sure there is always 1 distance between start and end (start == end means empty buffer, + one cache line to avoid cache clashes)
                                        if (lock->buffer_end + 257 >= lock->buffer_start)
                                            write_room = 0;
                                        else
                                            write_room = lock->buffer_start - lock->buffer_end - 257;
                                }

                                // No room? Wait until it's available
                                if (write_room == 0)
                                {
//                                        DEBUGPRINT(this << " write wait");
                                        lock.Wait();
                                }
                                else
                                {
                                        // Don't allocate more than WriteChunkSize at once
                                        if (write_room > WriteChunkSize)
                                            write_room = WriteChunkSize;
//                                        DEBUGPRINT(this << " al " << lock->buffer_start << "-" << lock->buffer_end << ": " << write_room << " &&");
                                        break;
                                }
                        }
                }

                // 32kb chunk has been filled, signal reader
                lockeddata.SignalAll();
        }
        return bytes_written;
}




/*
        Backup file structure

Header
Blob/Record
Blob/Record
...
Blob/Record
EndOfFile

Header format: // This may NEVER change
   0 : uint32_t "BLBU"
   4 : uint32_t backupfile version identifier

Table format:
   0 : uint32_t "TABL"
   4 : uint32_t table id
   8 : uint32_t length of table name
  12 : data of table name
  .. : uint32_t number of blob columns
  .. : uint32_t id of every blob column

Record format:
   0 : uint32_t "RECD"
   After that, per column:
   0 : uint16_t length of column-data
   2 : uint16_t id of column
   4 : data of column

Blob format:
   0 : uint32_t "BLOB"
   4 : uint32_t id of this blob (every cell that references a blob has this number as it's blob's id field)
   8 : blob-data

EndOfFile format
   0 : uint32_t "BEDN"

Splits can occur: after every complete struct, and with blob data.

When a blob is referenced in a record, that blob MUST precede that record in the backup file
Records from metadata tables must precede records from non-metadata tables
*/

// -----------------------------------------------------------------------------
//
// Header
//
void WriteHeader(Blex::Stream &stream, bool compressed, bool externalblobs)
{
        uint32_t flags = Database::Backup::FileVersion;
        if (compressed)
            flags |= Database::Backup::CompressedFlag;
        if (externalblobs)
            flags |= Database::Backup::ExternalBlobFlag;

        stream.WriteLsb<uint32_t>(Database::Backup::StrBBeg);
        stream.WriteLsb<uint32_t>(flags);
}

// -----------------------------------------------------------------------------
//
// Table
void WriteTable(Blex::Stream &stream, uint32_t tableid, std::string const &tablename, std::vector< Database::ClientColumnInfo const * > const &allcolumns, std::vector< unsigned > const &blobcolumnindexes)
{
        stream.WriteLsb<uint32_t>(Database::Backup::StrTabl);
        stream.WriteLsb<uint32_t>(tableid);
        stream.WriteLsb<uint32_t>(tablename.size());
        stream.Write(&tablename[0],tablename.size());

        stream.WriteLsb<uint32_t>(blobcolumnindexes.size());
        for (unsigned i=0;i<blobcolumnindexes.size();++i)
            stream.WriteLsb<uint32_t>(allcolumns[blobcolumnindexes[i]]->Deprecated_GetId());

        stream.WriteLsb<uint32_t>(allcolumns.size());
        for (unsigned i=0;i<allcolumns.size();++i)
            stream.WriteLsb<uint32_t>(allcolumns[i]->Deprecated_GetId());
}

// -----------------------------------------------------------------------------
//
// Record
//
void WriteRecord(Blex::Stream &stream, Database::Record const *record, std::vector<Database::ColumnId> const &allcolumns)
{
        stream.WriteLsb<uint32_t>(Database::Backup::StrRecd);

        for (unsigned idx = 0; idx < allcolumns.size(); ++idx)
        {
                Database::Cell const &cell = record->GetCell(allcolumns[idx]);
                stream.WriteLsb<uint16_t>(static_cast<uint16_t>(cell.Size()));
                stream.Write(cell.Begin(), cell.Size());
        }
}


// -----------------------------------------------------------------------------
//
// Blob
//
//
void WriteBlob(Blex::Stream &stream, Database::TransFrontend *trans, Database::BlobId blobid, Blex::FileOffset bloblen)
{
        if (blobid == 0)
            return;

        Blex::FileOffset size;
        const std::unique_ptr<Blex::RandomStream> str(trans->OpenBlob(blobid, bloblen));
        if (!str.get())
        {
                Blex::ErrStream() << "\nBlob with id " << blobid << " does not exist";
                size=0;
        }
        else
        {
                size = str->GetFileLength();
        }

        stream.WriteLsb<uint32_t>(Database::Backup::StrBlob);
        stream.WriteLsb<uint64_t>(blobid);
        stream.WriteLsb<uint64_t>((uint32_t)size);

        if (!str.get())
                return;

        Blex::FileOffset written = str->SendAllTo(stream);
        if (written >= size)
                return;

        Blex::ErrStream() << "\nBlob with id " << blobid << " could not be fully read, padding";

        std::vector<uint8_t> nulls(16384,0);
        while(written<size)
        {
                unsigned towrite = unsigned(std::min<Blex::FileOffset>(size-written, nulls.size()));
                if (stream.Write(&nulls[0], towrite) != towrite)
                {
                        Blex::ErrStream() << "\nPadding failed, disk full?";
                        return;
                }
                written += towrite;
        }
}

int BuildBackup(Database::TransFrontend &trans, std::string const &filename, unsigned maxfilelength, bool show_progress, bool nohash, BlobMode::Type blobmode, bool compress, bool serial, std::vector<std::string> const &skiptables)
{
        std::unique_ptr<Blex::ParityFile> parityfile;

        //To get 1MB sections: 31+1 blocks of 32KB each: 8 sectors of 4K per block. Overhead approx 3%
        //To get 16MB sections: 31+1 blocks of 32KB each: 32 sectors of 16K per block. Overhead ?
        parityfile.reset(Blex::ParityFile::OpenWrite(filename, Blex::FilePermissions::PublicRead, 16384, 32, 31, 1, (maxfilelength+15)/16, !nohash));

        // Open the backup file
        if (!parityfile.get())
        {
                Blex::ErrStream() << "Could not open file " << filename << " for writing";
                return 1;
        }

        Blex::Stream *stream = parityfile.get();

        // Write signature
        WriteHeader(*stream, compress, blobmode == BlobMode::Reference);

        // Enable compression AFTER writing the header
        std::unique_ptr< Blex::ZlibCompressStream > cstream;
        std::unique_ptr< Blex::BufferedStream > compress_prebuffer;
        std::unique_ptr< AsyncStreamWriter > asyncwriter;
        std::unique_ptr< AsyncStreamWriter > asyncwriter2;

        if (!serial)
        {
                asyncwriter2.reset(new AsyncStreamWriter(stream));
                stream = asyncwriter2.get();
        }

        if (compress)
        {
                cstream.reset(new Blex::ZlibCompressStream(*stream, Blex::ZlibCompressStream::Gzip, 9));
                stream = cstream.get();

                if (!serial)
                {
                        asyncwriter.reset(new AsyncStreamWriter(stream));
                        stream = asyncwriter.get();
                }

                compress_prebuffer.reset(new Blex::BufferedStream(*stream));
                stream = compress_prebuffer.get();
        }

        Database::Client::CachedMetadata const &metadata = trans.GetConfig();
        std::vector<Database::TableInfo> tables = metadata.GetTables();

        std::set<unsigned> writtenblobs;

        Database::WritableRecord outrec;

        Blex::DateTime backup_start = Blex::DateTime::Now();
        unsigned lastmb=0;

        for (std::vector<Database::TableInfo>::const_iterator it = tables.begin(); it != tables.end(); ++it)
        {
                Database::TableInfo const &def = *it;
                if (Blex::StrCaseLike(def.name,"INFORMATION_SCHEMA.*")) //ADDME: We should actually be skipping views
                   continue;

                bool skip = false;
                for(auto skiptable : skiptables)
                {
                       if(Blex::StrCaseLike(def.name, skiptable))
                               skip = true;
                }
                if(skip)
                        continue;

                std::vector< Database::ClientColumnInfo const * > columns;
                for (std::vector< Database::ClientColumnInfo >::const_iterator it = def.GetColumns().begin(); it != def.GetColumns().end(); ++it)
                    columns.push_back(&*it);

                std::vector< unsigned > blobcolumnindexes;
                std::vector< Database::ColumnId > allcolumnids;

                // Erase all interal column fields, get all columnid's and blob column id's
                std::vector< Database::ClientColumnInfo const * >::iterator cit = columns.begin();
                while (cit != columns.end())
                {
                        if ((*cit)->internal || (blobmode == BlobMode::Ignore && (*cit)->type == Database::TBlob))
                        {
                                cit = columns.erase(cit);
                                continue;
                        }

                        if((*cit)->type == Database::TBlob)
                            blobcolumnindexes.push_back(std::distance(columns.begin(), cit));

                        allcolumnids.push_back((*cit)->Deprecated_GetId());
                        ++cit;
                }
                WriteTable(*stream, def.Deprecated_GetId(), def.name, columns, blobcolumnindexes);

                // Record counter
                unsigned count=0;

                // Scan this table
                Database::ClientScanner scan(trans,false, "Backup scan");
                scan.AddTable(&def, 0);

                scan.RequestColumns(0, columns.size(), &columns[0]);

                while (true)
                {
                        bool gotrow = scan.NextRow();
                        //FIXME: Unprotected cross-thread read
                        unsigned curmb = unsigned(parityfile->GetTotalInputBytes()/(1024*1024));

                        if (show_progress && (count%100 == 0 || curmb!=lastmb || !gotrow))
                        {
                                lastmb=curmb;

                                uint32_t timepassed = (Blex::DateTime::Now() - backup_start).GetMsecs();
                                float speed = timepassed ? (curmb*1.0 / timepassed) : 0;

                                std::cout << "\r" << def.name << "... " << count << " records  " << curmb << "MB";
                                if(speed)
                                    std::cout << " (" << std::setw(5) << std::setfill(' ') << std::right << std::showpoint << std::setprecision(3) << (speed*1000) << " MB/s).";
                                std::cout << std::flush;
                        }
                        if(!gotrow)
                            break;

                        ++count;

                        outrec=Database::Record(); //reset
                        for (unsigned i=0;i<allcolumnids.size();++i)
                            outrec.SetColumn(allcolumnids[i], scan.GetCell(i).Size(), scan.GetCell(i).Begin());

                        if (blobmode != BlobMode::Reference) // Skip storing blobs if reference only
                        {
                                for (unsigned i=0;i<blobcolumnindexes.size();++i)
                                {
                                        Database::BlobId blobid=scan.GetCell(blobcolumnindexes[i]).Blob();
                                        Blex::FileOffset bloblen=scan.GetCell(blobcolumnindexes[i]).BlobLength();
                                        if (writtenblobs.count(blobid) == 0)
                                        {
                                                WriteBlob(*stream, &trans, blobid, bloblen);
                                                writtenblobs.insert(blobid);
                                        }
                                }
                        }

                        WriteRecord(*stream, &outrec, allcolumnids);
                }
                if(show_progress)
                    std::cout<<std::endl;
        }
        stream->WriteLsb<uint32_t>(Database::Backup::StrBEnd);

        compress_prebuffer.reset();
        asyncwriter.reset();

        // Finalization; kill zstream if it exists
        cstream.reset();
        asyncwriter2.reset();

        if(!parityfile->Finalize())
        {
                Blex::ErrStream() << "Could not complete backup file write (out of disk space?)";
                return 1;
        }

        if (show_progress)
            std::cout<<std::endl;
        return 0;
}

bool DeleteFiles(std::string const &dir, std::string const &mask)
{
        std::vector<std::string> to_kill;

        for (Blex::Directory diritr(dir,mask);diritr;++diritr)
            to_kill.push_back(diritr.CurrentPath());

        for (std::vector<std::string>::const_iterator itr=to_kill.begin();itr!=to_kill.end();++itr)
          if (!Blex::RemoveFile(*itr))
            return false;

        return true;
}

void Rotate(std::string const &path, std::string const &filename, unsigned versions)
{
        //Delete oldest backupset
        std::string to_destroy = filename + "-" + Blex::AnyToString(versions) + ".*";
        if (!DeleteFiles(path,to_destroy))
            throw std::runtime_error("Cannot remove oldest backupset " + to_destroy);

        //Rotate all the others
        for (unsigned to_move = versions; to_move>0; --to_move)
        {
                //rename files-(to_move-1) to files-(to_move)
                std::string oldbasename = filename;
                if (to_move>1)
                    oldbasename += "-" + Blex::AnyToString(to_move-1);

                std::string newbasename = filename;
                newbasename += "-" + Blex::AnyToString(to_move);

                //generate a list of files to move
                std::vector<std::string> list_to_move;
                for (Blex::Directory diritr(path,oldbasename + ".*");diritr;++diritr)
                    list_to_move.push_back(diritr.CurrentFile());

                //do the move!
                for (std::vector<std::string>::const_iterator itr=list_to_move.begin();itr!=list_to_move.end();++itr)
                {
                        std::string suffix(itr->begin()+oldbasename.size(),itr->end());
                        std::string oldname = path + "/" + oldbasename + suffix;
                        std::string newname = path + "/" + newbasename + suffix;
                        if (!Blex::MovePath(oldname,newname))
                            throw std::runtime_error("Cannot rename " + oldname + " to " + newname);
                }
        }
}

bool BackupMain(WHCore::Connection &whconn, std::string const &backupfile, std::size_t maxfilelength, unsigned versions, bool progress, bool nohash, BlobMode::Type blobmode, bool compress, bool serial, std::string const &suspendfile, std::vector<std::string> const &skiptables)
{
        //Create the path if it doesn't exist
        std::string::const_iterator lastslash = std::find(backupfile.rbegin(),backupfile.rend(),'/').base();
        std::string path(backupfile.begin(), lastslash != backupfile.begin() ? lastslash-1 : backupfile.begin());
        std::string filename(lastslash,backupfile.end());

        if(path.empty())
            path = Blex::GetCurrentDir();
        else //ensure dir exists
            Blex::CreateDirRecursive(path,false);

        //Destroy current backup, if it wasn't finished (no MD5 file)
        if (!Blex::PathStatus(backupfile + ".md5").Exists() && !DeleteFiles(path,filename + ".*"))
        {
                std::cerr <<"Cannot remove last (incomplete) backupset " + backupfile + ".*\n";
                return false;
        }

        //Rotate only if the last backup was succesful
        if (Blex::PathStatus(backupfile + ".md5").Exists())
        {
                if(versions)
                {
                        Rotate(path,filename,versions);
                }
                else
                {
                        std::cerr << "A backup already exists and no rotation was specified\n";
                        return false;
                }
        }


        //ADDME: Perhaps dbaselocation parsing should be in the dbase tcp i/o code?
        std::shared_ptr<Database::TransactConnection> conn;
        conn.reset(whconn.GetDbase().BeginTransactConnection("backup"));

        std::shared_ptr<Database::TransFrontend> trans;
        trans.reset(conn->BeginTransaction("~backup","","backup",true/*readonly*/,false/*auto*/));

        if (!suspendfile.empty())
        {
                std::unique_ptr< Blex::FileStream > file(Blex::FileStream::OpenWrite(suspendfile, true, true, Blex::FilePermissions::PublicRead));
                if (!file.get())
                {
                        std::cerr << "Could not create new suspendfile '" << suspendfile << "'\n";
                        return false;
                }

                if (progress)
                    std::cerr << "Waiting for suspendfile to disappear... ";

                while (true)
                {
                        if (!Blex::PathStatus(suspendfile).Exists())
                            break;

                        Blex::SleepThread(250);
                }

                if (progress)
                    std::cerr << "done" << std::endl;
        }

        if (maxfilelength <= 0 || maxfilelength >= 650)
          maxfilelength = 650;

        return BuildBackup(*trans, backupfile, maxfilelength, progress, nohash, blobmode, compress, serial, skiptables)==0;
}

//---------------------------------------------------------------------------
Blex::OptionParser::Option optionlist[] =
{
  Blex::OptionParser::Option::StringOpt("dbroot"),
  Blex::OptionParser::Option::Switch("h", false),
  Blex::OptionParser::Option::Switch("c", false),
  Blex::OptionParser::Option::StringOpt("m"),
  Blex::OptionParser::Option::StringOpt("v"),
  Blex::OptionParser::Option::Switch("p",false),
  Blex::OptionParser::Option::Switch("s",false), // ignored
  Blex::OptionParser::Option::Switch("threads",false),
  Blex::OptionParser::Option::Switch("nohash",false),
  Blex::OptionParser::Option::Switch("noblobs",false),
  Blex::OptionParser::Option::StringOpt("blobmode"),
  Blex::OptionParser::Option::StringOpt("suspendfile"),
  Blex::OptionParser::Option::StringOpt("skiptables"),
  Blex::OptionParser::Option::Param("backupfile", true),
  Blex::OptionParser::Option::ListEnd()
};

int UTF8Main(std::vector<std::string> const &args)
{
        Blex::OptionParser optparse(optionlist);
        WHCore::Connection::AddOptions(optparse);

        if (!optparse.Parse(args) || optparse.Switch("h"))
        {
                Blex::ErrStream() << "Syntax: backup [-m maxsize] [-v versions] [-c] [-p] [--suspendfile file] backupfile";
                Blex::ErrStream() << "    -c: compress backup";
                Blex::ErrStream() << "    --threads: use multiple threads";
                Blex::ErrStream() << "    -p: show progress";
                Blex::ErrStream() << "    --suspendfile file: Create 'file', then wait while this file exists (done just after opening a transaction) for external blob synchronization process";
                Blex::ErrStream() << "    --blobmode Blob mode: ignore/reference/full";
                if (!optparse.GetErrorDescription().empty())
                    Blex::ErrStream() << optparse.GetErrorDescription();
                return EXIT_FAILURE;
        }


        std::string backupfile = optparse.Param("backupfile");

        std::size_t maxsize=0;
        if (optparse.Exists("m"))
        {
                std::string maxsize_string = optparse.StringOpt("m");
                std::pair<std::size_t,std::string::iterator> maxsize_val = Blex::DecodeUnsignedNumber<std::size_t>(maxsize_string.begin(),maxsize_string.end(),10);
                if (maxsize_val.second != maxsize_string.end() || maxsize_val.first == 0)
                {
                        Blex::ErrStream() << "Invalid maximum backup file size";
                        return EXIT_FAILURE;
                }
                maxsize=maxsize_val.first;
        }

        unsigned versions=0;
        if (optparse.Exists("v"))
        {
                std::string versions_string = optparse.StringOpt("v");
                std::pair<std::size_t,std::string::iterator> versions_val = Blex::DecodeUnsignedNumber<std::size_t>(versions_string.begin(),versions_string.end(),10);
                if (versions_val.second != versions_string.end() || versions_val.first == 0)
                {
                        Blex::ErrStream() << "Invalid versions count";
                        return EXIT_FAILURE;
                }
                versions=versions_val.first;
        }

        BlobMode::Type blobmode = BlobMode::Full;
        if (optparse.Switch("noblobs") && optparse.Exists("blobmode"))
        {
                Blex::ErrStream() << "--noblobs and --blobmode=mode are mutually exclusive";
                return EXIT_FAILURE;
        }

        if (optparse.Switch("noblobs"))
            blobmode = BlobMode::Ignore;
        else
        {
                if (optparse.StringOpt("blobmode") == "ignore")
                    blobmode = BlobMode::Ignore;
                else if (optparse.StringOpt("blobmode") == "reference")
                    blobmode = BlobMode::Reference;
                else if (optparse.StringOpt("blobmode") == "full" || optparse.StringOpt("blobmode") == "")
                    blobmode = BlobMode::Full;
                else
                {
                        Blex::ErrStream() << "Illegal blobmode '" << optparse.StringOpt("blobmode") << "', allowed are: full, ignore, reference";
                        return EXIT_FAILURE;
                }
        }

        std::vector<std::string> skiptables;
        Blex::TokenizeString(optparse.StringOpt("skiptables"), ',', &skiptables);

        WHCore::Connection conn(optparse, "backup", WHCore::WHManagerConnectionType::None);
        return BackupMain(conn, backupfile, maxsize, versions, optparse.Switch("p"), optparse.Switch("nohash"), blobmode, optparse.Switch("c"), !optparse.Switch("threads"), optparse.StringOpt("suspendfile"), skiptables) ? EXIT_SUCCESS : EXIT_FAILURE;
}

//---------------------------------------------------------------------------
int main(int argc, char *argv[])
{
        return Blex::InvokeMyMain(argc,argv,&UTF8Main);
}

