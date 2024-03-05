// Essential Configuration ------------------------------------------------------------
const NEWRELIC_DC = "US";        // datacenter for account - US or EU
const SRC_ACCOUNT_ID = "1234567"    //Account ID of account tosource data from
const SRC_QUERY_KEY = "NRAK-..."    // User API Key for reading data (Please provide with secure credential if possible.)
const DEST_INSERT_KEY="...FNRAL"    // Ingest API Key for sending data (Please provide with secure credential if possible.) //e.g. $secure.YOU_CREDENTIAL_NAME

// Configure these values only if your destination account is different to that in which data is sourced.
const DEST_ACCOUNT_ID = SRC_ACCOUNT_ID;  // Account ID to record data back to
const DEST_QUERY_KEY = SRC_QUERY_KEY;    // User API Key of the destination account.



// Optional Configuration ------------------------------------------------------------
const MONITOR_NAME="EM2M " ;    // the monitor name, only really relevant if deploying more than monitor
const DEFAULT_TIMEOUT = 15000   // default timeout for queries, in ms
const NAMESPACE ="em2m"         // metric names are prefixed with this
const DEFAULT_REHYDRATE_LOOKBACK= 125;      // minutes to rehydrate from if no pre-existing data
const DEFAULT_TIME_UNTIl_NOW_BUFFER= 10;    // minutes from now to cease lookup (as data may not have arrived yet to be queried)
const MAX_BUCKETS_PER_QUERY=200;            // max number of data points to request at once (366 is max supported by timeseries)
const MAX_METRICS_PER_SEND_BATCH=2000       // how many metrics to send to new relic in a single payload (batching occurs)

const INGEST_METRIC_ENDPOINT = NEWRELIC_DC === "EU" ? "metric-api.eu.newrelic.com" : "metric-api.newrelic.com" 
const GRAPHQL_ENDPOINT = NEWRELIC_DC === "EU" ? "api.eu.newrelic.com" : "api.newrelic.com" 


// Task configuration -------------------------------------------------------------
const TASKS = [
{
    "id":"example1",            // a unique ID for this task
    "metricName":"example1cpu", // Name of the metric, this will be prefixed with the namespace "em2m."
    "offsetFromNowBuffer": 5,   // minutes - data fresher than this will be ignored (and picked up in next run)
    "rehydrateLookback": 60,    // minutes - If never run or last run not found, how far to go back an retrieve data (max 48hrs)
    "accountId":"1234567",      // Account ID to gather data from
    "bucketSize": 60,           // The size of bucket in seconds. e.g. 60 = 1 minute, data will be aggregated in 1 minute blocks.
    "selector":["max","min","records","percentile.95","average","processorCount"],  // The fields from the query (below) to record as metrics. 
    "query":`FROM SystemSample select max(cpuPercent) as max, min(cpuPercent) as min, count(*) as records, percentile(cpuPercent,95) as percentile, average(cpuPercent) as average, average(numeric(processorCount)) as processorCount  where cpuPercent is not null facet hostname, entityGuid`,
}]


// End Configuration ---------------------------------------------------------------

