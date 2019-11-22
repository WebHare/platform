//---------------------------------------------------------------------------
#include <ap/libwebhare/allincludes.h>

//---------------------------------------------------------------------------

#include "pdf.h"
#include "pdf_streams.h"
//#include <harescript/vm/hsvm_dllinterface.h>

namespace Parsers
{

namespace Adobe
{

namespace PDF
{

Object::~Object()
{
}

std::ostream& operator<<(std::ostream &out, Object const&object)
{
        switch (object.GetType() )
        {
        case type_boolean:
                out << "\nBooleanObject";
                out << "\n " << (object.GetBoolean() ? "true" : "false");
        break;
        case type_numeric:
                out << "\nNumObject";
                out << "\n " << object.GetNumericInt();
        break;
        case type_string:
                out << "\nStringObject";
                out << "\n " << object.GetString();
        break;
        case type_name:
                out << "\nNameObject";
                out << "\n " << object.GetName();
        break;
        case type_array:
        {
                out << "\nArrayObject";
                ArrayObject const &array = object.GetArray();
                for (unsigned i=0;i<array.GetLength();++i)
                    out << array[i];
        }
        break;
        case type_dictionary:
        {
                out << "\nDictionaryObject";
                DictObject::RawMap const &rawmap = object.GetDictionary().GetRawMap();
                for (DictObject::RawMap::const_iterator it = rawmap.begin(); it != rawmap.end(); ++it)
                {
                        out << "\nkey = " << it->first;
                        out << it->second;
                }
        }
        break;
        case type_stream:
        {
                out << "\nStreamObject";
                out << "length = " << object.GetStream().GetDictionary()["Length"].GetNumericInt();
        }
        break;
        case type_null:
        break;
        case type_indirect:
        {
                out << "\nIndirectObject";
        }
        break;
        case type_keyword:
        {
                out << "\nKeyword\n";
                out << " " << object.GetKeyword();
        }
        }
        return out;
}
Object const& DictObject::operator [] (std::string const &key) const
{
        if (!KeyExists(key))
                throw std::runtime_error("Corrupt PDF File: Key '" + key + "' not found in dictionary");

        return *value.find(key)->second;
}

bool DictObject::KeyExists(std::string key) const
{
        return value.find(key) != value.end();
}

unsigned ArrayObject::GetLength() const
{
        return value.size();
}

Object const& ArrayObject::operator [] (unsigned idx) const
{
        if (idx >= GetLength())
                throw std::runtime_error("Corrupt PDF File: Index #" + Blex::AnyToString(idx) + " not found in array");

        return *value[idx];
}

bool Object::GetBoolean() const
{
        throw std::runtime_error("Corrupt PDF File: Incorrect type");
}

bool BooleanObject::GetBoolean() const
{
        return value;
}

int64_t Object::GetNumericInt() const
{
        throw std::runtime_error("Corrupt PDF File: Incorrect type");
}

object_type Object::GetType() const
{
        return type;
}

int64_t NumObject::GetNumericInt() const
{
        if (num_type == num_float)
                return int64_t(value.float_value);
        else
                return value.int_value;
}

float Object::GetNumericFloat() const
{
        throw std::runtime_error("Corrupt PDF File: Incorrect type");
}

float NumObject::GetNumericFloat() const
{
        if (num_type == num_float)
                return value.float_value;
        else
                return float(value.int_value);
}

std::string const& Object::GetString() const
{
        throw std::runtime_error("Corrupt PDF File: Incorrect type");
}

std::string const& StringObject::GetString() const
{
        return value;
}

std::string const& Object::GetName()const
{
        throw std::runtime_error("Corrupt PDF File: Incorrect type");
}

std::string const&NameObject::GetName()const
{
        return value;
}

ArrayObject const& Object::GetArray()const
{
        throw std::runtime_error("Corrupt PDF File: Incorrect type");
}

ArrayObject const& ArrayObject::GetArray()const
{
        return *this;
}

DictObject const& Object::GetDictionary()const
{
        throw std::runtime_error("Corrupt PDF File: Incorrect type");
}

DictObject const& DictObject::GetDictionary()const
{
        return *this;
}

StreamObject const& Object::GetStream() const
{
        throw std::runtime_error("Corrupt PDF File: Incorrect type");
}

StreamObject const&  StreamObject::GetStream()const
{
        return *this;
}
std::string const& Object::GetKeyword()const
{
        throw std::runtime_error("Corrupt PDF File: Incorrect type");
}

std::string const& KeywordObject::GetKeyword() const
{
        return value;
}

ObjectPtr const& IndirectObject::GetIndirectObject() const
{
       if (!cache_indirect_object.get())
            cache_indirect_object=lexer.ResolveIndirect(value);

        return cache_indirect_object;
}

bool IndirectObject::GetBoolean()const
{
        return GetIndirectObject()->GetBoolean();
}
int64_t IndirectObject::GetNumericInt()const
{
        return GetIndirectObject()->GetNumericInt();
}
float IndirectObject::GetNumericFloat()const
{
        return GetIndirectObject()->GetNumericFloat();
}
std::string const&IndirectObject::GetString()const
{
        return GetIndirectObject()->GetString();
}
std::string const&IndirectObject::GetName()const
{
        return GetIndirectObject()->GetName();
}
ArrayObject const&IndirectObject::GetArray()const
{
        return GetIndirectObject()->GetArray();
}
DictObject const& IndirectObject::GetDictionary()const
{
        return GetIndirectObject()->GetDictionary();
}

StreamObject const& IndirectObject::GetStream()const
{
        return GetIndirectObject()->GetStream();
}

std::shared_ptr<Blex::Stream> StreamObject::GetUncompressedData() const
{
        std::vector<std::string> filters;
        std::shared_ptr<Blex::Stream> retval;
        retval = GetData(&filters);
        if(!filters.empty() || !retval.get())
            throw std::runtime_error("Unable to fully decompress data");
        return retval;
}

std::shared_ptr<Blex::Stream> StreamObject::GetData(std::vector<std::string> *filters) const
{
        // The input chain of all streams (ADDME: we don't really need the input_chain anhymore now we have owning streams)
        std::vector< std::shared_ptr<Blex::Stream> > input_chain;

        // Allocate an input stream
        DEBUGPRINT("inputchain " << input_offset << " " << input_end_offset);
        input_chain.push_back(std::shared_ptr<Blex::Stream>(new Blex::LimitedStream(input_offset, input_end_offset, *input_stream)));

        // See if we need a decryption filter in the chain
         if (objnum != 0 && !filekey.empty())
        {
                uint8_t key[16];
                unsigned keylen = lexer.GetKey(key, objnum, objgen);
                input_chain.push_back(ApplyRC4FilterToStream(key, keylen, input_chain.back()));
        }

        // See if we need a decompression filter in the input chain
        if(filters)
        {
                filters->clear();
                if (dict->KeyExists("Filter"))
                {
                        if ((*dict)["Filter"].GetType() == type_array)
                        {
                                ArrayObject const& filter_pipeline = (*dict)["Filter"].GetArray();
                                for (unsigned i = 0; i < filter_pipeline.GetLength(); ++i)
                                    filters->push_back(filter_pipeline[i].GetName());
                        }
                        else
                        {
                                filters->push_back((*dict)["Filter"].GetName());
                        }

                        //Any filters we can pop off?
                        while (!filters->empty())
                        {
                                if(filters->front()=="DCTDecode" || filters->front()=="CCITTFaxDecode")
                                    break; //cannot pop this filter safely here

                                    //FIXME: Deal with applyfiltertostream returning NULL

                                std::shared_ptr<Blex::Stream> filter;
                                filter = ApplyFilterToStream(filters->front(), input_chain.back());
                                input_chain.push_back(filter);
                                filters->erase(filters->begin());
                        }
                }
        }

        if(dict->KeyExists("DecodeParms"))
        {
                DictObject const &decodeparms = (*dict)["DecodeParms"].GetDictionary();
                if(decodeparms.KeyExists("Predictor"))
                {
                        unsigned predictor = decodeparms["Predictor"].GetNumericInt();
                        if(predictor >= 10 && predictor <= 15)
                        {
                                unsigned columns = decodeparms["Columns"].GetNumericInt();
                                DEBUGPRINT("PNG predirector " << predictor << " columns " << columns);

                                std::shared_ptr<Blex::Stream> filter(new PNGPredictionDecodeStream(*input_chain.back(), columns));
                                input_chain.push_back(filter);
                        }
                        else
                        {
                                DEBUGPRINT("Unrecognized predictor " << predictor);
                        }
                }
        }

        DEBUGPRINT("total chain length " << input_chain.size());
        // Now convert the stream to a random stream (that's what the lexer needs to parse it)
        return input_chain.back();
}

std::string const& IndirectObject::GetKeyword()const
{
        return GetIndirectObject()->GetKeyword();
}
object_type IndirectObject::GetType() const
{
        return GetIndirectObject()->GetType();
}

PDFOutputStream::PDFOutputStream(Blex::Stream &out)
: cs(out)
{
}

PDFOutputStream::~PDFOutputStream()
{
}

void PDFOutputStream::WriteIndirectReference(unsigned object)
{
        std::string ref = Blex::AnyToString(object) + " 0 R";
        CurStream().WriteString(ref);
}

void PDFOutputStream::WriteDocument(DictObject const &root, DictObject */*info*/, Version const &version)
{
        assert(cs.GetBytesDone()==0);

        std::string versiontag = "%PDF-" + Blex::AnyToString(version.major_nr) + "." + Blex::AnyToString(version.minor_nr) + "\r\n";
        cs.WriteString(versiontag);

        StartObject();
        root.WriteObject(*this);
        unsigned root_object = EndObject();

        assert(objstack.empty());

        //ADDME: Handle info object

        Blex::FileOffset startxref = cs.GetBytesDone();
        std::string xref = "xref\r\n0 " + Blex::AnyToString(objects.size()) + "\r\n0000000000 65535 f\r\n";
        for (unsigned i=0;i<objects.size();++i)
        {
                ObjectInfo &obj = objects[i];
                std::string pos = Blex::AnyToString(obj.position);
                xref.append(10-pos.size(),'0');
                xref+=pos;
                xref+=" 00000 n\r\n";
        }
        xref += "trailer ";
        cs.WriteString(xref);

        //Fake a dictionary (Dunno yet how to build the Real Deal efficientlyt);
        cs.WriteString("<< ");
        NameObject("Size").WriteObject(*this);
        cs.WriteLsb<uint8_t>(' ');
        NumObject(objects.size()).WriteObject(*this);
        cs.WriteString("\r\n");

        NameObject("Root").WriteObject(*this);
        cs.WriteLsb<uint8_t>(' ');
        WriteIndirectReference(root_object);
        cs.WriteString("\r\n");

        cs.WriteString(">>\r\n");

        //ADDME: Build a new dictionary with SIZE, INFO and ROOT objects
        std::string eof = "startxref\r\n";
        eof += Blex::AnyToString(startxref);
        eof += "\r\n%%EOF\r\n";
        cs.WriteString(eof);
}

unsigned PDFOutputStream::LookupIndirectObject(Object const * address)
{
        IndirectObjectMap::const_iterator itr=indirectobjectmap.find(address);
        if(itr!=indirectobjectmap.end())
            return itr->second;
        else
            return 0;
}
void PDFOutputStream::RegisterIndirectObject(unsigned object, Object const * address)
{
        indirectobjectmap[address] = object;
}

unsigned PDFOutputStream::ReserveObject()
{
        objects.resize(objects.size()+1);
        return objects.size();
}
void PDFOutputStream::StartReservedObject(unsigned objnum)
{
        if(objnum>objects.size() || objects[objnum-1].position!=0)
            throw std::runtime_error("Illegal attempt to open reserved object");

        ObjectStackPtr newobj(new ObjectStack);
        newobj->objectid = objnum;
        objstack.push(newobj);
}

unsigned PDFOutputStream::StartObject()
{
        ObjectStackPtr newobj(new ObjectStack);
        objects.resize(objects.size()+1);
        newobj->objectid = objects.size();

        objstack.push(newobj);
        return newobj->objectid;
}
unsigned PDFOutputStream::EndObject()
{
        assert(!objstack.empty());

        //Flush the current object!
        unsigned objid = objstack.top()->objectid;
        objects[objid-1].position = cs.GetBytesDone();

        std::string header = Blex::AnyToString(objid) + " 0 obj\r\n";
        cs.WriteString(header);

        //FIXME: If this is the final object, we cannot just rewrite the dictionary with the same \Size !
        objstack.top()->temp.SetOffset(0);
        objstack.top()->temp.SendAllTo(cs);

        cs.WriteString(" endobj\r\n");
        objstack.pop();
        return objid;
}

void DictObject::WriteObject(PDFOutputStream &output) const
{
        output.CurStream().WriteString("<<\r\n");

        //Walk the dictionary object
        for(DictObject::RawMap::const_iterator itr = GetRawMap().begin(), end = GetRawMap().end(); itr!=end; ++itr)
        {
                NameObject(itr->first).WriteObject(output);
                output.CurStream().WriteLsb<uint8_t>(' ');
                itr->second->WriteObject(output);
                output.CurStream().WriteString("\r\n");
        }
        output.CurStream().WriteString(">>\r\n");
}
void NameObject::WriteObject(PDFOutputStream &outstream) const
{
        //FIXME: # encoding where necessary of hex strings
        outstream.CurStream().WriteLsb<uint8_t>('/');
        outstream.CurStream().WriteString(value);
}
void NumObject::WriteObject(PDFOutputStream &outstream) const
{
        if (num_type == NumObject::num_float)
            outstream.CurStream().WriteString(Blex::AnyToString(value.float_value));
        else
            outstream.CurStream().WriteString(Blex::AnyToString(value.int_value));
}
void IndirectObject::WriteObject(PDFOutputStream &outstream) const
{
        ObjectPtr reference = GetIndirectObject();

        //Prevent recursion. Did we write this object already?
        unsigned objid = outstream.LookupIndirectObject(reference.get());
        if(objid==0)
        {
                objid = outstream.StartObject();
                outstream.RegisterIndirectObject(objid, reference.get());
                reference->WriteObject(outstream);
                outstream.EndObject();
        }
        outstream.WriteIndirectReference(objid);
}
void ArrayObject::WriteObject(PDFOutputStream &outstream) const
{
        outstream.CurStream().WriteString("[ ");
        for(unsigned i=0;i<value.size();++i)
        {
                value[i]->WriteObject(outstream);
                outstream.CurStream().WriteString(" ");
        }
        outstream.CurStream().WriteString("]\r\n");
}
void BooleanObject::WriteObject(PDFOutputStream &outstream) const
{
        outstream.CurStream().WriteString(value ? "true" : "false");
}
void StringObject::WriteObject(PDFOutputStream &outstream) const
{
        //FIXME: Correctly write the octal codes - Does EncodeJava suffice? When should we use HEX ?
        std::vector<char> obj;
        obj.push_back('(');
        Blex::EncodeJava(value.begin(), value.end(), std::back_inserter(obj));
        obj.push_back(')');

        outstream.CurStream().Write(&obj[0], obj.size());
}
void KeywordObject::WriteObject(PDFOutputStream &outstream) const
{
        outstream.CurStream().WriteString(value);
}
void NullObject::WriteObject(PDFOutputStream &outstream) const
{
        outstream.CurStream().WriteString("null");
}
void StreamObject::WriteObject(PDFOutputStream &outstream) const
{
        unsigned length_object = outstream.ReserveObject();

        //Get the stream
        std::vector<std::string> filters;
        std::shared_ptr<Blex::Stream> str;
        str = GetData(&filters);
        //FIXME: Deal with GetData returning NULL

        //Write a fake dictionary first
        outstream.CurStream().WriteString("<< ");
        NameObject("Length").WriteObject(outstream);
        outstream.CurStream().WriteLsb<uint8_t>(' ');
        outstream.WriteIndirectReference(length_object);
        outstream.CurStream().WriteLsb<uint8_t>(' ');
        if(!filters.empty())
        {
                NameObject("Filter").WriteObject(outstream);
                if(filters.size()==1)
                {
                        NameObject(filters[0]).WriteObject(outstream);
                }
                else
                {
                        ArrayObject arr;
                        for (unsigned i=0;i<filters.size();++i)
                            arr.PushBack(ObjectPtr(new NameObject(filters[i])));
                        arr.WriteObject(outstream);
                }
        }
        outstream.CurStream().WriteString(" >> stream\r\n");

        Blex::FileOffset numbytes = str->SendAllTo(outstream.CurStream());
        outstream.CurStream().WriteString("\r\nendstream\r\n");

        //Now we finish off the length object
        outstream.StartReservedObject(length_object);
        NumObject(numbytes).WriteObject(outstream);
        outstream.EndObject();
}

}
}
}

