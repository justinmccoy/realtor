import { useRef, useState, type ReactNode } from "react";

/** Two-click arming delete button, ported from the artifact. */
export function DangerButton({
  label = "Delete",
  onConfirm,
  disabled
}: {
  label?: string;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  return (
    <button
      className={`btn ghost danger${armed ? " armed" : ""}`}
      type="button"
      disabled={disabled}
      onClick={() => {
        if (armed) {
          clearTimeout(timer.current);
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
          timer.current = setTimeout(() => setArmed(false), 3000);
        }
      }}
    >
      {armed ? "Confirm" : label}
    </button>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div
      className="modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet">
        <div className="sheet-h">
          <h2>{title}</h2>
          <button className="btn ghost" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
        {footer && <div className="sheet-f">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  children
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function useToast(): [ReactNode, (msg: string) => void] {
  const [msg, setMsg] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const show = (m: string) => {
    setMsg(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(""), 2600);
  };
  return [msg ? <div className="toast">{msg}</div> : null, show];
}
