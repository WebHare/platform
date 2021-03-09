WARNING: this documentation was written when dompack was a separate module and may be out of date

# Current guidelines
- coding style
  - mark private/internal stuff in public classes with a starting underscore
- exports from src/index.es should have the same name as the exports in their packages
  - to allow easily switching from 'whole package' to 'specific' and back
  - less confusing
- things not needed to build components go into extra/
  - cookies is in addons because components should not rely on those - always extract persistence options (browser storage is usually better)
  - urlbuilder is likewise not needed
- we should be small, but not smallest
  - we accept having a bit of debug code in production code, especially on codepaths which are often involved in races
