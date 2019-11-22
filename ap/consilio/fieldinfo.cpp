#include <ap/libwebhare/allincludes.h>



#include "fieldinfo.h"
#include <iostream>

namespace Lucene
{

FieldInfo::FieldInfo(const std::string & _name, bool _isindexed, uint32_t _number)
: name(_name)
, isindexed(_isindexed)
, number(_number)
{
}

FieldInfos::FieldInfos()
{
        Add("", false);
}

FieldInfos::FieldInfos(Blex::ComplexFileSystem &d, const std::string & name)
{
        /* This is the first file of a segment to be opened when a segment is read.
           If for some reason the segments list contains a segment which doesn't
           exist on disk, we'll throw a fatal exception here if the file could not
           be opened. This will cause the IndexManager to close without writing an
           index-is-sane file, which will force a newly started IndexManager to
           validate the index and delete the reference to the non-existing segment. */
        std::shared_ptr<Blex::ComplexFileStream> fieldinfo(d.OpenFile(name,false,false));
        if (!fieldinfo.get())
            throw LuceneException("Cannot open fields file "+name,true);

        Read(*fieldinfo);
}

void FieldInfos::Add(const Document & doc)
{
        DocumentFieldList docfields = doc.Fields();
        for (DocumentFieldList::const_iterator it = docfields.begin(); it != docfields.end(); ++it)
            Add(it->Name(), it->IsIndexed());
}

void FieldInfos::Add(const std::vector<std::string> & names, bool isindexed)
{
        for (std::vector<std::string>::const_iterator it = names.begin(); it != names.end(); ++it)
            Add(*it, isindexed);
}

void FieldInfos::Add(const std::set<std::string> & names, bool isindexed)
{
        for (std::set<std::string>::const_iterator it = names.begin(); it != names.end(); ++it)
            Add(*it, isindexed);
}

void FieldInfos::Add(const std::string & name, bool isindexed)
{
        FieldInfo * fi = const_cast<FieldInfo *>(GetFieldInfo(name));
        if (fi == NULL)
            AddInternal(name, isindexed);
        else if (fi->isindexed != isindexed)
            fi->isindexed = true;
}

void FieldInfos::AddInternal(const std::string & name, bool isindexed)
{
        uint32_t fieldnum = bynumber.size();
        FieldInfo fi(name, isindexed, fieldnum);
        bynumber.push_back(fi);
        byname[name] = bynumber.size() - 1;
}

int32_t FieldInfos::FieldNumber(const std::string & fieldname) const
{
        const FieldInfo * field = GetFieldInfo(fieldname);
        if (field)
            return field->number;
        else
            return -1;
}

const FieldInfo * FieldInfos::GetFieldInfo(const std::string & fieldname) const
{
        std::map<std::string, uint32_t>::const_iterator fieldinfo = byname.find(fieldname);
        if (fieldinfo != byname.end())
            return &bynumber[fieldinfo->second];
        else
            return NULL;
}

const std::string & FieldInfos::FieldName(uint32_t fieldnumber) const
{
        if (fieldnumber >= bynumber.size())
            throw LuceneException("Field number " + Blex::AnyToString(fieldnumber) + " out of bounds",false);
        return bynumber[fieldnumber].name;
}

const FieldInfo * FieldInfos::GetFieldInfo(uint32_t fieldnumber) const
{
        if (fieldnumber >= bynumber.size())
            throw LuceneException("Field number " + Blex::AnyToString(fieldnumber) + " out of bounds",false);
        return &bynumber[fieldnumber];
}

uint32_t FieldInfos::Size() const
{
        return bynumber.size();
}

void FieldInfos::Write(Blex::ComplexFileSystem &d, const std::string & name)
{
        const std::unique_ptr<Blex::ComplexFileStream> output(d.OpenFile(name,true,true));
        if (!output.get())
            throw LuceneException("Cannot create fields file "+name,false);
        Write(*output);
}

void FieldInfos::Write(Blex::ComplexFileStream &output)
{
        output.WriteLsb<uint32_t>(Size());
        for (std::vector<FieldInfo>::iterator it = bynumber.begin(); it != bynumber.end(); ++it)
        {
                output.WriteLsb<std::string>((*it).name);
                output.WriteLsb<uint8_t>((uint8_t)((*it).isindexed ? 1 : 0));
        }
}

void FieldInfos::Read(Blex::ComplexFileStream &input)
{
        uint32_t size = input.ReadLsb<uint32_t>();
        if (size >= MaxFieldsInSegment)
            throw LuceneException("Found " + Blex::AnyToString(size) + " fields in segment, max is " + Blex::AnyToString(MaxFieldsInSegment),false);

        for (uint32_t i = 0; i < size; i++)
        {
                std::string name = input.ReadLsb<std::string>();
                AddInternal(name, input.ReadLsb<uint8_t>() != 0);
        }
}

} // namespace Lucene

