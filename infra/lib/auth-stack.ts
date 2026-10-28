import { CfnOutput, Duration, Stack, type StackProps } from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import type { Construct } from "constructs";
import type { AppConfig } from "./config";

export interface AuthStackProps extends StackProps {
  config: AppConfig;
}

/**
 * Two fully separate user pools:
 *  - customer pool: self-registration allowed; content stays invite-gated
 *    because access requires a search membership created by an admin.
 *  - admin pool: no self-signup, TOTP MFA required. Admin API routes use a
 *    JWT authorizer bound to this pool's issuer, so a customer token can
 *    never pass an admin route.
 */
export class AuthStack extends Stack {
  readonly customerPool: cognito.UserPool;
  readonly customerClient: cognito.UserPoolClient;
  readonly adminPool: cognito.UserPool;
  readonly adminClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);
    const { config } = props;
    const prod = config.envName === "prod";

    this.customerPool = new cognito.UserPool(this, "CustomerPool", {
      userPoolName: `jj-customers-${config.envName}`,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        fullname: { required: true, mutable: true }
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      deletionProtection: prod,
      removalPolicy: config.removalPolicy
    });

    this.customerClient = this.customerPool.addClient("CustomerSpa", {
      userPoolClientName: "customer-web",
      authFlows: { userSrp: true },
      preventUserExistenceErrors: true,
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30)
    });

    this.adminPool = new cognito.UserPool(this, "AdminPool", {
      userPoolName: `jj-admins-${config.envName}`,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      standardAttributes: {
        fullname: { required: true, mutable: true }
      },
      mfa: cognito.Mfa.REQUIRED,
      mfaSecondFactor: { otp: true, sms: false },
      passwordPolicy: {
        minLength: 14,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      deletionProtection: prod,
      removalPolicy: config.removalPolicy
    });

    this.adminClient = this.adminPool.addClient("AdminSpa", {
      userPoolClientName: "admin-web",
      authFlows: { userSrp: true },
      preventUserExistenceErrors: true,
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.hours(12)
    });

    new cognito.CfnUserPoolGroup(this, "AdminGroup", {
      userPoolId: this.adminPool.userPoolId,
      groupName: "admin",
      description: "Full administrative access"
    });

    new CfnOutput(this, "CustomerPoolId", { value: this.customerPool.userPoolId });
    new CfnOutput(this, "CustomerClientId", {
      value: this.customerClient.userPoolClientId
    });
    new CfnOutput(this, "AdminPoolId", { value: this.adminPool.userPoolId });
    new CfnOutput(this, "AdminClientId", {
      value: this.adminClient.userPoolClientId
    });
  }
}
