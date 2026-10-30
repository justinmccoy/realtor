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
/**
 * Cognito's stock emails never say which site they belong to, and the same
 * person can hold an account in both pools. Name the site in every invite /
 * verification message, and link it when the URL is known at synth time
 * (custom domain, or notify.customerUrl / adminUrl in cdk.json).
 */
function emailTemplates(site: "client" | "admin", url?: string) {
  const siteName = `Genau Here ${site} site`;
  const where = url ? `${siteName} (${url})` : siteName;
  return {
    userInvitation: {
      emailSubject: `Your Genau Here ${site} account`,
      emailBody:
        `<p>An account has been created for you on the <b>${where}</b>.</p>` +
        // Cognito rejects invite templates (email and SMS) without {username};
        // admin invites use the email address as the username, so it reads naturally.
        `<p>Sign in with the username <b>{username}</b> and the temporary password <b>{####}</b>. ` +
        `You will be asked to choose a new password the first time you sign in.</p>` +
        (site === "admin"
          ? `<p>Admin sign-in also requires an authenticator app; you will set it up on first login.</p>`
          : ""),
      smsMessage: `${siteName}: your username is {username} and your temporary password is {####}`
    },
    userVerification: {
      emailSubject: `${siteName}: your verification code`,
      emailBody: `<p>Your verification code for the <b>${where}</b> is <b>{####}</b>.</p>`,
      emailStyle: cognito.VerificationEmailStyle.CODE,
      smsMessage: `${siteName}: your verification code is {####}`
    }
  };
}

export class AuthStack extends Stack {
  readonly customerPool: cognito.UserPool;
  readonly customerClient: cognito.UserPoolClient;
  readonly adminPool: cognito.UserPool;
  readonly adminClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);
    const { config } = props;
    const prod = config.envName === "prod";
    const customerUrl = config.domain
      ? `https://${config.domain.customer}`
      : config.notify.customerUrl || undefined;
    const adminUrl = config.domain
      ? `https://${config.domain.admin}`
      : config.notify.adminUrl || undefined;

    this.customerPool = new cognito.UserPool(this, "CustomerPool", {
      userPoolName: `jj-customers-${config.envName}`,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      ...emailTemplates("client", customerUrl),
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
      ...emailTemplates("admin", adminUrl),
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
