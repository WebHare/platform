#ifndef blex_consilio_document_field
#define blex_consilio_document_field

#include <blex/blexlib.h>
#include <blex/datetime.h>
#include <blex/complexfs.h>
#include "consilio.h"

namespace Lucene
{

/** A single Field in a Document.
    Field%s consist of a name, which is used to identify the Field, and a value,
    which can be a single string value or a Blex::RandomStream, in which case
    the actual string value is read from the specified file. A Field can be
    - @c stored, in which case the Field is stored entirely in the index and
    can be retrieved later, along with search results;
    - @c indexed, in which case the Field is indexed, so its contents can be
    found while searching the index;
    - or @c tokenized, which means the value of the Field is split into words
    before it is indexed
    .
    or any combination of those attributes. */
class Field
{
    public:
        /** Create a Field with a string value and some other attributes.
            @param name This Field's name
            @param string This Field's string value
            @param store This Field should be stored entirely in the index
            @param index This Field should be indexed
            @param token This Field should be tokenized (split into words) */
        Field(const std::string & name, const std::string & string,
              bool store, bool index, bool token);
        /** Create a Field, the value of which will be read from a Blex::RandomStream.
            The Field is tokenized and indexed, but not stored.
            @param name This Field's name
            @param reader The Blex::RandomStream to read this Field's value
                          from */
        Field(const std::string & name, std::shared_ptr<Blex::RandomStream> & reader);

        /** Get a Field with a given name and string value. The Field is stored
            and indexed, but not tokenized.
            @param name The name of the new Field
            @param value The value of the new Field */
        static Field Keyword(const std::string & name, const std::string & value);
        /** Get a DateTime Field with a given name and value. The Field is stored
            and indexed, but not tokenized.
            @param name The name of the new Field
            @param value The DateTime value of the new Field */
//        static Field Keyword(const std::string & name, const Blex::DateTime & value);
        /** Get a Field with a given name and value. The Field is indexed, but not
            stored nor tokenized.
            @param name The name of the new Field
            @param value The value of the new Field */
        static Field Indexed(const std::string & name, const std::string & value);
        /** Get a DateTime Field with a given name and value. The Field is indexed,
            but not stored nor tokenized.
            @param name The name of the new Field
            @param value The DateTime value of the new Field */
//        static Field Indexed(const std::string & name, const Blex::DateTime & value);
        /** Get a Field with a given name and value. The Field is stored, but not
            tokenized nor indexed.
            @param name The name of the new Field
            @param value The value of the new Field */
        static Field UnIndexed(const std::string & name, const std::string & value);
        /** Get a Field with a given name and value. The Field is tokenized and
            indexed, but not stored.
            @param name The name of the new Field
            @param value The value of the new Field */
        static Field Text(const std::string & name, const std::string & value);
        /** Get a Field with a given name. The value of the Field should be read
            from a Blex::RandomStream. The Field is tokenized and indexed, but
            not stored.
            @param name The name of the new Field
            @param reader The Blex::RandomStream to read the value from */
        static Field Text(const std::string & name, std::shared_ptr<Blex::RandomStream> & reader);

        /** Set the boost factor for this Field.
            @param boost The new boost factor */
        void SetBoost(float boost);
        /** Get the current boost factor for this Field.
            @return The current boost factor */
        float GetBoost() const;

        /** Get this Field's name.
            @return The name of the Field */
        const std::string & Name() const;
        /** Get this Field's string value. This function returns an empty string
            for Field%s with a Blex::RandomStream reader.
            @return The string value of this Field */
        const std::string & StringValue() const;
        /** Get this Field's Blex::RandomStream reader. The function returns
            NULL for Field%s with a string value.
            @return The Blex::RandomStream reader value of this Field */
        const std::shared_ptr<Blex::RandomStream> & ReaderValue() const;

        /** Is this Field stored? */
        bool IsStored() const;
        /** Is this Field indexed? */
        bool IsIndexed() const;
        /** Is this Field tokenized? */
        bool IsTokenized() const;

        /** Get a string representation of this Field. This is this Field's name,
            followed by its value.
            @return A string representing this Field */
        std::string ToString() const;

    private:
        /// Field name
        std::string name;
        /// String value (empty for fields with a reader)
        std::string stringvalue;
        /// Blex::RandomStream to read this Field's value from (NULL for fields
        /// with a string value)
        std::shared_ptr<Blex::RandomStream> readervalue;
        /// This Field should be stored
        bool isstored;
        /// This Field should be indexed
        bool isindexed;
        /// This Field should be tokenized before indexing
        bool istokenized;
        /// Boost factor
        float boost;
};

/** Returns whether a field is tokenized (if not, keep the content as-is, for example groupid, indexid, date_*)
    @param field Field name
*/
bool IsTokenizedField(const std::string &field);


} // namespace Lucene

#endif

