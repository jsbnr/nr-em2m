
const NEWRELIC_DC = "US";        // datacenter for account - US or EU
const ACCOUNT_ID = "1234567";    // Account ID (required if ingesting events)

let INSERT_KEY="...FNRAL"         // Ingest API Key (Please provide with secure credential if possible.) //e.g. $secure.YOU_CREDENTIAL_NAME
let QUERY_KEY="NRAK-..."          // User API Key (Please provide with secure credential if possible.)

// Task configuration

const TASKS = [
{
    "id":"example1",            // a unique ID for this task
    "metricName":"example1cpu",    // Name of the metric, this will be prefixed with the namespace "em2m."
    "offsetFromNowBuffer": 5,   // minutes - data fresher than this will be ignored (and picked up in next run)
    "rehydrateLookback": 60,    // minutes - If never run or last run not found, how far to go back an retrieve data (max 48hrs)
    "accountId":"1234567",      // Account ID to gather data from
    "bucketSize": 60,           // The size of bucket in seconds. e.g. 60 = 1 minute, data will be aggregated in 1 minute blocks.
    "selector":["max","min","records","percentile.95","average","processorCount"],  // The fields from the query (below) to record as metrics. 
    "query":`FROM SystemSample select max(cpuPercent) as max, max(cpuPercent) as min, count(*) as records, percentile(cpuPercent,95) as percentile, average(cpuPercent) as average, average(numeric(processorCount)) as processorCount  where cpuPercent is not null facet hostname, entityGuid`,
}]


// Optional Configuration
const MONITOR_NAME="EM2M " ;    // the monitor name, only really relevant if deploying more than monitor
const DEFAULT_TIMEOUT = 15000   // default timeout for queries, in ms
const NAMESPACE ="em2m"         // metric names are prefixed with this
const DEFAULT_REHYDRATE_LOOKBACK= 125;      // minutes to rehydrate from if no pre-existing data
const DEFAULT_TIME_UNTIl_NOW_BUFFER= 10;    // minutes from now to cease lookup (as data may not have arrived yet to be queried)
const MAX_BUCKETS_PER_QUERY=200;            // max number of data points to request at once (366 is max supported by timeseries)
const MAX_METRICS_PER_SEND_BATCH=2000       // how many metrics to send to new relic in a single payload (batching occurs)

const INGEST_METRIC_ENDPOINT = NEWRELIC_DC === "EU" ? "metric-api.eu.newrelic.com" : "metric-api.newrelic.com" 
const GRAPHQL_ENDPOINT = NEWRELIC_DC === "EU" ? "api.eu.newrelic.com" : "api.newrelic.com" 


let assert = require('assert');
let _ = require("lodash");

let RUNNING_LOCALLY = false

/*
*  ========== LOCAL TESTING CONFIGURATION ===========================
*  This section allows you to run the script from your local machine
*  mimicking it running in the new relic environment. Much easier to develop!
*/

const IS_LOCAL_ENV = typeof $http === 'undefined';
if (IS_LOCAL_ENV) {  
  RUNNING_LOCALLY=true
  var $http = require("request");
  console.log("Running in local mode",true)
} 

/*
*  ========== SOME HELPER FUNCTIONS ===========================
*/


//returns date ('now' unless supplied) rounded down to nearest bucket (1=1 minute, 15=15 minutes, etc), with optional offset from now (minutes)
function getRoundedDateUnixTime(minutes, offset = 0 , d=new Date()) {
    let ms = 1000 * 60 * minutes; // convert minutes to ms
    let offsetMins = offset * 1000 * 60; //calculate offset in minutes
    let date = new Date(Math.floor((d.getTime() -offsetMins) / ms) * ms);
    return date.getTime()
  }
//Readable date 
function formatDateFromUnix(d) {
    let date = new Date(d);
    let formatted = date.getFullYear() + '-' + `${date.getMonth() + 1}`.padStart(2, '0') + '-' + `${date.getDate()}`.padStart(2, '0') + ' ' + `${date.getHours()}`.padStart(2, '0') + ':' + `${date.getMinutes()}`.padStart(2, '0');
    return formatted;
}

/*
* asyncForEach()
*
* A handy version of forEach that supports await.
* @param {Object[]} array     - An array of things to iterate over
* @param {function} callback  - The callback for each item
*/
async function asyncForEach(array, callback) {
    for (let index = 0; index < array.length; index++) {
        await callback(array[index], index, array);
    }
}
  
/*
* isObject()
*
* A handy check for if a var is an object
*/
function isObject(val) {
    if (val === null) { return false;}
    return ( (typeof val === 'function') || (typeof val === 'object') );
}

/*
* genericServiceCall()
* Generic service call helper for commonly repeated tasks
*
* @param {number} responseCodes  - The response code (or array of codes) expected from the api call (e.g. 200 or [200,201])
* @param {Object} options       - The standard http request options object
* @param {function} success     - Call back function to run on successfule request
*/
const  genericServiceCall = function(responseCodes,options,success) {
    !('timeout' in options) && (options.timeout = DEFAULT_TIMEOUT) //add a timeout if not already specified 
    let possibleResponseCodes=responseCodes
    if(typeof(responseCodes) == 'number') { //convert to array if not supplied as array
      possibleResponseCodes=[responseCodes]
    }
    return new Promise((resolve, reject) => {
        $http(options, function callback(error, response, body) {
        if(error) {
            console.log(`Error: Connection error on url '${options.url}'`);
            reject(`Connection error on url '${options.url}'`)
        } else {
            if(!possibleResponseCodes.includes(response.statusCode)) {
                let errmsg=`Expected [${possibleResponseCodes}] response code but got '${response.statusCode}' from url '${options.url}'`
                reject(errmsg)
            } else {
                resolve(success(body,response,error))
            }
          }
        });
    })
  }

/*
* setAttribute()
* Sets a custom attribute on the synthetic record
*
* @param {string} key               - the key name
* @param {Strin|Object} value       - the value to set
*/
const setAttribute = function(key,value) {
    if(!RUNNING_LOCALLY) { //these only make sense when running on a minion
        $util.insights.set(key,value)
    } else {
        //log(`Set attribute '${key}' to ${value}`)
    }
}


/*
* sendDataToNewRelic()
* Sends a metrics payload to New Relic
*
* @param {object} data               - the payload to send
*/
const sendDataToNewRelic = async (data) =>  {
    let request = {
        url: `https://${INGEST_METRIC_ENDPOINT}/metric/v1`,
        method: 'POST',
        headers :{
            "Api-Key": INSERT_KEY
        },
        body: JSON.stringify(data)
    }
    //log(`Sending ${data[0].metrics.length} records to NR metrics API...`)

    return genericServiceCall([200,202],request,(body,response,error)=>{
        if(error) {
            console.log(`NR Post failed : ${error} `,true)
            return false
        } else {
            return true
        }
    })
}


//Derive metrics from the queried data
const processTimeseriesData = (data,selector,metricName) => {
    // console.log(data.nrql.results);
    const results = data?.nrql?.results;
    const facets = data?.nrql?.metadata?.facets;

    // console.log(results);
    // console.log(facets);

    let metricResults=[];
    if(results) {
        results.forEach((result)=>{

            let facetsObject={};
            if(facets) {
                facets.forEach((facet,idx)=>{
                    if(Array.isArray(result.facet)) { //if one facet its a string, more than one an array of strings
                        facetsObject[facet]=result.facet[idx];
                    } else {
                        facetsObject[facet]=result.facet;
                    } 
                });
            }
            //support for multiple selectors
            let selectorArray=[];
            if(Array.isArray(selector)) {
                selectorArray=selector;
            } else {
                selectorArray=[selector]
            }

            selectorArray.forEach((slct)=>{
                metricResults.push({
                    name: `${NAMESPACE}.${metricName}.${slct}`,
                    type: "gauge",
                    value: _.get(result,slct),
                    timestamp: result.beginTimeSeconds,
                    attributes: facetsObject
                })
            })
             

        })
        return metricResults;

    } else {
        console.log("Error: No results to process");
        throw("No results to process");
    }

}

// Configure the metric payload with common block etc
const prepareMetricPayload = (taskId,metrics) => {
    let commonMetricBlock={"attributes": {}}
    commonMetricBlock.attributes[`${NAMESPACE}.monitorName`]=MONITOR_NAME
    commonMetricBlock.attributes[`${NAMESPACE}.task.Id`]=taskId;
    commonMetricBlock.attributes[`source`]=NAMESPACE;

    let metricsPayLoad=[{ 
        "common" : commonMetricBlock,
        "metrics": metrics
    }];

    return metricsPayLoad;
}

//Parse a GQL response object
const JSONParseGraphQLResponse = (data) => {
     try {
        if(isObject(data)) {
            return data
        } else {
            return JSON.parse(data)
        }        
    } catch(e){
        console.log("JSON parse failed")
        throw e;
    }
}

// Send NRQL query to NR
const queryNRQL = async (accountId,query) => {
    const graphQLQuery=`{
        actor {
          account(id: ${accountId}) {
            nrql(query: "${query}") {
              results
              metadata {
                facets
              }
            }
          }
        }
      }
      `
    const options =  {
        url: `https://${GRAPHQL_ENDPOINT}/graphql`,
        method: 'POST',
        headers :{
            "Content-Type": "application/json",
            "API-Key": QUERY_KEY
        },
        body: JSON.stringify({ "query": graphQLQuery})
    };

    try {
        const response = await genericServiceCall([200],options,(body)=>{return body})
        const responseObject = JSONParseGraphQLResponse(response);
        return responseObject;
    } catch(e) {
        throw e
    }
   
}

//Get all the last run timestamps for all tasks
const getLastRunTimestamps = async (tasks) => {
    console.log("Determing hydration start times...");
    let metricTaskIds = tasks.map(task=>{
        return `\'${task.id}\'`;

    });
    
    const query=`select latest(timestamp) as latestTimestamp from Metric RAW since 48 hours ago facet ${NAMESPACE}.task.Id as 'taskId' where ${NAMESPACE}.task.Id in (${metricTaskIds.toString()}) limit max`;
    const response = await queryNRQL(ACCOUNT_ID,query, "Gather last run by task");
    const results=response?.data?.actor?.account?.nrql?.results;

    tasks.forEach(task=>{
        let result;
        if(results) {
            result = results.find((rst) => `${task.id}` === rst.taskId);
        }
        if(result) {
            task.lastRunTimestamp = result.latestTimestamp + (task.bucketSize *1000); //avoid reprocessing the same bucket form end of last run
            console.log(`${task.id}: Last run discovered, rehydrating from ${formatDateFromUnix(task.lastRunTimestamp)}`);
        } else {
            let rehydrateLookback = task.rehydrateLookback? task.rehydrateLookback : DEFAULT_REHYDRATE_LOOKBACK;
            task.lastRunTimestamp = getRoundedDateUnixTime(task.bucketSize/60,rehydrateLookback);
            console.log(`${task.id}: No previous data found, rehydrating from ${formatDateFromUnix(task.lastRunTimestamp)}`);
        }
    });
}

//create the necessary lookup queries, batching as required
const deriveLookupQueries = (task) => {
    let queryTimestampEnd = getRoundedDateUnixTime(task.bucketSize/60, task.offsetFromNowBuffer ? task.offsetFromNowBuffer : DEFAULT_TIME_UNTIl_NOW_BUFFER);
    let windowSizeMs=queryTimestampEnd-task.lastRunTimestamp;
    let bucketsInHydrationWindow= windowSizeMs / (task.bucketSize*1000);
    let queryBatches=Math.ceil(bucketsInHydrationWindow / MAX_BUCKETS_PER_QUERY);
    
    console.log(`Query time window: ${formatDateFromUnix(task.lastRunTimestamp)} until ${formatDateFromUnix(queryTimestampEnd)}`);
    console.log("Buckets in window:",Math.ceil(bucketsInHydrationWindow));
    console.log("Query batches:",queryBatches);
    
    const queries = [];
    let sinceTime=task.lastRunTimestamp;
    for (let batch = 0; batch < queryBatches; batch++) {
        let untilTime=sinceTime + (MAX_BUCKETS_PER_QUERY * (task.bucketSize*1000));
        untilTime = untilTime > queryTimestampEnd ?  queryTimestampEnd : untilTime;
        //console.log(`Batch ${batch+1}: since ${formatDateFromUnix(sinceTime)} until ${formatDateFromUnix(untilTime)}`);
        queries.push({
            query : task.query + ` SINCE ${sinceTime} UNTIL ${untilTime} TIMESERIES ${task.bucketSize} seconds`,
            sinceTime: sinceTime, 
            untilTime: untilTime
        });
        sinceTime=untilTime;
    }
    task.queries=queries;
}

// Construct and query data for each task
const processTaskQueries = async (task) =>{
    console.log("");
    let combinedMetricData=[]
    await asyncForEach(task.queries, async (query,idx) => {
        try {
            console.log(`Querying batch ${idx+1}/${task.queries.length} ...  ${formatDateFromUnix(query.sinceTime)} until ${formatDateFromUnix(query.untilTime)}`);
            const result = await queryNRQL(task.accountId,query.query);
            const metricData = await processTimeseriesData(result?.data?.actor?.account, task.selector, task.metricName);
            combinedMetricData=[...combinedMetricData, ...metricData];
        } catch (e) {
            console.log(`Error fetching data for this batch`);
            throw(e);
        }
    });
    console.log(`Metrics retrieved:`,combinedMetricData.length);
    return combinedMetricData;
}

// Send derived metrics back to New Relic in batches
const sendDataToNewRelicInBatches = async (task, metricData) => {
    const batches = Math.ceil(metricData.length / MAX_METRICS_PER_SEND_BATCH);
    console.log(`Data send batches:`,batches);
    for (let batch = 0; batch < batches; batch++) {
        let batchMetrics=metricData.slice(batch*MAX_METRICS_PER_SEND_BATCH,(batch*MAX_METRICS_PER_SEND_BATCH) + MAX_METRICS_PER_SEND_BATCH);
        console.log(`Sending batch ${batch+1}/${batches}...`)
        try {
            await sendDataToNewRelic(prepareMetricPayload(task.id, batchMetrics ));
        } catch (error) {
            throw("Data send to NR failed");
        }
    } 
}

// Run and interate across the tasks
async function runtasks(tasks) {
    let TASK_DATA = {
        TOTAL_TASKS:tasks.length,
        ATTEMPTED_TASKS:0,
        SUCCESSFUL_TASKS:0,
        FAILED_TASKS:0
    }
    //Detemermine how far back to hydrate each task
    await getLastRunTimestamps(tasks);

    //process each task
    try {
        await asyncForEach(tasks, async (task) => {
            TASK_DATA.ATTEMPTED_TASKS++;
            console.log(`\n[Task ${task.id}]---------------`)

            deriveLookupQueries(task);
            try {
                const metricData = await processTaskQueries(task);
                await sendDataToNewRelicInBatches(task,metricData);
                TASK_DATA.SUCCESSFUL_TASKS++;
            } catch(e) {
                console.log("Error: Something went wrong with this task marking as failed.");
                TASK_DATA.FAILED_TASKS++;
            }

        })
    } catch(e) {
        console.log("An error occured:",e)
    }
    return TASK_DATA;

}
/*
*  ========== RUN THE tasks ===========================
*/


try {
    setAttribute("totalTasksConfigured",TASKS.length)
    runtasks(TASKS).then((TASK_DATA)=>{
        console.log("\n\n---------------------");
        console.log("Task completion summary:", TASK_DATA);
        setAttribute("taskRunComplete","YES") //to ensure we've not timed out or broken somehow
        setAttribute("taskTotal",TASK_DATA.TOTAL_TASKS);
        setAttribute("taskFailed",TASK_DATA.FAILED_TASKS);
        setAttribute("taskSuccess",TASK_DATA.SUCCESSFUL_TASKS);
        setAttribute("taskAttempted",TASK_DATA.ATTEMPTED_TASKS);
        if(TASK_DATA.FAILED_TASKS > 0 ) {
            setAttribute("taskResult","FAILED");
            assert.fail('Not all tasks ran successfully') //assert a failure so that NR sees it as a failed test
        } else {
            setAttribute("taskResult","SUCCESS")
            console.log("Script complete.")
            assert.ok("All tasks passed")   
        }
    })

} catch(e) {
    console.log("Unexpected errors: ",e)
}