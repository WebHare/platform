# Elasticsearch
Consilio can be configured to use an external Elasticsearch cluster for storage.
We also ship a Elasticsearch with WebHare which Consilio can use (and which will
eventually replace its own index manager)

## Builtin Elasticsearch
To start the builtin elasticsearch engine, run `wh consilio:enable_builtin_elasticsearch`

### Useful commands
Useful commands for the builtin Elasticsearch, assuming it's running on the
default interface http://127.0.0.1:13685/

```bash
# Check health
curl 'http://127.0.0.1:13685/_cluster/health?pretty=true'

# List indices
curl 'http://127.0.0.1:13685/_cat/indices?v'

# Get field mapping for an index
curl 'http://127.0.0.1:13685/<indexname>/_mapping?pretty=true'

# Delete all indices starting with myprefix__
curl -XDELETE 'http://127.0.0.1:13685/myprefix__*'

# Run a Kibana for your local elasticsearch
brew install kibana #or whatever package manager you're using
kibana --elasticsearch.hosts=http://127.0.0.1:13685/
open http://127.0.0.1:5601/
```


### Troubleshooting
- `failed to obtain node locks`
If Elasticsearch shuts itself down complaining about locks, verify that no
other instance is already running

- newly created index not visible in Kibana
Indices will not show up in Kibana's "Create index pattern" page if they are
still empty.
