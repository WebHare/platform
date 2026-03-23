Simplified Blob packet format:
```
  size: U64             //0 byte blobs take up 8 bytes
  if(size > 0)
    type: U8, 0 = Embed, 1 = Path
    if(type = 1)
      pathLen: U32
      path              //so we end up at 8 + 1 + 4 + pathLen usage
    else if (!packet)
      blob data         //so we end up at 8 + 1 + size
    else
      blob seqnr in aux data  //so we end up at 8 + 1 + 4 bytes
```
