import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode
} from "react";
import * as cognito from "./cognito";

interface AuthState {
  status: "loading" | "signedOut" | "signedIn";
  name: string;
  email: string;
}

interface AuthApi extends AuthState {
  signIn: (email: string, password: string) => Promise<cognito.SignInResult>;
  completeNewPassword: (
    pending: cognito.NewPasswordRequired,
    newPassword: string,
    name: string
  ) => Promise<void>;
  register: typeof cognito.register;
  confirm: typeof cognito.confirmRegistration;
  resendCode: typeof cognito.resendCode;
  signOut: () => void;
}

const Ctx = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    status: "loading",
    name: "",
    email: ""
  });

  useEffect(() => {
    void cognito.restoreSession().then((s) =>
      setState(
        s
          ? { status: "signedIn", name: s.name, email: s.email }
          : { status: "signedOut", name: "", email: "" }
      )
    );
  }, []);

  const api: AuthApi = {
    ...state,
    signIn: async (email, password) => {
      const result = await cognito.signIn(email, password);
      if (result.kind === "signedIn") {
        setState({ status: "signedIn", name: result.name, email: result.email });
      }
      return result;
    },
    completeNewPassword: async (pending, newPassword, name) => {
      const s = await cognito.completeNewPassword(pending.user, newPassword, name);
      setState({ status: "signedIn", name: s.name, email: s.email });
    },
    register: cognito.register,
    confirm: cognito.confirmRegistration,
    resendCode: cognito.resendCode,
    signOut: () => {
      cognito.signOut();
      setState({ status: "signedOut", name: "", email: "" });
    }
  };

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
