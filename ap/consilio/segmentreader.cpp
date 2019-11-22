#include <ap/libwebhare/allincludes.h>



#include "segmentreader.h"
#include "terminfos.h"

namespace Lucene
{

SegmentReader::SegmentReader(Blex::Mutex &_commit_lock, std::shared_ptr<SegmentInfos> sis, const SegmentInfo & si, SegmentsCache &_cache)
: IndexReader(*si.dir)
, segment(si.name)
, commit_lock(_commit_lock)
, cache(_cache)
{
        Initialize(si);
        segmentinfos = sis;
}

SegmentReader::SegmentReader(Blex::Mutex &_commit_lock, const SegmentInfo & si, SegmentsCache &_cache)
: IndexReader(*si.dir)
, segment(si.name)
, commit_lock(_commit_lock)
, cache(_cache)
{
        Initialize(si);
}

std::string const &SegmentReader::GetSegmentName()
{
        return segment;
}

void SegmentReader::Initialize(const SegmentInfo & si)
{
        cacheref = cache.GetSegment(si.name, GetDirectory());

//        fieldinfos = FieldInfos(GetDirectory(), segment + ".fnm");
        fieldsreader.reset(new FieldsReader(&GetDirectory(), segment, *cacheref->fieldinfos));

        tis.reset(new TermInfosReader(GetDirectory(), segment, cacheref));

        if (HasDeletions(si))
            deleteddocs.reset(new BitVector(GetDirectory(), segment + ".del"));
        deleteddocsdirty = false;
        hasmergedeletions = false;

        normsdirty = false;

        freqstream.reset(GetDirectory().OpenFile(segment + ".frq",false,false));
        if (!freqstream.get())
            throw LuceneException("Cannot open freq file: " + segment + ".frq",false);
        proxstream.reset(GetDirectory().OpenFile(segment + ".prx",false,false));
        if (!proxstream.get())
            throw LuceneException("Cannot open prox file: " + segment + ".prx",false);

//        OpenNorms();
}

SegmentReader::~SegmentReader()
{
        if (deleteddocsdirty || normsdirty)
        {
                // Currently, normsdirty will never be true, so we only get here if documents have been deleted
                // If we're ever going to implement setting norms, make sure to correctly handle writing deletions to disk!

                Blex::Mutex::AutoLock lock(commit_lock);
                DEBUGSEGMENTSPRINT("SegmentReader::~SegmentReader got commit lock");
                if (deleteddocsdirty)   // re-write deleted
                {
                        deleteddocs->Write(GetDirectory(), segment + ".tmp");
                        GetDirectory().MovePath(segment + ".tmp", segment + ".del");
                }

                if (normsdirty)         // re-write norms
                {
/*ADDME: Implement this!
                        Enumeration keys  = norms.keys();
                        Enumeration values  = norms.elements();
                        while (values.hasMoreElements())
                        {
                                String field = (String)keys.nextElement();
                                Norm norm = (Norm)values.nextElement();
                                if (norm.dirty)
                                {
                                        norm.reWrite(field);
                                }
                        }
*/
                }

                if (segmentinfos != NULL)
                    segmentinfos->Write(GetDirectory(), cache, lock);
                else
                    delete GetDirectory().OpenFile("segments",true,true); //Create an empty file

                deleteddocsdirty = false;
                normsdirty = false;
                GetDirectory().Flush();
                DEBUGSEGMENTSPRINT("SegmentReader::~SegmentReader releasing commit lock");
        }
}

bool SegmentReader::HasDeletions(const SegmentInfo & si)
{
        return si.dir->Exists(si.name + ".del");
}

bool SegmentReader::HasDeletions()
{
        return hasmergedeletions || deleteddocs.get()!=NULL;
}

void SegmentReader::DoDelete(uint32_t docnum)
{
        if (deleteddocs.get() == NULL)
            deleteddocs.reset(new BitVector(MaxDoc()));
        deleteddocsdirty = true;
        deleteddocs->Set(docnum);
}

// merge delete: delete internally, don't write to disk (yet)
void SegmentReader::DoMergeDelete(uint32_t docnum)
{
        if (deleteddocs.get() == NULL)
            deleteddocs.reset(new BitVector(MaxDoc()));
        hasmergedeletions = true;
        deleteddocs->Set(docnum);
}

void SegmentReader::FlushMergeDeletions()
{
        deleteddocsdirty = hasmergedeletions;
        hasmergedeletions = false;
}

bool SegmentReader::IsDeleted(uint32_t n)
{
        return HasDeletions() && deleteddocs->Get(n);
}

std::vector<std::string> SegmentReader::Files()
{
        std::vector<std::string> files;

        std::string ext[] = { "fnm", "fdx", "fdt", "tii", "tis", "frq", "prx", "nrm", "del" };
        for (uint32_t i = 0; i < (sizeof (ext)/sizeof (ext[0])); ++i)
        {
                std::string filename = segment + "." + ext[i];
                if (GetDirectory().Exists(filename))
                    files.push_back(filename);
        }

        return files;
}

void SegmentReader::ResetTerms()
{
        tis->SeekEnum(0);
}

TermEnum * SegmentReader::Terms()
{
        return tis->Terms();
}

TermEnum * SegmentReader::Terms(const Term & t)
{
        return tis->Terms(t);
}

TermDocs * SegmentReader::GetTermDocs()
{
        return new SegmentTermDocs(this, false);
}

std::shared_ptr<TermDocs> SegmentReader::GetTermPositionsPtr()
{
        return std::shared_ptr<TermDocs>(GetTermPositions());
}

TermDocs * SegmentReader::GetTermPositions()
{
        return new SegmentTermDocs(this, true);
}

Document * SegmentReader::GetDocument(uint32_t n)
{
        if (!IsDeleted(n))
            return fieldsreader->Doc(n);
        else
            return NULL;
}

int32_t SegmentReader::DocFreq(const Term & t)
{
        const TermInfo * ti = tis->Get(t);
        if (ti != NULL)
            return ti->docfreq;
        else
            return 0;
}

uint32_t SegmentReader::NumDocs()
{
        uint32_t n = MaxDoc();
        if (deleteddocs.get() != NULL)
            n -= deleteddocs->Count();
        return n;
}

uint32_t SegmentReader::MaxDoc()
{
        return fieldsreader->Size();
}

std::set<std::string> SegmentReader::GetFieldNames()
{
        std::set<std::string> fieldset;
        for (uint32_t i = 0; i < cacheref->fieldinfos->Size(); ++i)
            fieldset.insert(cacheref->fieldinfos->GetFieldInfo(i)->name);
        return fieldset;
}

std::set<std::string> SegmentReader::GetFieldNames(bool indexed)
{
        std::set<std::string> fieldset;
        for (uint32_t i = 0; i < cacheref->fieldinfos->Size(); ++i)
            if (cacheref->fieldinfos->GetFieldInfo(i)->isindexed == indexed)
                fieldset.insert(cacheref->fieldinfos->GetFieldInfo(i)->name);
        return fieldset;
}

/*
std::vector<uint8_t> SegmentReader::Norms(const std::string & field)
{
        NormsMap::iterator norm = norms.find(field);
        if (field.empty() || norm == norms.end())
            return std::vector<uint8_t>();

        if (norm->second->bytes.empty())
        {
                std::vector<uint8_t> bytes(MaxDoc(), 0);
                Norms(field, &bytes, 0);
                norm->second->bytes.assign(bytes.begin(), bytes.end());
        }
        return norm->second->bytes;
}
*/

void SegmentReader::SetNorm(uint32_t /*doc*/, const std::string & /*field*/, uint8_t /*value*/)
{
/*      ADDME: norms rewriting isn't supported yet; due to move of norms to cache this code has been disabled
        NormsMap::iterator norm = norms.find(field);
        if (norm == norms.end())
            return;

        norm->second->dirty = true;
        normsdirty = true;
        norms[field]->bytes[doc] = value;
*/
}

Blex::PodVector< uint8_t > const & SegmentReader::Norms(const std::string & field)
{
        return cacheref->GetNorms(field);
}

void SegmentReader::Norms(const std::string &field, Blex::PodVector< uint8_t > * bytes, uint32_t offset)
{
        Blex::PodVector< uint8_t > const &norms = cacheref->GetNorms(field);

        std::copy(norms.begin(), norms.end(), bytes->begin() + offset);
}


/*
void SegmentReader::Norms(const std::string & field, std::vector<uint8_t> * bytes, uint32_t offset)
{
        NormsMap::iterator norm = norms.find(field);
        if (norm == norms.end())
            return;

        if (!norm->second->bytes.empty())
        {
                for (uint32_t i = 0; i < MaxDoc(); ++i)
                    (*bytes)[offset + i] = norm->second->bytes[i];
                return;
        }

        const std::unique_ptr<Blex::ComplexFileStream> normstream(norm->second->normsstream->CloneStream());

        // Skip to field position within norms file
        const FieldInfo * fi = cacheref->fieldinfos->GetFieldInfo(field);
        normstream->DirectRead(fi->number * MaxDoc(), &(*bytes)[0] + offset, MaxDoc());
}

void SegmentReader::OpenNorms()
{
        std::string filename = segment + ".nrm";
        std::shared_ptr<Blex::ComplexFileStream> normsstream(GetDirectory().OpenFile(filename,false,false));
        if (!normsstream.get())
            throw LuceneException("Cannot open norms file: " + filename,false);

        for (uint32_t i = 0; i < cacheref->fieldinfos->Size(); i++)
        {
                const FieldInfo * fi = cacheref->fieldinfos->GetFieldInfo(i);
                norms[fi->name] = NormPtr(new Norm(*this, normsstream));
        }
}
* /

SegmentReader::Norm::Norm(SegmentReader&reader, std::shared_ptr<Blex::ComplexFileStream> normsstream)
: / *reader(reader)
, * /normsstream(normsstream)
{
}

void SegmentReader::Norm::ReWrite(const std::string & name)
{
/ *addme: Don't rewrite individual norm files
        std::string tempfilename = reader.segment + ".tmp";
        const std::unique_ptr<Blex::ComplexFileStream> out(reader.GetDirectory().OpenFile(tempfilename,true,true));
        for (uint32_t i = 0; i < reader.MaxDoc(); ++i)
            out->WriteLsb<uint8_t>(bytes[i] & 0xFF);
        out.reset();

        reader.GetDirectory().Rename(tempfilename, normsfile);
        dirty = false;
* /
}
*/

SegmentTermEnum::SegmentTermEnum(Blex::ComplexFileSystem &fs, std::string const &filename, const FieldInfos & fis, bool isi)
: term(Term("",""))
, terminfo(TermInfo())
{
        segment = filename.substr(0,filename.size()-4);
        input.reset(fs.OpenFile(filename,false,false));
        if (!input.get())
            throw LuceneException("Cannot open enumerator file: " + filename,false);

        fieldinfos = const_cast<FieldInfos *>(&fis);
        size = input->ReadLsb<uint32_t>();
        isindex = isi;
        position = -1;
        indexpointer = 0;
        buffer = "";
}

SegmentTermEnum::~SegmentTermEnum()
{
        input.reset();
}

SegmentTermEnum * SegmentTermEnum::Clone()
{
        SegmentTermEnum * clone = new SegmentTermEnum(input->CloneStream(), fieldinfos, isindex, size, term, terminfo, position, indexpointer, buffer);
        clone->segment = segment;
        return clone;
}

void SegmentTermEnum::Seek(uint32_t pointer, int32_t p, const Term & t, const TermInfo & ti)
{
        input->SetOffset(pointer);
        position = p;
        term = t;
        terminfo.Set(ti);
        buffer = term.Text();
}

bool SegmentTermEnum::Next()
{
        uint32_t fieldnum;
        uint32_t totallength;

        if (!GetNextData(&fieldnum, &totallength))
        {
                term = Term();
                return false;
        }

        const FieldInfo * fi = fieldinfos->GetFieldInfo(fieldnum);
        term.Set(fi->name, &buffer[0], &buffer[0] + totallength);
        return true;
}

bool SegmentTermEnum::GetNextData(uint32_t *fieldnum, uint32_t *totallength)
{
        uint8_t localbuffer[20];

        if (position++ >= ((int32_t)size-1))
            return false;

        input->Read(localbuffer, 8);
        uint32_t start = Blex::getu32lsb(localbuffer);
        uint32_t length = Blex::getu32lsb(localbuffer+4);

        *totallength = start + length;
        if (*totallength > buffer.size())
            buffer.resize(*totallength + 32); // Do a big resize to avoid small increases

        input->Read(&buffer[start], length);

        input->Read(localbuffer, isindex ? 20 : 16);
        *fieldnum = Blex::getu32lsb(localbuffer);

        terminfo.docfreq = Blex::getu32lsb(localbuffer+4);
        terminfo.freqpointer += Blex::getu32lsb(localbuffer+8);
        terminfo.proxpointer += Blex::getu32lsb(localbuffer+12);

        if (isindex)
            indexpointer += Blex::getu32lsb(localbuffer+16);

        return true;
}

void SegmentTermEnum::LowerBound(Term const &until)
{
        // Make sure we need to (and can) skip forward
        if (!until.Valid() || until.CompareTo(term) <= 0)
            return;

        const unsigned invalid_fieldnum = 4294967295u;
        unsigned want_fieldnum = invalid_fieldnum;
        unsigned last_fieldfail = invalid_fieldnum;

        uint32_t fieldnum;
        uint32_t totallength;

        std::string::const_iterator t_begin = until.Text().begin();
        std::string::const_iterator t_end = until.Text().end();

        while (true)
        {
                if (!GetNextData(&fieldnum, &totallength))
                {
                        // Reached the end; return.
                        term = Term();
                        return;
                }

                if (fieldnum == last_fieldfail)
                    continue;

                if (fieldnum != want_fieldnum)
                {
                        const FieldInfo *fi = fieldinfos->GetFieldInfo(fieldnum);

                        int comp = fi->name.compare(until.Field());
                        if (comp == 0)
                        {
                                want_fieldnum = fieldnum;
                        }
                        else if (comp > 0)
                        {
                                // Past target. Set term and return
                                term.Set(fi->name, &buffer[0], &buffer[0] + totallength);
                                return;
                        }
                        else
                        {
                                // not there yet, and no need to check this fieldnum again
                                last_fieldfail = fieldnum;
                                continue;
                        }
                }

                // INV: fieldname matches!

                std::string::const_iterator buffer_s = buffer.begin();
                int comp = Blex::StrCompare(buffer_s, buffer_s + totallength, t_begin, t_end);
                if (comp >= 0)
                {
                        term.Set(until.Field(), &buffer[0], &buffer[0] + totallength);
                        return;
                }
        }
/*/

        while (until.CompareTo(term) > 0 && Next())
            ; // Just compare and next again.
//*/
}

Term SegmentTermEnum::GetTerm()
{
        if (!term.Valid())
            return Term();
        else
            return term;
}

TermInfo * SegmentTermEnum::GetTermInfo()
{
        return &terminfo;
}

void SegmentTermEnum::SetTermInfo(const TermInfo & ti)
{
        terminfo.Set(ti);
}

int32_t SegmentTermEnum::DocFreq()
{
        return terminfo.docfreq;
}

uint32_t SegmentTermEnum::FreqPointer()
{
        return terminfo.freqpointer;
}

uint32_t SegmentTermEnum::ProxPointer()
{
        return terminfo.proxpointer;
}

SegmentTermEnum::SegmentTermEnum(Blex::ComplexFileStream * i, FieldInfos * fis, bool isi, uint32_t s, const Term & t, const TermInfo & ti, /*const Term & p, */int32_t pos, uint32_t ptr, const std::string & buf)
: input(i)
{
        fieldinfos = fis;
        isindex = isi;
        size = s;
        term.Set(t);
        terminfo = ti;
        position = pos;
        indexpointer = ptr;
        buffer = buf;
}

SegmentTermDocs::SegmentTermDocs(SegmentReader * _parent, bool _positions)
: TermDocs(_positions)
, doc(0)
, parent(_parent)
, freqstream(_parent->freqstream->CloneStream())
{
        if (positions)
        {
                proxstream.reset(parent->proxstream->CloneStream());
                proxcount = 0;
        }
}

SegmentTermDocs::~SegmentTermDocs()
{
}

void SegmentTermDocs::Seek(const Term & term)
{
        Seek(parent->tis->Get(term));
}

void SegmentTermDocs::Seek(TermEnum * termenum)
{
        const TermInfo * ti;
        if (typeid(termenum) == typeid(SegmentTermEnum))
            ti = ((SegmentTermEnum *)termenum)->GetTermInfo();
        else
            ti = parent->tis->Get(termenum->GetTerm());
        Seek(ti);
}

void SegmentTermDocs::Seek(const TermInfo * ti)
{
        if (ti == NULL)
            freqcount = 0;
        else
        {
                freqcount = ti->docfreq;
                doc = 0;
                freqstream->SetOffset(ti->freqpointer);
        }

        if (positions)
        {
                if (ti == NULL)
                    proxcount = 0;
                else
                    proxstream->SetOffset(ti->proxpointer);
        }
}

uint32_t SegmentTermDocs::Doc()
{
        return doc;
}

uint32_t SegmentTermDocs::Freq()
{
        return freq;
}

bool SegmentTermDocs::Next()
{
        if (!positions)
            return DocNext();

        for (uint32_t f = proxcount; f > 0; f--)
            proxstream->ReadLsb<uint32_t>();

        if (DocNext())
        {
                proxcount = freq;
                position = 0;
                return true;
        }
        return false;
}

uint32_t SegmentTermDocs::NextPosition()
{
        if (!positions)
            throw LuceneException("No positions information", false);

        if (proxcount == 0)
            throw LuceneException("Read beyond term positions", false);
        --proxcount;
        return position += proxstream->ReadLsb<uint32_t>();
}

uint32_t SegmentTermDocs::Read(std::vector<uint32_t> * docs, std::vector<uint32_t> * freqs)
{
        if (positions)
            throw LuceneException("Operation not implemented for positions", false);

        uint32_t end = docs->size();
        uint32_t i = 0;
        while ((i < end) && (freqcount > 0))
        {
                uint32_t doccode = freqstream->ReadLsb<uint32_t>();
                doc += doccode >> 1;
                if ((doccode & 1) != 0)
                    freq = 1;
                else
                    freq = freqstream->ReadLsb<uint32_t>();

                --freqcount;

                if (!parent->IsDeleted(doc))
                {
                        (*docs)[i] = doc;
                        (*freqs)[i] = freq;
                        ++i;
                }
        }
        return i;
}

bool SegmentTermDocs::SkipTo(uint32_t target)
{
        do
        {
                if (!Next())
                    return false;
        }
        while (target > doc);
        return true;
}

void SegmentTermDocs::SkippingDoc()
{
        if (positions)
            for (uint32_t f = SegmentTermDocs::freq; f > 0; --f)
                proxstream->ReadLsb<uint32_t>();
}

bool SegmentTermDocs::DocNext()
{
        while (true)
        {
                if (freqcount == 0)
                    return false;

                uint32_t doccode = freqstream->ReadLsb<uint32_t>();
                doc += doccode >> 1;
                if ((doccode & 1) != 0)
                    freq = 1;
                else
                    freq = freqstream->ReadLsb<uint32_t>();

                --freqcount;

                if (!parent->IsDeleted(doc))
                    break;
                SkippingDoc();
        }
        return true;
}

} // namespace Lucene

