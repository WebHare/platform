#include <ap/libwebhare/allincludes.h>


#include "consilio.h"

LuceneException::LuceneException(std::string const &msg, bool is_fatal)
: std::runtime_error(msg)
, _fatal(is_fatal)
{}

LuceneException::~LuceneException() throw()
{}









