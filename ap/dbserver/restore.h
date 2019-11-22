#ifndef blex_webhare_dbase_restore
#define blex_webhare_dbase_restore

namespace BlobImportMode
{
enum Type
{
        FromBackup,
        HardLink,
        SoftLink,
        SoftLinkVerify,
        Copy,
        Ignore
};
}

bool RunRestore (std::string const &restorefile, std::string const &restoreto_base, std::string const &restoreto_records, std::string const &missingblobs, std::string const &blobsource, BlobImportMode::Type blobimportmode);

//---------------------------------------------------------------------------
#endif
