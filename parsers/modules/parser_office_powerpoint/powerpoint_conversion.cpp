#include <ap/libwebhare/allincludes.h>


#include "powerpoint.h"

namespace Parsers
{

namespace Office
{

namespace Powerpoint
{

/** FIXME: A function like this should be available in the dll interface */
std::unique_ptr<Blex::MemoryRWStream> ReadBlobAsStream(HSVM *hsvm, HSVM_VariableId varid)
{
        int blobid = HSVM_BlobOpen(hsvm, varid);
        int bloblength = HSVM_BlobLength(hsvm, varid);
        int chunksize = 8192;
        uint8_t buffer[8192];

        // Now start reading the file
        std::unique_ptr<Blex::MemoryRWStream> mystream;
        mystream.reset(new Blex::MemoryRWStream());
        Blex::FileOffset offset = 0;
        int to_read;
        while (bloblength)
        {
                to_read = bloblength > chunksize ? chunksize : bloblength;

                HSVM_BlobRead (hsvm, blobid, to_read, buffer);
                mystream->DirectWrite(offset, buffer, to_read);

                bloblength -= to_read;
                offset += to_read;
        }

        // Return the MemoryRWStream
        return mystream;
}

PowerpointConversion::PowerpointConversion(HSVM *_hsvm, HSVM_VariableId filedata)
{
        hsvm = _hsvm;
        std::unique_ptr<Blex::RandomStream> temp;
        temp.reset(ReadBlobAsStream(hsvm, filedata).release()); //BCB BUG workaround
        powerpointfile.reset(new Powerpointfile(temp));
}

void PowerpointConversion::GetCustomShows(HSVM_VariableId id_set)
{
        const std::vector<std::pair<std::string, std::vector<uint32_t> > > & custom_shows = powerpointfile->GetCustomShows();

        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_RecordArray);
        for (std::vector<std::pair<std::string, std::vector<uint32_t> > >::const_iterator it = custom_shows.begin();
                it != custom_shows.end(); ++it)
        {
                HSVM_VariableId nextrecord = HSVM_ArrayAppend(hsvm, id_set);

                HSVM_VariableId name_cell = HSVM_RecordCreate(hsvm, nextrecord, HSVM_GetColumnId(hsvm, "NAME"));
                HSVM_StringSetSTD(hsvm, name_cell, it->first);

                HSVM_VariableId slides_cell = HSVM_RecordCreate(hsvm, nextrecord, HSVM_GetColumnId(hsvm, "SLIDES"));
                HSVM_SetDefault(hsvm, slides_cell, HSVM_VAR_IntegerArray);

                // Now loop through all the slide id's
                for (std::vector<uint32_t>::const_iterator slideid_it = it->second.begin();
                        slideid_it != it->second.end(); ++slideid_it)
                {
                        HSVM_VariableId nextid = HSVM_ArrayAppend(hsvm, slides_cell);
                        HSVM_IntegerSet(hsvm, nextid, *slideid_it);
                }
        }
}

void PowerpointConversion::GetSlideList(HSVM_VariableId id_set)
{
        std::vector<uint32_t> slideids = powerpointfile->GetSlideList();

        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_IntegerArray);

        for (std::vector<uint32_t>::const_iterator it = slideids.begin();
                it != slideids.end(); ++it)
        {
                HSVM_VariableId id_cell = HSVM_ArrayAppend(hsvm, id_set);
                HSVM_IntegerSet(hsvm, id_cell, *it);
        }
}

void PowerpointConversion::GetSlideTexts(uint32_t slideid, HSVM_VariableId id_set)
{
        std::vector<Text> texts = powerpointfile->GetSlideTexts(slideid);

        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_RecordArray);
        // Now loop through all the texts
        for (std::vector<Text>::const_iterator it = texts.begin();
                it != texts.end(); ++it)
        {
                HSVM_VariableId nexttext = HSVM_ArrayAppend(hsvm, id_set);
                HSVM_VariableId type_cell = HSVM_RecordCreate(hsvm, nexttext, HSVM_GetColumnId(hsvm, "TYPE"));
                HSVM_VariableId text_cell = HSVM_RecordCreate(hsvm, nexttext, HSVM_GetColumnId(hsvm, "TEXT"));

                HSVM_IntegerSet(hsvm, type_cell, it->type);

                // Format the text in utf8
                std::string utf8str;
                Blex::UTF8Encoder<std::back_insert_iterator<std::string> > data_utf8_encoder(std::back_inserter(utf8str));
                for (unsigned i=0;i<it->data.size();++i)
                    data_utf8_encoder(it->data[i]);
                HSVM_StringSetSTD(hsvm, text_cell, utf8str);
        }
}

void PowerpointConversion::DecodeFile()
{
        powerpointfile->DecodeFile();
}

void PowerpointConversion::RenderSlide(int32_t slideid, DrawLib::BitmapInterface &canvas)
{
        powerpointfile->RenderSlide(slideid, &canvas, NULL);
}

void PowerpointConversion::RenderNotes(int32_t slideid, DrawLib::BitmapInterface &canvas)
{
        powerpointfile->RenderNotes(slideid, &canvas, NULL);
}

} //end namespace Powerpoint
} //end namespace Office
} //end namespace PArsers
