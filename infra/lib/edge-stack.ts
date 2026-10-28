import { CfnOutput, Stack, type StackProps } from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import type { Construct } from "constructs";
import type { AppConfig } from "./config";

export interface EdgeStackProps extends StackProps {
  config: AppConfig;
}

/**
 * us-east-1 resources that CloudFront requires to live there:
 * the WAF web ACL (scope CLOUDFRONT) and the ACM certificates.
 */
export class EdgeStack extends Stack {
  readonly webAclArn?: string;
  readonly customerCert?: acm.ICertificate;
  readonly adminCert?: acm.ICertificate;

  constructor(scope: Construct, id: string, props: EdgeStackProps) {
    super(scope, id, props);
    const { config } = props;

    if (config.enableWaf) {
      const managed = (
        name: string,
        priority: number
      ): wafv2.CfnWebACL.RuleProperty => ({
        name,
        priority,
        overrideAction: { none: {} },
        statement: {
          managedRuleGroupStatement: { vendorName: "AWS", name }
        },
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          sampledRequestsEnabled: true,
          metricName: name
        }
      });

      const acl = new wafv2.CfnWebACL(this, "WebAcl", {
        name: `jj-edge-${config.envName}`,
        scope: "CLOUDFRONT",
        defaultAction: { allow: {} },
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          sampledRequestsEnabled: true,
          metricName: `jj-edge-${config.envName}`
        },
        rules: [
          managed("AWSManagedRulesAmazonIpReputationList", 0),
          managed("AWSManagedRulesCommonRuleSet", 1),
          managed("AWSManagedRulesKnownBadInputsRuleSet", 2),
          {
            name: "RateLimitPerIp",
            priority: 3,
            action: { block: {} },
            statement: {
              rateBasedStatement: { limit: 2000, aggregateKeyType: "IP" }
            },
            visibilityConfig: {
              cloudWatchMetricsEnabled: true,
              sampledRequestsEnabled: true,
              metricName: "RateLimitPerIp"
            }
          }
        ]
      });
      this.webAclArn = acl.attrArn;
      new CfnOutput(this, "WebAclArn", { value: acl.attrArn });
    }

    if (config.domain) {
      const zone = route53.HostedZone.fromLookup(this, "Zone", {
        domainName: config.domain.zoneName
      });
      this.customerCert = new acm.Certificate(this, "CustomerCert", {
        domainName: config.domain.customer,
        validation: acm.CertificateValidation.fromDns(zone)
      });
      this.adminCert = new acm.Certificate(this, "AdminCert", {
        domainName: config.domain.admin,
        validation: acm.CertificateValidation.fromDns(zone)
      });
    }
  }
}
