#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { ApiStack } from "../lib/api-stack";
import { AuthStack } from "../lib/auth-stack";
import { getConfig, stackName } from "../lib/config";
import { ListingStack } from "../lib/listing-stack";
import { ActivityStack } from "../lib/activity-stack";
import { EngagementStack } from "../lib/engagement-stack";
import { MediaStack } from "../lib/media-stack";
import { EdgeStack } from "../lib/edge-stack";
import { FrontendStack } from "../lib/frontend-stack";
import { PlatformStack } from "../lib/platform-stack";
import { SearchDataStack } from "../lib/search-data-stack";
import { SearchStack } from "../lib/search-stack";
import { TimesheetStack } from "../lib/timesheet-stack";

const app = new App();
const config = getConfig(app);

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: config.region
};
const usEast1 = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: "us-east-1"
};

const platform = new PlatformStack(app, stackName(config, "Platform"), {
  env,
  config
});

const auth = new AuthStack(app, stackName(config, "Auth"), { env, config });

const searchData = new SearchDataStack(app, stackName(config, "SearchData"), {
  env,
  config
});

const edge = new EdgeStack(app, stackName(config, "Edge"), {
  env: usEast1,
  crossRegionReferences: true,
  config
});

const api = new ApiStack(app, stackName(config, "Api"), {
  env,
  config,
  auth,
  searchTable: searchData.table,
  alarmTopic: platform.alarmTopic
});

new FrontendStack(app, stackName(config, "Frontend"), {
  env,
  crossRegionReferences: true,
  config,
  httpApi: api.httpApi,
  webAclArn: edge.webAclArn,
  customerCert: edge.customerCert,
  adminCert: edge.adminCert
});

new SearchStack(app, stackName(config, "Search"), {
  env,
  config,
  routes: api.routes,
  table: searchData.table,
  bus: platform.bus,
  alarmTopic: platform.alarmTopic,
  customerPool: auth.customerPool
});

new ListingStack(app, stackName(config, "Listing"), {
  env,
  config,
  routes: api.routes,
  bus: platform.bus,
  alarmTopic: platform.alarmTopic
});

new MediaStack(app, stackName(config, "Media"), {
  env,
  config,
  routes: api.routes,
  bus: platform.bus,
  alarmTopic: platform.alarmTopic
});

new EngagementStack(app, stackName(config, "Engagement"), {
  env,
  config,
  routes: api.routes,
  bus: platform.bus,
  alarmTopic: platform.alarmTopic
});

new TimesheetStack(app, stackName(config, "Timesheet"), {
  env,
  config,
  routes: api.routes,
  bus: platform.bus,
  alarmTopic: platform.alarmTopic
});

new ActivityStack(app, stackName(config, "Activity"), {
  env,
  config,
  routes: api.routes,
  bus: platform.bus,
  alarmTopic: platform.alarmTopic
});

app.synth();
