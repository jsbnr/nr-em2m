[![New Relic Experimental header](https://github.com/newrelic/opensource-website/raw/main/src/images/categories/Experimental.png)](https://opensource.newrelic.com/oss-category/#new-relic-experimental)

# em2m - Events & Metrics to Metrics Processor
This lightweight tool can be used to convert both events or metrics (derived from an NRQL query) into dimensional metrics. When run on a regular schedule it can perform continous data transalation.

** Important: In most cases the built in platform [Events to Metrics](https://docs.newrelic.com/docs/data-apis/convert-to-metrics/analyze-monitor-data-trends-metrics/) capability should be preferred to perform these operations, particularly at scale. The capability has some limitations that this tool provides solutions for. **

## What it does
You define a number of tasks to be processed. Each task provides an NRQL query that gathers data from NRDB (data at rest) at a specified resolution. The data is gathered and re-ingested as a dimensional metric.

The queries are run against NRDB instead of against incoming data streams so the full suite of NRQL query syntax is available to you: lookups, joins, nested aggregations, etc. Any data type that can be queried can be used as a source over any time frame and bucket size. 

### Features

- All NRQL query features supported
- Create metrics for custom bucket sizes (e.g. hourly)
- Create new metrics from the Metric data type
- Backfill (up to 48 hours)
- Multiple metrics and facets per task


### Use Case examples
Wondering why you might use this tool? Here are a few use cases that it assist with:

- Query timeslice metrics at greater than 1 hour resolution (e.g. 1 minutely) more than one week ago
- Create a metric from an event/metric using a custom aggregation or math operation (e.g. percentile)
- Create a metric thats based on data from more than one minute, for instance a rolling 5 minutely average or hourly order rate
- Use 'max()' to inspect infra metrics on time windows larger than 59 minutes. 
- View timeslice metrics older than a week old at minutely resolution
- Wanting to create a metric thats a result of a join, subquery or nested aggregation
- Copy metrics from one account to another 


### Reliability concerns
The script gathers data in a fault tolerant manner, it will gather data from failed runs where possible to ensure consistent uninterrupted data collection. However it is reliant upon both querying data and re-ingesting which could be affected by all manner of things such as network connectivity, maintenance or outages. You should avoid using this tool for critical business operations sensitive to data loss.

If you run this tool via a synthetic monitor then you may consider configuring an alert to notify you of failed runs or data loss.

Beware of running the tool on data that has yet to settle, the task configuration allows for a buffer to be supplied.

## Installation and setup
You can run the script on your own VM, in a synthetic monitor or locally on your machine (for testing)

### Synthetic Monitor Deployment 
Copy the content of [em2m.js](./em2m.js) into a New Relic API monitor. Set the values as required at the top of the script. Details on task settings can be found below.

Set the monitor name and ID as approriate for the monitor you have set the script up in. You could use any ID and name you like too, this only really matters if you;re running more than one instance in an account.

You will need to specify two API keys, one a user key api and one ingest insert key. These are to query and inject the data respectively. We recommend that you store these in the secure credential store.

### Running locally mode
You can run and test on your local machine. With nodejs installed run `npm install` to install dependencies. Then edit the file em2m.js file accordingly (adding your own API keys where approriate in the local config section and setting up your tasks manually). Run the sript with `node em2m.js` 

## Task configuration
You configure tasks through the TASKS object. 

Each task you can specify:

- **id**: A unique ID for this task
- **metricName**: Name of the metric(s), this will be prefixed with the namespace "em2m."
- **offsetFromNowBuffer** (mins): A buffer to avoid querying data thats not yet arrived. Data fresher than this will be ignored and picked up in next run.
- **rehydrateLookback** (mins): If script has never run or the last run not found, specify how far to go back in history to retrieve data (max 48hrs)
- **accountId**: The account ID to run the query against to gather data
- **bucketSize** (seconds): The size of buckets in seconds. e.g. 60 = 1 minute, data will be aggregated in 1 minute blocks using TIMESERIES.
- **selector**: The name of the field(s) containing the data. e.g. 'value'. This supports dot notation, e.g to reference the value of `..percentile(duration,95) as value...` you would set the selector to  `value.95`
- **query**: The NRQL to run. Its best to name your return values using the `as` operator. e.g. `FROM Public_APICall select count(*) as value since 1 day ago compare with 1 week ago`. Facets are supported, each result will be reported as a seperate metric value with the facets added as a dimensional attribute.


```javascript
const TASKS = [
{
    "id":"example1",
    "metricName":"example1cpu",
    "offsetFromNowBuffer": 5,
    "rehydrateLookback": 60,
    "accountId":"3934073",
    "bucketSize": 60,
    "selector":["max","min","records","percentile.95","average","processorCount"], 
    "query":`FROM SystemSample select max(cpuPercent) as max, max(cpuPercent) as min, count(*) as records, percentile(cpuPercent,95) as percentile, average(cpuPercent) as average, average(numeric(processorCount)) as processorCount  where cpuPercent is not null facet hostname, entityGuid`,
}]

```

## Querying the metrics created
The script will process each task in the TASKS array and drop a metric into New Relic via the metrics API. Each metric will be named with the pattern: `namespace.taskMetricName.field` 
For instance in the example above, the max value could be queried as follows:

```
SELECT max(em2m.example1cpu.max) FROM Metric SINCE 1 hour AGO TIMESERIES
```

## Support

New Relic has open-sourced this project. This project is provided AS-IS WITHOUT WARRANTY OR DEDICATED SUPPORT. Issues and contributions should be reported to the project here on GitHub.

>We encourage you to bring your experiences and questions to the [Explorers Hub](https://discuss.newrelic.com) where our community members collaborate on solutions and new ideas.


## Contributing

We encourage your contributions to improve [Project Name]! Keep in mind when you submit your pull request, you'll need to sign the CLA via the click-through using CLA-Assistant. You only have to sign the CLA one time per project. If you have any questions, or to execute our corporate CLA, required if your contribution is on behalf of a company, please drop us an email at opensource@newrelic.com.

**A note about vulnerabilities**

As noted in our [security policy](../../security/policy), New Relic is committed to the privacy and security of our customers and their data. We believe that providing coordinated disclosure by security researchers and engaging with the security community are important means to achieve our security goals.

If you believe you have found a security vulnerability in this project or any of New Relic's products or websites, we welcome and greatly appreciate you reporting it to New Relic through [HackerOne](https://hackerone.com/newrelic).

## License

EM2M is licensed under the [Apache 2.0](http://apache.org/licenses/LICENSE-2.0.txt) License.

