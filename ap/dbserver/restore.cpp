#include <ap/libwebhare/allincludes.h>


//------------------------------------------------------------------------------
#include <blex/path.h>
#include <blex/getopt.h>
#include <blex/logfile.h>
#include "dbase_trans.h"
#include "dbase_diskio.h"
#include <blex/stream.h>
#include <blex/parityfile.h>
#include <blex/zstream.h>
#include <iostream>
#include <iomanip>

#include "restore.h"

std::set<Database::BlobId> missing_blob_ids;

// -----------------------------------------------------------------------------
//
// Header
//
unsigned ReadHeader(Blex::Stream &stream)
{
        unsigned headerstart = stream.ReadLsb<uint32_t>();
        if (headerstart != Database::Backup::StrBBeg)
            throw std::runtime_error("This is not a webhare backup file");
        unsigned fileversion = stream.ReadLsb<uint32_t>();
        if ((fileversion & -4) != Database::Backup::FileVersion)
            throw std::runtime_error("This backup file was created with another, incompatible file layout");

        return fileversion;
}

void ReadTable(Blex::Stream &stream, Database::TableId *tableid, std::string *tablename, std::vector<Database::ColumnId> *allcolumns, std::vector<Database::ColumnId> *blobcolumns)
{
        *tableid = stream.ReadLsb<uint32_t>();
        tablename->resize(stream.ReadLsb<uint32_t>());
        stream.Read(&(*tablename)[0],tablename->size());

        blobcolumns->resize(stream.ReadLsb<uint32_t>());
        for (unsigned i=0;i<blobcolumns->size();++i)
            (*blobcolumns)[i]=uint16_t(stream.ReadLsb<uint32_t>());

        allcolumns->resize(stream.ReadLsb<uint32_t>());
        for (unsigned i=0;i<allcolumns->size();++i)
            (*allcolumns)[i]=uint16_t(stream.ReadLsb<uint32_t>());
}

// -----------------------------------------------------------------------------
//
// Record
//
void ReadRecord(Blex::Stream &stream, Database::WritableRecord *record, std::vector<Database::ColumnId> const &allcolumns)
{
        std::vector<uint8_t> data;

        for (unsigned idx = 0; idx < allcolumns.size(); ++idx)
        {
                Database::ColumnId colid = allcolumns[idx];
                uint16_t size = stream.ReadLsb<uint16_t>();

                if (size)
                {
                        data.resize(size);
                        stream.Read(&data[0], size);
                        record->SetColumn(colid, size, &data[0]);
                }
        }
}

// -----------------------------------------------------------------------------
//
// Blob
//
//
Database::BlobId ReadBlob(Blex::Stream &stream, Database::BlobUser *blobuser, Database::BlobId *blobid, Blex::FileOffset *filelen)
{
        uint64_t blob_read_id = stream.ReadLsb<uint64_t>();
        if(blob_read_id >= std::numeric_limits<uint32_t>::max())
            throw std::runtime_error("This database does not support >4 billion blobs");

        *blobid = uint32_t(blob_read_id);
        Blex::FileOffset size = stream.ReadLsb<uint64_t>();

        if(missing_blob_ids.count(*blobid) == 1)
        {
                 Blex::ErrStream() << "Skipping blob with id " << (*blobid);
                 return 0;
        }

//        Blex::ErrStream() << "Blob with id " << blobid << " of length " << size;
        Database::BlobId retval = 0;

        if (blobuser)
        {
                retval = blobuser->StoreBlob(size,stream, *blobid);
                *filelen = size;
        }
        else
        {
                Blex::NullStream nullstream;
                stream.LimitedSendTo(size,nullstream);
        }
        return retval;
}

Database::BlobId ImportBlob(Database::BlobUser *blobuser, std::string const &importfolder, BlobImportMode::Type blobimportmode, Database::BlobId blobid, Blex::FileOffset bloblength)
{
        if(missing_blob_ids.count(blobid) == 1)
        {
                 Blex::ErrStream() << "Skipping import of blob with id " << blobid;
                 return 0;
        }

        std::string filename = Database::GetBlobDiskpath(importfolder, blobid, false);

        DEBUGPRINT("Importing blob " << blobid << " from '" << filename << "'");

        if (blobimportmode != BlobImportMode::SoftLink)
        {
                Blex::PathStatus status(filename);
                if (!status.Exists())
                {
                        std::cerr << "Cannot import blob " << blobid << " from '" << filename << "', it does not exist\n";
                        return 0;
                }
                if (bloblength != 0 && bloblength != status.FileLength())
                {
                        std::cerr << "Blob '" << filename << "' has wrong length, expected " << bloblength << ", actual: " << status.FileLength() << ", skipping\n";
                        return 0;
                }
        }

        Database::BlobId retval = 0;

        if (blobuser)
        {
                if (blobimportmode == BlobImportMode::Copy)
                {
                          std::unique_ptr< Blex::FileStream > stream(Blex::FileStream::OpenRead(filename));
                          if (!stream.get())
                          {
                                  std::cerr << "Could not open blob file '" << filename << "'\n";
                                  return 0;
                          }
                          if (stream->GetFileLength() != bloblength)
                          {
                                  std::cerr << "After opening, blob '" << filename << "' has wrong length, expected " << bloblength << ", actual: " << stream->GetFileLength() << ", skipping\n";
                                  return 0;
                          }

                          retval = blobuser->StoreBlob(bloblength, *stream, blobid);
                }
                else
                    retval = blobuser->RestoreBlobFile(filename, blobimportmode == BlobImportMode::HardLink, blobid);
        }

        return retval;
}

bool RunTheRestore (std::string const &restorefile, std::string const &restoreto_base, std::string const &restoreto_records, std::string blobsource, BlobImportMode::Type blobimportmode, Blex::ParityFile::ErrorCallback const &errorcallback)
{
        // Open the backup file
//        ReadOpener ropener(restorefile);
//        const std::unique_ptr<SplittedStream> backup;
//        backup.reset(SplittedStream::Open(ropener, 0));

        const std::unique_ptr< Blex::ParityFile > backup(Blex::ParityFile::OpenRead(restorefile, errorcallback));

        //Calculate total size of the backup file
        Blex::FileOffset totalsize=0;
        for (unsigned i=0;i<999;++i)
        {
                std::string number("000" + Blex::AnyToString(i));
                std::string backupname = restorefile+ ".bk" + std::string(number.end()-3,number.end());

                Blex::PathStatus status(backupname);
                if (!status.Exists())
                    break;

                totalsize += status.FileLength();
        }

        Blex::Stream *stream = backup.get();

        unsigned version = ReadHeader(*stream);

        std::unique_ptr< Blex::ZlibDecompressStream > dstream;
        if (version & Database::Backup::CompressedFlag)
        {
                dstream.reset(Blex::ZlibDecompressStream::OpenGzip(*stream));
                stream = dstream.get();
        }
        if ((version & Database::Backup::ExternalBlobFlag) && blobimportmode != BlobImportMode::Ignore)
        {
                if(blobsource.empty()) //guess blob location, try ../blob/ or blob/
                {
                        std::string backupbase = Blex::GetDirectoryFromPath(restorefile);
                        std::string trypath = Blex::CollapsePathString(backupbase + "/blob/");
                        if(!Blex::PathStatus(trypath).IsDir())
                        {
                                trypath = Blex::CollapsePathString(backupbase + "/../blob/");
                                if(!Blex::PathStatus(trypath).IsDir())
                                {
                                        std::cerr << "Backup was created with --blobmode=reference, --blobsource or --blobimportmode=ignore is required at import\n";
                                        return false;
                                }
                                else
                                {
                                        blobsource = Blex::CollapsePathString(backupbase + "/../");
                                }
                        }
                        else
                        {
                                blobsource = backupbase;
                        }
                }
                else
                {
                        if(!Blex::PathStatus(blobsource + "/blob").IsDir())
                        {
                                std::cerr << "Directory " + blobsource + " does not seem to contain a 'blob' folder\n";
                                return false;
                        }
                }

                if(blobimportmode == BlobImportMode::FromBackup)
                        blobimportmode = BlobImportMode::Copy;
        }


        if (!(version & Database::Backup::ExternalBlobFlag) && !blobsource.empty())
        {
                std::cerr << "Backup was not created with --blobmode=reference, --blobsource is not allowed at import\n";
                return false;
        }
        if (!(version & Database::Backup::ExternalBlobFlag) && blobimportmode != BlobImportMode::FromBackup && blobimportmode != BlobImportMode::Ignore)
        {
                std::cerr << "Backup was not created with --blobmode=reference, --blobimportmode can only be 'ignore'\n";
                return false;
        }

        //Tell what we're doing
        std::cout << "Restoring backup from " << restorefile << "\n";
        bool countblobs=false;
        switch(blobimportmode)
        {
                case BlobImportMode::HardLink:
                        std::cout << "Hardlinking blobs from " << blobsource << "\n";
                        countblobs=true;
                        break;
                case BlobImportMode::SoftLink:
                        std::cout << "Softlinking blobs from " << blobsource << ", no checking\n";
                        countblobs=true;
                        break;
                case BlobImportMode::SoftLinkVerify:
                        std::cout << "Softlinking blobs from " << blobsource << ", verifies blobs\n";
                        countblobs=true;
                        break;
                case BlobImportMode::Copy:
                        std::cout << "Copying blobs from " << blobsource << "\n";
                        countblobs=true;
                        break;
                case BlobImportMode::FromBackup:
                        std::cout << "Extracting blobs from backup files\n";
                        break;
                default:
                        std::cout << "Ignoring blobs\n";
                        break;
        }
        std::cout << "Restoring backup to " << restoreto_base << "\n" << std::endl;
        if(restoreto_records != restoreto_base)
                std::cout << "with records to " << restoreto_records << "\n" << std::endl;

        std::unique_ptr<Database::RawDatabase> rawdb;
        bool null_restore = restoreto_base=="/dev/null"; //used for benchmarking only
        if (!null_restore)
        {
                Blex::CreateDirRecursive(restoreto_base,false/*private*/);
                rawdb.reset(new Database::RawDatabase(restoreto_base, restoreto_records, /*new_database=*/true,/*recovery_mode=*/false,/*savedeletedblobs=*/false,/*sync=*/false));
        }

        Database::TableId curtableid;
        std::vector<Database::ColumnId> blob_column_ids;
        std::vector<Database::ColumnId> all_column_ids;

        unsigned lastpercentage = 9999, lastmb = 0; //set lastpercentage to 9999 to force a first progress indicatdion
        std::map<Database::BlobId, Database::BlobId> blobtranslation;
        std::map<Database::BlobId, Blex::FileOffset> bloblengths;

        Blex::SectionUpdateHistory commits;
        std::unique_ptr<Database::BlobUser> blobuser;
        if (rawdb.get() && blobimportmode != BlobImportMode::Ignore)
            blobuser.reset(new Database::BlobUser(rawdb->GetBlobMgr()));

        Blex::DateTime start = Blex::DateTime::Now();
        Database::WritableRecord crec;
        Database::RecordId lastrecordid(0);
        uint64_t numblobs=0, lastblobs=0, restoredblobsize=0;

        while (true)
        {
                uint32_t header = stream->ReadLsb<uint32_t>();

                unsigned curpercentage = unsigned(backup->GetTotalInputBytes() * 100 / totalsize);
                unsigned dbmb = unsigned( (backup->GetTotalInputBytes() ) /1048576);
                unsigned curmb = unsigned( (backup->GetTotalInputBytes() + restoredblobsize) /1048576);
                if (lastpercentage!=curpercentage || lastmb != curmb || (countblobs && lastblobs!=numblobs))
                {
                        uint32_t timepassed = (Blex::DateTime::Now() - start).GetMsecs();
                        float speed = timepassed ? (dbmb*1.0 / timepassed) : 0;
                        uint32_t timeremaining = speed ? uint32_t(((totalsize-backup->GetTotalInputBytes())/1048576) / speed) : 0;

                        std::cout << curpercentage << "%, "
                                  << curmb << " MB. ";
                        if(countblobs)
                            std::cout << numblobs << " blobs. ";

                        std::cout << std::setw(5) << std::setfill(' ') << std::right << std::showpoint << std::setprecision(3) << (speed*1000) << " MB/s. "
                                  << "Running: "
                                  << (timepassed/60000) << ":" << std::setw(2) << std::setfill('0') << ((timepassed/1000)%60) << ". ";
                        if (speed)
                           std::cout << "Remaining: "
                                    << (timeremaining/60000) << ":" << std::setw(2) << std::setfill('0') << ((timeremaining/1000)%60) << ".";
                        std::cout << "          \r" << std::flush;
                        lastpercentage=curpercentage;
                        lastmb=curmb;
                        lastblobs=numblobs;
                }

                switch (header)
                {
                case Database::Backup::StrTabl:
                        {
                                std::string tablename;
                                ReadTable(*stream, &curtableid, &tablename, &all_column_ids, &blob_column_ids);
                                lastrecordid = 0;
                                DEBUGPRINT("Switch to table " << tablename << " blob cols: " << blob_column_ids.size());
                                break;
                        }
                case Database::Backup::StrBlob:
                        {
                                Database::BlobId oldid;
                                Blex::FileOffset bloblength = 0;

                                Database::BlobId newid = ReadBlob(*stream, blobuser.get(), &oldid, &bloblength);
                                if (newid)
                                {
                                        blobtranslation[oldid] = newid;
                                        bloblengths[oldid] = bloblength;
                                }
                                break;
                        }
                case Database::Backup::StrRecd:
                        {
                                crec.Clear();
                                ReadRecord(*stream, &crec, all_column_ids);

                                for (std::vector<Database::ColumnId>::const_iterator it = blob_column_ids.begin(); it != blob_column_ids.end(); ++it)
                                {
                                        if (blobimportmode == BlobImportMode::Ignore)
                                        {
                                                crec.DeleteColumn(*it);
                                                continue;
                                        }

                                        Database::BlobId orgblobid = crec.GetCell(*it).Blob();
                                        Blex::FileOffset bloblength = crec.GetCell(*it).BlobLength();

                                        if (!orgblobid && !bloblength)
                                            continue;

                                        Database::BlobId blobid = blobtranslation[orgblobid];

                                        if (blobid == 0 && !blobsource.empty())
                                        {
                                                  blobid = ImportBlob(blobuser.get(), blobsource, blobimportmode, orgblobid, bloblength);
                                                  if (!blobid)
                                                  {
                                                          // No such blob, remove column
                                                          crec.DeleteColumn(*it);
                                                          continue;
                                                  }

                                                  blobtranslation[orgblobid] = blobid;
                                                  bloblengths[orgblobid] = bloblength;
                                        }
                                        else
                                        {
                                                bloblength = bloblengths[orgblobid];
                                        }

                                        if (blobid && bloblength == 0)
                                        {
                                                errorcallback("Reference to non-existing blob " + Blex::AnyToString(blobid));
                                        }
                                        else
                                        {
                                                ++numblobs;
                                                if(blobimportmode == BlobImportMode::Copy)
                                                        restoredblobsize += bloblength;
                                        }
                                        crec.SetBlobAndLength(*it, blobid, bloblength);
                                }
                                if (rawdb.get())
                                {
                                        // Put the record in the same section as the last written record, or a new section if it doesn't fit there
                                        // It might have fitted in an earlier section, but avoiding GetSectionWithFreeRoom is worth a lot for restore speed.
                                        lastrecordid = rawdb->WriteNewRecord(curtableid, crec, lastrecordid, true, Database::TransStateMgr::AlwaysCommitted, commits);
                                }
                                break;
                        }
                case Database::Backup::StrBEnd:
                        break;
                default:
                        throw std::runtime_error("Backup file corrupt (marker missing)");
                }
                if (header == Database::Backup::StrBEnd)
                    break;
        }

        rawdb->Close();

        uint32_t timepassed = (Blex::DateTime::Now() - start).GetMsecs();
        unsigned curmb = unsigned(backup->GetTotalInputBytes()/1048576);
        float speed = timepassed ? (curmb*1.0 / timepassed) : 0;
        std::cout << "100%, "
                  << curmb << " MB. "
                  << std::setw(5) << std::setfill(' ') << std::right << std::showpoint << std::setprecision(3) << (speed*1000) << " MB/s. "
                  << "Running: "
                  << (timepassed/60000) << ":" << std::setw(2) << std::setfill('0') << ((timepassed/1000)%60) << ". ";
        if (speed)
           std::cout << "Remaining: 0:00.";
        std::cout << std::endl;
        return true;
}

namespace
{
void OnError(std::string const &str, bool *errorflag)
{
        Blex::ErrStream() << str;
        *errorflag=true;
}
} // End of anonymous namespace

bool RunRestore (std::string const &restorefile, std::string const &restoreto_base, std::string const &restoreto_records, std::string const &missingblobs, std::string const &my_blobsource, BlobImportMode::Type blobimportmode)
{
        bool errorflag = false;
        if(!missingblobs.empty())
        {
                std::vector<std::string> toks;
                Blex::TokenizeString(missingblobs,',',&toks);
                for(unsigned i=0;i<toks.size();++i)
                    missing_blob_ids.insert(std::atoi(toks[i].c_str()));
        }

        bool null_restore = restoreto_base=="/dev/null"; //used for benchmarking only

        if (!null_restore && Blex::PathStatus(restoreto_base).Exists())
        {
                Blex::ErrStream() << "The directory " << restoreto_base << " already exists";
                Blex::ErrStream() << "The restore option cannot overwrite an existing (database) directory";
                return false;
        }

        // Make sure blobsource ends in '/' for existance check
        std::string blobsource(my_blobsource);
        if (!blobsource.empty() && blobsource[blobsource.size() - 1] != '/')
            blobsource.push_back('/');

        if (blobsource != "" && !Blex::PathStatus(blobsource).Exists())
        {
                Blex::ErrStream() << "Cannot open blob import folder " << blobsource;
                return false;
        }

        // Remove last '/' from blobsource, importdir must not end in '/'
        if (!blobsource.empty())
            blobsource.resize(blobsource.size()-1);

        try
        {
                if(!RunTheRestore(restorefile, restoreto_base, restoreto_records, blobsource, blobimportmode, std::bind(&OnError, std::placeholders::_1, &errorflag) ))
                        return false;
        }
        catch(std::runtime_error &e)
        {
                Blex::ErrStream(); //empty line
                Blex::ErrStream() << "Fatal error restoring the database backup: " << e.what();
                Blex::ErrStream() << "Contact your reseller if you need assistance recovering this backup";
                return false;
        }
        if (errorflag)
        {
                Blex::ErrStream(); //empty line
                Blex::ErrStream() << "Errors occured but have been repaired.";
                Blex::ErrStream() << "Please ensure that MD5 hashes of generated backups are always verified";
        }
        return true;
}
