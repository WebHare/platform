# Application portal
The application portal filetype hosts the actual Tollium interface

## Portal startup options
You can pass the following variables on the URL to customize or debug various Tollium issues:
```
- app=[appname]           Launch the specified app (eg ?app=publisher:app). Launch multiple apps by adding more "app" web variables (?app=1&app=2&app=3)
- profile=[profiles]      Generate profiling information (profiles is one or more of 'calls','objects','memory', comma separated)
- openas=[username]       Log in as the specified user (requires sysop privileges)
- language=[en]           Override the user language
- intolerant=1            Throw on error conditions, instead of just trying to make it work
- transport=[transport]   Force transport type. (transport must be one of 'shardedworker', 'jsonrpc' or 'websocket')
- go=                     Portal/frontend specific parameters
- notifications=0         Disable notifications
```
