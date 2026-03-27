import "./AppToast.css";

export type AppToastVariant = "info" | "error" | "success";

type Props = {
  message: string;
  variant?: AppToastVariant;
  onClose: () => void;
};

function IconInfo() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={24} viewBox="0 0 24 24" height={24} fill="none" aria-hidden>
      <path
        fill="currentColor"
        d="m12 1.5c-5.79844 0-10.5 4.70156-10.5 10.5 0 5.7984 4.70156 10.5 10.5 10.5 5.7984 0 10.5-4.7016 10.5-10.5 0-5.79844-4.7016-10.5-10.5-10.5zm.75 15.5625c0 .1031-.0844.1875-.1875.1875h-1.125c-.1031 0-.1875-.0844-.1875-.1875v-6.375c0-.1031.0844-.1875.1875-.1875h1.125c.1031 0 .1875.0844.1875.1875zm-.75-8.0625c-.2944-.00601-.5747-.12718-.7808-.3375-.206-.21032-.3215-.49305-.3215-.7875s.1155-.57718.3215-.7875c.2061-.21032.4864-.33149.7808-.3375.2944.00601.5747.12718.7808.3375.206.21032.3215.49305.3215.7875s-.1155.57718-.3215.7875c-.2061.21032-.4864.33149-.7808.3375z"
      />
    </svg>
  );
}

function IconError() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={24} viewBox="0 0 24 24" height={24} fill="none" aria-hidden>
      <path
        fill="currentColor"
        d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"
      />
    </svg>
  );
}

function IconSuccess() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={24} viewBox="0 0 24 24" height={24} fill="none" aria-hidden>
      <path
        fill="currentColor"
        d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"
      />
    </svg>
  );
}

export function AppToast({ message, variant = "info", onClose }: Props) {
  const mod = `app-toast--${variant}`;
  return (
    <div className={`app-toast ${mod}`} role="alert">
      <div className="app-toast__icon" aria-hidden>
        {variant === "error" ? <IconError /> : variant === "success" ? <IconSuccess /> : <IconInfo />}
      </div>
      <div className="app-toast__title">{message}</div>
      <button type="button" className="app-toast__close" onClick={onClose} aria-label="Dismiss">
        <svg height={20} viewBox="0 0 20 20" width={20} xmlns="http://www.w3.org/2000/svg" aria-hidden>
          <path
            fill="currentColor"
            d="m15.8333 5.34166-1.175-1.175-4.6583 4.65834-4.65833-4.65834-1.175 1.175 4.65833 4.65834-4.65833 4.6583 1.175 1.175 4.65833-4.6583 4.6583 4.6583 1.175-1.175-4.6583-4.6583z"
          />
        </svg>
      </button>
    </div>
  );
}
