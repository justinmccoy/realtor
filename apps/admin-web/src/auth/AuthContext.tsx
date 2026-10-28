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
  handleResult: (r: cognito.SignInResult) => void;
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
    handleResult: (r) => {
      if (r.kind === "signedIn") {
        setState({ status: "signedIn", name: r.name, email: r.email });
      }
    },
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
