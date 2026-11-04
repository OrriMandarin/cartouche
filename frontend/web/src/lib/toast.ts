import { toast } from "sonner";

export type ToastAction = { label: string; onClick: () => void };

/** Shows a toast. Components call this instead of importing the toast library. */
export function showToast(message: string, options: { action?: ToastAction } = {}): void {
  toast(message, { action: options.action });
}
