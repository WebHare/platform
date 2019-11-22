#include <ap/libwebhare/allincludes.h>


#include <blex/blexlib.h>
#include <map>
#include <sstream>

#include <blex/docfile.h>
#include <blex/utils.h>
#include <iostream>
#include <blex/path.h>

//---------------------------------------------------------------------------
std::map <std::string,unsigned> filenames;

const std::unique_ptr<Blex::Docfile> olearc;

/* Mappings of known property sets */
struct PropTypeMap
{
        unsigned id;
        const char *name;
};

uint8_t fid_documentsummaryinformation[16] = {0x02,0xD5,0xCD,0xD5,0x9C,0x2E,0x1B,0x10,0x93,0x97,0x08,0x00,0x2B,0x2C,0xF9,0xAE};
PropTypeMap ptm_documentsummaryinformation[]={
{ 0, "dictionary" }, //note: is dictionary of property map, not of document
{ 1, "codepage" }, //note: is codepage of property map, not of document
{ 2, "category" },
{ 3, "presentation format" },
{ 4, "byte count" },
{ 5, "line count" },
{ 6, "paragraph count" },
{ 7, "slide count" },
{ 8, "note count" },
{ 9, "hidden count" },
{ 10, "multimedia clip count" },
{ 11, "scale" },
{ 14, "manager" },
{ 15, "company" },
{ 16, "links dirty" },
{ 0, NULL }
};

uint8_t fid_summaryinformation[16] = {0xE0,0x85,0x9F,0xF2,0xF9,0x4F,0x68,0x10,0xAB,0x91,0x08,0x00,0x2B,0x27,0xB3,0xD9};
PropTypeMap ptm_summaryinformation[]={
{ 0, "dictionary" }, //note: is dictionary of property map, not of document
{ 1, "codepage" }, //note: is codepage of property map, not of document
{ 2, "title" },
{ 3, "subject" },
{ 4, "author" },
{ 5, "keywords" },
{ 6, "comments" },
{ 7, "template" },
{ 8, "last author" },
{ 9, "revision" },
{ 10, "total edittime" },
{ 11, "last printed" },
{ 12, "created" },
{ 13, "last saved" },
{ 14, "page count" },
{ 15, "word count" },
{ 16, "character count" },
{ 17, "thumbnail" },
{ 18, "application name" },
{ 19, "security" },
{ 0, NULL }
};

std::string FixName(std::string const &name)
{
        std::ostringstream fixedname;

        for (std::string::const_iterator ptr=name.begin();
             ptr != name.end();
             ++ptr)
        {
                char ch(*ptr);

                if (std::isalnum(ch) || ch=='-' || ch=='_')
                    fixedname << char(std::tolower(ch));
                else
                    fixedname << '_';
        }

        //Avoid any duplicate name
        unsigned namecounter = filenames[fixedname.str()];
        if (namecounter)
        {
                filenames[fixedname.str()] = namecounter+1;
                fixedname << '_' << namecounter;
        }

        return fixedname.str();
}

void ExplodeFile(std::string const &filename, Blex::Docfile::File const *file)
{
        std::cout << "Extracting " << filename << "... ";

        std::unique_ptr<Blex::Stream> infile( olearc->OpenOleFile(file) );
        std::unique_ptr<Blex::FileStream> outfile( Blex::FileStream::OpenWrite(filename,true,false,Blex::FilePermissions::PrivateRead) );
        if (!infile.get() || !outfile.get())
        {
                std::cout << "I/O error" << std::endl;
                return;
        }

        infile->SendAllTo(*outfile);
        std::cout << "done" << std::endl;
}

void ExplodeDir(Blex::Docfile::Directory const * dir);

void ProcessDir(std::string const &name, Blex::Docfile::Directory const *dir)
{
        std::cout << "Directory " << name << "...";
        if (!Blex::PathStatus(name).IsDir() && !Blex::CreateDir(name,true))
        {
                std::cout << "mkdir error\n";
                return;
        }
        std::cout << "ok\n";

        Blex::ChangeDir(name);
        ExplodeDir(dir);
        Blex::ChangeDir("..");
}

void ExplodeDir(Blex::Docfile::Directory const *dir)
{
        std::vector<std::string> files = olearc->GetFiles(dir);
        for (std::vector<std::string>::iterator itr=files.begin(); itr!=files.end(); ++itr)
            ExplodeFile(FixName(*itr),olearc->FindFile(dir,*itr));

        std::vector<std::string> dirs = olearc->GetDirectories(dir);
        for (std::vector<std::string>::iterator itr=dirs.begin(); itr!=dirs.end(); ++itr)
            ProcessDir(FixName(*itr),olearc->FindDirectory(dir,*itr));
}

void ExplodeArc(Blex::Docfile &infile, std::string const &outdir)
{
        std::cout << *olearc;

        Blex::CreateDirRecursive(outdir,false);
        Blex::ChangeDir(outdir);
        ExplodeDir(infile.GetRoot());
}

void DumpProp(Blex::OlePropertySet const &ops, unsigned storeid)
{
        switch(ops.GetType(storeid))
        {
        case Blex::OlePropertySet::V_SignedInteger:
                std::cout << ops.GetSigInteger(storeid);
                break;
        case Blex::OlePropertySet::V_UnsignedInteger:
                std::cout << ops.GetUnsInteger(storeid);
                break;
        case Blex::OlePropertySet::V_Float:
                std::cout<< ops.GetFloat(storeid);
                break;
        case Blex::OlePropertySet::V_DateTime:
                {
                        std::tm gmtime = ops.GetDateTime(storeid).GetTM();
                        std::cout << asctime(&gmtime);
                        break;
                }
        case Blex::OlePropertySet::V_String:
                {
                        std::string val = ops.GetString(storeid);
                        std::cout << "\"";
                        Blex::EncodeJava(val.begin(),val.end(),std::ostream_iterator<char,char>(std::cout));
                        std::cout << "\"";
                        break;
                }
        case Blex::OlePropertySet::V_Array:
                {
                        for (unsigned i=0;i<ops.GetArrayLength(storeid);++i)
                        {
                                std::cout << (i==0 ? '{' : ',');
                                DumpProp(ops, ops.GetArrayElement(storeid, i));
                        }
                        std::cout << '}';
                        break;
                }
        default:
                std::cout << "???";
                break;
        }
}

void DumpPropName(PropTypeMap const *cur, unsigned id, Blex::OlePropertySet::Section const &ops)
{
        Blex::OlePropertySet::Section::Dictionary::const_iterator propinfo = ops.dictionary.find(id);
        if(propinfo!=ops.dictionary.end())
        {
                std::cout << '\'' << propinfo->second<< '\'';
                return;
        }

        if (cur)
        {
                while(cur->name)
                {
                        if (cur->id == id) //found it
                        {
                                std::cout << '\'' << cur->name << '\'';
                                return;
                        }
                        ++cur;
                }
        }
        std::cout << '#' << id;
}

void DumpPropSet(Blex::OlePropertySet const &ops, unsigned num)
{
        Blex::OlePropertySet::Section const &sect = ops.GetSection(num);

        PropTypeMap const *propmap=NULL;
        if (std::equal(sect.format_id, sect.format_id+16, fid_documentsummaryinformation))
        {
                propmap = ptm_documentsummaryinformation;
                std::cout << "Office 95 compatible properties\n";
        }
        else if (std::equal(sect.format_id, sect.format_id+16, fid_summaryinformation))

        {
                propmap = ptm_summaryinformation;
                std::cout << "Office 97 properties\n"; //won't tell yet that it's actually OLE2 properties due to 'competitive' reasons expiring 2004 :-)
        }
        else
        {
                std::cout << "Unrecognized property type\n";
        }

        std::string uid;
        Blex::EncodeBase16(sect.format_id, sect.format_id+16, std::back_inserter(uid));

        std::cout << "Property format id: " << uid << "\n";
        typedef Blex::OlePropertySet::Section::PropertyMap PropMap;
        for (PropMap::const_iterator itr=sect.props.begin(); itr !=sect.props.end();++itr)
        {
                std::cout << "prop ";
                DumpPropName(propmap, itr->first, sect);
                std::cout << " type " << (int)ops.GetType(itr->second) << " value ";
                DumpProp(ops, itr->second);
                std::cout << "\n";
        }
}

void DumpPropsDir(Blex::Docfile &infile, Blex::Docfile::Directory const *dir)
{
        std::vector<std::string> files = infile.GetFiles(dir);
        for (std::vector<std::string>::iterator itr=files.begin(); itr!=files.end(); ++itr)
          if (!itr->empty() && itr->begin()[0]==5) //property set
        {
                std::string fullname = FixName(*itr);
                const std::unique_ptr<Blex::RandomStream> str(olearc->OpenOleFile(olearc->FindFile(dir,*itr)));
                Blex::OlePropertySet ops;
                if (!str.get() || !ops.ParseProperties(*str))
                {
                        std::cerr << "Cannot parse property set " << fullname << "\n";
                }
                else
                {
                        std::cout << "Property set: " << FixName(*itr) << "\n";
                        for (unsigned i=0;i <ops.GetNumSections();++i)
                            DumpPropSet(ops, i);
                }
        }
}

void DumpProps(Blex::Docfile &infile)
{
        DumpPropsDir(infile,infile.GetRoot());
}

int UTF8Main(std::vector<std::string> const &args)
{
        if (args.size()<2)
        {
                std::cerr << "Syntax: oleexplode <file to explode> [outdir]\n";
                return EXIT_FAILURE;
        }
        std::cout << "Will explode: " << args[1] << '\n';

        const std::unique_ptr<Blex::RandomStream> infile;
        infile.reset(Blex::FileStream::OpenRead(args[1]));
        if (!infile.get())
            throw std::runtime_error("Cannot open file");

        olearc.reset(new Blex::Docfile(*infile));
        if (args.size()>=3)
            ExplodeArc(*olearc, args[2]);
        else
            DumpProps(*olearc);
        return EXIT_SUCCESS;
}

int main(int argc, char *argv[])
{
        return Blex::InvokeMyMain(argc,argv,&UTF8Main);
}

#define WinMain
