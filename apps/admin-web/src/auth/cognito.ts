import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserPool,
  type CognitoUserSession
} from "amazon-cognito-identity-js";
import { COGNITO } from "../config";

const pool = new CognitoUserPool({
  UserPoolId: COGNITO.poolId || "missing_missing",
  ClientId: COGNITO.clientId || "missing"
});

export interface SignedIn {
  kind: "signedIn";
  accessToken: string;
  name: string;
  email: string;
}
export interface NewPasswordRequired {
  kind: "newPasswordRequired";
  user: CognitoUser;
}
/** First sign-in after the pool's required MFA: register an authenticator. */
export interface MfaSetup {
  kind: "mfaSetup";
  user: CognitoUser;
  secret: string;
  otpauthUrl: string;
}
/** Every later sign-in: enter the 6-digit TOTP code. */
export interface TotpRequired {
  kind: "totpRequired";
  user: CognitoUser;
}
export type SignInResult = SignedIn | NewPasswordRequired | MfaSetup | TotpRequired;

function toSignedIn(session: CognitoUserSession): SignedIn {
  const id = session.getIdToken().payload as Record<string, unknown>;
  return {
    kind: "signedIn",
    accessToken: session.getAccessToken().getJwtToken(),
    name: String(id.name ?? id.email ?? "Admin"),
    email: String(id.email ?? "")
  };
}

function callbacks(
  email: string,
  user: CognitoUser,
  resolve: (r: SignInResult) => void,
  reject: (e: unknown) => void
) {
  return {
    onSuccess: (session: CognitoUserSession) => resolve(toSignedIn(session)),
    onFailure: reject,
    newPasswordRequired: () => resolve({ kind: "newPasswordRequired", user }),
    totpRequired: () => resolve({ kind: "totpRequired", user }),
    mfaSetup: () => {
      user.associateSoftwareToken({
        associateSecretCode: (secret: string) =>
          resolve({
            kind: "mfaSetup",
            user,
            secret,
            otpauthUrl: `otpauth://totp/JJ%20Admin:${encodeURIComponent(email)}?secret=${secret}&issuer=JJ%20Admin`
          }),
        onFailure: reject
      });
    }
  };
}

export function signIn(email: string, password: string): Promise<SignInResult> {
  const user = new CognitoUser({ Username: email, Pool: pool });
  return new Promise((resolve, reject) => {
    user.authenticateUser(
      new AuthenticationDetails({ Username: email, Password: password }),
      callbacks(email, user, resolve, reject)
    );
  });
}

export function completeNewPassword(
  pending: NewPasswordRequired,
  newPassword: string,
  email: string
): Promise<SignInResult> {
  return new Promise((resolve, reject) => {
    pending.user.completeNewPasswordChallenge(
      newPassword,
      {},
      callbacks(email, pending.user, resolve, reject)
    );
  });
}

/** Verify the first TOTP code after scanning the secret; Cognito finishes
 *  the sign-in and returns the session directly. */
export function completeMfaSetup(
  pending: MfaSetup,
  code: string
): Promise<SignInResult> {
  return new Promise((resolve, reject) => {
    pending.user.verifySoftwareToken(code, "authenticator", {
      onSuccess: (session: CognitoUserSession) => resolve(toSignedIn(session)),
      onFailure: reject
    });
  });
}

export function submitTotp(
  pending: TotpRequired,
  code: string,
  email: string
): Promise<SignInResult> {
  return new Promise((resolve, reject) => {
    pending.user.sendMFACode(
      code,
      callbacks(email, pending.user, resolve, reject),
      "SOFTWARE_TOKEN_MFA"
    );
  });
}

export function startForgotPassword(email: string): Promise<void> {
  const user = new CognitoUser({ Username: email, Pool: pool });
  return new Promise((resolve, reject) => {
    user.forgotPassword({
      onSuccess: () => resolve(),
      onFailure: reject,
      inputVerificationCode: () => resolve()
    });
  });
}

export function confirmForgotPassword(
  email: string,
  code: string,
  newPassword: string
): Promise<void> {
  const user = new CognitoUser({ Username: email, Pool: pool });
  return new Promise((resolve, reject) => {
    user.confirmPassword(code, newPassword, {
      onSuccess: () => resolve(),
      onFailure: reject
    });
  });
}

export function restoreSession(): Promise<SignedIn | null> {
  const user = pool.getCurrentUser();
  if (!user) return Promise.resolve(null);
  return new Promise((resolve) => {
    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session || !session.isValid()) resolve(null);
      else resolve(toSignedIn(session));
    });
  });
}

export function currentAccessToken(): Promise<string | null> {
  return restoreSession().then((s) => s?.accessToken ?? null);
}

export function signOut(): void {
  pool.getCurrentUser()?.signOut();
}
