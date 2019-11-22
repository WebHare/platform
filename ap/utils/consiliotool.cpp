#include <ap/libwebhare/allincludes.h>


#include <iostream>
#include <blex/path.h>
#include <blex/unicode.h>
#include <blex/stream.h>
#include <blex/getopt.h>
#include <blex/complexfs.h>
#include <blex/utils.h>


#include "../consilio/ctokenstream.h"
#include "../consilio/indexreader.h"
#include "../consilio/cache.h"

#include <set>
#include "../consilio/consilio.h" //Need the IndexFs and CacheFs settings

#include "../consilio/searcher.h"
#include "../consilio/booleanquery.h"
#include "../consilio/termquery.h"

std::string ReadString(Blex::RandomStream &stream)
{
        uint32_t length = stream.ReadMsb<uint32_t>();

        std::string value;
        value.resize(length);
        stream.Read(&value[0], length);
        return value;
}

void DumpIndexTerms(std::string const &index, bool withpositions)
{
        Blex::Mutex commit_lock;
        const std::unique_ptr<Blex::ComplexFileSystem> directory;
        const std::unique_ptr<Lucene::IndexReader> reader;
        SegmentsCache cache;

        directory.reset(new Blex::ComplexFileSystem(Blex::MergePath(index,"searchindex"), false, Blex::ComplexFileSystem::BufferWrites));
        reader.reset(Lucene::IndexReader::Open(commit_lock, *directory, cache));

        const std::unique_ptr<Lucene::TermEnum> te(reader->Terms());
        const std::unique_ptr<Lucene::TermDocs> td;
        while (te->Next())
        {
                Lucene::Term t = te->GetTerm();
                std::cout << t.ToString();

                if (withpositions)
                {
                        std::cout << " - ";
                        td.reset(reader->GetTermPositions(t));

                        bool first = true;
                        while (td->Next())
                        {
                                if (!first)
                                    std::cout << ", ";
                                else
                                    first = false;

                                uint32_t freq = td->Freq();
                                std::cout << td->Doc() << ": " << freq << " (";
                                for (uint32_t i = 0; i < freq; ++i)
                                    std::cout << (i > 0 ? ", " : "") << td->NextPosition();
                                std::cout << ")";
                        }
                }

                std::cout << "\n";
        }
}

void DumpCache(std::string const &index, bool makewordlist, bool makeurllist)
{
        std::set<std::string> wordlist;
        std::set<std::string> urllist;

        Blex::ComplexFileSystem input(Blex::MergePath(index,"searchcache"), false, Blex::ComplexFileSystem::BufferWrites);//, false, CacheFs_BlockSize, CacheFs_BlocksPerFile, CacheFs_CacheSize, CacheFs_EntriesPerFatPage, false);
        std::vector<std::string> files = input.ListDirectory("*");
//        input.ExportDirectory(std::bind(&std::vector<std::string>::push_back, &files, std::placeholders::_1));

        for (unsigned i=0;i<files.size();++i)
        {
                //open file
                std::shared_ptr<Blex::RandomStream> cachefile(input.OpenFile(files[i],false,false));
                if (!cachefile.get())
                    return;

                if (!makewordlist && !makeurllist)
                {
                        std::cout << "\n*** " << files[i] << " ***\n";
                }

                //read through fields
                std::string fieldname = ReadString(*cachefile);
                std::string url;
                while (!fieldname.empty())
                {
                        if (makeurllist && fieldname == "url")
                            urllist.insert(ReadString(*cachefile));
                        else if (!makewordlist && !makeurllist)
                            std::cout << "  " << fieldname << ":" << ReadString(*cachefile);
                        else
                            ReadString(*cachefile);//skip fieldvalue
                        fieldname = ReadString(*cachefile);
                }

                //open buffered stream to read characters
                //read words
                const std::unique_ptr<Lucene::NormalizedTokenStream> cachestream(new Lucene::StemmedTokenStream(cachefile.get()));
                Lucene::ConsilioToken token = cachestream->Next();
                while (token.valid)
                {
                        //insert normalized and stemmed words into wordlist
                        if (token.type == Lucene::ConsilioToken::Word)
                        {
                                if (makewordlist)
                                    wordlist.insert(token.normalizedterm);
                        }

                        //print all other text (including non-normalized and non-stemmed words)
                        if (!(makewordlist || makeurllist))
                            std::cout << token.term << "\n    ";

                        token = cachestream->Next();
                }
        }

        if (makewordlist)
            for (std::set<std::string>::iterator it = wordlist.begin(); it != wordlist.end(); ++it)
                std::cout << *it << "\n";

        if (makeurllist)
            for (std::set<std::string>::iterator it = urllist.begin(); it != urllist.end(); ++it)
                std::cout << *it << "\n";
}

void DumpCacheWords(std::string const &index)
{
        DumpCache(index,true,false);
}
void DumpCacheUrls(std::string const &index)
{
        DumpCache(index,false,true);
}

void ImportFS(std::string basename, std::string import_from_dir)
{
        if (import_from_dir.empty())
            throw std::runtime_error("You must specify a source directory");

        Blex::ComplexFileSystem output(basename, true, Blex::ComplexFileSystem::BufferAll);
        for (Blex::Directory dir(import_from_dir,"*");dir;++dir)
        {
                //open file
                std::shared_ptr<Blex::RandomStream> cachefile(Blex::FileStream::OpenRead(dir.CurrentPath()));
                if (!cachefile.get())
                    continue;

                //output it!
                std::shared_ptr<Blex::RandomStream> outputstream(output.OpenFile(dir.CurrentFile(), true, true));
                if (outputstream.get())
                    cachefile->SendAllTo(*outputstream);
                else
                    throw std::runtime_error("Cannot create output file " + dir.CurrentFile());
        }
        output.Flush();
}

void ExportFS(std::string basename, std::string export_to_dir)
{
        if (export_to_dir.empty())
            throw std::runtime_error("You must specify a destination directory");

        Blex::CreateDirRecursive(export_to_dir,true);
        Blex::ComplexFileSystem input(basename, false, Blex::ComplexFileSystem::BufferAll);//, false, blocksize, blocksperfile, cachesize, entriesperfatpage,false);

        std::vector<std::string> files = input.ListDirectory("*");
//        input.ExportDirectory(std::bind(&std::vector<std::string>::push_back, &files, std::placeholders::_1));

        for (unsigned i=0;i<files.size();++i)
        {
                //open file
                std::shared_ptr<Blex::RandomStream> cachefile(input.OpenFile(files[i],false,false));
                if (!cachefile.get())
                    return;
                //output it!
                std::shared_ptr<Blex::RandomStream> output(Blex::FileStream::OpenWrite(Blex::MergePath(export_to_dir, files[i]),true,true,Blex::FilePermissions::PublicRead));
                if (output.get())
                    cachefile->SendAllTo(*output);
                else
                    throw std::runtime_error("Cannot create output file " + files[i]);
        }
}
void ImportIndexFS(std::string const &indexdir, std::string const &import_from_dir)
{
        ImportFS(Blex::MergePath(indexdir,"searchindex"), import_from_dir);
}
void ImportCacheFS(std::string const &indexdir, std::string const &import_from_dir)
{
        ImportFS(Blex::MergePath(indexdir,"searchcache"), import_from_dir);
}
void ExportIndexFS(std::string const &indexdir, std::string const &export_to_dir)
{
        ExportFS(Blex::MergePath(indexdir,"searchindex"), export_to_dir);
}
void ExportCacheFS(std::string const &indexdir, std::string const &export_to_dir)
{
        ExportFS(Blex::MergePath(indexdir,"searchcache"), export_to_dir);
}

// Specialized copy of the consilio_conn.cpp function
bool ReadCacheFile(Blex::ComplexFileSystem &cachefs,
                   const std::string &filename,
                   std::map<std::string, std::string> * req_fields)
{
        const std::unique_ptr<Blex::ComplexFileStream> cachestream(cachefs.OpenFile(filename, false, false));
        if (!cachestream.get())
            return false;

        std::string fieldname = cachestream->ReadLsb<std::string>();
        while (!fieldname.empty())
        {
                (*req_fields)[fieldname] = cachestream->ReadLsb<std::string>();
                fieldname = cachestream->ReadLsb<std::string>();
        }
        return true;
}

typedef std::pair<int32_t, float> scoredoc;
typedef std::map<std::string, std::vector<scoredoc> > termsmap;

class docfields
{
    public:
        docfields()
        : url(""), title(""), description("")
        { }

        docfields(std::string const &_url, std::string const &_title, std::string const &_description)
        : url(_url), title(_title), description(_description)
        { }

        std::string url;
        std::string title;
        std::string description;
};
typedef std::map<int32_t, docfields> docsmap;

// Boost factors for different types of query terms
const float title_boost = 5;
const float keywords_boost = 10;
const float description_boost = 5;
const float body_boost = 1;

void ExportIndexToJS(std::string const &index, std::string const &index_to_export, std::string const &export_to_file, unsigned limit, std::string const &baseurl, std::vector<std::string> const &excludelist)
{
        // Create output file
        const std::unique_ptr<Blex::RandomStream> outfile(Blex::FileStream::OpenWrite(export_to_file, true, false, Blex::FilePermissions::PublicRead));
        if (!outfile.get())
        {
                std::cout << "Could not create output file " << export_to_file << "\n";
                return;
        }
        outfile->SetFileLength(0);

        std::cout << "Exporting index " << index_to_export << " to JavaScript file " << export_to_file << "...\n";

        Blex::Mutex commit_lock;
        // Open index FS
        const std::unique_ptr<Blex::ComplexFileSystem> indexfs;
        indexfs.reset(new Blex::ComplexFileSystem(Blex::MergePath(index,"searchindex"), false, Blex::ComplexFileSystem::BufferWrites));
        // Open cache FS
        const std::unique_ptr<Blex::ComplexFileSystem> cachefs;
        cachefs.reset(new Blex::ComplexFileSystem(Blex::MergePath(index,"searchcache"), false, Blex::ComplexFileSystem::BufferAll));

        // Create term reader and index searcher
        SegmentsCache cache;
        const std::unique_ptr<Lucene::IndexReader> reader(Lucene::IndexReader::Open(commit_lock, *indexfs, cache));
        const std::unique_ptr<Lucene::IndexSearcher> searcher(new Lucene::IndexSearcher(commit_lock, *indexfs, cache));

        termsmap terms;
        docsmap docs;

        const std::unique_ptr<Lucene::TermEnum> te(reader->Terms());
        unsigned totalterms=0;
        while (te->Next() && (limit == 0 || totalterms < limit))
            ++totalterms;

        te.reset(reader->Terms());
        std::shared_ptr<Lucene::BooleanQuery> query;

        for(unsigned count=0; te->Next() && (limit == 0 || count < limit); ++count)
        {
                Lucene::Term t = te->GetTerm();

                // We're only interested in body and title terms
                if (t.Field() == "body" || t.Field() == "title")
                {
                        std::string text = t.Text();

                        // Check if we already indexed this term
                        if (terms.count(text) > 0)
                            continue;

                        // Create a query to search for this term in the requested index
                        query.reset(new Lucene::BooleanQuery());
                        query->Add(std::shared_ptr<Lucene::Query>(new Lucene::TermQuery(Lucene::Term("indexid", index_to_export))), true, false);

                        std::shared_ptr<Lucene::BooleanQuery> searchterm(new Lucene::BooleanQuery());

                        // Search title
                        Lucene::TermQuery * subquery = new Lucene::TermQuery(Lucene::Term("title", text));
                        subquery->SetBoost(title_boost);
                        searchterm->Add(std::shared_ptr<Lucene::Query>(subquery), false, false);

                        // Search keywords
                        subquery = new Lucene::TermQuery(Lucene::Term("keywords", text));
                        subquery->SetBoost(keywords_boost);
                        searchterm->Add(std::shared_ptr<Lucene::Query>(subquery), false, false);

                        // Search description
                        subquery = new Lucene::TermQuery(Lucene::Term("description", text));
                        subquery->SetBoost(description_boost);
                        searchterm->Add(std::shared_ptr<Lucene::Query>(subquery), false, false);

                        // Search body text
                        subquery = new Lucene::TermQuery(Lucene::Term("body", text));
                        subquery->SetBoost(body_boost);
                        searchterm->Add(std::shared_ptr<Lucene::Query>(subquery), false, false);

                        query->Add(searchterm, true, false);

                        // Search for the query
                        const std::unique_ptr<Lucene::Hits> hits(searcher->Search(query));
                        int32_t numdocs = hits->size();
                        if (numdocs > 0)
                        {
                                std::vector<scoredoc> scoredocs;

                                for (int32_t i = 0; i < numdocs; ++i)
                                {
                                        // Read relevant cache fields
                                        std::map<std::string, std::string> cachefields;
                                        if (ReadCacheFile(*cachefs, hits->Doc(i)->Get("id"), &cachefields))
                                        {
                                                std::string url = cachefields["objectid"];
                                                if (url.size() < baseurl.size()
                                                    || Blex::StrCaseCompare<std::string::const_iterator>(url.begin(), url.begin()+baseurl.size(), baseurl.begin(), baseurl.end()) != 0)
                                                {
                                                        std::cout << "Outside base: " << url << "\n";
                                                        continue;
                                                }
                                                url.assign(url.begin() + baseurl.size(), url.end());

                                                bool exclude=false;
                                                for(unsigned j=0;j<excludelist.size();++j)
                                                   if(Blex::StrCaseLike(url,excludelist[j]))
                                                {
                                                        std::cout << "Excluded: " << url << "\n";
                                                        exclude=true;
                                                        break;
                                                }
                                                if(exclude)
                                                    continue;

                                                scoredocs.push_back(std::make_pair(hits->Id(i   ),hits->Score(i)));
                                                docs[hits->Id(i)] = docfields(url, cachefields["title"], cachefields["description"]);
                                        }
                                }

                                if (scoredocs.size() > 0)
                                    terms[text] = scoredocs;
                        }
                }
                std::cout << count << "/" << totalterms << "\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b" << std::flush;
        }

        // Write terms
        outfile->WriteString("var consilio_terms=[");
        bool first_term = true;
        std::string line;
        for (termsmap::iterator term = terms.begin(); term != terms.end(); ++term)
        {
                line.clear();
                if (!first_term)
                    line+=',';
                else
                    first_term = false;

                line+="{term:'";
                Blex::EncodeJava(term->first.begin(), term->first.end(), std::back_inserter(line));
                line+="',docs:[";

                bool first_doc = true;
                for (std::vector<scoredoc>::iterator doc = term->second.begin(); doc != term->second.end(); ++doc)
                {
                        if (!first_doc)
                            line+=',';
                        else
                            first_doc = false;

                        line+="{doc:";
                        Blex::AppendAnyToString(doc->first, &line);
                        line+=",score:";
                        Blex::AppendAnyToString(doc->second, &line);
                        line+='}';
                }

                line+="]}";
                outfile->WriteString(line);
        }
        outfile->WriteString("];");

        // Write docs
        outfile->WriteString("var consilio_docs={");
        bool first_doc = true;
        for (docsmap::iterator doc = docs.begin(); doc != docs.end(); ++doc)
        {
                line.clear();
                if (!first_doc)
                    line += ',';
                else
                    first_doc = false;

                Blex::AppendAnyToString(doc->first, &line);
                line += ":{url:'";
                Blex::EncodeJava(doc->second.url.begin(), doc->second.url.end(), std::back_inserter(line));
                line += "',title:'";
                Blex::EncodeJava(doc->second.title.begin(), doc->second.title.end(), std::back_inserter(line));
                line += "',description:'";
                Blex::EncodeJava(doc->second.description.begin(), doc->second.description.end(), std::back_inserter(line));
                line += "'}";
                outfile->WriteString(line);
        }
        outfile->WriteString("};");
}

int UTF8Main(const std::vector<std::string> & args)
{
        Blex::OptionParser::Option optionlist[] =
        { Blex::OptionParser::Option::StringOpt("limit")
        , Blex::OptionParser::Option::StringOpt("baseurl")
        , Blex::OptionParser::Option::StringList("exclude")
        , Blex::OptionParser::Option::Param("indexdir", true)
        , Blex::OptionParser::Option::Param("command", true)
        , Blex::OptionParser::Option::Param("option1", false)
        , Blex::OptionParser::Option::Param("option2", false)
        , Blex::OptionParser::Option::ListEnd()
        };

        Blex::OptionParser optparse(optionlist);
        std::string indexdir = optparse.Parse(args) ? optparse.Param("indexdir") : std::string();
        std::string command;
        if (!indexdir.empty())
            command = optparse.Param("command");

        unsigned limit = 0;
        if (optparse.Exists("limit"))
            limit=std::atol(optparse.StringOpt("limit").c_str());

        if (command=="dumpindexterms")
            DumpIndexTerms(indexdir, optparse.Param("option1") == "positions");
        else if (command=="dumpcachewords")
            DumpCacheWords(indexdir);
        else if (command=="dumpcacheurls")
            DumpCacheUrls(indexdir);
        else if (command=="importindexfs")
            ImportIndexFS(indexdir, optparse.Param("option1"));
        else if (command=="exportindexfs")
            ExportIndexFS(indexdir, optparse.Param("option1"));
        else if (command=="importcachefs")
            ImportCacheFS(indexdir, optparse.Param("option1"));
        else if (command=="exportcachefs")
            ExportCacheFS(indexdir, optparse.Param("option1"));
        else if (command=="exportindextojs")
            ExportIndexToJS(indexdir, optparse.Param("option1"), optparse.Param("option2"), limit, optparse.StringOpt("baseurl"), optparse.StringList("exclude"));
        else
        {
                std::cout << "Usage: indextool <indexdir> <command> [options]\n";
                std::cout << "  dumpindexterms [positions] - Dump all terms in the index [with positions]\n";
                std::cout << "  dumpcachewords             - Dump all words in the cache\n";
                std::cout << "  dumpcacheurls              - Dump all URLs in the cache\n";
                std::cout << "  importindexfs <directory>  - Import the index file system from a directory\n";
                std::cout << "  exportindexfs <directory>  - Export the index file system to a directory\n";
                std::cout << "  importcachefs <directory>  - Import the cache file system from a directory\n";
                std::cout << "  exportcachefs <directory>  - Export the cache file system to a directory\n";
                std::cout << "  --baseurl <url> [--limit <num>] [--exclude <mask> ...]\n";
                std::cout << "    exportindextojs <indexid> <file>\n";
                std::cout << "                             - Export an index to a JavaScript file\n";
        }
        return EXIT_SUCCESS;
}

int main(int argc, char* argv[])
{
        return Blex::InvokeMyMain(argc, argv, &UTF8Main);
}

