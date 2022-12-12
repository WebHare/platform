# OpenSearch
WebHare ships with an embedded OpenSearch server for Consilio's usage which by default
runs on localhost on the baseport + 6 (usually 13685).
Consilio can also be configured to use an external OpenSearch cluster for storage.

### Useful commands
Useful commands for the builtin OpenSearch:

```bash
# Check health
wh consilio:opensearch_curl '/_cluster/health?pretty=true'

# List plugins (eg to check if analysis-icu is there)
wh consilio:opensearch_curl '/_cat/plugins?v'

# List indices
wh consilio:opensearch_curl '/_cat/indices?v'

# Get field mapping for an index
wh consilio:opensearch_curl '/<indexname>/_mapping?pretty=true'

# Delete all indices starting with myprefix__
wh consilio:opensearch_curl -XDELETE '/myprefix__*'

# Run a dashboard for your local opensearch, MacOS with homebrew. Update URLs as needed:
brew install opensearch-dashboards
/usr/local/opt/opensearch-dashboards/bin/opensearch-dashboards --opensearch.hosts=http://127.0.0.1:13685/
open http://127.0.0.1:5601/
```

You can also access OpenSearch over http://127.0.0.1:13685/ in WebHare's default configuration, but `wh consilio:opensearch_url`
will look up the exact URL for you.


### Troubleshooting
- `failed to obtain node locks`
If OpenSearch shuts itself down complaining about locks, verify that no
other instance is already running

- newly created index not visible in Dashboard
Indices will not show up in the dashboard's "Create index pattern" page if they are
still empty.

## Dashboard
You can connect an OpenSearch Dashboard to the builtin OpenSearch server by
creating a personal App account of type 'consilio:opensearch'. You'll need to
be a sysop to access OpenSearch.

Use the supplied password to construct a URL to OpenSearch: `https://login:password@my.webhare.dev/.consilio/builtin-opensearch/`.
Update the username, password and hostname as neeed.

(keep in mind that any `@` in your loginname needs to be escaped as %40 per standard URL rules)

You can test your URL by passing it to `curl` - it should show some JSON output. This will also show you the version
number of OpenSearch - you will need the Dashboard to be the same version

The easiest way to start the Dashboard is probably to use the docker container for OpenSearch dashboard as follows:

```
docker run -p 127.0.0.1:5601:5601\
           -e OPENSEARCH_HOSTS='["https://my.webhare.dev/.consilio/builtin-opensearch/"]'\
           -e OPENSEARCH_USERNAME="login"\
           -e OPENSEARCH_PASSWORD="password"\
           -e DISABLE_SECURITY_DASHBOARDS_PLUGIN=true\
           --rm\
           opensearchproject/opensearch-dashboards:2.2.0
```

Update the environment variables and version number as needed.

The OpenSearch Dashboard docker will say something like `Server running at http://127.0.0.1:5601`, which is the url to use to open the Dashboard
