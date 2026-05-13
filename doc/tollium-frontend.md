# DRY Dimensions
We want to avoid specifying dimensions information needed for calculateDimHeight in more than one place.

We should be able to read most metrics from CSS as long as CSS is applied.

An experimental pattern for this, see section.ts:

```typescript
  static cachedDimensions?: {
    overheadHeight: number;
  };

  static getCachedDimensions(sample: ObjSection) {
    this.cachedDimensions = {
      overheadHeight: ...
    };
    return this.cachedDimensions;
  }

  calculateDimWidth() {
    ObjSection.cachedDimensions ||= ObjSection.getCachedDimensions(this);
    ...
  }
```

TODO:
- generalize pattern (if it works)
- can we work around the need for `!` when accessing cachedDimensions without having to do the `ObjSection.cachedDimensions ||=` at the top of every function?
