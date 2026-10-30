import { CfnOutput, Stack, type StackProps } from "aws-cdk-lib";
import type * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as r53targets from "aws-cdk-lib/aws-route53-targets";
import * as s3 from "aws-cdk-lib/aws-s3";
import type * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import type { Construct } from "constructs";
import type { AppConfig } from "./config";

export interface FrontendStackProps extends StackProps {
  config: AppConfig;
  httpApi: apigwv2.HttpApi;
  webAclArn?: string;
  customerCert?: acm.ICertificate;
  adminCert?: acm.ICertificate;
}

interface SpaSite {
  bucket: s3.Bucket;
  distribution: cloudfront.Distribution;
}

/**
 * Two SPA sites, each: private S3 bucket + CloudFront (OAC) + `/api/*`
 * behavior forwarding to the HTTP API (same-origin, so no browser CORS),
 * SPA fallback routing, security headers, optional WAF + custom domain.
 * CI uploads the built assets and invalidates the cache.
 */
export class FrontendStack extends Stack {
  readonly customer: SpaSite;
  readonly admin: SpaSite;

  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);
    const { config } = props;

    const apiDomain = `${props.httpApi.apiId}.execute-api.${this.region}.amazonaws.com`;
    const apiOrigin = new origins.HttpOrigin(apiDomain, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY
    });

    const makeSite = (
      name: "customer" | "admin",
      domainNames: string[],
      certificate?: acm.ICertificate
    ): SpaSite => {
      const domainName = domainNames[0];
      const bucket = new s3.Bucket(this, `${name}Bucket`, {
        bucketName: `jj-${name}-web-${config.envName}-${this.account}`,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        encryption: s3.BucketEncryption.S3_MANAGED,
        enforceSSL: true,
        removalPolicy: config.removalPolicy,
        autoDeleteObjects: config.envName === "dev"
      });

      // SPA routing via a viewer-request rewrite on the S3 behavior only.
      // (Distribution-wide errorResponses would also rewrite API 404s into a
      // 200 index.html, turning any missing route into silent JSON garbage.)
      const spaRewrite = new cloudfront.Function(this, `${name}SpaRewrite`, {
        code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.indexOf('.') === -1) {
    request.uri = '/index.html';
  }
  return request;
}`)
      });

      const distribution = new cloudfront.Distribution(this, `${name}Dist`, {
        comment: `jj ${name}-web ${config.envName}`,
        defaultRootObject: "index.html",
        defaultBehavior: {
          origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          responseHeadersPolicy:
            cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
          functionAssociations: [
            {
              function: spaRewrite,
              eventType: cloudfront.FunctionEventType.VIEWER_REQUEST
            }
          ]
        },
        additionalBehaviors: {
          "/api/*": {
            origin: apiOrigin,
            viewerProtocolPolicy:
              cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
            cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
            originRequestPolicy:
              cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER
          }
        },
        priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
        webAclId: props.webAclArn,
        ...(domainName && certificate ? { domainNames, certificate } : {})
      });

      new CfnOutput(this, `${name}BucketName`, { value: bucket.bucketName });
      new CfnOutput(this, `${name}DistributionId`, {
        value: distribution.distributionId
      });
      new CfnOutput(this, `${name}Url`, {
        value: domainName
          ? `https://${domainName}`
          : `https://${distribution.distributionDomainName}`
      });
      return { bucket, distribution };
    };

    const customerNames = config.domain
      ? [config.domain.customer, ...(config.domain.customerAliases ?? [])]
      : [];
    this.customer = makeSite("customer", customerNames, props.customerCert);
    this.admin = makeSite(
      "admin",
      config.domain ? [config.domain.admin] : [],
      props.adminCert
    );

    if (config.domain) {
      const zone = route53.HostedZone.fromLookup(this, "Zone", {
        domainName: config.domain.zoneName
      });
      // One alias record per customer hostname (apex + e.g. www), all on
      // the same distribution; CloudFront serves the app under either name.
      customerNames.forEach((recordName, i) => {
        new route53.ARecord(this, i === 0 ? "CustomerAlias" : `CustomerAlias${i}`, {
          zone,
          recordName,
          target: route53.RecordTarget.fromAlias(
            new r53targets.CloudFrontTarget(this.customer.distribution)
          )
        });
      });
      new route53.ARecord(this, "AdminAlias", {
        zone,
        recordName: config.domain.admin,
        target: route53.RecordTarget.fromAlias(
          new r53targets.CloudFrontTarget(this.admin.distribution)
        )
      });
    }
  }
}
