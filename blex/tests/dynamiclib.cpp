#define BLEXLIB_PUBLIC __attribute__((visibility("default")))
#define BLEXLIB_LOCAL  __attribute__((visibility("hidden")))

extern "C"
{
        int BLEXLIB_PUBLIC MyFunction(int challenge)
        {
                return challenge + 42;
        }
}
