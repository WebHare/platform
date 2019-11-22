#include <ap/libwebhare/allincludes.h>



#include "documentwriter.h"
#include "fieldswriter.h"
#include "terminfos.h"
#include "ctokenstream.h"

namespace Lucene
{

Posting::Posting(uint32_t position)
: freq(1)
{
        positions.assign(1, position);
}

DocumentWriter::DocumentWriter(Blex::ComplexFileSystem &_directory, Similarity &_similarity, uint32_t _maxfieldlength)
: directory(_directory)
, similarity(_similarity)
, maxfieldlength(_maxfieldlength)
, termbuffer(Term("", ""))
{
}

void DocumentWriter::AddDocument(const std::string & segment, const Document & doc)
{
        // Check for suggest field
        for (DocumentFieldList::const_iterator it = doc.Fields().begin(); it != doc.Fields().end(); ++it)
        {
                if (it->Name() == "suggestfields")
                {
                        // The suggest field contains space separated "field prefix" tuples
                        std::vector<std::string> fields;
                        Blex::Tokenize(it->StringValue().begin(), it->StringValue().end(), ' ', &fields);
                        for (std::vector<std::string>::iterator fld = fields.begin(); fld != fields.end(); ++fld)
                        {
                                std::string field = *fld;
                                if (++fld != fields.end())
                                {
                                        DEBUGPRINT("Adding suggestfield " << field << " with prefix " << *fld);
                                        suggestfields.push_back(std::make_pair(field, *fld));
                                }
                                else
                                    break; // Prevent loop increment past end
                        }

                        // If we have a prefix, create the stream to add terms to
                        if (!suggestfields.empty())
                            suggeststream.reset(new Blex::MemoryRWStream);

                        break;
                }
        }

        // Write field names
        fieldinfos.Add(doc);
        fieldinfos.Write(directory, segment + ".fnm");

        // Write field data
        {
                FieldsWriter fieldswriter(directory, segment, fieldinfos);
                fieldswriter.AddDocument(doc);
        }

        // Invert doc into postingtable
        postingtable.clear();
        fieldlengths.assign(fieldinfos.Size(), 0);
        fieldpositions.assign(fieldinfos.Size(), 0);
        fieldboosts.assign(fieldinfos.Size(), doc.GetBoost());

        InvertDocument(doc);
        PostingArray postings;
        SortPostingTable(&postings);
        WritePostings(postings, segment);
        WriteNorms(doc, segment);
}

void DocumentWriter::InvertDocument(const Document &doc)
{
        for (DocumentFieldList::const_iterator it = doc.Fields().begin(); it != doc.Fields().end(); ++it)
        {
                // The suggest field is not added directly
                if (it->Name() == "suggestfields")
                    continue;

                InvertDocumentField(*it);
        }

        // Add the suggest field, if any text was added
        if (suggeststream.get() && suggeststream->GetFileLength())
        {
                suggeststream->SetOffset(0);
                Field suggestfield = Field::Text("suggestfields", suggeststream);
                InvertDocumentField(suggestfield);
        }
}

void DocumentWriter::InvertDocumentField(const Field &field)
{
        uint32_t fieldnumber = fieldinfos.FieldNumber(field.Name());
        uint32_t length = fieldlengths[fieldnumber];
        uint32_t position = fieldpositions[fieldnumber];

        if (!field.IsIndexed())
            return;

        bool suggestfield = field.Name().compare("suggestfields") == 0;
        // Add suggest terms for this field, if this is not the suggestfields field
        // itself, we have a suggeststream (i.e. we have fields to add suggest terms
        // for) and this field should be suggested
        std::vector<std::string> suggestprefixes;
        if (!suggestfield)
        {
                DEBUGPRINT("Looking for suggest prefixes for field " << field.Name());
                for (std::vector<std::pair<std::string, std::string> >::const_iterator fld = suggestfields.begin(); fld != suggestfields.end(); ++fld)
                    if (field.Name().compare(fld->first) == 0)
                    {
                            DEBUGPRINT("Adding suggest prefix " << fld->second);
                            suggestprefixes.push_back(fld->second);
                    }
        }

        if (field.IsTokenized())
        {
                std::shared_ptr<NormalizedTokenStream> stream;
                if (field.ReaderValue().get() != NULL)
                    stream.reset(new StemmedTokenStream(field.ReaderValue().get()));
                else if (!field.StringValue().empty())
                    stream.reset(new StemmedTokenStream(field.StringValue()));
                else
                    throw LuceneException("No reader of string value for field",false);
                stream->SetMaxWordLength(MAX_WORD_LENGTH);

                for (ConsilioToken t = stream->Next(); length <= MAX_FIELD_LENGTH && t.valid; t = stream->Next())
                {
                        switch (t.type)
                        {
                                case ConsilioToken::Word:
                                {
                                        // Only add if not link text
                                        if (!t.linktext)
                                        {
                                                AddPosition(field.Name(), t.normalizedterm, position);
                                                ++length;
                                                // Don't add the stemmed term for the suggest field
                                                if (!suggestfield && !t.stemmedterm.empty())
                                                {
                                                        AddPosition(field.Name(), t.stemmedterm, position);
                                                        ++length;
                                                }

                                                // Add the text to the suggest stream (don't have to use normalized term;
                                                // the term will be normalized when the suggest stream is indexed)
                                                for (std::vector<std::string>::const_iterator prefix = suggestprefixes.begin(); prefix != suggestprefixes.end(); ++prefix)
                                                    AddSuggest(*prefix, t.term);
                                        }
                                        ++position;
                                } break;
                                case ConsilioToken::Lang:
                                {
                                        stream->SetLang(Blex::Lang::GetLanguage(t.term));
                                        DEBUGPRINT("Switching to document language " << Blex::Lang::GetLanguage(t.term));
                                } break;
                                default:
                                {
                                        // Can be ParserPunc, Punct or Whitespace, ignoring those.
                                }
                        }
                }
        }
        else
        {
                AddPosition(field.Name(), field.StringValue(), position++);
                length++;

                // Add the text to the suggest stream
                for (std::vector<std::string>::const_iterator prefix = suggestprefixes.begin(); prefix != suggestprefixes.end(); ++prefix)
                    AddSuggest(*prefix, field.StringValue());
        }

        fieldlengths[fieldnumber] = length;
        fieldpositions[fieldnumber] = position;
        fieldboosts[fieldnumber] *= field.GetBoost();
}


void DocumentWriter::AddPosition(const std::string & field, const std::string & text, uint32_t position)
{
        termbuffer.Set(field, text);
        PostingTable::iterator ti = postingtable.find(termbuffer);
        if (ti != postingtable.end())
        {
                uint32_t freq = ti->second.freq;
                if (ti->second.positions.size() == freq)
                    ti->second.positions.resize(2 * freq);
                ti->second.positions[freq] = position;
                ti->second.freq = freq + 1;
        }
        else
            postingtable.insert(std::make_pair(termbuffer, Posting(position)));
}

void DocumentWriter::AddSuggest(const std::string &prefix, const std::string &text)
{
        suggeststream->Write(prefix.c_str(), prefix.size());
        suggeststream->Write(text.c_str(), text.size());
        suggeststream->Write(" ", 1);
}

void DocumentWriter::SortPostingTable(PostingArray *array)
{
        array->clear();
        for (PostingTable::iterator it = postingtable.begin(); it != postingtable.end(); ++it)
            array->push_back(*it);
        if (array->size() > 0)
            QuickSort(array, 0, array->size()-1);
}

void DocumentWriter::QuickSort(PostingArray *_postings, uint32_t lo, uint32_t hi)
{
        PostingArray &postings = *_postings;
        if (lo >= hi)
            return;

        uint32_t mid = (lo + hi) >> 1;

        if (postings[lo].first.CompareTo(postings[mid].first) > 0)
        {
                std::pair<Term, Posting> tmp = postings[lo];
                postings[lo] = postings[mid];
                postings[mid] = tmp;
        }

        if (postings[mid].first.CompareTo(postings[hi].first) > 0)
        {
                std::pair<Term, Posting> tmp = postings[mid];
                postings[mid] = postings[hi];
                postings[hi] = tmp;

                if (postings[lo].first.CompareTo(postings[mid].first) > 0)
                {
                        std::pair<Term, Posting> tmp2 = postings[lo];
                        postings[lo] = postings[mid];
                        postings[mid] = tmp2;
                }
        }

        uint32_t left = lo + 1;
        uint32_t right = hi - 1;

        if (left >= right)
            return;

        Term partition = postings[mid].first;

        for (;;)
        {
                while (postings[right].first.CompareTo(partition) > 0)
                    --right;

                while (left < right && postings[left].first.CompareTo(partition) <= 0)
                    ++left;

                if (left < right)
                {
                        std::pair<Term, Posting> tmp = postings[left];
                        postings[left] = postings[right];
                        postings[right] = tmp;
                        --right;
                }
                else
                    break;
        }

        QuickSort(_postings, lo, left);
        QuickSort(_postings, left + 1, hi);
}

void DocumentWriter::WritePostings(const PostingArray & postings, const std::string & segment)
{
        const std::unique_ptr<Blex::ComplexFileStream> freq(directory.OpenFile(segment + ".frq",true,true));
        const std::unique_ptr<Blex::ComplexFileStream> prox(directory.OpenFile(segment + ".prx",true,true));
        const std::unique_ptr<TermInfosWriter> tis(new TermInfosWriter(directory, segment, fieldinfos));

        TermInfo ti;
        for (PostingArray::const_iterator it = postings.begin(); it != postings.end(); ++it)
        {
                ti.Set(1, freq->GetOffset(), prox->GetOffset());
                tis->Add((*it).first, ti);

                uint32_t f = (*it).second.freq;
                if (f == 1)
                    freq->WriteLsb<uint32_t>(1);
                else
                {
                        freq->WriteLsb<uint32_t>(0);
                        freq->WriteLsb<uint32_t>(f);
                }

                uint32_t lastposition = 0;
                for (Positions::const_iterator pit = (*it).second.positions.begin(); pit != (*it).second.positions.end(); ++pit)
                {
                        uint32_t position = *pit;
                        prox->WriteLsb<uint32_t>(position - lastposition);
                        lastposition = position;
                }
        }
}

void DocumentWriter::WriteNorms(const Document & doc, const std::string & segment)
{
        std::string normsfile = segment + ".nrm";
        const std::unique_ptr<Blex::ComplexFileStream> norms(directory.OpenFile(normsfile,true,true));

        for (DocumentFieldList::const_iterator it = doc.Fields().begin(); it != doc.Fields().end(); ++it)
        {
                int32_t n = fieldinfos.FieldNumber(it->Name());
                float norm = fieldboosts[n] * similarity.LengthNorm(it->Name(), fieldlengths[n]);

                uint8_t byte = similarity.EncodeNorm(norm);
                // Skip to field position within norms file and write norm factor
                norms->DirectWrite(n, &byte, 1);
        }
}

} // namespace Lucene

