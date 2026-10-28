import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserAttribute,
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
/** Invited clients sign in with a temporary password and must set a new one. */
export interface NewPasswordRequired {
  kind: "newPasswordRequired";
  user: CognitoUser;
  name: string;
}
export type SignInResult = SignedIn | NewPasswordRequired;

function toSignedIn(session: CognitoUserSession): SignedIn {
  const id = session.getIdToken().payload as Record<string, unknown>;
  return {
    kind: "signedIn",
    accessToken: session.getAccessToken().getJwtToken(),
    name: String(id.name ?? id.email ?? ""),
    email: String(id.email ?? "")
  };
}

export function signIn(email: string, password: string): Promise<SignInResult> {
  const user = new CognitoUser({ Username: email, Pool: pool });
  return new Promise((resolve, reject) => {
    user.authenticateUser(
      new AuthenticationDetails({ Username: email, Password: password }),
      {
        onSuccess: (session) => resolve(toSignedIn(session)),
        onFailure: reject,
        newPasswordRequired: (userAttributes: Record<string, string>) =>
          resolve({
            kind: "newPasswordRequired",
            user,
            name: userAttributes.name ?? ""
          })
      }
    );
  });
}

export function completeNewPassword(
  user: CognitoUser,
  newPassword: string,
  name: string
): Promise<SignedIn> {
  return new Promise((resolve, reject) => {
    user.completeNewPasswordChallenge(
      newPassword,
      { name },
      {
        onSuccess: (session) => resolve(toSignedIn(session)),
        onFailure: reject
      }
    );
  });
}

export function register(
  email: string,
  name: string,
  password: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    pool.signUp(
      email,
      password,
      [new CognitoUserAttribute({ Name: "name", Value: name })],
      [],
      (err) => (err ? reject(err) : resolve())
    );
  });
}

export function confirmRegistration(email: string, code: string): Promise<void> {
  const user = new CognitoUser({ Username: email, Pool: pool });
  return new Promise((resolve, reject) => {
    user.confirmRegistration(code, true, (err) =>
      err ? reject(err) : resolve()
    );
  });
}

export function resendCode(email: string): Promise<void> {
  const user = new CognitoUser({ Username: email, Pool: pool });
  return new Promise((resolve, reject) => {
    user.resendConfirmationCode((err) => (err ? reject(err) : resolve()));
  });
}

/** Restores the cached session (auto-refreshes with the refresh token). */
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

/** Fresh access token for API calls (library refreshes when expired). */
export function currentAccessToken(): Promise<string | null> {
  return restoreSession().then((s) => s?.accessToken ?? null);
}

export function signOut(): void {
  pool.getCurrentUser()?.signOut();
}
