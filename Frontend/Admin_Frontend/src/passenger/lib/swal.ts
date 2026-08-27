import Swal from "sweetalert2";

const themed = {
  customClass: {
    popup: "app-swal-popup",
    confirmButton: "app-swal-confirm",
    cancelButton: "app-swal-cancel",
  },
  buttonsStyling: false,
};

export async function swalConfirm(opts: {
  title?: string;
  text?: string;
  html?: string;
  confirmButtonText?: string;
  cancelButtonText?: string;
  icon?: "warning" | "question" | "info" | "error";
}): Promise<boolean> {
  const r = await Swal.fire({
    ...themed,
    title: opts.title ?? "Please confirm",
    text: opts.text,
    html: opts.html,
    icon: opts.icon ?? "question",
    showCancelButton: true,
    focusCancel: true,
    confirmButtonText: opts.confirmButtonText ?? "Confirm",
    cancelButtonText: opts.cancelButtonText ?? "Cancel",
  });
  return r.isConfirmed;
}

export function swalAlert(
  text: string,
  options?: { title?: string; icon?: "info" | "error" | "warning" | "success" }
): Promise<void> {
  const title = options?.title?.trim();
  return Swal.fire({
    ...themed,
    ...(title ? { title } : {}),
    text,
    icon: options?.icon ?? "info",
  }).then(() => undefined);
}
